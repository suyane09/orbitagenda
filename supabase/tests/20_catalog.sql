-- Etapa 2 · Parte 1 — serviços, profissionais e vínculo (banco real, RLS ativo).
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
select public.create_establishment('Alfa Barbearia');
reset role;
select tests.login_as(current_setting('tests.o_b')::uuid);
select public.create_establishment('Bravo Salão', 'salon');
reset role;

select set_config('tests.est_a', (select id::text from public.establishments where slug = 'alfa-barbearia'), false);
select set_config('tests.est_b', (select id::text from public.establishments where slug = 'bravo-salao'), false);
insert into public.memberships (establishment_id, user_id, role)
values (current_setting('tests.est_a')::uuid, current_setting('tests.s_a')::uuid, 'staff');

\warn '== Serviços =='
select tests.login_as(current_setting('tests.o_a')::uuid);
insert into public.services (establishment_id, name, description, category, duration_minutes, price_cents)
values (current_setting('tests.est_a')::uuid, '  Corte   Masculino ', '   ', '  Cabelo  ', 30, 4500);
select tests.expect_true($$(select name = 'Corte Masculino' and description is null and category = 'Cabelo'
  from public.services where lower(name) like 'corte%')$$,
  'nome/categoria normalizados e descrição em branco vira null');
select tests.expect_error($$insert into public.services (establishment_id, name, duration_minutes, price_cents)
  values (current_setting('tests.est_a')::uuid, 'corte masculino', 30, 100)$$, '23505', 'nome duplicado (sem diferenciar maiúsculas) é rejeitado');
select tests.expect_error($$insert into public.services (establishment_id, name, duration_minutes, price_cents)
  values (current_setting('tests.est_a')::uuid, '   ', 30, 100)$$, '23514', 'nome só com espaços é rejeitado');
select tests.expect_error($$insert into public.services (establishment_id, name, duration_minutes, price_cents)
  values (current_setting('tests.est_a')::uuid, 'Preço negativo', 30, -1)$$, '23514', 'preço negativo é rejeitado');
select tests.expect_error($$insert into public.services (establishment_id, name, duration_minutes, price_cents)
  values (current_setting('tests.est_a')::uuid, 'Preço absurdo', 30, 10000001)$$, '23514', 'preço acima do teto é rejeitado');
select tests.expect_error($$insert into public.services (establishment_id, name, duration_minutes, price_cents)
  values (current_setting('tests.est_a')::uuid, 'Muito curto', 4, 100)$$, '23514', 'duração < 5 min é rejeitada');
select tests.expect_error($$insert into public.services (establishment_id, name, duration_minutes, price_cents)
  values (current_setting('tests.est_a')::uuid, 'Muito longo', 721, 100)$$, '23514', 'duração > 720 min é rejeitada');
select tests.expect_error($$insert into public.services (establishment_id, name, duration_minutes, price_cents, category)
  values (current_setting('tests.est_a')::uuid, 'Cat longa', 30, 100, repeat('x', 41))$$, '23514', 'categoria > 40 caracteres é rejeitada');
select tests.expect_error($$insert into public.services (establishment_id, name, duration_minutes, price_cents)
  values (current_setting('tests.est_b')::uuid, 'Invasor', 30, 100)$$, '42501', 'owner A não cria serviço na empresa B');
insert into public.services (establishment_id, name, duration_minutes, price_cents)
values (current_setting('tests.est_a')::uuid, 'Barba', 20, 3000);
reset role;

select tests.login_as(current_setting('tests.s_a')::uuid);
select tests.expect_true($$(select count(*) from public.services) = 2$$, 'staff lê os serviços da própria empresa');
select tests.expect_error($$insert into public.services (establishment_id, name, duration_minutes, price_cents)
  values (current_setting('tests.est_a')::uuid, 'Staff tenta', 30, 100)$$, '42501', 'staff não cria serviço');
select tests.expect_affected($$update public.services set price_cents = 1$$, 0, 'staff não altera serviço');
select tests.expect_affected($$delete from public.services$$, 0, 'staff não exclui serviço');
reset role;

