# OrbitAgenda — pilot Evolution API; execute on user's Windows PowerShell 5.1+.
# No production mutations. QR + explicit one-recipient test only.
[CmdletBinding()]
param(
  [ValidateSet('iniciar','qr','status','enviar','parar','diagnostico')]
  [string]$Acao = 'iniciar',
  [string]$Destino = ''
)
$ErrorActionPreference = 'Stop'
$apiUrl = 'http://127.0.0.1:8088'
# The API requires an allowed Origin even for PowerShell/curl without browser CORS.
# This matches the localhost-only CORS_ORIGIN value in compose.yaml.
$apiOrigin = 'http://localhost:8088'
$instanceName = 'orbitagenda_teste'
$projectName = 'orbitagenda-whatsapp-local'
$composeFile = Join-Path $PSScriptRoot 'compose.yaml'
$envFile = Join-Path $PSScriptRoot '.env'

function New-Secret {
  $bytes = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  return [BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
}

function Ensure-LocalSecrets {
  if (-not (Test-Path -LiteralPath $envFile)) {
    $databasePassword = New-Secret
    $apiKey = New-Secret
    [System.IO.File]::WriteAllText($envFile,
      "POSTGRES_PASSWORD=$databasePassword`nAUTHENTICATION_API_KEY=$apiKey`n",
      [System.Text.UTF8Encoding]::new($false))
    Write-Host 'Credenciais locais geradas. Arquivo .env ignorado pelo Git.' -ForegroundColor Green
  }
}

function Read-ApiKey {
  if (-not (Test-Path -LiteralPath $envFile)) {
    throw 'Ainda nao existem credenciais locais. Execute primeiro -Acao iniciar.'
  }
  $line = Get-Content -LiteralPath $envFile | Where-Object { $_ -match '^AUTHENTICATION_API_KEY=' } | Select-Object -First 1
  if (-not $line) { throw 'AUTHENTICATION_API_KEY ausente do .env local.' }
  return ($line -split '=',2)[1].Trim()
}

function Invoke-Evo([string]$method, [string]$path, $payload = $null) {
  $headers = @{ apikey = (Read-ApiKey); Origin = $apiOrigin }
  $args = @{ Uri = "$apiUrl$path"; Method = $method; Headers = $headers; TimeoutSec = 15 }
  if ($null -ne $payload) {
    $args['ContentType'] = 'application/json; charset=utf-8'
    $args['Body'] = ConvertTo-Json -InputObject $payload -Depth 8 -Compress
  }
  return Invoke-RestMethod @args
}

function Assert-LocalApi {
  # The root path can return an HTTP error even when Docker listens on port 8088.
  # Check an authenticated endpoint rather than misreporting it as Docker offline.
  try {
    $null = Invoke-Evo 'GET' '/instance/fetchInstances'
  } catch {
    $httpStatus = $null
    if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
      $httpStatus = [int]$_.Exception.Response.StatusCode
    }
    if ($null -ne $httpStatus) {
      throw "Evolution API responde, mas a rota autenticada falhou (HTTP $httpStatus). Verifique a chave local e os logs; nao apague os containers."
    }
    $reason = $_.Exception.Message
    throw "Nao foi possivel completar a chamada HTTP local em 127.0.0.1:8088: $reason. Use -Acao diagnostico para verificar."
  }
}

function Show-LocalDiagnostic {
  Write-Host 'Diagnostico local do WhatsApp (sem divulgar chaves ou mensagens):'
  if (Get-Command docker -ErrorAction SilentlyContinue) {
    & docker ps -a --filter 'name=orbitagenda-whatsapp-local' --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
  }
  if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
    Write-Host 'Resposta HTTP publica da raiz, sem usar proxy:'
    & curl.exe --noproxy '*' --max-time 10 -sS -o NUL -w 'Codigo HTTP: %{http_code}' -H "Origin: $apiOrigin" "$apiUrl/"
    Write-Host ''
  }
  if (-not (Test-Path -LiteralPath $envFile)) {
    Write-Host 'Arquivo .env local ainda nao existe. Execute -Acao iniciar.' -ForegroundColor Yellow
    return
  }
  try {
    Assert-LocalApi
    Write-Host 'Rota autenticada da Evolution API: OK.' -ForegroundColor Green
  } catch {
    Write-Host $_.Exception.Message -ForegroundColor Yellow
  }
}

