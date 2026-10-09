-- 038: AVISOS E PROPAGANDAS (central de avisos do /admin + sino de notificações).
--
-- announcements       → o que o admin cria (template "aviso" pequeno ou
--                       "propaganda" grande), pra quem vai (audiência) e se está
--                       no ar. Ativar grava activated_at: quem já estava logado
--                       recebe na próxima sincronização; quem entra depois recebe
--                       no login.
-- announcement_inbox  → a caixa de cada conta: quando chegou, quando leu, quando
--                       fechou a janela (e em QUAIS sessões de login), clique no
--                       botão e se apagou do histórico. A janela volta a abrir
--                       enquanto o aviso estiver no ar a cada LOGIN NOVO (sessão
--                       diferente da que fechou) ou quando o admin reativa.
--
-- Tudo passa pelas rotas /api/admin/announcements e /api/user/notifications
-- com a service role: nenhum papel do navegador (anon/authenticated) lê ou
-- escreve aqui direto. RLS ligada e sem política = fechado por padrão.
--
-- Idempotente: pode rodar de novo sem quebrar nada.

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('aviso', 'propaganda')),
  content jsonb not null default '{}'::jsonb,
  audience jsonb not null default '{"segments":["all"],"emails":[],"includeAdmins":false}'::jsonb,
  popup boolean not null default true,
  active boolean not null default false,
  activated_at timestamptz,
  ends_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint announcements_content_object check (jsonb_typeof(content) = 'object'),
  constraint announcements_audience_object check (jsonb_typeof(audience) = 'object'),
  constraint announcements_content_size check (octet_length(content::text) <= 16000),
  constraint announcements_audience_size check (octet_length(audience::text) <= 64000)
);

create index if not exists announcements_active_idx
  on public.announcements (active, activated_at desc);

create table if not exists public.announcement_inbox (
  user_id uuid not null references auth.users(id) on delete cascade,
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  delivered_at timestamptz not null default now(),
  read_at timestamptz,
  dismissed_at timestamptz,
  -- Uma chave por janela fechada: "<sessão de login>:<activated_at>". Sessão
  -- nova (login de novo) ou reativação geram chave nova → a janela volta.
  -- Lista (e não só a última) pra dois aparelhos logados não ficarem
  -- reabrindo a janela um do outro.
  dismissed_keys text[] not null default '{}'::text[]
    check (coalesce(array_length(dismissed_keys, 1), 0) <= 24),
  clicked_at timestamptz,
  deleted_at timestamptz,
  primary key (user_id, announcement_id)
);

create index if not exists announcement_inbox_announcement_idx
  on public.announcement_inbox (announcement_id);
create index if not exists announcement_inbox_user_delivered_idx
  on public.announcement_inbox (user_id, delivered_at desc);

alter table public.announcements enable row level security;
alter table public.announcement_inbox enable row level security;
revoke all on public.announcements from anon, authenticated;
revoke all on public.announcement_inbox from anon, authenticated;
grant all on public.announcements to service_role;
grant all on public.announcement_inbox to service_role;

-- Números de cada aviso pro painel (entregues, lidos, cliques, fechados,
-- apagados) numa consulta só, sem o teto de 1000 linhas da API.
create or replace function public.announcement_stats()
returns table (
  announcement_id uuid,
  delivered bigint,
  read bigint,
  clicked bigint,
  dismissed bigint,
  deleted bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    i.announcement_id,
    count(*)::bigint,
    count(i.read_at)::bigint,
    count(i.clicked_at)::bigint,
    count(i.dismissed_at)::bigint,
    count(i.deleted_at)::bigint
  from public.announcement_inbox i
  group by i.announcement_id
$$;

revoke all on function public.announcement_stats() from public, anon, authenticated;
grant execute on function public.announcement_stats() to service_role;
