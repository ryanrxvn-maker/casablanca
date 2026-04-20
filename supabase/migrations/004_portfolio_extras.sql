-- ==========================================================================
-- CASABLANCA — Portfolio extras
-- Roda DEPOIS de 003_privacy_hardening.sql.
--
-- Adiciona campos opcionais no profile usados pela pagina publica /p/[slug]:
--   - whatsapp               : numero em formato E.164 (ex: +5511999998888)
--                              ou link wa.me completo. Se preenchido, renderiza
--                              botao flutuante de WhatsApp no portfolio publico.
--   - portfolio_show_avatar  : se deve exibir a foto do perfil no publico.
--   - portfolio_cover        : identificador da capa (default | matrix |
--                              dollars | tech | minimal). Apenas um hint visual
--                              consumido pelo front-end.
-- ==========================================================================

alter table public.profiles
  add column if not exists whatsapp text,
  add column if not exists portfolio_show_avatar boolean default true,
  add column if not exists portfolio_cover text default 'default';

-- Reescreve a RPC de leitura publica pra expor os novos campos (continuando
-- a NAO expor o email).
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
    coalesce(portfolio_show_avatar, true) as portfolio_show_avatar,
    coalesce(portfolio_cover, 'default')  as portfolio_cover
  from public.profiles
  where portfolio_slug = s and portfolio_public = true
  limit 1;
$$;

revoke all on function public.get_public_profile_by_slug(text) from public;
grant execute on function public.get_public_profile_by_slug(text) to anon, authenticated;
