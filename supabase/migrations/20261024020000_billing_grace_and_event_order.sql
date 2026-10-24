-- OrbitAgenda billing enforcement / Asaas reconciliation.
-- Mirrors the production Supabase migrations applied on 2026-10-23/24.
-- Additive/idempotent for databases that already received the live fixes.

alter table public.establishment_subscriptions
  add column if not exists payment_due_at timestamptz,
  add column if not exists last_paid_due_date date;

create or replace function private.billing_allows_write(p_establishment_id uuid)
returns boolean language sql stable security definer set search_path=''
as $$
  select not exists (
    select 1 from public.establishment_subscriptions s
    where s.establishment_id=p_establishment_id
      and (
        s.status='suspended'
        or (
          s.asaas_subscription_id is not null
          and s.status='past_due'
          and s.payment_due_at is not null
          -- Vencimento dia 20: tolerância dias 21–25; bloqueio dia 26.
          and (now() at time zone 'America/Sao_Paulo')::date
              > (s.payment_due_at at time zone 'America/Sao_Paulo')::date + 5
        )
      )
  )
$$;
grant execute on function private.billing_allows_write(uuid) to authenticated;

-- Keep SELECT available; block INSERT/UPDATE/DELETE on the 15 tenant-owned tables.
-- Restrictive policies are combined with the existing membership policies.
do $$
declare v_table text;
begin
  foreach v_table in array array[
    'appointment_commission_snapshots','appointments','cash_closure_events',
    'cash_closures','commission_payouts','customers','financial_entries',
    'memberships','professional_commission_rules','professional_services',
    'professionals','schedule_blocks','services','team_invitations','working_hours'
  ] loop
    execute format('drop policy if exists billing_guard_insert on public.%I',v_table);
    execute format('drop policy if exists billing_guard_update on public.%I',v_table);
    execute format('drop policy if exists billing_guard_delete on public.%I',v_table);
    execute format(
      'create policy billing_guard_insert on public.%I as restrictive for insert to authenticated with check (private.billing_allows_write(establishment_id))',
      v_table);
    execute format(
      'create policy billing_guard_update on public.%I as restrictive for update to authenticated using (private.billing_allows_write(establishment_id)) with check (private.billing_allows_write(establishment_id))',
      v_table);
    execute format(
      'create policy billing_guard_delete on public.%I as restrictive for delete to authenticated using (private.billing_allows_write(establishment_id))',
      v_table);
  end loop;
end $$;

-- Called exclusively by the verified Asaas webhook (service_role).
-- Track the latest paid invoice due date so delayed events for older invoices
-- cannot re-block an active subscription or clear a newer unpaid invoice.
create or replace function public.record_asaas_billing_event(
  p_event_id text,p_asaas_subscription_id text,p_payment_id text,
  p_event_type text,p_payment_status text,p_amount_cents bigint,
  p_environment text,p_due_date date
) returns boolean language plpgsql set search_path=''
as $$
declare v_est uuid; v_due_at timestamptz;
begin
  if p_event_id is null or char_length(p_event_id) not between 4 and 160
     or p_payment_id is null or char_length(p_payment_id) not between 4 and 160
     or p_asaas_subscription_id is null
     or p_event_type not in ('PAYMENT_RECEIVED','PAYMENT_CONFIRMED','PAYMENT_OVERDUE')
     or p_amount_cents is null or p_amount_cents<0
     or p_environment not in ('sandbox','production') or p_due_date is null
  then raise exception 'invalid_billing_event' using errcode='22023'; end if;

  select establishment_id into v_est
    from public.establishment_subscriptions
    where asaas_subscription_id=p_asaas_subscription_id
      and asaas_environment=p_environment for update;
  if v_est is null then raise exception 'unknown_subscription' using errcode='22023'; end if;

  insert into public.asaas_payment_events(
    event_id,establishment_id,asaas_subscription_id,payment_id,
    event_type,payment_status,amount_cents,environment
  ) values(
    p_event_id,v_est,p_asaas_subscription_id,p_payment_id,
    p_event_type,p_payment_status,p_amount_cents,p_environment
  ) on conflict(event_id) do nothing;
  if not found then return false; end if;

  v_due_at := p_due_date::timestamp at time zone 'America/Sao_Paulo';
  if p_event_type in ('PAYMENT_RECEIVED','PAYMENT_CONFIRMED')
     and p_payment_status in ('RECEIVED','CONFIRMED') then
    update public.establishment_subscriptions
      set last_paid_due_date=greatest(last_paid_due_date,p_due_date),
          status=case when payment_due_at is null or payment_due_at<=v_due_at
                      then 'active' else status end,
          payment_due_at=case when payment_due_at is null or payment_due_at<=v_due_at
                              then null else payment_due_at end,
          asaas_synced_at=now(),updated_at=now()
      where establishment_id=v_est and status in ('trialing','active','past_due');
  elsif p_event_type='PAYMENT_OVERDUE' and p_payment_status='OVERDUE' then
    update public.establishment_subscriptions
      set status='past_due',payment_due_at=v_due_at,
          asaas_synced_at=now(),updated_at=now()
      where establishment_id=v_est and status in ('trialing','active','past_due')
        and (last_paid_due_date is null or last_paid_due_date<p_due_date)
        and (payment_due_at is null or payment_due_at<=v_due_at);
  end if;
  return true;
end $$;
revoke all on function public.record_asaas_billing_event(text,text,text,text,text,bigint,text,date)
  from public,anon,authenticated;
grant execute on function public.record_asaas_billing_event(text,text,text,text,text,bigint,text,date)
  to service_role;

-- The public booking Edge Function uses service_role, so RLS alone does not
-- enforce suspension. Guard the database booking RPC itself.
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p
  where p.pronamespace='public'::regnamespace
    and p.proname='create_public_booking';
  if v_def is null then raise exception 'create_public_booking_missing'; end if;
  if position('subscription_suspended' in v_def)>0 then return; end if;
  if position(
    'if not found then raise exception ''establishment_not_found'' using errcode = ''P0002''; end if;'
    in v_def)=0 then raise exception 'create_public_booking_definition_changed'; end if;
  v_def := replace(v_def,
    'if not found then raise exception ''establishment_not_found'' using errcode = ''P0002''; end if;',
    'if not found then raise exception ''establishment_not_found'' using errcode = ''P0002''; end if;
     if not private.billing_allows_write(v_est.id) then
       raise exception ''subscription_suspended'' using errcode = ''42501'';
     end if;');
  execute v_def;
end $$;

-- Frontend must query the same server rule for owners and staff. Expose only
-- a boolean to authenticated members; never disclose other tenants' status.
create or replace function public.is_establishment_billing_blocked(p_establishment_id uuid)
returns boolean language plpgsql stable security invoker set search_path=''
as $$
begin
  if p_establishment_id is null or not private.is_member(p_establishment_id) then
    raise exception 'forbidden' using errcode='42501';
  end if;
  return not private.billing_allows_write(p_establishment_id);
end $$;
revoke all on function public.is_establishment_billing_blocked(uuid) from public,anon;
grant execute on function public.is_establishment_billing_blocked(uuid) to authenticated;
