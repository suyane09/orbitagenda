\set ON_ERROR_STOP on
set client_min_messages = notice;
insert into auth.users(id,email) values
 ('f8000000-0000-0000-0000-000000000001','asaas.owner@sample.invalid'),
 ('f8000000-0000-0000-0000-000000000002','asaas.other@sample.invalid'),
 ('f8000000-0000-0000-0000-000000000003','asaas.admin@sample.invalid');
insert into public.platform_admins(user_id) values('f8000000-0000-0000-0000-000000000003');
select set_config('request.jwt.claim.sub','f8000000-0000-0000-0000-000000000003',false);
set role authenticated;
select set_config('tests.asaas_plan',public.admin_create_subscription_plan('asaas_test','Asaas Teste',4900,false)::text,false);
reset role;
select set_config('request.jwt.claim.sub','f8000000-0000-0000-0000-000000000001',false);
set role authenticated;
select public.create_establishment('Asaas Empresa');
reset role;
select set_config('tests.asaas_est',(select id::text from public.establishments where slug='asaas-empresa'),false);
select set_config('request.jwt.claim.sub','f8000000-0000-0000-0000-000000000003',false);
set role authenticated;
select public.admin_set_establishment_subscription(
 current_setting('tests.asaas_est')::uuid,
 current_setting('tests.asaas_plan')::uuid,'trialing');
reset role;
-- In production service_role may associate these IDs only after creating at Asaas.
update public.establishment_subscriptions set
 asaas_environment='sandbox',asaas_customer_id='cus_dummy',
 asaas_subscription_id='sub_dummy' where establishment_id=current_setting('tests.asaas_est')::uuid;
do $$ begin
 if has_table_privilege('anon','public.asaas_payment_events','SELECT') then
  raise exception 'FAIL anon can view payment events'; end if;
 if has_table_privilege('authenticated','public.asaas_payment_events','INSERT') then
  raise exception 'FAIL client can forge payment event'; end if;
 if has_function_privilege('authenticated',
   'public.record_asaas_payment_event(text,text,text,text,text,bigint,text)','EXECUTE') then
  raise exception 'FAIL client can mark as paid'; end if;
 raise notice 'PASS webhook tables and RPC are server-only';
end $$;
set role service_role;
do $$ begin
 if not public.record_asaas_payment_event('evt_asaas_one','sub_dummy','pay_dummy',
    'PAYMENT_RECEIVED','RECEIVED',4900,'sandbox') then
  raise exception 'FAIL event not accepted'; end if;
 if public.record_asaas_payment_event('evt_asaas_one','sub_dummy','pay_dummy',
    'PAYMENT_RECEIVED','RECEIVED',4900,'sandbox') then
  raise exception 'FAIL event replay accepted'; end if;
 raise notice 'PASS event idempotence and duplicate protection';
end $$;
reset role;
do $$ begin
 if (select status from public.establishment_subscriptions
   where establishment_id=current_setting('tests.asaas_est')::uuid) <> 'active' then
    raise exception 'FAIL paid event not applied'; end if;
 if (select count(*) from public.asaas_payment_events)<>1 then
    raise exception 'FAIL duplicate payment event'; end if;
 raise notice 'PASS received webhook activates only corresponding contract';
end $$;

-- Estornos, chargebacks e cancelamento
set role service_role;
do $$ begin
 if not public.record_asaas_billing_event('evt_paid_1','sub_dummy','pay_r1','PAYMENT_RECEIVED','RECEIVED',4900,'sandbox','2026-11-10') then
  raise exception 'FAIL paid event'; end if;
 if not public.record_asaas_billing_reversal('evt_ref_1','sub_dummy','pay_r1','PAYMENT_REFUNDED','REFUNDED',4900,'sandbox','2026-11-10') then
  raise exception 'FAIL refund not accepted'; end if;
 if public.record_asaas_billing_reversal('evt_ref_1','sub_dummy','pay_r1','PAYMENT_REFUNDED','REFUNDED',4900,'sandbox','2026-11-10') then
  raise exception 'FAIL refund replay accepted'; end if;
end $$;
reset role;
do $$ begin
 if (select status from public.establishment_subscriptions where establishment_id=current_setting('tests.asaas_est')::uuid)<>'past_due'
   then raise exception 'FAIL refund must move to past_due'; end if;
 raise notice 'PASS refund reverts access to past_due with grace';
end $$;
set role service_role;
do $$ begin
 perform public.record_asaas_billing_event('evt_paid_2','sub_dummy','pay_r2','PAYMENT_RECEIVED','RECEIVED',4900,'sandbox','2026-12-10');
 perform public.record_asaas_billing_reversal('evt_ref_old','sub_dummy','pay_r1','PAYMENT_REFUNDED','REFUNDED',4900,'sandbox','2026-11-10');
end $$;
reset role;
do $$ begin
 if (select status from public.establishment_subscriptions where establishment_id=current_setting('tests.asaas_est')::uuid)<>'active'
   then raise exception 'FAIL old refund reverted newer paid invoice'; end if;
 raise notice 'PASS delayed refund of older invoice ignored';
end $$;
set role service_role;
do $$ begin
 perform public.record_asaas_billing_reversal('evt_cb_1','sub_dummy','pay_r2','PAYMENT_CHARGEBACK_REQUESTED','CHARGEBACK_REQUESTED',4900,'sandbox','2026-12-10');
end $$;
reset role;
do $$ begin
 if (select status from public.establishment_subscriptions where establishment_id=current_setting('tests.asaas_est')::uuid)<>'suspended'
   then raise exception 'FAIL chargeback must suspend'; end if;
 raise notice 'PASS chargeback suspends';
end $$;
set role service_role;
do $$ begin
 perform public.record_asaas_billing_reversal('evt_sub_del','sub_dummy','sub_dummy','SUBSCRIPTION_DELETED','DELETED',0,'sandbox',null);
end $$;
reset role;
do $$ begin
 if (select status from public.establishment_subscriptions where establishment_id=current_setting('tests.asaas_est')::uuid)<>'canceled'
   then raise exception 'FAIL subscription deletion must cancel'; end if;
 if has_function_privilege('authenticated','public.record_asaas_billing_reversal(text,text,text,text,text,bigint,text,date)','EXECUTE')
   then raise exception 'FAIL client can reverse payments'; end if;
 raise notice 'PASS cancellation and server-only reversal RPC';
end $$;
