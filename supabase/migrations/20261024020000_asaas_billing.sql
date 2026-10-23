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

-- Atomic webhook reconciliation: no partial processing on repeated delivery.
create function public.record_asaas_payment_event(
 p_event_id text, p_asaas_subscription_id text, p_payment_id text,
 p_event_type text, p_payment_status text, p_amount_cents bigint, p_environment text
) returns boolean language plpgsql set search_path=''
as $$
declare v_est uuid;
begin
 if p_event_id is null or char_length(p_event_id) not between 4 and 160
   or p_amount_cents is null or p_amount_cents < 0
   or p_environment not in ('sandbox','production')
   or p_event_type is null or p_payment_id is null then
   raise exception 'invalid_webhook_event' using errcode='22023';
 end if;
 select establishment_id into v_est
 from public.establishment_subscriptions
 where asaas_subscription_id=p_asaas_subscription_id
   and asaas_environment=p_environment
 for update;
 if v_est is null then raise exception 'unknown_subscription' using errcode='22023'; end if;
 insert into public.asaas_payment_events
  (event_id,establishment_id,asaas_subscription_id,payment_id,event_type,payment_status,amount_cents,environment)
 values (p_event_id,v_est,p_asaas_subscription_id,p_payment_id,p_event_type,p_payment_status,p_amount_cents,p_environment)
 on conflict(event_id) do nothing;
 if not found then return false; end if;
 if p_event_type='PAYMENT_RECEIVED' and p_payment_status='RECEIVED' then
   update public.establishment_subscriptions
     set status='active',asaas_synced_at=now(),updated_at=now()
   where establishment_id=v_est and status not in ('canceled');
 end if;
 return true;
end $$;
revoke all on function public.record_asaas_payment_event(text,text,text,text,text,bigint,text)
 from public, anon, authenticated;
grant execute on function public.record_asaas_payment_event(text,text,text,text,text,bigint,text)
 to service_role;
