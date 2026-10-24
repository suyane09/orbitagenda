#requires -Version 5.1
<#
.SYNOPSIS
  Executa todos os testes SQL do OrbitAgenda em um PostgreSQL 17 descartavel.
.DESCRIPTION
  Usa somente Docker local, volume de codigo SOMENTE LEITURA e banco efemero.
  Nao se conecta ao Supabase remoto, ao Asaas, nem usa .env.local.
  Ao terminar, remove apenas o container de teste que este script criou.
.USAGE
  powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\test-db-windows.ps1
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if (-not (Test-Path (Join-Path $root 'supabase\tests\run.sh'))) {
    throw 'Execute esta copia dentro do repositorio OrbitAgenda.'
}
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw 'Docker CLI nao encontrado. Abra o Docker Desktop antes de testar.'
}

$container = 'orbitagenda-pg-teste-' + ([guid]::NewGuid().ToString('N').Substring(0, 12))
$log = Join-Path ([IO.Path]::GetTempPath()) ('orbitagenda-sql-' + $container + '.log')
$started = $false
$previousErrorPreference = $ErrorActionPreference
try {
    Write-Host 'Iniciando PostgreSQL 17 TEMPORARIO (sem acesso a producao)...'
    # Sem portas publicadas; somente o codigo e montado, em modo read-only.
    & docker run --rm -d --name $container `
        -e POSTGRES_USER=postgres `
        -e POSTGRES_PASSWORD=postgres `
        -e POSTGRES_DB=postgres `
        -v "${root}:/work:ro" -w /work postgres:17 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw 'Nao foi possivel iniciar o container de teste. Verifique o Docker Desktop.'
    }
    $started = $true

    $ready = $false
    # pg_isready pode retornar codigo != 0 enquanto o banco esta inicializando.
    $ErrorActionPreference = 'Continue'
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        & docker exec $container pg_isready -U postgres -d postgres *> $null
        if ($LASTEXITCODE -eq 0) { $ready = $true; break }
        Start-Sleep -Seconds 1
    }
    $ErrorActionPreference = $previousErrorPreference
    if (-not $ready) { throw 'PostgreSQL temporario nao ficou pronto apos 30 tentativas.' }

    Write-Host 'Aplicando migracoes e executando testes SQL no container temporario...'
    # Captura NOTICE verbosos em arquivo; preserva o codigo de saida real.
    $ErrorActionPreference = 'Continue'
    & docker exec -e ADMIN_URL=postgresql://postgres:postgres@localhost:5432/postgres `
        $container bash supabase/tests/run.sh *>&1 | Out-File -FilePath $log -Encoding utf8
    $exitCode = $LASTEXITCODE
    $ErrorActionPreference = $previousErrorPreference

    $summary = @(Select-String -Path $log -Pattern '^---- [0-9]+ asserções aprovadas, [0-9]+ falhas ----$' |
        Select-Object -Last 1)
    if ($summary.Count -gt 0) { Write-Host $summary[0].Line }
    if ($exitCode -ne 0 -or $summary.Count -ne 1 -or $summary[0].Line -notmatch ', 0 falhas ----$') {
        Write-Host 'Ultimas linhas do log para diagnostico:'
        Get-Content -Path $log -Tail 40 | ForEach-Object { Write-Host $_ }
        throw 'Testes SQL nao passaram. Confira o log indicado abaixo.'
    }
    Write-Host 'PASSOU: PostgreSQL + migracoes + SQL, sem falhas.'
}
finally {
    $ErrorActionPreference = 'Continue'
    if ($started) {
        Write-Host 'Removendo somente o container descartavel criado pelo teste...'
        & docker stop $container *> $null
    }
    $ErrorActionPreference = $previousErrorPreference
    Write-Host ('Log completo: ' + $log)
}
