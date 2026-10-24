-- Teste de onboarding sem cobranças reais; executado em PostgreSQL descartável pelo CI.
BEGIN;
INSERT INTO auth.users(id,email)
VALUES ('a5a5a5a5-a5a5-45a5-a5a5-a5a5a5a5a5a5','qa-onboarding@example.invalid');
SELECT set_config('request.jwt.claim.sub','a5a5a5a5-a5a5-45a5-a5a5-a5a5a5a5a5a5',true);

DO $qa$
DECLARE
  v_id uuid;
  v_slug text;
  v_price bigint;
  v_status text;
  v_msg text;
  v_recorded boolean;
BEGIN
  SELECT id,slug INTO v_id,v_slug FROM public.create_establishment('QA Onboarding');
  IF v_id IS NULL THEN RAISE EXCEPTION 'FAIL: no establishment'; END IF;
  RAISE NOTICE 'PASS: authenticated owner created establishment';

  SELECT p.monthly_price_cents,s.status INTO v_price,v_status
  FROM public.establishment_subscriptions s
  JOIN public.subscription_plans p ON p.id=s.plan_id
  WHERE s.establishment_id=v_id;
  IF v_price IS DISTINCT FROM 4990 OR v_status IS DISTINCT FROM 'past_due'
  THEN RAISE EXCEPTION 'FAIL: pending R$49.90 subscription not attached'; END IF;
  RAISE NOTICE 'PASS: initial subscription attached without charge';

  IF private.billing_allows_write(v_id)
  THEN RAISE EXCEPTION 'FAIL: pending subscription allows writes'; END IF;
  RAISE NOTICE 'PASS: pending subscription blocks writes';

  BEGIN
    PERFORM public.create_public_booking(v_slug,gen_random_uuid(),gen_random_uuid(),
      current_date+1,'10:00'::time,'QA Cliente','11999999999');
    RAISE EXCEPTION 'FAIL: public booking accepted';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF v_msg <> 'subscription_suspended'
    THEN RAISE EXCEPTION 'FAIL: wrong booking rejection %',v_msg; END IF;
  END;
  RAISE NOTICE 'PASS: public booking blocked before payment';

  UPDATE public.establishment_subscriptions
  SET asaas_subscription_id='sub_qa_onboarding',asaas_environment='sandbox'
  WHERE establishment_id=v_id;

  SELECT public.record_asaas_billing_event('evt_qa_onboarding_1',
    'sub_qa_onboarding','pay_qa_onboarding_1',
    'PAYMENT_RECEIVED','RECEIVED',4990,'sandbox',current_date)
  INTO v_recorded;
  IF NOT v_recorded OR NOT private.billing_allows_write(v_id)
  THEN RAISE EXCEPTION 'FAIL: simulated payment did not restore access'; END IF;
  RAISE NOTICE 'PASS: simulated payment restores access';

  SELECT public.record_asaas_billing_event('evt_qa_onboarding_1',
    'sub_qa_onboarding','pay_qa_onboarding_1',
    'PAYMENT_RECEIVED','RECEIVED',4990,'sandbox',current_date)
  INTO v_recorded;
  IF v_recorded THEN RAISE EXCEPTION 'FAIL: duplicate event not idempotent'; END IF;
  RAISE NOTICE 'PASS: duplicate payment event ignored';
END
$qa$;
ROLLBACK;
