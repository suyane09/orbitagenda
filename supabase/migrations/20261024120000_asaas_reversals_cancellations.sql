-- Asaas reversals and subscription cancellations; idempotent and service-role only.
create or replace function public.record_asaas_billing_reversal(
 p_event_id text,p_asaas_subscription_id text,p_payment_id text,
 p_event_type text,p_payment_status text,p_amount_cents bigint,
 p_environment text,p_due_date date
) returns boolean language plpgsql set search_path=''
as $$
declare v_est uuid; v_due_at timestamptz; v_is_payment boolean;
begin
 v_is_payment := p_event_type in ('PAYMENT_REFUNDED','PAYMENT_CHARGEBACK_REQUESTED','PAYMENT_DELETED');
 if p_event_id is null or char_length(p_event_id) not between 4 and 160
 or p_payment_id is null or char_length(p_payment_id) not between 4 and 160
 or p_asaas_subscription_id is null
 or p_event_type not in ('PAYMENT_REFUNDED','PAYMENT_CHARGEBACK_REQUESTED','PAYMENT_DELETED','SUBSCRIPTION_DELETED')
 or p_amount_cents is null or p_amount_cents<0
 or p_environment not in ('sandbox','production')
 or (v_is_payment and p_due_date is null)
 then raise exception 'invalid_billing_event' using errcode='22023'; end if;
 select establishment_id into v_est from public.establishment_subscriptions
 where asaas_subscription_id=p_asaas_subscription_id and asaas_environment=p_environment for update;
 if v_est is null then raise exception 'unknown_subscription' using errcode='22023'; end if;
 insert into public.asaas_payment_events(event_id,establishment_id,asaas_subscription_id,
 payment_id,event_type,payment_status,amount_cents,environment)
 values(p_event_id,v_est,p_asaas_subscription_id,p_payment_id,p_event_type,
 coalesce(p_payment_status,'UNKNOWN'),p_amount_cents,p_environment)
 on conflict(event_id) do nothing;
 if not found then return false; end if;
 if p_event_type='SUBSCRIPTION_DELETED' then
 update public.establishment_subscriptions set status='canceled',payment_due_at=null,
 asaas_synced_at=now(),updated_at=now() where establishment_id=v_est and status<>'canceled';
 return true;
 end if;
 v_due_at := p_due_date::timestamp at time zone 'America/Sao_Paulo';
 if p_event_type='PAYMENT_CHARGEBACK_REQUESTED' then
 update public.establishment_subscriptions set status='suspended',payment_due_at=v_due_at,
 last_paid_due_date=case when last_paid_due_date=p_due_date then null else last_paid_due_date end,
 asaas_synced_at=now(),updated_at=now()
 where establishment_id=v_est and status in ('trialing','active','past_due')
 and (last_paid_due_date is null or last_paid_due_date<=p_due_date);
 elsif p_event_type='PAYMENT_REFUNDED' then
 update public.establishment_subscriptions set status='past_due',payment_due_at=v_due_at,
 last_paid_due_date=case when last_paid_due_date=p_due_date then null else last_paid_due_date end,
 asaas_synced_at=now(),updated_at=now()
 where establishment_id=v_est and status in ('trialing','active','past_due')
 and (last_paid_due_date is null or last_paid_due_date<=p_due_date)
 and (payment_due_at is null or payment_due_at<=v_due_at);
 end if;
 return true;
end $$;
revoke all on function public.record_asaas_billing_reversal(text,text,text,text,text,bigint,text,date) from public,anon,authenticated;
grant execute on function public.record_asaas_billing_reversal(text,text,text,text,text,bigint,text,date) to service_role;
