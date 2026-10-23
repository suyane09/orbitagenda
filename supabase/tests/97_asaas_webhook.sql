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
