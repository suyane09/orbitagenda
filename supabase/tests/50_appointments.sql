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
insert into public.memberships (establishment_id, user_id, role)
values (current_setting('tests.est_a')::uuid, current_setting('tests.s_a')::uuid, 'staff');

-- Concorrência entre duas sessões usa dblink. Se a conexão local exigir senha/usuário, informe-a ao rodar:
--   PGOPTIONS="-c tests.dburl=postgresql://user:senha@host:5432/<banco_do_teste>" npm run test:db
-- Sem dblink/conexão a seção de concorrência é PULADA ("SKIP") — nunca aprovada em silêncio.

-- Dados base (superusuário): João (com expediente 09–12 e 13–18 todos os dias e vínculo com "Corte"), Pedro (sem vínculo).
insert into public.professionals (id, establishment_id, name) values
 ('e1000000-0000-0000-0000-000000000001', current_setting('tests.est_a')::uuid, 'João'),
 ('e1000000-0000-0000-0000-000000000003', current_setting('tests.est_a')::uuid, 'Pedro'),
 ('e1000000-0000-0000-0000-000000000002', current_setting('tests.est_b')::uuid, 'Maria');
insert into public.services (id, establishment_id, name, duration_minutes, price_cents) values
 ('e2000000-0000-0000-0000-000000000001', current_setting('tests.est_a')::uuid, 'Corte', 30, 5000),
 ('e2000000-0000-0000-0000-000000000002', current_setting('tests.est_a')::uuid, 'Sem vínculo', 30, 4000),
 ('e2000000-0000-0000-0000-000000000003', current_setting('tests.est_b')::uuid, 'Corte B', 30, 6000);
insert into public.customers (id, establishment_id, full_name, phone) values
 ('e3000000-0000-0000-0000-000000000001', current_setting('tests.est_a')::uuid, 'Cliente A', '79999990001'),
 ('e3000000-0000-0000-0000-000000000002', current_setting('tests.est_b')::uuid, 'Cliente B', '79999990002');
insert into public.professional_services (establishment_id, professional_id, service_id) values
 (current_setting('tests.est_a')::uuid, 'e1000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001'),
 (current_setting('tests.est_a')::uuid, 'e1000000-0000-0000-0000-000000000003', 'e2000000-0000-0000-0000-000000000002');
insert into public.working_hours (establishment_id, professional_id, weekday, start_time, end_time)
select current_setting('tests.est_a')::uuid, pr, wd, t.s, t.e
  from generate_series(0, 6) wd,
       (values ('e1000000-0000-0000-0000-000000000001'::uuid), ('e1000000-0000-0000-0000-000000000003'::uuid)) as p(pr),
       (values ('09:00'::time, '12:00'::time), ('13:00', '18:00')) as t(s, e);
select set_config('tests.d',  (current_date + 10)::text, false);
select set_config('tests.d2', (current_date + 12)::text, false);

-- Escrita DIRETA (sem RPC), com o RLS do usuário: tentativas de contornar as regras.
create function tests.ins(d date, t time, mins int default 30, st text default 'scheduled',
  pro uuid default 'e1000000-0000-0000-0000-000000000001', svc uuid default 'e2000000-0000-0000-0000-000000000001',
  cust uuid default 'e3000000-0000-0000-0000-000000000001', est uuid default null, secs int default 0)
returns boolean language plpgsql as $$
begin
  insert into public.appointments (establishment_id, professional_id, service_id, customer_id, starts_at, ends_at, status, price_cents)
  values (coalesce(est, current_setting('tests.est_a')::uuid), pro, svc, cust,
          (d + t) at time zone 'America/Manaus' + secs * interval '1 second',
          (d + t) at time zone 'America/Manaus' + mins * interval '1 minute', st::public.appointment_status, 1);
  return true;
end $$;
grant execute on function tests.ins(date, time, int, text, uuid, uuid, uuid, uuid, int) to authenticated;
create function tests.book(d date, t time, p_id uuid default null, svc text default 'e2000000-0000-0000-0000-000000000001')
returns uuid language sql as $$
  select public.save_appointment(current_setting('tests.est_a')::uuid, p_id, 'e3000000-0000-0000-0000-000000000001',
    'e1000000-0000-0000-0000-000000000001', svc::uuid, d, t, 'obs', null)
