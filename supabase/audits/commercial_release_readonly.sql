-- OrbitAgenda production audit, READ ONLY / SAFE for Supabase SQL Editor.
-- Does not return emails, phone numbers, Auth UUIDs or message bodies.
-- Data is a snapshot, not proof of completed payment or real delivery.
with counts as (
 select
  (select count(*) from pg_class c join pg_namespace n on c.relnamespace=n.oid
   where n.nspname='public' and c.relkind='r') as public_tables,
  (select count(*) from pg_class c join pg_namespace n on c.relnamespace=n.oid
   where n.nspname='public' and c.relkind='r' and not c.relrowsecurity) as missing_rls,
  (select count(*) from pg_constraint where contype='f' and not convalidated) as invalid_fk,
  (select count(*) from public.platform_admins) as platform_admin_count,
  (select count(*) from public.establishments) as establishments,
  (select count(*) from public.whatsapp_connections where state='connected' and worker_last_seen>now()-interval '3 minutes') as online_whatsapp,
  (select count(*) from public.whatsapp_connections where enabled=true and state='connected') as enabled_whatsapp,
  (select count(*) from public.whatsapp_outbox where state='accepted') as messages_accepted_not_confirmed,
  (select count(*) from public.whatsapp_outbox where state='failed') as messages_failed,
  (select count(*) from public.whatsapp_outbox where state='sending' and claimed_at<now()-interval '15 minutes') as uncertain_sends,
  (select count(*) from public.whatsapp_outbox where state='queued' and due_at<now()-interval '1 hour') as late_notifications,
  (select count(*) from public.establishment_subscriptions where status='past_due') as overdue_contracts,
  (select count(*) from public.establishment_subscriptions where status='active') as active_contracts
)
select now() at time zone 'America/Sao_Paulo' as audited_at_brazil,*
from counts;

-- Grants and deployed functions: 0 rows in the first SELECT is required.
select c.oid::regclass::text as missing_rls_table from pg_class c
join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind='r' and not c.relrowsecurity;

select
 has_schema_privilege('anon','private','USAGE') as anon_can_use_private_schema,
 has_function_privilege('anon','public.admin_set_establishment_subscription(uuid,uuid,text,timestamptz,text)','EXECUTE') as anon_can_change_subscriptions,
 has_function_privilege('authenticated','public.whatsapp_worker_poll(text)','EXECUTE') as user_can_claim_worker_jobs,
 has_table_privilege('authenticated','public.whatsapp_outbox','UPDATE') as user_can_edit_outbox,
 has_schema_privilege('service_role','private','USAGE') as backend_can_use_protected_guard,
 has_function_privilege('service_role','private.billing_allows_write(uuid)','EXECUTE') as backend_can_check_billing;

select
 to_regprocedure('public.whatsapp_cloud_request(uuid,text)') is not null as cloud_mobile_schema_installed,
 to_regclass('public.asaas_reconciliation_runs') is not null as asaas_reconciliation_records_installed;

-- Manual launch gates not observable from SQL:
-- * Asaas Sandbox full DONE refund, overdue / recovery and webhooks real verification
-- * Auth setting for leaked password protection (may require Supabase Pro)
-- * Cloud WhatsApp persistent hosted worker + same-phone code pairing
-- * Restore of Storage binaries and drift reconciliation
-- * Actual end-to-end customer account login on two separate devices
-- No SQL metric should be mistaken for launch approval.
