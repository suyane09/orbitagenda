-- Orbit Agenda · Etapa 2 · 0007 · Catálogo: serviços e profissionais
-- Incremental: não recria tabelas existentes. Revise antes de aplicar (supabase db push).

-- 1) Serviços: categoria e teto de preço (R$ 100.000,00) ----------------------
alter table public.services
  add column category text
    check (category is null or char_length(category) between 1 and 40);

alter table public.services
  add constraint services_price_max check (price_cents <= 10000000);

-- Nome de serviço único por estabelecimento, sem diferenciar maiúsculas.
create unique index services_establishment_name_uq
  on public.services (establishment_id, lower(name));

grant insert (category) on public.services to authenticated;
grant update (category) on public.services to authenticated;

-- 2) Normalização de texto no banco (o cliente não é confiável) ----------------
-- Roda ANTES dos CHECKs: "   " vira "" e é rejeitado; espaços repetidos são colapsados.
create function private.normalize_service()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.name        := btrim(regexp_replace(new.name, '\s+', ' ', 'g'));
  new.description := nullif(btrim(new.description), '');
  new.category    := nullif(btrim(regexp_replace(coalesce(new.category, ''), '\s+', ' ', 'g')), '');
  return new;
end;
$$;

create function private.normalize_professional()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.name := btrim(regexp_replace(new.name, '\s+', ' ', 'g'));
  new.bio  := nullif(btrim(new.bio), '');
  return new;
end;
$$;

revoke all on function private.normalize_service()      from public, anon, authenticated;
revoke all on function private.normalize_professional() from public, anon, authenticated;

create trigger normalize_service before insert or update on public.services
  for each row execute function private.normalize_service();
create trigger normalize_professional before insert or update on public.professionals
  for each row execute function private.normalize_professional();

-- 3) Vínculo profissional ↔ serviço --------------------------------------------
-- FKs compostas: profissional e serviço precisam ser da MESMA empresa da linha.
create table public.professional_services (
  establishment_id  uuid not null references public.establishments (id) on delete cascade,
  professional_id   uuid not null,
  service_id        uuid not null,
  created_at        timestamptz not null default now(),
  primary key (professional_id, service_id),
  foreign key (professional_id, establishment_id)
    references public.professionals (id, establishment_id) on delete cascade,
  foreign key (service_id, establishment_id)
    references public.services (id, establishment_id) on delete cascade
);
create index professional_services_service_idx on public.professional_services (service_id);
create index professional_services_est_idx     on public.professional_services (establishment_id);

alter table public.professional_services enable row level security;

create policy professional_services_select on public.professional_services for select to authenticated
  using (private.is_member(establishment_id) or private.is_superadmin());
create policy professional_services_insert on public.professional_services for insert to authenticated
  with check (private.is_owner(establishment_id));
create policy professional_services_delete on public.professional_services for delete to authenticated
  using (private.is_owner(establishment_id));

grant select on public.professional_services to authenticated;
grant insert (establishment_id, professional_id, service_id) on public.professional_services to authenticated;
grant delete on public.professional_services to authenticated;

-- 4) Salvar profissional + serviços de forma atômica ---------------------------
-- SECURITY INVOKER: tudo passa pelo RLS e pelos grants do usuário logado.
-- O teste de papel é explícito só para dar um erro claro (42501) antes de qualquer escrita.
create function public.save_professional(
  p_establishment_id  uuid,
  p_id                uuid,
  p_name              text,
  p_bio               text,
  p_color             text,
  p_is_active         boolean,
  p_service_ids       uuid[]
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id   uuid;
  v_ids  uuid[] := coalesce(p_service_ids, '{}');
begin
  if not private.is_owner(p_establishment_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if cardinality(v_ids) > 100 then
    raise exception 'too_many_services' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.professionals (establishment_id, name, bio, color, is_active)
    values (p_establishment_id, p_name, p_bio,
            coalesce(p_color, '#3B36D9'), coalesce(p_is_active, true))
    returning id into v_id;
  else
    update public.professionals pr
       set name      = p_name,
           bio       = p_bio,
           color     = coalesce(p_color, pr.color),
           is_active = coalesce(p_is_active, pr.is_active)
     where pr.id = p_id and pr.establishment_id = p_establishment_id
    returning pr.id into v_id;
    if v_id is null then
      raise exception 'professional_not_found' using errcode = 'P0002';
    end if;
  end if;

  delete from public.professional_services ps
   where ps.professional_id = v_id and ps.service_id <> all (v_ids);

  insert into public.professional_services (establishment_id, professional_id, service_id)
  select distinct p_establishment_id, v_id, s.service_id
    from unnest(v_ids) as s(service_id)
  on conflict do nothing;

  return v_id;
end;
$$;

revoke all on function public.save_professional(uuid, uuid, text, text, text, boolean, uuid[])
  from public, anon, authenticated;
grant execute on function public.save_professional(uuid, uuid, text, text, text, boolean, uuid[])
  to authenticated;
