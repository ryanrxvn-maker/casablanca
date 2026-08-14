-- 029_otp_phone_index.sql
-- Índice pro teto de SMS por NÚMERO DE DESTINO (remediação do achado 3.3 do
-- pentest de 13/08/2026).
--
-- O /api/auth/sms/send-code passou a contar quantos códigos foram enviados
-- pra um telefone nas últimas 24h, e a olhar o último envio pra aquele número
-- (cooldown de 60s). Antes disso a tabela só tinha índice por profile_id e por
-- expires_at, então as duas consultas novas varriam a tabela inteira — e essa
-- tabela só cresce.
--
-- O índice é composto (phone, created_at DESC) porque as duas consultas filtram
-- por phone e ordenam/filtram por created_at: assim uma única estrutura serve
-- tanto pra contagem das 24h quanto pra buscar o envio mais recente.

CREATE INDEX IF NOT EXISTS phone_otp_phone_created_idx
  ON phone_otp_codes (phone, created_at DESC);
