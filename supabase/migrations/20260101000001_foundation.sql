-- Orbit Agenda · Etapa 1 · 0001 · Fundação
-- Schemas, extensões, enums e funções-trigger genéricas.

create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;

-- Schema NÃO exposto pelo PostgREST: abriga helpers usados por RLS.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create type public.membership_role as enum ('owner', 'staff');
create type public.business_type as enum ('barbershop', 'salon', 'other');
create type public.appointment_status as enum
  ('scheduled', 'confirmed', 'completed', 'cancelled', 'no_show');

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Defesa em profundidade: uma linha nunca muda de empresa depois de criada.
create function private.prevent_tenant_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.establishment_id is distinct from old.establishment_id then
    raise exception 'establishment_id is immutable'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- created_by vem sempre da sessão autenticada, nunca do cliente.
create function private.set_created_by()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.created_by := (select auth.uid());
  return new;
end;
$$;
