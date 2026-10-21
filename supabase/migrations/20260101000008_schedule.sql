-- Orbit Agenda · Etapa 2 · 0008 · Horários (expediente, intervalos, folgas, férias e bloqueios)
-- Incremental: reutiliza working_hours e schedule_blocks; nada é recriado.
--   * Expediente semanal = vários trechos por dia em working_hours; o INTERVALO é a lacuna entre trechos.
--   * Folga / férias / bloqueio = linhas de schedule_blocks, agora com a coluna "kind".
--   * Datas informadas pelo usuário são convertidas no fuso do ESTABELECIMENTO, dentro do banco.
-- Nenhuma policy ou grant existente é alterado, apenas ampliado (coluna kind e 2 RPCs).

-- 1) Tipo do bloqueio ---------------------------------------------------------
alter table public.schedule_blocks
  add column kind text not null default 'block'
    check (kind in ('block', 'day_off', 'vacation'));

-- Férias sempre pertencem a um profissional (folga/bloqueio sem profissional = estabelecimento todo).
alter table public.schedule_blocks
  add constraint schedule_blocks_vacation_has_professional
    check (kind <> 'vacation' or professional_id is not null);

create index schedule_blocks_pro_time_idx on public.schedule_blocks (professional_id, starts_at);

grant insert (kind) on public.schedule_blocks to authenticated;
grant update (kind) on public.schedule_blocks to authenticated;

-- 2) Validação do expediente (vale também para escrita direta na tabela) ------
-- Sem sobreposição de trechos no mesmo dia e horários em minutos cheios.
-- Lock consultivo por profissional serializa gravações concorrentes.
create function private.check_working_hours()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if extract(second from new.start_time) <> 0 or extract(second from new.end_time) <> 0 then
    raise exception 'invalid_time' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('wh:' || new.professional_id::text, 0));

  if exists (
    select 1 from public.working_hours w
     where w.professional_id = new.professional_id
       and w.weekday = new.weekday
       and w.id <> new.id
       and w.start_time < new.end_time
       and new.start_time < w.end_time
  ) then
    raise exception 'working_hours_overlap' using errcode = '23P01';
  end if;
  return new;
end;
$$;

-- 3) Validação dos bloqueios ---------------------------------------------------
--  a) não pode sobrepor outro bloqueio do MESMO escopo (mesmo profissional, ou estabelecimento todo);
--  b) não pode cobrir agendamentos ativos (agendado/confirmado) — remarque ou cancele antes.
-- Em UPDATE só revalida se período ou profissional mudaram (editar o motivo nunca falha por isso).
create function private.check_schedule_block()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if tg_op = 'UPDATE'
     and new.starts_at = old.starts_at and new.ends_at = old.ends_at
     and new.professional_id is not distinct from old.professional_id then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'sb:' || coalesce(new.professional_id::text, new.establishment_id::text), 0));

  if exists (
    select 1 from public.schedule_blocks b
     where b.establishment_id = new.establishment_id
       and b.professional_id is not distinct from new.professional_id
       and b.id <> new.id
       and b.starts_at < new.ends_at
       and new.starts_at < b.ends_at
  ) then
    raise exception 'block_overlap' using errcode = '23P01';
  end if;

  select count(*) into v_n
    from public.appointments a
   where a.establishment_id = new.establishment_id
     and (new.professional_id is null or a.professional_id = new.professional_id)
     and a.status in ('scheduled', 'confirmed')
     and a.starts_at < new.ends_at
     and new.starts_at < a.ends_at;
  if v_n > 0 then
    raise exception 'block_conflicts_appointments:%', v_n using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function private.check_working_hours()  from public, anon, authenticated;
revoke all on function private.check_schedule_block() from public, anon, authenticated;

create trigger check_working_hours before insert or update on public.working_hours
  for each row execute function private.check_working_hours();
create trigger check_schedule_block before insert or update on public.schedule_blocks
  for each row execute function private.check_schedule_block();

