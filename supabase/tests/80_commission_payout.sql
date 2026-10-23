\set ON_ERROR_STOP on
set client_min_messages = notice;

insert into auth.users(id, email) values
 ('a1000000-0000-0000-0000-000000000001','owner@test.invalid'),
 ('b1000000-0000-0000-0000-000000000001','other@test.invalid');

-- Base mínima: os mesmos objetos usados pela interface real.
select set_config('request.jwt.claim.sub','a1000000-0000-0000-0000-000000000001',false);
set role authenticated;
select public.create_establishment('Comissao Teste A', 'barbershop');
reset role;
select set_config('tests.est', (select id::text from public.establishments where slug='comissao-teste-a'), false);

insert into public.professionals(id,establishment_id,name)
 values ('e1000000-0000-0000-0000-000000000001',current_setting('tests.est')::uuid,'Barbeiro teste');
insert into public.professional_commission_rules(establishment_id,professional_id,mode,rate_basis_points)
 values (current_setting('tests.est')::uuid,'e1000000-0000-0000-0000-000000000001','percentage',4000);
insert into public.services(id,establishment_id,name,duration_minutes,price_cents)
 values ('e2000000-0000-0000-0000-000000000001',current_setting('tests.est')::uuid,'Corte teste',30,10000);
insert into public.customers(id,establishment_id,full_name,phone)
 values ('e3000000-0000-0000-0000-000000000001',current_setting('tests.est')::uuid,'Cliente teste','79999990000');
insert into public.professional_services(establishment_id,professional_id,service_id)
 values (current_setting('tests.est')::uuid,'e1000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000001');
insert into public.working_hours(establishment_id,professional_id,weekday,start_time,end_time)
 select current_setting('tests.est')::uuid,'e1000000-0000-0000-0000-000000000001',weekday,'09:00'::time,'18:00'::time
 from generate_series(0,6) weekday;
insert into public.appointments(id,establishment_id,professional_id,service_id,customer_id,starts_at,ends_at,status,price_cents)
 values ('e4000000-0000-0000-0000-000000000001',current_setting('tests.est')::uuid,
 'e1000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000001',
 'e3000000-0000-0000-0000-000000000001',
 ((current_date + 3)::timestamp + interval '10 hours') at time zone 'America/Maceio',
 ((current_date + 3)::timestamp + interval '10 hours 30 minutes') at time zone 'America/Maceio',
 'scheduled',10000);
-- Volta o relógio APENAS da fixture no banco descartável (sem alterar o relógio do servidor).\n-- O agendamento precisou ser criado no futuro, por validação de data;\n-- em seguida, backdate controlado para testar a conclusão após o horário.\nalter table public.appointments disable trigger check_appointment;\nupdate public.appointments set starts_at=(current_date::timestamp + interval '10 hours') at time zone 'America/Maceio',\n ends_at=(current_date::timestamp + interval '10 hours 30 minutes') at time zone 'America/Maceio'\n where id='e4000000-0000-0000-0000-000000000001';\nalter table public.appointments enable trigger check_appointment;\n-- A conclusão captura a regra vigente.
update public.appointments set status='completed' where id='e4000000-0000-0000-0000-000000000001';
do $$ begin
 if (select count(*) from public.appointment_commission_snapshots) <> 1 then raise exception 'FAIL snapshot'; end if;
 raise notice 'PASS snapshot';
end $$;
-- Crédito parcial: R$ 25 -> comissão R$ 10.
insert into public.financial_entries(establishment_id,appointment_id,kind,description,amount_cents,method,occurred_on,created_by)
 values (current_setting('tests.est')::uuid,'e4000000-0000-0000-0000-000000000001','income','Recebimento teste',2500,'pix',current_date,'a1000000-0000-0000-0000-000000000001');
do $$ begin
 if (select accrued_cents from public.appointment_commission_balances) <> 1000 then raise exception 'FAIL comissão parcial'; end if;
 raise notice 'PASS comissão parcial';
end $$;
-- Sem funcionário sem login: função com proprietário autenticado.
set role authenticated;
do $$ declare v_id uuid; begin
 v_id := public.record_commission_payout(current_setting('tests.est')::uuid,
 'e1000000-0000-0000-0000-000000000001',700,'pix',current_date,'Repasse parcial');
 if v_id is null then raise exception 'FAIL payout'; end if;
 raise notice 'PASS payout R$ 7';
end $$;
do $$ begin
 begin
  perform public.record_commission_payout(current_setting('tests.est')::uuid,
   'e1000000-0000-0000-0000-000000000001',400,'pix',current_date,'Ultrapassa');
  raise exception 'FAIL excesso aceito';
 exception when sqlstate '22023' then raise notice 'PASS excesso bloqueado'; end;
end $$;
reset role;
-- Simula usuário autenticado de outra conta e assegura que não pode registrar repasses.
select set_config('request.jwt.claim.sub','b1000000-0000-0000-0000-000000000001',false);
set role authenticated;
do $$ begin
 begin
  perform public.record_commission_payout(current_setting('tests.est')::uuid,
   'e1000000-0000-0000-0000-000000000001',100,'pix',current_date,'Tentativa');
  raise exception 'FAIL dono externo aceito';
 exception when insufficient_privilege then raise notice 'PASS isolamento de dono'; end;
end $$;
reset role;