$$;
grant execute on function tests.book(date, time, uuid, text) to authenticated;
create function tests.slot_free(d date, t time) returns boolean language sql as $$
  select exists (select 1 from public.get_available_slots(current_setting('tests.est_a')::uuid,
    'e1000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', d)
    where slot_start = (d + t) at time zone 'America/Manaus')
$$;
grant execute on function tests.slot_free(date, time) to authenticated;

\warn '== Escrita direta: regras do trigger =='
select tests.login_as(current_setting('tests.s_a')::uuid);
select tests.expect_true($$tests.ins(current_setting('tests.d')::date, '10:00')$$, 'INSERT direto válido é aceito');
select tests.expect_error($$select tests.ins(current_setting('tests.d')::date, '10:00')$$, '23P01', 'direto: mesmo horário é conflito');
select tests.expect_error($$select tests.ins(current_setting('tests.d')::date, '10:15')$$, '23P01', 'direto: sobreposição parcial é conflito');
select tests.expect_error($$select tests.ins(current_setting('tests.d')::date, '08:00')$$, 'P0001', 'direto: antes do expediente');
select tests.expect_error($$select tests.ins(current_setting('tests.d')::date, '18:00')$$, 'P0001', 'direto: depois do expediente');
select tests.expect_error($$select tests.ins(current_setting('tests.d')::date, '12:00')$$, 'P0001', 'direto: dentro do intervalo');
select tests.expect_error($$select tests.ins(current_setting('tests.d')::date, '11:45')$$, 'P0001', 'direto: atravessando o intervalo');
select tests.expect_error($$select tests.ins(current_setting('tests.d')::date, '17:45', 30)$$, 'P0001', 'direto: terminando depois do expediente');
select tests.expect_error($$select tests.ins(current_setting('tests.d')::date, '14:00', 60)$$, 'P0001', 'direto: duração diferente da do serviço');
select tests.expect_error($$select tests.ins(current_setting('tests.d')::date, '14:00', 30, 'scheduled', secs => 30)$$, '22023', 'direto: horário com segundos');
select tests.expect_error($$select tests.ins(current_date - 1, '14:00')$$, 'P0001', 'direto: no passado');
select tests.expect_error($$select tests.ins(current_setting('tests.d')::date, '14:00', 30, 'completed')$$, 'P0001', 'direto: não nasce concluído');
select tests.expect_error($$select tests.ins(current_setting('tests.d')::date, '14:00', 30, 'cancelled')$$, 'P0001', 'direto: não nasce cancelado');
select tests.expect_error($$select tests.ins(current_setting('tests.d')::date, '14:00', 30, 'scheduled', 'e1000000-0000-0000-0000-000000000003')$$, 'P0001', 'direto: serviço não oferecido pelo profissional');
select tests.expect_error($$select tests.ins(current_setting('tests.d')::date, '14:00', 30, 'scheduled', svc => 'e2000000-0000-0000-0000-000000000002')$$, 'P0001', 'direto: vínculo ausente (serviço sem vínculo com João)');
select tests.expect_error($$select tests.ins(current_setting('tests.d')::date, '14:00', cust => 'e3000000-0000-0000-0000-000000000002')$$, '23503', 'direto: cliente de outra empresa');
select tests.expect_error($$select tests.ins(current_setting('tests.d')::date, '14:00', pro => 'e1000000-0000-0000-0000-000000000002')$$, '23503', 'direto: profissional de outra empresa');
select tests.expect_error($$select tests.ins(current_setting('tests.d')::date, '14:00', svc => 'e2000000-0000-0000-0000-000000000003')$$, '23503', 'direto: serviço de outra empresa');
select tests.expect_error($$select tests.ins(current_setting('tests.d')::date, '14:00', est => current_setting('tests.est_b')::uuid)$$, '42501', 'direto: gravar na empresa B é barrado');
reset role;

