-- Testes de acesso entre duas empresas (A e B), papéis e escalonamento de privilégio.
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
create function tests.expect_count(q text, expected int, label text) returns void language plpgsql as $$
declare n int;
begin
  execute 'select count(*) from (' || q || ') q' into n;
  if n <> expected then raise exception 'FAIL  % (esperado %, obtido %)', label, expected, n; end if;
  perform tests.pass(label);
end $$;
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

-- ===================== Dados de apoio (como superusuário) =====================
insert into auth.users (id, email, raw_user_meta_data) values
 ('a1000000-0000-0000-0000-000000000001', 'ana@alfa.test',
    '{"full_name":"Ana Alfa","role":"superadmin","is_superadmin":true}'),
 ('a2000000-0000-0000-0000-000000000002', 'caio@alfa.test', '{"full_name":"Caio Alfa"}'),
 ('b1000000-0000-0000-0000-000000000001', 'bia@bravo.test', '{"full_name":"Bia Bravo"}'),
 ('b2000000-0000-0000-0000-000000000002', 'davi@bravo.test', '{"full_name":"Davi Bravo"}'),
 ('f0000000-0000-0000-0000-00000000000f', 'root@orbit.test', '{"full_name":"Super"}'),
 ('e0000000-0000-0000-0000-00000000000e', 'sem@vinculo.test', '{}'),
 ('d0000000-0000-0000-0000-00000000000d', 'yara@outra.test', '{"full_name":"Yara"}');

select set_config('tests.a1', 'a1000000-0000-0000-0000-000000000001', false);
select set_config('tests.a2', 'a2000000-0000-0000-0000-000000000002', false);
select set_config('tests.b1', 'b1000000-0000-0000-0000-000000000001', false);
select set_config('tests.b2', 'b2000000-0000-0000-0000-000000000002', false);
select set_config('tests.su', 'f0000000-0000-0000-0000-00000000000f', false);
select set_config('tests.nobody', 'e0000000-0000-0000-0000-00000000000e', false);
select set_config('tests.y',  'd0000000-0000-0000-0000-00000000000d', false);

insert into public.platform_admins (user_id) values (current_setting('tests.su')::uuid);

\warn '== 0. Verificações estáticas de segurança =='
select tests.expect_count($$
  select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity$$, 0,
  'toda tabela em public tem RLS habilitado');
select tests.expect_count($$
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public','private') and p.prosecdef
    and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')$$, 0,
  'toda função SECURITY DEFINER fixa search_path');
