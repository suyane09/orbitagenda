\set ON_ERROR_STOP on
-- Rodado somente no PostgreSQL DESCARTÁVEL do GitHub Actions.
-- Segurança do tenant é também exercitada no teste 10_tenant_isolation.sql.

do $$
declare
  v_update_count integer;
  v_delete_count integer;
  v_update_text text;
  v_delete_text text;
begin
  select count(*), string_agg(coalesce(qual,'') || ' ' || coalesce(with_check,''), ' ')
    into v_update_count, v_update_text
    from pg_policies
   where schemaname='public' and tablename='memberships'
     and cmd='UPDATE' and 'authenticated'=any(roles);
  select count(*), string_agg(coalesce(qual,''), ' ')
    into v_delete_count, v_delete_text
    from pg_policies
   where schemaname='public' and tablename='memberships'
     and cmd='DELETE' and 'authenticated'=any(roles);
  if v_update_count <> 1 or v_delete_count <> 1 then
    raise exception 'FAIL permissive policy count update %, delete %',v_update_count,v_delete_count;
  end if;
  if position('private.is_owner' in v_update_text)=0
     or position('private.is_superadmin' in v_update_text)=0
     or position('private.is_owner' in v_delete_text)=0
     or position('private.is_superadmin' in v_delete_text)=0 then
    raise exception 'FAIL owner/admin checks absent';
  end if;
  raise notice 'PASS membership UPDATE and DELETE have one owner-or-admin policy each';
end
$$;
