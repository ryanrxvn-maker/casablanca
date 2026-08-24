-- 033: padrões do Auto Cortes por conta (botão "Salvar como padrão" do passo 2).
-- Guarda o objeto de ajustes (proporção, duração, quantidade, gênero, idioma,
-- legenda + ritmo, headline + duração, reenquadro) na MESMA linha de
-- user_tool_prefs — a tabela e as políticas de RLS vêm da 031.
-- Idempotente: pode rodar quantas vezes quiser.

alter table public.user_tool_prefs
  add column if not exists auto_cortes_defaults jsonb not null default '{}'::jsonb;
