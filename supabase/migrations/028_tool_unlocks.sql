-- 028_tool_unlocks.sql
-- ===============================================================
-- BETA PRO: desbloqueio de ferramentas ADMIN-ONLY por CONTA, gerenciado
-- pelo painel /admin (sem virar admin, sem novo deploy).
--
-- Antes, o desbloqueio pontual era só por EMAIL fixo em lib/tool-unlocks.ts
-- (hardcoded + env NEXT_PUBLIC_TOOL_UNLOCKS). Agora o admin marca as
-- ferramentas direto no painel e a lista persiste aqui.
--
-- profiles.tool_unlocks = array de paths de ferramenta liberados, ex.:
--   '{/tools/heygen-auto,/tools/clickup-pilot}'
--
-- SEGURANÇA (mesmo padrão da 027):
--   • Quem escreve é SEMPRE o service_role (/api/admin/set-tool-unlocks).
--   • REVOKE UPDATE da coluna pra anon/authenticated — usuário comum não
--     consegue se auto-liberar nem com a anon key + sessão logada.
--   • Leitura: o próprio user lê a própria linha (RLS existente) — é assim
--     que a UI client-side pinta os cards desbloqueados.
--
-- Idempotente. Rodar UMA VEZ no Supabase SQL Editor.
-- ===============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS tool_unlocks text[] NOT NULL DEFAULT '{}';

REVOKE UPDATE (tool_unlocks) ON public.profiles FROM anon, authenticated;

-- ============================================================
-- Verificação (deve retornar ZERO linhas com privilege_type='UPDATE'):
--   SELECT grantee, column_name, privilege_type
--     FROM information_schema.column_privileges
--    WHERE table_name = 'profiles'
--      AND grantee IN ('anon','authenticated')
--      AND column_name = 'tool_unlocks';
-- ============================================================

-- ROLLBACK (se algum dia precisar reverter — NÃO rode agora):
-- ALTER TABLE public.profiles DROP COLUMN IF EXISTS tool_unlocks;
