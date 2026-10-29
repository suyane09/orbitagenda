-- Cloud-ready, mobile-only WhatsApp connection. INACTIVE until cloud resources run.
-- Keeps legacy local pilot separate and untouched.
alter table public.whatsapp_connections
  add column backend text not null default 'local' check (backend in ('local','cloud')),
  add column phone_e164 text check (phone_e164 ~ '^55[1-9][0-9]{9,10}$'),
  add column phone_pair_code text,
  add column phone_pair_expires_at timestamptz;

create function public.whatsapp_cloud_request(p_establishment_id uuid,p_phone text)
returns void language plpgsql security definer set search_path=''
as $$
declare v_phone text;
begin
 if auth.uid() is null or not private.is_owner(p_establishment_id) then
  raise exception 'forbidden' using errcode='42501';
 end if;
 v_phone:=regexp_replace(coalesce(p_phone,''),'[^0-9]','','g');
 if length(v_phone) in (10,11) then v_phone:='55'||v_phone;end if;
 if v_phone !~ '^55[1-9][0-9]{9,10}$' then
  raise exception 'invalid_phone' using errcode='22023';
 end if;
 -- No old connected session can be silently reused with the wrong number.
 insert into public.whatsapp_connections (
   establishment_id,instance_name,state,enabled,backend,phone_e164,
   qr_image,qr_expires_at,phone_pair_code,phone_pair_expires_at,updated_at)
 values(p_establishment_id,'oa_'||replace(gen_random_uuid()::text,'-',''),
   'pending',false,'cloud',v_phone,null,null,null,null,now())
 on conflict(establishment_id) do update set
   instance_name='oa_'||replace(gen_random_uuid()::text,'-',''),
   backend='cloud',phone_e164=excluded.phone_e164,
   state='pending',enabled=false,worker_last_seen=null,
   qr_image=null,qr_expires_at=null,
   phone_pair_code=null,phone_pair_expires_at=null,updated_at=now();
 -- Revoke all local pilot tokens and expired codes for this establishment.
 delete from private.whatsapp_worker_auth where establishment_id=p_establishment_id;
 update public.whatsapp_outbox set state='cancelled'
   where establishment_id=p_establishment_id and state='queued';
end $$;

-- Only service_role may call cloud workers' internal functions.
create function public.whatsapp_cloud_list()
returns table(establishment_id uuid, instance_name text, phone_e164 text)
language sql stable security definer set search_path=''
as $$
 select c.establishment_id,c.instance_name,c.phone_e164
 from public.whatsapp_connections c
 where c.backend='cloud' and c.phone_e164 is not null
 order by c.updated_at asc limit 100
$$;

create function public.whatsapp_cloud_report(p_establishment_id uuid,p_instance_name text,
 p_state text,p_qr text default null,p_pairing_code text default null)
returns void language plpgsql security definer set search_path=''
as $$
begin
 if p_state not in ('connecting','qr','connected','disconnected','error') then
   raise exception 'invalid_state' using errcode='22023';
 end if;
 if p_qr is not null and (length(p_qr)>240000 or
   p_qr !~ '^data:image/(png|jpeg);base64,[A-Za-z0-9+/=]+$') then
   raise exception 'invalid_qr' using errcode='22023';
 end if;
 if p_pairing_code is not null and p_pairing_code !~ '^[A-Za-z0-9]{6,12}$' then
   raise exception 'invalid_pairing_code' using errcode='22023';
 end if;
 update public.whatsapp_connections set
  state=p_state,worker_last_seen=now(),updated_at=now(),
  qr_image=case when p_state='qr' then p_qr else null end,
  qr_expires_at=case when p_state='qr' then now()+interval '55 seconds' else null end,
  phone_pair_code=case when p_state<>'connected' then p_pairing_code else null end,
  phone_pair_expires_at=case when p_pairing_code is not null then
    now()+interval '55 seconds' else null end
 where establishment_id=p_establishment_id and backend='cloud'
  and instance_name=p_instance_name;
 if not found then raise exception 'unknown_instance' using errcode='42501'; end if;
end $$;

create function public.whatsapp_cloud_claim()
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_job record;v_conn record;
begin
 select o.*,c.instance_name into v_job from public.whatsapp_outbox o
 join public.whatsapp_connections c on c.establishment_id=o.establishment_id
 where o.state='queued' and o.due_at<=now() and c.backend='cloud'
   and c.enabled and c.state='connected'
   and c.worker_last_seen>now()-interval '3 minutes'
 order by o.due_at,o.id for update of o skip locked limit 1;
 if not found then return jsonb_build_object('action','idle');end if;
 update public.whatsapp_outbox set state='sending',claimed_at=now() where id=v_job.id;
 return jsonb_build_object('action','send','id',v_job.id,
  'establishment_id',v_job.establishment_id,'instance_name',v_job.instance_name,
  'recipient',v_job.recipient,'body',v_job.body);
end $$;

create function public.whatsapp_cloud_finish(p_establishment_id uuid,
 p_job_id uuid,p_accepted boolean,p_provider_id text default null,p_error text default null)
returns void language plpgsql security definer set search_path=''
as $$
begin
 if p_accepted is null then raise exception 'invalid_status' using errcode='22023'; end if;
 update public.whatsapp_outbox set
 state=case when p_accepted then 'accepted' else 'failed' end,
 provider_id=left(coalesce(p_provider_id,''),180),
 error_code=case when p_accepted then null else left(coalesce(p_error,'send_unconfirmed'),60) end,
 finished_at=now()
 where id=p_job_id and establishment_id=p_establishment_id and state='sending'
 and exists(select 1 from public.whatsapp_connections c
     where c.establishment_id=p_establishment_id and c.backend='cloud');
 if not found then raise exception 'invalid_job' using errcode='42501';end if;
end $$;

revoke all on function public.whatsapp_cloud_request(uuid,text),
 public.whatsapp_cloud_list(),public.whatsapp_cloud_report(uuid,text,text,text,text),
 public.whatsapp_cloud_claim(),public.whatsapp_cloud_finish(uuid,uuid,boolean,text,text)
 from public,anon,authenticated;
grant execute on function public.whatsapp_cloud_request(uuid,text) to authenticated;
grant execute on function public.whatsapp_cloud_list(),
 public.whatsapp_cloud_report(uuid,text,text,text,text),
 public.whatsapp_cloud_claim(),
 public.whatsapp_cloud_finish(uuid,uuid,boolean,text,text) to service_role;
