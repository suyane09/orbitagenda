-- Rate limiting persistente: contagem, bloqueio, janelas, permissões.
\set ON_ERROR_STOP on
set client_min_messages = notice;
do $$
declare r record; i int; denied int := 0;
begin
  for i in 1..5 loop
    select * into r from public.check_rate_limit('test-key-aaaa', 3, 600);
    if not r.allowed then denied := denied + 1; end if;
  end loop;
  if denied = 2 and r.retry_after between 1 and 600 then raise notice 'PASS  3 permitidas, 2 bloqueadas, retry_after válido';
  else raise notice 'FAIL  contagem (denied=%, retry=%)', denied, r.retry_after; end if;

  select * into r from public.check_rate_limit('test-key-bbbb', 3, 600);
  if r.allowed then raise notice 'PASS  chaves independentes'; else raise notice 'FAIL  chaves independentes'; end if;

  begin perform * from public.check_rate_limit('x', 3, 600); raise notice 'FAIL  chave curta aceita';
  exception when sqlstate '22023' then raise notice 'PASS  chave curta rejeitada'; end;
  begin perform * from public.check_rate_limit('test-key-cccc', 0, 600); raise notice 'FAIL  limite 0 aceito';
  exception when sqlstate '22023' then raise notice 'PASS  limite inválido rejeitado'; end;
end $$;

-- anon/authenticated não executam nem leem a tabela
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;
do $$
declare ok boolean;
begin
  ok := not has_function_privilege('anon', 'public.check_rate_limit(text,integer,integer)', 'execute')
    and not has_function_privilege('authenticated', 'public.check_rate_limit(text,integer,integer)', 'execute')
    and not has_table_privilege('anon', 'public.rate_limit_buckets', 'select')
    and not has_table_privilege('authenticated', 'public.rate_limit_buckets', 'select');
  if ok then raise notice 'PASS  anon/authenticated sem acesso'; else raise notice 'FAIL  permissões abertas'; end if;
  if has_function_privilege('service_role', 'public.check_rate_limit(text,integer,integer)', 'execute') then raise notice 'PASS  service_role executa'; else raise notice 'FAIL  service_role sem execute'; end if;
end $$;
