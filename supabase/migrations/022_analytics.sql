-- 022_analytics.sql
-- Dados pro dashboard do dono (cérebro): ranking de ferramentas usadas +
-- origem de tráfego (first-touch). Online/IP já vêm da 011.

-- ─── 1. Eventos de uso de ferramenta ─────────────────────────────────
-- Um evento por ABERTURA de ferramenta (o heartbeat só insere quando o
-- slug muda — não a cada ping). Permite ranquear mais/menos usadas.
CREATE TABLE IF NOT EXISTS tool_events (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  tool       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tool_events_tool_idx ON tool_events(tool);
CREATE INDEX IF NOT EXISTS tool_events_created_idx ON tool_events(created_at DESC);
CREATE INDEX IF NOT EXISTS tool_events_user_idx ON tool_events(user_id);

ALTER TABLE tool_events ENABLE ROW LEVEL SECURITY;

-- Usuário insere só eventos próprios (heartbeat roda com a sessão dele).
DROP POLICY IF EXISTS "tool_events_insert_own" ON tool_events;
CREATE POLICY "tool_events_insert_own" ON tool_events
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Só admin lê (o dashboard usa service role, mas isto fecha leitura via anon).
DROP POLICY IF EXISTS "tool_events_select_admin" ON tool_events;
CREATE POLICY "tool_events_select_admin" ON tool_events
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin = true)
  );

-- ─── 2. Origem de tráfego (first-touch) no profile ───────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS traffic_source text,
  ADD COLUMN IF NOT EXISTS utm_source text,
  ADD COLUMN IF NOT EXISTS utm_medium text,
  ADD COLUMN IF NOT EXISTS utm_campaign text,
  ADD COLUMN IF NOT EXISTS first_touch_at timestamptz;

COMMENT ON COLUMN profiles.traffic_source IS
  'Host do referrer na 1a visita (ex: instagram.com, google.com, direct).';
COMMENT ON COLUMN profiles.utm_source IS 'utm_source capturado na 1a visita.';
