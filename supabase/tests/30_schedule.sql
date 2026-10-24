-- Etapa 2 · Horários — expediente, intervalos, bloqueios, fuso e RLS (banco real, RLS ativo).
\set ON_ERROR_STOP on
set client_min_messages = notice;

create schema tests;
grant usage on schema tests to anon, authenticated;
create function tests.login_as(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), false);
  execute 'set role authenticated';
end $$;
create function tests.login_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'set role anon';
end $$;
create function tests.pass(label text) returns void language plpgsql as $$
begin raise notice 'PASS  %', label; end $$;
create function tests.expect_true(q text, label text) returns void language plpgsql as $$
declare ok boolean;
begin
  execute 'select (' || q || ')' into ok;
  if ok is not true then raise exception 'FAIL  % (condição falsa)', label; end if;
  perform tests.pass(label);
end $$;
create function tests.expect_error(q text, expected_state text, label text) returns void language plpgsql as $$
begin
  begin
    execute q;
  exception when others then
    if sqlstate = expected_state then perform tests.pass(label); return; end if;
    raise exception 'FAIL  % (esperado SQLSTATE %, obtido % : %)', label, expected_state, sqlstate, sqlerrm;
  end;
  raise exception 'FAIL  % (nenhum erro; esperado SQLSTATE %)', label, expected_state;
end $$;
create function tests.expect_affected(q text, expected int, label text) returns void language plpgsql as $$
declare n int;
begin
  execute q;
  get diagnostics n = row_count;
  if n <> expected then raise exception 'FAIL  % (linhas afetadas esperado %, obtido %)', label, expected, n; end if;
  perform tests.pass(label);
end $$;

insert into auth.users (id, email, raw_user_meta_data) values
 ('a1000000-0000-0000-0000-000000000001', 'dono@alfa.test',  '{"full_name":"Dono Alfa"}'),
 ('a2000000-0000-0000-0000-000000000002', 'staff@alfa.test', '{"full_name":"Staff Alfa"}'),
 ('b1000000-0000-0000-0000-000000000001', 'dono@bravo.test', '{"full_name":"Dono Bravo"}');
select set_config('tests.o_a', 'a1000000-0000-0000-0000-000000000001', false);
select set_config('tests.s_a', 'a2000000-0000-0000-0000-000000000002', false);
select set_config('tests.o_b', 'b1000000-0000-0000-0000-000000000001', false);

select tests.login_as(current_setting('tests.o_a')::uuid);
select public.create_establishment('Alfa Barbearia', 'barbershop', null, 'America/Manaus');  -- UTC-4
reset role;
select tests.login_as(current_setting('tests.o_b')::uuid);
select public.create_establishment('Bravo Salão', 'salon');
reset role;
select set_config('tests.est_a', (select id::text from public.establishments where slug = 'alfa-barbearia'), false);
select set_config('tests.est_b', (select id::text from public.establishments where slug = 'bravo-salao'), false);
-- Fixture: assinatura paga somente no banco descartável; não libera contas reais.
update public.establishment_subscriptions set status='active', payment_due_at=null
 where establishment_id in (current_setting('tests.est_a')::uuid,current_setting('tests.est_b')::uuid);
insert into public.memberships (establishment_id, user_id, role)
values (current_setting('tests.est_a')::uuid, current_setting('tests.s_a')::uuid, 'staff');

select tests.login_as(current_setting('tests.o_a')::uuid);
select public.save_professional(current_setting('tests.est_a')::uuid, null, 'João', null, null, true, '{}');
select public.save_professional(current_setting('tests.est_a')::uuid, null, 'Pedro', null, null, true, '{}');
reset role;
select tests.login_as(current_setting('tests.o_b')::uuid);
select public.save_professional(current_setting('tests.est_b')::uuid, null, 'Maria', null, null, true, '{}');
reset role;
select set_config('tests.joao',  (select id::text from public.professionals where name = 'João'), false);
select set_config('tests.pedro', (select id::text from public.professionals where name = 'Pedro'), false);
select set_config('tests.maria', (select id::text from public.professionals where name = 'Maria'), false);

