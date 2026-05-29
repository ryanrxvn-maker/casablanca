-- 026_function_hardening.sql
-- Limpa warnings do Security Advisor (baixa severidade, hardening).
--
-- Revoga EXECUTE via API + fixa search_path nas funções de TRIGGER. Elas
-- disparam automaticamente (não precisam ser chamáveis por anon/authenticated),
-- então revogar não quebra signup nem os triggers de proteção.

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT n.nspname AS s, p.proname AS f,
           pg_get_function_identity_arguments(p.oid) AS a
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'enforce_admin_columns',
        'enforce_tier_column',
        'handle_new_user',
        'cleanup_expired_otp_codes',
        'user_api_keys_touch_updated',
        'user_secrets_touch_updated'
      )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %I.%I(%s) FROM public, anon, authenticated', r.s, r.f, r.a);
    EXECUTE format('ALTER FUNCTION %I.%I(%s) SET search_path = public', r.s, r.f, r.a);
  END LOOP;
END $$;
