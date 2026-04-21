-- ==========================================================================
-- DARKO LAB — Visibility rework + branding pass
-- Roda DEPOIS de 006_profile_upgrade.sql.
--
-- Changelog:
--   1. Portfolio volta a ter toggle PUBLIC/PRIVATE real.
--      Quando privado, /p/[slug] retorna 404 (RPC nao devolve linha).
--      Novos cadastros comecam PRIVADO (precisa soltar explicitamente).
--   2. portfolio_show_avatar e portfolio_cover somem da UI — a gente
--      normaliza todos os perfis pra show_avatar=true e cover='default'.
--      As colunas ficam (por retrocompat) mas nao sao mais lidas no UI.
--   3. Reforco em handle_new_user: portfolio_public default FALSE.
--   4. NOTIFY pgrst pra forcar reload do schema cache do Supabase
--      (ajuda quem tinha cache stale de migrations anteriores).
-- ==========================================================================

-- 1) Normalize campos descontinuados (mantem coluna, so fixa valor).
update public.profiles
set portfolio_show_avatar = true
where portfolio_show_avatar is distinct from true;

update public.profiles
set portfolio_cover = 'default'
where portfolio_cover is distinct from 'default' or portfolio_cover is null;

-- 2) Ajusta default pra novos perfis: portfolio_public FALSE.
--    User controla quando publicar.
alter table public.profiles
  alter column portfolio_public set default false;

-- Preserva os perfis existentes: quem ja usava com 006 (portfolio_public=true)
-- fica publico. Ninguem vira privado contra a propria vontade.

-- 3) RPC get_public_profile_by_slug volta a filtrar por portfolio_public=true.
--    Perfil privado → 404 publico.
create or replace function public.get_public_profile_by_slug(s text)
returns table (
  id                     uuid,
  name                   text,
  avatar_url             text,
  portfolio_slug         text,
  portfolio_public       boolean,
  whatsapp               text,
  portfolio_show_avatar  boolean,
  portfolio_cover        text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    id,
    name,
    avatar_url,
    portfolio_slug,
    portfolio_public,
    whatsapp,
    true                                 as portfolio_show_avatar,
    coalesce(portfolio_cover, 'default') as portfolio_cover
  from public.profiles
  where portfolio_slug = s
    and coalesce(portfolio_public, false) = true
  limit 1;
$$;

revoke all on function public.get_public_profile_by_slug(text) from public;
grant execute on function public.get_public_profile_by_slug(text) to anon, authenticated;

-- 4) is_public_profile volta a depender de portfolio_public.
create or replace function public.is_public_profile(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select portfolio_public from public.profiles where id = uid),
    false
  );
$$;

-- 5) Trigger de novo usuario: default portfolio_public=false.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, name, portfolio_public)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    false
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- 6) Forca reload do PostgREST schema cache.
--    Resolve "Could not find the table 'public.agenda_tasks' in the schema cache"
--    pra quem rodou as migrations mas ainda via erro stale.
notify pgrst, 'reload schema';