\warn '== Expediente semanal =='
select tests.login_as(current_setting('tests.o_a')::uuid);
select tests.expect_true($$(public.save_weekly_schedule(current_setting('tests.est_a')::uuid, current_setting('tests.joao')::uuid,
  '[{"weekday":1,"start_time":"09:00","end_time":"12:00"},{"weekday":1,"start_time":"13:00","end_time":"18:00"},
    {"weekday":2,"start_time":"09:00","end_time":"18:00"}]'::jsonb) ->> 'segments')::int = 3$$,
  'owner salva expediente com intervalo (dois trechos no mesmo dia)');
select tests.expect_true($$(select count(*) from public.working_hours where professional_id = current_setting('tests.joao')::uuid) = 3$$, 'três trechos gravados');

select public.save_weekly_schedule(current_setting('tests.est_a')::uuid, current_setting('tests.joao')::uuid,
  '[{"weekday":3,"start_time":"08:00","end_time":"12:00"}]'::jsonb);
select tests.expect_true($$(select count(*) = 1 and min(weekday) = 3 from public.working_hours where professional_id = current_setting('tests.joao')::uuid)$$,
  'salvar de novo substitui todo o expediente');
select public.save_weekly_schedule(current_setting('tests.est_a')::uuid, current_setting('tests.joao')::uuid, '[]'::jsonb);
select tests.expect_true($$(select count(*) from public.working_hours) = 0$$, 'lista vazia = sem expediente');

select tests.expect_error($$select public.save_weekly_schedule(current_setting('tests.est_a')::uuid, current_setting('tests.joao')::uuid,
  '[{"weekday":1,"start_time":"09:00","end_time":"12:00"},{"weekday":1,"start_time":"11:00","end_time":"14:00"}]'::jsonb)$$,
  '23P01', 'trechos sobrepostos no mesmo dia são rejeitados');
select tests.expect_true($$(select count(*) from public.working_hours) = 0$$, 'falha desfaz tudo (atomicidade)');
select tests.expect_true($$public.save_weekly_schedule(current_setting('tests.est_a')::uuid, current_setting('tests.joao')::uuid,
  '[{"weekday":1,"start_time":"09:00","end_time":"12:00"},{"weekday":1,"start_time":"12:00","end_time":"14:00"}]'::jsonb) is not null$$,
  'trechos encostados (12:00) são permitidos');
select tests.expect_error($$select public.save_weekly_schedule(current_setting('tests.est_a')::uuid, current_setting('tests.joao')::uuid,
  '[{"weekday":1,"start_time":"12:00","end_time":"09:00"}]'::jsonb)$$, '23514', 'fim antes do início é rejeitado');
select tests.expect_error($$select public.save_weekly_schedule(current_setting('tests.est_a')::uuid, current_setting('tests.joao')::uuid,
  '[{"weekday":7,"start_time":"09:00","end_time":"12:00"}]'::jsonb)$$, '23514', 'dia da semana 7 é rejeitado');
select tests.expect_error($$select public.save_weekly_schedule(current_setting('tests.est_a')::uuid, current_setting('tests.joao')::uuid,
  '[{"weekday":1,"start_time":"09:00:30","end_time":"12:00"}]'::jsonb)$$, '22023', 'horário com segundos é rejeitado');
select tests.expect_error($$select public.save_weekly_schedule(current_setting('tests.est_a')::uuid, current_setting('tests.joao')::uuid, '{"a":1}'::jsonb)$$, '22023', 'payload que não é array é rejeitado');
select tests.expect_error($$select public.save_weekly_schedule(current_setting('tests.est_a')::uuid, current_setting('tests.joao')::uuid,
  (select jsonb_agg(jsonb_build_object('weekday', 1, 'start_time', '09:00', 'end_time', '10:00')) from generate_series(1, 43)))$$, '22023', 'mais de 42 trechos é rejeitado');
select tests.expect_error($$select public.save_weekly_schedule(current_setting('tests.est_a')::uuid, current_setting('tests.maria')::uuid, '[]'::jsonb)$$, 'P0002',
  'profissional de outra empresa não é encontrado');
select tests.expect_error($$select public.save_weekly_schedule(current_setting('tests.est_b')::uuid, current_setting('tests.maria')::uuid, '[]'::jsonb)$$, '42501',
  'owner A não grava expediente na empresa B');
select tests.expect_error($$insert into public.working_hours (establishment_id, professional_id, weekday, start_time, end_time)
  values (current_setting('tests.est_a')::uuid, current_setting('tests.joao')::uuid, 1, '10:00', '11:00')$$, '23P01', 'escrita direta também valida sobreposição');
select tests.expect_error($$insert into public.working_hours (establishment_id, professional_id, weekday, start_time, end_time)
  values (current_setting('tests.est_a')::uuid, current_setting('tests.maria')::uuid, 1, '10:00', '11:00')$$, '23503', 'FK composta barra expediente cruzado');
reset role;

select tests.login_as(current_setting('tests.s_a')::uuid);
select tests.expect_true($$(select count(*) from public.working_hours) = 2$$, 'staff lê o expediente');
select tests.expect_error($$select public.save_weekly_schedule(current_setting('tests.est_a')::uuid, current_setting('tests.joao')::uuid, '[]'::jsonb)$$, '42501', 'staff não altera expediente');
select tests.expect_affected($$delete from public.working_hours$$, 0, 'staff não exclui expediente');
reset role;

select tests.login_as(current_setting('tests.o_b')::uuid);
select tests.expect_true($$(select count(*) from public.working_hours) = 0$$, 'owner B não enxerga expediente da empresa A');
reset role;

select tests.login_anon();
select tests.expect_error($$select * from public.working_hours$$, '42501', 'anon não lê expediente');
select tests.expect_error($$select public.save_weekly_schedule(null, null, '[]'::jsonb)$$, '42501', 'anon não executa save_weekly_schedule');
select tests.expect_error($$select public.save_schedule_block(null, null, null, 'block', current_date, null, null, null, null)$$, '42501', 'anon não executa save_schedule_block');
reset role;

\warn '== Bloqueios, folgas e férias (fuso America/Manaus, UTC-4) =='
select tests.login_as(current_setting('tests.o_a')::uuid);
select set_config('tests.d1', (current_date + 30)::text, false);
select set_config('tests.d2', (current_date + 32)::text, false);

select public.save_schedule_block(current_setting('tests.est_a')::uuid, null, current_setting('tests.joao')::uuid, 'day_off',
  current_setting('tests.d1')::date, null, '10:00', '11:00', '  Folga  ');
select tests.expect_true($$(select kind = 'day_off' and reason = 'Folga'
   and starts_at = (current_setting('tests.d1')::date::timestamp at time zone 'America/Manaus')
   and ends_at   = ((current_setting('tests.d1')::date + 1)::timestamp at time zone 'America/Manaus')
   from public.schedule_blocks where professional_id = current_setting('tests.joao')::uuid)$$,
  'folga ocupa o dia inteiro no fuso do estabelecimento (horas informadas são ignoradas) e motivo é normalizado');
select tests.expect_true($$(select ends_at - starts_at = interval '24 hours' from public.schedule_blocks where kind = 'day_off')$$, 'dia de 24h em Manaus (UTC-4, 00:00 local = 04:00Z)');
select tests.expect_true($$(select (starts_at at time zone 'UTC')::time = '04:00' from public.schedule_blocks where kind = 'day_off')$$, '00:00 de Manaus = 04:00 UTC');

select tests.expect_error($$select public.save_schedule_block(current_setting('tests.est_a')::uuid, null, current_setting('tests.joao')::uuid, 'block',
  current_setting('tests.d1')::date, null, '15:00', '16:00', null)$$, '23P01', 'bloqueio sobre folga do mesmo profissional é rejeitado (sobreposição)');
select tests.expect_true($$public.save_schedule_block(current_setting('tests.est_a')::uuid, null, current_setting('tests.pedro')::uuid, 'block',
  current_setting('tests.d1')::date, null, '15:00', '16:30', 'Médico') is not null$$, 'outro profissional pode ter bloqueio no mesmo dia');
select tests.expect_true($$(select ends_at - starts_at = interval '90 minutes' and (starts_at at time zone 'UTC')::time = '19:00'
  from public.schedule_blocks where reason = 'Médico')$$, 'bloqueio parcial 15:00–16:30 local = 19:00Z, 90 min');

select tests.expect_true($$public.save_schedule_block(current_setting('tests.est_a')::uuid, null, current_setting('tests.joao')::uuid, 'vacation',
  (current_setting('tests.d1')::date + 10), (current_setting('tests.d1')::date + 19), null, null, 'Férias') is not null$$, 'férias de 10 dias');
select tests.expect_true($$(select ends_at - starts_at = interval '240 hours' from public.schedule_blocks where kind = 'vacation')$$, 'férias cobrem 10 dias corridos');
select tests.expect_error($$select public.save_schedule_block(current_setting('tests.est_a')::uuid, null, null, 'vacation',
  current_setting('tests.d1')::date, null, null, null, null)$$, '22023', 'férias exigem profissional');
select tests.expect_error($$insert into public.schedule_blocks (establishment_id, kind, starts_at, ends_at)
  values (current_setting('tests.est_a')::uuid, 'vacation', now() + interval '1 day', now() + interval '2 days')$$, '23514', 'CHECK barra férias sem profissional na escrita direta');
select tests.expect_error($$select public.save_schedule_block(current_setting('tests.est_a')::uuid, null, current_setting('tests.joao')::uuid, 'xyz',
  current_setting('tests.d1')::date, null, null, null, null)$$, '22023', 'tipo inválido é rejeitado');
select tests.expect_error($$select public.save_schedule_block(current_setting('tests.est_a')::uuid, null, current_setting('tests.pedro')::uuid, 'block',
  current_setting('tests.d2')::date, current_setting('tests.d1')::date, null, null, null)$$, '22023', 'data final antes da inicial é rejeitada');
select tests.expect_error($$select public.save_schedule_block(current_setting('tests.est_a')::uuid, null, current_setting('tests.pedro')::uuid, 'block',
  current_setting('tests.d2')::date, null, '16:00', '15:00', null)$$, '22023', 'hora final antes da inicial no mesmo dia é rejeitada');
select tests.expect_error($$select public.save_schedule_block(current_setting('tests.est_a')::uuid, null, current_setting('tests.pedro')::uuid, 'block',
  current_setting('tests.d2')::date, null, '16:00', null, null)$$, '22023', 'só uma das horas informada é rejeitado');
select tests.expect_error($$select public.save_schedule_block(current_setting('tests.est_a')::uuid, null, current_setting('tests.pedro')::uuid, 'block',
  current_date - 5, current_date - 4, null, null, null)$$, 'P0001', 'bloqueio inteiramente no passado é rejeitado');
select tests.expect_error($$select public.save_schedule_block(current_setting('tests.est_a')::uuid, null, current_setting('tests.pedro')::uuid, 'block',
  current_date, current_date + 400, null, null, null)$$, '22023', 'período maior que 366 dias é rejeitado');
select tests.expect_error($$select public.save_schedule_block(current_setting('tests.est_a')::uuid, null, current_setting('tests.maria')::uuid, 'block',
  current_setting('tests.d2')::date, null, null, null, null)$$, '23503', 'bloqueio para profissional de outra empresa é rejeitado');
select tests.expect_error($$select public.save_schedule_block(current_setting('tests.est_b')::uuid, null, null, 'block',
  current_setting('tests.d2')::date, null, null, null, null)$$, '42501', 'owner A não cria bloqueio na empresa B');
select tests.expect_error($$select public.save_schedule_block(current_setting('tests.est_a')::uuid, null, current_setting('tests.pedro')::uuid, 'block',
  current_setting('tests.d2')::date, null, null, null, repeat('x', 201))$$, '23514', 'motivo > 200 caracteres é rejeitado');

-- editar
select set_config('tests.blk', (select id::text from public.schedule_blocks where reason = 'Médico'), false);
select tests.expect_true($$public.save_schedule_block(current_setting('tests.est_a')::uuid, current_setting('tests.blk')::uuid, current_setting('tests.pedro')::uuid, 'block',
  current_setting('tests.d1')::date, null, '15:00', '17:00', 'Médico (2h)') = current_setting('tests.blk')::uuid$$, 'edição do próprio bloqueio não conflita consigo mesma');
select tests.expect_error($$select public.save_schedule_block(current_setting('tests.est_a')::uuid, gen_random_uuid(), current_setting('tests.pedro')::uuid, 'block',
  current_setting('tests.d1')::date, null, '15:00', '17:00', null)$$, 'P0002', 'editar bloqueio inexistente');
reset role;

\warn '== Conflito com agendamentos =='
insert into public.services (establishment_id, name, duration_minutes, price_cents) values (current_setting('tests.est_a')::uuid, 'Corte', 30, 4500);
insert into public.customers (establishment_id, full_name) values (current_setting('tests.est_a')::uuid, 'Cliente');
set session_replication_role = replica;  -- fixture: agendamentos sem expediente/vínculo, sem passar pelas regras de agenda
-- agendamento de Pedro em d2 às 09:00 local (13:00Z) e de João cancelado no mesmo horário
insert into public.appointments (establishment_id, professional_id, service_id, customer_id, starts_at, ends_at, price_cents, status)
select current_setting('tests.est_a')::uuid, current_setting('tests.pedro')::uuid, s.id, c.id,
       (current_setting('tests.d2')::date + time '09:00') at time zone 'America/Manaus',
       (current_setting('tests.d2')::date + time '09:30') at time zone 'America/Manaus', 4500, 'confirmed'
  from public.services s, public.customers c;
insert into public.appointments (establishment_id, professional_id, service_id, customer_id, starts_at, ends_at, price_cents, status)
select current_setting('tests.est_a')::uuid, current_setting('tests.joao')::uuid, s.id, c.id,
       (current_setting('tests.d2')::date + time '09:00') at time zone 'America/Manaus',
       (current_setting('tests.d2')::date + time '09:30') at time zone 'America/Manaus', 4500, 'cancelled'
  from public.services s, public.customers c;
set session_replication_role = origin;

select tests.login_as(current_setting('tests.o_a')::uuid);
select tests.expect_error($$select public.save_schedule_block(current_setting('tests.est_a')::uuid, null, current_setting('tests.pedro')::uuid, 'block',
  current_setting('tests.d2')::date, null, '09:15', '10:00', null)$$, 'P0001', 'bloqueio sobre agendamento ativo é rejeitado');
do $$ begin
  begin
    perform public.save_schedule_block(current_setting('tests.est_a')::uuid, null, current_setting('tests.pedro')::uuid, 'day_off', current_setting('tests.d2')::date, null, null, null, null);
  exception when others then
    if sqlerrm = 'block_conflicts_appointments:1' then raise notice 'PASS  mensagem informa a quantidade de agendamentos em conflito';
    else raise exception 'FAIL  mensagem inesperada: %', sqlerrm; end if;
  end;
end $$;
select tests.expect_true($$public.save_schedule_block(current_setting('tests.est_a')::uuid, null, current_setting('tests.joao')::uuid, 'block',
  current_setting('tests.d2')::date, null, '09:00', '09:30', null) is not null$$, 'agendamento cancelado não conflita');
select tests.expect_error($$select public.save_schedule_block(current_setting('tests.est_a')::uuid, null, null, 'day_off',
  current_setting('tests.d2')::date, null, null, null, 'Feriado')$$, 'P0001', 'bloqueio do estabelecimento todo também respeita agendamentos de qualquer profissional');
select tests.expect_true($$public.save_schedule_block(current_setting('tests.est_a')::uuid, null, null, 'day_off',
  (current_setting('tests.d1')::date + 365), null, null, null, 'Feriado') is not null$$, 'bloqueio do estabelecimento todo sem agendamentos no período');
select tests.expect_true($$(select count(*) from public.schedule_blocks where professional_id is null and kind = 'day_off') = 1$$, 'professional_id nulo = estabelecimento inteiro');
-- avisos de expediente: agendamento de Pedro (d2 09:00–09:30) fora do novo expediente
select tests.expect_true($$(public.save_weekly_schedule(current_setting('tests.est_a')::uuid, current_setting('tests.pedro')::uuid, '[]'::jsonb) ->> 'outside_appointments')::int = 1$$,
  'salvar expediente informa agendamentos futuros que ficaram fora');
select tests.expect_true($$(public.save_weekly_schedule(current_setting('tests.est_a')::uuid, current_setting('tests.pedro')::uuid,
  jsonb_build_array(jsonb_build_object('weekday', extract(dow from current_setting('tests.d2')::date)::int, 'start_time', '08:00', 'end_time', '12:00'))) ->> 'outside_appointments')::int = 0$$,
  'agendamento dentro do expediente (fuso do estabelecimento) não é apontado');
reset role;

\warn '== Staff, isolamento e escrita direta =='
select tests.login_as(current_setting('tests.s_a')::uuid);
select tests.expect_true($$public.save_schedule_block(current_setting('tests.est_a')::uuid, null, current_setting('tests.joao')::uuid, 'block',
  (current_setting('tests.d1')::date + 100), null, '10:00', '11:00', 'Staff') is not null$$, 'staff cria bloqueio (operação diária)');
select tests.expect_true($$(select count(*) from public.schedule_blocks) >= 5$$, 'staff lê os bloqueios');
select tests.expect_affected($$delete from public.schedule_blocks where reason = 'Staff'$$, 1, 'staff exclui bloqueio');
reset role;

select tests.login_as(current_setting('tests.o_b')::uuid);
select tests.expect_true($$(select count(*) from public.schedule_blocks) = 0$$, 'owner B não enxerga bloqueios da empresa A');
select tests.expect_affected($$delete from public.schedule_blocks$$, 0, 'owner B não exclui bloqueios da empresa A');
select tests.expect_affected($$update public.schedule_blocks set kind = 'block'$$, 0, 'owner B não altera bloqueios da empresa A');
reset role;
