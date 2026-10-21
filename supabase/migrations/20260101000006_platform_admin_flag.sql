-- Orbit Agenda · Etapa 1 · 0006 · Flag de superadmin para a UI
-- Informa apenas se o PRÓPRIO usuário logado é superadmin (usado para exibir menus).
-- Não concede nada: a autorização real continua nas policies RLS.

create function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_superadmin();
$$;

revoke all on function public.is_platform_admin() from public, anon, authenticated;
grant execute on function public.is_platform_admin() to authenticated;
