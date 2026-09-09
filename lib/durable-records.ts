'use client';

import { checkpoint, encode, inRetention, isObject, mergeRecord, type RecordData, type RecordKind } from './durable-records-core';

export const RECORDS_EVENT = 'autoedit:durable-records';
const ROOT = 'autoedit:records:v2:';
const LEGACY = { background: 'darkolab:clickup-pilot:batches', history: 'autoedit:history:v1' };
type CloudRow = { kind: RecordKind; record_id: string; payload: RecordData | null; deleted: boolean; revision: number };
type LocalRow = { kind: RecordKind; id: string; data: RecordData | null; base: RecordData | null; revision: number; pending?: string; recovery?: RecordData | null; conflict?: boolean };
export type DurabilityStatus = { ready: boolean; message: string; pending: number; conflicts: number; legacy: number; error: boolean };
let owner: string | null = null;
let status: DurabilityStatus = { ready: false, message: 'Recuperando os registros da conta…', pending: 0, conflicts: 0, legacy: 0, error: false };
let initialization: Promise<void> | null = null;
let syncing: Promise<void> | null = null;
// Uma gravação pode chegar enquanto o POST anterior está em voo. Nesse caso o
// novo snapshot não pertence à lista `pending` já capturada; marque uma segunda
// passagem para ele não ficar parado até o timer global de 15 segundos.
let syncAgain = false;
let pulling: Promise<void> | null = null;
let initError = '';
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const keyFor = (kind: RecordKind, id: string) => `${ROOT}${owner}:${kind}:${encodeURIComponent(id)}`;

export function durabilityStatus(): DurabilityStatus { return { ...status }; }
function notify(message?: string, error = false) {
  if (message !== undefined) { status.message = message; status.error = error; }
  window.dispatchEvent(new CustomEvent(RECORDS_EVENT));
  window.dispatchEvent(new CustomEvent('autoedit:history'));
}
function readLocal(): LocalRow[] {
  if (!owner) return [];
  const prefix = `${ROOT}${owner}:`;
  const rows: LocalRow[] = [];
  for (let n = 0; n < localStorage.length; n++) {
    const key = localStorage.key(n);
    if (!key?.startsWith(prefix)) continue;
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (!isObject(parsed) || !['background', 'history'].includes(String(parsed.kind)) || typeof parsed.id !== 'string') {
      throw new Error('Uma cópia local está danificada. Ela foi preservada; o salvamento não vai sobrescrevê-la.');
    }
    rows.push(parsed as LocalRow);
  }
  return rows;
}
function saveLocal(row: LocalRow) {
  // Failure is propagated: callers must never announce cloud protection on quota errors.
  localStorage.setItem(keyFor(row.kind, row.id), JSON.stringify(row));
}
async function locked<T>(work: () => Promise<T> | T): Promise<T> {
  if (!owner) throw new Error('A conta ainda não foi identificada. Os registros existentes não foram alterados.');
  if (!navigator.locks) throw new Error('Este navegador não oferece a proteção necessária para salvar entre abas. Use o Chrome atualizado.');
  return navigator.locks.request(`${ROOT}${owner}`, work);
}
function refreshStatus() {
  const rows = readLocal();
  status.pending = rows.filter(r => !!r.pending).length;
  status.conflicts = rows.filter(r => r.conflict).length;
  if (status.conflicts) notify('Há alterações conflitantes preservadas. Exporte a cópia de recuperação antes de revisar.', true);
  // Pendências são a fila normal do salvamento assíncrono, não uma falha.
  // Se elas bloqueiam o provider, o Pilot desmonta quando um novo disparo
  // precisa gravar o checkpoint e a tela deixa de mostrar a fila real.
  else if (status.pending) notify(`${status.pending} registro(s) sincronizando na conta. Mantenha esta aba aberta.`, false);
  else if (initError) notify(initError, true);
  else notify('Registros sincronizados na conta. Background sem prazo de expiração; histórico por 7 dias.');
}
export function refreshDurableRecords(): Promise<void> {
  if (!owner || pulling) return pulling ?? Promise.resolve();
  const expectedOwner = owner;
  pulling = (async () => {
    try {
      let page = 0;
      let more = true;
      while (more) {
        const { body } = await fetchJSON(`/api/user/records?page=${page++}`);
        if (body.userId !== expectedOwner) throw new Error('A conta mudou. Recarregue para recuperar a lista correta.');
        await locked(async () => { for (const remote of body.records) await absorb(remote); });
        more = body.more;
      }
      await locked(() => {
        // TTL applies only to history. Never prune background on age or count.
        initError = '';
        for (const row of readLocal()) {
          const event = row.data ?? row.base;
          if (row.kind === 'history' && event && !inRetention('history', event)) localStorage.removeItem(keyFor(row.kind, row.id));
        }
        refreshStatus();
      });
    } catch (e) { initError = (e as Error).message; notify(initError, true); }
  })().finally(() => { pulling = null; });
  return pulling;
}
export function readDurableRecords<T = RecordData>(kind: RecordKind): Record<string, T> {
  if (typeof window === 'undefined') return {};
  try {
    const out: Record<string, T> = {};
    for (const row of readLocal()) {
      if (row.kind === kind && row.data && inRetention(kind, row.data)) out[row.id] = row.data as T;
    }
    return out;
  } catch (e) {
    const message = (e as Error).message;
    if (status.message !== message || !status.error) notify(message, true);
    return {};
  }
}

