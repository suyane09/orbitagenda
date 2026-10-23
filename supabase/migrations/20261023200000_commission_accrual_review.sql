-- ETAPA 2C: demonstrativo de comissões validado; sem repasses.
-- Histórico: implantada na produção pelo SQL Editor; NÃO reaplicar.
-- Substitui o rascunho 20261023190000_commission_snapshot_draft.sql:
-- NÃO EXECUTE AMBOS. Se já executou o rascunho, interrompa e revise a migração.
-- Histórico: atendimentos já concluídos ficam FORA do demonstrativo, sem retroatividade.
-- Regra: snapshot ao concluir, valores líquidos recebidos até o preço do serviço.
-- A regra do atendimento concluído é imutável pela aplicação.
create table public.appointment_commission_snapshots (
  appointment_id uuid primary key references public.appointments(id) on delete restrict,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  professional_id uuid not null,
  price_cents integer not null check (price_cents >= 0),
  mode text not null check (mode in ('none','percentage','fixed')),
  rate_basis_points integer not null check (rate_basis_points between 0 and 10000),
  fixed_cents integer not null check (fixed_cents >= 0),
  constraint commission_snapshot_rule_consistency check (
    (mode='none' and rate_basis_points=0 and fixed_cents=0)
    or (mode='percentage' and fixed_cents=0)
    or (mode='fixed' and rate_basis_points=0)
  ),
  captured_at timestamptz not null default now(),
  foreign key (professional_id, establishment_id)
    references public.professionals(id, establishment_id)
);
create index appointment_commission_snapshots_est_idx
 on public.appointment_commission_snapshots(establishment_id, professional_id);
alter table public.appointment_commission_snapshots enable row level security;
create policy commission_snapshots_owner_read on public.appointment_commission_snapshots
 for select to authenticated using (private.is_owner(establishment_id));
revoke all on public.appointment_commission_snapshots from public, anon, authenticated;
grant select on public.appointment_commission_snapshots to authenticated;

create function private.capture_appointment_commission() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r public.professional_commission_rules%rowtype;
begin
  if tg_op <> 'UPDATE' or tg_table_schema <> 'public' or tg_table_name <> 'appointments'
     or tg_name <> 'capture_appointment_commission' then
    raise exception 'invalid_trigger_context' using errcode = '42501';
  end if;
  if new.status = 'completed' and old.status is distinct from 'completed' then
    select * into r from public.professional_commission_rules
      where establishment_id = new.establishment_id and professional_id = new.professional_id;
    insert into public.appointment_commission_snapshots
      (appointment_id, establishment_id, professional_id, price_cents, mode, rate_basis_points, fixed_cents)
    values (new.id, new.establishment_id, new.professional_id, new.price_cents,
      coalesce(r.mode,'none'), coalesce(r.rate_basis_points,0), coalesce(r.fixed_cents,0))
    on conflict (appointment_id) do nothing;
  end if;
  return new;
end $$;
revoke all on function private.capture_appointment_commission() from public, anon, authenticated;
create trigger capture_appointment_commission
 after update of status on public.appointments
 for each row execute function private.capture_appointment_commission();

-- security_invoker garante que a RLS das tabelas de origem se aplica.
-- Para estornos, o saldo de comissão pode diminuir; ainda não há repasses.
create view public.appointment_commission_balances
 with (security_invoker = true) as
select s.appointment_id, s.establishment_id, s.professional_id,
       s.price_cents, s.mode, s.rate_basis_points, s.fixed_cents, s.captured_at,
       least(s.price_cents::bigint, greatest(0::bigint,
         coalesce(sum(case when f.kind = 'income' then f.amount_cents
                           when f.kind = 'refund' then -f.amount_cents else 0 end),0)
       )) as net_received_cents,
       case
         when s.price_cents = 0 or s.mode = 'none' then 0::bigint
         when s.mode = 'percentage' then round(
           least(s.price_cents::bigint, greatest(0::bigint,
             coalesce(sum(case when f.kind='income' then f.amount_cents
                               when f.kind='refund' then -f.amount_cents else 0 end),0)))
           * s.rate_basis_points::numeric / 10000)::bigint
         else round(
           least(s.fixed_cents, s.price_cents)::numeric
           * least(s.price_cents::bigint, greatest(0::bigint,
             coalesce(sum(case when f.kind='income' then f.amount_cents
                               when f.kind='refund' then -f.amount_cents else 0 end),0)))
           / s.price_cents)::bigint
       end as accrued_cents
from public.appointment_commission_snapshots s
left join public.financial_entries f on f.appointment_id = s.appointment_id
 and f.establishment_id = s.establishment_id
group by s.appointment_id, s.establishment_id, s.professional_id,
 s.price_cents, s.mode, s.rate_basis_points, s.fixed_cents, s.captured_at;
revoke all on public.appointment_commission_balances from public, anon;
grant select on public.appointment_commission_balances to authenticated;
