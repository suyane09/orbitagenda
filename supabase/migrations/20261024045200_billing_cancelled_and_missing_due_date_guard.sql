-- OrbitAgenda: fail closed on canceled subscriptions without a remaining paid period
-- and on Asaas past_due subscriptions lacking a verified due date.
-- A canceled subscription with a future current_period_end remains usable
-- until that paid period ends; no tenant data is deleted.
create or replace function private.billing_allows_write(p_establishment_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select not exists (
    select 1
    from public.establishment_subscriptions s
    where s.establishment_id = p_establishment_id
      and (
        s.status = 'suspended'
        or (
          s.status = 'canceled'
          and (s.current_period_end is null or now() >= s.current_period_end)
        )
        or (
          s.asaas_subscription_id is not null
          and s.status = 'past_due'
          and (
            s.payment_due_at is null
            or (now() at time zone 'America/Sao_Paulo')::date
               > (s.payment_due_at at time zone 'America/Sao_Paulo')::date + 5
          )
        )
      )
  )
$$;
