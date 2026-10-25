\set ON_ERROR_STOP on
set client_min_messages = notice;

-- Tenant isolation and aggregate correctness: fake users only, disposable CI database.
insert into auth.users(id,email) values
('e3000000-0000-0000-0000-000000000001','platform.owner@test.invalid'),
('e3000000-0000-0000-0000-000000000002','platform.other@test.invalid'),
('e3000000-0000-0000-0000-000000000003','platform.admin@test.invalid');

select set_config('request.jwt.claim.sub','e3000000-0000-0000-0000-000000000001',false);
set role authenticated;
select public.create_establishment('Painel Resumo Teste');
do $$ begin
  begin
    perform public.platform_overview();
    raise exception 'FAIL normal owner accessed overview';
  exception when insufficient_privilege then
    raise notice 'PASS normal owner denied global overview';
  end;
end $$;
reset role;

do $$ begin
  if has_function_privilege('anon','public.platform_overview()','EXECUTE') then
    raise exception 'FAIL anonymous has overview permission';
  end if;
  raise notice 'PASS anonymous has no RPC privilege';
end $$;

insert into public.platform_admins(user_id) values ('e3000000-0000-0000-0000-000000000003');
select set_config('request.jwt.claim.sub','e3000000-0000-0000-0000-000000000003',false);
set role authenticated;
do $$
declare v jsonb;
begin
  v := public.platform_overview();
  if (v #>> '{summary,establishments}')::int <> 1 then
    raise exception 'FAIL establishment count';
  end if;
  if (v #>> '{summary,registered_users}')::int <> 3 then
    raise exception 'FAIL registered users count';
  end if;
  if (v #>> '{summary,active_contracts}')::int <> 0 then
    raise exception 'FAIL active contract count';
  end if;
  if (v #>> '{summary,contracted_mrr_cents}')::bigint <> 0 then
    raise exception 'FAIL zero contracted revenue';
  end if;
  if jsonb_array_length(v->'establishments') <> 1 then
    raise exception 'FAIL establishment list';
  end if;
  raise notice 'PASS admin sees reliable platform totals and bounded list';
end $$;
reset role;

select set_config('request.jwt.claim.sub','e3000000-0000-0000-0000-000000000002',false);
set role authenticated;
do $$ begin
  begin
    perform public.platform_overview();
    raise exception 'FAIL unrelated user accessed overview';
  exception when insufficient_privilege then
    raise notice 'PASS unrelated user denied global overview';
  end;
end $$;
reset role;
