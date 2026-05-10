/**
 * Ephemeral cross-tab data store. Memoria em-processo (some no proximo deploy).
 * Uso: passar texto entre 2 tabs de origens diferentes (ex: docs.google.com →
 * casablanca-ashen.vercel.app) durante automacao MCP.
 *
 * NAO usar pra dado sensivel ou persistente. TTL 5min, max 1MB por entry.
 *
 * POST /api/temp-store    body: { key, value } → grava
 * GET  /api/temp-store?key=X     → le e remove (read-once)
 */
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 10;

type Entry = { value: string; expires: number };
const store: Map<string, Entry> = (globalThis as any).__darkolab_temp_store ||= new Map();

const MAX_VALUE_BYTES = 1_000_000;
const TTL_MS = 5 * 60 * 1000;

function gc() {
  const now = Date.now();
  for (const [k, e] of store.entries()) {
    if (e.expires < now) store.delete(k);
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body.key !== 'string' || typeof body.value !== 'string') {
      return NextResponse.json({ error: 'body deve ter {key, value} (string)' }, { status: 400 });
    }
    if (body.value.length > MAX_VALUE_BYTES) {
      return NextResponse.json({ error: `value > ${MAX_VALUE_BYTES} bytes` }, { status: 413 });
    }
    gc();
    store.set(body.key, { value: body.value, expires: Date.now() + TTL_MS });
    return NextResponse.json({ ok: true, len: body.value.length });
  } catch (e) {
    return NextResponse.json({ error: 'falha', detail: (e as Error)?.message }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const key = url.searchParams.get('key');
    if (!key) return NextResponse.json({ error: 'falta ?key=' }, { status: 400 });
    gc();
    const entry = store.get(key);
    if (!entry) return NextResponse.json({ ok: false, error: 'nao encontrado ou expirado' }, { status: 404 });
    store.delete(key); // read-once
    return NextResponse.json({ ok: true, value: entry.value, len: entry.value.length });
  } catch (e) {
    return NextResponse.json({ error: 'falha', detail: (e as Error)?.message }, { status: 500 });
  }
}
