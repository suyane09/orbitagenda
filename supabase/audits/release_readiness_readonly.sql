-- OrbitAgenda | auditoria SOMENTE LEITURA para decisão de lançamento
-- Pode rodar no SQL Editor em produção. NÃO altera dados, roles ou esquema.
-- Não substitui testes de navegador/Asaas nem backup restaurado.
WITH checks AS (
  SELECT 'public_tables_at_least_22' AS gate,
    (SELECT count(*) >= 22 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','p')) AS passed,
    'Verificar contagem de tabelas e migrations esperadas' AS next_action
  UNION ALL
  SELECT 'public_rls_all_enabled',
    NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','p') AND NOT c.relrowsecurity),
    'Ativar RLS apenas com politicas revisadas e testes isolados'
  UNION ALL
  SELECT 'platform_admin_provisioned',
    EXISTS (SELECT 1 FROM public.platform_admins),
    'Vincular ADMIN verificado pela pessoa responsavel; NUNCA usar ID presumido'
  UNION ALL
  SELECT 'asaas_reconciliation_schema_present',
    to_regclass('public.asaas_reconciliation_runs') IS NOT NULL
      AND to_regprocedure('public.record_asaas_reconciliation_run(text,integer,integer,integer,jsonb)') IS NOT NULL,
    'Aplicar migration revisada 20261024130000 em release controlado apos backup'
  UNION ALL
  SELECT 'asaas_reversals_rpc_present',
    to_regprocedure('public.record_asaas_billing_reversal(text,text,text,text,text,bigint,text,date)') IS NOT NULL,
    'Aplicar migration revisada 20261024120000 em release controlado apos backup'
)
SELECT gate, CASE WHEN passed THEN 'OK' ELSE 'PENDENTE' END AS status, next_action
FROM checks ORDER BY gate;
