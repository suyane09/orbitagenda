-- Gestão de contrato do SaaS, sem integração com cobrança/sem bloquear dados.
-- Apenas plataforma pode atribuir plano ou status; proprietários consultam o seu contrato.
create table public.subscription_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9_-]{2,32}$'),
  name text not null check (char_length(name) between 2 and 80),
  monthly_price_cents bigint check (monthly_price_cents is null or monthly_price_cents >= 0),
  is_public boolean not null default false,
  created_at timestamptz not null default now()
);
create table public.establishment_subscriptions (
  establishment_id uuid primary key references public.establishments(id) on delete cascade,
  plan_id uuid not null references public.subscription_plans(id) on delete restrict,
  status text not null check (status in ('trialing','active','past_due','suspended','canceled')),
  started_at timestamptz not null default now(),
  current_period_end timestamptz,
  notes text not null default '' check (char_length(notes) <= 500),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint subscription_period_after_start check (current_period_end is null or current_period_end > started_at)
);
create index establishment_subscriptions_plan_idx on public.establishment_subscriptions(plan_id);
alter table public.subscription_plans enable row level security;
alter table public.establishment_subscriptions enable row level security;
revoke all on public.subscription_plans,public.establishment_subscriptions from public,anon,authenticated;
grant select on public.subscription_plans,public.establishment_subscriptions to authenticated;
create policy subscription_plans_authenticated_select on public.subscription_plans
for select to authenticated using (is_public or private.is_superadmin() or exists(
  select 1 from public.establishment_subscriptions s
  where s.plan_id=id and private.is_member(s.establishment_id)
));
create policy establishment_subscriptions_authorized_select on public.establishment_subscriptions
for select to authenticated using (private.is_owner(establishment_id) or private.is_superadmin());

-- Evita publicar preços reais sem decisão comercial: modo interno não precificado.
insert into public.subscription_plans (code,name,is_public,monthly_price_cents)
values ('piloto','Acesso piloto',false,null);

create function public.admin_create_subscription_plan(
 p_code text,p_name text,p_monthly_price_cents bigint,p_is_public boolean default false
) returns uuid language plpgsql security definer set search_path=''
as $$
declare v_id uuid;
begin
 if not private.is_superadmin() then raise exception 'forbidden' using errcode='42501'; end if;
 if p_code is null or p_code !~ '^[a-z0-9_-]{2,32}$'
    or char_length(btrim(coalesce(p_name,''))) not between 2 and 80
    or p_monthly_price_cents is null or p_monthly_price_cents <= 0 then
   raise exception 'invalid_plan' using errcode='22023';
 end if;
 insert into public.subscription_plans(code,name,monthly_price_cents,is_public)
 values(p_code,btrim(p_name),p_monthly_price_cents,coalesce(p_is_public,false))
 returning id into v_id;
 return v_id;
end $$;

create function public.admin_set_establishment_subscription(
 p_establishment_id uuid,p_plan_id uuid,p_status text,p_period_end timestamptz default null,
 p_notes text default ''
) returns void language plpgsql security definer set search_path=''
as $$
begin
 if not private.is_superadmin() then raise exception 'forbidden' using errcode='42501'; end if;
 if p_status not in ('trialing','active','past_due','suspended','canceled')
    or p_status is null or char_length(coalesce(p_notes,''))>500 then
   raise exception 'invalid_subscription' using errcode='22023';
 end if;
 if not exists(select 1 from public.establishments where id=p_establishment_id)
    or not exists(select 1 from public.subscription_plans where id=p_plan_id) then
   raise exception 'not_found' using errcode='22023';
 end if;
 -- Registro de status é administrativo. Não dispara cobrança, bloqueio nem pagamento.
 insert into public.establishment_subscriptions(establishment_id,plan_id,status,
   current_period_end,notes,updated_by)
 values(p_establishment_id,p_plan_id,p_status,p_period_end,coalesce(p_notes,''),auth.uid())
 on conflict (establishment_id) do update
 set plan_id=excluded.plan_id,status=excluded.status,
   current_period_end=excluded.current_period_end,notes=excluded.notes,
   updated_at=now(),updated_by=auth.uid();
end $$;
revoke all on function public.admin_create_subscription_plan(text,text,bigint,boolean) from public,anon;
revoke all on function public.admin_set_establishment_subscription(uuid,uuid,text,timestamptz,text) from public,anon;
grant execute on function public.admin_create_subscription_plan(text,text,bigint,boolean) to authenticated;
grant execute on function public.admin_set_establishment_subscription(uuid,uuid,text,timestamptz,text) to authenticated;
