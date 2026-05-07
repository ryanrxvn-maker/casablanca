-- 010_user_api_keys.sql
-- BYOK (Bring Your Own Key): cada usuario configura suas proprias chaves
-- Anthropic / AssemblyAI / ElevenLabs. As chaves saem CIPHERTEXT do banco
-- (AES-256-GCM com SECRETS_ENCRYPTION_KEY do servidor) e so o owner ve.

CREATE TABLE IF NOT EXISTS user_api_keys (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Cipher text (base64) — NUNCA esta em plaintext aqui.
  anthropic_key text,
  assemblyai_key text,
  elevenlabs_key text,

  -- Last 4 chars de cada key, em plaintext (so pra UI exibir
  -- "configurada · ····abcd"). Considerado nao-sensivel.
  anthropic_last4 text,
  assemblyai_last4 text,
  elevenlabs_last4 text,

  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE user_api_keys ENABLE ROW LEVEL SECURITY;

-- Apenas o dono pode ler/escrever sua propria linha.
-- Service role bypassa (auth.uid() IS NULL) — usado por rotas que
-- precisam decifrar as keys do usuario que chamou.
DROP POLICY IF EXISTS "user_api_keys_owner" ON user_api_keys;
CREATE POLICY "user_api_keys_owner" ON user_api_keys
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Trigger pra updated_at automatico
CREATE OR REPLACE FUNCTION user_api_keys_touch_updated()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS user_api_keys_updated_at ON user_api_keys;
CREATE TRIGGER user_api_keys_updated_at
  BEFORE UPDATE ON user_api_keys
  FOR EACH ROW EXECUTE FUNCTION user_api_keys_touch_updated();

-- Comentarios documentando o esquema de criptografia
COMMENT ON TABLE user_api_keys IS
  'BYOK: chaves de IA por usuario. Colunas *_key contem AES-256-GCM ciphertext base64. lib/secrets.ts decifra usando SECRETS_ENCRYPTION_KEY do servidor.';
COMMENT ON COLUMN user_api_keys.anthropic_key IS
  'AES-256-GCM ciphertext base64. Layout: 12 bytes IV + 16 bytes tag + ciphertext.';
