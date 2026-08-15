-- 031: preferências POR CONTA das ferramentas (1ª: favoritos da Tipografia).
-- Cada usuário enxerga e mexe SÓ na própria linha (RLS estrita).

create table if not exists public.user_tool_prefs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  tipografia_favs jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_tool_prefs enable row level security;

drop policy if exists "user_tool_prefs_select_own" on public.user_tool_prefs;
create policy "user_tool_prefs_select_own" on public.user_tool_prefs
  for select using (auth.uid() = user_id);

drop policy if exists "user_tool_prefs_insert_own" on public.user_tool_prefs;
create policy "user_tool_prefs_insert_own" on public.user_tool_prefs
  for insert with check (auth.uid() = user_id);

drop policy if exists "user_tool_prefs_update_own" on public.user_tool_prefs;
create policy "user_tool_prefs_update_own" on public.user_tool_prefs
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

revoke all on public.user_tool_prefs from anon;
grant select, insert, update on public.user_tool_prefs to authenticated;
