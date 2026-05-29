/**
 * Ephemeral cross-tab data store. Memoria em-processo (some no proximo deploy).
 * Uso: passar texto entre 2 tabs de origens diferentes (ex: docs.google.com →
 * casablanca-ashen.vercel.app) durante automacao MCP.
 *
 * NAO usar pra dado sensivel ou persistente. TTL 5min, max 1MB por entry.
 *
 * POST /api/temp-store    body: { key, value } → grava
 * GET  /api/temp-store?key=X     → le e remove (read-once)
 *
 * CORS aberto pra qualquer origin (necessario pra fetch de docs.google.com).
 */
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 10;

type Entry = { value: string; expires: number };
const store: Map<string, Entry> = (globalThis as any).__darkolab_temp_store ||= new Map();

const MAX_VALUE_BYTES = 1_000_000;
const TTL_MS = 5 * 60 * 1000;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Endpoint de automação (MCP) — FECHADO por padrão em produção. Pra usar,
// defina ENABLE_TEMP_STORE=1 no ambiente. Sem a flag, responde 404 e some.
const ENABLED = process.env.ENABLE_TEMP_STORE === '1';

function jsonCors(body: any, status = 200) {
  return NextResponse.json(body, { status, headers: CORS_HEADERS });
}

function disabledResponse() {
  return jsonCors({ error: 'not found' }, 404);
}

function gc() {
  const now = Date.now();
  for (const [k, e] of store.entries()) {
    if (e.expires < now) store.delete(k);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: Request) {
  if (!ENABLED) return disabledResponse();
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body.key !== 'string' || typeof body.value !== 'string') {
      return jsonCors({ error: 'body deve ter {key, value} (string)' }, 400);
    }
    if (body.value.length > MAX_VALUE_BYTES) {
      return jsonCors({ error: `value > ${MAX_VALUE_BYTES} bytes` }, 413);
    }
    gc();
    store.set(body.key, { value: body.value, expires: Date.now() + TTL_MS });
    return jsonCors({ ok: true, len: body.value.length });
  } catch (e) {
    return jsonCors({ error: 'falha', detail: (e as Error)?.message }, 500);
  }
}

export async function GET(req: Request) {
  if (!ENABLED) return disabledResponse();
  try {
    const url = new URL(req.url);
    const key = url.searchParams.get('key');
    if (!key) return jsonCors({ error: 'falta ?key=' }, 400);
    gc();
    const entry = store.get(key);
    if (!entry) return jsonCors({ ok: false, error: 'nao encontrado ou expirado' }, 404);
    store.delete(key); // read-once
    return jsonCors({ ok: true, value: entry.value, len: entry.value.length });
  } catch (e) {
    return jsonCors({ error: 'falha', detail: (e as Error)?.message }, 500);
  }
}
