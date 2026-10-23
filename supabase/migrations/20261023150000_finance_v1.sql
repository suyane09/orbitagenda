-- Orbit Agenda | Financeiro v1. Revisar e testar antes de aplicar em produção.
-- Somente proprietários gerenciam e visualizam dados financeiros.
create table public.financial_entries (
 id uuid primary key default gen_random_uuid(),
 establishment_id uuid not null references public.establishments(id) on delete cascade,
 appointment_id uuid null references public.appointments(id) on delete restrict,
 kind text not null check (kind in ('income','expense','refund')),
 description text not null check (length(btrim(description)) between 2 and 180),
 amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 100000000000),
 method text not null check (method in ('pix','cash','card','other')),
 occurred_on date not null default current_date,
 created_at timestamptz not null default now(),
 created_by uuid not null default auth.uid(),
 constraint finance_appointment_kind check (appointment_id is null or kind in ('income','refund'))
);
create index financial_entries_establishment_date on public.financial_entries(establishment_id, occurred_on desc, created_at desc);
create index financial_entries_appointment on public.financial_entries(appointment_id) where appointment_id is not null;

-- Rejeita vínculo cruzado e recebimentos maiores que o valor do agendamento.
-- Bloqueia a linha do agendamento para serializar pagamentos concorrentes.
create function public.validate_financial_entry() returns trigger language plpgsql set search_path = '' as $$
declare v_est uuid; v_price bigint; v_total bigint;
begin
 if new.appointment_id is not null then
   select establishment_id, price_cents into v_est, v_price
   from public.appointments where id = new.appointment_id for update;
   if v_est is null or v_est <> new.establishment_id then
     raise exception 'Agendamento não pertence ao estabelecimento';
   end if;
   select coalesce(sum(case when kind = 'income' then amount_cents else -amount_cents end), 0)
     into v_total from public.financial_entries where appointment_id = new.appointment_id;
   if new.kind = 'income' and v_total + new.amount_cents > v_price then
     raise exception 'Pagamento excede o valor do agendamento';
   end if;
   if new.kind = 'refund' and v_total - new.amount_cents < 0 then
     raise exception 'Estorno excede o valor recebido';
   end if;
 end if;
 return new;
end $$;
create trigger financial_entries_validate before insert on public.financial_entries
for each row execute function public.validate_financial_entry();

alter table public.financial_entries enable row level security;
create policy financial_entries_select on public.financial_entries for select to authenticated
 using (private.is_owner(establishment_id));
create policy financial_entries_insert on public.financial_entries for insert to authenticated
 with check (private.is_owner(establishment_id) and created_by = (select auth.uid()));
-- Lançamentos imutáveis: correções via lançamento compensatório; sem UPDATE/DELETE.
revoke all on public.financial_entries from anon;
grant select on public.financial_entries to authenticated;
grant insert (establishment_id, appointment_id, kind, description, amount_cents, method, occurred_on)
 on public.financial_entries to authenticated;
revoke all on function public.validate_financial_entry() from public;