function Get-ConnectionState {
  try {
    $response = Invoke-Evo 'GET' "/instance/connectionState/$instanceName"
    if ($response.instance -and $response.instance.state) { return [string]$response.instance.state }
    if ($response.state) { return [string]$response.state }
    return 'desconhecido'
  } catch {
    return ''
  }
}

function Start-LocalStack {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw 'Docker Desktop nao encontrado no PATH. Abra o Docker Desktop e reinicie este PowerShell.'
  }
  Ensure-LocalSecrets
  Write-Host 'Iniciando Evolution API isolada (sem alterar os demais containers)...'
  & docker compose --project-name $projectName --env-file $envFile -f $composeFile up -d
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao iniciar Docker Compose. Veja a mensagem acima.' }
  $ready = $false
  $lastError = ''
  for ($i=0; $i -lt 25; $i++) {
    try {
      Assert-LocalApi
      $ready = $true
      break
    } catch {
      $lastError = $_.Exception.Message
      Start-Sleep -Seconds 3
    }
  }
  if (-not $ready) {
    throw "Evolution API ainda indisponivel. Ultimo teste: $lastError"
  }
  Write-Host 'Evolution API respondendo localmente em 127.0.0.1:8088.' -ForegroundColor Green
}

function Ensure-Instance {
  $state = Get-ConnectionState
  if ($state) { return $null }
  Write-Host 'Criando instancia de WhatsApp para o piloto...'
  try {
    return Invoke-Evo 'POST' '/instance/create' @{
      instanceName = $instanceName
      integration = 'WHATSAPP-BAILEYS'
      qrcode = $true
    }
  } catch {
    # A reconnect after timeout may race instance creation. Recheck once.
    Start-Sleep -Seconds 3
    if (Get-ConnectionState) { return $null }
    throw 'Nao consegui criar a instancia. Consulte os logs locais da Evolution API (nao compartilhe logs com tokens ou QR Code).'
  }
}

function Extract-Qr($data) {
  if ($null -eq $data) { return '' }
  if ($data.qrcode -and $data.qrcode.base64) { return [string]$data.qrcode.base64 }
  if ($data.base64) { return [string]$data.base64 }
  return ''
}