/** Each component owns its baseline. An unrelated read cannot make a stale writer current. */
export function createRecordWriter(kind: RecordKind) {
  let seen: Record<string, RecordData> = {};
  let hydrated = false;
  let chain = Promise.resolve();
  return {
    hydrate<T = RecordData>(): Record<string, T> {
      const data = readDurableRecords<RecordData>(kind);
      seen = clone(data); hydrated = true;
      return data as Record<string, T>;
    },
    save(snapshot: Record<string, unknown>): Promise<void> {
      // Capture now; React/updaters may reuse/mutate objects while a write waits.
      const incoming: Record<string, RecordData> = {};
      for (const [id, v] of Object.entries(snapshot)) if (isObject(v)) incoming[id] = checkpoint(v);
      const run = async () => {
        if (!hydrated) throw new Error('A lista ainda não foi recuperada. O estado vazio não será salvo.');
        await locked(() => {
          for (const [id, data] of Object.entries(incoming)) {
            // Absence never means deletion. Unchanged entries never overwrite another tab.
            if (encode(seen[id]) === encode(data)) continue;
            if (!inRetention(kind, data)) continue;
            const raw = localStorage.getItem(keyFor(kind, id));
            const row: LocalRow = raw ? JSON.parse(raw) : { kind, id, data: null, base: null, revision: 0 };
            try {
              if (row.conflict || (raw && row.data === null)) throw new Error('Este disparo foi excluído ou tem conflito. A alteração antiga não foi aplicada.');
              row.data = mergeRecord(seen[id] ?? null, data, row.data);
              row.pending = crypto.randomUUID();
              saveLocal(row);
              seen[id] = clone(data);
              if (kind === 'background' && typeof data.startedAt === 'number') {
                const eventId = `dispatch:${id}:${data.startedAt}`;
                const hkey = keyFor('history', eventId);
                const hraw = localStorage.getItem(hkey);
                // One event per dispatch, immutable event time. Refreshing never extends TTL.
                if (!hraw && eventId.length <= 240) {
                  const event = { id: eventId, t: data.startedAt, tool: id.startsWith('heygenauto:') ? 'heygen-auto' : 'clickup-pilot', title: String(data.taskName ?? id), kind: 'dispatch' };
                  if (inRetention('history', event)) saveLocal({ kind: 'history', id: eventId, data: event, base: null, revision: 0, pending: crypto.randomUUID() });
                }
              }
            } catch (e) {
              saveLocal({ ...row, recovery: data, conflict: true });
              throw e;
            }
          }
          refreshStatus();
        });
        void syncDurableRecords();
      };
      const task = chain.then(run);
      chain = task.catch(e => { notify((e as Error).message, true); });
      return task;
    },
  };
}

/** Removal is always explicit and applies only to the exact observed IDs. */
export async function deleteDurableRecords(kind: RecordKind, ids: string[]): Promise<void> {
  try {
    await locked(() => {
      for (const id of ids) {
        const raw = localStorage.getItem(keyFor(kind, id));
        if (!raw) continue;
        const row: LocalRow = JSON.parse(raw);
        saveLocal({ ...row, data: null, pending: crypto.randomUUID(), conflict: false, recovery: undefined });
      }
      refreshStatus();
    });
    void syncDurableRecords();
  } catch (e) { notify((e as Error).message, true); throw e; }
}

async function fetchJSON(url: string, options?: RequestInit) {
  const response = await fetch(url, { ...options, cache: 'no-store', signal: AbortSignal.timeout(20000) });
  const body = await response.json();
  if (!response.ok && response.status !== 409) throw new Error(body.error ?? 'Não foi possível confirmar os registros na conta.');
  return { body, conflict: response.status === 409 };
}
async function absorb(remote: CloudRow) {
  const raw = localStorage.getItem(keyFor(remote.kind, remote.record_id));
  const local: LocalRow | null = raw ? JSON.parse(raw) : null;
  if (local && local.revision > remote.revision) return;
  const remoteData = remote.deleted ? null : remote.payload;
  if (!local || !local.pending) {
    saveLocal({ kind: remote.kind, id: remote.record_id, data: remoteData, base: remoteData, revision: remote.revision,
      recovery: local?.recovery, conflict: local?.conflict });
    return;
  }
  if (local.revision === remote.revision) return;
  try {
    const data = mergeRecord(local.base, local.data, remoteData);
    saveLocal({ ...local, data, base: remoteData, revision: remote.revision,
      pending: encode(data) === encode(remoteData) ? undefined : crypto.randomUUID() });
  } catch {
    saveLocal({ ...local, data: remoteData, base: remoteData, revision: remote.revision,
      pending: undefined, recovery: local.data, conflict: true });
  }
}

