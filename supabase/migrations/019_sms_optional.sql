-- 019_sms_optional.sql
-- ===============================================================
-- SMS verification opcional até Twilio ser configurado.
--
-- Marca TODOS os usuários atualmente sem phone_verified como
-- verificados — desbloqueia quem já se cadastrou e está preso no
-- /verify-phone esperando código que nunca chega.
--
-- Quando o Twilio for plugado e `SMS_REQUIRED=1` ativado na Vercel,
-- novos signups vão passar pelo SMS normalmente. Usuários antigos
-- ficam como verificados (não precisa re-verificar).
--
-- Rodar UMA VEZ no Supabase SQL Editor. Idempotente.
-- ===============================================================

-- Backfill phone_verified pra todos os profiles que ainda não foram
-- marcados. Inclui phone_verified_at = now() pra ter timestamp.
UPDATE profiles
   SET phone_verified = true,
       phone_verified_at = COALESCE(phone_verified_at, now())
 WHERE phone_verified IS DISTINCT FROM true;

-- Idem pra legacy_no_phone (admins/contas antigas sem phone):
-- garante que ninguém fique preso por falta da coluna.
UPDATE profiles
   SET legacy_no_phone = true
 WHERE legacy_no_phone IS NULL
   AND (phone IS NULL OR phone = '');

-- ============================================================
-- Verificação rápida (rode após):
--   SELECT id, tier, phone_verified, legacy_no_phone, phone
--     FROM profiles
--     WHERE phone_verified IS NOT TRUE AND legacy_no_phone IS NOT TRUE;
--
-- Esperado: 0 linhas.
-- ============================================================
