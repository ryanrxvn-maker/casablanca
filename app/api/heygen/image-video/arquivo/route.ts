import { NextResponse } from 'next/server';
import { getUserKey } from '@/lib/user-keys';
import { requireTier } from '@/lib/require-tier';
import { accessTokenDoRefresh, getImageVideoStatus } from '@/lib/heygen-image-video';

/**
 * GET /api/heygen/image-video/arquivo?videoId=... → devolve o MP4 pronto.
 *
 * Existe porque o navegador NÃO consegue baixar a URL do HeyGen direto: o CDN
 * não manda `Access-Control-Allow-Origin`, então `fetch(url).blob()` morre em
 * CORS e o vídeo nunca chega no IndexedDB. Sem isto o histórico guardaria só o
 * link — e o link expira em horas.
 *
 * A URL é resolvida AQUI a partir do videoId, nunca aceita do client: assim
 * ninguém transforma esta rota num proxy de saída pra host arbitrário (SSRF).
 */

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(req: Request) {
  try {
    const gate = await requireTier('admin', {
      unlockTools: ['/tools/famous-hey', '/tools/heygen-auto', '/tools/clickup-pilot'],
    });
    if (!gate.ok) return gate.response;

    const videoId = new URL(req.url).searchParams.get('videoId')?.trim();
    if (!videoId) return NextResponse.json({ error: 'Falta videoId.' }, { status: 400 });

    const keyResult = await getUserKey('heygen_oauth');
    if ('response' in keyResult) return keyResult.response;
    const { access } = await accessTokenDoRefresh(keyResult.key);

    const st = await getImageVideoStatus(access, videoId);
    if (st.status !== 'completed' || !st.videoUrl) {
      return NextResponse.json(
        { error: `O vídeo ainda não está pronto (${st.status}).` },
        { status: 409 },
      );
    }

    const r = await fetch(st.videoUrl);
    if (!r.ok || !r.body) {
      return NextResponse.json(
        { error: `O CDN do HeyGen recusou o download (HTTP ${r.status}).` },
        { status: 502 },
      );
    }
    // Streaming: um MP4 de minutos não cabe confortável na memória da função,
    // e bufferizar só pra reenviar dobraria o tempo até o primeiro byte.
    return new NextResponse(r.body, {
      headers: {
        'Content-Type': 'video/mp4',
        ...(r.headers.get('content-length')
          ? { 'Content-Length': r.headers.get('content-length') as string }
          : {}),
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Erro ao baixar o vídeo.' },
      { status: 500 },
    );
  }
}
