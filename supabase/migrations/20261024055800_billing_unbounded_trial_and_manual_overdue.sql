-- OrbitAgenda: close remaining unbounded billing states.
-- A trial without a defined end cannot remain free indefinitely.
-- A manual past_due subscription (without an Asaas ID), or an Asaas
-- past_due subscription without a verified due date, cannot write.
-- Asaas past_due retains five full calendar days of grace in Sao Paulo.
create or replace function private.billing_allows_write(p_establishment_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $function$
 select exists (
  select 1 from public.establishment_subscriptions s
  where s.establishment_id=p_establishment_id
    and not (
      s.status='suspended'
      or (s.status='canceled'
          and (s.current_period_end is null or now()>=s.current_period_end))
      or (s.status='trialing'
          and (s.current_period_end is null or now()>=s.current_period_end))
      or (s.status='past_due'
          and (s.asaas_subscription_id is null
            or s.payment_due_at is null
            or (now() at time zone 'America/Sao_Paulo')::date
               > (s.payment_due_at at time zone 'America/Sao_Paulo')::date+5))
    )
 )
$function$;
