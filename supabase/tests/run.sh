#!/usr/bin/env bash
# Para cada arquivo de teste (NN_*.sql) cria um banco descartável, aplica shim + migrações e roda o teste.
# Uso:  ADMIN_URL=postgresql://postgres:postgres@localhost:5432/postgres npm run test:db
set -euo pipefail
cd "$(dirname "$0")"
ADMIN_URL="${ADMIN_URL:-postgresql://postgres:postgres@localhost:5432/postgres}"
BASE="${ADMIN_URL%/*}"
DB=""

cleanup() { [ -n "$DB" ] && psql "$ADMIN_URL" -qc "drop database if exists $DB" >/dev/null 2>&1 || true; }
trap cleanup EXIT

TOTAL_PASS=0; TOTAL_FAIL=0; STATUS=0
for T in [1-9][0-9]_*.sql; do
  DB="orbit_test_$$_${T%%_*}"
  TEST_URL="$BASE/$DB"
  echo "=== $T ==="
  psql "$ADMIN_URL" -qv ON_ERROR_STOP=1 -c "create database $DB"
  run() { psql "$TEST_URL" -q -v ON_ERROR_STOP=1 -f "$1" 2>&1; }
  run 00_bootstrap_supabase_shim.sql
  for f in ../migrations/*.sql; do echo "migration: $(basename "$f")"; run "$f"; done

  # stdout (tabelas de retorno) descartado; notices/erros vão para stderr
  OUT="$(psql "$TEST_URL" -q -v ON_ERROR_STOP=1 -f "$T" 2>&1 >/dev/null)" && S=0 || S=$?
  echo "$OUT" | sed -E 's/^psql:[^ ]+ NOTICE:  //'
  TOTAL_PASS=$((TOTAL_PASS + $(echo "$OUT" | grep -c 'PASS' || true)))
  TOTAL_FAIL=$((TOTAL_FAIL + $(echo "$OUT" | grep -c -E 'FAIL|ERROR' || true)))
  [ "$S" -ne 0 ] && STATUS=$S
  cleanup; DB=""
done
echo "---- ${TOTAL_PASS} asserções aprovadas, ${TOTAL_FAIL} falhas ----"
exit $STATUS
