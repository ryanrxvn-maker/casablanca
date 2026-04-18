-- ==========================================================================
-- CASABLANCA — schema inicial
-- Rode este script no SQL Editor do Supabase: https://supabase.com/dashboard
-- ==========================================================================

-- ---------- Profiles ------------------------------------------------------
create table if not exists public.profiles (
  id                uuid references auth.users on delete cascade primary key,
  name              text,
  email             text,
  avatar_url        text,
  portfolio_slug    text unique,
  portfolio_public  boolean default false,
  created_at        timestamptz default now()
);

-- ---------- Portfolio items -----------------------------------------------
create table if not exists public.portfolio_items (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid references public.profiles(id) on delete cascade,
  title          text not null,
  category       text not null,       -- 'Microleads', 'Ads', ou nicho customizado
  niche          text,
  video_url      text,
  thumbnail_url  text,
  "order"        integer default 0,
  created_at     timestamptz default now()
);

create index if not exists idx_portfolio_items_user on public.portfolio_items(user_id);
create index if not exists idx_portfolio_items_cat  on public.portfolio_items(user_id, category);

-- ---------- Portfolio categories ------------------------------------------
create table if not exists public.portfolio_categories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references public.profiles(id) on delete cascade,
  name        text not null,
  type        text not null,         -- 'microleads' | 'ads' | 'custom'
  created_at  timestamptz default now()
);

-- ---------- Social proofs -------------------------------------------------
create table if not exists public.social_proofs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references public.profiles(id) on delete cascade,
  image_url   text not null,
  caption     text,
  created_at  timestamptz default now()
);

-- ==========================================================================
-- RLS — Row Level Security
-- ==========================================================================
alter table public.profiles             enable row level security;
alter table public.portfolio_items      enable row level security;
alter table public.portfolio_categories enable row level security;
alter table public.social_proofs        enable row level security;

-- Profiles ------------------------------------------------------------------
drop policy if exists "own profile read"      on public.profiles;
drop policy if exists "own profile write"     on public.profiles;
drop policy if exists "public profile read"   on public.profiles;

create policy "own profile read" on public.profiles
  for select using (auth.uid() = id);

create policy "own profile write" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

-- Anyone can read profiles marked as public (usado em /p/[slug])
create policy "public profile read" on public.profiles
  for select using (portfolio_public = true);

-- Portfolio items -----------------------------------------------------------
drop policy if exists "own items"     on public.portfolio_items;
drop policy if exists "public items"  on public.portfolio_items;

create policy "own items" on public.portfolio_items
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "public items" on public.portfolio_items
  for select using (
    exists (
      select 1 from public.profiles p
      where p.id = portfolio_items.user_id and p.portfolio_public = true
    )
  );

-- Portfolio categories ------------------------------------------------------
drop policy if exists "own cats"    on public.portfolio_categories;
drop policy if exists "public cats" on public.portfolio_categories;

create policy "own cats" on public.portfolio_categories
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "public cats" on public.portfolio_categories
  for select using (
    exists (
      select 1 from public.profiles p
      where p.id = portfolio_categories.user_id and p.portfolio_public = true
    )
  );

-- Social proofs -------------------------------------------------------------
drop policy if exists "own proofs"    on public.social_proofs;
drop policy if exists "public proofs" on public.social_proofs;

create policy "own proofs" on public.social_proofs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "public proofs" on public.social_proofs
  for select using (
    exists (
      select 1 from public.profiles p
      where p.id = social_proofs.user_id and p.portfolio_public = true
    )
  );

-- ==========================================================================
-- Trigger — cria profile automaticamente quando um usuário é criado
-- ==========================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
