import { NextResponse } from 'next/server';
import { getUserKey } from '@/lib/user-keys';
import { extractOutputUrl } from '@/lib/mind-ads-models';

/**
 * GET /api/mind-ads/replicate/status?id=<prediction_id>
 *
 * Le o status de uma prediction no Replicate (image ou video — generico).
 * Status possiveis: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled'.
 * Quando succeeded, retorna `output` (URL ou array de URLs).
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
    const keyResult = await getUserKey('replicate');
    if ('response' in keyResult) return keyResult.response;
    const apiKey = keyResult.key;

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return jsonError('id obrigatorio.', 400);

    const res = await fetch(
      `https://api.replicate.com/v1/predictions/${encodeURIComponent(id)}`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
      },
    );

    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return jsonError('Falha na Replicate API ao consultar status.', 502, t);
    }

    const json = (await res.json().catch(() => null)) as {
      id?: string;
      status?: string;
      output?: string | string[] | null;
      error?: string | null;
      logs?: string;
    } | null;

    const status = String(json?.status ?? 'unknown');
    const outputUrl = extractOutputUrl(json?.output);

    return NextResponse.json({
      status,
      outputUrl,
      error: json?.error ?? null,
    });
  } catch (e) {
    console.error('[mind-ads replicate status]', e);
    return jsonError(
      'Erro inesperado.',
      500,
      e instanceof Error ? e.message : String(e),
    );
  }
}
