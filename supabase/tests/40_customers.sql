-- Etapa 2 · Clientes — cadastro, duplicidade, permissões e isolamento (banco real).
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
-- Fixture: assinatura paga somente no banco descartável; não libera contas reais.
update public.establishment_subscriptions set status='active', payment_due_at=null
 where establishment_id in (current_setting('tests.est_a')::uuid,current_setting('tests.est_b')::uuid);
insert into public.memberships (establishment_id, user_id, role) values (current_setting('tests.est_a')::uuid, current_setting('tests.s_a')::uuid, 'staff');

\warn '== Cadastro e normalização =='
select tests.login_as(current_setting('tests.s_a')::uuid);
insert into public.customers (establishment_id, full_name, phone, email, notes)
values (current_setting('tests.est_a')::uuid, '  Ana   Souza ', ' (79) 99999-0000 ', '  ANA@Exemplo.COM ', '   ');
select tests.expect_true($$(select full_name = 'Ana Souza' and phone = '(79) 99999-0000' and email = 'ana@exemplo.com' and notes is null from public.customers)$$,
  'staff cadastra; nome, telefone e e-mail normalizados; observação em branco vira null');
select tests.expect_error($$insert into public.customers (establishment_id, full_name) values (current_setting('tests.est_a')::uuid, ' ')$$, '23514', 'nome em branco é rejeitado');
select tests.expect_error($$insert into public.customers (establishment_id, full_name, email) values (current_setting('tests.est_a')::uuid, 'Sem arroba', 'abc')$$, '23514', 'e-mail inválido é rejeitado');
select tests.expect_error($$insert into public.customers (establishment_id, full_name, phone) values (current_setting('tests.est_a')::uuid, 'Tel curto', '123')$$, '23514', 'telefone com poucos dígitos é rejeitado');
select tests.expect_error($$insert into public.customers (establishment_id, full_name, notes) values (current_setting('tests.est_a')::uuid, 'Obs longa', repeat('x', 1001))$$, '23514', 'observação > 1000 caracteres é rejeitada');

\warn '== Duplicidade =='
select tests.expect_error($$insert into public.customers (establishment_id, full_name, phone) values (current_setting('tests.est_a')::uuid, 'Outra Ana', '79999990000')$$, '23505', 'mesmo telefone com outra formatação é duplicado');
select tests.expect_error($$insert into public.customers (establishment_id, full_name, phone) values (current_setting('tests.est_a')::uuid, 'Outra Ana', '+55 79 99999-0000')$$, '23505', 'mesmo telefone com DDI 55 é duplicado');
select tests.expect_error($$insert into public.customers (establishment_id, full_name, email) values (current_setting('tests.est_a')::uuid, 'Outra Ana', 'Ana@exemplo.com')$$, '23505', 'e-mail duplicado (sem diferenciar maiúsculas)');
insert into public.customers (establishment_id, full_name, phone) values (current_setting('tests.est_a')::uuid, 'Bruno', '79 98888-1111');
insert into public.customers (establishment_id, full_name) values (current_setting('tests.est_a')::uuid, 'Sem contato 1'), (current_setting('tests.est_a')::uuid, 'Sem contato 2');
select tests.expect_true($$(select count(*) from public.customers) = 4$$, 'clientes sem telefone/e-mail não colidem entre si');
select tests.expect_error($$update public.customers set phone = '(79) 99999-0000' where full_name = 'Bruno'$$, '23505', 'editar para telefone de outro cliente é rejeitado');
select tests.expect_affected($$update public.customers set phone = '(79) 98888-1111', notes = 'VIP' where full_name = 'Bruno'$$, 1, 'editar mantendo o próprio telefone é permitido');
reset role;

select tests.login_as(current_setting('tests.o_b')::uuid);
select tests.expect_true($$(select count(*) from public.customers) = 0$$, 'empresa B não enxerga clientes da A');
insert into public.customers (establishment_id, full_name, phone, email) values (current_setting('tests.est_b')::uuid, 'Ana Souza', '(79) 99999-0000', 'ana@exemplo.com');
select tests.expect_true($$(select count(*) from public.customers) = 1$$, 'mesmo telefone/e-mail pode existir em outra empresa');
select tests.expect_error($$insert into public.customers (establishment_id, full_name) values (current_setting('tests.est_a')::uuid, 'Invasor')$$, '42501', 'owner B não cria cliente na empresa A');
select tests.expect_affected($$update public.customers set full_name = 'X' where full_name = 'Bruno'$$, 0, 'owner B não edita cliente da A');
select tests.expect_affected($$delete from public.customers where full_name = 'Bruno'$$, 0, 'owner B não exclui cliente da A');
reset role;

\warn '== Exclusão e histórico =='
select tests.login_as(current_setting('tests.s_a')::uuid);
select tests.expect_affected($$delete from public.customers where full_name = 'Sem contato 1'$$, 0, 'staff não exclui cliente');
select tests.expect_error($$update public.customers set establishment_id = current_setting('tests.est_b')::uuid where full_name = 'Bruno'$$, '42501', 'cliente não troca de empresa');
reset role;
select tests.login_as(current_setting('tests.o_a')::uuid);
select public.save_professional(current_setting('tests.est_a')::uuid, null, 'João', null, null, true, '{}');
insert into public.services (establishment_id, name, duration_minutes, price_cents) values (current_setting('tests.est_a')::uuid, 'Corte', 30, 4500);
reset role;
set session_replication_role = replica;  -- fixture de histórico, sem passar pelas regras de agenda
insert into public.appointments (establishment_id, professional_id, service_id, customer_id, starts_at, ends_at, price_cents)
select current_setting('tests.est_a')::uuid, p.id, s.id, c.id, now() + interval '2 days', now() + interval '2 days 30 minutes', 4500
  from public.professionals p, public.services s, public.customers c where c.full_name = 'Bruno';
set session_replication_role = origin;
select tests.login_as(current_setting('tests.o_a')::uuid);
select tests.expect_error($$delete from public.customers where full_name = 'Bruno'$$, '23503', 'cliente com agendamento não pode ser excluído');
select tests.expect_affected($$delete from public.customers where full_name = 'Sem contato 1'$$, 1, 'owner exclui cliente sem histórico');
reset role;

select tests.login_anon();
select tests.expect_error($$select * from public.customers$$, '42501', 'anon não lê clientes');
reset role;
