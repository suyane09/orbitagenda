-- Orbit Agenda: disponibilidade publica.
-- Executavel somente pelo service_role.

create function public.get_public_available_slots(
  p_slug text,
  p_professional_id uuid,
  p_service_id uuid,
  p_date date
)
returns table (
  slot_start timestamptz,
  slot_end timestamptz
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_establishment_id uuid;
  v_timezone text;
  v_duration integer;
begin
  if p_slug is null
     or p_slug !~ '^[a-z0-9-]{3,80}$'
     or p_professional_id is null
     or p_service_id is null
     or p_date is null then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  select e.id, e.timezone
    into v_establishment_id, v_timezone
  from public.establishments e
  where e.slug = p_slug;

  if not found then
    raise exception 'establishment_not_found' using errcode = 'P0002';
  end if;

  if p_date < (now() at time zone v_timezone)::date
     or p_date > (now() at time zone v_timezone)::date + 60 then
    raise exception 'date_out_of_range' using errcode = '22023';
  end if;

  select s.duration_minutes into v_duration
  from public.services s
  where s.id = p_service_id
    and s.establishment_id = v_establishment_id
    and s.is_active;

  if not found then
    raise exception 'service_not_found' using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from public.professionals p
    join public.professional_services ps
      on ps.professional_id = p.id
     and ps.establishment_id = p.establishment_id
    where p.id = p_professional_id
      and p.establishment_id = v_establishment_id
      and p.is_active
      and ps.service_id = p_service_id
  ) then
    raise exception 'professional_not_available'
      using errcode = 'P0002';
  end if;

  return query
  with candidates as (
    select (
      (p_date::timestamp + g.minute_offset * interval '1 minute')
      at time zone v_timezone
    ) as starts_at
    from public.working_hours w
    cross join lateral generate_series(
      (
        extract(hour from w.start_time) * 60
        + extract(minute from w.start_time)
      )::integer,
      (
        extract(hour from w.end_time) * 60
        + extract(minute from w.end_time)
      )::integer - v_duration,
      15
    ) as g(minute_offset)
    where w.establishment_id = v_establishment_id
      and w.professional_id = p_professional_id
      and w.weekday = extract(dow from p_date)::integer
  )
  select
    c.starts_at,
    c.starts_at + v_duration * interval '1 minute'
  from candidates c
  where c.starts_at >= now() + interval '5 minutes'
    and not exists (
      select 1
      from public.appointments a
      where a.establishment_id = v_establishment_id
        and a.professional_id = p_professional_id
        and a.status in ('scheduled', 'confirmed')
        and a.starts_at < c.starts_at
          + v_duration * interval '1 minute'
        and c.starts_at < a.ends_at
    )
    and not exists (
      select 1
      from public.schedule_blocks b
      where b.establishment_id = v_establishment_id
        and (
          b.professional_id is null
          or b.professional_id = p_professional_id
        )
        and b.starts_at < c.starts_at
          + v_duration * interval '1 minute'
        and c.starts_at < b.ends_at
    )
  order by c.starts_at;
end;
$$;

revoke all on function public.get_public_available_slots(
  text, uuid, uuid, date
) from public, anon, authenticated;

grant execute on function public.get_public_available_slots(
  text, uuid, uuid, date
) to service_role;