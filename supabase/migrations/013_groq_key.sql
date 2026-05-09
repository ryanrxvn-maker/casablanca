-- Migration 013: adiciona Groq key ao BYOK.
-- Groq Whisper-large-v3 e ~11x mais barato que AssemblyAI ($0.04/h vs $0.45/h)
-- e mais rapido. Usado como default no Mind Ads tier eco/padrao.

alter table user_api_keys
  add column if not exists groq_key text,
  add column if not exists groq_last4 text;

-- Comentario pra documentacao
comment on column user_api_keys.groq_key is 'Groq API key cifrada (AES-256-GCM). Usada por Whisper transcription.';
comment on column user_api_keys.groq_last4 is 'Ultimos 4 caracteres da Groq key pra exibicao no UI.';