function Show-Qr($initial) {
  $state = Get-ConnectionState
  if ($state -eq 'open') {
    $oldQr = Join-Path $env:TEMP 'orbitagenda-whatsapp-qr-local.html'
    if (Test-Path -LiteralPath $oldQr) { Remove-Item -LiteralPath $oldQr -Force -ErrorAction SilentlyContinue }
    Write-Host 'WhatsApp conectado! Nao e necessario novo QR Code.' -ForegroundColor Green
    return
  }
  $qr = Extract-Qr $initial
  for ($i=0; $i -lt 12 -and -not $qr; $i++) {
    try {
      $data = Invoke-Evo 'GET' "/instance/connect/$instanceName"
      $qr = Extract-Qr $data
    } catch {
      # QR may not be ready while Baileys initializes.
    }
    if (-not $qr) { Start-Sleep -Seconds 3 }
  }
  if (-not $qr) {
    Write-Host 'O QR Code ainda nao ficou pronto. Tente novamente: .\testar.ps1 -Acao qr' -ForegroundColor Yellow
    return
  }
  if ($qr -match '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$') {
    $src = $qr
  } elseif ($qr -match '^[A-Za-z0-9+/=]+$') {
    $src = "data:image/png;base64,$qr"
  } else {
    throw 'A API nao retornou uma imagem de QR Code valida.'
  }
  $qrFile = Join-Path $env:TEMP 'orbitagenda-whatsapp-qr-local.html'
  $html = @"
<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>OrbitAgenda - conectar WhatsApp</title>
<style>body{font-family:system-ui,sans-serif;background:#101827;color:white;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center;margin:0}main{background:#1e293b;padding:32px;border-radius:20px;max-width:440px}img{max-width:90%;background:white;padding:12px;border-radius:14px}small{color:#bbc4d6}</style>
<main><h1>Conectar WhatsApp</h1><p>No celular, abra WhatsApp &gt; Dispositivos conectados &gt; Conectar dispositivo</p>
<img src="$src" alt="QR Code para conectar WhatsApp"><p><small>Exclusivo deste computador. Nao compartilhe este QR Code. Caso expire, rode novamente -Acao qr.</small></p></main></html>
"@
  [System.IO.File]::WriteAllText($qrFile, $html, [System.Text.UTF8Encoding]::new($false))
  Start-Process -FilePath $qrFile
  Write-Host 'QR Code aberto no navegador. Leia com o seu WhatsApp.' -ForegroundColor Green
  Write-Host 'Depois de vincular, rode: .\testar.ps1 -Acao status'
}

switch ($Acao) {
  'diagnostico' {
    Show-LocalDiagnostic
  }
  'iniciar' {
    Start-LocalStack
    $newInstance = Ensure-Instance
    Show-Qr $newInstance
  }
  'qr' {
    Assert-LocalApi
    $newInstance = Ensure-Instance
    Show-Qr $newInstance
  }
  'status' {
    Assert-LocalApi
    $state = Get-ConnectionState
    if (-not $state) { Write-Host 'Instancia ainda nao foi criada.'; break }
    Write-Host "Situacao do WhatsApp: $state"
    if ($state -eq 'open') {
      $oldQr = Join-Path $env:TEMP 'orbitagenda-whatsapp-qr-local.html'
      if (Test-Path -LiteralPath $oldQr) { Remove-Item -LiteralPath $oldQr -Force -ErrorAction SilentlyContinue }
      Write-Host 'Pronto para enviar um teste (apenas com autorizacao explicita).' -ForegroundColor Green
    }
  }
  'enviar' {
    if ($Destino -notmatch '^55[1-9][0-9]{9,10}$') {
      throw 'Informe explicitamente um numero brasileiro valido, exemplo: -Destino 55DDDNUMERO (apenas seu numero de teste).'
    }
    Assert-LocalApi
    if ((Get-ConnectionState) -ne 'open') { throw 'Conecte o QR Code antes de enviar mensagens.' }
    Write-Host "Destino do teste: $Destino"
    $choice = Read-Host 'Para enviar UMA unica mensagem para esse numero, digite ENVIAR'
    if ($choice -cne 'ENVIAR') { Write-Host 'Envio cancelado.'; break }
    $msg = 'OrbitAgenda: teste de integracao local do WhatsApp realizado. Nenhum agendamento real foi disparado.'
    $resp = Invoke-Evo 'POST' "/message/sendText/$instanceName" @{number=$Destino;text=$msg}
    $messageId = if ($resp.key -and $resp.key.id) { $resp.key.id } else { '(nao informado)' }
    Write-Host "Solicitacao de teste aceita pela API. ID da mensagem: $messageId" -ForegroundColor Green
    Write-Host 'Confirme o recebimento no celular; aceite da API nao prova entrega.'
  }
  'parar' {
    if (-not (Test-Path -LiteralPath $envFile)) { throw 'Nenhum ambiente iniciado neste diretorio.' }
    & docker compose --project-name $projectName --env-file $envFile -f $composeFile down
    if ($LASTEXITCODE -ne 0) { throw 'Docker Compose informou falha.' }
    Write-Host 'Containers locais do piloto parados. Dados e sessoes preservados.' -ForegroundColor Green
  }
}
