-- 032_heygen_oauth_refresh.sql
-- OAuth do HeyGen — SÓ pro modo imagem (variante `image` do /v3/videos).
--
-- Por que uma coluna separada de heygen_key: são credenciais de TIERS DE
-- COBRANÇA diferentes, não dois jeitos de escrever a mesma coisa.
--   API key  -> "billed under the API tier": saldo USD à parte, top-up mín. $5.
--   OAuth    -> subscription credits: queima o crédito do plano, que já é pago.
-- O disparo normal (Pilot/Hey Auto) NÃO usa nenhuma das duas — ele vai pela
-- sessão do Chrome via extensão, e continua exatamente como está.
--
-- O modo imagem é o único caminho que não cabe na extensão: medido, a api2 não
-- tem endpoint de animar imagem (404) e o /v3 recusa cookie de sessão (401).
-- Então ele vai por OAuth, pra também sair do crédito do plano.
--
-- Guardamos o REFRESH token (não o access): o access vence em ~10 dias e o
-- refresh renova sozinho em https://api2.heygen.com/v1/oauth/token.

ALTER TABLE user_api_keys
  ADD COLUMN IF NOT EXISTS heygen_oauth_refresh text,
  ADD COLUMN IF NOT EXISTS heygen_oauth_last4 text;

COMMENT ON COLUMN user_api_keys.heygen_oauth_refresh IS
  'AES-256-GCM ciphertext base64. Refresh token OAuth do HeyGen (~/.heygen/credentials -> oauth.refresh_token). Usado SÓ pelo modo imagem, que cobra do crédito do plano — diferente de heygen_key, que cobra do tier de API.';
