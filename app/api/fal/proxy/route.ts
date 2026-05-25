/**
 * /api/fal/proxy — Proxy server-side pro Fal.ai.
 *
 * O SDK @fal-ai/client v1.10+ NAO exporta mais o helper de proxy
 * pronto pra Next. Entao implementamos manualmente o protocolo:
 *
 *   1. SDK no browser configura `proxyUrl: '/api/fal/proxy'`.
 *   2. Quando faz uma chamada, o middleware withProxy reescreve
 *      a URL real (`https://...fal.run/...`) pro proxy, e poe a
 *      URL original no header `x-fal-target-url`.
 *   3. Aqui a gente le esse header, valida que o destino eh do
 *      Fal, e refaz a request injetando `Authorization: Key ...`
 *      no header. Retorna a resposta repassada (status + body +
 *      content-type).
 *
 * GUARD: so admin autenticado pode usar (lipsync eh admin-only).
 * Sem o guard, qualquer logado consumiria credito Fal via essa rota.
 */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/app/api/admin/_helpers';

export const runtime = 'nodejs';
export const maxDuration = 60;

const TARGET_URL_HEADER = 'x-fal-target-url';

const ALLOWED_HOSTS = new Set([
  'fal.run',
  'queue.fal.run',
  'rest.fal.ai',
  'gateway.fal.ai',
  'fal.media',
  'v3.fal.media',
  'storage.googleapis.com', // signed-url uploads
]);

function isAllowedTarget(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      ALLOWED_HOSTS.has(u.hostname) ||
      u.hostname.endsWith('.fal.ai') ||
      u.hostname.endsWith('.fal.run') ||
      u.hostname.endsWith('.fal.media')
    );
  } catch {
    return false;
  }
}

async function proxy(req: Request): Promise<Response> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const targetUrl = req.headers.get(TARGET_URL_HEADER);
  if (!targetUrl) {
    return NextResponse.json(
      { error: `Missing ${TARGET_URL_HEADER} header.` },
      { status: 400 },
    );
  }
  if (!isAllowedTarget(targetUrl)) {
    return NextResponse.json(
      { error: 'Target URL nao autorizada.' },
      { status: 403 },
    );
  }

  const falKey = process.env.FAL_KEY;
  if (!falKey) {
    return NextResponse.json(
      { error: 'FAL_KEY nao configurada no servidor.' },
      { status: 500 },
    );
  }

  // Reproduz a request inteira preservando body e Content-Type.
  // Headers especiais (host, cookie, x-fal-target-url) sao filtrados.
  const headers = new Headers();
  req.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (
      lower === 'host' ||
      lower === 'cookie' ||
      lower === 'connection' ||
      lower === 'content-length' ||
      lower === TARGET_URL_HEADER
    ) {
      return;
    }
    headers.set(key, value);
  });
  headers.set('Authorization', `Key ${falKey}`);
  headers.set('x-fal-client-proxy', 'darko-lab/1.0');

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';

  let body: BodyInit | undefined;
  if (hasBody) {
    // ArrayBuffer cobre JSON + binarios (upload). O fetch tambem
    // suporta ReadableStream, mas alguns runtimes Node tem bug
    // com stream em outbound — buffer eh mais robusto.
    body = await req.arrayBuffer();
  }

  let upstream: Response;
  try {
    upstream = await fetch(targetUrl, {
      method: req.method,
      headers,
      body,
      redirect: 'manual',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: 'Falha contatando o Fal.ai.', detail: message },
      { status: 502 },
    );
  }

  // Repassa a resposta. Removemos headers que o Next/Vercel maneja.
  const respHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (
      lower === 'content-encoding' ||
      lower === 'transfer-encoding' ||
      lower === 'connection' ||
      lower === 'content-length'
    ) {
      return;
    }
    respHeaders.set(key, value);
  });

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: respHeaders,
  });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
