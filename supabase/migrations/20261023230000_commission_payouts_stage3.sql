-- Orbit Agenda — etapa 3: registro auditável de repasses de comissões.
-- Não transfere dinheiro, não lança despesas no caixa e não recalcula snapshots.
-- Requer a etapa 2C já presente.
create table public.commission_payouts (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete restrict,
  professional_id uuid not null,
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 100000000000),
  method text not null check (method in ('pix','cash','card','other')),
  note text not null default '' check (length(note) <= 500),
  paid_on date not null,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  foreign key (professional_id, establishment_id)
    references public.professionals(id, establishment_id) on delete restrict
);
create index commission_payouts_est_prof_idx
  on public.commission_payouts(establishment_id, professional_id, paid_on desc, created_at desc);
alter table public.commission_payouts enable row level security;
create policy commission_payouts_owner_read on public.commission_payouts
  for select to authenticated using (private.is_owner(establishment_id));
revoke all on public.commission_payouts from public, anon, authenticated;
grant select on public.commission_payouts to authenticated;

-- Repasses são imutáveis. Um erro exige lançamento compensatório futuro,
-- não UPDATE/DELETE. A função garante que não se pague além do acumulado
-- atual e serializa chamadas concorrentes no mesmo estabelecimento.
create function public.record_commission_payout(
  p_establishment_id uuid, p_professional_id uuid,
  p_amount_cents bigint, p_method text, p_paid_on date, p_note text default ''
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_accrued bigint; v_paid bigint; v_id uuid;
begin
  if auth.uid() is null or not private.is_owner(p_establishment_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 or p_amount_cents > 100000000000
    or p_method not in ('pix','cash','card','other')
    or p_paid_on is null or p_paid_on > current_date
    or length(coalesce(p_note,'')) > 500 then
    raise exception 'invalid_payout' using errcode = '22023';
  end if;
  -- Serializa pagamentos concorrentes por estabelecimento.
  perform 1 from public.establishments where id = p_establishment_id for update;
  if not found then raise exception 'establishment_not_found' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.professionals
                 where id = p_professional_id and establishment_id = p_establishment_id) then
    raise exception 'professional_not_found' using errcode = 'P0002';
  end if;
  select coalesce(sum(accrued_cents),0)::bigint into v_accrued
  from public.appointment_commission_balances
  where establishment_id = p_establishment_id and professional_id = p_professional_id;
  select coalesce(sum(amount_cents),0)::bigint into v_paid
  from public.commission_payouts
  where establishment_id = p_establishment_id and professional_id = p_professional_id;
  if p_amount_cents > v_accrued - v_paid then
    raise exception 'payout_exceeds_available_commission' using errcode = '22023';
  end if;
  insert into public.commission_payouts
    (establishment_id, professional_id, amount_cents, method, paid_on, note, created_by)
  values (p_establishment_id,p_professional_id,p_amount_cents,p_method,p_paid_on,coalesce(p_note,''),auth.uid())
  returning id into v_id;
  return v_id;
end
$$;
revoke all on function public.record_commission_payout(uuid,uuid,bigint,text,date,text) from public, anon;
grant execute on function public.record_commission_payout(uuid,uuid,bigint,text,date,text) to authenticated;
