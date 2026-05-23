-- 014_account_tiers.sql
-- Sistema de 3 tiers de conta:
--   'free' → cadastro aberto. Só pode usar Decupagem (e dentro, só áudio)
--   'beta' → criado pelo admin (legado: era o "is_active=true" + NOT is_admin)
--   'admin' → conta do dono
--
-- Compatibilidade com schema anterior:
--   • is_admin=true   ⇒ tier='admin'
--   • is_active=true e NOT is_admin ⇒ tier='beta'
--   • novos signups públicos ⇒ tier='free' (com is_active=true pra poder logar)
--
-- Segurança: trigger impede usuário comum de auto-promover. Service role
-- (admin API) pode setar 'beta'.

-- ─── 1. Adicionar coluna `tier` ───────────────────────────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS tier text NOT NULL DEFAULT 'free';

-- Constraint pra garantir apenas valores válidos
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_tier_chk'
  ) THEN
    ALTER TABLE profiles
      ADD CONSTRAINT profiles_tier_chk
      CHECK (tier IN ('free', 'beta', 'admin'));
  END IF;
END $$;

-- ─── 2. Backfill dos usuários existentes ──────────────────────────────
-- Admins viram 'admin'
UPDATE profiles SET tier = 'admin' WHERE is_admin = true AND tier <> 'admin';
-- Quem é ativo e não admin vira 'beta' (preserva acesso atual)
UPDATE profiles SET tier = 'beta'
  WHERE is_active = true AND is_admin = false AND tier <> 'beta';

CREATE INDEX IF NOT EXISTS profiles_tier_idx ON profiles(tier);

-- ─── 3. Trigger de proteção ───────────────────────────────────────────
-- Usuário comum NUNCA pode setar tier='beta' ou 'admin'.
-- 'free' é o único permitido em INSERT/UPDATE feito por user.
CREATE OR REPLACE FUNCTION enforce_tier_column()
RETURNS TRIGGER AS $$
DECLARE
  caller_is_admin boolean;
BEGIN
  -- Service role bypassa
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Em INSERT direto via signup, força 'free' (a menos que caller seja admin)
  IF TG_OP = 'INSERT' THEN
    SELECT is_admin INTO caller_is_admin
      FROM profiles WHERE id = auth.uid();
    IF NOT COALESCE(caller_is_admin, false) THEN
      NEW.tier := 'free';
    END IF;
    RETURN NEW;
  END IF;

  -- Em UPDATE, só admin pode mudar o tier
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

-- ─── 4. Trigger: signup público vira 'free' e ativo automaticamente ──
-- Quando alguém cria conta direto (sem admin criar), ele precisa de
-- is_active=true pra conseguir logar (não ficar em "access-revoked"),
-- mas com tier='free' que limita o acesso via middleware.
--
-- O trigger atual em 009 força is_active=false em inserts não-admin.
-- Aqui ajustamos: se tier='free', is_active pode ser true.
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
      -- Novidade: free signup começa ATIVO (pode logar mas é limitado)
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
