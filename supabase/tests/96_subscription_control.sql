\set ON_ERROR_STOP on
set client_min_messages = notice;
insert into auth.users (id,email) values
('f9000000-0000-0000-0000-000000000001','subscription.owner@test.invalid'),
('f9000000-0000-0000-0000-000000000002','subscription.other@test.invalid'),
('f9000000-0000-0000-0000-000000000003','subscription.admin@test.invalid');
insert into public.platform_admins(user_id) values ('f9000000-0000-0000-0000-000000000003');
select set_config('request.jwt.claim.sub','f9000000-0000-0000-0000-000000000001',false);
set role authenticated;
select public.create_establishment('Assinatura Teste');
reset role;
select set_config('tests.subscription_est',(select id::text from public.establishments where slug='assinatura-teste'),false);
select set_config('request.jwt.claim.sub','f9000000-0000-0000-0000-000000000001',false);
set role authenticated;
do $$ begin
  begin
    perform public.admin_create_subscription_plan('gold','Gold',9900,true);
    raise exception 'FAIL owner created admin plan';
  exception when insufficient_privilege then raise notice 'PASS owner cannot create plan'; end;
  begin
    perform public.admin_set_establishment_subscription(
      current_setting('tests.subscription_est')::uuid,
      (select id from public.subscription_plans where code='piloto'),'active');
    raise exception 'FAIL owner changed own subscription';
  exception when insufficient_privilege then raise notice 'PASS owner cannot change subscription'; end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','f9000000-0000-0000-0000-000000000003',false);
set role authenticated;
select set_config('tests.plan',public.admin_create_subscription_plan('gold','Gold',9900,true)::text,false);
select public.admin_set_establishment_subscription(current_setting('tests.subscription_est')::uuid,current_setting('tests.plan')::uuid,'trialing');
do $$ begin
 if (select count(*) from public.establishment_subscriptions where status='trialing')<>1 then
  raise exception 'FAIL admin subscription';
 end if;
 raise notice 'PASS admin created subscription';
end $$;
reset role;
select set_config('request.jwt.claim.sub','f9000000-0000-0000-0000-000000000001',false);
set role authenticated;
do $$ begin
 if (select count(*) from public.establishment_subscriptions where establishment_id=current_setting('tests.subscription_est')::uuid)<>1 then raise exception 'FAIL owner subscription read'; end if;
 raise notice 'PASS owner sees own subscription';
end $$;
reset role;
select set_config('request.jwt.claim.sub','f9000000-0000-0000-0000-000000000002',false);
set role authenticated;
do $$ begin
 if (select count(*) from public.establishment_subscriptions)<>0 then raise exception 'FAIL other sees subscription'; end if;
 raise notice 'PASS unrelated tenant cannot read subscription';
end $$;
reset role;
do $$ begin
 if has_table_privilege('authenticated','public.establishment_subscriptions','UPDATE') then raise exception 'FAIL client subscription update'; end if;
 if has_function_privilege('anon','public.admin_set_establishment_subscription(uuid,uuid,text,timestamptz,text)','EXECUTE') then raise exception 'FAIL anon admin RPC'; end if;
 raise notice 'PASS no direct mutation grants and no anon admin RPC';
end $$;
