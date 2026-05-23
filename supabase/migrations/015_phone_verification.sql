-- 015_phone_verification.sql
-- Telefone obrigatório no signup + verificação por SMS.
--
-- Fluxo:
--   1. Usuário se cadastra com email + telefone + senha
--   2. Supabase envia link de confirmação por email
--   3. Servidor manda código SMS pra phone (via Twilio se configurado)
--   4. Usuário confirma o código → phone_verified = true
--   5. Middleware bloqueia login se email_confirmed_at IS NULL ou
--      phone_verified IS NOT true
--
-- Compatibilidade: usuários antigos (sem phone) ficam ativos via
-- legacy_no_phone=true (opcional). Pra forçar todos a verificarem,
-- basta remover esse flag.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS phone_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS phone_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS legacy_no_phone boolean NOT NULL DEFAULT false;

-- Marca usuários existentes como "legacy" pra não ficarem bloqueados
UPDATE profiles
  SET legacy_no_phone = true
  WHERE phone IS NULL;

CREATE INDEX IF NOT EXISTS profiles_phone_idx ON profiles(phone)
  WHERE phone IS NOT NULL;

-- Tabela pra códigos OTP (com expiração de 10 min)
CREATE TABLE IF NOT EXISTS phone_otp_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  phone text NOT NULL,
  code text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  attempts int NOT NULL DEFAULT 0,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS phone_otp_profile_idx ON phone_otp_codes(profile_id);
CREATE INDEX IF NOT EXISTS phone_otp_expires_idx ON phone_otp_codes(expires_at);

-- Limpa códigos expirados periodicamente (manual; pode virar cron job)
CREATE OR REPLACE FUNCTION cleanup_expired_otp_codes()
RETURNS void AS $$
BEGIN
  DELETE FROM phone_otp_codes
    WHERE expires_at < now() - interval '1 day';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RLS: ninguém lê códigos OTP via cliente — só service role
ALTER TABLE phone_otp_codes ENABLE ROW LEVEL SECURITY;

-- View pro admin: contas com email + phone resolvidos
CREATE OR REPLACE VIEW admin_accounts_view AS
SELECT
  p.id,
  u.email,
  p.name,
  p.phone,
  p.phone_verified,
  p.tier,
  p.is_admin,
  p.is_active,
  p.legacy_no_phone,
  p.created_at,
  p.activated_at,
  p.last_seen_at,
  p.last_ip,
  p.last_tool
FROM profiles p
JOIN auth.users u ON u.id = p.id;
