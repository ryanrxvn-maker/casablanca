import { NextResponse } from 'next/server';
import { getUserKey } from '@/lib/user-keys';
import {
  buildVideoInput,
  resolveTier,
  type MindAdsTier,
} from '@/lib/mind-ads-models';

/**
 * POST /api/mind-ads/replicate/start-video
 *
 * Tier-aware: o body define o tier e o route resolve pro modelo
 * (Kling 1.6 standard / Luma Ray 2 Flash / Wan 2.1 i2v).
 *
 * Body: {
 *   imageUrl: string;
 *   prompt: string;
 *   tier?: 'eco' | 'padrao' | 'premium';   // default 'eco'
 *   duration?: 3 | 5 | 7 | 10;             // default 5
 *   model?: string;                         // override explicito
 * }
 */

export const runtime = 'nodejs';
export const maxDuration = 60;

type Body = {
  imageUrl?: string;
  prompt?: string;
  tier?: MindAdsTier;
  duration?: number;
  model?: string;
};

function jsonError(message: string, status = 500, detail?: string) {
  return NextResponse.json(
    detail ? { error: message, detail: detail.slice(0, 500) } : { error: message },
    { status },
  );
}

export async function POST(req: Request) {
  try {
    const keyResult = await getUserKey('replicate');
    if ('response' in keyResult) return keyResult.response;
    const apiKey = keyResult.key;

    let body: Body;
    try {
      body = (await req.json()) as Body;
    } catch (e) {
      return jsonError(
        'Body JSON invalido.',
        400,
        e instanceof Error ? e.message : String(e),
      );
    }

    const imageUrl = String(body.imageUrl ?? '').trim();
    const prompt = String(body.prompt ?? '').trim();
    if (!imageUrl) return jsonError('imageUrl obrigatorio.', 400);
    if (!prompt) return jsonError('prompt obrigatorio.', 400);

    const allowed = [3, 5, 7, 10];
    const duration =
      body.duration && allowed.includes(body.duration) ? body.duration : 5;

    const tierConfig = resolveTier(body.tier);
    const model = body.model ?? tierConfig.videoModel;

    const input = buildVideoInput(model, imageUrl, prompt, duration);
    const url = `https://api.replicate.com/v1/models/${model}/predictions`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        Prefer: 'wait=0',
      },
      body: JSON.stringify({ input }),
    });

    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return jsonError(`Falha na Replicate API (${model}).`, 502, t);
    }

    const json = (await res.json().catch(() => null)) as {
      id?: string;
      status?: string;
    } | null;

    if (!json?.id) {
      return jsonError(
        'Replicate nao retornou prediction id.',
        502,
        JSON.stringify(json).slice(0, 300),
      );
    }

    return NextResponse.json({
      predictionId: json.id,
      model,
      tier: body.tier ?? 'eco',
    });
  } catch (e) {
    console.error('[mind-ads replicate start-video]', e);
    return jsonError(
      'Erro inesperado.',
      500,
      e instanceof Error ? e.message : String(e),
    );
  }
}
