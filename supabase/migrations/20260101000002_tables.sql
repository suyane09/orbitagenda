-- Orbit Agenda · Etapa 1 · 0002 · Tabelas
-- Toda tabela de negócio carrega establishment_id. FKs compostas
-- (id, establishment_id) garantem que filhos só referenciem pais da MESMA empresa.

-- Perfil público do usuário (1:1 com auth.users). Criado por trigger.
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text not null check (char_length(full_name) between 1 and 120),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Superadmins da plataforma. Sem grants para anon/authenticated e sem policies:
-- só é possível inserir via SQL com role privilegiado (SQL Editor / service role).
create table public.platform_admins (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now()
);

create table public.establishments (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (char_length(name) between 2 and 80),
  slug           text not null unique
                 check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 3 and 60),
  business_type  public.business_type not null default 'barbershop',
  phone          text check (phone is null or char_length(phone) <= 30),
  timezone       text not null default 'America/Sao_Paulo',
  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table public.memberships (
  id                uuid primary key default gen_random_uuid(),
  establishment_id  uuid not null references public.establishments (id) on delete cascade,
  user_id           uuid not null references auth.users (id) on delete cascade,
  role              public.membership_role not null,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  unique (establishment_id, user_id),
  unique (id, establishment_id)
);
create index memberships_user_id_idx on public.memberships (user_id);
-- No máximo um proprietário "principal" não é exigido; vários owners são permitidos.

create table public.professionals (
  id                uuid primary key default gen_random_uuid(),
  establishment_id  uuid not null references public.establishments (id) on delete cascade,
  membership_id     uuid,
  name              text not null check (char_length(name) between 2 and 80),
  bio               text check (bio is null or char_length(bio) <= 500),
  color             text not null default '#3B36D9' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (id, establishment_id),
  foreign key (membership_id, establishment_id)
    references public.memberships (id, establishment_id)
    on delete set null (membership_id)
);
create index professionals_establishment_idx on public.professionals (establishment_id);

create table public.services (
  id                uuid primary key default gen_random_uuid(),
  establishment_id  uuid not null references public.establishments (id) on delete cascade,
  name              text not null check (char_length(name) between 2 and 80),
  description       text check (description is null or char_length(description) <= 500),
  duration_minutes  integer not null check (duration_minutes between 5 and 720),
  price_cents       integer not null check (price_cents >= 0),
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (id, establishment_id)
);
create index services_establishment_idx on public.services (establishment_id);

create table public.customers (
  id                uuid primary key default gen_random_uuid(),
  establishment_id  uuid not null references public.establishments (id) on delete cascade,
  full_name         text not null check (char_length(full_name) between 2 and 120),
  phone             text check (phone is null or char_length(phone) <= 30),
  email             text check (email is null or char_length(email) <= 254),
  notes             text check (notes is null or char_length(notes) <= 1000),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (id, establishment_id)
);
create index customers_establishment_idx on public.customers (establishment_id);

create table public.working_hours (
  id                uuid primary key default gen_random_uuid(),
  establishment_id  uuid not null references public.establishments (id) on delete cascade,
  professional_id   uuid not null,
  weekday           smallint not null check (weekday between 0 and 6), -- 0 = domingo
  start_time        time not null,
  end_time          time not null,
  created_at        timestamptz not null default now(),
  check (end_time > start_time),
  unique (professional_id, weekday, start_time),
  foreign key (professional_id, establishment_id)
    references public.professionals (id, establishment_id) on delete cascade
);
create index working_hours_establishment_idx on public.working_hours (establishment_id);

-- professional_id nulo = bloqueio da agenda inteira do estabelecimento.
-- (FK composta com coluna nula não é verificada; é o comportamento desejado.)
create table public.schedule_blocks (
  id                uuid primary key default gen_random_uuid(),
  establishment_id  uuid not null references public.establishments (id) on delete cascade,
  professional_id   uuid,
  starts_at         timestamptz not null,
  ends_at           timestamptz not null,
  reason            text check (reason is null or char_length(reason) <= 200),
  created_at        timestamptz not null default now(),
  check (ends_at > starts_at),
  foreign key (professional_id, establishment_id)
    references public.professionals (id, establishment_id) on delete cascade
);
create index schedule_blocks_est_time_idx on public.schedule_blocks (establishment_id, starts_at);

create table public.appointments (
  id                uuid primary key default gen_random_uuid(),
  establishment_id  uuid not null references public.establishments (id) on delete cascade,
  professional_id   uuid not null,
  service_id        uuid not null,
  customer_id       uuid not null,
  starts_at         timestamptz not null,
  ends_at           timestamptz not null,
  status            public.appointment_status not null default 'scheduled',
  price_cents       integer not null check (price_cents >= 0),
  notes             text check (notes is null or char_length(notes) <= 1000),
  created_by        uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (ends_at > starts_at),
  foreign key (professional_id, establishment_id)
    references public.professionals (id, establishment_id),
  foreign key (service_id, establishment_id)
    references public.services (id, establishment_id),
  foreign key (customer_id, establishment_id)
    references public.customers (id, establishment_id),
  -- Um profissional não pode ter dois atendimentos ativos sobrepostos.
  constraint appointments_no_overlap exclude using gist (
    professional_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status in ('scheduled', 'confirmed'))
);
create index appointments_est_time_idx on public.appointments (establishment_id, starts_at);

-- Triggers
create trigger set_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.establishments
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.professionals
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.services
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.customers
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.appointments
  for each row execute function private.set_updated_at();

create trigger prevent_tenant_change before update on public.memberships
  for each row execute function private.prevent_tenant_change();
create trigger prevent_tenant_change before update on public.professionals
  for each row execute function private.prevent_tenant_change();
create trigger prevent_tenant_change before update on public.services
  for each row execute function private.prevent_tenant_change();
create trigger prevent_tenant_change before update on public.customers
  for each row execute function private.prevent_tenant_change();
create trigger prevent_tenant_change before update on public.working_hours
  for each row execute function private.prevent_tenant_change();
create trigger prevent_tenant_change before update on public.schedule_blocks
  for each row execute function private.prevent_tenant_change();
create trigger prevent_tenant_change before update on public.appointments
  for each row execute function private.prevent_tenant_change();

create trigger set_created_by before insert on public.appointments
  for each row execute function private.set_created_by();
