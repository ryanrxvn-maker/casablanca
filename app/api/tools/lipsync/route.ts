/**
 * /api/tools/lipsync — gera lipsync com Sync.so v2 (tech do DreamFace).
 *
 * SEMPRE usa `fal-ai/sync-lipsync/v2` com modelo `lipsync-2` (padrao):
 *   - ~$0.05/min (6x mais barato que pro)
 *   - Qualidade alta — equivalente a DreamFace
 *   - Sem PRO, sem versionamento — UM motor unico
 *
 * Body aceito:
 *   {
 *     video_url: string,
 *     audio_url: string,
 *     sync_mode?: 'cut_off' | 'loop' | 'bounce' | 'silence' | 'remap',
 *   }
 *
 * Qualidade vem do pre-processamento client-side (audio limpo,
 * video 720p@25fps, crop no rosto), NAO do modelo.
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
  sync_mode?: 'cut_off' | 'loop' | 'bounce' | 'silence' | 'remap';
  /** Smart Boost: chunker passa true SO em chunks marcados pra Pro
   *  (top 5% por energia). Default false. */
  pro?: boolean;
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

  // Default: lipsync-2 (padrao). Smart Boost passa pro=true SO em chunks
  // selecionados (top 5% por energia, max 2 por video) → custo medio
  // ainda fica em $0.034/min (R$54/mes pra 300min).
  const usePro = body.pro === true;
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
