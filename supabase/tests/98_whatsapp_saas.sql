\set ON_ERROR_STOP on
set client_min_messages=notice;
insert into auth.users(id,email) values
('d8000000-0000-0000-0000-000000000001','wa.owner@test.invalid'),
('d8000000-0000-0000-0000-000000000002','wa.other@test.invalid');

select set_config('request.jwt.claim.sub','d8000000-0000-0000-0000-000000000001',false);
set role authenticated;
select public.create_establishment('Whatsapp QA Local');
reset role;
select set_config('test.wa.est',(select id::text from public.establishments where slug='whatsapp-qa-local'),false);

select set_config('request.jwt.claim.sub','d8000000-0000-0000-0000-000000000002',false);
set role authenticated;
do $$ begin
 begin
   perform public.whatsapp_begin_pairing(current_setting('test.wa.est')::uuid);
   raise exception 'FAIL other user paired company WhatsApp';
 exception when insufficient_privilege then raise notice 'PASS only owner may begin pairing'; end;
 if (select count(*) from public.whatsapp_connections)<>0
   then raise exception 'FAIL unrelated user sees connection';end if;
 raise notice 'PASS WhatsApp RLS blocks unrelated user';
end $$;
reset role;

select set_config('request.jwt.claim.sub','d8000000-0000-0000-0000-000000000001',false);
set role authenticated;
select set_config('test.wa.code',public.whatsapp_begin_pairing(current_setting('test.wa.est')::uuid),false);
do $$begin
 if length(current_setting('test.wa.code'))<>64 then
   raise exception 'FAIL pairing-code length';end if;
 if (select enabled from public.whatsapp_connections where establishment_id=current_setting('test.wa.est')::uuid) then
   raise exception 'FAIL auto-send enabled by default';end if;
 raise notice 'PASS pairing code generated, sends disabled by default';
end $$;
reset role;

-- Simulate the server-side Edge bridge only; never grant anon direct RPC access.
set role service_role;
select set_config('test.wa.token',
  (public.whatsapp_worker_pair(current_setting('test.wa.code')) ->> 'token'),false);
do $$begin
 if length(current_setting('test.wa.token'))<>64 then raise exception 'FAIL worker token';end if;
 begin
   perform public.whatsapp_worker_pair(current_setting('test.wa.code'));
   raise exception 'FAIL pairing code can be reused';
 exception when insufficient_privilege then
   raise notice 'PASS pairing code is single use';end;
 begin
   perform public.whatsapp_worker_poll(repeat('0',64));
   raise exception 'FAIL bogus worker token accepted';
 exception when insufficient_privilege then
   raise notice 'PASS invalid worker token rejected';end;
end $$;
select public.whatsapp_worker_report(current_setting('test.wa.token'),'connected');
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub','d8000000-0000-0000-0000-000000000002',false);
do $$begin
 if (select count(*) from public.whatsapp_connections)<>0
   then raise exception 'FAIL other user saw paired WhatsApp';end if;
 begin
   perform public.whatsapp_set_enabled(current_setting('test.wa.est')::uuid,true);
   raise exception 'FAIL other user enabled WhatsApp';
 exception when insufficient_privilege then
   raise notice 'PASS other user cannot activate';end;
end $$;
reset role;

select set_config('request.jwt.claim.sub','d8000000-0000-0000-0000-000000000001',false);
set role authenticated;
select public.whatsapp_set_enabled(current_setting('test.wa.est')::uuid,true);
do $$begin
 if not (select enabled from public.whatsapp_connections where establishment_id=current_setting('test.wa.est')::uuid) then
   raise exception 'FAIL owner enabling sends';end if;
 if (select count(*) from public.whatsapp_outbox)<>0 then
   raise exception 'FAIL unsolicited outbound messages';end if;
 raise notice 'PASS owner may enable only connected worker; no unsolicited sends';
end $$;
reset role;

do $begin
 if has_function_privilege('anon','public.whatsapp_worker_pair(text)','EXECUTE') or
    has_function_privilege('anon','public.whatsapp_worker_poll(text)','EXECUTE') then
   raise exception 'FAIL anonymous worker RPC allowed';end if;
 if has_table_privilege('anon','public.whatsapp_outbox','SELECT') or
    has_table_privilege('authenticated','public.whatsapp_outbox','UPDATE') or
    has_table_privilege('anon','private.whatsapp_worker_auth','SELECT') then
   raise exception 'FAIL direct access to private queue or credentials';end if;
 raise notice 'PASS queue and worker credentials protected';
end $$;
