-- Orbit Agenda | Validação somente leitura da comissão 2C
-- Seguro para executar no SQL Editor em produção: SELECT apenas.
-- Não cria atendimentos, pagamentos, triggers nem snapshots.

select
  to_regclass('public.appointment_commission_snapshots') is not null as snapshots_existe,
  to_regclass('public.appointment_commission_balances') is not null as saldos_existe,
  (select relrowsecurity from pg_class where oid = 'public.appointment_commission_snapshots'::regclass) as snapshots_rls,
  (select 'security_invoker=true' = any(coalesce(reloptions,array[]::text[]))
     from pg_class where oid = 'public.appointment_commission_balances'::regclass) as saldos_security_invoker,
  (select tgenabled = 'O' from pg_trigger
     where tgrelid = 'public.appointments'::regclass
       and tgname = 'capture_appointment_commission') as gatilho_ativo,
  (select count(*) from public.appointment_commission_snapshots) as snapshots_contagem,
  (select count(*) from public.appointment_commission_balances) as saldos_contagem,
  (select count(*) from public.professional_commission_rules) as regras_contagem;

-- Simulação matemática, sem acesso ou escrita aos dados de clientes.
-- Exemplo de serviço R$ 100,00 com comissão de 40%:
-- Recebimento R$ 25,00 -> R$ 10,00 de comissão.
-- Recebimento total R$ 100,00 -> R$ 40,00.
-- Estorno R$ 50,00 após pagamento integral -> R$ 20,00.
-- Recebimento superior ao preço -> teto da comissão em R$ 40,00.
select
  round(least(10000, 2500)::numeric * 4000 / 10000) as parcial_cents,
  round(least(10000, 10000)::numeric * 4000 / 10000) as integral_cents,
  round(least(10000, greatest(0, 10000 - 5000))::numeric * 4000 / 10000) as apos_estorno_cents,
  round(least(10000, 15000)::numeric * 4000 / 10000) as teto_cents;
