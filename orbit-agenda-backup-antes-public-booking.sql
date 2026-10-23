


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "private";


ALTER SCHEMA "private" OWNER TO "postgres";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "btree_gist" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."appointment_status" AS ENUM (
    'scheduled',
    'confirmed',
    'completed',
    'cancelled',
    'no_show'
);


ALTER TYPE "public"."appointment_status" OWNER TO "postgres";


CREATE TYPE "public"."business_type" AS ENUM (
    'barbershop',
    'salon',
    'other'
);


ALTER TYPE "public"."business_type" OWNER TO "postgres";


CREATE TYPE "public"."membership_role" AS ENUM (
    'owner',
    'staff'
);


ALTER TYPE "public"."membership_role" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."check_appointment"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "private"."check_appointment"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."check_schedule_block"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "private"."check_schedule_block"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."check_working_hours"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "private"."check_working_hours"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."is_member"("p_establishment_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1 from public.memberships m
    where m.establishment_id = p_establishment_id
      and m.user_id = (select auth.uid())
      and m.is_active
  );
$$;


ALTER FUNCTION "private"."is_member"("p_establishment_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."is_owner"("p_establishment_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1 from public.memberships m
    where m.establishment_id = p_establishment_id
      and m.user_id = (select auth.uid())
      and m.is_active
      and m.role = 'owner'
  );
$$;


ALTER FUNCTION "private"."is_owner"("p_establishment_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."is_superadmin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1 from public.platform_admins pa
    where pa.user_id = (select auth.uid())
  );
$$;


ALTER FUNCTION "private"."is_superadmin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."normalize_customer"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  new.full_name := btrim(regexp_replace(new.full_name, '\s+', ' ', 'g'));
  new.phone     := nullif(btrim(regexp_replace(coalesce(new.phone, ''), '\s+', ' ', 'g')), '');
  new.email     := nullif(lower(btrim(coalesce(new.email, ''))), '');
  new.notes     := nullif(btrim(new.notes), '');
  return new;
end;
$$;


ALTER FUNCTION "private"."normalize_customer"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."normalize_professional"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  new.name := btrim(regexp_replace(new.name, '\s+', ' ', 'g'));
  new.bio  := nullif(btrim(new.bio), '');
  return new;
end;
$$;


ALTER FUNCTION "private"."normalize_professional"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."normalize_service"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  new.name        := btrim(regexp_replace(new.name, '\s+', ' ', 'g'));
  new.description := nullif(btrim(new.description), '');
  new.category    := nullif(btrim(regexp_replace(coalesce(new.category, ''), '\s+', ' ', 'g')), '');
  return new;
end;
$$;


ALTER FUNCTION "private"."normalize_service"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."prevent_tenant_change"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if new.establishment_id is distinct from old.establishment_id then
    raise exception 'establishment_id is immutable'
      using errcode = '42501';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "private"."prevent_tenant_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."set_created_by"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  new.created_by := (select auth.uid());
  return new;
end;
$$;


ALTER FUNCTION "private"."set_created_by"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  new.updated_at := now();
  return new;
end;
$$;


ALTER FUNCTION "private"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."shares_establishment_with"("p_user_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1
    from public.memberships mine
    join public.memberships theirs
      on theirs.establishment_id = mine.establishment_id
    where mine.user_id = (select auth.uid())
      and mine.is_active
      and theirs.user_id = p_user_id
      and theirs.is_active
  );
$$;


ALTER FUNCTION "private"."shares_establishment_with"("p_user_id" "uuid") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."establishments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "business_type" "public"."business_type" DEFAULT 'barbershop'::"public"."business_type" NOT NULL,
    "phone" "text",
    "timezone" "text" DEFAULT 'America/Sao_Paulo'::"text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "establishments_name_check" CHECK ((("char_length"("name") >= 2) AND ("char_length"("name") <= 80))),
    CONSTRAINT "establishments_phone_check" CHECK ((("phone" IS NULL) OR ("char_length"("phone") <= 30))),
    CONSTRAINT "establishments_slug_check" CHECK ((("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::"text") AND (("char_length"("slug") >= 3) AND ("char_length"("slug") <= 60))))
);


ALTER TABLE "public"."establishments" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_establishment"("p_name" "text", "p_business_type" "public"."business_type" DEFAULT 'barbershop'::"public"."business_type", "p_phone" "text" DEFAULT NULL::"text", "p_timezone" "text" DEFAULT 'America/Sao_Paulo'::"text") RETURNS "public"."establishments"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_uid   uuid := (select auth.uid());
  v_name  text := btrim(coalesce(p_name, ''));
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_base  text;
  v_slug  text;
  v_row   public.establishments;
  v_try   integer := 0;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  if char_length(v_name) not between 2 and 80 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;

  if v_phone is not null and char_length(v_phone) > 30 then
    raise exception 'invalid_phone' using errcode = '22023';
  end if;

  if not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = p_timezone) then
    raise exception 'invalid_timezone' using errcode = '22023';
  end if;

  -- Limite anti-abuso: no máximo 3 estabelecimentos por proprietário.
  if (select count(*) from public.memberships m
      where m.user_id = v_uid and m.role = 'owner') >= 3 then
    raise exception 'establishment_limit_reached' using errcode = 'P0001';
  end if;

  v_base := regexp_replace(
              translate(lower(v_name),
                        'áàâãäéèêëíìîïóòôõöúùûüçñ',
                        'aaaaaeeeeiiiiooooouuuucn'),
              '[^a-z0-9]+', '-', 'g');
  v_base := btrim(left(v_base, 40), '-');
  if char_length(v_base) < 3 then
    v_base := 'estabelecimento';
  end if;

  loop
    v_slug := case when v_try = 0 then v_base
                   else v_base || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6) end;
    begin
      insert into public.establishments (name, slug, business_type, phone, timezone, created_by)
      values (v_name, v_slug, p_business_type, v_phone, p_timezone, v_uid)
      returning * into v_row;
      exit;
    exception when unique_violation then
      v_try := v_try + 1;
      if v_try > 5 then raise; end if;
    end;
  end loop;

  insert into public.memberships (establishment_id, user_id, role)
  values (v_row.id, v_uid, 'owner');

  return v_row;
