-- A removed ClickUp task id is reusable by a deliberate NEW execution.
-- Ordinary/stale checkpoints still use save_durable_record (or p_revive=false)
-- and can never resurrect a tombstone.
create or replace function public.save_durable_record_v2(
  p_kind text, p_id text, p_payload jsonb, p_revision bigint, p_operation uuid, p_revive boolean
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
     or p_revision < 0 or p_revision is null or p_operation is null or p_revive is null
     or (p_payload is not null and jsonb_typeof(p_payload) <> 'object')
     or octet_length(p_payload::text) > 2000000 then raise exception 'invalid record'; end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text || ':' || p_kind || ':' || p_id, 0));
  select r.result into receipt from public.durable_record_receipts r
    where r.user_id = uid and r.operation_id = p_operation;
  if receipt is not null then
    select * into cur from public.durable_records
      where user_id = uid and kind = receipt->>'kind' and record_id = receipt->>'id';
    return jsonb_build_object('conflict', cur.revision is distinct from (receipt->>'revision')::bigint, 'record', to_jsonb(cur));
  end if;
  select * into cur from public.durable_records
    where user_id = uid and kind = p_kind and record_id = p_id for update;
  if coalesce(cur.revision, 0) <> p_revision then
    return jsonb_build_object('conflict', true, 'record', to_jsonb(cur));
  end if;
  -- Reanimation is deliberately narrower than an ordinary update: background
  -- only, exact task identity, and a numeric execution timestamp.
  if cur.deleted and p_payload is not null and (
       not p_revive or p_kind <> 'background' or p_payload->>'taskId' is distinct from p_id
       or jsonb_typeof(p_payload->'startedAt') is distinct from 'number'
     ) then
    return jsonb_build_object('conflict', true, 'record', to_jsonb(cur));
  end if;
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
  occurred := case when cur.deleted and p_payload is not null and p_revive then now()
                   else coalesce(cur.occurred_at, now()) end;
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
      deleted = excluded.deleted, occurred_at = excluded.occurred_at, updated_at = now()
    returning * into cur;
  result := jsonb_build_object('conflict', false, 'record', to_jsonb(cur));
  insert into public.durable_record_receipts(user_id, operation_id, result)
    values(uid, p_operation, jsonb_build_object('kind', p_kind, 'id', p_id, 'revision', cur.revision));
  return result;
end $$;
revoke all on function public.save_durable_record_v2(text,text,jsonb,bigint,uuid,boolean) from public, anon;
grant execute on function public.save_durable_record_v2(text,text,jsonb,bigint,uuid,boolean) to authenticated;
