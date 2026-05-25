/**
 * /api/tools/lipsync — gera lipsync com Sync.so v2 (tech do DreamFace).
 *
 * Sempre usa `fal-ai/sync-lipsync/v2` com:
 *   - model: 'lipsync-2-pro' (default — qualidade max) ou 'lipsync-2' (mais rapido)
 *   - sync_mode: cut_off | loop | bounce | silence | remap
 *
 * V2 (fal-ai/latentsync) foi removido — testes mostraram qualidade
 * inferior e tempo de geracao maior (12 min vs 7 min) com mais artefatos.
 *
 * Body aceito:
 *   {
 *     video_url: string,
 *     audio_url: string,
 *     pro?: boolean,                  // true (default) = lipsync-2-pro
 *     sync_mode?: 'cut_off' | 'loop' | 'bounce' | 'silence' | 'remap',
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

interface LipSyncBody {
  video_url?: string;
  audio_url?: string;
  pro?: boolean;
  sync_mode?: 'cut_off' | 'loop' | 'bounce' | 'silence' | 'remap';
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

  // Default pro = true (qualidade max). User pode passar false pra speed.
  const usePro = body.pro !== false;
  const model: 'lipsync-2' | 'lipsync-2-pro' = usePro ? 'lipsync-2-pro' : 'lipsync-2';
  const syncMode = body.sync_mode ?? 'cut_off';

  try {
    const input = {
      video_url,
      audio_url,
      model,
      sync_mode: syncMode,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const result = await fal.subscribe('fal-ai/sync-lipsync/v2', {
      input,
      logs: false,
    });

    const data = result.data as LipSyncResultData | undefined;
    const outputUrl = data?.video?.url ?? data?.video_url ?? null;

    if (!outputUrl) {
      return NextResponse.json(
        {
          error: 'Fal.ai nao retornou URL do video gerado.',
          model,
          details: result.data,
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      success: true,
      model,
      output_video_url: outputUrl,
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