-- 4) Salvar o expediente semanal de um profissional (atômico) ------------------
-- p_segments: [{"weekday":1,"start_time":"09:00","end_time":"12:00"}, ...]  (0 = domingo)
-- Substitui TODO o expediente do profissional. SECURITY INVOKER: RLS e grants do usuário valem.
-- Retorna {segments, outside_appointments}: agendamentos futuros ativos que ficaram fora do novo expediente
-- (aviso — não bloqueia, pois o cliente já foi marcado).
create function public.save_weekly_schedule(
  p_establishment_id  uuid,
  p_professional_id   uuid,
  p_segments          jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_n        integer;
  v_outside  integer;
begin
  if not private.is_owner(p_establishment_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_segments is null or jsonb_typeof(p_segments) <> 'array' then
    raise exception 'invalid_segments' using errcode = '22023';
  end if;
  if jsonb_array_length(p_segments) > 42 then
    raise exception 'too_many_segments' using errcode = '22023';
  end if;

  -- Trava o profissional (e prova que pertence à empresa) para serializar edições concorrentes.
  perform 1 from public.professionals pr
   where pr.id = p_professional_id and pr.establishment_id = p_establishment_id
   for update;
  if not found then
    raise exception 'professional_not_found' using errcode = 'P0002';
  end if;

  delete from public.working_hours w where w.professional_id = p_professional_id;

  insert into public.working_hours (establishment_id, professional_id, weekday, start_time, end_time)
  select p_establishment_id, p_professional_id, s.weekday, s.start_time, s.end_time
    from jsonb_to_recordset(p_segments) as s(weekday smallint, start_time time, end_time time);
  get diagnostics v_n = row_count;

  select count(*) into v_outside
    from public.appointments a
    join public.establishments e on e.id = a.establishment_id
   where a.professional_id = p_professional_id
     and a.status in ('scheduled', 'confirmed')
     and a.ends_at > now()
     and not exists (
       select 1 from public.working_hours w
        where w.professional_id = a.professional_id
          and w.weekday = extract(dow from (a.starts_at at time zone e.timezone))::int
          and (a.ends_at at time zone e.timezone)::date = (a.starts_at at time zone e.timezone)::date
          and (a.starts_at at time zone e.timezone)::time >= w.start_time
          and (a.ends_at   at time zone e.timezone)::time <= w.end_time
     );

  return jsonb_build_object('segments', v_n, 'outside_appointments', v_outside);
end;
$$;

-- 5) Salvar folga, férias ou bloqueio, interpretando datas/horas no fuso do estabelecimento ----
--   day_off / vacation: dias inteiros (horas ignoradas). block: horário parcial, ou dia inteiro se as duas horas forem nulas.
--   p_professional_id nulo = estabelecimento inteiro (não vale para férias).
create function public.save_schedule_block(
  p_establishment_id  uuid,
  p_id                uuid,
  p_professional_id   uuid,
  p_kind              text,
  p_start_date        date,
  p_end_date          date,
  p_start_time        time,
  p_end_time          time,
  p_reason            text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tz      text;
  v_end     date := coalesce(p_end_date, p_start_date);
  v_all_day boolean;
  v_start   timestamptz;
  v_stop    timestamptz;
  v_id      uuid;
begin
  if not private.is_member(p_establishment_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('block', 'day_off', 'vacation') then
    raise exception 'invalid_kind' using errcode = '22023';
  end if;
  if p_kind = 'vacation' and p_professional_id is null then
    raise exception 'vacation_requires_professional' using errcode = '22023';
  end if;
  if p_start_date is null then
    raise exception 'invalid_range' using errcode = '22023';
  end if;
  if v_end < p_start_date then
    raise exception 'invalid_range' using errcode = '22023';
  end if;
  if v_end - p_start_date > 365 then
    raise exception 'range_too_long' using errcode = '22023';
  end if;

  select e.timezone into v_tz from public.establishments e where e.id = p_establishment_id;
  if v_tz is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_all_day := p_kind in ('day_off', 'vacation') or (p_start_time is null and p_end_time is null);
  if not v_all_day and (p_start_time is null or p_end_time is null) then
    raise exception 'invalid_time' using errcode = '22023';
  end if;

  if v_all_day then
    v_start := p_start_date::timestamp at time zone v_tz;
    v_stop  := (v_end + 1)::timestamp at time zone v_tz;
  else
    v_start := (p_start_date + p_start_time) at time zone v_tz;
    v_stop  := (v_end + p_end_time) at time zone v_tz;
  end if;
  if v_stop <= v_start then
    raise exception 'invalid_range' using errcode = '22023';
  end if;
  if v_stop <= now() then
    raise exception 'block_in_the_past' using errcode = 'P0001';
  end if;

  if p_id is null then
    insert into public.schedule_blocks (establishment_id, professional_id, kind, starts_at, ends_at, reason)
    values (p_establishment_id, p_professional_id, p_kind, v_start, v_stop, nullif(btrim(p_reason), ''))
    returning id into v_id;
  else
    update public.schedule_blocks b
       set professional_id = p_professional_id,
           kind = p_kind,
           starts_at = v_start,
           ends_at = v_stop,
           reason = nullif(btrim(p_reason), '')
     where b.id = p_id and b.establishment_id = p_establishment_id
    returning b.id into v_id;
    if v_id is null then
      raise exception 'block_not_found' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end;
$$;

revoke all on function public.save_weekly_schedule(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.save_weekly_schedule(uuid, uuid, jsonb) to authenticated;

revoke all on function public.save_schedule_block(uuid, uuid, uuid, text, date, date, time, time, text)
  from public, anon, authenticated;
grant execute on function public.save_schedule_block(uuid, uuid, uuid, text, date, date, time, time, text)
  to authenticated;
