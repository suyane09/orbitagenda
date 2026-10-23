-- Consolidação de RLS: mantém a mesma lógica dos dois pares de políticas.
-- UPDATE: dono pode alterar apenas vínculos staff do próprio estabelecimento;
-- superadministrador conserva as permissões anteriores.
-- DELETE: mesmas condições de UPDATE para cada papel.
-- Requer backup e teste; NÃO aplicar por db push antes de reconciliar histórico.
begin;

drop policy if exists memberships_update_staff on public.memberships;
drop policy if exists memberships_update_superadmin on public.memberships;
create policy memberships_update_authorized on public.memberships
for update to authenticated
using (
  ((role = 'staff'::public.membership_role) and private.is_owner(establishment_id))
  or private.is_superadmin()
)
with check (
  ((role = 'staff'::public.membership_role) and private.is_owner(establishment_id))
  or private.is_superadmin()
);

drop policy if exists memberships_delete_staff on public.memberships;
drop policy if exists memberships_delete_superadmin on public.memberships;
create policy memberships_delete_authorized on public.memberships
for delete to authenticated
using (
  ((role = 'staff'::public.membership_role) and private.is_owner(establishment_id))
  or private.is_superadmin()
);

commit;
