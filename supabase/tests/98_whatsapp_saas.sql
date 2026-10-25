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

-- Fixtures for real confirmation/reminder/cancellation queueing (no network sends).
insert into public.professionals (id,establishment_id,name) values
 ('d8000000-0000-0000-0000-000000000010',current_setting('test.wa.est')::uuid,'Profissional Piloto');
insert into public.services (id,establishment_id,name,duration_minutes,price_cents) values
 ('d8000000-0000-0000-0000-000000000011',current_setting('test.wa.est')::uuid,'Corte Piloto',30,5000);
insert into public.customers (id,establishment_id,full_name,phone) values
 ('d8000000-0000-0000-0000-000000000012',current_setting('test.wa.est')::uuid,'Cliente Consentido','82999998888');
set session_replication_role=replica;
insert into public.appointments (id,establishment_id,professional_id,service_id,customer_id,
 starts_at,ends_at,price_cents,status) values
 ('d8000000-0000-0000-0000-000000000013',current_setting('test.wa.est')::uuid,
 'd8000000-0000-0000-0000-000000000010',
 'd8000000-0000-0000-0000-000000000011',
 'd8000000-0000-0000-0000-000000000012',
 now()+interval '5 days',now()+interval '5 days 30 minutes',5000,'scheduled');
set session_replication_role=origin;
do $$begin
 if (select count(*) from public.whatsapp_outbox)<>0 then
   raise exception 'FAIL sent or queued before consent';end if;
 raise notice 'PASS no queue without consent';
end $$;

set role service_role;
insert into public.whatsapp_appointment_consents(appointment_id,establishment_id)
values('d8000000-0000-0000-0000-000000000013',current_setting('test.wa.est')::uuid);
reset role;
do $$begin
 if (select count(*) from public.whatsapp_outbox where state='queued')<>2 then
   raise exception 'FAIL consent did not queue confirmation plus reminder';end if;
 if (select count(distinct dedupe_key) from public.whatsapp_outbox)<>2 then
   raise exception 'FAIL queue dedupe';end if;
 raise notice 'PASS consent queues confirmation and reminder, no duplicate events';
end $$;

-- A cancellation cancels pending confirmations/reminders and creates its own notice.
update public.appointments set status='cancelled'
where id='d8000000-0000-0000-0000-000000000013';
do $$begin
 if (select count(*) from public.whatsapp_outbox where state='cancelled')<>2 then
   raise exception 'FAIL cancellation left old messages queued';end if;
 if (select count(*) from public.whatsapp_outbox where state='queued' and kind='cancellation')<>1 then
   raise exception 'FAIL no cancellation notice queued';end if;
 raise notice 'PASS cancellation invalidates earlier pending messages';
end $$;

set role service_role;
select set_config('test.wa.job',
 (public.whatsapp_worker_poll(current_setting('test.wa.token'))->>'id'),false);
do $$begin
 if current_setting('test.wa.job',true) is null then
   raise exception 'FAIL worker poll missed queued cancellation';end if;
end $$;
select public.whatsapp_worker_finish(current_setting('test.wa.token'),
 current_setting('test.wa.job')::uuid,true,'mock-provider-accepted',null);
reset role;
do $$begin
 if (select count(*) from public.whatsapp_outbox where state='accepted')<>1 then
   raise exception 'FAIL job state not accepted';end if;
 raise notice 'PASS token-scoped worker claims and confirms one message';
end $$;
