/**
 * Proxy READ-ONLY server-side pra API do ClickUp.
 *
 * REGRA HARD: SO ACEITA GET. Qualquer outro metodo (POST/PUT/DELETE) e
 * rejeitado com 405 ANTES de tocar a API ClickUp. Esse tool jamais
 * pode alterar tasks, comentarios, status ou qualquer coisa no ClickUp
 * do user. Read-only por design.
 *
 * Browser → Next API → ClickUp API. Resolve CORS e mantem token fora do
 * codigo client (token vem no header Authorization do request browser→server,
 * que vem do localStorage do user — ele controla a propria credencial).
 *
 * POST /api/clickup/proxy   (POST aqui = comando HTTP de transporte;
 *                             o "method" no body so pode ser GET)
 * body: { path: '/team', method: 'GET' }
 * headers: { 'x-clickup-token': 'pk_...' }
 */
import { NextResponse } from 'next/server';
import { requireTier } from '@/lib/require-tier';

export const runtime = 'nodejs';
export const maxDuration = 60;

const ALLOWED_HOSTS = ['api.clickup.com'];
const ALLOWED_METHODS = new Set(['GET']);

function jsonError(message: string, status = 400, detail?: string) {
  return NextResponse.json(
    detail ? { error: message, detail: detail.slice(0, 1000) } : { error: message },
    { status },
  );
}

export async function POST(req: Request) {
  try {
    const gate = await requireTier('pro');
    if (!gate.ok) return gate.response;
    const token = req.headers.get('x-clickup-token');
    if (!token) return jsonError('Falta header x-clickup-token.', 401);

    const json = await req.json().catch(() => null);
    if (!json) return jsonError('Body invalido (esperado JSON).');

    const { path, method = 'GET' } = json as { path?: string; method?: string };
    if (!path || typeof path !== 'string') return jsonError('path obrigatorio.');
    if (!path.startsWith('/')) return jsonError('path deve comecar com /.');

    const upMethod = String(method).toUpperCase();
    if (!ALLOWED_METHODS.has(upMethod)) {
      return jsonError(
        `Metodo ${upMethod} bloqueado. ClickUp Pilot e READ-ONLY — so GET permitido. Nunca alterar tasks/docs.`,
        405,
      );
    }

    const url = new URL('https://api.clickup.com/api/v2' + path);
    if (!ALLOWED_HOSTS.includes(url.host)) return jsonError('Host nao permitido.');

    const upstream = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: token,
        'Content-Type': 'application/json',
      },
    });
    const text = await upstream.text();
    let data: unknown = text;
    const ct = upstream.headers.get('content-type') || '';
    if (ct.includes('json')) {
      try { data = JSON.parse(text); } catch { /* keep text */ }
    }

    return NextResponse.json(
      { ok: upstream.ok, status: upstream.status, body: data },
      { status: 200 },
    );
  } catch (e) {
    return jsonError('Falha no proxy.', 500, (e as Error)?.message);
  }
}
