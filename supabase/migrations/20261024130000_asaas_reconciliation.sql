-- Reconciliation audit and reactivation after billing-related suspension.
create table if not exists public.asaas_reconciliation_runs (
 id uuid primary key default gen_random_uuid(),
 ran_at timestamptz not null default now(),
 environment text not null check (environment in ('sandbox','production')),
 subscriptions_checked int not null check (subscriptions_checked >= 0),
 events_applied int not null check (events_applied >= 0),
 errors int not null check (errors >= 0),
 divergences jsonb not null default '[]'::jsonb
);
alter table public.asaas_reconciliation_runs enable row level security;
revoke all on public.asaas_reconciliation_runs from public,anon,authenticated;
grant select,insert on public.asaas_reconciliation_runs to service_role;
create policy asaas_reconciliation_runs_admin_read on public.asaas_reconciliation_runs
 for select to authenticated using (private.is_superadmin());
grant select on public.asaas_reconciliation_runs to authenticated;
create or replace function public.record_asaas_reconciliation_run(
 p_environment text,p_checked int,p_applied int,p_errors int,p_divergences jsonb
) returns uuid language plpgsql set search_path=''
as $$
declare v_id uuid;
begin
 if p_environment not in ('sandbox','production') or p_checked<0 or p_applied<0 or p_errors<0
 or jsonb_typeof(coalesce(p_divergences,'[]'::jsonb))<>'array'
 or jsonb_array_length(coalesce(p_divergences,'[]'::jsonb))>500
 then raise exception 'invalid_reconciliation_run' using errcode='22023'; end if;
 insert into public.asaas_reconciliation_runs(environment,subscriptions_checked,events_applied,errors,divergences)
 values(p_environment,p_checked,p_applied,p_errors,coalesce(p_divergences,'[]'::jsonb)) returning id into v_id;
 return v_id;
end $$;
revoke all on function public.record_asaas_reconciliation_run(text,int,int,int,jsonb) from public,anon,authenticated;
grant execute on function public.record_asaas_reconciliation_run(text,int,int,int,jsonb) to service_role;
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
 select establishment_id into v_est from public.establishment_subscriptions
 where asaas_subscription_id=p_asaas_subscription_id and asaas_environment=p_environment for update;
 if v_est is null then raise exception 'unknown_subscription' using errcode='22023'; end if;
 insert into public.asaas_payment_events(event_id,establishment_id,asaas_subscription_id,payment_id,
 event_type,payment_status,amount_cents,environment)
 values(p_event_id,v_est,p_asaas_subscription_id,p_payment_id,p_event_type,p_payment_status,p_amount_cents,p_environment)
 on conflict(event_id) do nothing;
 if not found then return false; end if;
 v_due_at := p_due_date::timestamp at time zone 'America/Sao_Paulo';
 if p_event_type in ('PAYMENT_RECEIVED','PAYMENT_CONFIRMED')
 and p_payment_status in ('RECEIVED','CONFIRMED') then
 update public.establishment_subscriptions
 set last_paid_due_date=greatest(last_paid_due_date,p_due_date),
 status=case when payment_due_at is null or payment_due_at<=v_due_at then 'active' else status end,
 payment_due_at=case when payment_due_at is null or payment_due_at<=v_due_at then null else payment_due_at end,
 asaas_synced_at=now(),updated_at=now()
 where establishment_id=v_est and
 (status in ('trialing','active','past_due')
 or (status='suspended' and payment_due_at is not null and payment_due_at<v_due_at));
 elsif p_event_type='PAYMENT_OVERDUE' and p_payment_status='OVERDUE' then
 update public.establishment_subscriptions set status='past_due',payment_due_at=v_due_at,
 asaas_synced_at=now(),updated_at=now()
 where establishment_id=v_est and status in ('trialing','active','past_due')
 and (last_paid_due_date is null or last_paid_due_date<p_due_date)
 and (payment_due_at is null or payment_due_at<=v_due_at);
 end if;
 return true;
end $$;
revoke all on function public.record_asaas_billing_event(text,text,text,text,text,bigint,text,date) from public,anon,authenticated;
grant execute on function public.record_asaas_billing_event(text,text,text,text,text,bigint,text,date) to service_role;
