\set ON_ERROR_STOP on
set client_min_messages=notice;

insert into auth.users(id,email) values
('e3000000-0000-0000-0000-000000000001','cloud-owner@test.invalid'),
('e3000000-0000-0000-0000-000000000002','cloud-stranger@test.invalid');
select set_config('request.jwt.claim.sub','e3000000-0000-0000-0000-000000000001',false);
set role authenticated;
select public.create_establishment('WhatsApp Mobile QA');
reset role;
select set_config('test.est',(select id::text from public.establishments where slug='whatsapp-mobile-qa'),false);

do $$ begin
 if has_function_privilege('anon','public.whatsapp_cloud_list()','EXECUTE') or
    has_function_privilege('anon','public.whatsapp_cloud_claim()','EXECUTE') or
    has_function_privilege('authenticated','public.whatsapp_cloud_finish(uuid,uuid,boolean,text,text)','EXECUTE') then
   raise exception 'FAIL cloud backend exposed to clients';
 end if;
 raise notice 'PASS cloud worker functions are service-only';
end $$;

select set_config('request.jwt.claim.sub','e3000000-0000-0000-0000-000000000002',false);
set role authenticated;
do $$ begin
 begin
  perform public.whatsapp_cloud_request(current_setting('test.est')::uuid,'82999998888');
  raise exception 'FAIL nonowner initiated cloud WhatsApp';
 exception when insufficient_privilege then
  raise notice 'PASS stranger cannot initiate another owner connection';
 end;
end $$;
reset role;

select set_config('request.jwt.claim.sub','e3000000-0000-0000-0000-000000000001',false);
set role authenticated;
do $$ begin
 begin
   perform public.whatsapp_cloud_request(current_setting('test.est')::uuid,'not-a-phone');
   raise exception 'FAIL invalid phone accepted';
 exception when invalid_parameter_value then
   raise notice 'PASS phone input validation';
 end;
 perform public.whatsapp_cloud_request(current_setting('test.est')::uuid,'(82) 99999-8888');
end $$;
reset role;

do $$ declare v record;
begin
 select * into v from public.whatsapp_connections where establishment_id=current_setting('test.est')::uuid;
 if v.backend<>'cloud' or v.phone_e164<>'5582999998888'
   or v.enabled or v.state<>'pending' then
    raise exception 'FAIL expected cloud pending opt-out state';
 end if;
 if (select count(*) from public.whatsapp_outbox where establishment_id=v.establishment_id)<>0 then
    raise exception 'FAIL unsolicited message was queued';
 end if;
 raise notice 'PASS mobile setup requests new cloud instance without messages or automatic activation';
end $$;

set role service_role;
do $$ declare r record;
begin
 select * into r from public.whatsapp_cloud_list()
 where establishment_id=current_setting('test.est')::uuid;
 if not found then raise exception 'FAIL cloud worker could not list connection'; end if;
 perform public.whatsapp_cloud_report(
  r.establishment_id,r.instance_name,'connecting',null,'ABCD1234');
 if (select phone_pair_code from public.whatsapp_connections
     where establishment_id=r.establishment_id)<>'ABCD1234' then
    raise exception 'FAIL pairing code not shown to owner';end if;
 if (public.whatsapp_cloud_claim()->>'action')<>'idle' then
    raise exception 'FAIL outbound job claimed without consent'; end if;
 perform public.whatsapp_cloud_report(r.establishment_id,r.instance_name,'connected');
end $$;
reset role;

select set_config('request.jwt.claim.sub','e3000000-0000-0000-0000-000000000002',false);
set role authenticated;
do $$ begin
 if exists(select 1 from public.whatsapp_connections where establishment_id=current_setting('test.est')::uuid) then
   raise exception 'FAIL cloud connection leaked to another tenant';
 end if;
 raise notice 'PASS RLS isolates mobile WhatsApp status and temporary pairing code';
end $$;
reset role;
