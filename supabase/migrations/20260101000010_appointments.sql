-- Orbit Agenda · Etapa 2 · 0010 · Agenda interna (agendamentos)
-- Incremental: reutiliza appointments (RLS, grants e a EXCLUDE appointments_no_overlap da 0002/0004/0005 permanecem).
--   * O TRIGGER é a única fonte das regras e vale para QUALQUER escrita permitida pela RLS (RPC ou INSERT/UPDATE direto):
--     status, estabelecimento/registros relacionados, profissional/serviço ativos, vínculo profissional–serviço,
--     duração, expediente + intervalos, bloqueios/folgas/férias e conflitos.
--   * RPCs SECURITY INVOKER (RLS do usuário vale): save_appointment, set_appointment_status,
--     get_available_slots, list_appointments. Datas/horas são interpretadas no fuso do ESTABELECIMENTO.
-- Concorrência: lock consultivo POR PROFISSIONAL (mesma chave 'sb:<pro>' dos bloqueios) + lock compartilhado
-- por estabelecimento (conflita com bloqueio "da agenda inteira", que usa o lock exclusivo) + a EXCLUDE como última barreira.

-- 1) Regras no banco ---------------------------------------------------------------
-- Status: nasce scheduled/confirmed; scheduled → confirmed → completed; scheduled/confirmed → cancelled / no_show.
-- Concluído/cancelado/faltou é final (só observações podem mudar). Concluir/faltou só após o início.
-- Mudança só de status (confirmar, concluir, cancelar) nunca reavalia expediente/bloqueio: o cliente já foi marcado.
-- Reavalia tudo ao criar ou ao mudar profissional, serviço ou horário.
-- Erros: 23503 relacionado de outra empresa/inexistente (igual à FK) · 23P01 conflito · 22023 horário inválido · P0001 demais regras.
create function private.check_appointment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tz      text;
  v_ls      timestamp;
  v_le      timestamp;
  v_dur     integer;
  v_s_act   boolean;
  v_p_act   boolean;
  v_moved   boolean;
