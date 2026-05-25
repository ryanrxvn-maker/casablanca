/**
 * /api/tools/lipsync — gera lipsync com 2 motores:
 *
 *   V1 = fal-ai/sync-lipsync/v2 (modelo lipsync-1.9.0-beta)
 *        Tech do DreamFace. Boca super natural, melhor pra rostos
 *        humanos reais. Params: model, sync_mode.
 *
 *   V2 = fal-ai/latentsync (atual). ByteDance LatentSync.
 *        Mais agressivo no sync, melhor pra closeups. Params:
 *        guidance_scale, loop_mode, seed.
 *
 * Body aceito:
 *   {
 *     version: 'v1' | 'v2',
 *     video_url: string,
 *     audio_url: string,
 *     // V1 only:
 *     sync_mode_v1?: 'cut_off' | 'loop' | 'bounce' | 'silence' | 'remap',
 *     // V2 only:
 *     guidance_scale?: number (1-4),
 *     loop_mode?: 'loop' | 'pingpong',
 *     seed?: number,
 *   }
 */

import { NextResponse } from 'next/server';
import { fal } from '@fal-ai/client';
import { requireAdmin } from '@/app/api/admin/_helpers';

export const runtime = 'nodejs';
export const maxDuration = 300;

fal.config({
  credentials: process.env.FAL_KEY,
});

interface LipSyncResultData {
  video?: {
    url?: string;
    content_type?: string;
    file_name?: string;
    file_size?: number;
  };
  video_url?: string;
}

type Version = 'v1' | 'v2';

interface LipSyncBody {
  version?: Version;
  video_url?: string;
  audio_url?: string;
  // v1
  sync_mode_v1?: 'cut_off' | 'loop' | 'bounce' | 'silence' | 'remap';
  // v2
  guidance_scale?: number;
  loop_mode?: 'loop' | 'pingpong';
  seed?: number;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}

function extractOutputUrl(data: LipSyncResultData | undefined): string | null {
  return data?.video?.url ?? data?.video_url ?? null;
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

  const version: Version = body.version === 'v2' ? 'v2' : 'v1';

  try {
    let result;
    let modelLabel: string;

    if (version === 'v1') {
      // V1: Sync.so V2 (lipsync-1.9.0-beta) — DreamFace tech
      const syncMode = body.sync_mode_v1 ?? 'cut_off';
      const input = {
        video_url,
        audio_url,
        model: 'lipsync-1.9.0-beta' as const,
        sync_mode: syncMode,
      };
      result = await fal.subscribe('fal-ai/sync-lipsync/v2', {
        input,
        logs: false,
      });
      modelLabel = 'sync-lipsync/v2 (1.9.0-beta)';
    } else {
      // V2: LatentSync ByteDance
      const guidanceScale =
        typeof body.guidance_scale === 'number' ? clamp(body.guidance_scale, 1, 4) : 2.5;
      const loopMode: 'loop' | 'pingpong' =
        body.loop_mode === 'pingpong' ? 'pingpong' : 'loop';
      const seed =
        typeof body.seed === 'number' && Number.isFinite(body.seed) ? body.seed : undefined;

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

      result = await fal.subscribe('fal-ai/latentsync', {
        input,
        logs: false,
      });
      modelLabel = 'latentsync';
    }

    const data = result.data as LipSyncResultData | undefined;
    const outputUrl = extractOutputUrl(data);

    if (!outputUrl) {
      return NextResponse.json(
        {
          error: 'Fal.ai nao retornou URL do video gerado.',
          model: modelLabel,
          details: result.data,
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      success: true,
      version,
      model: modelLabel,
      output_video_url: outputUrl,
      details: result.data,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[lipsync API]', version, message);
    return NextResponse.json(
      { error: message || 'Erro interno.', version },
      { status: 500 },
    );
  }
}
