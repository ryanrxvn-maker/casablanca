import { NextResponse } from 'next/server';
import { getUserKey } from '@/lib/user-keys';
import {
  buildImageInput,
  resolveTier,
  type MindAdsTier,
} from '@/lib/mind-ads-models';

/**
 * POST /api/mind-ads/replicate/start-image
 *
 * Tier-aware: o body define o tier (eco/padrao/premium) e o route resolve
 * pro modelo correto (Flux schnell / Flux dev / Nano Banana Pro).
 *
 * Body: {
 *   prompt: string;
 *   tier?: 'eco' | 'padrao' | 'premium';   // default 'eco'
 *   aspectRatio?: '9:16' | '1:1' | '16:9'; // default '9:16'
 *   model?: string;                         // override explicito (opcional)
 * }
 */

export const runtime = 'nodejs';
export const maxDuration = 60;

type Body = {
  prompt?: string;
  tier?: MindAdsTier;
  aspectRatio?: '9:16' | '1:1' | '16:9';
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

    const prompt = String(body.prompt ?? '').trim();
    if (!prompt) return jsonError('prompt obrigatorio.', 400);
    if (prompt.length > 2000) {
      return jsonError('Prompt muito longo (max 2000 chars).', 400);
    }

    const tierConfig = resolveTier(body.tier);
    const model = body.model ?? tierConfig.imageModel;
    const aspectRatio = body.aspectRatio ?? '9:16';

    const input = buildImageInput(model, prompt, aspectRatio);
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
    console.error('[mind-ads replicate start-image]', e);
    return jsonError(
      'Erro inesperado.',
      500,
      e instanceof Error ? e.message : String(e),
    );
  }
}
