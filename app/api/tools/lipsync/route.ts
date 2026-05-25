/**
 * /api/tools/lipsync — gera lipsync via Replicate (Wav2Lip GAN).
 *
 * Migrado de fal-ai/sync-lipsync/v2 (~$2.38/min real) pra Replicate
 * Wav2Lip GAN (~$0.027/min). Economia: 88x.
 *
 * Modelo: cjwbw/wav2lip (versao GAN, melhor qualidade que classic).
 *   - GPU: T4
 *   - Custo: ~$0.000225/s GPU
 *   - Tempo de processamento: ~1.5-2x duracao do video
 *
 * Body aceito:
 *   {
 *     video_url: string,    // URL publica (do storage ou Replicate Files)
 *     audio_url: string,    // URL publica
 *     // wav2lip-specific:
 *     smooth?: boolean,     // suaviza face detection (default true)
 *     pads?: [t, b, l, r],  // padding em volta da boca pra blend melhor
 *   }
 */

import { NextResponse } from 'next/server';
import Replicate from 'replicate';
import { requireAdmin } from '@/app/api/admin/_helpers';

export const runtime = 'nodejs';
export const maxDuration = 300;

interface LipSyncBody {
  video_url?: string;
  audio_url?: string;
  smooth?: boolean;
  pads?: [number, number, number, number];
}

// Model: cjwbw/wav2lip — wav2lip GAN model on Replicate.
// Hash explicito da versao garante reprodutibilidade.
// Pode atualizar pra versao mais recente conferindo https://replicate.com/cjwbw/wav2lip
const WAV2LIP_MODEL =
  'cjwbw/wav2lip:8d65e3f4f4af1a23e6c0b7c63ab7a8a6ed14e4a4e8e51bf6f8f7cd83a4c4f8fc';

export async function POST(req: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: 'REPLICATE_API_TOKEN nao configurada no servidor.' },
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

  const replicate = new Replicate({ auth: token });

  try {
    // Wav2Lip input:
    //  - face: video do rosto (URL)
    //  - audio: audio com a fala (URL)
    //  - pads: padding em volta da boca [top, bottom, left, right]
    //  - smooth: smoothing temporal pra evitar tremor (default true)
    const input = {
      face: video_url,
      audio: audio_url,
      smooth: body.smooth ?? true,
      pads: body.pads ?? [0, 10, 0, 0],
    };

    const output = await replicate.run(
      WAV2LIP_MODEL as `${string}/${string}:${string}`,
      { input },
    );

    // Output pode ser string URL, object com url, ou array
    const outputUrl =
      typeof output === 'string'
        ? output
        : Array.isArray(output)
          ? output[0]
          : // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (output as any)?.url?.() ?? (output as any)?.url ?? null;

    if (!outputUrl || typeof outputUrl !== 'string') {
      return NextResponse.json(
        {
          error: 'Replicate nao retornou URL do video gerado.',
          details: output,
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      success: true,
      model: 'wav2lip-gan',
      output_video_url: outputUrl,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[lipsync API · Replicate]', message);
    return NextResponse.json(
      { error: message || 'Erro interno.' },
      { status: 500 },
    );
  }
}
