import { NextResponse } from 'next/server';
import { buildLtxData, LTX_FN, type LtxMode } from '@/lib/ltx-video';
import { ltxQueue, pickToken } from '@/lib/ltx-gradio-server';

/**
 * POST /api/ltx-video/start
 * Enfileira uma geração na Space ZeroGPU e devolve o event_id.
 *
 * Body: {
 *   prompt, negativePrompt?, width, height, duration,
 *   improveTexture?, mode?, imageFilepath?(path da Space p/ i2v),
 *   seed?, tokenIndex?
 * }
 */

export const runtime = 'nodejs';
export const maxDuration = 30;

type Body = {
  prompt?: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  duration?: number;
  improveTexture?: boolean;
  mode?: LtxMode;
  imageFilepath?: string;
  seed?: number;
  tokenIndex?: number;
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'Body inválido.' }, { status: 400 });
  }

  const prompt = String(body.prompt ?? '').trim();
  if (!prompt) {
    return NextResponse.json({ error: 'Prompt obrigatório.' }, { status: 400 });
  }

  const mode: LtxMode = body.mode === 'image-to-video' ? 'image-to-video' : 'text-to-video';
  const fn = mode === 'image-to-video' ? LTX_FN.i2v : LTX_FN.t2v;

  const imageFilepath =
    mode === 'image-to-video' && body.imageFilepath
      ? { path: body.imageFilepath, url: null, meta: { _type: 'gradio.FileData' } }
      : null;

  const data = buildLtxData({
    prompt,
    negativePrompt: body.negativePrompt,
    imageFilepath,
    width: Number(body.width) || 1024,
    height: Number(body.height) || 576,
    mode,
    duration: Number(body.duration) || 6,
    seed: typeof body.seed === 'number' ? body.seed : undefined,
    improveTexture: body.improveTexture !== false,
  });

  const { token, index, total } = pickToken(body.tokenIndex ?? 0);
  const r = await ltxQueue(fn, data, token);

  if (!r.ok) {
    return NextResponse.json(
      { error: r.error, retryable: true, tokenIndex: index, tokenTotal: total },
      { status: r.status },
    );
  }

  return NextResponse.json({
    eventId: r.eventId,
    fn,
    tokenIndex: index,
    tokenTotal: total,
  });
}
