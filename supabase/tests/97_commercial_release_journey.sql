\set ON_ERROR_STOP on
set client_min_messages = notice;

-- Disposable PostgreSQL 17 only. Never run this fixture on live customer data.
-- The CI harness creates a fresh database per test file.
insert into auth.users(id,email) values
('ee000000-0000-0000-0000-000000000001','commercial.a@test.invalid'),
('ee000000-0000-0000-0000-000000000002','commercial.b@test.invalid'),
('ee000000-0000-0000-0000-000000000003','commercial.admin@test.invalid');
insert into public.platform_admins(user_id)
values('ee000000-0000-0000-0000-000000000003');

select set_config('request.jwt.claim.sub','ee000000-0000-0000-0000-000000000001',false);
set role authenticated;
select public.create_establishment('Commercial QA Alpha');
reset role;
select set_config('test.alpha',
 (select id::text from public.establishments where slug='commercial-qa-alpha'),false);

select set_config('request.jwt.claim.sub','ee000000-0000-0000-0000-000000000002',false);
set role authenticated;
select public.create_establishment('Commercial QA Beta');
reset role;
select set_config('test.beta',
 (select id::text from public.establishments where slug='commercial-qa-beta'),false);

do $assert_initial$
begin
 if (select count(*) from public.establishment_subscriptions
     where establishment_id in (current_setting('test.alpha')::uuid,
       current_setting('test.beta')::uuid)
       and status='past_due')<>2 then
   raise exception 'FAIL new tenants must require explicit subscription activation';
 end if;
 if private.billing_allows_write(current_setting('test.alpha')::uuid)
    or private.billing_allows_write(current_setting('test.beta')::uuid) then
   raise exception 'FAIL unpaid tenant write access';
 end if;
 raise notice 'PASS two new owners are subscription-pending, write gated';
end $assert_initial$;

set role authenticated;
select set_config('request.jwt.claim.sub','ee000000-0000-0000-0000-000000000002',false);
do $deny$
begin
 if exists(select 1 from public.establishments
   where id=current_setting('test.alpha')::uuid) then
   raise exception 'FAIL owner B reads owner A';
 end if;
 if exists(select 1 from public.establishment_subscriptions
   where establishment_id=current_setting('test.alpha')::uuid) then
   raise exception 'FAIL owner B reads owner A subscription';
 end if;
 begin
   perform public.admin_set_establishment_subscription(
    current_setting('test.alpha')::uuid,
    (select id from public.subscription_plans where code='inicial_4990'),
    'active',now()+interval '30 days','test-only');
   raise exception 'FAIL owner B can activate owner A';
 exception when insufficient_privilege then
   raise notice 'PASS non-admin activation rejected';
 end;
 raise notice 'PASS company and subscription RLS prevent cross-tenant reads';
end $deny$;
reset role;

select set_config('request.jwt.claim.sub','ee000000-0000-0000-0000-000000000003',false);
set role authenticated;
select public.admin_set_establishment_subscription(
  current_setting('test.alpha')::uuid,
  (select id from public.subscription_plans where code='inicial_4990'),
  'active',now()+interval '30 days',
  'CI simulation only; not proof of payment');
reset role;

do $assert_after$
begin
 if not private.billing_allows_write(current_setting('test.alpha')::uuid) then
   raise exception 'FAIL manual admin activation did not enable selected tenant';
 end if;
 if private.billing_allows_write(current_setting('test.beta')::uuid) then
   raise exception 'FAIL manual admin activation enabled unrelated tenant';
 end if;
 if (select count(*) from public.establishment_subscriptions
  where establishment_id=current_setting('test.beta')::uuid
   and status='past_due')<>1 then
   raise exception 'FAIL other tenant subscription changed';
 end if;
 raise notice 'PASS superadmin activates only selected company';
end $assert_after$;

-- Verify that unauthorized accounts cannot call an otherwise sensitive RPC.
select set_config('request.jwt.claim.sub','ee000000-0000-0000-0000-000000000001',false);
set role authenticated;
do $deny_platform$
begin
 if public.is_platform_admin() then
   raise exception 'FAIL owner A gained platform role';
 end if;
 begin
   perform public.whatsapp_begin_pairing(current_setting('test.beta')::uuid);
   raise exception 'FAIL owner A paired owner B phone';
 exception when insufficient_privilege then
   raise notice 'PASS WhatsApp setup restricted to owner';
 end;
 raise notice 'PASS normal owner cannot become platform admin';
end $deny_platform$;
reset role;

do $verify_no_sideeffects$
begin
 if (select count(*) from public.whatsapp_outbox)<>0 then
  raise exception 'FAIL unsolicited WhatsApp notifications';
 end if;
 raise notice 'PASS no WhatsApp send without explicit booking consent';
end $verify_no_sideeffects$;