-- inativos
update public.professionals set is_active = false where id = 'e1000000-0000-0000-0000-000000000001';
select tests.login_as(current_setting('tests.s_a')::uuid);
select tests.expect_error($$select tests.ins(current_setting('tests.d')::date, '14:00')$$, 'P0001', 'direto: profissional inativo');
reset role;
update public.professionals set is_active = true where id = 'e1000000-0000-0000-0000-000000000001';
update public.services set is_active = false where id = 'e2000000-0000-0000-0000-000000000001';
select tests.login_as(current_setting('tests.s_a')::uuid);
select tests.expect_error($$select tests.ins(current_setting('tests.d')::date, '14:00')$$, 'P0001', 'direto: serviço inativo');
select tests.expect_error($$select tests.book(current_setting('tests.d')::date, '14:00')$$, 'P0001', 'RPC: serviço inativo');
reset role;
update public.services set is_active = true where id = 'e2000000-0000-0000-0000-000000000001';

\warn '== Bloqueios por escrita direta =='
select tests.login_as(current_setting('tests.o_a')::uuid);
select public.save_schedule_block(current_setting('tests.est_a')::uuid, null, 'e1000000-0000-0000-0000-000000000001', 'block',
  current_setting('tests.d2')::date, null, '10:00', '11:00', 'Médico');
select tests.expect_error($$select tests.ins(current_setting('tests.d2')::date, '10:30')$$, 'P0001', 'direto: dentro de bloqueio do profissional');
select tests.expect_true($$tests.ins(current_setting('tests.d2')::date, '11:00')$$, 'direto: logo após o bloqueio é aceito');
select public.save_schedule_block(current_setting('tests.est_a')::uuid, null, null, 'day_off', current_setting('tests.d2')::date + 1, null, null, null, 'Feriado');
select tests.expect_error($$select tests.ins(current_setting('tests.d2')::date + 1, '10:00')$$, 'P0001', 'direto: folga do estabelecimento todo');
select tests.expect_error($$select tests.ins(current_setting('tests.d2')::date + 1, '10:00', pro => 'e1000000-0000-0000-0000-000000000003', svc => 'e2000000-0000-0000-0000-000000000002')$$, 'P0001', 'direto: folga do estabelecimento vale para qualquer profissional');
reset role;

\warn '== UPDATE direto =='
select tests.login_as(current_setting('tests.s_a')::uuid);
select tests.expect_true($$tests.ins(current_setting('tests.d')::date, '10:30')$$, 'segundo agendamento 10:30');
select tests.expect_error($$update public.appointments set starts_at = starts_at + interval '5 minutes', ends_at = ends_at + interval '5 minutes' where starts_at = (current_setting('tests.d')::date + time '10:00') at time zone 'America/Manaus'$$, '23P01', 'UPDATE: mover para cima de outro é conflito');
select tests.expect_error($$update public.appointments set starts_at = (current_setting('tests.d')::date + time '12:00') at time zone 'America/Manaus', ends_at = (current_setting('tests.d')::date + time '12:30') at time zone 'America/Manaus' where starts_at = (current_setting('tests.d')::date + time '10:00') at time zone 'America/Manaus'$$, 'P0001', 'UPDATE: mover para o intervalo');
select tests.expect_error($$update public.appointments set starts_at = (current_setting('tests.d2')::date + time '10:00') at time zone 'America/Manaus', ends_at = (current_setting('tests.d2')::date + time '10:30') at time zone 'America/Manaus' where starts_at = (current_setting('tests.d')::date + time '10:00') at time zone 'America/Manaus'$$, 'P0001', 'UPDATE: mover para dentro de um bloqueio');
select tests.expect_error($$update public.appointments set ends_at = ends_at + interval '30 minutes' where starts_at = (current_setting('tests.d')::date + time '10:00') at time zone 'America/Manaus'$$, 'P0001', 'UPDATE: esticar a duração além do serviço');
select tests.expect_error($$update public.appointments set professional_id = 'e1000000-0000-0000-0000-000000000003' where starts_at = (current_setting('tests.d')::date + time '10:00') at time zone 'America/Manaus'$$, 'P0001', 'UPDATE: trocar para profissional sem vínculo');
select tests.expect_error($$update public.appointments set service_id = 'e2000000-0000-0000-0000-000000000002' where starts_at = (current_setting('tests.d')::date + time '10:00') at time zone 'America/Manaus'$$, 'P0001', 'UPDATE: trocar para serviço sem vínculo');
select tests.expect_error($$update public.appointments set customer_id = 'e3000000-0000-0000-0000-000000000002' where starts_at = (current_setting('tests.d')::date + time '10:00') at time zone 'America/Manaus'$$, '23503', 'UPDATE: cliente de outra empresa');
select tests.expect_error($$update public.appointments set establishment_id = current_setting('tests.est_b')::uuid where starts_at = (current_setting('tests.d')::date + time '10:00') at time zone 'America/Manaus'$$, '42501', 'UPDATE: não troca de empresa');
select tests.expect_error($$update public.appointments set status = 'completed' where starts_at = (current_setting('tests.d')::date + time '10:00') at time zone 'America/Manaus'$$, 'P0001', 'UPDATE: não conclui antes do início');
select tests.expect_affected($$update public.appointments set status = 'confirmed' where starts_at = (current_setting('tests.d')::date + time '10:00') at time zone 'America/Manaus'$$, 1, 'UPDATE: confirmar');
select tests.expect_error($$update public.appointments set status = 'scheduled' where status = 'confirmed' and starts_at = (current_setting('tests.d')::date + time '10:00') at time zone 'America/Manaus'$$, 'P0001', 'UPDATE: confirmado não volta a agendado');
select tests.expect_affected($$update public.appointments set status = 'cancelled' where starts_at = (current_setting('tests.d')::date + time '10:30') at time zone 'America/Manaus'$$, 1, 'UPDATE: cancelar');
select tests.expect_error($$update public.appointments set status = 'confirmed' where status = 'cancelled'$$, 'P0001', 'UPDATE: cancelado é final');
select tests.expect_error($$update public.appointments set starts_at = starts_at + interval '1 hour', ends_at = ends_at + interval '1 hour' where status = 'cancelled'$$, 'P0001', 'UPDATE: cancelado não é remarcado');
select tests.expect_affected($$update public.appointments set notes = 'ok' where status = 'cancelled'$$, 1, 'UPDATE: observação de cancelado pode mudar');
select tests.expect_true($$tests.ins(current_setting('tests.d')::date, '10:30')$$, 'cancelar libera o horário (direto)');
reset role;

