-- Orbit Agenda: reserva pública transacional. Chamável somente pelo service_role.
create or replace function public.create_public_booking(
  p_slug text, p_professional_id uuid, p_service_id uuid,
  p_date date, p_time time, p_customer_name text, p_customer_phone text
) returns uuid
language plpgsql security invoker set search_path = ''
as $$
declare
  v_est public.establishments%rowtype;
  v_service public.services%rowtype;
  v_customer_id uuid;
  v_booking_id uuid;
  v_start timestamptz;
  v_phone text := regexp_replace(coalesce(p_customer_phone, ''), '[^0-9]', '', 'g');
  v_name text := btrim(regexp_replace(coalesce(p_customer_name, ''), '\s+', ' ', 'g'));
begin
  if p_slug is null or p_slug !~ '^[a-z0-9-]{3,80}$'
     or p_date is null or p_time is null or extract(second from p_time) <> 0
     or char_length(v_name) not between 2 and 120
     or char_length(v_phone) not between 10 and 13 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  select * into v_est from public.establishments where slug = p_slug;
  if not found then raise exception 'establishment_not_found' using errcode = 'P0002'; end if;

  if p_date < (now() at time zone v_est.timezone)::date
     or p_date > (now() at time zone v_est.timezone)::date + 60 then
    raise exception 'date_out_of_range' using errcode = '22023';
  end if;

  select * into v_service from public.services
    where id = p_service_id and establishment_id = v_est.id and is_active;
  if not found then raise exception 'service_not_found' using errcode = 'P0002'; end if;

  if not exists (
    select 1 from public.professionals p
    join public.professional_services ps
      on ps.professional_id = p.id and ps.establishment_id = p.establishment_id
    where p.id = p_professional_id and p.establishment_id = v_est.id
      and p.is_active and ps.service_id = p_service_id
  ) then raise exception 'professional_not_available' using errcode = 'P0002'; end if;

  v_start := (p_date + p_time) at time zone v_est.timezone;
  if v_start < now() + interval '5 minutes' then
    raise exception 'too_soon' using errcode = '22023';
  end if;

  -- Serializa reservas do mesmo telefone no estabelecimento, evitando duplicações simultâneas.
  perform pg_advisory_xact_lock(hashtextextended('pb:' || v_est.id::text || ':' || v_phone, 0));
  if exists (
    select 1 from public.appointments a
    join public.customers c on c.id = a.customer_id
    where a.establishment_id = v_est.id and c.phone = v_phone
      and a.starts_at = v_start and a.status in ('scheduled', 'confirmed')
  ) then raise exception 'duplicate_booking' using errcode = '23505'; end if;

  select id into v_customer_id from public.customers
   where establishment_id = v_est.id and phone = v_phone
   order by id limit 1;
  if v_customer_id is null then
    insert into public.customers (establishment_id, full_name, phone)
    values (v_est.id, v_name, v_phone) returning id into v_customer_id;
  end if;

  insert into public.appointments
    (establishment_id, professional_id, service_id, customer_id,
     starts_at, ends_at, status, price_cents)
  values
    (v_est.id, p_professional_id, p_service_id, v_customer_id,
     v_start, v_start + v_service.duration_minutes * interval '1 minute',
     'scheduled', v_service.price_cents)
  returning id into v_booking_id;

  return v_booking_id;
end;
$$;

revoke all on function public.create_public_booking(text, uuid, uuid, date, time, text, text)
  from public, anon, authenticated;
grant execute on function public.create_public_booking(text, uuid, uuid, date, time, text, text)
  to service_role;