end;
$$;


ALTER FUNCTION "public"."create_establishment"("p_name" "text", "p_business_type" "public"."business_type", "p_phone" "text", "p_timezone" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_available_slots"("p_establishment_id" "uuid", "p_professional_id" "uuid", "p_service_id" "uuid", "p_date" "date", "p_exclude_appointment_id" "uuid" DEFAULT NULL::"uuid", "p_step_minutes" integer DEFAULT 15) RETURNS TABLE("slot_start" timestamp with time zone, "slot_end" timestamp with time zone)
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."get_available_slots"("p_establishment_id" "uuid", "p_professional_id" "uuid", "p_service_id" "uuid", "p_date" "date", "p_exclude_appointment_id" "uuid", "p_step_minutes" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    left(
      coalesce(
        nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
        nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
        'Usuário'
      ),
      120
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_platform_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select private.is_superadmin();
$$;


ALTER FUNCTION "public"."is_platform_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_appointments"("p_establishment_id" "uuid", "p_from" "date", "p_to" "date", "p_professional_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("id" "uuid", "professional_id" "uuid", "professional_name" "text", "professional_color" "text", "service_id" "uuid", "service_name" "text", "customer_id" "uuid", "customer_name" "text", "customer_phone" "text", "starts_at" timestamp with time zone, "ends_at" timestamp with time zone, "status" "public"."appointment_status", "price_cents" integer, "notes" "text")
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."list_appointments"("p_establishment_id" "uuid", "p_from" "date", "p_to" "date", "p_professional_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_appointment"("p_establishment_id" "uuid", "p_id" "uuid", "p_customer_id" "uuid", "p_professional_id" "uuid", "p_service_id" "uuid", "p_date" "date", "p_time" time without time zone, "p_notes" "text", "p_price_cents" integer DEFAULT NULL::integer) RETURNS "uuid"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."save_appointment"("p_establishment_id" "uuid", "p_id" "uuid", "p_customer_id" "uuid", "p_professional_id" "uuid", "p_service_id" "uuid", "p_date" "date", "p_time" time without time zone, "p_notes" "text", "p_price_cents" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_professional"("p_establishment_id" "uuid", "p_id" "uuid", "p_name" "text", "p_bio" "text", "p_color" "text", "p_is_active" boolean, "p_service_ids" "uuid"[]) RETURNS "uuid"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_id   uuid;
  v_ids  uuid[] := coalesce(p_service_ids, '{}');
begin
  if not private.is_owner(p_establishment_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if cardinality(v_ids) > 100 then
    raise exception 'too_many_services' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.professionals (establishment_id, name, bio, color, is_active)
    values (p_establishment_id, p_name, p_bio,
            coalesce(p_color, '#3B36D9'), coalesce(p_is_active, true))
    returning id into v_id;
  else
    update public.professionals pr
       set name      = p_name,
           bio       = p_bio,
           color     = coalesce(p_color, pr.color),
           is_active = coalesce(p_is_active, pr.is_active)
     where pr.id = p_id and pr.establishment_id = p_establishment_id
    returning pr.id into v_id;
    if v_id is null then
      raise exception 'professional_not_found' using errcode = 'P0002';
    end if;
  end if;

  delete from public.professional_services ps
   where ps.professional_id = v_id and ps.service_id <> all (v_ids);

  insert into public.professional_services (establishment_id, professional_id, service_id)
  select distinct p_establishment_id, v_id, s.service_id
    from unnest(v_ids) as s(service_id)
  on conflict do nothing;

  return v_id;
end;
$$;


ALTER FUNCTION "public"."save_professional"("p_establishment_id" "uuid", "p_id" "uuid", "p_name" "text", "p_bio" "text", "p_color" "text", "p_is_active" boolean, "p_service_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_schedule_block"("p_establishment_id" "uuid", "p_id" "uuid", "p_professional_id" "uuid", "p_kind" "text", "p_start_date" "date", "p_end_date" "date", "p_start_time" time without time zone, "p_end_time" time without time zone, "p_reason" "text") RETURNS "uuid"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."save_schedule_block"("p_establishment_id" "uuid", "p_id" "uuid", "p_professional_id" "uuid", "p_kind" "text", "p_start_date" "date", "p_end_date" "date", "p_start_time" time without time zone, "p_end_time" time without time zone, "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_weekly_schedule"("p_establishment_id" "uuid", "p_professional_id" "uuid", "p_segments" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."save_weekly_schedule"("p_establishment_id" "uuid", "p_professional_id" "uuid", "p_segments" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_appointment_status"("p_establishment_id" "uuid", "p_id" "uuid", "p_status" "text") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."set_appointment_status"("p_establishment_id" "uuid", "p_id" "uuid", "p_status" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."appointments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "establishment_id" "uuid" NOT NULL,
    "professional_id" "uuid" NOT NULL,
    "service_id" "uuid" NOT NULL,
    "customer_id" "uuid" NOT NULL,
    "starts_at" timestamp with time zone NOT NULL,
    "ends_at" timestamp with time zone NOT NULL,
    "status" "public"."appointment_status" DEFAULT 'scheduled'::"public"."appointment_status" NOT NULL,
    "price_cents" integer NOT NULL,
    "notes" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "appointments_check" CHECK (("ends_at" > "starts_at")),
    CONSTRAINT "appointments_notes_check" CHECK ((("notes" IS NULL) OR ("char_length"("notes") <= 1000))),
    CONSTRAINT "appointments_price_cents_check" CHECK (("price_cents" >= 0))
);


ALTER TABLE "public"."appointments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."customers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "establishment_id" "uuid" NOT NULL,
    "full_name" "text" NOT NULL,
    "phone" "text",
    "email" "text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "customers_email_check" CHECK ((("email" IS NULL) OR ("char_length"("email") <= 254))),
    CONSTRAINT "customers_full_name_check" CHECK ((("char_length"("full_name") >= 2) AND ("char_length"("full_name") <= 120))),
    CONSTRAINT "customers_notes_check" CHECK ((("notes" IS NULL) OR ("char_length"("notes") <= 1000))),
    CONSTRAINT "customers_phone_check" CHECK ((("phone" IS NULL) OR ("char_length"("phone") <= 30)))
);


ALTER TABLE "public"."customers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."memberships" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "establishment_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "public"."membership_role" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."memberships" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."platform_admins" (
    "user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."platform_admins" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."professional_services" (
    "establishment_id" "uuid" NOT NULL,
    "professional_id" "uuid" NOT NULL,
    "service_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."professional_services" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."professionals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "establishment_id" "uuid" NOT NULL,
    "membership_id" "uuid",
    "name" "text" NOT NULL,
    "bio" "text",
    "color" "text" DEFAULT '#3B36D9'::"text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "professionals_bio_check" CHECK ((("bio" IS NULL) OR ("char_length"("bio") <= 500))),
    CONSTRAINT "professionals_color_check" CHECK (("color" ~ '^#[0-9A-Fa-f]{6}$'::"text")),
    CONSTRAINT "professionals_name_check" CHECK ((("char_length"("name") >= 2) AND ("char_length"("name") <= 80)))
);


ALTER TABLE "public"."professionals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "full_name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "profiles_full_name_check" CHECK ((("char_length"("full_name") >= 1) AND ("char_length"("full_name") <= 120)))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."schedule_blocks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "establishment_id" "uuid" NOT NULL,
    "professional_id" "uuid",
    "starts_at" timestamp with time zone NOT NULL,
    "ends_at" timestamp with time zone NOT NULL,
    "reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "kind" "text" DEFAULT 'block'::"text" NOT NULL,
    CONSTRAINT "schedule_blocks_check" CHECK (("ends_at" > "starts_at")),
    CONSTRAINT "schedule_blocks_kind_check" CHECK (("kind" = ANY (ARRAY['block'::"text", 'day_off'::"text", 'vacation'::"text"]))),
    CONSTRAINT "schedule_blocks_reason_check" CHECK ((("reason" IS NULL) OR ("char_length"("reason") <= 200))),
    CONSTRAINT "schedule_blocks_vacation_has_professional" CHECK ((("kind" <> 'vacation'::"text") OR ("professional_id" IS NOT NULL)))
);


ALTER TABLE "public"."schedule_blocks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."services" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "establishment_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "duration_minutes" integer NOT NULL,
    "price_cents" integer NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "category" "text",
    CONSTRAINT "services_category_check" CHECK ((("category" IS NULL) OR (("char_length"("category") >= 1) AND ("char_length"("category") <= 40)))),
    CONSTRAINT "services_description_check" CHECK ((("description" IS NULL) OR ("char_length"("description") <= 500))),
    CONSTRAINT "services_duration_minutes_check" CHECK ((("duration_minutes" >= 5) AND ("duration_minutes" <= 720))),
    CONSTRAINT "services_name_check" CHECK ((("char_length"("name") >= 2) AND ("char_length"("name") <= 80))),
    CONSTRAINT "services_price_cents_check" CHECK (("price_cents" >= 0)),
    CONSTRAINT "services_price_max" CHECK (("price_cents" <= 10000000))
);


ALTER TABLE "public"."services" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."working_hours" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "establishment_id" "uuid" NOT NULL,
    "professional_id" "uuid" NOT NULL,
    "weekday" smallint NOT NULL,
    "start_time" time without time zone NOT NULL,
    "end_time" time without time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "working_hours_check" CHECK (("end_time" > "start_time")),
    CONSTRAINT "working_hours_weekday_check" CHECK ((("weekday" >= 0) AND ("weekday" <= 6)))
);


ALTER TABLE "public"."working_hours" OWNER TO "postgres";


ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_no_overlap" EXCLUDE USING "gist" ("professional_id" WITH =, "tstzrange"("starts_at", "ends_at", '[)'::"text") WITH &&) WHERE (("status" = ANY (ARRAY['scheduled'::"public"."appointment_status", 'confirmed'::"public"."appointment_status"])));



ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_pkey" PRIMARY KEY ("id");



ALTER TABLE "public"."customers"
    ADD CONSTRAINT "customers_email_format" CHECK ((("email" IS NULL) OR ("email" ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'::"text"))) NOT VALID;



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_id_establishment_id_key" UNIQUE ("id", "establishment_id");



ALTER TABLE "public"."customers"
    ADD CONSTRAINT "customers_phone_digits" CHECK ((("phone" IS NULL) OR (("char_length"("regexp_replace"("phone", '\D'::"text", ''::"text", 'g'::"text")) >= 8) AND ("char_length"("regexp_replace"("phone", '\D'::"text", ''::"text", 'g'::"text")) <= 15)))) NOT VALID;



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."establishments"
    ADD CONSTRAINT "establishments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."establishments"
    ADD CONSTRAINT "establishments_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."memberships"
    ADD CONSTRAINT "memberships_establishment_id_user_id_key" UNIQUE ("establishment_id", "user_id");



ALTER TABLE ONLY "public"."memberships"
    ADD CONSTRAINT "memberships_id_establishment_id_key" UNIQUE ("id", "establishment_id");



ALTER TABLE ONLY "public"."memberships"
    ADD CONSTRAINT "memberships_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."platform_admins"
    ADD CONSTRAINT "platform_admins_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."professional_services"
    ADD CONSTRAINT "professional_services_pkey" PRIMARY KEY ("professional_id", "service_id");



ALTER TABLE ONLY "public"."professionals"
    ADD CONSTRAINT "professionals_id_establishment_id_key" UNIQUE ("id", "establishment_id");



ALTER TABLE ONLY "public"."professionals"
    ADD CONSTRAINT "professionals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."schedule_blocks"
    ADD CONSTRAINT "schedule_blocks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."services"
    ADD CONSTRAINT "services_id_establishment_id_key" UNIQUE ("id", "establishment_id");



ALTER TABLE ONLY "public"."services"
    ADD CONSTRAINT "services_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."working_hours"
    ADD CONSTRAINT "working_hours_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."working_hours"
    ADD CONSTRAINT "working_hours_professional_id_weekday_start_time_key" UNIQUE ("professional_id", "weekday", "start_time");



CREATE INDEX "appointments_customer_idx" ON "public"."appointments" USING "btree" ("customer_id", "starts_at" DESC);



CREATE INDEX "appointments_est_time_idx" ON "public"."appointments" USING "btree" ("establishment_id", "starts_at");



CREATE INDEX "appointments_pro_time_idx" ON "public"."appointments" USING "btree" ("professional_id", "starts_at") WHERE ("status" = ANY (ARRAY['scheduled'::"public"."appointment_status", 'confirmed'::"public"."appointment_status"]));



CREATE UNIQUE INDEX "customers_email_uq" ON "public"."customers" USING "btree" ("establishment_id", "email") WHERE ("email" IS NOT NULL);



CREATE INDEX "customers_est_name_idx" ON "public"."customers" USING "btree" ("establishment_id", "lower"("full_name"));



CREATE INDEX "customers_establishment_idx" ON "public"."customers" USING "btree" ("establishment_id");



CREATE UNIQUE INDEX "customers_phone_uq" ON "public"."customers" USING "btree" ("establishment_id", "regexp_replace"("regexp_replace"("phone", '\D'::"text", ''::"text", 'g'::"text"), '^55(\d{10,11})$'::"text", '\1'::"text")) WHERE ("phone" IS NOT NULL);



CREATE INDEX "memberships_user_id_idx" ON "public"."memberships" USING "btree" ("user_id");



CREATE INDEX "professional_services_est_idx" ON "public"."professional_services" USING "btree" ("establishment_id");



CREATE INDEX "professional_services_service_idx" ON "public"."professional_services" USING "btree" ("service_id");



CREATE INDEX "professionals_establishment_idx" ON "public"."professionals" USING "btree" ("establishment_id");



CREATE INDEX "schedule_blocks_est_time_idx" ON "public"."schedule_blocks" USING "btree" ("establishment_id", "starts_at");



CREATE INDEX "schedule_blocks_pro_time_idx" ON "public"."schedule_blocks" USING "btree" ("professional_id", "starts_at");



CREATE INDEX "services_establishment_idx" ON "public"."services" USING "btree" ("establishment_id");



CREATE UNIQUE INDEX "services_establishment_name_uq" ON "public"."services" USING "btree" ("establishment_id", "lower"("name"));



CREATE INDEX "working_hours_establishment_idx" ON "public"."working_hours" USING "btree" ("establishment_id");



CREATE OR REPLACE TRIGGER "check_appointment" BEFORE INSERT OR UPDATE ON "public"."appointments" FOR EACH ROW EXECUTE FUNCTION "private"."check_appointment"();



CREATE OR REPLACE TRIGGER "check_schedule_block" BEFORE INSERT OR UPDATE ON "public"."schedule_blocks" FOR EACH ROW EXECUTE FUNCTION "private"."check_schedule_block"();



CREATE OR REPLACE TRIGGER "check_working_hours" BEFORE INSERT OR UPDATE ON "public"."working_hours" FOR EACH ROW EXECUTE FUNCTION "private"."check_working_hours"();



CREATE OR REPLACE TRIGGER "normalize_customer" BEFORE INSERT OR UPDATE ON "public"."customers" FOR EACH ROW EXECUTE FUNCTION "private"."normalize_customer"();



CREATE OR REPLACE TRIGGER "normalize_professional" BEFORE INSERT OR UPDATE ON "public"."professionals" FOR EACH ROW EXECUTE FUNCTION "private"."normalize_professional"();



CREATE OR REPLACE TRIGGER "normalize_service" BEFORE INSERT OR UPDATE ON "public"."services" FOR EACH ROW EXECUTE FUNCTION "private"."normalize_service"();



CREATE OR REPLACE TRIGGER "prevent_tenant_change" BEFORE UPDATE ON "public"."appointments" FOR EACH ROW EXECUTE FUNCTION "private"."prevent_tenant_change"();



CREATE OR REPLACE TRIGGER "prevent_tenant_change" BEFORE UPDATE ON "public"."customers" FOR EACH ROW EXECUTE FUNCTION "private"."prevent_tenant_change"();



CREATE OR REPLACE TRIGGER "prevent_tenant_change" BEFORE UPDATE ON "public"."memberships" FOR EACH ROW EXECUTE FUNCTION "private"."prevent_tenant_change"();



CREATE OR REPLACE TRIGGER "prevent_tenant_change" BEFORE UPDATE ON "public"."professionals" FOR EACH ROW EXECUTE FUNCTION "private"."prevent_tenant_change"();



CREATE OR REPLACE TRIGGER "prevent_tenant_change" BEFORE UPDATE ON "public"."schedule_blocks" FOR EACH ROW EXECUTE FUNCTION "private"."prevent_tenant_change"();



CREATE OR REPLACE TRIGGER "prevent_tenant_change" BEFORE UPDATE ON "public"."services" FOR EACH ROW EXECUTE FUNCTION "private"."prevent_tenant_change"();



CREATE OR REPLACE TRIGGER "prevent_tenant_change" BEFORE UPDATE ON "public"."working_hours" FOR EACH ROW EXECUTE FUNCTION "private"."prevent_tenant_change"();



CREATE OR REPLACE TRIGGER "set_created_by" BEFORE INSERT ON "public"."appointments" FOR EACH ROW EXECUTE FUNCTION "private"."set_created_by"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."appointments" FOR EACH ROW EXECUTE FUNCTION "private"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."customers" FOR EACH ROW EXECUTE FUNCTION "private"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."establishments" FOR EACH ROW EXECUTE FUNCTION "private"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."professionals" FOR EACH ROW EXECUTE FUNCTION "private"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "private"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."services" FOR EACH ROW EXECUTE FUNCTION "private"."set_updated_at"();



ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_customer_id_establishment_id_fkey" FOREIGN KEY ("customer_id", "establishment_id") REFERENCES "public"."customers"("id", "establishment_id");



ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "public"."establishments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_professional_id_establishment_id_fkey" FOREIGN KEY ("professional_id", "establishment_id") REFERENCES "public"."professionals"("id", "establishment_id");



ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_service_id_establishment_id_fkey" FOREIGN KEY ("service_id", "establishment_id") REFERENCES "public"."services"("id", "establishment_id");



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "public"."establishments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."establishments"
    ADD CONSTRAINT "establishments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."memberships"
    ADD CONSTRAINT "memberships_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "public"."establishments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."memberships"
    ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."platform_admins"
    ADD CONSTRAINT "platform_admins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."professional_services"
    ADD CONSTRAINT "professional_services_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "public"."establishments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."professional_services"
    ADD CONSTRAINT "professional_services_professional_id_establishment_id_fkey" FOREIGN KEY ("professional_id", "establishment_id") REFERENCES "public"."professionals"("id", "establishment_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."professional_services"
    ADD CONSTRAINT "professional_services_service_id_establishment_id_fkey" FOREIGN KEY ("service_id", "establishment_id") REFERENCES "public"."services"("id", "establishment_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."professionals"
    ADD CONSTRAINT "professionals_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "public"."establishments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."professionals"
    ADD CONSTRAINT "professionals_membership_id_establishment_id_fkey" FOREIGN KEY ("membership_id", "establishment_id") REFERENCES "public"."memberships"("id", "establishment_id") ON DELETE SET NULL ("membership_id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."schedule_blocks"
    ADD CONSTRAINT "schedule_blocks_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "public"."establishments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."schedule_blocks"
    ADD CONSTRAINT "schedule_blocks_professional_id_establishment_id_fkey" FOREIGN KEY ("professional_id", "establishment_id") REFERENCES "public"."professionals"("id", "establishment_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."services"
    ADD CONSTRAINT "services_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "public"."establishments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."working_hours"
    ADD CONSTRAINT "working_hours_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "public"."establishments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."working_hours"
    ADD CONSTRAINT "working_hours_professional_id_establishment_id_fkey" FOREIGN KEY ("professional_id", "establishment_id") REFERENCES "public"."professionals"("id", "establishment_id") ON DELETE CASCADE;



ALTER TABLE "public"."appointments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "appointments_delete" ON "public"."appointments" FOR DELETE TO "authenticated" USING ("private"."is_owner"("establishment_id"));



CREATE POLICY "appointments_insert" ON "public"."appointments" FOR INSERT TO "authenticated" WITH CHECK ("private"."is_member"("establishment_id"));



CREATE POLICY "appointments_select" ON "public"."appointments" FOR SELECT TO "authenticated" USING (("private"."is_member"("establishment_id") OR "private"."is_superadmin"()));



CREATE POLICY "appointments_update" ON "public"."appointments" FOR UPDATE TO "authenticated" USING ("private"."is_member"("establishment_id")) WITH CHECK ("private"."is_member"("establishment_id"));



ALTER TABLE "public"."customers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "customers_delete" ON "public"."customers" FOR DELETE TO "authenticated" USING ("private"."is_owner"("establishment_id"));



CREATE POLICY "customers_insert" ON "public"."customers" FOR INSERT TO "authenticated" WITH CHECK ("private"."is_member"("establishment_id"));



CREATE POLICY "customers_select" ON "public"."customers" FOR SELECT TO "authenticated" USING (("private"."is_member"("establishment_id") OR "private"."is_superadmin"()));



CREATE POLICY "customers_update" ON "public"."customers" FOR UPDATE TO "authenticated" USING ("private"."is_member"("establishment_id")) WITH CHECK ("private"."is_member"("establishment_id"));



ALTER TABLE "public"."establishments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "establishments_delete" ON "public"."establishments" FOR DELETE TO "authenticated" USING ("private"."is_superadmin"());



CREATE POLICY "establishments_select" ON "public"."establishments" FOR SELECT TO "authenticated" USING (("private"."is_member"("id") OR "private"."is_superadmin"()));



CREATE POLICY "establishments_update" ON "public"."establishments" FOR UPDATE TO "authenticated" USING (("private"."is_owner"("id") OR "private"."is_superadmin"())) WITH CHECK (("private"."is_owner"("id") OR "private"."is_superadmin"()));



ALTER TABLE "public"."memberships" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "memberships_delete_staff" ON "public"."memberships" FOR DELETE TO "authenticated" USING ((("role" = 'staff'::"public"."membership_role") AND "private"."is_owner"("establishment_id")));



CREATE POLICY "memberships_delete_superadmin" ON "public"."memberships" FOR DELETE TO "authenticated" USING ("private"."is_superadmin"());



CREATE POLICY "memberships_select" ON "public"."memberships" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "private"."is_member"("establishment_id") OR "private"."is_superadmin"()));



CREATE POLICY "memberships_update_staff" ON "public"."memberships" FOR UPDATE TO "authenticated" USING ((("role" = 'staff'::"public"."membership_role") AND "private"."is_owner"("establishment_id"))) WITH CHECK ((("role" = 'staff'::"public"."membership_role") AND "private"."is_owner"("establishment_id")));



CREATE POLICY "memberships_update_superadmin" ON "public"."memberships" FOR UPDATE TO "authenticated" USING ("private"."is_superadmin"()) WITH CHECK ("private"."is_superadmin"());



ALTER TABLE "public"."platform_admins" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."professional_services" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "professional_services_delete" ON "public"."professional_services" FOR DELETE TO "authenticated" USING ("private"."is_owner"("establishment_id"));



CREATE POLICY "professional_services_insert" ON "public"."professional_services" FOR INSERT TO "authenticated" WITH CHECK ("private"."is_owner"("establishment_id"));



CREATE POLICY "professional_services_select" ON "public"."professional_services" FOR SELECT TO "authenticated" USING (("private"."is_member"("establishment_id") OR "private"."is_superadmin"()));



ALTER TABLE "public"."professionals" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "professionals_delete" ON "public"."professionals" FOR DELETE TO "authenticated" USING ("private"."is_owner"("establishment_id"));



CREATE POLICY "professionals_insert" ON "public"."professionals" FOR INSERT TO "authenticated" WITH CHECK ("private"."is_owner"("establishment_id"));



CREATE POLICY "professionals_select" ON "public"."professionals" FOR SELECT TO "authenticated" USING (("private"."is_member"("establishment_id") OR "private"."is_superadmin"()));



CREATE POLICY "professionals_update" ON "public"."professionals" FOR UPDATE TO "authenticated" USING ("private"."is_owner"("establishment_id")) WITH CHECK ("private"."is_owner"("establishment_id"));



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_select" ON "public"."profiles" FOR SELECT TO "authenticated" USING ((("id" = ( SELECT "auth"."uid"() AS "uid")) OR "private"."shares_establishment_with"("id") OR "private"."is_superadmin"()));



CREATE POLICY "profiles_update_own" ON "public"."profiles" FOR UPDATE TO "authenticated" USING (("id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."schedule_blocks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "schedule_blocks_delete" ON "public"."schedule_blocks" FOR DELETE TO "authenticated" USING ("private"."is_member"("establishment_id"));



CREATE POLICY "schedule_blocks_insert" ON "public"."schedule_blocks" FOR INSERT TO "authenticated" WITH CHECK ("private"."is_member"("establishment_id"));



CREATE POLICY "schedule_blocks_select" ON "public"."schedule_blocks" FOR SELECT TO "authenticated" USING (("private"."is_member"("establishment_id") OR "private"."is_superadmin"()));



CREATE POLICY "schedule_blocks_update" ON "public"."schedule_blocks" FOR UPDATE TO "authenticated" USING ("private"."is_member"("establishment_id")) WITH CHECK ("private"."is_member"("establishment_id"));



ALTER TABLE "public"."services" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "services_delete" ON "public"."services" FOR DELETE TO "authenticated" USING ("private"."is_owner"("establishment_id"));



CREATE POLICY "services_insert" ON "public"."services" FOR INSERT TO "authenticated" WITH CHECK ("private"."is_owner"("establishment_id"));



CREATE POLICY "services_select" ON "public"."services" FOR SELECT TO "authenticated" USING (("private"."is_member"("establishment_id") OR "private"."is_superadmin"()));



CREATE POLICY "services_update" ON "public"."services" FOR UPDATE TO "authenticated" USING ("private"."is_owner"("establishment_id")) WITH CHECK ("private"."is_owner"("establishment_id"));



ALTER TABLE "public"."working_hours" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "working_hours_delete" ON "public"."working_hours" FOR DELETE TO "authenticated" USING ("private"."is_owner"("establishment_id"));



CREATE POLICY "working_hours_insert" ON "public"."working_hours" FOR INSERT TO "authenticated" WITH CHECK ("private"."is_owner"("establishment_id"));



CREATE POLICY "working_hours_select" ON "public"."working_hours" FOR SELECT TO "authenticated" USING (("private"."is_member"("establishment_id") OR "private"."is_superadmin"()));



CREATE POLICY "working_hours_update" ON "public"."working_hours" FOR UPDATE TO "authenticated" USING ("private"."is_owner"("establishment_id")) WITH CHECK ("private"."is_owner"("establishment_id"));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "private" TO "authenticated";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";










































































































































































































































































































































































































































































































































































































































































































































REVOKE ALL ON FUNCTION "private"."check_appointment"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."check_schedule_block"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."check_working_hours"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."is_member"("p_establishment_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."is_member"("p_establishment_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "private"."is_owner"("p_establishment_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."is_owner"("p_establishment_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "private"."is_superadmin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."is_superadmin"() TO "authenticated";



REVOKE ALL ON FUNCTION "private"."normalize_customer"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."normalize_professional"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."normalize_service"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."prevent_tenant_change"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."set_created_by"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."set_updated_at"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."shares_establishment_with"("p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."shares_establishment_with"("p_user_id" "uuid") TO "authenticated";



GRANT ALL ON TABLE "public"."establishments" TO "service_role";
GRANT SELECT,DELETE ON TABLE "public"."establishments" TO "authenticated";



GRANT UPDATE("name") ON TABLE "public"."establishments" TO "authenticated";



GRANT UPDATE("business_type") ON TABLE "public"."establishments" TO "authenticated";



GRANT UPDATE("phone") ON TABLE "public"."establishments" TO "authenticated";



GRANT UPDATE("timezone") ON TABLE "public"."establishments" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."create_establishment"("p_name" "text", "p_business_type" "public"."business_type", "p_phone" "text", "p_timezone" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_establishment"("p_name" "text", "p_business_type" "public"."business_type", "p_phone" "text", "p_timezone" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."create_establishment"("p_name" "text", "p_business_type" "public"."business_type", "p_phone" "text", "p_timezone" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_available_slots"("p_establishment_id" "uuid", "p_professional_id" "uuid", "p_service_id" "uuid", "p_date" "date", "p_exclude_appointment_id" "uuid", "p_step_minutes" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_available_slots"("p_establishment_id" "uuid", "p_professional_id" "uuid", "p_service_id" "uuid", "p_date" "date", "p_exclude_appointment_id" "uuid", "p_step_minutes" integer) TO "service_role";
GRANT ALL ON FUNCTION "public"."get_available_slots"("p_establishment_id" "uuid", "p_professional_id" "uuid", "p_service_id" "uuid", "p_date" "date", "p_exclude_appointment_id" "uuid", "p_step_minutes" integer) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."handle_new_user"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_platform_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_platform_admin"() TO "service_role";
GRANT ALL ON FUNCTION "public"."is_platform_admin"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."list_appointments"("p_establishment_id" "uuid", "p_from" "date", "p_to" "date", "p_professional_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_appointments"("p_establishment_id" "uuid", "p_from" "date", "p_to" "date", "p_professional_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."list_appointments"("p_establishment_id" "uuid", "p_from" "date", "p_to" "date", "p_professional_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."save_appointment"("p_establishment_id" "uuid", "p_id" "uuid", "p_customer_id" "uuid", "p_professional_id" "uuid", "p_service_id" "uuid", "p_date" "date", "p_time" time without time zone, "p_notes" "text", "p_price_cents" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."save_appointment"("p_establishment_id" "uuid", "p_id" "uuid", "p_customer_id" "uuid", "p_professional_id" "uuid", "p_service_id" "uuid", "p_date" "date", "p_time" time without time zone, "p_notes" "text", "p_price_cents" integer) TO "service_role";
GRANT ALL ON FUNCTION "public"."save_appointment"("p_establishment_id" "uuid", "p_id" "uuid", "p_customer_id" "uuid", "p_professional_id" "uuid", "p_service_id" "uuid", "p_date" "date", "p_time" time without time zone, "p_notes" "text", "p_price_cents" integer) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."save_professional"("p_establishment_id" "uuid", "p_id" "uuid", "p_name" "text", "p_bio" "text", "p_color" "text", "p_is_active" boolean, "p_service_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."save_professional"("p_establishment_id" "uuid", "p_id" "uuid", "p_name" "text", "p_bio" "text", "p_color" "text", "p_is_active" boolean, "p_service_ids" "uuid"[]) TO "service_role";
GRANT ALL ON FUNCTION "public"."save_professional"("p_establishment_id" "uuid", "p_id" "uuid", "p_name" "text", "p_bio" "text", "p_color" "text", "p_is_active" boolean, "p_service_ids" "uuid"[]) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."save_schedule_block"("p_establishment_id" "uuid", "p_id" "uuid", "p_professional_id" "uuid", "p_kind" "text", "p_start_date" "date", "p_end_date" "date", "p_start_time" time without time zone, "p_end_time" time without time zone, "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."save_schedule_block"("p_establishment_id" "uuid", "p_id" "uuid", "p_professional_id" "uuid", "p_kind" "text", "p_start_date" "date", "p_end_date" "date", "p_start_time" time without time zone, "p_end_time" time without time zone, "p_reason" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."save_schedule_block"("p_establishment_id" "uuid", "p_id" "uuid", "p_professional_id" "uuid", "p_kind" "text", "p_start_date" "date", "p_end_date" "date", "p_start_time" time without time zone, "p_end_time" time without time zone, "p_reason" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."save_weekly_schedule"("p_establishment_id" "uuid", "p_professional_id" "uuid", "p_segments" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."save_weekly_schedule"("p_establishment_id" "uuid", "p_professional_id" "uuid", "p_segments" "jsonb") TO "service_role";
GRANT ALL ON FUNCTION "public"."save_weekly_schedule"("p_establishment_id" "uuid", "p_professional_id" "uuid", "p_segments" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."set_appointment_status"("p_establishment_id" "uuid", "p_id" "uuid", "p_status" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_appointment_status"("p_establishment_id" "uuid", "p_id" "uuid", "p_status" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."set_appointment_status"("p_establishment_id" "uuid", "p_id" "uuid", "p_status" "text") TO "authenticated";


















GRANT ALL ON TABLE "public"."appointments" TO "service_role";
GRANT SELECT,DELETE ON TABLE "public"."appointments" TO "authenticated";



GRANT INSERT("establishment_id"),UPDATE("establishment_id") ON TABLE "public"."appointments" TO "authenticated";



GRANT INSERT("professional_id"),UPDATE("professional_id") ON TABLE "public"."appointments" TO "authenticated";



GRANT INSERT("service_id"),UPDATE("service_id") ON TABLE "public"."appointments" TO "authenticated";



GRANT INSERT("customer_id"),UPDATE("customer_id") ON TABLE "public"."appointments" TO "authenticated";



GRANT INSERT("starts_at"),UPDATE("starts_at") ON TABLE "public"."appointments" TO "authenticated";



GRANT INSERT("ends_at"),UPDATE("ends_at") ON TABLE "public"."appointments" TO "authenticated";



GRANT INSERT("status"),UPDATE("status") ON TABLE "public"."appointments" TO "authenticated";



GRANT INSERT("price_cents"),UPDATE("price_cents") ON TABLE "public"."appointments" TO "authenticated";



GRANT INSERT("notes"),UPDATE("notes") ON TABLE "public"."appointments" TO "authenticated";



GRANT ALL ON TABLE "public"."customers" TO "service_role";
GRANT SELECT,DELETE ON TABLE "public"."customers" TO "authenticated";



GRANT INSERT("establishment_id"),UPDATE("establishment_id") ON TABLE "public"."customers" TO "authenticated";



GRANT INSERT("full_name"),UPDATE("full_name") ON TABLE "public"."customers" TO "authenticated";



GRANT INSERT("phone"),UPDATE("phone") ON TABLE "public"."customers" TO "authenticated";



GRANT INSERT("email"),UPDATE("email") ON TABLE "public"."customers" TO "authenticated";



GRANT INSERT("notes"),UPDATE("notes") ON TABLE "public"."customers" TO "authenticated";



GRANT ALL ON TABLE "public"."memberships" TO "service_role";
GRANT SELECT,DELETE ON TABLE "public"."memberships" TO "authenticated";



GRANT UPDATE("is_active") ON TABLE "public"."memberships" TO "authenticated";



GRANT ALL ON TABLE "public"."platform_admins" TO "service_role";



GRANT ALL ON TABLE "public"."professional_services" TO "service_role";
GRANT SELECT,DELETE ON TABLE "public"."professional_services" TO "authenticated";



GRANT INSERT("establishment_id") ON TABLE "public"."professional_services" TO "authenticated";



GRANT INSERT("professional_id") ON TABLE "public"."professional_services" TO "authenticated";



GRANT INSERT("service_id") ON TABLE "public"."professional_services" TO "authenticated";



GRANT ALL ON TABLE "public"."professionals" TO "service_role";
GRANT SELECT,DELETE ON TABLE "public"."professionals" TO "authenticated";



GRANT INSERT("establishment_id"),UPDATE("establishment_id") ON TABLE "public"."professionals" TO "authenticated";



GRANT INSERT("membership_id"),UPDATE("membership_id") ON TABLE "public"."professionals" TO "authenticated";



GRANT INSERT("name"),UPDATE("name") ON TABLE "public"."professionals" TO "authenticated";



GRANT INSERT("bio"),UPDATE("bio") ON TABLE "public"."professionals" TO "authenticated";



GRANT INSERT("color"),UPDATE("color") ON TABLE "public"."professionals" TO "authenticated";



GRANT INSERT("is_active"),UPDATE("is_active") ON TABLE "public"."professionals" TO "authenticated";



GRANT ALL ON TABLE "public"."profiles" TO "service_role";
GRANT SELECT ON TABLE "public"."profiles" TO "authenticated";



GRANT UPDATE("full_name") ON TABLE "public"."profiles" TO "authenticated";



GRANT ALL ON TABLE "public"."schedule_blocks" TO "service_role";
GRANT SELECT,DELETE ON TABLE "public"."schedule_blocks" TO "authenticated";



GRANT INSERT("establishment_id"),UPDATE("establishment_id") ON TABLE "public"."schedule_blocks" TO "authenticated";



GRANT INSERT("professional_id"),UPDATE("professional_id") ON TABLE "public"."schedule_blocks" TO "authenticated";



GRANT INSERT("starts_at"),UPDATE("starts_at") ON TABLE "public"."schedule_blocks" TO "authenticated";



GRANT INSERT("ends_at"),UPDATE("ends_at") ON TABLE "public"."schedule_blocks" TO "authenticated";



GRANT INSERT("reason"),UPDATE("reason") ON TABLE "public"."schedule_blocks" TO "authenticated";



GRANT INSERT("kind"),UPDATE("kind") ON TABLE "public"."schedule_blocks" TO "authenticated";



GRANT ALL ON TABLE "public"."services" TO "service_role";
GRANT SELECT,DELETE ON TABLE "public"."services" TO "authenticated";



GRANT INSERT("establishment_id"),UPDATE("establishment_id") ON TABLE "public"."services" TO "authenticated";



GRANT INSERT("name"),UPDATE("name") ON TABLE "public"."services" TO "authenticated";



GRANT INSERT("description"),UPDATE("description") ON TABLE "public"."services" TO "authenticated";



GRANT INSERT("duration_minutes"),UPDATE("duration_minutes") ON TABLE "public"."services" TO "authenticated";



GRANT INSERT("price_cents"),UPDATE("price_cents") ON TABLE "public"."services" TO "authenticated";



GRANT INSERT("is_active"),UPDATE("is_active") ON TABLE "public"."services" TO "authenticated";



GRANT INSERT("category"),UPDATE("category") ON TABLE "public"."services" TO "authenticated";



GRANT ALL ON TABLE "public"."working_hours" TO "service_role";
GRANT SELECT,DELETE ON TABLE "public"."working_hours" TO "authenticated";



GRANT INSERT("establishment_id"),UPDATE("establishment_id") ON TABLE "public"."working_hours" TO "authenticated";



GRANT INSERT("professional_id"),UPDATE("professional_id") ON TABLE "public"."working_hours" TO "authenticated";



GRANT INSERT("weekday"),UPDATE("weekday") ON TABLE "public"."working_hours" TO "authenticated";



GRANT INSERT("start_time"),UPDATE("start_time") ON TABLE "public"."working_hours" TO "authenticated";



GRANT INSERT("end_time"),UPDATE("end_time") ON TABLE "public"."working_hours" TO "authenticated";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































