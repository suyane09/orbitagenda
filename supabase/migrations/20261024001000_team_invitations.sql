-- Convites de equipe: token secreto retornado uma única vez ao proprietário.
-- SQL instalado independentemente do histórico antigo de migrações.
create table public.team_invitations (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  email text not null,
  token_hash text not null unique,
  invited_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  revoked_at timestamptz,
  constraint team_invitation_email_valid check (
    length(email) between 3 and 254 and email = lower(btrim(email))
    and email ~ '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$'
  )
);
create index team_invitations_establishment_idx on public.team_invitations (establishment_id, created_at desc);
create index team_invitations_email_idx on public.team_invitations (email);
alter table public.team_invitations enable row level security;
revoke all on public.team_invitations from public, anon, authenticated;
grant select on public.team_invitations to authenticated;
create policy team_invitations_owner_select on public.team_invitations
  for select to authenticated using (private.is_owner(establishment_id));

create function public.create_team_invitation(p_establishment_id uuid, p_email text)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email,'')));
  v_token text;
begin
  if auth.uid() is null or not private.is_owner(p_establishment_id) then
    raise exception 'forbidden' using errcode='42501';
  end if;
  if length(v_email) not between 3 and 254
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$' then
    raise exception 'invalid_email' using errcode='22023';
  end if;
  -- Evita gerar convites para membros que já têm acesso ativo.
  if exists (
    select 1 from public.memberships m join auth.users u on u.id=m.user_id
    where m.establishment_id=p_establishment_id
      and lower(u.email)=v_email and m.is_active
  ) then
    raise exception 'already_member' using errcode='23505';
  end if;
  perform 1 from public.establishments where id=p_establishment_id for update;
  if (select count(*) from public.team_invitations
      where establishment_id=p_establishment_id
        and invited_by=auth.uid() and created_at>now()-interval '1 day') >= 20
     or (select count(*) from public.team_invitations
      where establishment_id=p_establishment_id
        and accepted_at is null and revoked_at is null and expires_at>now()) >= 10 then
    raise exception 'invitation_limit_reached' using errcode='22023';
  end if;
  update public.team_invitations set revoked_at=now()
    where establishment_id=p_establishment_id and email=v_email
      and accepted_at is null and revoked_at is null;
  v_token := encode(extensions.gen_random_bytes(32),'hex');
  insert into public.team_invitations(establishment_id,email,token_hash,invited_by)
    values (p_establishment_id,v_email,encode(extensions.digest(v_token,'sha256'),'hex'),auth.uid());
  return v_token;
end $$;

create function public.accept_team_invitation(p_token text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_inv public.team_invitations%rowtype;
  v_email text;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode='42501'; end if;
  if p_token is null or length(p_token) <> 64 or p_token !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_invitation' using errcode='22023';
  end if;
  select lower(email) into v_email from auth.users
    where id=auth.uid() and email_confirmed_at is not null;
  if v_email is null then raise exception 'verified_email_required' using errcode='42501'; end if;
  select * into v_inv from public.team_invitations
    where token_hash=encode(extensions.digest(p_token,'sha256'),'hex')
      and email=v_email and accepted_at is null and revoked_at is null
      and expires_at>now() for update;
  if not found then raise exception 'invalid_or_expired_invitation' using errcode='42501'; end if;
  insert into public.memberships(establishment_id,user_id,role,is_active)
    values(v_inv.establishment_id,auth.uid(),'staff',true)
    on conflict (establishment_id,user_id)
    do update set is_active=true
      where public.memberships.role='staff';
  if not found then raise exception 'membership_conflict' using errcode='42501'; end if;
  update public.team_invitations set accepted_at=now() where id=v_inv.id;
  return v_inv.establishment_id;
end $$;

create function public.revoke_team_invitation(p_invitation_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_est uuid;
begin
  select establishment_id into v_est from public.team_invitations where id=p_invitation_id;
  if v_est is null or auth.uid() is null or not private.is_owner(v_est) then
    raise exception 'forbidden' using errcode='42501';
  end if;
  update public.team_invitations set revoked_at=now()
    where id=p_invitation_id and accepted_at is null and revoked_at is null;
end $$;
revoke all on function public.create_team_invitation(uuid,text) from public,anon;
revoke all on function public.accept_team_invitation(text) from public,anon;
revoke all on function public.revoke_team_invitation(uuid) from public,anon;
grant execute on function public.create_team_invitation(uuid,text) to authenticated;
grant execute on function public.accept_team_invitation(text) to authenticated;
grant execute on function public.revoke_team_invitation(uuid) to authenticated;
