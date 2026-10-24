-- Evita EXECUTE herdado de PUBLIC em helper SECURITY DEFINER de cobrança.
-- A função é chamada internamente pelas políticas; usuários anônimos não precisam executá-la.
REVOKE EXECUTE ON FUNCTION private.billing_allows_write(uuid) FROM PUBLIC, anon;
