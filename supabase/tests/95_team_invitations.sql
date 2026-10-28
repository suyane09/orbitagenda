\set ON_ERROR_STOP on
set client_min_messages = notice;
insert into auth.users(id,email,email_confirmed_at) values
 ('e9000000-0000-0000-0000-000000000001','owner@team.invalid',now()),
 ('e9000000-0000-0000-0000-000000000002','worker@team.invalid',now()),
 ('e9000000-0000-0000-0000-000000000003','attacker@team.invalid',now());
select set_config('request.jwt.claim.sub','e9000000-0000-0000-0000-000000000001',false);
set role authenticated;
select public.create_establishment('Equipe Teste', 'barbershop');
reset role;
select set_config('tests.team_est',(select id::text from public.establishments where slug='equipe-teste'),false);
-- Ensure fixture has an active subscription before testing team writes.
update public.establishment_subscriptions set status='active',current_period_end=null where establishment_id=current_setting('tests.team_est')::uuid;
set role authenticated;
select set_config('tests.invitation',public.create_team_invitation(current_setting('tests.team_est')::uuid,'worker@team.invalid'),false);
do $$ begin
 if length(current_setting('tests.invitation')) <> 64 then raise exception 'FAIL convite'; end if;
 raise notice 'PASS convite gerado com token forte';
end $$;
reset role;
select set_config('request.jwt.claim.sub','e9000000-0000-0000-0000-000000000003',false);
set role authenticated;
do $$ begin
 begin
  perform public.accept_team_invitation(current_setting('tests.invitation'));
  raise exception 'FAIL convite usado por email diferente';
 exception when insufficient_privilege then raise notice 'PASS convite preso ao email correto'; end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','e9000000-0000-0000-0000-000000000002',false);
set role authenticated;
do $$ declare est uuid; begin
 est := public.accept_team_invitation(current_setting('tests.invitation'));
 if est <> current_setting('tests.team_est')::uuid then raise exception 'FAIL estabelecimento errado'; end if;
 raise notice 'PASS convite aceito com conta verificada';
end $$;
do $$ begin
 if (select count(*) from public.memberships where user_id=auth.uid() and role='staff' and is_active) <> 1 then
   raise exception 'FAIL associacao de funcionario';
 end if;
 raise notice 'PASS membro recebe papel staff';
end $$;
do $$ begin
 begin
  perform public.accept_team_invitation(current_setting('tests.invitation'));
  raise exception 'FAIL token pode ser reutilizado';
 exception when insufficient_privilege then raise notice 'PASS token de uso único'; end;
end $$;
do $$ begin
 begin
  perform public.create_team_invitation(current_setting('tests.team_est')::uuid,'nobody@team.invalid');
  raise exception 'FAIL funcionario gerou convite';
 exception when insufficient_privilege then raise notice 'PASS funcionario nao cria convite'; end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','e9000000-0000-0000-0000-000000000001',false);
set role authenticated;
select set_config('tests.revoked',public.create_team_invitation(current_setting('tests.team_est')::uuid,'other@team.invalid'),false);
select public.revoke_team_invitation((select id from public.team_invitations where email='other@team.invalid'));
do $$ begin
 if (select count(*) from public.team_invitations where email='other@team.invalid' and revoked_at is not null) <> 1 then
 raise exception 'FAIL revogacao'; end if;
 raise notice 'PASS convite revogado';
end $$;
reset role;