begin
  -- BEFORE ROW roda antes do WITH CHECK da RLS e este corpo é SECURITY DEFINER: usuário logado que não é membro da
  -- empresa da linha é barrado aqui, sem ler nem travar nada dela (sem vazar existência de registros de outra empresa).
  -- Sem usuário (papel de serviço/migrações) a checagem é pulada; a RLS continua valendo para authenticated.
  if (select auth.uid()) is not null and not private.is_member(new.establishment_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' then
    if new.establishment_id is distinct from old.establishment_id then
      raise exception 'establishment_id is immutable' using errcode = '42501';
    end if;
    v_moved := new.professional_id <> old.professional_id or new.service_id <> old.service_id
            or new.starts_at <> old.starts_at or new.ends_at <> old.ends_at;

    if old.status in ('completed', 'cancelled', 'no_show') then
      if new.status is distinct from old.status or v_moved
         or new.customer_id <> old.customer_id or new.price_cents <> old.price_cents then
        raise exception 'appointment_closed' using errcode = 'P0001';
      end if;
      return new;
    end if;

    if new.status <> old.status then
      if not ((old.status = 'scheduled' and new.status in ('confirmed', 'completed', 'cancelled', 'no_show'))
           or (old.status = 'confirmed' and new.status in ('completed', 'cancelled', 'no_show'))) then
        raise exception 'invalid_status_transition' using errcode = 'P0001';
      end if;
      if new.status in ('completed', 'no_show') and new.starts_at > now() then
        raise exception 'appointment_not_started' using errcode = 'P0001';
      end if;
    end if;

    if new.status not in ('scheduled', 'confirmed') then
      if v_moved then raise exception 'appointment_closed' using errcode = 'P0001'; end if;
      return new;
    end if;
    if not v_moved then return new; end if;
  else
    if new.status not in ('scheduled', 'confirmed') then
      raise exception 'invalid_status_transition' using errcode = 'P0001';
    end if;
  end if;

  -- Horário em minutos cheios, no futuro.
  if extract(second from new.starts_at) <> 0 or extract(second from new.ends_at) <> 0 then
    raise exception 'invalid_time' using errcode = '22023';
  end if;
  if new.ends_at <= now() then
    raise exception 'appointment_in_the_past' using errcode = 'P0001';
  end if;

  -- Registros relacionados pertencem ao MESMO estabelecimento (mesmo SQLSTATE da FK composta).
  perform 1 from public.customers c where c.id = new.customer_id and c.establishment_id = new.establishment_id;
  if not found then raise exception 'related_record_not_found' using errcode = '23503'; end if;
  select p.is_active into v_p_act from public.professionals p
   where p.id = new.professional_id and p.establishment_id = new.establishment_id;
  if not found then raise exception 'related_record_not_found' using errcode = '23503'; end if;
  select s.duration_minutes, s.is_active into v_dur, v_s_act from public.services s
   where s.id = new.service_id and s.establishment_id = new.establishment_id;
  if not found then raise exception 'related_record_not_found' using errcode = '23503'; end if;

  -- Ativos / vínculo: só ao criar ou ao trocar (reagendar um atendimento antigo não falha porque o serviço foi desativado).
  if tg_op = 'INSERT' or new.professional_id <> old.professional_id then
    if not v_p_act then raise exception 'professional_inactive' using errcode = 'P0001'; end if;
  end if;
  if tg_op = 'INSERT' or new.service_id <> old.service_id then
    if not v_s_act then raise exception 'service_inactive' using errcode = 'P0001'; end if;
  end if;
  if tg_op = 'INSERT' or new.professional_id <> old.professional_id or new.service_id <> old.service_id then
    perform 1 from public.professional_services ps
     where ps.establishment_id = new.establishment_id
       and ps.professional_id = new.professional_id and ps.service_id = new.service_id;
    if not found then raise exception 'service_not_offered' using errcode = 'P0001'; end if;
  end if;

  -- Duração = a do serviço (ao criar ou ao mudar serviço/horário).
  if tg_op = 'INSERT' or new.service_id <> old.service_id
     or new.starts_at <> old.starts_at or new.ends_at <> old.ends_at then
    if new.ends_at - new.starts_at <> v_dur * interval '1 minute' then
      raise exception 'invalid_duration' using errcode = 'P0001';
    end if;
  end if;

  -- Serializa agendamentos/bloqueios concorrentes (os locks são liberados no fim da transação).
  perform pg_advisory_xact_lock_shared(hashtextextended('sb:' || new.establishment_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('sb:' || new.professional_id::text, 0));

  -- Expediente e intervalos: o atendimento cabe INTEIRO em um trecho do mesmo dia (fuso do estabelecimento).
  select e.timezone into v_tz from public.establishments e where e.id = new.establishment_id;
  v_ls := new.starts_at at time zone v_tz;
  v_le := new.ends_at   at time zone v_tz;
  perform 1 from public.working_hours w
   where w.establishment_id = new.establishment_id
     and w.professional_id = new.professional_id
     and w.weekday = extract(dow from v_ls)::int
     and v_ls::date = v_le::date
     and w.start_time <= v_ls::time and w.end_time >= v_le::time;
  if not found then raise exception 'outside_working_hours' using errcode = 'P0001'; end if;

  -- Folgas, férias e bloqueios (do profissional ou do estabelecimento todo).
  if exists (
    select 1 from public.schedule_blocks b
     where b.establishment_id = new.establishment_id
       and (b.professional_id is null or b.professional_id = new.professional_id)
       and b.starts_at < new.ends_at and new.starts_at < b.ends_at
  ) then
    raise exception 'blocked_period' using errcode = 'P0001';
  end if;

  -- Conflito com outro atendimento ativo do profissional (a EXCLUDE continua como última barreira).
  if exists (
    select 1 from public.appointments a
     where a.professional_id = new.professional_id
       and a.id <> new.id
       and a.status in ('scheduled', 'confirmed')
       and a.starts_at < new.ends_at and new.starts_at < a.ends_at
  ) then
    raise exception 'appointment_conflict' using errcode = '23P01';
  end if;
  return new;
end;
$$;
revoke all on function private.check_appointment() from public, anon, authenticated;

create trigger check_appointment before insert or update on public.appointments
  for each row execute function private.check_appointment();

create index appointments_pro_time_idx on public.appointments (professional_id, starts_at)
  where status in ('scheduled', 'confirmed');

-- 2) Criar / editar agendamento ---------------------------------------------------------
-- Converte data/hora local em instantes, aplica duração e preço do serviço e grava; TODAS as regras de agenda
-- (expediente, bloqueios, conflitos...) são do trigger check_appointment. Editar só vale para agendado/confirmado.
create function public.save_appointment(
  p_establishment_id  uuid,
  p_id                uuid,
  p_customer_id       uuid,
  p_professional_id   uuid,
  p_service_id        uuid,
  p_date              date,
  p_time              time,
  p_notes             text,
  p_price_cents       integer default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tz      text;
  v_dur     integer;
  v_price   integer;
  v_start   timestamptz;
  v_end     timestamptz;
  v_old     public.appointments%rowtype;
  v_id      uuid;
begin
  if not private.is_member(p_establishment_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_date is null or p_time is null or extract(second from p_time) <> 0 then
    raise exception 'invalid_time' using errcode = '22023';
  end if;
  if p_price_cents is not null and p_price_cents < 0 then
    raise exception 'invalid_price' using errcode = '22023';
  end if;

  select e.timezone into v_tz from public.establishments e where e.id = p_establishment_id;
  if v_tz is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  perform 1 from public.customers c where c.id = p_customer_id and c.establishment_id = p_establishment_id;
  if not found then raise exception 'customer_not_found' using errcode = 'P0002'; end if;
  perform 1 from public.professionals p where p.id = p_professional_id and p.establishment_id = p_establishment_id;
  if not found then raise exception 'professional_not_found' using errcode = 'P0002'; end if;
  select s.duration_minutes, s.price_cents into v_dur, v_price
    from public.services s where s.id = p_service_id and s.establishment_id = p_establishment_id;
  if v_dur is null then raise exception 'service_not_found' using errcode = 'P0002'; end if;

  v_start := (p_date + p_time) at time zone v_tz;
  v_end   := v_start + v_dur * interval '1 minute';

  if p_id is not null then
    select * into v_old from public.appointments a
     where a.id = p_id and a.establishment_id = p_establishment_id for update;
    if not found then raise exception 'appointment_not_found' using errcode = 'P0002'; end if;
    if v_old.status not in ('scheduled', 'confirmed') then
      raise exception 'appointment_closed' using errcode = 'P0001';
    end if;
    -- Mesmo serviço e mesmo início: preserva o fim original (a duração do serviço pode ter mudado depois).
    if v_old.service_id = p_service_id and v_old.starts_at = v_start then v_end := v_old.ends_at; end if;

    update public.appointments a
       set customer_id = p_customer_id, professional_id = p_professional_id, service_id = p_service_id,
           starts_at = v_start, ends_at = v_end,
           price_cents = coalesce(p_price_cents, case when v_old.service_id <> p_service_id then v_price else v_old.price_cents end),
           notes = nullif(btrim(p_notes), '')
     where a.id = p_id and a.establishment_id = p_establishment_id
    returning a.id into v_id;
  else
    insert into public.appointments
      (establishment_id, professional_id, service_id, customer_id, starts_at, ends_at, status, price_cents, notes)
    values
      (p_establishment_id, p_professional_id, p_service_id, p_customer_id, v_start, v_end, 'scheduled',
       coalesce(p_price_cents, v_price), nullif(btrim(p_notes), ''))
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

-- 3) Confirmar / concluir / cancelar / faltou ------------------------------------------------
create function public.set_appointment_status(
  p_establishment_id uuid,
  p_id               uuid,
  p_status           text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare v_id uuid;
begin
  if not private.is_member(p_establishment_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('scheduled', 'confirmed', 'completed', 'cancelled', 'no_show') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  update public.appointments a
     set status = p_status::public.appointment_status
   where a.id = p_id and a.establishment_id = p_establishment_id
  returning a.id into v_id;
  if v_id is null then
    raise exception 'appointment_not_found' using errcode = 'P0002';
  end if;
end;
$$;

-- 4) Horários disponíveis (dia no fuso do estabelecimento) ------------------------------------
-- Candidatos a cada p_step_minutes dentro de cada trecho do expediente (o intervalo é a lacuna entre trechos),
-- sem sobrepor agendamentos ativos (exceto p_exclude_appointment_id) nem folgas/férias/bloqueios, e não no passado.
create function public.get_available_slots(
  p_establishment_id        uuid,
  p_professional_id         uuid,
  p_service_id              uuid,
  p_date                    date,
  p_exclude_appointment_id  uuid default null,
  p_step_minutes            integer default 15
)
returns table (slot_start timestamptz, slot_end timestamptz)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_tz  text;
  v_dur integer;
begin
  if not private.is_member(p_establishment_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_date is null or p_step_minutes is null or p_step_minutes not between 5 and 120 then
    raise exception 'invalid_range' using errcode = '22023';
  end if;
  select e.timezone into v_tz from public.establishments e where e.id = p_establishment_id;
  select s.duration_minutes into v_dur from public.services s
   where s.id = p_service_id and s.establishment_id = p_establishment_id;
  if v_tz is null or v_dur is null then
    raise exception 'service_not_found' using errcode = 'P0002';
  end if;
  perform 1 from public.professionals p
   where p.id = p_professional_id and p.establishment_id = p_establishment_id and p.is_active;
  if not found then
    raise exception 'professional_not_found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.professional_services ps
                  where ps.professional_id = p_professional_id and ps.service_id = p_service_id) then
    return;
  end if;

  return query
  with cand as (
    select ((p_date::timestamp + g.m * interval '1 minute') at time zone v_tz) as s
      from public.working_hours w
     cross join lateral generate_series(
       (extract(hour from w.start_time) * 60 + extract(minute from w.start_time))::int,
       (extract(hour from w.end_time)   * 60 + extract(minute from w.end_time))::int - v_dur,
       p_step_minutes) as g(m)
     where w.professional_id = p_professional_id
       and w.establishment_id = p_establishment_id
       and w.weekday = extract(dow from p_date)::int
  )
  select c.s, c.s + v_dur * interval '1 minute'
    from cand c
   where c.s >= now()
     and not exists (
       select 1 from public.appointments a
        where a.professional_id = p_professional_id
          and a.status in ('scheduled', 'confirmed')
          and a.id is distinct from p_exclude_appointment_id
          and a.starts_at < c.s + v_dur * interval '1 minute' and c.s < a.ends_at)
     and not exists (
       select 1 from public.schedule_blocks b
        where b.establishment_id = p_establishment_id
          and (b.professional_id is null or b.professional_id = p_professional_id)
          and b.starts_at < c.s + v_dur * interval '1 minute' and c.s < b.ends_at)
   order by c.s;
end;
$$;

-- 5) Listagem da agenda (diária/semanal): p_from..p_to inclusive, no fuso do estabelecimento ---
create function public.list_appointments(
  p_establishment_id  uuid,
  p_from              date,
  p_to                date,
  p_professional_id   uuid default null
)
returns table (
  id uuid, professional_id uuid, professional_name text, professional_color text,
  service_id uuid, service_name text, customer_id uuid, customer_name text, customer_phone text,
  starts_at timestamptz, ends_at timestamptz, status public.appointment_status,
  price_cents integer, notes text
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare v_tz text;
begin
  if not private.is_member(p_establishment_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'invalid_range' using errcode = '22023';
  end if;
  if p_to - p_from > 62 then
    raise exception 'range_too_long' using errcode = '22023';
  end if;
  select e.timezone into v_tz from public.establishments e where e.id = p_establishment_id;
  if v_tz is null then raise exception 'forbidden' using errcode = '42501'; end if;

  return query
  select a.id, a.professional_id, p.name, p.color, a.service_id, s.name, a.customer_id, c.full_name, c.phone,
         a.starts_at, a.ends_at, a.status, a.price_cents, a.notes
    from public.appointments a
    join public.professionals p on p.id = a.professional_id and p.establishment_id = a.establishment_id
    join public.services s      on s.id = a.service_id      and s.establishment_id = a.establishment_id
    join public.customers c     on c.id = a.customer_id     and c.establishment_id = a.establishment_id
   where a.establishment_id = p_establishment_id
     and a.starts_at >= (p_from::timestamp at time zone v_tz)
     and a.starts_at <  ((p_to + 1)::timestamp at time zone v_tz)
     and (p_professional_id is null or a.professional_id = p_professional_id)
   order by a.starts_at, p.name;
end;
$$;

revoke all on function public.save_appointment(uuid, uuid, uuid, uuid, uuid, date, time, text, integer) from public, anon, authenticated;
grant execute on function public.save_appointment(uuid, uuid, uuid, uuid, uuid, date, time, text, integer) to authenticated;
revoke all on function public.set_appointment_status(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.set_appointment_status(uuid, uuid, text) to authenticated;
revoke all on function public.get_available_slots(uuid, uuid, uuid, date, uuid, integer) from public, anon, authenticated;
grant execute on function public.get_available_slots(uuid, uuid, uuid, date, uuid, integer) to authenticated;
revoke all on function public.list_appointments(uuid, date, date, uuid) from public, anon, authenticated;
grant execute on function public.list_appointments(uuid, date, date, uuid) to authenticated;
