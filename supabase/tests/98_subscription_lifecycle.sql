\set ON_ERROR_STOP on
set client_min_messages = notice;
insert into auth.users(id,email) values
 ('f9000000-0000-0000-0000-000000000001','life.owner@sample.invalid'),
 ('f9000000-0000-0000-0000-000000000003','life.admin@sample.invalid');
insert into public.platform_admins(user_id) values('f9000000-0000-0000-0000-000000000003');
select set_config('request.jwt.claim.sub','f9000000-0000-0000-0000-000000000003',false);
set role authenticated;
select set_config('tests.life_plan',public.admin_create_subscription_plan('life_test','Ciclo',4900,false)::text,false);
reset role;
select set_config('request.jwt.claim.sub','f9000000-0000-0000-0000-000000000001',false);
set role authenticated;
select public.create_establishment('Ciclo Empresa');
reset role;
select set_config('tests.life_est',(select id::text from public.establishments where slug='ciclo-empresa'),false);
create function pg_temp.st() returns text language sql as
 $$ select status from public.establishment_subscriptions where establishment_id=current_setting('tests.life_est')::uuid $$;
create function pg_temp.allowed() returns boolean language sql as
 $$ select private.billing_allows_write(current_setting('tests.life_est')::uuid) $$;
create function pg_temp.ev(p_id text,p_type text,p_status text,p_due date) returns boolean language plpgsql as $$
begin
 set local role service_role;
 if p_type like 'PAYMENT_REFUNDED' or p_type like 'PAYMENT_CHARGEBACK%' or p_type='PAYMENT_DELETED' or p_type='SUBSCRIPTION_DELETED' then
  return public.record_asaas_billing_reversal('evt_life_'||p_id,'sub_life','pay_'||p_id,p_type,p_status,4900,'sandbox',p_due);
 end if;
 return public.record_asaas_billing_event('evt_life_'||p_id,'sub_life','pay_'||p_id,p_type,p_status,4900,'sandbox',p_due);
end $$;
update public.establishment_subscriptions set plan_id=current_setting('tests.life_plan')::uuid,status='trialing',
 current_period_end=null,asaas_environment='sandbox',asaas_customer_id='cus_life',asaas_subscription_id='sub_life'
 where establishment_id=current_setting('tests.life_est')::uuid;
do $$ begin
 if pg_temp.allowed() then raise exception 'FAIL contratada sem pagamento deveria estar bloqueada'; end if;
 raise notice 'PASS contratação sem pagamento permanece bloqueada';
end $$;
do $$ begin
 perform pg_temp.ev('p1','PAYMENT_RECEIVED','RECEIVED',current_date-40);
 reset role;
 if pg_temp.st()<>'active' or not pg_temp.allowed() then raise exception 'FAIL pagamento não ativou'; end if;
 raise notice 'PASS pagamento ativa e libera escrita';
end $$;
do $$ begin
 perform pg_temp.ev('o1','PAYMENT_OVERDUE','OVERDUE',current_date-2); reset role;
 if pg_temp.st()<>'past_due' or not pg_temp.allowed() then raise exception 'FAIL tolerância de 5 dias'; end if;
 raise notice 'PASS atraso recente mantém acesso (tolerância)';
 update public.establishment_subscriptions set payment_due_at=(current_date-10)::timestamp at time zone 'America/Sao_Paulo'
  where establishment_id=current_setting('tests.life_est')::uuid;
 if pg_temp.allowed() then raise exception 'FAIL atraso > 5 dias não bloqueou'; end if;
 raise notice 'PASS atraso > 5 dias bloqueia (suspensão automática)';
end $$;
do $$ begin
 perform pg_temp.ev('p2','PAYMENT_RECEIVED','RECEIVED',current_date-10); reset role;
 if pg_temp.st()<>'active' or not pg_temp.allowed() then raise exception 'FAIL reativação por pagamento'; end if;
 raise notice 'PASS pagamento do atraso reativa o contrato';
