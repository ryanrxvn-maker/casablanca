-- Background has NO TTL. Only an authenticated, explicit tombstone removes it.
-- History expires after seven days independently of the background registry.
create table if not exists public.durable_records (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('background','history')),
  record_id text not null check (length(record_id) between 1 and 240),
  payload jsonb,
  revision bigint not null default 1,
  operation_id uuid not null,
  deleted boolean not null default false,
  occurred_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, kind, record_id),
  check (deleted or jsonb_typeof(payload) = 'object')
);
alter table public.durable_records enable row level security;
drop policy if exists durable_records_own_read on public.durable_records;
create policy durable_records_own_read on public.durable_records
  for select to authenticated using (auth.uid() = user_id);
revoke all on public.durable_records from anon, authenticated;
grant select on public.durable_records to authenticated;

-- A receipt makes retry after a lost HTTP response idempotent, even if another
-- operation has already updated the record. Contains metadata, never media bytes.
create table if not exists public.durable_record_receipts (
  user_id uuid not null references auth.users(id) on delete cascade,
  operation_id uuid not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key(user_id, operation_id)
);
alter table public.durable_record_receipts enable row level security;
revoke all on public.durable_record_receipts from anon, authenticated;

create or replace function public.save_durable_record(
  p_kind text, p_id text, p_payload jsonb, p_revision bigint, p_operation uuid
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
  cur public.durable_records;
  receipt jsonb;
  result jsonb;
  occurred timestamptz;
  archive_id text;
  archive_data jsonb;
begin
  if uid is null then raise exception 'authentication required'; end if;
  if p_kind is null or p_id is null or p_kind not in ('background','history') or length(p_id) not between 1 and 240
     or p_revision < 0 or p_revision is null or p_operation is null
     or (p_payload is not null and jsonb_typeof(p_payload) <> 'object')
     or octet_length(p_payload::text) > 2000000 then raise exception 'invalid record'; end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text || ':' || p_kind || ':' || p_id, 0));
  select r.result into receipt from public.durable_record_receipts r
    where r.user_id = uid and r.operation_id = p_operation;
  if receipt is not null then
    select * into cur from public.durable_records
      where user_id = uid and kind = receipt->>'kind' and record_id = receipt->>'id';
    -- Compact receipts avoid duplicating entire plans at every progress update.
    -- A newer checkpoint is returned as a conflict, never acknowledged as this
    -- old write; the client then merges rather than replaying the operation.
    return jsonb_build_object('conflict', cur.revision is distinct from (receipt->>'revision')::bigint, 'record', to_jsonb(cur));
  end if;
  select * into cur from public.durable_records
    where user_id = uid and kind = p_kind and record_id = p_id for update;
  if coalesce(cur.revision, 0) <> p_revision then
    return jsonb_build_object('conflict', true, 'record', to_jsonb(cur));
  end if;
  -- Tombstones cannot be resurrected by a stale tab, import, or delayed retry.
  if cur.deleted and p_payload is not null then
    return jsonb_build_object('conflict', true, 'record', to_jsonb(cur));
  end if;
  -- Restarting a task creates a new execution. Preserve the preceding execution
  -- as a separate, read-only background row rather than replacing its history.
  if p_kind = 'background' and cur.payload is not null and p_payload is not null
     and cur.payload->>'startedAt' is distinct from p_payload->>'startedAt' then
    archive_id := 'archive:' || md5(p_id || ':' || cur.revision::text);
    archive_data := (cur.payload - 'zipFilename' - 'montadoZipName' - 'camufladoZipName') || jsonb_build_object(
      'taskId', archive_id, 'originalTaskId', p_id, 'archivedExecution', true,
      'phase', case when cur.payload->>'phase' = 'done' then 'done' else 'failed' end,
      'message', 'Execução anterior preservada. Registro com IDs dos vídeos; os arquivos são verificados separadamente.');
    insert into public.durable_records(user_id, kind, record_id, payload, operation_id, occurred_at)
      values(uid, 'background', archive_id, archive_data, p_operation, cur.occurred_at)
      on conflict(user_id, kind, record_id) do nothing;
  end if;
  occurred := coalesce(cur.occurred_at, now());
  if p_kind = 'history' and cur.payload is not null and p_payload is not null
     and cur.payload->>'t' is distinct from p_payload->>'t' then
    raise exception 'history event time is immutable';
  end if;
  if cur.record_id is null and p_kind = 'history' and p_payload is not null then
    occurred := to_timestamp((p_payload->>'t')::double precision / 1000);
    if occurred > now() + interval '1 minute' or occurred <= now() - interval '7 days' then
      raise exception 'history outside retention';
    end if;
  end if;
  insert into public.durable_records(user_id, kind, record_id, payload, revision, operation_id, deleted, occurred_at)
    values(uid, p_kind, p_id, p_payload, coalesce(cur.revision, 0) + 1, p_operation, p_payload is null, occurred)
    on conflict(user_id, kind, record_id) do update set
      payload = excluded.payload, revision = excluded.revision, operation_id = excluded.operation_id,
      deleted = excluded.deleted, updated_at = now()
    returning * into cur;
  result := jsonb_build_object('conflict', false, 'record', to_jsonb(cur));
  insert into public.durable_record_receipts(user_id, operation_id, result)
    values(uid, p_operation, jsonb_build_object('kind', p_kind, 'id', p_id, 'revision', cur.revision));
  return result;
end $$;
revoke all on function public.save_durable_record(text,text,jsonb,bigint,uuid) from public, anon;
grant execute on function public.save_durable_record(text,text,jsonb,bigint,uuid) to authenticated;

-- Expired history is inaccessible immediately, even if scheduled cleanup is late.
drop policy if exists durable_records_own_read on public.durable_records;
create policy durable_records_own_read on public.durable_records for select to authenticated
  using (auth.uid() = user_id and (kind = 'background' or occurred_at > now() - interval '7 days'));
create index if not exists durable_records_history_expiry on public.durable_records(occurred_at) where kind = 'history';
-- Run daily through the authenticated deployment/maintenance scheduler.
create or replace function public.prune_durable_history() returns void
language sql security definer set search_path = public, pg_temp as $$
  delete from public.durable_records where kind = 'history' and occurred_at <= now() - interval '7 days';
  delete from public.durable_record_receipts where created_at <= now() - interval '7 days';
$$;
revoke all on function public.prune_durable_history() from public, anon, authenticated;
grant execute on function public.prune_durable_history() to service_role;
