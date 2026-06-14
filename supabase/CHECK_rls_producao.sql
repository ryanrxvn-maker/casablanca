-- ===============================================================
-- CHECK_rls_producao.sql  —  DIAGNÓSTICO SOMENTE LEITURA
-- Cole no Supabase → SQL Editor e rode. NÃO altera nada.
-- Confirma que o banco RODANDO está com RLS ligado nas tabelas sensíveis.
-- ===============================================================

-- 1) RLS ligado nas tabelas sensíveis?  (o que impede o "dump da tabela inteira")
--    Esperado: rls_ligado = true em TODAS. Qualquer 'false' = RISCO.
SELECT
  c.relname                          AS tabela,
  c.relrowsecurity                   AS rls_ligado,
  c.relforcerowsecurity              AS rls_forcado,
  CASE WHEN c.relrowsecurity THEN '✅ protegida'
       ELSE '🔴 EXPOSTA — qualquer um com a anon key lê tudo'
  END                                AS veredito
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relname IN (
    'profiles','user_api_keys','user_secrets','payments',
    'tier_changes','tool_events','phone_otp_codes'
  )
ORDER BY c.relrowsecurity ASC, c.relname;  -- as expostas (false) aparecem no topo

-- 2) Quais policies existem em cada tabela sensível?
--    Esperado: profiles/user_api_keys/user_secrets têm policy com
--    qual = (auth.uid() = id) ou (auth.uid() = user_id). Se aparecer
--    'true' sozinho no 'using_expr' de um SELECT = 🔴 todo mundo lê.
SELECT
  tablename                          AS tabela,
  policyname                         AS policy,
  cmd                                AS operacao,
  roles                              AS roles,
  qual                               AS using_expr,
  with_check                         AS check_expr
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'profiles','user_api_keys','user_secrets','payments',
    'tier_changes','tool_events','phone_otp_codes'
  )
ORDER BY tablename, cmd;

-- 3) Tabelas SEM RLS em todo o schema public (varredura geral).
--    Esperado: nenhuma tabela com dado de usuário aqui. Tabelas
--    100% públicas (ex.: conteúdo de site) podem aparecer e tudo bem.
SELECT c.relname AS tabela_sem_rls
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relrowsecurity = false
ORDER BY c.relname;

-- 4) (Rode DEPOIS de aplicar a migration 027) Confere que anon/authenticated
--    perderam o UPDATE nas colunas de privilégio. Esperado: ZERO linhas.
SELECT grantee, column_name, privilege_type
FROM information_schema.column_privileges
WHERE table_schema = 'public'
  AND table_name = 'profiles'
  AND grantee IN ('anon','authenticated')
  AND privilege_type = 'UPDATE'
  AND column_name IN (
    'is_admin','is_active','tier','stripe_customer_id',
    'stripe_subscription_id','subscription_status',
    'subscription_plan','current_period_end'
  )
ORDER BY grantee, column_name;
