-- ==========================================================================
-- CASABLANCA - Profile upgrade
-- Roda DEPOIS de 005_agenda.sql.
--
-- Changelog resumido:
--   1. Portfolio agora e SEMPRE publico (removemos toggle portfolio_public).
--      A coluna fica, mas o default vira TRUE e todos perfis existentes
--      recebem TRUE.
--   2. Bucket "avatars" pra upload de foto de perfil (pelo usuario, do PC).
--   3. RPC get_public_profile_by_slug passa a nao exigir portfolio_public=true
--      pra achar o perfil (ja que todo portfolio e publico).
-- ==========================================================================

-- 1) Portfolio sempre publico
alter table public.profiles
  alter column portfolio_public set default true;

update public.profiles
set portfolio_public = true
where portfolio_public is distinct from true;

-- Reescreve is_public_profile pra sempre retornar true (evitando precisar
-- alterar mil policies). Mantem a assinatura pra nao quebrar migracao.
create or replace function public.is_public_profile(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = uid);
$$;

-- Reescreve get_public_profile_by_slug pra nao filtrar por portfolio_public.
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
    coalesce(portfolio_public, true)       as portfolio_public,
    whatsapp,
    coalesce(portfolio_show_avatar, true)  as portfolio_show_avatar,
    coalesce(portfolio_cover, 'default')   as portfolio_cover
  from public.profiles
  where portfolio_slug = s
  limit 1;
$$;

revoke all on function public.get_public_profile_by_slug(text) from public;
grant execute on function public.get_public_profile_by_slug(text) to anon, authenticated;

-- 2) Bucket "avatars" (fotos de perfil)
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists "public read avatars"    on storage.objects;
drop policy if exists "own upload avatars"     on storage.objects;
drop policy if exists "own update avatars"     on storage.objects;
drop policy if exists "own delete avatars"     on storage.objects;

create policy "public read avatars" on storage.objects
  for select using (bucket_id = 'avatars');

create policy "own upload avatars" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "own update avatars" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "own delete avatars" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- 3) Trigger pra novos usuarios ja virem com portfolio publico.
-- Reaproveitamos handle_new_user de 001_init.sql atualizando-a.
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
    true
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
