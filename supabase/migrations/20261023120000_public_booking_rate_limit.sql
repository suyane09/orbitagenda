-- Orbit Agenda: rate limiting persistente para a Edge Function public-booking.
-- Contador por janela fixa, incrementado de forma ATÔMICA (insert ... on conflict do update):
-- requisições concorrentes não conseguem "furar" o limite. As chaves chegam já com hash (HMAC) — sem IP/telefone em claro.
-- Somente o service_role (Edge Function) executa a função.
create table if not exists public.rate_limit_buckets (
  key          text        not null check (char_length(key) between 8 and 128),
  window_start timestamptz not null,
  hits         integer     not null default 0,
  primary key (key, window_start)
);
create index if not exists rate_limit_buckets_window_idx on public.rate_limit_buckets (window_start);

alter table public.rate_limit_buckets enable row level security; -- sem policies: anon/authenticated não leem nem escrevem
revoke all on table public.rate_limit_buckets from public, anon, authenticated;
grant select, insert, update, delete on table public.rate_limit_buckets to service_role;

create or replace function public.check_rate_limit(p_key text, p_limit integer, p_window_seconds integer)
returns table (allowed boolean, retry_after integer)
language plpgsql security invoker set search_path = ''
as $$
declare
  v_start timestamptz;
  v_hits  integer;
  v_now   timestamptz := clock_timestamp();
begin
  if p_key is null or char_length(p_key) not between 8 and 128
     or p_limit is null or p_limit < 1
     or p_window_seconds is null or p_window_seconds not between 1 and 86400 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  v_start := to_timestamp(floor(extract(epoch from v_now) / p_window_seconds) * p_window_seconds);

  insert into public.rate_limit_buckets as b (key, window_start, hits)
  values (p_key, v_start, 1)
  on conflict (key, window_start) do update set hits = b.hits + 1
  returning b.hits into v_hits;

  -- Limpeza oportunista de janelas antigas (a maioria das chamadas não paga esse custo).
  if random() < 0.02 then
    delete from public.rate_limit_buckets where window_start < now() - interval '2 days';
  end if;

  allowed := v_hits <= p_limit;
  retry_after := case when allowed then 0
    else greatest(1, ceil(extract(epoch from (v_start + p_window_seconds * interval '1 second' - v_now)))::integer) end;
  return next;
end;
$$;

revoke all on function public.check_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.check_rate_limit(text, integer, integer) to service_role;
