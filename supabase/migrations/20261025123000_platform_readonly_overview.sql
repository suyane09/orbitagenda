-- OrbitAgenda: read-only SaaS dashboard for the platform owner.
-- All counts come from the database; no broad table SELECT grants.
-- SECURITY DEFINER is needed to aggregate tenant-isolated records, but
-- execution is limited to authenticated users with platform_admins membership.
create or replace function public.platform_overview()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $function$
declare
  result jsonb;
begin
  if (select auth.uid()) is null or not private.is_superadmin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'updated_at', now(),
    'summary', jsonb_build_object(
      'establishments', (select count(*) from public.establishments),
      'registered_users', (select count(*) from auth.users),
      'active_team_members', (select count(distinct m.user_id) from public.memberships m where m.is_active),
      'customers', (select count(*) from public.customers),
      'active_professionals', (select count(*) from public.professionals p where p.is_active),
      'appointments_30d', (select count(*) from public.appointments a where a.created_at >= now() - interval '30 days'),
      'active_contracts', (select count(*) from public.establishment_subscriptions s where s.status = 'active'),
      'past_due_contracts', (select count(*) from public.establishment_subscriptions s where s.status = 'past_due'),
      'canceled_contracts', (select count(*) from public.establishment_subscriptions s where s.status = 'canceled'),
      'contracted_mrr_cents', (
        select coalesce(sum(p.monthly_price_cents),0)
        from public.establishment_subscriptions s
        join public.subscription_plans p on p.id=s.plan_id
        where s.status = 'active' and p.monthly_price_cents is not null
      )
    ),
    'establishments', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id', e.id,
          'name', e.name,
          'slug', e.slug,
          'business_type', e.business_type,
          'created_at', e.created_at,
          'plan_name', p.name,
          'monthly_price_cents', p.monthly_price_cents,
          'subscription_status', s.status,
          'current_period_end', s.current_period_end,
          'payment_due_at', s.payment_due_at,
          'team_members', (select count(*) from public.memberships m where m.establishment_id=e.id and m.is_active),
          'professionals', (select count(*) from public.professionals pr where pr.establishment_id=e.id and pr.is_active),
          'customers', (select count(*) from public.customers c where c.establishment_id=e.id),
          'appointments_30d', (select count(*) from public.appointments a where a.establishment_id=e.id and a.created_at >= now() - interval '30 days')
        ) order by e.created_at desc, e.id desc
      ), '[]'::jsonb)
      from (
        select id,name,slug,business_type,created_at
        from public.establishments
        order by created_at desc,id desc
        limit 100
      ) e
      left join public.establishment_subscriptions s on s.establishment_id=e.id
      left join public.subscription_plans p on p.id=s.plan_id
    ),
    'listed_limit',100
  ) into result;

  return result;
end;
$function$;

revoke all on function public.platform_overview() from public;
revoke all on function public.platform_overview() from anon;
grant execute on function public.platform_overview() to authenticated;
comment on function public.platform_overview() is
  'Read-only platform-level aggregate for authenticated platform_admins, capped at the 100 newest establishments. Contracted MRR is not received revenue.';