export async function syncDurableRecords(): Promise<void> {
  if (!owner) return;
  if (syncing) {
    syncAgain = true;
    return syncing;
  }
  const expectedOwner = owner;
  syncing = (async () => {
    try {
      const pending = readLocal().filter(r => r.pending && !r.conflict);
      for (const candidate of pending) {
        // Network is outside the local lock: another tab can keep working offline.
        const { body, conflict } = await fetchJSON('/api/user/records', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          userId: expectedOwner, kind: candidate.kind, id: candidate.id, data: candidate.data,
          revision: candidate.revision, operationId: candidate.pending,
        }) });
        if (owner !== expectedOwner) return;
        await locked(async () => {
          const raw = localStorage.getItem(keyFor(candidate.kind, candidate.id));
          if (!raw) throw new Error('O armazenamento do navegador foi limpo durante o salvamento. Recarregue para recuperar a conta.');
          const current: LocalRow = JSON.parse(raw);
          if (conflict) { await absorb(body.record); return; }
          const remote: CloudRow = body.record;
          if (current.revision > remote.revision) return;
          // Keep a new local edit that arrived while this request was in flight.
          saveLocal({ ...current, base: remote.payload, revision: remote.revision,
            pending: current.pending === candidate.pending ? undefined : current.pending });
        });
      }
      if (pending.length) initError = '';
      await locked(refreshStatus);
    } catch (e) {
      initError = (e as Error).message || 'Sem conexão. A cópia local está preservada e será reenviada.';
      notify(initError, true);
    }
  })().finally(() => {
    syncing = null;
    if (syncAgain && owner === expectedOwner) {
      syncAgain = false;
      void syncDurableRecords();
    }
  });
  return syncing;
}

function legacyRecords(): { background: Record<string, RecordData>; history: Record<string, RecordData> } {
  const b = JSON.parse(localStorage.getItem(LEGACY.background) ?? '{}');
  const h = JSON.parse(localStorage.getItem(LEGACY.history) ?? '[]');
  if (!isObject(b) || !Array.isArray(h)) throw new Error('O registro antigo está danificado. Ele não foi alterado.');
  return { background: b as Record<string, RecordData>, history: Object.fromEntries(h.filter(e => e?.id && inRetention('history', e)).map(e => [e.id, e])) };
}
export function initializeDurableRecords(): Promise<void> {
  if (initialization) return initialization;
  initialization = (async () => {
    try {
      let page = 0;
      let more = true;
      while (more) {
        const { body } = await fetchJSON(`/api/user/records?page=${page++}`);
        if (owner && owner !== body.userId) throw new Error('A conta mudou. Recarregue para usar o armazenamento da conta correta.');
        owner = body.userId;
        await locked(async () => { for (const remote of body.records) await absorb(remote); });
        more = body.more;
      }
      const legacy = legacyRecords();
      const imported = localStorage.getItem(`${ROOT}legacy-owner`);
      status.legacy = !imported ? Object.keys(legacy.background).length + Object.keys(legacy.history).length : 0;
      status.ready = true;
      initError = '';
      refreshStatus();
      await syncDurableRecords();
    } catch (e) {
      initError = (e as Error).message;
      notify(initError, true);
      initialization = null;
    }
  })();
  return initialization;
}

/** Legacy records were not account-scoped: import requires a deliberate user click. */
export async function importLegacyRecords(): Promise<void> {
  if (!owner) return;
  const legacy = legacyRecords();
  for (const kind of ['background', 'history'] as const) {
    const writer = createRecordWriter(kind);
    const current = writer.hydrate();
    // Cloud records and tombstones take precedence over older browser snapshots.
    const rows = new Set(readLocal().filter(r => r.kind === kind).map(r => r.id));
    const missing = Object.fromEntries(Object.entries(legacy[kind]).filter(([id]) => !rows.has(id)));
    await writer.save({ ...missing, ...current });
  }
  localStorage.setItem(`${ROOT}legacy-owner`, owner);
  status.legacy = 0;
  refreshStatus();
}

export function exportRecovery(): void {
  const bytes = JSON.stringify({ schema: 2, account: owner, exportedAt: new Date().toISOString(), records: readLocal() }, null, 2);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = `autoedit-registros-${Date.now()}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
