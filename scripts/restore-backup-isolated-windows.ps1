#Requires -Version 5.1
# OrbitAgenda: restore the CURRENT backup only into the explicitly identified fourth LOCAL container.
# WARNING: imported dumps contain private user data. Keep files and private logs off GitHub.
[CmdletBinding()]
param(
  [string]$BackupDir = (Join-Path $HOME 'orbitagenda-backups-producao\20261024-214956'),
  [string]$LocalProjectDir = (Join-Path $HOME 'orbitagenda-recuperacao-atual-20261024')
)
$ErrorActionPreference = 'Stop'
$target = 'supabase_db_orbitagenda-recuperacao-atual-20261024'
$expectedRef = 'peajkbjwusivdrqjoqtl'
$report = Join-Path $LocalProjectDir 'recuperacao-backup-atual-resultado.txt'
$privateLog = Join-Path $LocalProjectDir 'recuperacao-backup-atual-erros-PRIVADO.log'
$remoteFiles = @()
$targetConfirmed = $false
$failed = $false
function StopSafe([string]$reason) { throw ('VERIFICACAO_PENDENTE: ' + $reason) }
function Docker([string[]]$Arguments) {
  $old = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $output = @(& docker.exe @Arguments 2>&1)
    $code = $LASTEXITCODE
  } finally { $ErrorActionPreference = $old }
  $txt = ($output | ForEach-Object { $_.ToString() }) -join [Environment]::NewLine
  if ($code -ne 0) {
    # PostgreSQL errors could include confidential SQL/PII; do not echo the raw output.
    [IO.File]::WriteAllText($privateLog, $txt, (New-Object Text.UTF8Encoding($false)))
    throw ('VERIFICACAO_PENDENTE: docker/psql code=' + $code + '; private local diagnostic recorded')
  }
  return $txt.Trim()
}
function Q([string]$Sql) {
  (Docker -Arguments @('exec',$target,'psql','-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-c',$Sql)).Trim()
}
try {
  $names = @('roles.sql','schema.sql','data.sql')
  foreach ($filename in ($names + @('manifesto.json'))) {
    if (-not (Test-Path -LiteralPath (Join-Path $BackupDir $filename) -PathType Leaf)) {
      StopSafe ('Missing backup file: ' + $filename)
    }
  }
  if (-not (Test-Path -LiteralPath $LocalProjectDir -PathType Container)) {
    StopSafe 'Fourth local project directory missing'
  }
  if (Test-Path -LiteralPath $report) {
    StopSafe 'Restore report already exists; never re-import into same destination'
  }
  $manifest = Get-Content -LiteralPath (Join-Path $BackupDir 'manifesto.json') -Raw | ConvertFrom-Json
  if ($manifest.projeto -cne $expectedRef -or @($manifest.arquivos).Count -ne 3) {
    StopSafe 'Manifest identity or list of files is invalid'
  }
  foreach ($filename in $names) {
    $matches = @($manifest.arquivos | Where-Object { $_.nome -ceq $filename })
    $file = Get-Item -LiteralPath (Join-Path $BackupDir $filename)
    if ($matches.Count -ne 1 -or $file.Length -lt 100 -or $file.Length -ne [long]$matches[0].bytes) {
      StopSafe ('Unexpected backup file size: ' + $filename)
    }
    if ((Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash -cne $matches[0].sha256) {
      StopSafe ('SHA256 mismatch: ' + $filename)
    }
    if (Select-String -LiteralPath $file.FullName -Pattern '^\s*\\(?:connect\b|c\s|!|gexec\b|copy\b|i\s|ir\s|include\b)' -Quiet) {
      StopSafe ('Unsafe psql meta-command: ' + $filename)
    }
  }
  $dataPath = Join-Path $BackupDir 'data.sql'
  $beginCount = @(Select-String -LiteralPath $dataPath -Pattern '^COPY\s+.*FROM stdin;$').Count
  $endCount = @(Select-String -LiteralPath $dataPath -Pattern '^\\\.$').Count
  if ($beginCount -lt 1 -or $endCount -ne $beginCount -or
      -not (Select-String -LiteralPath $dataPath -Pattern 'PostgreSQL database dump complete' -Quiet)) {
    StopSafe 'COPY blocks or end-of-dump marker missing'
  }
  Write-Host 'BACKUP_CHECKSUMS_OK: all 3 SQL files match manifesto.json'

  $cfgFile = Join-Path $LocalProjectDir 'supabase\config.toml'
  if (-not (Test-Path -LiteralPath $cfgFile -PathType Leaf)) { StopSafe 'Missing fourth project config.toml' }
  $cfg = Get-Content -LiteralPath $cfgFile -Raw
  if ($cfg -notmatch '(?m)^\s*project_id\s*=\s*"orbitagenda-recuperacao-atual-20261024"\s*$' -or
      $cfg -notmatch '(?m)^\s*port\s*=\s*54622\s*$') {
    StopSafe 'Unexpected local project ID or port'
  }
  if (-not (Get-Command docker.exe -ErrorAction SilentlyContinue)) { StopSafe 'Docker is not installed' }
  if ((Docker -Arguments @('inspect','--format','{{.Name}}',$target)) -cne ('/' + $target)) {
    StopSafe 'Wrong Docker target name'
  }
  if ((Docker -Arguments @('inspect','--format','{{.State.Status}}',$target)) -cne 'running') {
    StopSafe 'Target is not running'
  }
  if ((Docker -Arguments @('port',$target,'5432/tcp')) -notmatch ':54622(?:\s|$)') {
    StopSafe 'Docker mapping is not local port 54622'
  }
  if ((Q 'SHOW server_version;') -notmatch '^17\.') {
    StopSafe 'PostgreSQL 17 is required'
  }
  if ((Q "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename IN ('establishments','establishment_subscriptions');") -ne '0') {
    StopSafe 'Destination already contains OrbitAgenda tables'
  }
  if ((Q 'SELECT count(*) FROM auth.users;') -ne '0') {
    StopSafe 'Destination Auth is not empty'
  }
  $targetConfirmed = $true
  Write-Host 'ISOLATED_DESTINATION_OK: fourth local container / port 54622 / PostgreSQL 17'

  foreach ($filename in $names) {
    $remote = '/tmp/orbitagenda-import-' + $filename
    [void](Docker -Arguments @('cp',(Join-Path $BackupDir $filename),($target + ':' + $remote)))
    $remoteFiles += $remote
  }
  Write-Host 'RESTORING_IN_ONE_TRANSACTION (not connected to production)'
  [void](Docker -Arguments @('exec',$target,'psql','-X','-q','-U','postgres','-d','postgres',
    '-v','ON_ERROR_STOP=1','--single-transaction',
    '-f',$remoteFiles[0],'-f',$remoteFiles[1],
    '-c','SET session_replication_role = replica',
    '-f',$remoteFiles[2]))
  Write-Host 'SQL_RESTORE_COMMITTED: transaction succeeded'

  $tables = [int](Q "SELECT count(*) FROM pg_tables WHERE schemaname='public';")
  $unprotected = [int](Q "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') AND NOT c.relrowsecurity;")
  $badKeys = [int](Q "SELECT count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public' AND c.contype='f' AND NOT c.convalidated;")
  $authUsers = [int](Q 'SELECT count(*) FROM auth.users;')
  $businesses = [int](Q 'SELECT count(*) FROM public.establishments;')
  $subscriptions = [int](Q 'SELECT count(*) FROM public.establishment_subscriptions;')
  if ($tables -lt 22 -or $unprotected -ne 0 -or $badKeys -ne 0) {
    StopSafe 'Restore committed, structural checks failed; do not rerun into this container'
  }
  # Verify foreign-key row contents, since restoring with session_replication_role=replica disables FK triggers.
  $fkAudit = @'
DO $check$
DECLARE x record; eq text; present text; missing bigint;
BEGIN
 FOR x IN
  SELECT c.conname,c.conrelid,c.confrelid,c.conkey,c.confkey
  FROM pg_constraint c JOIN pg_namespace ns ON ns.oid=c.connamespace
  WHERE c.contype='f' AND ns.nspname='public'
 LOOP
  SELECT string_agg(format('child.%I = parent.%I',a.attname,b.attname),' AND ' ORDER BY k.i),
         string_agg(format('child.%I IS NOT NULL',a.attname),' AND ' ORDER BY k.i)
  INTO eq,present
  FROM generate_subscripts(x.conkey,1) k(i)
  JOIN pg_attribute a ON a.attrelid=x.conrelid AND a.attnum=x.conkey[k.i]
  JOIN pg_attribute b ON b.attrelid=x.confrelid AND b.attnum=x.confkey[k.i];
  EXECUTE format('SELECT count(*) FROM %s child WHERE %s AND NOT EXISTS (SELECT 1 FROM %s parent WHERE %s)',
      x.conrelid::regclass,present,x.confrelid::regclass,eq)
  INTO missing;
  IF missing>0 THEN RAISE EXCEPTION 'Foreign key % has % orphan rows',x.conname,missing; END IF;
 END LOOP;
END $check$;
'@
  [void](Q $fkAudit)

  $lines = @(
    'ORBITAGENDA_ISOLATED_BACKUP_RESTORE',
    ('verified_at=' + (Get-Date).ToString('o')),
    ('local_container=' + $target),
    'local_port=54622',
    ('database_tables=' + $tables),
    ('tables_without_rls=' + $unprotected),
    ('unvalidated_fks=' + $badKeys),
    ('auth_user_count=' + $authUsers),
    ('establishment_count=' + $businesses),
    ('subscriptions_count=' + $subscriptions),
    'foreign_key_data_audit=OK',
    'storage_file_binaries_restored=NO',
    'real_client_and_asaas_e2e_completed=NO'
  )
  [IO.File]::WriteAllLines($report, $lines, (New-Object Text.UTF8Encoding($false)))
  Write-Host "RESTORE_STRUCTURALLY_VALIDATED: tables=$tables missing_rls=$unprotected invalid_fks=$badKeys"
  Write-Host ('LOCAL_REPORT: ' + $report)
} catch {
  $failed = $true
  # The exception from Docker intentionally contains no SQL content.
  Write-Host $_.Exception.Message -ForegroundColor Yellow
  if ($targetConfirmed) {
    Write-Host 'Any SQL writes were limited to the fourth local Docker container.'
    Write-Host 'If SQL_RESTORE_COMMITTED appeared, the import has committed; do not rerun blindly.'
  }
} finally {
  foreach ($remote in $remoteFiles) {
    try { [void](Docker -Arguments @('exec',$target,'rm','-f',$remote)) }
    catch { Write-Host 'WARNING: private /tmp SQL cleanup must be checked in the fourth container.' }
  }
}
if ($failed) { exit 1 }