select tests.login_as(current_setting('tests.o_b')::uuid);
select tests.expect_true($$(select count(*) from public.services) = 0$$, 'owner B não enxerga serviços da empresa A');
select tests.expect_affected($$update public.services set price_cents = 1$$, 0, 'owner B não altera serviços da empresa A');
reset role;

select tests.login_as(current_setting('tests.o_a')::uuid);
select tests.expect_error($$update public.services set establishment_id = current_setting('tests.est_b')::uuid where name = 'Barba'$$, '42501',
  'serviço não troca de empresa');
select tests.expect_affected($$update public.services set price_cents = 3500, is_active = false where name = 'Barba'$$, 1, 'owner edita preço e status');
reset role;
select set_config('tests.svc_corte', (select id::text from public.services where name = 'Corte Masculino'), false);
select set_config('tests.svc_barba', (select id::text from public.services where name = 'Barba'), false);
insert into public.services (establishment_id, name, duration_minutes, price_cents)
values (current_setting('tests.est_b')::uuid, 'Escova', 40, 8000);
select set_config('tests.svc_b', (select id::text from public.services where name = 'Escova'), false);

\warn '== Profissionais e vínculo =='
select tests.login_as(current_setting('tests.o_a')::uuid);
select tests.expect_true($$
  public.save_professional(current_setting('tests.est_a')::uuid, null, '  João   Silva ', '  ', '#1B7F55', true,
    array[current_setting('tests.svc_corte')::uuid, current_setting('tests.svc_corte')::uuid, current_setting('tests.svc_barba')::uuid]) is not null$$,
  'owner cria profissional com serviços (ids duplicados são tolerados)');
select set_config('tests.pro_a', (select id::text from public.professionals where name = 'João Silva'), false);
select tests.expect_true($$(select bio is null and color = '#1B7F55' and is_active from public.professionals where id = current_setting('tests.pro_a')::uuid)$$,
  'nome normalizado, bio em branco = null, cor aplicada');
select tests.expect_true($$(select count(*) from public.professional_services where professional_id = current_setting('tests.pro_a')::uuid) = 2$$,
  'dois vínculos criados (sem duplicar)');

select public.save_professional(current_setting('tests.est_a')::uuid, current_setting('tests.pro_a')::uuid, 'João Silva', 'Barbeiro', null, false,
  array[current_setting('tests.svc_barba')::uuid]);
select tests.expect_true($$(select count(*) from public.professional_services where professional_id = current_setting('tests.pro_a')::uuid) = 1
  and (select not is_active and color = '#1B7F55' and bio = 'Barbeiro' from public.professionals where id = current_setting('tests.pro_a')::uuid)$$,
  'editar sincroniza vínculos, mantém cor quando null e aplica status');
select public.save_professional(current_setting('tests.est_a')::uuid, current_setting('tests.pro_a')::uuid, 'João Silva', null, null, true, '{}');
select tests.expect_true($$(select count(*) from public.professional_services) = 0$$, 'lista vazia remove todos os vínculos');

select tests.expect_error($$select public.save_professional(current_setting('tests.est_a')::uuid, null, 'Com serviço alheio', null, null, true,
  array[current_setting('tests.svc_b')::uuid])$$, '23503', 'serviço de outra empresa não pode ser vinculado');
select tests.expect_true($$(select count(*) from public.professionals where name = 'Com serviço alheio') = 0$$,
  'falha no vínculo desfaz o profissional (atomicidade)');
select tests.expect_error($$select public.save_professional(current_setting('tests.est_a')::uuid, null, ' ', null, null, true, '{}')$$, '23514', 'nome em branco é rejeitado');
select tests.expect_error($$select public.save_professional(current_setting('tests.est_a')::uuid, null, 'Cor ruim', null, 'vermelho', true, '{}')$$, '23514', 'cor inválida é rejeitada');
select tests.expect_error($$select public.save_professional(current_setting('tests.est_a')::uuid, null, 'Muitos', null, null, true,
  (select array_agg(gen_random_uuid()) from generate_series(1, 101)))$$, '22023', 'mais de 100 serviços é rejeitado');
