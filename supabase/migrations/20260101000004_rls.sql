-- Orbit Agenda · Etapa 1 · 0004 · Row Level Security
-- Modelo: superadmin = leitura global (suporte) + gestão de estabelecimentos/vínculos;
-- owner = gestão total da própria empresa; staff = operação diária.
-- Nenhuma policy consulta a própria tabela diretamente: tudo passa pelos helpers
-- SECURITY DEFINER de private.*, portanto não há recursão.

alter table public.profiles         enable row level security;
alter table public.platform_admins  enable row level security;  -- sem policies = ninguém via API
alter table public.establishments   enable row level security;
alter table public.memberships      enable row level security;
alter table public.professionals    enable row level security;
alter table public.services         enable row level security;
alter table public.customers        enable row level security;
alter table public.working_hours    enable row level security;
alter table public.schedule_blocks  enable row level security;
alter table public.appointments     enable row level security;

-- profiles ---------------------------------------------------------------
create policy profiles_select on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or private.shares_establishment_with(id)
    or private.is_superadmin()
  );
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- establishments (INSERT só via public.create_establishment) -----------------
create policy establishments_select on public.establishments for select to authenticated
  using (private.is_member(id) or private.is_superadmin());
create policy establishments_update on public.establishments for update to authenticated
  using (private.is_owner(id) or private.is_superadmin())
  with check (private.is_owner(id) or private.is_superadmin());
create policy establishments_delete on public.establishments for delete to authenticated
  using (private.is_superadmin());

-- memberships (INSERT só via SQL privilegiado / futura função de convite) ------
create policy memberships_select on public.memberships for select to authenticated
  using (
    user_id = (select auth.uid())
    or private.is_member(establishment_id)
    or private.is_superadmin()
  );
create policy memberships_update_staff on public.memberships for update to authenticated
  using (role = 'staff' and private.is_owner(establishment_id))
  with check (role = 'staff' and private.is_owner(establishment_id));
create policy memberships_update_superadmin on public.memberships for update to authenticated
  using (private.is_superadmin()) with check (private.is_superadmin());
create policy memberships_delete_staff on public.memberships for delete to authenticated
  using (role = 'staff' and private.is_owner(establishment_id));
create policy memberships_delete_superadmin on public.memberships for delete to authenticated
  using (private.is_superadmin());

-- Leitura: qualquer membro ativo da empresa (ou superadmin) ----------------
do $$
declare t text;
begin
  foreach t in array array['professionals','services','customers',
                           'working_hours','schedule_blocks','appointments']
  loop
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (private.is_member(establishment_id) or private.is_superadmin())',
      t || '_select', t);
  end loop;
end $$;

-- Catálogo (profissionais, serviços, horários): somente proprietário escreve ----
do $$
declare t text;
begin
  foreach t in array array['professionals','services','working_hours']
  loop
    execute format(
      'create policy %I on public.%I for insert to authenticated
         with check (private.is_owner(establishment_id))', t || '_insert', t);
    execute format(
      'create policy %I on public.%I for update to authenticated
         using (private.is_owner(establishment_id))
         with check (private.is_owner(establishment_id))', t || '_update', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated
         using (private.is_owner(establishment_id))', t || '_delete', t);
  end loop;
end $$;

-- Operação diária: proprietário e funcionário --------------------------------
do $$
declare t text;
begin
  foreach t in array array['customers','schedule_blocks','appointments']
  loop
    execute format(
      'create policy %I on public.%I for insert to authenticated
         with check (private.is_member(establishment_id))', t || '_insert', t);
    execute format(
      'create policy %I on public.%I for update to authenticated
         using (private.is_member(establishment_id))
         with check (private.is_member(establishment_id))', t || '_update', t);
  end loop;
end $$;

-- Exclusão: clientes e agendamentos só pelo proprietário; bloqueios por qualquer membro
create policy customers_delete on public.customers for delete to authenticated
  using (private.is_owner(establishment_id));
create policy appointments_delete on public.appointments for delete to authenticated
  using (private.is_owner(establishment_id));
create policy schedule_blocks_delete on public.schedule_blocks for delete to authenticated
  using (private.is_member(establishment_id));
