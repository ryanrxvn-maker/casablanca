-- 025_security_hardening.sql
-- Corrige os achados do Security Advisor do Supabase.

-- ============================================================
-- CRÍTICO 1 — Re-ligar RLS na profiles
-- ============================================================
-- O RLS foi DESLIGADO manualmente em algum momento (não há migration que
-- faça isso). Sem RLS, a profiles fica exposta pela anon key.
--
-- As policies antigas (009) faziam subquery na própria profiles
-- (EXISTS ... FROM profiles) → causa "infinite recursion detected in policy"
-- quando RLS está ligado (provável motivo do disable). Solução: policies
-- SELF-ONLY (auth.uid() = id), sem recursão. O ADMIN não precisa de policy:
-- todo acesso admin (dashboard, list-users, set-tier, middleware) usa
-- SERVICE ROLE, que bypassa RLS.

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_self_or_admin" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_self_or_admin" ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_self" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_self" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert_self" ON public.profiles;

CREATE POLICY "profiles_select_self" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "profiles_insert_self" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "profiles_update_self" ON public.profiles
  FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- ============================================================
-- CRÍTICO 2 — Remover view que expõe auth.users
-- ============================================================
-- admin_accounts_view junta auth.users + profiles, é SECURITY DEFINER e está
-- exposta ao PostgREST. Não é referenciada pelo app (admin usa service role
-- + auth.admin.listUsers). Removida.
DROP VIEW IF EXISTS public.admin_accounts_view CASCADE;

-- ============================================================
-- HARDENING — fixar search_path em todas as funções SECURITY DEFINER
-- ============================================================
-- Corrige "Function Search Path Mutable". Pin em 'public' mantém referências
-- não-qualificadas (ex: profiles) funcionando (pg_catalog é implícito),
-- mas impede injeção via manipulação de search_path.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT n.nspname AS schema, p.proname AS name,
           pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef = true
  LOOP
    EXECUTE format(
      'ALTER FUNCTION %I.%I(%s) SET search_path = public',
      r.schema, r.name, r.args
    );
  END LOOP;
END $$;
