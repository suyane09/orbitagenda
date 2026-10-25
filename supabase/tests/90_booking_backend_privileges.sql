\set ON_ERROR_STOP on
set client_min_messages = notice;

-- Regression from 25/10/2026: the public-booking Edge returned HTTP 500
-- because service_role could not access the private billing guard.
insert into auth.users(id,email) values
('aa000000-0000-0000-0000-000000000090','booking.guard@test.invalid');

select set_config('request.jwt.claim.sub','aa000000-0000-0000-0000-000000000090',false);
set role authenticated;
select public.create_establishment('Booking Guard QA');
reset role;

select set_config('test.est',
  (select id::text from public.establishments where slug='booking-guard-qa'),false);
update public.establishment_subscriptions set status='active',current_period_end=null
 where establishment_id=current_setting('test.est')::uuid;

do $$
begin
 if has_schema_privilege('anon','private','USAGE') then
   raise exception 'FAIL private schema opened to anon';
 end if;
 if has_function_privilege('anon','private.billing_allows_write(uuid)','EXECUTE') then
   raise exception 'FAIL billing guard callable by anon';
 end if;
 if not has_schema_privilege('service_role','private','USAGE') then
   raise exception 'FAIL service_role schema usage missing';
 end if;
 if not has_function_privilege('service_role','private.billing_allows_write(uuid)','EXECUTE') then
   raise exception 'FAIL service_role guard execute missing';
 end if;
 raise notice 'PASS minimal private guard access granted only to backend service role';
end $$;

-- The minimal CI shim creates service_role without normal Supabase cloud table grants.
-- Mirror ONLY the services SELECT privilege present on the live hosted instance.
grant select on public.services to service_role;
set role service_role;
do $
declare
  v_est uuid := current_setting('test.est')::uuid;
begin
 if not private.billing_allows_write(v_est) then
    raise exception 'FAIL active subscription unexpectedly blocked';
 end if;
 begin
   perform public.create_public_booking(
      'booking-guard-qa',
      'aa000000-0000-0000-0000-000000000091',
      'aa000000-0000-0000-0000-000000000092',
      current_date+7, '14:00'::time,'Cliente de Teste','82999990000'
   );
   raise exception 'FAIL unavailable service should be rejected';
 exception when sqlstate 'P0002' then
   raise notice 'PASS booking passed billing guard and correctly rejected missing service';
 end;
end $$;
reset role;