-- Mudança só de status não reavalia expediente: remove o expediente de João e confirma mesmo assim.
delete from public.working_hours where professional_id = 'e1000000-0000-0000-0000-000000000001';
select tests.login_as(current_setting('tests.s_a')::uuid);
select tests.expect_affected($$update public.appointments set status = 'confirmed' where status = 'scheduled' and starts_at = (current_setting('tests.d')::date + time '10:30') at time zone 'America/Manaus'$$, 1, 'status isolado não reavalia expediente');
select tests.expect_error($$select tests.ins(current_setting('tests.d')::date, '15:00')$$, 'P0001', 'sem expediente não há agendamento novo');
reset role;
insert into public.working_hours (establishment_id, professional_id, weekday, start_time, end_time)
select current_setting('tests.est_a')::uuid, 'e1000000-0000-0000-0000-000000000001', wd, t.s, t.e
  from generate_series(0, 6) wd, (values ('09:00'::time, '12:00'::time), ('13:00', '18:00')) as t(s, e);

\warn '== RPC (preservadas) =='
select tests.login_as(current_setting('tests.s_a')::uuid);
select tests.expect_true($$tests.book(current_setting('tests.d')::date, '09:00') is not null$$, 'RPC cria agendamento');
select tests.expect_true($$(select price_cents = 5000 and ends_at - starts_at = interval '30 minutes' from public.appointments where starts_at = (current_setting('tests.d')::date + time '09:00') at time zone 'America/Manaus')$$, 'RPC: preço e duração vêm do serviço');
select tests.expect_error($$select tests.book(current_setting('tests.d')::date, '09:00')$$, '23P01', 'RPC: conflito');
select tests.expect_error($$select tests.book(current_setting('tests.d')::date, '12:00')$$, 'P0001', 'RPC: intervalo');
select tests.expect_error($$select public.save_appointment(current_setting('tests.est_a')::uuid, null, 'e3000000-0000-0000-0000-000000000002',
  'e1000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', current_setting('tests.d')::date, '15:00', null)$$, 'P0002', 'RPC: cliente de outra empresa');
