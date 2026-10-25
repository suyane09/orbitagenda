-- Repair public booking service authorization without weakening tenant RLS
-- The Edge Function calls public.create_public_booking() as service_role.
-- That security-invoker function invokes private.billing_allows_write(uuid).
-- Production did not grant service_role USAGE of private or EXECUTE of the guard.
-- Grant only the necessary gate; never grant private schema to anon.
grant usage on schema private to service_role;
grant execute on function private.billing_allows_write(uuid) to service_role;
