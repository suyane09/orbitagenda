-- Execute somente após revisar no ambiente de testes. Não execute duas vezes.
-- Orbit Agenda | Fechamento definitivo v1 - revisão de segurança
-- REVISAR antes de aplicar. Não executado automaticamente.
-- Apenas o proprietário pode fechar/reabrir. Lançamentos do dia fechado são barrados no banco.
create table public.cash_closures (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  business_date date not null,
  status text not null default 'closed' check (status in ('closed','reopened')),
  income_cents bigint not null,
  expense_cents bigint not null,
  refund_cents bigint not null,
  net_cents bigint not null,
  entry_count integer not null,
  closed_at timestamptz not null default now(),
  closed_by uuid not null references auth.users(id),
  reopened_at timestamptz,
  reopened_by uuid references auth.users(id),
  reopen_reason text,
  constraint cash_closure_reopen_consistency check (
    (status = 'closed' and reopened_at is null and reopened_by is null and reopen_reason is null)
    or (status = 'reopened' and reopened_at is not null and reopened_by is not null and length(btrim(reopen_reason)) between 5 and 500)
  )
);
create unique index cash_closures_one_closed_per_day on public.cash_closures(establishment_id,business_date) where status='closed';
create index cash_closures_history_idx on public.cash_closures(establishment_id,business_date desc,closed_at desc);

create table public.cash_closure_events (
  id uuid primary key default gen_random_uuid(),
  closure_id uuid not null references public.cash_closures(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  event text not null check (event in ('closed','reopened')),
  actor_id uuid not null references auth.users(id),
  happened_at timestamptz not null default now(),
  reason text
);
create index cash_closure_events_idx on public.cash_closure_events(closure_id,happened_at);

alter table public.cash_closures enable row level security;
alter table public.cash_closure_events enable row level security;
create policy cash_closures_owner_read on public.cash_closures for select to authenticated using (private.is_owner(establishment_id));
create policy cash_events_owner_read on public.cash_closure_events for select to authenticated using (private.is_owner(establishment_id));
revoke all on public.cash_closures, public.cash_closure_events from public, anon, authenticated;
grant select on public.cash_closures, public.cash_closure_events to authenticated;

-- A mesma linha do estabelecimento é bloqueada tanto no lançamento quanto no fechamento.
-- Assim, não há corrida entre inserir uma movimentação e fechar o dia.
create function private.prevent_closed_cash_entry() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Protege a data original em alterações/exclusões e a nova data em inserções/alterações.
  -- Bloqueio por estabelecimento sincroniza com close_cash_day/reopen_cash_day.
  if tg_op = 'DELETE' or tg_op = 'UPDATE' then
    perform 1 from public.establishments where id = old.establishment_id for update;
    if exists (select 1 from public.cash_closures
      where establishment_id = old.establishment_id and business_date = old.occurred_on and status = 'closed') then
      raise exception 'cash_day_closed' using errcode = 'P0001';
    end if;
  end if;
  if tg_op = 'INSERT' or tg_op = 'UPDATE' then
    perform 1 from public.establishments where id = new.establishment_id for update;
    if exists (select 1 from public.cash_closures
      where establishment_id = new.establishment_id and business_date = new.occurred_on and status = 'closed') then
      raise exception 'cash_day_closed' using errcode = 'P0001';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.prevent_closed_cash_entry() from public, anon, authenticated;
create trigger zz_prevent_closed_cash_entry before insert or update or delete on public.financial_entries
for each row execute function private.prevent_closed_cash_entry();

create function public.close_cash_day(p_establishment_id uuid, p_date date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid; v_income bigint; v_expense bigint; v_refund bigint; v_count integer; v_tz text;
begin
  if auth.uid() is null or not private.is_owner(p_establishment_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  -- Compatível com instalações sem coluna timezone; usa o fuso de Alagoas como padrão.
  select coalesce(nullif(to_jsonb(e)->>'timezone',''), 'America/Maceio')
    into v_tz from public.establishments e where e.id = p_establishment_id for update;
  if not found then raise exception 'establishment_not_found' using errcode = 'P0002'; end if;
  if p_date is null or p_date > (now() at time zone v_tz)::date then
    raise exception 'invalid_closing_date' using errcode = '22023';
  end if;
  if exists (select 1 from public.cash_closures where establishment_id = p_establishment_id and business_date = p_date and status = 'closed') then
    raise exception 'cash_day_already_closed' using errcode = '23505';
  end if;
  select coalesce(sum(amount_cents) filter (where kind = 'income'),0),
         coalesce(sum(amount_cents) filter (where kind = 'expense'),0),
         coalesce(sum(amount_cents) filter (where kind = 'refund'),0), count(*)
    into v_income,v_expense,v_refund,v_count
    from public.financial_entries where establishment_id = p_establishment_id and occurred_on = p_date;
  insert into public.cash_closures(establishment_id,business_date,income_cents,expense_cents,refund_cents,net_cents,entry_count,closed_by)
    values (p_establishment_id,p_date,v_income,v_expense,v_refund,v_income-v_expense-v_refund,v_count,auth.uid()) returning id into v_id;
  insert into public.cash_closure_events(closure_id,establishment_id,event,actor_id)
    values(v_id,p_establishment_id,'closed',auth.uid());
  return v_id;
end;
$$;

create function public.reopen_cash_day(p_closure_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_row public.cash_closures%rowtype;
begin
  if auth.uid() is null then raise exception 'forbidden' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_reason,''))) not between 5 and 500 then
    raise exception 'reopen_reason_required' using errcode = '22023';
  end if;
  -- Consulta sem revelar informações de outros estabelecimentos.
  select * into v_row from public.cash_closures where id = p_closure_id;
  if not found or not private.is_owner(v_row.establishment_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform 1 from public.establishments where id = v_row.establishment_id for update;
  select * into v_row from public.cash_closures where id = p_closure_id for update;
  if v_row.status <> 'closed' then raise exception 'cash_day_not_closed' using errcode = 'P0001'; end if;
  update public.cash_closures set status='reopened',reopened_at=now(),reopened_by=auth.uid(),reopen_reason=btrim(p_reason)
    where id=p_closure_id;
  insert into public.cash_closure_events(closure_id,establishment_id,event,actor_id,reason)
    values(p_closure_id,v_row.establishment_id,'reopened',auth.uid(),btrim(p_reason));
end;
$$;
-- RPCs somente para usuários autenticados; permissões de proprietário verificadas internamente.
revoke all on function public.close_cash_day(uuid,date), public.reopen_cash_day(uuid,text) from public, anon;
grant execute on function public.close_cash_day(uuid,date), public.reopen_cash_day(uuid,text) to authenticated;