select tests.expect_true($$not tests.slot_free(current_setting('tests.d')::date, '09:00')$$, 'horário ocupado não é oferecido');
select tests.expect_true($$tests.slot_free(current_setting('tests.d')::date, '09:30')$$, 'horário livre é oferecido');
select tests.expect_true($$not tests.slot_free(current_setting('tests.d')::date, '12:00')$$, 'intervalo não é oferecido');
select tests.expect_true($$not tests.slot_free(current_setting('tests.d2')::date, '10:30')$$, 'bloqueio não é oferecido');
select tests.expect_error($$select public.set_appointment_status(current_setting('tests.est_a')::uuid, 'ffffffff-0000-0000-0000-000000000000', 'confirmed')$$, 'P0002', 'RPC: agendamento inexistente');
select tests.expect_true($$(select count(*) from public.list_appointments(current_setting('tests.est_a')::uuid, current_setting('tests.d')::date, current_setting('tests.d')::date)) >= 3$$, 'RPC: lista do dia');
reset role;

\warn '== Multiempresa =='
select tests.login_as(current_setting('tests.o_b')::uuid);
select tests.expect_error($$select * from public.list_appointments(current_setting('tests.est_a')::uuid, current_date, current_date)$$, '42501', 'B não lista agenda de A');
select tests.expect_error($$select tests.ins(current_setting('tests.d')::date, '16:00', est => current_setting('tests.est_a')::uuid)$$, '42501', 'B não grava direto na agenda de A');
select tests.expect_true($$(select count(*) from public.appointments) = 0$$, 'RLS: B não enxerga agendamentos de A');
reset role;

\warn '== Concorrência entre duas sessões (dblink) =='
do $$ begin create extension if not exists dblink; exception when others then raise notice 'SKIP  dblink indisponível: %', sqlerrm; end $$;
do $$ begin
  perform dblink_connect('c2', coalesce(current_setting('tests.dburl', true), 'dbname=' || current_database()));
  -- sessão 2 age como o funcionário da empresa A (mesmo caminho autenticado/RLS da sessão 1)
  perform dblink_exec('c2', format('set request.jwt.claim.sub = %L', current_setting('tests.s_a')));
  perform dblink_exec('c2', 'set role authenticated');
  perform set_config('tests.dbl_ok', 'on', false);
exception when others then raise notice 'SKIP  conexão dblink falhou (%): defina tests.dburl via PGOPTIONS', sqlerrm; end $$;
select coalesce(current_setting('tests.dbl_ok', true), 'off') = 'on' as ok \gset

\if :ok
create function tests.remote_ins(d date, t time) returns text language sql as $$
  select format($f$ insert into public.appointments (establishment_id, professional_id, service_id, customer_id, starts_at, ends_at, price_cents)
    values (%L, 'e1000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', 'e3000000-0000-0000-0000-000000000001', %L, %L, 1) $f$,
    current_setting('tests.est_a'),
    ((d + t) at time zone 'America/Manaus')::text, ((d + t + interval '30 minutes') at time zone 'America/Manaus')::text) $$;
