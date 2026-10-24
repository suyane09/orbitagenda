-- SECURITY DEFINER bypasses table RLS. Check subscription after authorization and before tenant mutations.
-- Safe to rerun: existing guarded definitions are skipped.
DO $billing$
DECLARE
  v_name text;
  v_anchor text;
  v_target text;
  v_definition text;
  v_start integer;
  v_end integer;
  v_insertion integer;
  v_count integer := 0;
BEGIN
  FOR v_name, v_anchor, v_target IN
    SELECT * FROM (VALUES
      ('close_cash_day','if auth.uid() is null or not private.is_owner(p_establishment_id) then','p_establishment_id'),
      ('create_team_invitation','if auth.uid() is null or not private.is_owner(p_establishment_id) then','p_establishment_id'),
      ('record_commission_payout','if auth.uid() is null or not private.is_owner(p_establishment_id) then','p_establishment_id'),
      ('accept_team_invitation','if not found then raise exception ''invalid_or_expired_invitation''','v_inv.establishment_id'),
      ('reopen_cash_day','if not found or not private.is_owner(v_row.establishment_id) then','v_row.establishment_id'),
      ('revoke_team_invitation','if v_est is null or auth.uid() is null or not private.is_owner(v_est) then','v_est')
    ) AS checks(name,anchor,target)
  LOOP
    SELECT pg_get_functiondef(p.oid) INTO v_definition
    FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
      AND p.proname=v_name AND p.prosecdef
      AND p.pronargs=CASE
        WHEN v_name IN ('accept_team_invitation','revoke_team_invitation') THEN 1
        WHEN v_name IN ('reopen_cash_day','create_team_invitation','close_cash_day') THEN 2
        ELSE 6 END;
    IF v_definition IS NULL THEN
      RAISE EXCEPTION 'missing_or_changed_security_definer_function: %',v_name;
    END IF;
    IF position('subscription_suspended' IN v_definition)>0 THEN CONTINUE; END IF;
    v_start:=strpos(v_definition,v_anchor);
    IF v_start=0 THEN RAISE EXCEPTION 'unexpected_auth_guard: %',v_name; END IF;
    v_end:=strpos(substr(v_definition,v_start),'end if;');
    IF v_end=0 OR v_end>400 THEN RAISE EXCEPTION 'unexpected_auth_guard_end: %',v_name; END IF;
    v_insertion:=v_start+v_end-1+length('end if;');
    v_definition:=overlay(v_definition placing E'\n  if not private.billing_allows_write(' || v_target || E') then\n    raise exception ''subscription_suspended'' using errcode=''42501'';\n  end if;\n' from v_insertion for 0);
    EXECUTE v_definition;
    v_count:=v_count+1;
  END LOOP;
  IF v_count NOT IN (0,6) THEN
    RAISE EXCEPTION 'partial_guard_installation: %',v_count;
  END IF;
END
$billing$;