end $$;
do $$ begin
 perform pg_temp.ev('r1','PAYMENT_REFUNDED','REFUNDED',current_date-10); reset role;
 if pg_temp.st()<>'past_due' or pg_temp.allowed() then raise exception 'FAIL estorno'; end if;
 raise notice 'PASS estorno volta a past_due e bloqueia após tolerância';
 perform pg_temp.ev('p3','PAYMENT_RECEIVED','RECEIVED',current_date+20); reset role;
 if pg_temp.st()<>'active' or not pg_temp.allowed() then raise exception 'FAIL reativação pós-estorno'; end if;
 raise notice 'PASS cobrança seguinte paga reativa após estorno';
end $$;
do $$ begin
 perform pg_temp.ev('c1','PAYMENT_CHARGEBACK_REQUESTED','CHARGEBACK_REQUESTED',current_date+20); reset role;
 if pg_temp.st()<>'suspended' or pg_temp.allowed() then raise exception 'FAIL chargeback'; end if;
 raise notice 'PASS chargeback suspende imediatamente';
 perform pg_temp.ev('p4','PAYMENT_RECEIVED','RECEIVED',current_date+50); reset role;
 if pg_temp.st()<>'active' or not pg_temp.allowed() then raise exception 'FAIL reativação pós-chargeback'; end if;
 raise notice 'PASS pagamento posterior reativa suspensão por cobrança';
 update public.establishment_subscriptions set status='suspended',payment_due_at=null
  where establishment_id=current_setting('tests.life_est')::uuid;
 perform pg_temp.ev('p5','PAYMENT_RECEIVED','RECEIVED',current_date+80); reset role;
 if pg_temp.st()<>'suspended' then raise exception 'FAIL suspensão administrativa foi revertida'; end if;
 raise notice 'PASS suspensão administrativa não é revertida pelo webhook';
 update public.establishment_subscriptions set status='active' where establishment_id=current_setting('tests.life_est')::uuid;
end $$;
do $$ begin
 set local role service_role;
 perform public.record_asaas_billing_reversal('recon_pay_life_r1_PAYMENT_REFUNDED','sub_life','pay_life_r1','PAYMENT_REFUNDED','REFUNDED',4900,'sandbox',current_date-10);
 perform public.record_asaas_billing_reversal('recon_pay_life_c1_PAYMENT_CHARGEBACK_REQUESTED','sub_life','pay_life_c1','PAYMENT_CHARGEBACK_REQUESTED','CHARGEBACK_REQUESTED',4900,'sandbox',current_date+20);
 perform public.record_asaas_billing_event('recon_pay_life_o1_PAYMENT_OVERDUE_x','sub_life','pay_life_o1','PAYMENT_OVERDUE','OVERDUE',4900,'sandbox',current_date-2);
 reset role;
 if pg_temp.st()<>'active' or not pg_temp.allowed() then raise exception 'FAIL replay de reconciliação regrediu o contrato'; end if;
 raise notice 'PASS replay de reconciliação não regride contrato já reativado';
end $$;
do $$ begin
 perform pg_temp.ev('d1','SUBSCRIPTION_DELETED','DELETED',null); reset role;
 if pg_temp.st()<>'canceled' or pg_temp.allowed() then raise exception 'FAIL cancelamento'; end if;
 raise notice 'PASS cancelamento sem período pago bloqueia';
 update public.establishment_subscriptions set current_period_end=now()+interval '10 days'
  where establishment_id=current_setting('tests.life_est')::uuid;
 if not pg_temp.allowed() then raise exception 'FAIL período pago deveria liberar'; end if;
 raise notice 'PASS cancelado mantém acesso até o fim do período pago';
end $$;
do $$ begin
 if has_function_privilege('authenticated','public.record_asaas_reconciliation_run(text,int,int,int,jsonb)','EXECUTE')
  or has_table_privilege('anon','public.asaas_reconciliation_runs','SELECT') then
  raise exception 'FAIL reconciliação exposta ao cliente'; end if;
 set local role service_role;
 perform public.record_asaas_reconciliation_run('sandbox',1,2,0,'[{"type":"missing_recent_charge"}]'::jsonb);
 reset role;
 if (select count(*) from public.asaas_reconciliation_runs)<>1 then raise exception 'FAIL run não registrada'; end if;
 raise notice 'PASS registro de reconciliação server-only';
end $$;
