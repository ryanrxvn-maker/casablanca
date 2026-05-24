-- Migration 020: tabela user_secrets pra Magnific.com cookie auth.
--
-- Diferente de user_api_keys (que guarda API keys de provedores oficiais),
-- aqui guardamos cookies de sessao web (Magnific nao tem API key publica).
-- Cookies sao longos (~1-2KB), rotacionam quando o user re-loga, e tem
-- escopo de sessao Laravel, nao um secret estavel.
--
-- Colunas *_cookie / *_xsrf_token: AES-256-GCM ciphertext base64
-- (mesmo esquema do lib/secrets.ts: 12 bytes IV + 16 bytes tag + ciphertext).

CREATE TABLE IF NOT EXISTS user_secrets (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Magnific.com session (Premium+/Pro freepik)
  magnific_cookie text,           -- ciphertext do cookie completo (laravel_session, XSRF-TOKEN, etc)
  magnific_xsrf_token text,       -- ciphertext do XSRF-TOKEN decodificado
  magnific_user_id bigint,        -- id numerico do user no Magnific (vem de /auth/verify)
  magnific_plan text,             -- "Premium+", "Pro", etc — pra exibir no UI
  magnific_updated_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE user_secrets ENABLE ROW LEVEL SECURITY;

-- Apenas o dono pode ler/escrever. Service role bypassa.
DROP POLICY IF EXISTS "user_secrets_owner" ON user_secrets;
CREATE POLICY "user_secrets_owner" ON user_secrets
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Trigger updated_at
CREATE OR REPLACE FUNCTION user_secrets_touch_updated()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS user_secrets_updated_at ON user_secrets;
CREATE TRIGGER user_secrets_updated_at
  BEFORE UPDATE ON user_secrets
  FOR EACH ROW EXECUTE FUNCTION user_secrets_touch_updated();

COMMENT ON TABLE user_secrets IS
  'Cookies de sessao web (Magnific etc). Colunas *_cookie / *_xsrf_token sao AES-256-GCM ciphertext base64. lib/secrets.ts decifra.';
COMMENT ON COLUMN user_secrets.magnific_cookie IS
  'AES-256-GCM ciphertext base64. Cookie completo do magnific.com (laravel_session, XSRF-TOKEN, etc).';
COMMENT ON COLUMN user_secrets.magnific_xsrf_token IS
  'AES-256-GCM ciphertext base64. XSRF-TOKEN decodificado (URI decoded), usado como header X-XSRF-TOKEN.';
COMMENT ON COLUMN user_secrets.magnific_user_id IS
  'ID numerico do user no Magnific (de /app/api/auth/verify). Usado em ?user_id={uid} de todos endpoints.';
