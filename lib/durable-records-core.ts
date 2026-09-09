/** Pure rules shared by the durable job registry and its regression tests. */
export type RecordKind = 'background' | 'history';
export type RecordData = Record<string, unknown>;
export const HISTORY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export function isObject(value: unknown): value is RecordData {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
export function encode(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(encode).join(',')}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => `${JSON.stringify(k)}:${encode(value[k])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
/** URLs tied to browser memory and credentials are never checkpoints. */
export function checkpoint(data: RecordData): RecordData {
  const visit = (v: unknown): unknown => {
    if (typeof v === 'string' && /^(blob:|data:)/i.test(v)) return undefined;
    if (Array.isArray(v)) return v.map(visit);
    if (!isObject(v)) return v;
    const out: RecordData = {};
    for (const [k, x] of Object.entries(v)) {
      if (/^(authorization|cookie|password|access_token|refresh_token|apiKey|api_key|token)$/i.test(k)) continue;
      const clean = visit(x);
      if (clean !== undefined) out[k] = clean;
    }
    return out;
  };
  return JSON.parse(JSON.stringify(visit(data)));
}
/**
 * Background checkpoints are written frequently by the live Pilot. Two tabs can
 * legitimately save different progress snapshots for the same dispatch; that is
 * not a user-edit conflict. Preserve the most advanced checkpoint and union the
 * completed parts so a refresh can never make a live batch disappear.
 */
const phaseScore: Record<string, number> = {
  recoverable: 10, queued: 20, dispatching: 30, rendering: 40,
  'waiting-heygen': 45, downloading: 50, post: 60, failed: 70, done: 80,
};
function completedParts(value: unknown): number {
  if (!Array.isArray(value)) return 0;
  return value.filter((part) => isObject(part) && (!!part.videoUrl || !!part.videoId)).length;
}
function freshness(record: RecordData): number {
  const phase = typeof record.phase === 'string' ? phaseScore[record.phase] ?? 0 : 0;
  const delivered = record.deliveryOk === true ? 100 : 0;
  return delivered * 1_000_000 + completedParts(record.parts) * 1_000 + phase;
}
function mergeParts(left: unknown, right: unknown): unknown {
  if (!Array.isArray(left)) return right;
  if (!Array.isArray(right)) return left;
  const byLabel = new Map<string, RecordData>();
  for (const candidate of [...left, ...right]) {
    if (!isObject(candidate)) continue;
    const label = typeof candidate.label === 'string' ? candidate.label : encode(candidate);
    const previous = byLabel.get(label);
    if (!previous || completedParts([candidate]) >= completedParts([previous])) {
      // A later retry can add an error while an earlier checkpoint already has
      // the real MP4. Keep the MP4 and its identity in that case.
      byLabel.set(label, {
        ...previous,
        ...candidate,
        videoId: candidate.videoId ?? previous?.videoId ?? null,
        videoUrl: candidate.videoUrl ?? previous?.videoUrl ?? null,
        error: candidate.videoUrl || candidate.videoId ? undefined : candidate.error ?? previous?.error,
      });
    }
  }
  return [...byLabel.values()];
}
/** Three-way merge that is safe for ordinary concurrent checkpoint writes. */
export function mergeRecord(base: RecordData | null, local: RecordData | null, remote: RecordData | null): RecordData | null {
  if (encode(local) === encode(remote)) return remote;
  if (encode(base) === encode(remote)) return local;
  if (encode(base) === encode(local)) return remote;
  // An explicit deletion still wins. It is the only destructive action and is
  // performed through the dedicated remove flow, never by an absent snapshot.
  if (!remote) return null;
  if (!local) return remote;
  const preferred = freshness(local) >= freshness(remote) ? local : remote;
  const other = preferred === local ? remote : local;
  const out = { ...remote };
  for (const key of new Set([...Object.keys(base ?? {}), ...Object.keys(local)])) {
    if (encode(base?.[key]) === encode(local[key])) continue;
    if (encode(base?.[key]) !== encode(remote[key]) && encode(local[key]) !== encode(remote[key])) {
      // Progress records are an append/advance stream, not two competing
      // documents. Keep the advanced record and merge per-take completion.
      if (key === 'parts') { out[key] = mergeParts(local[key], remote[key]); continue; }
      out[key] = preferred[key] ?? other[key];
      continue;
    }
    if (key in local) out[key] = local[key]; else delete out[key];
  }
  return out;
}
export function inRetention(kind: RecordKind, data: RecordData, now = Date.now()): boolean {
  return kind === 'background' || (typeof data.t === 'number' && data.t > now - HISTORY_RETENTION_MS && data.t <= now + 60_000);
}
export function validateRecord(kind: unknown, id: unknown, data: unknown): string | null {
  if (kind !== 'background' && kind !== 'history') return 'Tipo inválido.';
  if (typeof id !== 'string' || !id || id.length > 240) return 'Identificador inválido.';
  if (data === null) return null; // explicit tombstone
  if (!isObject(data)) return 'Registro inválido.';
  if (kind === 'background' && (data.taskId !== id || !Array.isArray(data.parts) || typeof data.startedAt !== 'number')) return 'Disparo inválido.';
  if (kind === 'history' && (data.id !== id || typeof data.t !== 'number' || typeof data.title !== 'string' || typeof data.tool !== 'string')) return 'Evento inválido.';
  if (encode(data).length > 2_000_000) return 'Registro excede o limite de metadados.';
  return null;
}
