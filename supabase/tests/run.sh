#!/usr/bin/env bash
# Cria um banco descartável, aplica shim + migrações + testes de acesso.
# Uso:  ADMIN_URL=postgresql://postgres:postgres@localhost:5432/postgres npm run test:db
set -euo pipefail
cd "$(dirname "$0")"
ADMIN_URL="${ADMIN_URL:-postgresql://postgres:postgres@localhost:5432/postgres}"
DB="orbit_test_$$"
BASE="${ADMIN_URL%/*}"
TEST_URL="$BASE/$DB"

cleanup() { psql "$ADMIN_URL" -qc "drop database if exists $DB" >/dev/null 2>&1 || true; }
trap cleanup EXIT

psql "$ADMIN_URL" -qv ON_ERROR_STOP=1 -c "create database $DB"
run() { psql "$TEST_URL" -q -v ON_ERROR_STOP=1 -f "$1" 2>&1; }

run 00_bootstrap_supabase_shim.sql
for f in ../migrations/*.sql; do echo "migration: $(basename "$f")"; run "$f"; done

# stdout (tabelas de retorno) descartado; notices/erros vão para stderr
OUT="$(psql "$TEST_URL" -q -v ON_ERROR_STOP=1 -f 10_tenant_isolation.sql 2>&1 >/dev/null)" && STATUS=0 || STATUS=$?
echo "$OUT" | sed -E 's/^psql:[^ ]+ NOTICE:  //'
PASS=$(echo "$OUT" | grep -c 'PASS' || true)
FAIL=$(echo "$OUT" | grep -c -E 'FAIL|ERROR' || true)
echo "---- ${PASS} asserções aprovadas, ${FAIL} falhas ----"
exit $STATUS
