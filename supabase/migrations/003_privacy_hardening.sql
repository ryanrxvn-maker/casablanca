-- ==========================================================================
-- CASABLANCA — Privacy hardening
-- Roda DEPOIS de 001_init.sql e 002_storage.sql.
--
-- Motivo: a policy `public profile read` original permitia que qualquer anon
-- fizesse SELECT em TODAS as colunas da tabela profiles (incluindo `email`)
-- para perfis com portfolio_public = true. Um atacante que achasse um slug
-- publico poderia puxar o email do dono via REST direto.
--
-- Esta migration substitui aquela policy por duas funcoes SECURITY DEFINER:
--   1) get_public_profile_by_slug(s) — devolve apenas as colunas seguras
--      (sem email) para o perfil daquele slug, se for publico.
--   2) is_public_profile(uid) — helper usado pelas policies de items/cats/
--      proofs pra checar se o dono eh publico, sem depender da policy de
--      SELECT em profiles.
-- ==========================================================================

-- 1) Helper: retorna true se o user_id pertence a um perfil publico.
create or replace function public.is_public_profile(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = uid and portfolio_public = true
  );
$$;

revoke all on function public.is_public_profile(uuid) from public;
grant execute on function public.is_public_profile(uuid) to anon, authenticated;

-- 2) Leitura publica do profile por slug: SO as colunas seguras. Sem email.
create or replace function public.get_public_profile_by_slug(s text)
returns table (
  id                uuid,
  name              text,
  avatar_url        text,
  portfolio_slug    text,
  portfolio_public  boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select id, name, avatar_url, portfolio_slug, portfolio_public
  from public.profiles
  where portfolio_slug = s and portfolio_public = true
  limit 1;
$$;

revoke all on function public.get_public_profile_by_slug(text) from public;
grant execute on function public.get_public_profile_by_slug(text) to anon, authenticated;

-- 3) Derruba a policy ampla que vazava email.
drop policy if exists "public profile read" on public.profiles;

-- 4) Reescreve as policies de items/cats/proofs pra usar a funcao helper,
--    em vez de fazer EXISTS em profiles (que agora nao eh mais lido por anon).
drop policy if exists "public items" on public.portfolio_items;
create policy "public items" on public.portfolio_items
  for select using (public.is_public_profile(user_id));

drop policy if exists "public cats" on public.portfolio_categories;
create policy "public cats" on public.portfolio_categories
  for select using (public.is_public_profile(user_id));

drop policy if exists "public proofs" on public.social_proofs;
create policy "public proofs" on public.social_proofs
  for select using (public.is_public_profile(user_id));

-- ==========================================================================
-- Verificacao manual (opcional):
--   select * from public.get_public_profile_by_slug('seu-slug');
--   -- Deve retornar 1 row sem a coluna email.
--
--   set role anon;
--   select email from public.profiles where portfolio_public = true;
--   -- Deve retornar 0 rows (a policy "public profile read" foi removida).
--   reset role;
-- ==========================================================================
