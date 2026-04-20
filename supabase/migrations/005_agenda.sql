-- ==========================================================================
-- CASABLANCA - Agenda (tasks) schema
-- Roda DEPOIS de 004_portfolio_extras.sql.
--
-- Modelo mental:
--   Cada usuario tem uma lista de "tasks" que podem ser pontuais (ocorrem
--   uma vez) OU recorrentes (fixa diaria, semanal, quinzenal). Expansao das
--   ocorrencias recorrentes e feita no client a partir do template + status
--   historico gravado na tabela task_occurrences.
--
-- Tabelas:
--   agenda_tasks          -> template / registro canonico de uma tarefa
--   agenda_occurrences    -> status por data (on_time | delayed | refactor |
--                            pending | skipped) + completed_at
-- ==========================================================================

create table if not exists public.agenda_tasks (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  title           text not null,
  description     text,
  -- "low" | "normal" | "high" | "urgent" (ClickUp-style)
  urgency         text not null default 'normal',
  -- "once" | "daily" | "weekly" | "biweekly"
  recurrence      text not null default 'once',
  -- Data de referencia (para once: data unica; para recorrentes: data-base
  -- de calculo a partir da qual se expande).
  start_date      date not null,
  -- Opcional: horario estimado (HH:MM) pra mostrar no calendario.
  start_time      text,
  -- Duracao estimada em minutos (opcional, usada pro planner).
  duration_min    integer,
  -- Para recorrentes semanais/quinzenais: mascara de dias (0=dom..6=sab)
  -- ex: "1,3,5" pra seg/qua/sex. Se null + recurrence=daily, roda todo dia.
  weekdays        text,
  -- Data limite pra recorrencia parar (inclusive). Null = infinita.
  end_date        date,
  -- Cor custom (hex) opcional; senao derivamos da urgencia.
  color           text,
  -- Emitir push/notificacao do browser.
  notify          boolean not null default false,
  -- Minutos de antecedencia da notificacao.
  notify_offset   integer default 10,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_agenda_tasks_user
  on public.agenda_tasks (user_id, start_date);

alter table public.agenda_tasks enable row level security;

drop policy if exists "agenda_tasks owner read"   on public.agenda_tasks;
drop policy if exists "agenda_tasks owner insert" on public.agenda_tasks;
drop policy if exists "agenda_tasks owner update" on public.agenda_tasks;
drop policy if exists "agenda_tasks owner delete" on public.agenda_tasks;

create policy "agenda_tasks owner read"
  on public.agenda_tasks for select
  using (auth.uid() = user_id);

create policy "agenda_tasks owner insert"
  on public.agenda_tasks for insert
  with check (auth.uid() = user_id);

create policy "agenda_tasks owner update"
  on public.agenda_tasks for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "agenda_tasks owner delete"
  on public.agenda_tasks for delete
  using (auth.uid() = user_id);


-- ==========================================================================
-- agenda_occurrences
-- Status por DATA de uma tarefa (especialmente util pra recorrentes).
-- Uma row unica por (task_id, occurrence_date).
-- status:
--   'pending'  -> ainda nao marcada
--   'on_time'  -> completada no dia previsto
--   'delayed'  -> completada depois do previsto
--   'refactor' -> precisou refazer / requer atencao
--   'skipped'  -> usuario marcou que nao aconteceu
-- ==========================================================================

create table if not exists public.agenda_occurrences (
  id               uuid primary key default gen_random_uuid(),
  task_id          uuid not null references public.agenda_tasks(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,
  occurrence_date  date not null,
  status           text not null default 'pending',
  completed_at     timestamptz,
  note             text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (task_id, occurrence_date)
);

create index if not exists idx_agenda_occurrences_user_date
  on public.agenda_occurrences (user_id, occurrence_date);

alter table public.agenda_occurrences enable row level security;

drop policy if exists "agenda_occ owner read"   on public.agenda_occurrences;
drop policy if exists "agenda_occ owner insert" on public.agenda_occurrences;
drop policy if exists "agenda_occ owner update" on public.agenda_occurrences;
drop policy if exists "agenda_occ owner delete" on public.agenda_occurrences;

create policy "agenda_occ owner read"
  on public.agenda_occurrences for select
  using (auth.uid() = user_id);

create policy "agenda_occ owner insert"
  on public.agenda_occurrences for insert
  with check (auth.uid() = user_id);

create policy "agenda_occ owner update"
  on public.agenda_occurrences for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "agenda_occ owner delete"
  on public.agenda_occurrences for delete
  using (auth.uid() = user_id);
