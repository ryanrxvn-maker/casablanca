-- 027_privilege_columns_revoke.sql
-- ===============================================================
-- DEFESA-EM-PROFUNDIDADE: tira o privilégio de UPDATE das colunas de
-- PRIVILÉGIO da profiles dos roles públicos (anon/authenticated).
--
-- POR QUÊ
-- Hoje, o que impede um usuário comum de rodar
--     UPDATE profiles SET is_admin=true WHERE id = auth.uid()
-- (uma chamada REST com a anon key + sessão logada) é APENAS o trigger
-- enforce_admin_columns / enforce_tier_column. É uma única camada: se o
-- trigger for removido/desabilitado por acidente, vira auto-promoção a admin
-- ou tier Pro de graça.
--
-- Esta migration adiciona uma SEGUNDA camada no nível de PRIVILÉGIO da coluna:
-- mesmo que o trigger saia, o Postgres recusa a escrita dessas colunas pelos
-- roles públicos. Quem escreve essas colunas legitimamente é SEMPRE o
-- service_role (webhook do Stripe, /api/admin/set-tier, toggle-user) — e o
-- service_role tem BYPASSRLS + é superusuário lógico, NÃO é afetado por REVOKE
-- de coluna em anon/authenticated.
--
-- SEGURANÇA DESTA MIGRATION (por que NÃO quebra nada)
--   • As colunas abaixo NUNCA são escritas pelo cliente autenticado:
--       - is_admin/is_active/tier  → só service_role (admin routes) e os
--         triggers já barram o cliente hoje.
--       - stripe_*/subscription_*/current_period_end → só o webhook
--         (service_role).
--   • must_change_password NÃO está na lista de propósito: o
--     /api/user/clear-password-flag escreve essa coluna como usuário
--     AUTENTICADO — revogar quebraria a troca de senha. Mantido escrevível.
--   • name/phone/avatar e demais campos do perfil seguem escrevíveis
--     (REVOKE é por coluna, só nas colunas listadas).
--
-- Idempotente (REVOKE repetido é no-op). Reversível: ver bloco de rollback
-- comentado no fim.
-- Rodar UMA VEZ no Supabase SQL Editor.
-- ===============================================================

REVOKE UPDATE (
  is_admin,
  is_active,
  tier,
  stripe_customer_id,
  stripe_subscription_id,
  subscription_status,
  subscription_plan,
  current_period_end
) ON public.profiles FROM anon, authenticated;

-- ============================================================
-- Verificação (rode depois — deve listar as colunas SEM 'UPDATE'
-- para authenticated):
--   SELECT grantee, column_name, privilege_type
--     FROM information_schema.column_privileges
--    WHERE table_name = 'profiles'
--      AND grantee IN ('anon','authenticated')
--      AND column_name IN ('is_admin','tier','stripe_customer_id')
--    ORDER BY grantee, column_name;
--   Esperado: NENHUMA linha com privilege_type='UPDATE' nessas colunas.
-- ============================================================

-- ROLLBACK (se algum dia precisar reverter — NÃO rode agora):
-- GRANT UPDATE (
--   is_admin, is_active, tier, stripe_customer_id, stripe_subscription_id,
--   subscription_status, subscription_plan, current_period_end
-- ) ON public.profiles TO authenticated;