do $diag$ declare v text; begin select string_agg(n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', ', ') into v from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prosecdef and has_function_privilege('anon',p.oid,'execute'); raise notice 'ANON_DEFINER_DIAGNOSTIC: %', v; end $diag$;
select tests.expect_count($
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public','private') and p.prosecdef and has_function_privilege('anon', p.oid, 'execute') and p.proname <> 'create_public_booking'$$, 0,
  'anon não executa funções SECURITY DEFINER além da reserva pública controlada');
select tests.expect_count($$
  select 1 from information_schema.role_table_grants
  where grantee = 'anon' and table_schema = 'public'$$, 0,
  'anon não tem nenhum privilégio de tabela');
select tests.expect_true($$not has_table_privilege('authenticated','public.establishments','INSERT')$$,
  'authenticated não faz INSERT direto em establishments');
select tests.expect_true($$not has_table_privilege('authenticated','public.memberships','INSERT')$$,
  'authenticated não faz INSERT direto em memberships');
select tests.expect_true($$not has_table_privilege('authenticated','public.platform_admins','SELECT')$$,
  'authenticated não lê platform_admins');

\warn '== 1. Cadastro, perfil e criação de estabelecimento =='
select tests.expect_true($$(select full_name from public.profiles where id = current_setting('tests.a1')::uuid) = 'Ana Alfa'$$,
  'trigger cria perfil com o nome informado');
select tests.expect_true($$(select full_name from public.profiles where id = current_setting('tests.nobody')::uuid) = 'sem'$$,
  'perfil usa prefixo do e-mail quando não há nome');

select tests.login_anon();
select tests.expect_error($$select public.create_establishment('Fantasma')$$, '42501',
  'anon não executa create_establishment');
select tests.expect_error($$select * from public.establishments$$, '42501', 'anon não lê establishments');
reset role;

select tests.login_as(null);
select tests.expect_error($$select public.create_establishment('Sem Login')$$, '28000',
  'create_establishment exige auth.uid()');
reset role;

select tests.login_as(current_setting('tests.a1')::uuid);
select tests.expect_true($$(select public.create_establishment('Barbearia Alfa', 'barbershop', '(82) 90000-0001')).slug = 'barbearia-alfa'$$,
  'A1 cria Barbearia Alfa (slug gerado)');
select tests.expect_error($$select public.create_establishment('a')$$, '22023', 'nome inválido é rejeitado');
select tests.expect_error($$select public.create_establishment('Valido', 'salon', null, 'Marte/Olympus')$$, '22023',
  'timezone inválido é rejeitado');
select tests.expect_error($$insert into public.establishments (name, slug) values ('Direto','direto')$$, '42501',
  'INSERT direto em establishments é negado');
select tests.expect_error($$insert into public.platform_admins (user_id) values (current_setting('tests.a1')::uuid)$$, '42501',
  'usuário não se autoatribui superadmin (INSERT)');
select tests.expect_error($$select * from public.platform_admins$$, '42501', 'usuário não lê platform_admins');
select tests.expect_true($$not private.is_superadmin()$$,
  'metadata {"role":"superadmin"} no cadastro NÃO concede superadmin');
select tests.expect_true($$public.is_platform_admin() = false$$, 'RPC is_platform_admin retorna false para usuário comum');
reset role;

select tests.login_as(current_setting('tests.b1')::uuid);
select tests.expect_true($$(select public.create_establishment('Salão Bravo', 'salon')).slug = 'salao-bravo'$$,
  'B1 cria Salão Bravo (acentos removidos do slug)');
reset role;

select set_config('tests.est_a', (select id::text from public.establishments where slug = 'barbearia-alfa'), false);
select set_config('tests.est_b', (select id::text from public.establishments where slug = 'salao-bravo'), false);
-- Fixture: assinatura paga somente no banco descartável; não libera contas reais.
update public.establishment_subscriptions set status='active', payment_due_at=null
 where establishment_id in (current_setting('tests.est_a')::uuid,current_setting('tests.est_b')::uuid);

select tests.expect_true($$(select count(*) from public.memberships
   where establishment_id = current_setting('tests.est_a')::uuid
     and user_id = current_setting('tests.a1')::uuid and role = 'owner' and is_active) = 1$$,
  'criador vira owner ativo do próprio estabelecimento');

-- Slug duplicado e limite de 3 estabelecimentos
select tests.login_as(current_setting('tests.y')::uuid);
select tests.expect_true($$(select public.create_establishment('Barbearia Alfa')).slug <> 'barbearia-alfa'$$,
  'slug duplicado recebe sufixo único');
select public.create_establishment('Yara Dois');
select public.create_establishment('Yara Três');
select tests.expect_error($$select public.create_establishment('Yara Quatro')$$, 'P0001',
  'limite de 3 estabelecimentos por proprietário');
reset role;

-- Equipe (convites ainda não existem na Etapa 1: inserção via SQL privilegiado)
insert into public.memberships (establishment_id, user_id, role) values
  (current_setting('tests.est_a')::uuid, current_setting('tests.a2')::uuid, 'staff'),
  (current_setting('tests.est_b')::uuid, current_setting('tests.b2')::uuid, 'staff');

insert into public.professionals (id, establishment_id, name) values
  ('c0000000-0000-0000-0000-00000000000a', current_setting('tests.est_a')::uuid, 'Profissional A'),
  ('c0000000-0000-0000-0000-00000000000b', current_setting('tests.est_b')::uuid, 'Profissional B');
insert into public.services (id, establishment_id, name, duration_minutes, price_cents) values
  ('c1000000-0000-0000-0000-00000000000a', current_setting('tests.est_a')::uuid, 'Corte A', 30, 5000),
  ('c1000000-0000-0000-0000-00000000000b', current_setting('tests.est_b')::uuid, 'Corte B', 30, 6000);
insert into public.customers (id, establishment_id, full_name) values
  ('c2000000-0000-0000-0000-00000000000a', current_setting('tests.est_a')::uuid, 'Cliente A'),
  ('c2000000-0000-0000-0000-00000000000b', current_setting('tests.est_b')::uuid, 'Cliente B');
insert into public.working_hours (establishment_id, professional_id, weekday, start_time, end_time) values
  (current_setting('tests.est_a')::uuid, 'c0000000-0000-0000-0000-00000000000a', 1, '09:00', '18:00'),
  (current_setting('tests.est_b')::uuid, 'c0000000-0000-0000-0000-00000000000b', 1, '09:00', '18:00');
-- Expediente amplo (demais dias) e vínculo: os INSERTs diretos autenticados mais abaixo passam pelas regras do trigger 0010.
insert into public.working_hours (establishment_id, professional_id, weekday, start_time, end_time)
select current_setting('tests.est_a')::uuid, 'c0000000-0000-0000-0000-00000000000a', wd, '00:00', '23:59' from generate_series(0, 6) wd where wd <> 1;
insert into public.professional_services (establishment_id, professional_id, service_id) values
  (current_setting('tests.est_a')::uuid, 'c0000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-00000000000a');
insert into public.schedule_blocks (establishment_id, starts_at, ends_at, reason) values
  (current_setting('tests.est_a')::uuid, '2030-01-01 12:00+00', '2030-01-01 13:00+00', 'Almoço A'),
  (current_setting('tests.est_b')::uuid, '2030-01-01 12:00+00', '2030-01-01 13:00+00', 'Almoço B');
set session_replication_role = replica;  -- fixture (dados históricos de duas empresas), sem passar pelas regras de agenda
insert into public.appointments (id, establishment_id, professional_id, service_id, customer_id, starts_at, ends_at, price_cents) values
  ('c3000000-0000-0000-0000-00000000000a', current_setting('tests.est_a')::uuid,
   'c0000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-00000000000a',
   'c2000000-0000-0000-0000-00000000000a', '2030-01-01 10:00+00', '2030-01-01 10:30+00', 5000),
  ('c3000000-0000-0000-0000-00000000000b', current_setting('tests.est_b')::uuid,
   'c0000000-0000-0000-0000-00000000000b', 'c1000000-0000-0000-0000-00000000000b',
   'c2000000-0000-0000-0000-00000000000b', '2030-01-01 10:00+00', '2030-01-01 10:30+00', 6000);
set session_replication_role = origin;

\warn '== 2. Proprietário A não enxerga nem altera a empresa B =='
select tests.login_as(current_setting('tests.a1')::uuid);
select tests.expect_count($$select 1 from public.establishments$$, 1, 'A1 enxerga apenas 1 estabelecimento');
select tests.expect_count($$select 1 from public.establishments where id = current_setting('tests.est_b')::uuid$$, 0,
  'A1 não lê o estabelecimento B');
do $$ declare t text; begin
  foreach t in array array['professionals','services','customers','working_hours','schedule_blocks','appointments','memberships'] loop
    perform tests.expect_count(format('select 1 from public.%I where establishment_id = current_setting(''tests.est_b'')::uuid', t), 0,
      'A1 não lê '||t||' da empresa B');
    perform tests.expect_true(format('(select count(*) from public.%I where establishment_id = current_setting(''tests.est_a'')::uuid) >= 1', t),
      'A1 lê '||t||' da própria empresa');
  end loop;
end $$;
select tests.expect_error($$insert into public.professionals (establishment_id, name) values (current_setting('tests.est_b')::uuid, 'Intruso')$$, '42501',
  'A1 não cria profissional na empresa B');
select tests.expect_error($$insert into public.services (establishment_id, name, duration_minutes, price_cents) values (current_setting('tests.est_b')::uuid, 'Intruso', 30, 1)$$, '42501',
  'A1 não cria serviço na empresa B');
select tests.expect_error($$insert into public.customers (establishment_id, full_name) values (current_setting('tests.est_b')::uuid, 'Intruso')$$, '42501',
  'A1 não cria cliente na empresa B');
select tests.expect_error($$insert into public.schedule_blocks (establishment_id, starts_at, ends_at) values (current_setting('tests.est_b')::uuid, now(), now() + interval '1 hour')$$, '42501',
  'A1 não cria bloqueio na empresa B');
select tests.expect_error($$insert into public.memberships (establishment_id, user_id, role) values (current_setting('tests.est_b')::uuid, current_setting('tests.a1')::uuid, 'owner')$$, '42501',
  'A1 não se autoatribui owner na empresa B');
select tests.expect_affected($$update public.services set name = 'Hackeado' where id = 'c1000000-0000-0000-0000-00000000000b'$$, 0, 'A1 não atualiza serviço de B');
select tests.expect_affected($$delete from public.customers where id = 'c2000000-0000-0000-0000-00000000000b'$$, 0, 'A1 não apaga cliente de B');
select tests.expect_affected($$delete from public.appointments where id = 'c3000000-0000-0000-0000-00000000000b'$$, 0, 'A1 não apaga agendamento de B');
select tests.expect_affected($$update public.establishments set name = 'Hackeado' where id = current_setting('tests.est_b')::uuid$$, 0, 'A1 não renomeia B');
select tests.expect_affected($$update public.memberships set is_active = false where establishment_id = current_setting('tests.est_b')::uuid$$, 0, 'A1 não desativa equipe de B');
select tests.expect_error($$update public.services set establishment_id = current_setting('tests.est_b')::uuid where id = 'c1000000-0000-0000-0000-00000000000a'$$, '42501',
  'A1 não "move" serviço próprio para a empresa B');
select tests.expect_error($$insert into public.appointments (establishment_id, professional_id, service_id, customer_id, starts_at, ends_at, price_cents)
  values (current_setting('tests.est_a')::uuid, 'c0000000-0000-0000-0000-00000000000b', 'c1000000-0000-0000-0000-00000000000a',
          'c2000000-0000-0000-0000-00000000000a', '2030-02-01 10:00+00', '2030-02-01 10:30+00', 1)$$, '23503',
  'FK composta barra agendamento A com profissional de B');
select tests.expect_error($$insert into public.appointments (establishment_id, professional_id, service_id, customer_id, starts_at, ends_at, price_cents)
  values (current_setting('tests.est_a')::uuid, 'c0000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-00000000000a',
          'c2000000-0000-0000-0000-00000000000a', '2030-01-01 10:15+00', '2030-01-01 10:45+00', 1)$$, '23P01',
  'mesmo profissional não pode ter dois atendimentos sobrepostos');
select tests.expect_error($$update public.memberships set role = 'owner' where user_id = current_setting('tests.a1')::uuid$$, '42501',
  'ninguém altera a própria role (privilégio de coluna)');
select tests.expect_error($$update public.memberships set user_id = current_setting('tests.b1')::uuid where user_id = current_setting('tests.a2')::uuid$$, '42501',
  'owner não troca user_id de vínculo');
select tests.expect_error($$update public.establishments set slug = 'novo-slug' where id = current_setting('tests.est_a')::uuid$$, '42501',
  'slug é imutável pelo cliente');
select tests.expect_affected($$update public.establishments set name = 'Barbearia Alfa Prime' where id = current_setting('tests.est_a')::uuid$$, 1,
  'owner renomeia a própria empresa');
select tests.expect_affected($$insert into public.professionals (establishment_id, name) values (current_setting('tests.est_a')::uuid, 'Novo Profissional')$$, 1,
  'owner cria profissional na própria empresa');
select tests.expect_affected($$insert into public.services (establishment_id, name, duration_minutes, price_cents) values (current_setting('tests.est_a')::uuid, 'Barba', 20, 3000)$$, 1,
  'owner cria serviço na própria empresa');
select tests.expect_true($$(select count(*) from public.profiles where id = current_setting('tests.a2')::uuid) = 1$$, 'A1 vê o perfil do colega de equipe');
select tests.expect_count($$select 1 from public.profiles where id = current_setting('tests.b1')::uuid$$, 0, 'A1 não vê perfil de usuário da empresa B');
select tests.expect_affected($$update public.profiles set full_name = 'Hack' where id = current_setting('tests.a2')::uuid$$, 0, 'A1 não edita perfil alheio');
select tests.expect_affected($$update public.profiles set full_name = 'Ana A.' where id = current_setting('tests.a1')::uuid$$, 1, 'A1 edita o próprio perfil');
reset role;

\warn '== 3. Funcionário A (staff): operação diária, sem poderes de dono =='
select tests.login_as(current_setting('tests.a2')::uuid);
select tests.expect_true($$(select count(*) from public.professionals where establishment_id = current_setting('tests.est_a')::uuid) >= 1$$, 'staff lê profissionais da própria empresa');
select tests.expect_count($$select 1 from public.professionals where establishment_id = current_setting('tests.est_b')::uuid$$, 0, 'staff A não lê profissionais de B');
select tests.expect_error($$insert into public.professionals (establishment_id, name) values (current_setting('tests.est_a')::uuid, 'Staff Cria')$$, '42501', 'staff não cria profissional');
select tests.expect_error($$insert into public.services (establishment_id, name, duration_minutes, price_cents) values (current_setting('tests.est_a')::uuid, 'Staff', 10, 1)$$, '42501', 'staff não cria serviço');
select tests.expect_affected($$update public.services set price_cents = 1 where id = 'c1000000-0000-0000-0000-00000000000a'$$, 0, 'staff não altera preço de serviço');
select tests.expect_affected($$delete from public.professionals where id = 'c0000000-0000-0000-0000-00000000000a'$$, 0, 'staff não apaga profissional');
select tests.expect_affected($$update public.establishments set name = 'Staff Renomeia' where id = current_setting('tests.est_a')::uuid$$, 0, 'staff não edita a empresa');
select tests.expect_affected($$update public.memberships set is_active = false where user_id = current_setting('tests.a1')::uuid$$, 0, 'staff não desativa o owner');
select tests.expect_affected($$update public.memberships set is_active = false where user_id = current_setting('tests.a2')::uuid$$, 0, 'staff não desativa o próprio vínculo');
select tests.expect_error($$insert into public.memberships (establishment_id, user_id, role) values (current_setting('tests.est_a')::uuid, current_setting('tests.a2')::uuid, 'owner')$$, '42501', 'staff não se promove a owner');
select tests.expect_affected($$insert into public.customers (establishment_id, full_name) values (current_setting('tests.est_a')::uuid, 'Cliente do Staff')$$, 1, 'staff cria cliente');
select tests.expect_error($$insert into public.customers (establishment_id, full_name) values (current_setting('tests.est_b')::uuid, 'Cliente Alheio')$$, '42501', 'staff A não cria cliente em B');
select tests.expect_affected($$insert into public.appointments (establishment_id, professional_id, service_id, customer_id, starts_at, ends_at, price_cents)
  values (current_setting('tests.est_a')::uuid, 'c0000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-00000000000a',
          'c2000000-0000-0000-0000-00000000000a', '2030-01-02 10:00+00', '2030-01-02 10:30+00', 5000)$$, 1, 'staff cria agendamento');
select tests.expect_true($$(select created_by from public.appointments where starts_at = '2030-01-02 10:00+00') = current_setting('tests.a2')::uuid$$,
  'created_by vem da sessão (trigger), não do cliente');
select tests.expect_error($$insert into public.appointments (establishment_id, professional_id, service_id, customer_id, starts_at, ends_at, price_cents, created_by)
  values (current_setting('tests.est_a')::uuid, 'c0000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-00000000000a',
          'c2000000-0000-0000-0000-00000000000a', '2030-01-03 10:00+00', '2030-01-03 10:30+00', 1, current_setting('tests.a1')::uuid)$$, '42501',
  'cliente não pode forjar created_by');
select tests.expect_affected($$update public.appointments set status = 'confirmed' where starts_at = '2030-01-02 10:00+00'$$, 1, 'staff atualiza status do agendamento');
select tests.expect_affected($$delete from public.appointments where starts_at = '2030-01-02 10:00+00'$$, 0, 'staff não apaga agendamento');
select tests.expect_affected($$delete from public.customers where full_name = 'Cliente do Staff'$$, 0, 'staff não apaga cliente');
select tests.expect_affected($$insert into public.schedule_blocks (establishment_id, starts_at, ends_at, reason) values (current_setting('tests.est_a')::uuid, '2030-03-01 12:00+00', '2030-03-01 13:00+00', 'Pausa')$$, 1, 'staff cria bloqueio de agenda');
select tests.expect_affected($$delete from public.schedule_blocks where reason = 'Pausa'$$, 1, 'staff remove bloqueio de agenda');
reset role;

\warn '== 4. Proprietário B não enxerga a empresa A =='
select tests.login_as(current_setting('tests.b1')::uuid);
select tests.expect_count($$select 1 from public.establishments where id = current_setting('tests.est_a')::uuid$$, 0, 'B1 não lê estabelecimento A');
do $$ declare t text; begin
  foreach t in array array['professionals','services','customers','working_hours','schedule_blocks','appointments','memberships'] loop
    perform tests.expect_count(format('select 1 from public.%I where establishment_id = current_setting(''tests.est_a'')::uuid', t), 0,
      'B1 não lê '||t||' da empresa A');
  end loop;
end $$;
select tests.expect_affected($$update public.customers set full_name = 'Hack' where id = 'c2000000-0000-0000-0000-00000000000a'$$, 0, 'B1 não atualiza cliente de A');
reset role;

\warn '== 5. Superadmin: leitura global, sem escrita em dados de negócio =='
select tests.login_as(current_setting('tests.su')::uuid);
select tests.expect_true($$private.is_superadmin()$$, 'superadmin é reconhecido (via platform_admins)');
select tests.expect_true($$public.is_platform_admin() = true$$, 'RPC is_platform_admin retorna true só para quem está em platform_admins');
select tests.expect_true($$(select count(*) from public.establishments where id in (current_setting('tests.est_a')::uuid, current_setting('tests.est_b')::uuid)) = 2$$, 'superadmin lê ambas as empresas');
select tests.expect_true($$(select count(*) from public.customers) >= 2$$, 'superadmin lê clientes de todas as empresas');
select tests.expect_error($$insert into public.services (establishment_id, name, duration_minutes, price_cents) values (current_setting('tests.est_a')::uuid, 'Super', 10, 1)$$, '42501', 'superadmin não escreve serviços de empresa (mínimo privilégio)');
select tests.expect_affected($$update public.establishments set name = 'Salão Bravo Suporte' where id = current_setting('tests.est_b')::uuid$$, 1, 'superadmin gerencia estabelecimentos');
select tests.expect_error($$insert into public.platform_admins (user_id) values (current_setting('tests.nobody')::uuid)$$, '42501', 'nem superadmin cria superadmin pela API');
reset role;

\warn '== 6. Usuário sem vínculo =='
select tests.login_as(current_setting('tests.nobody')::uuid);
select tests.expect_count($$select 1 from public.establishments$$, 0, 'sem vínculo: nenhuma empresa visível');
select tests.expect_count($$select 1 from public.customers$$, 0, 'sem vínculo: nenhum cliente visível');
select tests.expect_count($$select 1 from public.profiles$$, 1, 'sem vínculo: só o próprio perfil');
select tests.expect_count($$select 1 from public.memberships$$, 0, 'sem vínculo: nenhum vínculo');
reset role;

\warn '== 7. Ciclo de vida da equipe =='
select tests.login_as(current_setting('tests.a1')::uuid);
select tests.expect_affected($$update public.memberships set is_active = false where user_id = current_setting('tests.a2')::uuid$$, 1, 'owner desativa funcionário');
select tests.expect_affected($$update public.memberships set is_active = false where user_id = current_setting('tests.a1')::uuid$$, 0, 'owner não desativa a si mesmo por esta via');
reset role;
select tests.login_as(current_setting('tests.a2')::uuid);
select tests.expect_count($$select 1 from public.professionals$$, 0, 'funcionário desativado perde acesso aos dados');
select tests.expect_count($$select 1 from public.establishments$$, 0, 'funcionário desativado não vê a empresa');
reset role;
select tests.login_as(current_setting('tests.a1')::uuid);
select tests.expect_affected($$delete from public.memberships where user_id = current_setting('tests.a2')::uuid$$, 1, 'owner remove funcionário');
select tests.expect_affected($$delete from public.memberships where user_id = current_setting('tests.a1')::uuid$$, 0, 'owner não remove o próprio vínculo de owner');
reset role;

\warn '== Fim: nenhuma consulta entrou em recursão de RLS =='
