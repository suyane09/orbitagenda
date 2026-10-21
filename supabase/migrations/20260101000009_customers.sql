-- Orbit Agenda · Etapa 2 · 0009 · Clientes
-- Incremental sobre public.customers (RLS e grants da 0004/0005 permanecem:
-- membros leem/criam/editam; só o proprietário exclui; FK composta isola por empresa).

-- 1) Normalização no banco (o cliente não é confiável) ------------------------------
create function private.normalize_customer()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.full_name := btrim(regexp_replace(new.full_name, '\s+', ' ', 'g'));
  new.phone     := nullif(btrim(regexp_replace(coalesce(new.phone, ''), '\s+', ' ', 'g')), '');
  new.email     := nullif(lower(btrim(coalesce(new.email, ''))), '');
  new.notes     := nullif(btrim(new.notes), '');
  return new;
end;
$$;
revoke all on function private.normalize_customer() from public, anon, authenticated;

create trigger normalize_customer before insert or update on public.customers
  for each row execute function private.normalize_customer();

-- 2) Formato mínimo (NOT VALID: não reprova dados antigos, vale para novas escritas) ---
alter table public.customers
  add constraint customers_email_format
    check (email is null or email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') not valid,
  add constraint customers_phone_digits
    check (phone is null or char_length(regexp_replace(phone, '\D', '', 'g')) between 8 and 15) not valid;

-- 3) Duplicidade por estabelecimento ----------------------------------------------
-- Telefone comparado só pelos dígitos, ignorando o DDI 55 (+55 79 99999-0000 = (79) 99999-0000).
-- Se já houver duplicados no banco, o índice falha: unifique-os antes de aplicar.
create unique index customers_phone_uq on public.customers (
  establishment_id,
  (regexp_replace(regexp_replace(phone, '\D', '', 'g'), '^55(\d{10,11})$', '\1'))
) where phone is not null;
create unique index customers_email_uq on public.customers (establishment_id, email) where email is not null;

-- 4) Apoio a busca e ao histórico ----------------------------------------------------
create index customers_est_name_idx on public.customers (establishment_id, lower(full_name));
create index appointments_customer_idx on public.appointments (customer_id, starts_at desc);
