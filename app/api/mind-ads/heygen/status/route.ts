import { NextResponse } from 'next/server';
import { getUserKey } from '@/lib/user-keys';

/**
 * GET /api/mind-ads/heygen/status?id=<video_id>
 *
 * Le o status atual do job HeyGen. O front pola esse endpoint a cada N
 * segundos sem timeout. Status possiveis: 'pending' | 'processing' |
 * 'completed' | 'failed'. Quando completed, retorna `videoUrl`.
 */

export const runtime = 'nodejs';
export const maxDuration = 30;

function jsonError(message: string, status = 500, detail?: string) {
  return NextResponse.json(
    detail ? { error: message, detail: detail.slice(0, 500) } : { error: message },
    { status },
  );
}

export async function GET(req: Request) {
  try {
    const keyResult = await getUserKey('heygen');
    if ('response' in keyResult) return keyResult.response;
    const apiKey = keyResult.key;

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return jsonError('id obrigatorio.', 400);

    const res = await fetch(
      `https://api.heygen.com/v1/video_status.get?video_id=${encodeURIComponent(id)}`,
      {
        method: 'GET',
        headers: { 'X-Api-Key': apiKey },
      },
    );

    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return jsonError('Falha na HeyGen API ao consultar status.', 502, t);
    }

    const json = (await res.json().catch(() => null)) as {
      data?: {
        status?: string;
        video_url?: string;
        thumbnail_url?: string;
        duration?: number;
        error?: { message?: string } | string;
      };
    } | null;

    const data = json?.data ?? {};
    const status = String(data.status ?? 'unknown');

    return NextResponse.json({
      status, // 'pending' | 'processing' | 'completed' | 'failed' | etc
      videoUrl: data.video_url ?? null,
      thumbnailUrl: data.thumbnail_url ?? null,
      duration: data.duration ?? null,
      error:
        typeof data.error === 'string'
          ? data.error
          : data.error?.message ?? null,
    });
  } catch (e) {
    console.error('[mind-ads heygen status]', e);
    return jsonError(
      'Erro inesperado.',
      500,
      e instanceof Error ? e.message : String(e),
    );
  }
}
