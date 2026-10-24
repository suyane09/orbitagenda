-- OrbitAgenda: fail closed when an establishment has no subscription.
-- Also stop writes when an explicitly time-limited trial has expired.
-- All existing 45 write RLS policies and the public booking RPC use this helper.
-- Does not change existing paid/active subscriptions.
create or replace function private.billing_allows_write(p_establishment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.establishment_subscriptions s
    where s.establishment_id = p_establishment_id
      and not (
        s.status = 'suspended'
        or (s.status = 'canceled'
          and (s.current_period_end is null or now() >= s.current_period_end))
        or (s.status = 'trialing'
          and s.current_period_end is not null
          and now() >= s.current_period_end)
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
$function$;