select tests.expect_error($$select public.save_professional(current_setting('tests.est_b')::uuid, null, 'Invasor', null, null, true, '{}')$$, '42501',
  'owner A não cria profissional na empresa B');
select tests.expect_error($$insert into public.professional_services (establishment_id, professional_id, service_id)
  values (current_setting('tests.est_a')::uuid, current_setting('tests.pro_a')::uuid, current_setting('tests.svc_b')::uuid)$$, '23503',
  'FK composta barra vínculo cruzado direto');
reset role;

select tests.login_as(current_setting('tests.s_a')::uuid);
select tests.expect_error($$select public.save_professional(current_setting('tests.est_a')::uuid, null, 'Staff tenta', null, null, true, '{}')$$, '42501', 'staff não salva profissional');
select tests.expect_error($$insert into public.professional_services (establishment_id, professional_id, service_id)
  values (current_setting('tests.est_a')::uuid, current_setting('tests.pro_a')::uuid, current_setting('tests.svc_corte')::uuid)$$, '42501', 'staff não vincula serviço direto');
select tests.expect_true($$(select count(*) from public.professionals) = 1$$, 'staff lê profissionais');
reset role;

select tests.login_as(current_setting('tests.o_b')::uuid);
select tests.expect_true($$public.save_professional(current_setting('tests.est_b')::uuid, null, 'Maria', null, null, true, array[current_setting('tests.svc_b')::uuid]) is not null$$,
  'owner B cria profissional na própria empresa');
select tests.expect_error($$select public.save_professional(current_setting('tests.est_b')::uuid, current_setting('tests.pro_a')::uuid, 'Sequestro', null, null, true, '{}')$$, 'P0002',
  'owner B não edita profissional da empresa A informando a própria empresa');
select tests.expect_true($$(select count(*) from public.professional_services) = 1$$, 'owner B só vê os próprios vínculos');
reset role;

select tests.login_anon();
select tests.expect_error($$select * from public.professional_services$$, '42501', 'anon não lê vínculos');
select tests.expect_error($$select public.save_professional(null, null, 'x', null, null, true, '{}')$$, '42501', 'anon não executa save_professional');
reset role;

\warn '== Exclusão e histórico =='
insert into public.customers (establishment_id, full_name) values (current_setting('tests.est_a')::uuid, 'Cliente Teste');
select tests.login_as(current_setting('tests.o_a')::uuid);
select public.save_professional(current_setting('tests.est_a')::uuid, current_setting('tests.pro_a')::uuid, 'João Silva', null, null, true,
  array[current_setting('tests.svc_corte')::uuid]);
reset role;
set session_replication_role = replica;  -- fixture de histórico, sem passar pelas regras de agenda
insert into public.appointments (establishment_id, professional_id, service_id, customer_id, starts_at, ends_at, price_cents)
select current_setting('tests.est_a')::uuid, current_setting('tests.pro_a')::uuid, current_setting('tests.svc_corte')::uuid, c.id,
       '2026-11-02 12:00+00', '2026-11-02 12:30+00', 4500 from public.customers c;
set session_replication_role = origin;
select tests.login_as(current_setting('tests.o_a')::uuid);
select tests.expect_error($$delete from public.services where id = current_setting('tests.svc_corte')::uuid$$, '23503', 'serviço com agendamento não pode ser excluído');
select tests.expect_error($$delete from public.professionals where id = current_setting('tests.pro_a')::uuid$$, '23503', 'profissional com agendamento não pode ser excluído');
select tests.expect_affected($$delete from public.services where id = current_setting('tests.svc_barba')::uuid$$, 1, 'serviço sem histórico é excluído');
select tests.expect_true($$(select count(*) from public.professional_services where service_id = current_setting('tests.svc_barba')::uuid) = 0$$, 'exclusão do serviço remove vínculos em cascata');
reset role;
