-- Asaas billing integration (sandbox-first). Existing subscriptions remain unchanged.
-- Asaas identity is set exclusively by a privileged Edge Function.
alter table public.establishment_subscriptions
  add column asaas_customer_id text,
  add column asaas_subscription_id text,
  add column asaas_environment text check (asaas_environment in ('sandbox','production')),
  add column asaas_synced_at timestamptz,
  add column asaas_provisioning_started_at timestamptz;
create unique index establishment_subscriptions_asaas_subscription_unique
  on public.establishment_subscriptions(asaas_subscription_id)
  where asaas_subscription_id is not null;

create table public.asaas_payment_events (
  event_id text primary key check (char_length(event_id) between 4 and 160),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  asaas_subscription_id text not null,
  payment_id text not null,
  event_type text not null check (char_length(event_type) between 4 and 100),
  payment_status text not null check (char_length(payment_status) between 2 and 100),
  amount_cents bigint not null check (amount_cents >= 0),
  occurred_at timestamptz not null default now(),
  environment text not null check (environment in ('sandbox','production'))
);
create index asaas_payment_events_establishment_idx
  on public.asaas_payment_events(establishment_id,occurred_at desc);
alter table public.asaas_payment_events enable row level security;
revoke all on public.asaas_payment_events from public,anon,authenticated;
grant select on public.asaas_payment_events to authenticated;
create policy asaas_payment_events_owner_read on public.asaas_payment_events
  for select to authenticated using (private.is_owner(establishment_id) or private.is_superadmin());
-- Importantly: no INSERT/UPDATE/DELETE grants for authenticated clients.
-- Payment events cannot be edited from the browser.
