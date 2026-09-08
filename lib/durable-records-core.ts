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
/** Three-way merge. Never guess between two different edits of the same field. */
export function mergeRecord(base: RecordData | null, local: RecordData | null, remote: RecordData | null): RecordData | null {
  if (encode(local) === encode(remote)) return remote;
  if (encode(base) === encode(remote)) return local;
  if (encode(base) === encode(local)) return remote;
  if (!local || !remote) throw new Error('Este registro foi excluído ou alterado em outra aba. A alteração foi preservada para revisão.');
  const out = { ...remote };
  for (const key of new Set([...Object.keys(base ?? {}), ...Object.keys(local)])) {
    if (encode(base?.[key]) === encode(local[key])) continue;
    if (encode(base?.[key]) !== encode(remote[key]) && encode(local[key]) !== encode(remote[key])) {
      throw new Error('O mesmo disparo foi alterado em duas abas. Nenhuma versão foi sobrescrita; revise a cópia de recuperação.');
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