create function tests.remote_blk(d date, pro boolean) returns text language sql as $$
  select format($f$ select public.save_schedule_block(%L, null, %s, 'day_off', %L, null, null, null, 'race') $f$,
    current_setting('tests.est_a'),
    case when pro then '''e1000000-0000-0000-0000-000000000001''::uuid' else 'null::uuid' end, d::text) $$;
create function tests.expect_remote_error(conn text, expected text, label text) returns void language plpgsql as $$
begin
  begin
    perform * from dblink_get_result(conn) as t(r text);
  exception when others then
    -- Drena a conexão: após o erro o libpq só fica ocioso quando o próximo PQgetResult devolve NULL.
    -- Sem isso, o próximo dblink_send_query falha ("another command is already in progress").
    begin perform * from dblink_get_result(conn) as t(r text); exception when others then null; end;
    if dblink_is_busy(conn) <> 0 then raise exception 'FAIL  % (conexão dblink ainda ocupada)', label; end if;
    if sqlstate = expected then perform tests.pass(label); return; end if;
    raise exception 'FAIL  % (esperado %, obtido % : %)', label, expected, sqlstate, sqlerrm;
  end;
  raise exception 'FAIL  % (a segunda sessão não falhou)', label;
end $$;

-- A) duas sessões disputam o MESMO horário: a segunda espera o lock do profissional e depois recebe conflito.
begin;
select set_config('request.jwt.claim.sub', current_setting('tests.s_a'), true); set local role authenticated;
select tests.ins((current_date + 20), '10:00');
reset role;
select dblink_send_query('c2', tests.remote_ins(current_date + 20, '10:00')) as sent \gset
select tests.expect_true(:'sent' || ' = 1', 'consulta enviada à sessão 2 (conexão ociosa antes do envio)');
select pg_sleep(0.7);
select dblink_is_busy('c2') as busy \gset
commit;
reset role;
select tests.expect_true(:'busy' || ' = 1', 'sessão 2 aguarda o lock do profissional enquanto a 1 não termina');
select tests.expect_remote_error('c2', '23P01', 'sessão 2 recebe conflito após o commit da sessão 1');
select tests.expect_true($$(select count(*) from public.appointments where starts_at = ((current_date + 20) + time '10:00') at time zone 'America/Manaus') = 1$$, 'um único agendamento ativo no horário disputado');

-- B) agendamento em andamento × bloqueio do profissional no mesmo dia.
begin;
select set_config('request.jwt.claim.sub', current_setting('tests.s_a'), true); set local role authenticated;
select tests.ins((current_date + 21), '10:00');
reset role;
select dblink_send_query('c2', tests.remote_blk(current_date + 21, true)) as sent \gset
select tests.expect_true(:'sent' || ' = 1', 'consulta enviada à sessão 2 (conexão ociosa antes do envio)');
select pg_sleep(0.7);
select dblink_is_busy('c2') as busy \gset
commit;
reset role;
select tests.expect_true(:'busy' || ' = 1', 'bloqueio aguarda agendamento em andamento do profissional');
select tests.expect_remote_error('c2', 'P0001', 'bloqueio é recusado por cobrir o agendamento confirmado em commit');

-- C) bloqueio do profissional em andamento × novo agendamento no mesmo dia.
begin;
select set_config('request.jwt.claim.sub', current_setting('tests.s_a'), true); set local role authenticated;
select public.save_schedule_block(current_setting('tests.est_a')::uuid, null, 'e1000000-0000-0000-0000-000000000001', 'day_off', current_date + 22, null, null, null, 'race');
reset role;
select dblink_send_query('c2', tests.remote_ins(current_date + 22, '10:00')) as sent \gset
select tests.expect_true(:'sent' || ' = 1', 'consulta enviada à sessão 2 (conexão ociosa antes do envio)');
select pg_sleep(0.7);
select dblink_is_busy('c2') as busy \gset
commit;
reset role;
select tests.expect_true(:'busy' || ' = 1', 'agendamento aguarda o bloqueio do profissional em andamento');
select tests.expect_remote_error('c2', 'P0001', 'agendamento é recusado após o commit do bloqueio');

-- D) bloqueio do ESTABELECIMENTO TODO em andamento × novo agendamento (lock exclusivo × compartilhado).
begin;
select set_config('request.jwt.claim.sub', current_setting('tests.s_a'), true); set local role authenticated;
select public.save_schedule_block(current_setting('tests.est_a')::uuid, null, null, 'day_off', current_date + 23, null, null, null, 'race');
reset role;
select dblink_send_query('c2', tests.remote_ins(current_date + 23, '10:00')) as sent \gset
select tests.expect_true(:'sent' || ' = 1', 'consulta enviada à sessão 2 (conexão ociosa antes do envio)');
select pg_sleep(0.7);
select dblink_is_busy('c2') as busy \gset
commit;
reset role;
select tests.expect_true(:'busy' || ' = 1', 'agendamento aguarda o bloqueio do estabelecimento em andamento');
select tests.expect_remote_error('c2', 'P0001', 'agendamento é recusado após o commit do bloqueio do estabelecimento');
select tests.expect_true($$(select count(*) from public.appointments where starts_at >= ((current_date + 21) + time '00:00') at time zone 'America/Manaus'
  and starts_at < ((current_date + 24) + time '00:00') at time zone 'America/Manaus') = 1$$, 'nenhum agendamento sobreviveu em dia bloqueado (só o do cenário B)');
select dblink_disconnect('c2');
\else
\warn 'SKIP  concorrência entre sessões não executada (sem dblink/conexão)'
\endif
\warn 'ok'
