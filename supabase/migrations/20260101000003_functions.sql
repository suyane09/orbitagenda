-- Orbit Agenda · Etapa 1 · 0003 · Funções privilegiadas
-- Todas SECURITY DEFINER com search_path vazio (nomes sempre qualificados).
-- Helpers de RLS leem as tabelas como dono (que ignora RLS), o que evita
-- recursão infinita nas políticas. Nada aqui lê papel/empresa vindos do cliente.

create function private.is_superadmin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.platform_admins pa
    where pa.user_id = (select auth.uid())
  );
$$;

create function private.is_member(p_establishment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.establishment_id = p_establishment_id
      and m.user_id = (select auth.uid())
      and m.is_active
  );
$$;

create function private.is_owner(p_establishment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.establishment_id = p_establishment_id
      and m.user_id = (select auth.uid())
      and m.is_active
      and m.role = 'owner'
  );
$$;

-- O usuário logado e p_user_id participam de algum estabelecimento em comum?
create function private.shares_establishment_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships mine
    join public.memberships theirs
      on theirs.establishment_id = mine.establishment_id
    where mine.user_id = (select auth.uid())
      and mine.is_active
      and theirs.user_id = p_user_id
      and theirs.is_active
  );
$$;

-- Cria o perfil quando um usuário se cadastra. Ignora qualquer "role" enviado
-- em raw_user_meta_data: só o nome é aproveitado.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    left(
      coalesce(
        nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
        nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
        'Usuário'
      ),
      120
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Única porta de entrada para criar um estabelecimento.
-- O dono é SEMPRE auth.uid(); o cliente não informa user_id, role nem establishment_id.
create function public.create_establishment(
  p_name           text,
  p_business_type  public.business_type default 'barbershop',
  p_phone          text default null,
  p_timezone       text default 'America/Sao_Paulo'
)
returns public.establishments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_name  text := btrim(coalesce(p_name, ''));
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_base  text;
  v_slug  text;
  v_row   public.establishments;
  v_try   integer := 0;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  if char_length(v_name) not between 2 and 80 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;

  if v_phone is not null and char_length(v_phone) > 30 then
    raise exception 'invalid_phone' using errcode = '22023';
  end if;

  if not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = p_timezone) then
    raise exception 'invalid_timezone' using errcode = '22023';
  end if;

  -- Limite anti-abuso: no máximo 3 estabelecimentos por proprietário.
  if (select count(*) from public.memberships m
      where m.user_id = v_uid and m.role = 'owner') >= 3 then
    raise exception 'establishment_limit_reached' using errcode = 'P0001';
  end if;

  v_base := regexp_replace(
              translate(lower(v_name),
                        'áàâãäéèêëíìîïóòôõöúùûüçñ',
                        'aaaaaeeeeiiiiooooouuuucn'),
              '[^a-z0-9]+', '-', 'g');
  v_base := btrim(left(v_base, 40), '-');
  if char_length(v_base) < 3 then
    v_base := 'estabelecimento';
  end if;

  loop
    v_slug := case when v_try = 0 then v_base
                   else v_base || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6) end;
    begin
      insert into public.establishments (name, slug, business_type, phone, timezone, created_by)
      values (v_name, v_slug, p_business_type, v_phone, p_timezone, v_uid)
      returning * into v_row;
      exit;
    exception when unique_violation then
      v_try := v_try + 1;
      if v_try > 5 then raise; end if;
    end;
  end loop;

  insert into public.memberships (establishment_id, user_id, role)
  values (v_row.id, v_uid, 'owner');

  return v_row;
end;
$$;
