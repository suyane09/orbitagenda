# Asaas Sandbox — diagnóstico local sem alterações em produção
# Executar na raiz do OrbitAgenda: powershell -ExecutionPolicy Bypass -File .\scripts\asaas-sandbox-check.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root '.env.local'
if (-not (Test-Path $envFile)) { throw 'Arquivo .env.local ausente.' }
function Read-Env([string]$name) {
  $line = Get-Content $envFile | Where-Object { $_ -match ('^\s*' + [regex]::Escape($name) + '\s*=') } | Select-Object -Last 1
  if (-not $line) { return '' }
  return (($line -split '=',2)[1]).Trim().Trim('"').Trim("'")
}
$key = Read-Env 'ASAAS_API_KEY'
$envName = Read-Env 'ASAAS_ENVIRONMENT'
$webhook = Read-Env 'ASAAS_WEBHOOK_TOKEN'
$reconcile = Read-Env 'ASAAS_RECONCILE_TOKEN'
$enabled = Read-Env 'ASAAS_BILLING_ENABLED'
if ($envName -ne 'sandbox') { throw 'BLOQUEADO: ASAAS_ENVIRONMENT deve ser sandbox.' }
if (-not $key) { throw 'ASAAS_API_KEY não configurada.' }
Write-Host 'Ambiente: sandbox (confirmado).'
Write-Host ('Token webhook configurado: ' + ($webhook.Length -ge 32))
Write-Host ('Token conciliacao configurado: ' + ($reconcile.Length -ge 32))
Write-Host ('Criacao de assinaturas habilitada: ' + ($enabled -eq 'true'))
try {
  $account = Invoke-RestMethod -Uri 'https://api-sandbox.asaas.com/v3/myAccount' -Method Get -Headers @{access_token=$key;'User-Agent'='OrbitAgenda/1.0'}
  Write-Host 'API Asaas Sandbox: autenticacao OK.'
} catch {
  Write-Host ('API Asaas Sandbox: FALHA HTTP ' + [int]$_.Exception.Response.StatusCode)
  exit 1
}
try {
  $r = Invoke-WebRequest -Uri 'http://127.0.0.1:54321/functions/v1/asaas-webhook' -Method Post -ContentType 'application/json' -Body '{}' -UseBasicParsing
  Write-Host ('Webhook local sem autenticacao: HTTP ' + $r.StatusCode)
} catch {
  $code = [int]$_.Exception.Response.StatusCode
  Write-Host ('Webhook local sem autenticacao: HTTP ' + $code)
  if ($code -ne 401) { Write-Warning 'Esperado HTTP 401. Verifique se as Edge Functions locais estao ativas e configuradas.' }
}
Write-Host 'Diagnostico concluido. Nenhum pagamento ou assinatura foi criado ou alterado.'
