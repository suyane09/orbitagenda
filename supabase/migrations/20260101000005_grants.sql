-- Orbit Agenda · Etapa 1 · 0005 · Privilégios mínimos
-- O Supabase concede ALL em tabelas novas a anon/authenticated por padrão.
-- Aqui revogamos tudo e concedemos só o necessário (RLS é a 2ª camada).

alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated, public;

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated, public;
revoke all on all functions in schema private from public, anon, authenticated;

-- Helpers de RLS: executáveis só por usuários autenticados (policies os invocam).
grant execute on function private.is_superadmin()                 to authenticated;
grant execute on function private.is_member(uuid)                 to authenticated;
grant execute on function private.is_owner(uuid)                  to authenticated;
grant execute on function private.shares_establishment_with(uuid) to authenticated;

-- Única RPC pública de escrita.
grant execute on function public.create_establishment(text, public.business_type, text, text)
  to authenticated;

-- Leitura
grant select on public.profiles, public.establishments, public.memberships,
                public.professionals, public.services, public.customers,
                public.working_hours, public.schedule_blocks, public.appointments
  to authenticated;

-- Escrita por coluna (impede alterar slug, created_by, user_id, role etc.)
grant update (full_name) on public.profiles to authenticated;
grant update (name, phone, business_type, timezone) on public.establishments to authenticated;
grant update (is_active) on public.memberships to authenticated;
grant delete on public.memberships to authenticated;
grant delete on public.establishments to authenticated;  -- policy limita a superadmin

grant insert (establishment_id, membership_id, name, bio, color, is_active)
  on public.professionals to authenticated;
grant update (membership_id, name, bio, color, is_active, establishment_id)
  on public.professionals to authenticated;
grant delete on public.professionals to authenticated;

grant insert (establishment_id, name, description, duration_minutes, price_cents, is_active)
  on public.services to authenticated;
grant update (name, description, duration_minutes, price_cents, is_active, establishment_id)
  on public.services to authenticated;
grant delete on public.services to authenticated;

grant insert (establishment_id, full_name, phone, email, notes)
  on public.customers to authenticated;
grant update (full_name, phone, email, notes, establishment_id)
  on public.customers to authenticated;
grant delete on public.customers to authenticated;

grant insert (establishment_id, professional_id, weekday, start_time, end_time)
  on public.working_hours to authenticated;
grant update (professional_id, weekday, start_time, end_time, establishment_id)
  on public.working_hours to authenticated;
grant delete on public.working_hours to authenticated;

grant insert (establishment_id, professional_id, starts_at, ends_at, reason)
  on public.schedule_blocks to authenticated;
grant update (professional_id, starts_at, ends_at, reason, establishment_id)
  on public.schedule_blocks to authenticated;
grant delete on public.schedule_blocks to authenticated;

-- created_by é preenchido pelo trigger private.set_created_by, nunca pelo cliente.
grant insert (establishment_id, professional_id, service_id, customer_id,
              starts_at, ends_at, status, price_cents, notes)
  on public.appointments to authenticated;
grant update (professional_id, service_id, customer_id, starts_at, ends_at,
              status, price_cents, notes, establishment_id)
  on public.appointments to authenticated;
grant delete on public.appointments to authenticated;
