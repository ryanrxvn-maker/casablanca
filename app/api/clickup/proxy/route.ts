/**
 * Proxy server-side pra API do ClickUp.
 *
 * Browser → Next API → ClickUp API. Resolve CORS e mantem token fora do
 * codigo client (token vem no header Authorization do request browser→server,
 * que vem do localStorage do user — ele controla a propria credencial).
 *
 * POST /api/clickup/proxy
 * body: { path: '/team', method: 'GET', body?: any }
 * headers: { 'x-clickup-token': 'pk_...' }
 */
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 60;

const ALLOWED_HOSTS = ['api.clickup.com'];

function jsonError(message: string, status = 400, detail?: string) {
  return NextResponse.json(
    detail ? { error: message, detail: detail.slice(0, 1000) } : { error: message },
    { status },
  );
}

export async function POST(req: Request) {
  try {
    const token = req.headers.get('x-clickup-token');
    if (!token) return jsonError('Falta header x-clickup-token.', 401);

    const json = await req.json().catch(() => null);
    if (!json) return jsonError('Body invalido (esperado JSON).');

    const { path, method = 'GET', body } = json as { path?: string; method?: string; body?: unknown };
    if (!path || typeof path !== 'string') return jsonError('path obrigatorio.');
    if (!path.startsWith('/')) return jsonError('path deve comecar com /.');

    const url = new URL('https://api.clickup.com/api/v2' + path);
    if (!ALLOWED_HOSTS.includes(url.host)) return jsonError('Host nao permitido.');

    const init: RequestInit = {
      method: method.toUpperCase(),
      headers: {
        Authorization: token,
        'Content-Type': 'application/json',
      },
    };
    if (body !== undefined && method.toUpperCase() !== 'GET') {
      init.body = JSON.stringify(body);
    }

    const upstream = await fetch(url.toString(), init);
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
