# OrbitAgenda - backup atual da producao usando Supabase CLI
# SOMENTE leitura remota: supabase db dump --linked. Nao usa db push/reset.
# Windows PowerShell 5.1+; execute a partir da pasta do repo ja LINKADO ao Supabase correto.
[CmdletBinding()]
param(
  [string]$ProjectDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path,
  [string]$OutputRoot = (Join-Path $HOME 'orbitagenda-backups-producao')
)
$ErrorActionPreference = 'Stop'
$expectedRef = 'peajkbjwusivdrqjoqtl'
$originalLocation = (Get-Location).Path
function Stop-Safe([string]$why) { throw "ABORTADO SEM ALTERAR BANCO: $why" }
function Cli-Dump([string[]]$flags) {
  $oldPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    # A CLI e invocada sem imprime as configuracoes, env ou senhas.
    & npx --yes supabase db dump --linked @flags 2>&1 | ForEach-Object {
      $line = $_.ToString()
      if ($line -match '(?i)(password|postgresql://|db-url|secret|token|apikey|api.key)') {
        Write-Host '[mensagem potencialmente sensivel ocultada]'
      } else { Write-Host $line }
    }
    $code = $LASTEXITCODE
  } finally { $ErrorActionPreference = $oldPreference }
  if ($code -ne 0) { Stop-Safe ("Supabase CLI retornou codigo $code. Confira Docker, login e credenciais." ) }
}
try {
  if (-not (Test-Path -LiteralPath $ProjectDir -PathType Container)) { Stop-Safe 'Pasta do projeto ausente.' }
  $projectDirFull = (Resolve-Path -LiteralPath $ProjectDir).Path
  $refFile = Join-Path $projectDirFull 'supabase\.temp\project-ref'
  if (-not (Test-Path -LiteralPath $refFile -PathType Leaf)) {
    Stop-Safe 'Projeto nao esta vinculado. Confira supabase/.temp/project-ref e vincule manualmente o projeto correto em pasta separada.'
  }
  $linkedRef = (Get-Content -LiteralPath $refFile -Raw).Trim()
  if ($linkedRef -cne $expectedRef) { Stop-Safe ("ID Supabase inesperado: $linkedRef. Esperado: $expectedRef") }
  if (-not (Get-Command npx -ErrorAction SilentlyContinue)) { Stop-Safe 'Node.js / npx nao encontrado.' }
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Stop-Safe 'Docker Desktop nao encontrado.' }
  & docker info --format '{{.ServerVersion}}' 1>$null 2>$null
  if ($LASTEXITCODE -ne 0) { Stop-Safe 'Docker nao esta funcionando.' }

  $tag = Get-Date -Format 'yyyyMMdd-HHmmss'
  $target = Join-Path $OutputRoot $tag
  if (Test-Path -LiteralPath $target) { Stop-Safe 'Destino ja existe; nao sobrescrever backups.' }
  New-Item -ItemType Directory -Path $target -Force | Out-Null
  Write-Host 'Destino Supabase confirmado pelo link local; iniciando DUMPS somente leitura.'
  Write-Host 'Backup restrito a computador local; NAO enviar a GitHub, chat, suporte ou CI.'
  Set-Location -LiteralPath $projectDirFull
  $roles = Join-Path $target 'roles.sql'
  $schema = Join-Path $target 'schema.sql'
  $data = Join-Path $target 'data.sql'
  Cli-Dump @('--role-only', '--file', $roles)
  Cli-Dump @('--file', $schema)
  Cli-Dump @('--data-only','--use-copy','--exclude','storage.buckets_vectors','--exclude','storage.vector_indexes','--file',$data)
  $entries = @()
  foreach ($file in @($roles,$schema,$data)) {
    $item = Get-Item -LiteralPath $file -ErrorAction Stop
    if ($item.Length -lt 100) { Stop-Safe "Dump insuficiente: $($item.Name) ($($item.Length) bytes)." }
    $entries += [ordered]@{
      name=$item.Name
      bytes=$item.Length
      sha256=(Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash
    }
  }
  $manifest = [ordered]@{
    purpose='backup_logico_orbitagenda_producao'
    project_ref=$expectedRef
    created_at_local=(Get-Date -Format 'yyyy-MM-ddTHH:mm:sszzz')
    dump_files=$entries
    restore_tested=$false
    storage_files_included=$false
    warning='CONTEM DADOS PESSOAIS E AUTH. Criptografar offline; nao compartilhar.'
  }
  $manifestPath=Join-Path $target 'manifesto.json'
  $manifest | ConvertTo-Json -Depth 7 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
  Write-Host 'BACKUP_LOGICO_GERADO: 3 arquivos e manifesto com SHA-256.'
  Write-Host 'Local privado:' $target
  Write-Host 'ATENCAO: dump NAO inclui arquivos binarios do Storage; restore ainda precisa ser testado em NOVO ambiente isolado.'
} finally {
  Set-Location -LiteralPath $originalLocation
}