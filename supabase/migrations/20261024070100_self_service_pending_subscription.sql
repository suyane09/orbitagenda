-- Onboarding seguro: associa automaticamente o plano Inicial (R$ 49,90)
-- a NOVOS estabelecimentos, sem liberar escrita nem gerar cobranças.
-- A assinatura nasce "past_due" sem vencimento, portanto billing_allows_write=false.
-- Não modifica assinaturas nem cobranças de estabelecimentos existentes.
-- O banco descartável de CI não possui os registros administrativos de produção.
-- Cria o plano apenas se ausente; nunca sobrescreve preço/contrato existente.
INSERT INTO public.subscription_plans(code,name,monthly_price_cents,is_public)
VALUES ('inicial_4990','Inicial',4990,true)
ON CONFLICT (code) DO NOTHING;

DO $migration$
DECLARE
  v_def text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.subscription_plans
    WHERE code='inicial_4990' AND monthly_price_cents=4990
  ) THEN
    RAISE EXCEPTION 'expected_initial_plan_missing_or_price_changed';
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p
  WHERE p.pronamespace='public'::regnamespace
    AND p.proname='create_establishment'
    AND p.pronargs=4;

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'create_establishment_signature_changed';
  END IF;

  IF strpos(v_def, 'billing_onboarding_pending') > 0 THEN
    RETURN;
  END IF;

  IF strpos(v_def, '  return v_row;') = 0 THEN
    RAISE EXCEPTION 'create_establishment_return_anchor_changed';
  END IF;

  v_def := replace(v_def, '  return v_row;',
    E'  -- billing_onboarding_pending: sem período gratuito e sem cobrança automática.\n'
    || E'  insert into public.establishment_subscriptions\n'
    || E'    (establishment_id,plan_id,status,notes)\n'
    || E'  select v_row.id,p.id,\'past_due\',\'Aguardando contratação da primeira mensalidade\'\n'
    || E'  from public.subscription_plans p\n'
    || E'  where p.code=\'inicial_4990\' and p.monthly_price_cents=4990\n'
    || E'    and p.is_public=true;\n'
    || E'  if not found then\n'
    || E'    raise exception \'billing_plan_unavailable\' using errcode=\'P0001\';\n'
    || E'  end if;\n\n'
    || '  return v_row;'
  );
  EXECUTE v_def;
END
$migration$;

-- A publicação deste plano apenas o torna elegível no onboarding.
-- Não ativa cobrança, não altera preço e não modifica contratos existentes.
UPDATE public.subscription_plans
SET is_public=true
WHERE code='inicial_4990' AND monthly_price_cents=4990
  AND is_public=false;
