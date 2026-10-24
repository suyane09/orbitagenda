-- Aceitacao integrada: barbearia de teste, sem qualquer banco ou pagamento real.
-- Este arquivo roda em um PostgreSQL 17 descartavel criado por tests/run.sh.
\set ON_ERROR_STOP on
set client_min_messages = notice;

create schema tests;
grant usage on schema tests to authenticated;
create function tests.ok(p_condition boolean, p_label text) returns void
language plpgsql as $$
begin
  if p_condition is distinct from true then
    raise exception 'FAIL  %', p_label;
  end if;
  raise notice 'PASS  %', p_label;
end $;
grant execute on function tests.ok(boolean,text) to authenticated;

insert into auth.users (id, email) values
 ('ac000000-0000-0000-0000-000000000001', 'pilot-owner@orbit.invalid'),
 ('ac000000-0000-0000-0000-000000000002', 'pilot-staff@orbit.invalid'),
 ('bc000000-0000-0000-0000-000000000003', 'pilot-other@orbit.invalid');

-- Contratacao e criacao da conta: RPC autenticada, RLS em vigor.
select set_config('request.jwt.claim.sub','ac000000-0000-0000-0000-000000000001', false);
set role authenticated;
select public.create_establishment('Barbearia Piloto Orbit', 'barbershop', null, 'America/Maceio');
reset role;

select set_config('request.jwt.claim.sub','bc000000-0000-0000-0000-000000000003', false);
set role authenticated;
select public.create_establishment('Outra Barbearia', 'barbershop', null, 'America/Maceio');
reset role;

select set_config('tests.pilot', (select id::text from public.establishments where slug='barbearia-piloto-orbit'), false);
select set_config('tests.other', (select id::text from public.establishments where slug='outra-barbearia'), false);
-- Habilitacao apenas da fixture descartavel. Nao simula um pagamento real Asaas.
update public.establishment_subscriptions set status='active',payment_due_at=null
 where establishment_id in (current_setting('tests.pilot')::uuid, current_setting('tests.other')::uuid);
insert into public.memberships(establishment_id,user_id,role)
 values (current_setting('tests.pilot')::uuid,'ac000000-0000-0000-0000-000000000002','staff');

select tests.ok((select count(*) = 2 from public.establishments),
 'duas barbearias criadas isoladamente, sem dados externos');

-- Proprietario configura catalogo e vincula profissional ao servico.
select set_config('request.jwt.claim.sub','ac000000-0000-0000-0000-000000000001',false);
set role authenticated;
insert into public.services(establishment_id,name,duration_minutes,price_cents)
 values (current_setting('tests.pilot')::uuid,'Corte tradicional',30,5000);
reset role;
select set_config('tests.service',(select id::text from public.services where name='Corte tradicional'),false);

set role authenticated;
select public.save_professional(current_setting('tests.pilot')::uuid,null,'Barbeiro Piloto',null,null,true,
 array[current_setting('tests.service')::uuid]);
reset role;
select set_config('tests.professional',(select id::text from public.professionals where name='Barbeiro Piloto'),false);
set role authenticated;
select public.save_weekly_schedule(current_setting('tests.pilot')::uuid, current_setting('tests.professional')::uuid,
 (select jsonb_agg(jsonb_build_object('weekday',d,'start_time','09:00','end_time','18:00'))
    from generate_series(0,6) d));
reset role;
select tests.ok((select count(*) = 7 from public.working_hours
 where professional_id=current_setting('tests.professional')::uuid),
 'proprietario cadastrou profissional, vinculo e expediente semanal');

-- Atendimento agendado pelo funcionario usando RPC real.
select set_config('request.jwt.claim.sub','ac000000-0000-0000-0000-000000000002',false);
set role authenticated;
insert into public.customers(establishment_id,full_name,phone)
 values (current_setting('tests.pilot')::uuid,'Cliente Piloto','82999990000');
reset role;
select set_config('tests.customer',(select id::text from public.customers where full_name='Cliente Piloto'),false);
select set_config('tests.date', ((now() at time zone 'America/Maceio')::date + 3)::text,false);

set role authenticated;
select tests.ok((select exists (
 select 1 from public.get_available_slots(current_setting('tests.pilot')::uuid,
  current_setting('tests.professional')::uuid,current_setting('tests.service')::uuid,
  current_setting('tests.date')::date)
 where slot_start=((current_setting('tests.date')::date + time '10:00') at time zone 'America/Maceio'))),
 'cliente encontra horario livre de corte na agenda');
select set_config('tests.appointment',public.save_appointment(current_setting('tests.pilot')::uuid,null,
 current_setting('tests.customer')::uuid,current_setting('tests.professional')::uuid,
 current_setting('tests.service')::uuid,current_setting('tests.date')::date,time '10:00',null,null)::text,false);
select tests.ok((select count(*) = 1 from public.appointments where id=current_setting('tests.appointment')::uuid
 and status='scheduled' and price_cents=5000),
 'funcionario agendou atendimento com preco e status corretos');
select tests.ok((select not exists (
 select 1 from public.get_available_slots(current_setting('tests.pilot')::uuid,
  current_setting('tests.professional')::uuid,current_setting('tests.service')::uuid,
  current_setting('tests.date')::date)
 where slot_start=((current_setting('tests.date')::date + time '10:00') at time zone 'America/Maceio'))),
 'horario reservado desapareceu da disponibilidade');

