-- 009_admin_access_control.sql
-- Closed-beta access control:
--  - is_admin: marca usuario como administrador (so admin pode marcar outros)
--  - is_active: usuario inativo nao consegue acessar a app (bloqueio no middleware)
--  - created_by: rastreia qual admin criou cada usuario
--
-- Trigger garante que NENHUM usuario comum pode setar is_admin/is_active.
-- Service role (usado pela API admin com SUPABASE_SERVICE_ROLE_KEY) bypassa.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS activated_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS profiles_is_admin_idx
  ON profiles(is_admin) WHERE is_admin = true;
CREATE INDEX IF NOT EXISTS profiles_is_active_idx
  ON profiles(is_active);

-- ----------------------------------------------------------------------
-- Trigger: protege is_admin e is_active de mudancas por non-admin
-- ----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_admin_columns()
RETURNS TRIGGER AS $$
DECLARE
  caller_is_admin boolean;
BEGIN
  -- Service role tem auth.uid() = NULL → bypassa todas as regras.
  -- (e isso que permite a API admin criar/editar usuarios.)
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- Signup direto cria profile sempre INATIVO.
    -- Se vier is_admin=true ou is_active=true via signup direto,
    -- forca pra false a menos que o caller seja admin.
    SELECT is_admin INTO caller_is_admin
      FROM profiles WHERE id = auth.uid();

    IF NOT COALESCE(caller_is_admin, false) THEN
      NEW.is_admin := false;
      NEW.is_active := false;
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

DROP TRIGGER IF EXISTS profiles_protect_admin_cols ON profiles;
CREATE TRIGGER profiles_protect_admin_cols
  BEFORE INSERT OR UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION enforce_admin_columns();

-- ----------------------------------------------------------------------
-- RLS: admin pode ver e modificar todos os profiles, user normal so o seu.
-- ----------------------------------------------------------------------
DROP POLICY IF EXISTS "profiles_select_self" ON profiles;
DROP POLICY IF EXISTS "profiles_select_self_or_admin" ON profiles;
CREATE POLICY "profiles_select_self_or_admin" ON profiles
  FOR SELECT USING (
    auth.uid() = id
    OR EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.is_admin = true
    )
  );

DROP POLICY IF EXISTS "profiles_update_self" ON profiles;
DROP POLICY IF EXISTS "profiles_update_self_or_admin" ON profiles;
CREATE POLICY "profiles_update_self_or_admin" ON profiles
  FOR UPDATE USING (
    auth.uid() = id
    OR EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.is_admin = true
    )
  );

-- ============================================================================
-- BOOTSTRAP DO PRIMEIRO ADMIN
-- ============================================================================
-- Apos criar seu usuario admin via signup normal (uma unica vez), execute
-- isso no SQL Editor do Supabase pra ativar e promover:
--
--   UPDATE profiles
--   SET is_admin = true, is_active = true, activated_at = now()
--   WHERE id = (
--     SELECT id FROM auth.users WHERE email = 'SEU-EMAIL-ADMIN@EXEMPLO.COM'
--   );
--
-- Depois disso, todos os outros usuarios so podem ser criados via /admin
-- (que usa SUPABASE_SERVICE_ROLE_KEY pra bypassar o trigger).
-- ============================================================================
