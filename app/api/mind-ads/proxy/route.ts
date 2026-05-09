import { NextResponse } from 'next/server';

/**
 * GET /api/mind-ads/proxy?url=<remote_url>
 *
 * Proxy server-side pra baixar assets gerados (HeyGen MP4, Replicate JPG/MP4)
 * e devolver pro cliente sem CORS issues. So aceita hosts whitelisted.
 *
 * Streamada — nao buffereiza no servidor. Funciona em Vercel ate o limite
 * de funcao serverless (~5min). Pra arquivos maiores, chama com Range.
 */

export const runtime = 'nodejs';
export const maxDuration = 300;

const ALLOWED_HOST_SUFFIXES = [
  // HeyGen CDN
  '.heygen.com',
  '.heygen.ai',
  // Replicate CDN
  '.replicate.delivery',
  'replicate.com',
  'replicate.delivery',
  // Genericos confiaveis usados como fallback de imagem
  '.amazonaws.com',
  '.cloudfront.net',
];

function isAllowedHost(host: string): boolean {
  return ALLOWED_HOST_SUFFIXES.some(
    (s) => host === s.replace(/^\./, '') || host.endsWith(s),
  );
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const target = searchParams.get('url');
    if (!target) {
      return NextResponse.json({ error: 'url obrigatorio.' }, { status: 400 });
    }

    let parsed: URL;
    try {
      parsed = new URL(target);
    } catch {
      return NextResponse.json({ error: 'url invalido.' }, { status: 400 });
    }

    if (parsed.protocol !== 'https:') {
      return NextResponse.json(
        { error: 'so https permitido.' },
        { status: 400 },
      );
    }

    if (!isAllowedHost(parsed.hostname)) {
      return NextResponse.json(
        { error: `host nao permitido: ${parsed.hostname}` },
        { status: 403 },
      );
    }

    const upstream = await fetch(target);
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json(
        { error: `upstream ${upstream.status}` },
        { status: 502 },
      );
    }

    const headers = new Headers();
    const ct = upstream.headers.get('content-type');
    if (ct) headers.set('content-type', ct);
    const cl = upstream.headers.get('content-length');
    if (cl) headers.set('content-length', cl);
    headers.set('cache-control', 'private, max-age=300');

    return new NextResponse(upstream.body, { status: 200, headers });
  } catch (e) {
    console.error('[mind-ads proxy]', e);
    return NextResponse.json(
      { error: 'erro inesperado', detail: e instanceof Error ? e.message : '' },
      { status: 500 },
    );
  }
}
