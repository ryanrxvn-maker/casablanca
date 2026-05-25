/**
 * /api/tools/lipsync — gera lipsync via fal-ai/latentsync.
 *
 * Aceita parametros customizaveis pelo usuario admin:
 *   - guidance_scale (1.0-4.0, default 2.5) — quanto a boca segue o audio
 *   - loop_mode ('loop' | 'pingpong', default 'loop') — quando audio > video
 *   - seed (numero, opcional) — reproduzir resultado
 *
 * O timeout no Hobby Vercel eh 60s; lipsync demora 60-180s.
 * Por isso, configurado pro plano Pro (maxDuration=300).
 */

import { NextResponse } from 'next/server';
import { fal } from '@fal-ai/client';
import { requireAdmin } from '@/app/api/admin/_helpers';

export const runtime = 'nodejs';
export const maxDuration = 300;

fal.config({
  credentials: process.env.FAL_KEY,
});

interface LatentSyncResultData {
  video?: {
    url?: string;
    content_type?: string;
    file_name?: string;
    file_size?: number;
  };
  video_url?: string;
}

interface LipSyncBody {
  video_url?: string;
  audio_url?: string;
  guidance_scale?: number;
  loop_mode?: 'loop' | 'pingpong';
  seed?: number;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}

export async function POST(req: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  if (!process.env.FAL_KEY) {
    return NextResponse.json(
      { error: 'FAL_KEY nao configurada no servidor.' },
      { status: 500 },
    );
  }

  let body: LipSyncBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON invalido.' }, { status: 400 });
  }

  const { video_url, audio_url } = body;
  if (!video_url || !audio_url) {
    return NextResponse.json(
      { error: 'video_url e audio_url sao obrigatorios.' },
      { status: 400 },
    );
  }

  const guidanceScale =
    typeof body.guidance_scale === 'number' ? clamp(body.guidance_scale, 1, 4) : 2.5;
  const loopMode: 'loop' | 'pingpong' =
    body.loop_mode === 'pingpong' ? 'pingpong' : 'loop';
  const seed = typeof body.seed === 'number' && Number.isFinite(body.seed) ? body.seed : undefined;

  try {
    const input: {
      video_url: string;
      audio_url: string;
      guidance_scale: number;
      loop_mode: 'loop' | 'pingpong';
      seed?: number;
    } = {
      video_url,
      audio_url,
      guidance_scale: guidanceScale,
      loop_mode: loopMode,
    };
    if (seed !== undefined) input.seed = seed;

    const result = await fal.subscribe('fal-ai/latentsync', {
      input,
      logs: false,
    });

    const data = result.data as LatentSyncResultData | undefined;
    const outputUrl = data?.video?.url ?? data?.video_url ?? null;

    if (!outputUrl) {
      return NextResponse.json(
        {
          error: 'Fal.ai nao retornou URL do video gerado.',
          details: result.data,
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      success: true,
      output_video_url: outputUrl,
      params: { guidance_scale: guidanceScale, loop_mode: loopMode, seed },
      details: result.data,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[lipsync API]', message);
    return NextResponse.json(
      { error: message || 'Erro interno.' },
      { status: 500 },
    );
  }
}
