// Stub do serviceClient (Supabase) + requireAdmin: grava cada operação em
// globalThis.__ops pra o teste conferir o que o código escreveu no banco.
import { NextResponse } from 'next/server';

type Op = { table: string; kind: string; payload?: unknown; filters: Array<[string, unknown]> };
const g = globalThis as unknown as { __ops: Op[]; __profiles: Record<string, Record<string, unknown>> };
g.__ops = g.__ops ?? [];
g.__profiles = g.__profiles ?? {};

function builder(table: string) {
  const op: Op = { table, kind: 'select', filters: [] };
  let single = false;
  const b: Record<string, unknown> = {};
  const chain = (name: string) => (...args: unknown[]) => {
    if (name === 'update' || name === 'insert' || name === 'upsert') {
      op.kind = name;
      op.payload = args[0];
    } else if (name === 'maybeSingle' || name === 'single') {
      single = true;
    } else if (name !== 'select') {
      op.filters.push([name, args]);
    }
    return b;
  };
  for (const n of ['select', 'update', 'insert', 'upsert', 'eq', 'neq', 'or', 'in', 'ilike', 'limit', 'order', 'not', 'is', 'gte', 'maybeSingle', 'single']) {
    b[n] = chain(n);
  }
  b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
    g.__ops.push(op);
    let data: unknown = [];
    if (table === 'profiles') {
      const idf = op.filters.find((f) => f[0] === 'eq' && (f[1] as unknown[])[0] === 'id');
      const id = idf ? ((idf[1] as unknown[])[1] as string) : null;
      if (op.kind === 'update' && id) {
        g.__profiles[id] = { ...(g.__profiles[id] ?? { id }), ...(op.payload as object) };
        data = [{ id }];
      } else if (op.kind === 'select' && id) {
        data = single ? g.__profiles[id] ?? null : [g.__profiles[id]].filter(Boolean);
      } else if (op.kind === 'select') {
        data = single ? null : [];
      }
    } else if (single) {
      data = null;
    }
    return Promise.resolve({ data, error: null }).then(res, rej);
  };
  return b;
}

export function serviceClient() {
  return { from: (t: string) => builder(t) } as never;
}

export async function requireAdmin() {
  return { ok: true as const, userId: '00000000-0000-4000-8000-0000000000ad' };
}

export function jsonError(message: string, status = 500, detail?: string) {
  return NextResponse.json(detail ? { error: message, detail } : { error: message }, { status });
}
