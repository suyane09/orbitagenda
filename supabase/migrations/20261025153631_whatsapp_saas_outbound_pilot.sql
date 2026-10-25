-- OrbitAgenda — WhatsApp multi-tenant PILOT, outbound-only bridge.
-- All automatic sending remains opt-in and disabled by default.
-- No public inbound endpoint, Evolution key, worker token or customer bulk access.

create table public.whatsapp_connections (
  establishment_id uuid primary key references public.establishments(id) on delete cascade,
  instance_name text not null unique check (instance_name ~ '^oa_[a-f0-9]{32}$'),
  state text not null default 'pending'
    check (state in ('pending','connecting','qr','connected','disconnected','error')),
  enabled boolean not null default false,
  qr_image text,
  qr_expires_at timestamptz,
  worker_last_seen timestamptz,
  updated_at timestamptz not null default now()
);
create table private.whatsapp_worker_auth (
  establishment_id uuid primary key references public.establishments(id) on delete cascade,
  pairing_hash text,
  pairing_expires_at timestamptz,
  token_hash text unique
);
create table public.whatsapp_appointment_consents (
  appointment_id uuid primary key references public.appointments(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  consented_at timestamptz not null default now()
);
create table public.whatsapp_outbox (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  kind text not null check (kind in ('confirmation','reminder','cancellation')),
  dedupe_key text not null,
  recipient text not null check (recipient ~ '^55[1-9][0-9]{9,10}$'),
  body text not null check (char_length(body) between 1 and 1200),
  due_at timestamptz not null,
  state text not null default 'queued'
    check (state in ('queued','sending','accepted','failed','cancelled')),
  provider_id text,
  error_code text,
  claimed_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  unique (establishment_id,dedupe_key)
);
create index whatsapp_outbox_due_idx on public.whatsapp_outbox (due_at,id)
  where state='queued';
create index whatsapp_outbox_est_idx on public.whatsapp_outbox (establishment_id,created_at desc);
create index whatsapp_consent_est_idx on public.whatsapp_appointment_consents(establishment_id);

alter table public.whatsapp_connections enable row level security;
alter table private.whatsapp_worker_auth enable row level security;
alter table public.whatsapp_appointment_consents enable row level security;
alter table public.whatsapp_outbox enable row level security;
revoke all on public.whatsapp_connections,public.whatsapp_appointment_consents,
  public.whatsapp_outbox from public,anon,authenticated;
revoke all on private.whatsapp_worker_auth from public,anon,authenticated;
grant select on public.whatsapp_connections,public.whatsapp_outbox to authenticated;
create policy whatsapp_connections_owner_read on public.whatsapp_connections
 for select to authenticated using (private.is_owner(establishment_id));
create policy whatsapp_outbox_owner_read on public.whatsapp_outbox
 for select to authenticated using (private.is_owner(establishment_id));

-- SECURITY DEFINER functions below never trust establishment IDs supplied by a worker
-- or a normal user: owner status is checked server-side, and worker tokens are 256-bit.
create function public.whatsapp_begin_pairing(p_establishment_id uuid)
returns text language plpgsql security definer set search_path=''
as $$
declare v_code text;
begin
  if (select auth.uid()) is null or not private.is_owner(p_establishment_id) then
    raise exception 'forbidden' using errcode='42501';
  end if;
  -- Separate approval required on every pairing/re-pairing; revokes previous worker.
  v_code := replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','');
  insert into public.whatsapp_connections(establishment_id,instance_name,state,enabled,qr_image,qr_expires_at,updated_at)
    values(p_establishment_id,'oa_' || replace(p_establishment_id::text,'-',''),'pending',false,null,null,now())
    on conflict(establishment_id) do update set state='pending',enabled=false,qr_image=null,
      qr_expires_at=null,updated_at=now();
  -- Prevent old queued messages from a previous device being sent from a new number.
  update public.whatsapp_outbox set state='cancelled'
    where establishment_id=p_establishment_id and state='queued';
  insert into private.whatsapp_worker_auth(establishment_id,pairing_hash,pairing_expires_at,token_hash)
    values(p_establishment_id,encode(sha256(convert_to(v_code,'UTF8')),'hex'),now()+interval '10 minutes',null)
    on conflict(establishment_id) do update set
      pairing_hash=excluded.pairing_hash,pairing_expires_at=excluded.pairing_expires_at,token_hash=null;
  return v_code;
end $$;

create function public.whatsapp_set_enabled(p_establishment_id uuid,p_enabled boolean)
returns void language plpgsql security definer set search_path=''
as $$
begin
 if (select auth.uid()) is null or not private.is_owner(p_establishment_id) then
   raise exception 'forbidden' using errcode='42501';
 end if;
 if p_enabled is null then raise exception 'invalid_input' using errcode='22023'; end if;
 update public.whatsapp_connections set enabled=p_enabled,updated_at=now()
 where establishment_id=p_establishment_id
 and (not p_enabled or (state='connected' and worker_last_seen>now()-interval '3 minutes'));
 if not found then raise exception 'whatsapp_not_connected' using errcode='22023'; end if;
 if not p_enabled then
   update public.whatsapp_outbox set state='cancelled'
   where establishment_id=p_establishment_id and state='queued';
 end if;
end $$;

create function public.whatsapp_worker_pair(p_code text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_est uuid;v_instance text;v_token text;
begin
 if p_code is null or p_code !~ '^[a-f0-9]{64}$' then
   raise exception 'invalid_pairing' using errcode='42501'; end if;
 select a.establishment_id into v_est from private.whatsapp_worker_auth a
 where a.pairing_hash=encode(sha256(convert_to(p_code,'UTF8')),'hex')
   and a.pairing_expires_at>now()
 for update;
 if not found then raise exception 'invalid_pairing' using errcode='42501'; end if;
 v_token:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
 update private.whatsapp_worker_auth set pairing_hash=null,pairing_expires_at=null,
   token_hash=encode(sha256(convert_to(v_token,'UTF8')),'hex') where establishment_id=v_est;
 update public.whatsapp_connections set state='connecting',qr_image=null,qr_expires_at=null,
   enabled=false,worker_last_seen=now(),updated_at=now() where establishment_id=v_est;
 select instance_name into v_instance from public.whatsapp_connections where establishment_id=v_est;
 return jsonb_build_object('token',v_token,'establishment_id',v_est,'instance_name',v_instance);
end $$;

create function private.whatsapp_authorized_worker(p_token text)
returns uuid language plpgsql stable security definer set search_path=''
as $$
declare v_est uuid;
begin
 if p_token is null or p_token !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid_worker_token' using errcode='42501';end if;
 select establishment_id into v_est from private.whatsapp_worker_auth
 where token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex');
 if not found then raise exception 'invalid_worker_token' using errcode='42501';end if;
 return v_est;
end $$;

create function public.whatsapp_worker_report(p_token text,p_state text,p_qr text default null)
returns void language plpgsql security definer set search_path=''
as $$
declare v_est uuid;
begin
 v_est:=private.whatsapp_authorized_worker(p_token);
 if p_state not in ('connecting','qr','connected','disconnected','error') then
   raise exception 'invalid_state' using errcode='22023';end if;
 if p_qr is not null and (
   p_state<>'qr' or char_length(p_qr)>240000 or
   p_qr !~ '^data:image/(png|jpeg);base64,[A-Za-z0-9+/=]+$') then
   raise exception 'invalid_qr' using errcode='22023'; end if;
 update public.whatsapp_connections set
   state=p_state,worker_last_seen=now(),updated_at=now(),
   qr_image=case when p_state='qr' then p_qr else null end,
   qr_expires_at=case when p_state='qr' then now()+interval '55 seconds' else null end
 where establishment_id=v_est;
end $$;

-- Queue only if customer has explicitly opted into WhatsApp for that appointment.
create function private.whatsapp_queue_appointment(p_appointment_id uuid,p_kind text)
returns void language plpgsql security definer set search_path=''
as $$
declare v record;v_num text;v_due timestamptz;v_body text;v_key text;
begin
 select a.*, c.full_name,c.phone,e.name as establishment_name,e.timezone,
   pr.name as professional_name,s.name as service_name
 into v
 from public.appointments a
 join public.whatsapp_appointment_consents w on w.appointment_id=a.id
   and w.establishment_id=a.establishment_id
 join public.customers c on c.id=a.customer_id and c.establishment_id=a.establishment_id
 join public.establishments e on e.id=a.establishment_id
 join public.professionals pr on pr.id=a.professional_id and pr.establishment_id=a.establishment_id
 join public.services s on s.id=a.service_id and s.establishment_id=a.establishment_id
 join public.whatsapp_connections co on co.establishment_id=a.establishment_id
   and co.enabled and co.state='connected' and co.worker_last_seen>now()-interval '3 minutes'
 where a.id=p_appointment_id;
 if not found then return;end if;
 v_num:=regexp_replace(coalesce(v.phone,''),'[^0-9]','','g');
 if char_length(v_num) in (10,11) then v_num:='55'||v_num;end if;
 if v_num !~ '^55[1-9][0-9]{9,10}$' then return;end if;
 if p_kind='reminder' then
   if v.status::text not in ('scheduled','confirmed') or v.starts_at<now()+interval '2 hours 5 minutes' then return;end if;
   v_due:=case when v.starts_at>now()+interval '25 hours' then v.starts_at-interval '24 hours'
              else v.starts_at-interval '2 hours' end;
 elsif p_kind='confirmation' then
   if v.status::text not in ('scheduled','confirmed') or v.starts_at<=now() then return;end if;
   v_due:=now();
 elsif p_kind='cancellation' then
   if v.status::text<>'cancelled' then return;end if;
   v_due:=now();
 else return;
 end if;
 v_key:=v.id::text||':'||p_kind||':'||v.starts_at::text; -- per appointment, per event
 if p_kind='cancellation' then
   v_body:=format('Olá, %s! O agendamento em %s para %s às %s foi cancelado.',
      left(v.full_name,70),left(v.establishment_name,70),
      to_char(v.starts_at at time zone v.timezone,'DD/MM/YYYY'),
      to_char(v.starts_at at time zone v.timezone,'HH24:MI'));
 elsif p_kind='reminder' then
   v_body:=format('Olá, %s! Lembrete: seu horário em %s é %s às %s. Serviço: %s.',
      left(v.full_name,70),left(v.establishment_name,70),
      to_char(v.starts_at at time zone v.timezone,'DD/MM/YYYY'),
      to_char(v.starts_at at time zone v.timezone,'HH24:MI'),left(v.service_name,70));
 else
   v_body:=format('Olá, %s! Agendamento em %s confirmado para %s às %s. Serviço: %s. Profissional: %s.',
      left(v.full_name,70),left(v.establishment_name,70),
      to_char(v.starts_at at time zone v.timezone,'DD/MM/YYYY'),
      to_char(v.starts_at at time zone v.timezone,'HH24:MI'),
      left(v.service_name,70),left(v.professional_name,70));
 end if;
 insert into public.whatsapp_outbox(establishment_id,appointment_id,kind,dedupe_key,recipient,body,due_at)
 values(v.establishment_id,v.id,p_kind,v_key,v_num,v_body,v_due)
 on conflict(establishment_id,dedupe_key) do nothing;
end $$;

-- The public booking backend writes this consent using its server-side admin client.
-- The consent insert is atomic; no browser can add consent on behalf of another customer.
create function private.whatsapp_consent_created()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  perform private.whatsapp_queue_appointment(new.appointment_id,'confirmation');
  perform private.whatsapp_queue_appointment(new.appointment_id,'reminder');
  return new;
end $$;
create trigger whatsapp_consent_created after insert
on public.whatsapp_appointment_consents for each row
execute function private.whatsapp_consent_created();

create function private.whatsapp_appointment_changed()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
 if new.status is distinct from old.status or new.starts_at is distinct from old.starts_at then
  update public.whatsapp_outbox set state='cancelled'
  where appointment_id=new.id and state='queued';
  if new.status::text='cancelled' and old.status::text<>'cancelled' then
    perform private.whatsapp_queue_appointment(new.id,'cancellation');
  elsif new.status::text in ('scheduled','confirmed') and
     new.starts_at is distinct from old.starts_at then
    perform private.whatsapp_queue_appointment(new.id,'confirmation');
    perform private.whatsapp_queue_appointment(new.id,'reminder');
  end if;
 end if;
 return new;
end $$;
create trigger whatsapp_appointment_change after update of starts_at,status
on public.appointments for each row execute function private.whatsapp_appointment_changed();

create function public.whatsapp_worker_poll(p_token text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_est uuid;v_conn record;v_job record;
begin
 v_est:=private.whatsapp_authorized_worker(p_token);
 update public.whatsapp_connections set worker_last_seen=now() where establishment_id=v_est;
 select * into v_conn from public.whatsapp_connections where establishment_id=v_est;
 if v_conn.state<>'connected' then
   return jsonb_build_object('action','connect','instance_name',v_conn.instance_name);
 end if;
 if not v_conn.enabled then return jsonb_build_object('action','idle','reason','disabled');end if;
 select * into v_job from public.whatsapp_outbox
  where establishment_id=v_est and state='queued' and due_at<=now()
  order by due_at,id for update skip locked limit 1;
 if not found then return jsonb_build_object('action','idle');end if;
 -- Claim -> sending. No auto retry of uncertain sends (avoids duplicate customer messages).
 update public.whatsapp_outbox set state='sending',claimed_at=now() where id=v_job.id;
 return jsonb_build_object('action','send','id',v_job.id,'instance_name',v_conn.instance_name,
    'recipient',v_job.recipient,'body',v_job.body);
end $$;

create function public.whatsapp_worker_finish(p_token text,p_job_id uuid,
 p_accepted boolean,p_provider_id text default null,p_error text default null)
returns void language plpgsql security definer set search_path=''
as $$
declare v_est uuid;
begin
 v_est:=private.whatsapp_authorized_worker(p_token);
 if p_accepted is null then raise exception 'invalid_status' using errcode='22023';end if;
 update public.whatsapp_outbox set
 state=case when p_accepted then 'accepted' else 'failed' end,
 provider_id=left(coalesce(p_provider_id,''),180),
 error_code=case when p_accepted then null else left(coalesce(p_error,'send_failed'),60) end,
 finished_at=now()
 where id=p_job_id and establishment_id=v_est and state='sending';
 if not found then raise exception 'invalid_job' using errcode='42501';end if;
end $$;

revoke all on function public.whatsapp_begin_pairing(uuid),
 public.whatsapp_set_enabled(uuid,boolean),
 public.whatsapp_worker_pair(text),
 public.whatsapp_worker_report(text,text,text),
 public.whatsapp_worker_poll(text),
 public.whatsapp_worker_finish(text,uuid,boolean,text,text)
from public,anon,authenticated;
revoke all on function private.whatsapp_authorized_worker(text),
 private.whatsapp_queue_appointment(uuid,text),
 private.whatsapp_appointment_changed(),
 private.whatsapp_consent_created() from public,anon,authenticated;
grant execute on function public.whatsapp_begin_pairing(uuid),
 public.whatsapp_set_enabled(uuid,boolean) to authenticated;
-- All worker RPCs are called ONLY by the server-side whatsapp-worker Edge Function.
-- Anonymous clients have no direct EXECUTE on these SECURITY DEFINER functions.
grant execute on function public.whatsapp_worker_pair(text),
 public.whatsapp_worker_report(text,text,text),
 public.whatsapp_worker_poll(text),
 public.whatsapp_worker_finish(text,uuid,boolean,text,text) to service_role;
grant insert on public.whatsapp_appointment_consents to service_role;
