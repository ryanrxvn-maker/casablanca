-- 034: TEMPLATES de legenda da Tipografia por conta (hook × body com
-- letterings diferentes, salvos ao lado dos ⭐ Favoritos).
-- Mesma linha de user_tool_prefs — tabela e RLS vêm da 031.
-- Idempotente: pode rodar quantas vezes quiser.

alter table public.user_tool_prefs
  add column if not exists tipografia_templates jsonb not null default '[]'::jsonb;
