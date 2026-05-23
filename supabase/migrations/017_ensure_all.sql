-- 017_ensure_all.sql
-- Migration consolidada e idempotente. Roda tudo o que faltou (tier +
-- phone_verification + view admin) em UMA TRANSAÇÃO segura.
--
-- Pode ser rodada várias vezes sem erro — usa IF NOT EXISTS em tudo.
-- Substitui as migrations 014, 015 e 016 se nenhuma delas tiver
-- sido aplicada ainda. Se alguma já rodou, esta apenas garante que
-- o resto exista.
--
-- ORDEM DE EXECUÇÃO: cola o arquivo inteiro no Supabase SQL Editor e
-- clica "Run".

-- ────────────────────────────────────────────────────────────────────
-- 1. COLUNA tier (free | basic | pro | admin)
-- ────────────────────────────────────────────────────────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS tier text NOT NULL DEFAULT 'free';

-- Drop constraint antiga (qualquer versão) e adiciona a nova
ALTER TABLE profiles
  DROP CONSTRAINT IF EXISTS profiles_tier_chk;

ALTER TABLE profiles
  ADD CONSTRAINT profiles_tier_chk
  CHECK (tier IN ('free', 'basic', 'pro', 'admin'));

CREATE INDEX IF NOT EXISTS profiles_tier_idx ON profiles(tier);

-- Backfill: admins viram 'admin', ativos não-admin viram 'pro'
UPDATE profiles SET tier = 'admin' WHERE is_admin = true AND tier <> 'admin';
UPDATE profiles SET tier = 'pro'
  WHERE is_active = true AND is_admin = false
    AND tier NOT IN ('basic', 'pro');

-- ────────────────────────────────────────────────────────────────────
-- 2. COLUNAS phone / phone_verified / legacy_no_phone
-- ────────────────────────────────────────────────────────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS phone_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS phone_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS legacy_no_phone boolean NOT NULL DEFAULT false;

-- Marca usuários antigos sem phone como "legacy" (não bloqueia eles)
UPDATE profiles
  SET legacy_no_phone = true
  WHERE phone IS NULL AND legacy_no_phone = false;

CREATE INDEX IF NOT EXISTS profiles_phone_idx ON profiles(phone)
  WHERE phone IS NOT NULL;

-- ────────────────────────────────────────────────────────────────────
-- 3. TABELA phone_otp_codes (códigos SMS de 6 dígitos)
-- ────────────────────────────────────────────────────────────────────
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

ALTER TABLE phone_otp_codes ENABLE ROW LEVEL SECURITY;

-- Limpeza de códigos expirados (utility)
CREATE OR REPLACE FUNCTION cleanup_expired_otp_codes()
RETURNS void AS $$
BEGIN
  DELETE FROM phone_otp_codes
    WHERE expires_at < now() - interval '1 day';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ────────────────────────────────────────────────────────────────────
-- 4. TRIGGER: protege tier de mudanças por non-admin
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION enforce_tier_column()
RETURNS TRIGGER AS $$
DECLARE
  caller_is_admin boolean;
BEGIN
  -- Service role bypassa (auth.uid() = NULL)
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- INSERT direto via signup → força tier='free'
  IF TG_OP = 'INSERT' THEN
    SELECT is_admin INTO caller_is_admin
      FROM profiles WHERE id = auth.uid();
    IF NOT COALESCE(caller_is_admin, false) THEN
      NEW.tier := 'free';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: só admin pode mudar tier
  IF TG_OP = 'UPDATE' THEN
    IF NEW.tier IS DISTINCT FROM OLD.tier THEN
      SELECT is_admin INTO caller_is_admin
        FROM profiles WHERE id = auth.uid();
      IF NOT COALESCE(caller_is_admin, false) THEN
        RAISE EXCEPTION 'Apenas administradores podem alterar tier.';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS profiles_protect_tier ON profiles;
CREATE TRIGGER profiles_protect_tier
  BEFORE INSERT OR UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION enforce_tier_column();

-- ────────────────────────────────────────────────────────────────────
-- 5. TRIGGER: signup público vira 'free' ATIVO automaticamente
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION enforce_admin_columns()
RETURNS TRIGGER AS $$
DECLARE
  caller_is_admin boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT is_admin INTO caller_is_admin
      FROM profiles WHERE id = auth.uid();

    IF NOT COALESCE(caller_is_admin, false) THEN
      NEW.is_admin := false;
      -- Free signup começa ATIVO (pode logar mas é limitado)
      NEW.is_active := true;
      NEW.tier := 'free';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.is_admin IS DISTINCT FROM OLD.is_admin
       OR NEW.is_active IS DISTINCT FROM OLD.is_active THEN
      SELECT is_admin INTO caller_is_admin
        FROM profiles WHERE id = auth.uid();
      IF NOT COALESCE(caller_is_admin, false) THEN
        RAISE EXCEPTION 'Apenas administradores podem alterar is_admin ou is_active.';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- O trigger profiles_protect_admin_cols já existe (criado em 009);
-- só atualizamos a função.

-- ────────────────────────────────────────────────────────────────────
-- 6. VIEW admin_accounts_view (junta profiles + auth.users)
-- ────────────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS admin_accounts_view;
CREATE VIEW admin_accounts_view AS
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

-- ────────────────────────────────────────────────────────────────────
-- 7. Verificação final — mostra status
-- ────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  total int;
  free_n int;
  basic_n int;
  pro_n int;
  admin_n int;
BEGIN
  SELECT count(*) INTO total FROM profiles;
  SELECT count(*) INTO free_n FROM profiles WHERE tier = 'free';
  SELECT count(*) INTO basic_n FROM profiles WHERE tier = 'basic';
  SELECT count(*) INTO pro_n FROM profiles WHERE tier = 'pro';
  SELECT count(*) INTO admin_n FROM profiles WHERE tier = 'admin';

  RAISE NOTICE 'Migration 017 aplicada com sucesso.';
  RAISE NOTICE '  Total profiles: %', total;
  RAISE NOTICE '  Free: %', free_n;
  RAISE NOTICE '  Basic: %', basic_n;
  RAISE NOTICE '  Pro: %', pro_n;
  RAISE NOTICE '  Admin: %', admin_n;
END $$;