do $$ begin
  begin
    perform public.save_appointment(current_setting('tests.pilot')::uuid,null,
     current_setting('tests.customer')::uuid,current_setting('tests.professional')::uuid,
     current_setting('tests.service')::uuid,current_setting('tests.date')::date,time '10:00',null,null);
    raise exception 'FAIL reserva duplicada aceita';
  exception when exclusion_violation then
    raise notice 'PASS  agendamento simultaneo no mesmo horario rejeitado';
  end;
end $$;
select public.set_appointment_status(current_setting('tests.pilot')::uuid,
 current_setting('tests.appointment')::uuid,'confirmed');
reset role;
select tests.ok((select status='confirmed' from public.appointments
 where id=current_setting('tests.appointment')::uuid), 'agendamento confirmado');

-- Outra empresa nao pode acessar a agenda ou clientes da fixture.
select set_config('request.jwt.claim.sub','bc000000-0000-0000-0000-000000000003',false);
set role authenticated;
select tests.ok((select count(*)=0 from public.customers),'outro proprietario nao le clientes do piloto');
select tests.ok((select count(*)=0 from public.appointments),'outro proprietario nao le agenda do piloto');
do $$ begin
 begin
  perform public.list_appointments(current_setting('tests.pilot')::uuid,
   current_setting('tests.date')::date,current_setting('tests.date')::date);
  raise exception 'FAIL acesso cruzado permitido';
 exception when insufficient_privilege then raise notice 'PASS  RPC de agenda nega outra empresa';
 end;
end $$;
reset role;

-- Regra de comissao registrada antes da conclusao.
insert into public.professional_commission_rules
 (establishment_id,professional_id,mode,rate_basis_points)
 values (current_setting('tests.pilot')::uuid,current_setting('tests.professional')::uuid,'percentage',4000);
-- Relogio alterado apenas na linha descartavel para concluir atendimento no passado.
alter table public.appointments disable trigger check_appointment;
update public.appointments
 set starts_at=(((now() at time zone 'America/Maceio')::date - 1 + time '10:00') at time zone 'America/Maceio'),
     ends_at=(((now() at time zone 'America/Maceio')::date - 1 + time '10:30') at time zone 'America/Maceio')
 where id=current_setting('tests.appointment')::uuid;
alter table public.appointments enable trigger check_appointment;
select set_config('request.jwt.claim.sub','ac000000-0000-0000-0000-000000000002',false);
set role authenticated;
select public.set_appointment_status(current_setting('tests.pilot')::uuid,
 current_setting('tests.appointment')::uuid,'completed');
reset role;
select tests.ok((select status='completed' from public.appointments
 where id=current_setting('tests.appointment')::uuid), 'atendimento concluido');
select tests.ok((select count(*)=1 from public.appointment_commission_snapshots
 where appointment_id=current_setting('tests.appointment')::uuid), 'regra de comissao capturada no fechamento');

-- Recebimento, conferencia da comissao e fechamento do caixa.
select set_config('request.jwt.claim.sub','ac000000-0000-0000-0000-000000000001',false);
set role authenticated;
insert into public.financial_entries(establishment_id,appointment_id,kind,description,amount_cents,method,occurred_on)
 values (current_setting('tests.pilot')::uuid,current_setting('tests.appointment')::uuid,
 'income','Corte pago no Pix',5000,'pix',(now() at time zone 'America/Maceio')::date);
select tests.ok((select accrued_cents=2000 from public.appointment_commission_balances
 where appointment_id=current_setting('tests.appointment')::uuid),
 'recebimento de R$ 50 gera comissao de R$ 20 com taxa de 40%');
select tests.ok(public.record_commission_payout(current_setting('tests.pilot')::uuid,
 current_setting('tests.professional')::uuid,1200,'pix',
 (now() at time zone 'America/Maceio')::date,'Repasse parcial') is not null,
 'proprietario registra repasse parcial de R$ 12');
select set_config('tests.closure',public.close_cash_day(current_setting('tests.pilot')::uuid,
 (now() at time zone 'America/Maceio')::date)::text,false);
select tests.ok((select net_cents=5000 and entry_count=1 and status='closed'
 from public.cash_closures where id=current_setting('tests.closure')::uuid),
 'fechamento confere um recebimento e R$ 50 de saldo liquido');
do $$ begin
 begin
  insert into public.financial_entries(establishment_id,kind,description,amount_cents,method,occurred_on)
  values (current_setting('tests.pilot')::uuid,'expense','Depois de fechar caixa',100,'pix',
   (now() at time zone 'America/Maceio')::date);
  raise exception 'FAIL caixa fechado recebeu novo lancamento';
 exception when others then
  if sqlerrm='FAIL caixa fechado recebeu novo lancamento' then raise; end if;
  raise notice 'PASS  caixa fechado bloqueia novos lancamentos';
 end;
end $$;
select public.reopen_cash_day(current_setting('tests.closure')::uuid,'Ajuste de fechamento piloto');
select tests.ok((select status='reopened' from public.cash_closures
 where id=current_setting('tests.closure')::uuid),'reabertura fica registrada e auditavel');
reset role;

select tests.ok((select count(*)=0 from public.financial_entries
 where establishment_id=current_setting('tests.other')::uuid),
 'nenhuma movimentacao financeira foi vinculada a outra empresa');
