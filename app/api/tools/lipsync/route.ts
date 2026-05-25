/**
 * /api/tools/lipsync — gera lipsync via fal-ai/latentsync.
 *
 * Fluxo:
 *  1. requireAdmin (so admin acessa essa rota)
 *  2. recebe { video_url, audio_url } ja uploadados pro storage do Fal
 *     (o client fez upload via /api/fal/proxy + fal.storage.upload)
 *  3. chama fal.run("fal-ai/latentsync", { input: {...} })
 *  4. retorna { success, output_video_url, details }
 *
 * O Fal.ai cobra ~$0.05-0.15 por geracao (depende do video).
 * O timeout no Hobby Vercel eh 60s; lipsync demora 60-180s.
 * Por isso, configurado pro plano Pro (maxDuration=300). Se a conta
 * estiver no Hobby, vai estourar timeout — mas o job continua rodando
 * no Fal e o user pode ver status no dashboard deles.
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

export async function POST(req: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  if (!process.env.FAL_KEY) {
    return NextResponse.json(
      { error: 'FAL_KEY nao configurada no servidor.' },
      { status: 500 },
    );
  }

  let body: { video_url?: string; audio_url?: string };
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

  try {
    const result = await fal.subscribe('fal-ai/latentsync', {
      input: {
        video_url,
        audio_url,
        guidance_scale: 2.5,
        loop_mode: 'loop',
      },
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
