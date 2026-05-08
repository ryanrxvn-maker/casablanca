-- 011_user_activity.sql
-- Senha provisoria + tracking de atividade (online/IP/ferramenta).
-- Admin usa esses campos pra ver quem ta online no painel.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_ip text,
  ADD COLUMN IF NOT EXISTS last_tool text,
  ADD COLUMN IF NOT EXISTS last_tool_at timestamptz;

CREATE INDEX IF NOT EXISTS profiles_last_seen_idx ON profiles(last_seen_at DESC);

COMMENT ON COLUMN profiles.must_change_password IS
  'true = senha foi setada pelo admin; user precisa trocar antes de usar o app.';
COMMENT ON COLUMN profiles.last_seen_at IS
  'Heartbeat do client. Online = ultimo update < 60s.';
COMMENT ON COLUMN profiles.last_tool IS
  'Slug da ultima tool aberta (auto-broll, decupagem, etc).';
