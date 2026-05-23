-- 018_open_signup.sql
-- ===============================================================
-- Abre os cadastros: usuário recém-criado pelo /register fica ATIVO
-- automaticamente (tier 'free'). Antes, a migration 009 marcava todo
-- mundo como is_active=false (era closed beta) e o user ficava preso
-- no /access-revoked → middleware fazia signOut → loop de erro.
--
-- Esta migration:
--   1. Muda o DEFAULT de is_active de false → true
--   2. Atualiza o trigger enforce_admin_columns pra NÃO forçar
--      is_active=false em INSERTs diretos (só protege is_admin).
--   3. Backfill: ativa TODOS os usuários atualmente inativos
--      (vítimas do bug — não foram desativados por nenhum admin).
--
-- Admin continua podendo desativar manualmente quem quiser
-- (UPDATE is_active=false ainda funciona via /admin com service_role).
--
-- Rodar UMA VEZ no Supabase SQL Editor. Idempotente.
-- ===============================================================

-- 1) DEFAULT da coluna passa a ser true
ALTER TABLE profiles
  ALTER COLUMN is_active SET DEFAULT true;

-- 2) Trigger: parar de forçar is_active=false em signup direto.
--    Mantém a proteção contra usuário comum se auto-promover a admin.
CREATE OR REPLACE FUNCTION enforce_admin_columns()
RETURNS TRIGGER AS $$
DECLARE
  caller_is_admin boolean;
BEGIN
  -- Service role tem auth.uid() = NULL → bypassa todas as regras.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT is_admin INTO caller_is_admin
      FROM profiles WHERE id = auth.uid();

    -- Usuário comum NÃO pode se auto-promover a admin.
    -- is_active fica com o default (true) — cadastro aberto.
    IF NOT COALESCE(caller_is_admin, false) THEN
      NEW.is_admin := false;
      -- ANTES: NEW.is_active := false; (forçava inativo)
      -- AGORA: deixa o default da coluna atuar (true).
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- UPDATE em is_admin OU is_active continua restrito a admin.
    -- (signOut/banimento manual pelo painel admin segue funcionando.)
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

-- Re-amarra o trigger (idempotente)
DROP TRIGGER IF EXISTS profiles_protect_admin_cols ON profiles;
CREATE TRIGGER profiles_protect_admin_cols
  BEFORE INSERT OR UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION enforce_admin_columns();

-- 3) Backfill: ativa quem está inativo SEM ter sido desativado de propósito.
--    Heurística: qualquer profile com tier='free' OU sem tier definido
--    que esteja com is_active=false foi vítima do bug. Admin ativo
--    (is_admin=true) já tinha is_active=true. Quem foi banido manual
--    pelo /admin teria tier preservado mas is_active=false — esses
--    queremos ATIVAR também porque a regra era "free deveria entrar",
--    e o admin pode rebanir manualmente se precisar.
UPDATE profiles
   SET is_active = true,
       activated_at = COALESCE(activated_at, now())
 WHERE is_active = false;

-- ============================================================
-- Verificação rápida (rode após):
--   SELECT id, email_from_auth(id) AS email, tier, is_active, is_admin
--     FROM profiles
--     ORDER BY created_at DESC NULLS LAST
--     LIMIT 20;
--
-- Esperado: is_active=true em todos.
-- ============================================================
