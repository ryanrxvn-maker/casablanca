-- 012_heygen_replicate_keys.sql
-- Adiciona suporte BYOK pra HeyGen e Replicate (Mind Ads Suite).

ALTER TABLE user_api_keys
  ADD COLUMN IF NOT EXISTS heygen_key text,
  ADD COLUMN IF NOT EXISTS heygen_last4 text,
  ADD COLUMN IF NOT EXISTS replicate_key text,
  ADD COLUMN IF NOT EXISTS replicate_last4 text;

COMMENT ON COLUMN user_api_keys.heygen_key IS
  'AES-256-GCM ciphertext base64. Mind Ads Suite usa pra avatares.';
COMMENT ON COLUMN user_api_keys.replicate_key IS
  'AES-256-GCM ciphertext base64. Replicate API token (Nano Banana Pro + Wan 2.1).';
