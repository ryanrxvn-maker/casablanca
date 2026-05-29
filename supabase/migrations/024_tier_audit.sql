-- 024_tier_audit.sql
-- Auditoria de mudanças MANUAIS de tier feitas pelo admin. Junto com a tabela
-- payments, fecha a trilha: todo acesso pago tem comprovante; todo acesso
-- concedido na mão tem registro de QUEM concedeu, QUANDO e POR QUÊ.
--
-- Anti-burla: a coluna tier já é protegida pelo trigger (014) — só service role
-- (webhook assinado ou endpoint admin) altera. Logo, um pro sem pagamento E sem
-- registro aqui é impossível de criar — e fácil de detectar se aparecer.

CREATE TABLE IF NOT EXISTS tier_changes (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  admin_id    uuid REFERENCES profiles(id) ON DELETE SET NULL,
  user_id     uuid REFERENCES profiles(id) ON DELETE CASCADE,
  from_tier   text,
  to_tier     text,
  reason      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tier_changes_user_idx ON tier_changes(user_id);
CREATE INDEX IF NOT EXISTS tier_changes_created_idx ON tier_changes(created_at DESC);

ALTER TABLE tier_changes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tier_changes_select_admin" ON tier_changes;
CREATE POLICY "tier_changes_select_admin" ON tier_changes
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin = true)
  );
-- Sem INSERT policy: só o service role (endpoint admin) escreve.
