/**
 * /api/tools/remove-subtitle — remove legenda/marca d'água queimada via
 * vmake Smart (conta paga do admin), server-to-server. SEM instalador,
 * SEM motor local. Espelha o fluxo do lipsync.
 *
 * FLUXO:
 *   - Client sobe o vídeo pro Supabase Storage (signed URL) → URL pública.
 *   - Manda { video_url, mode? } pra cá.
 *   - O servidor BAIXA o vídeo e roda o pipeline vmake (assina → upload OSS
 *     → submit Smart → poll → MP4 final), tudo por 1 Access-Token + 1 IP
 *     (proxy), em fila serial (ritmo humano).
 *   - Re-hospeda o MP4 final no Supabase (esconde a URL do motor) e devolve
 *     { success, output_video_url }.
 *
 * Admin-only (requireAdmin). O cliente final nunca vê o vmake.
 */

import { NextResponse } from 'next/server';
import { requireAdmin, serviceClient } from '@/app/api/admin/_helpers';
import {
  removeSubtitle,
  isVmakeConfigured,
  vmakeErrorToHttp,
  type VmakeMode,
} from '@/lib/vmake-api';
import { runOnVmakeQueue } from '@/lib/vmake-queue';

export const runtime = 'nodejs';
export const maxDuration = 300;

const OUTPUT_BUCKET = 'remover-uploads';
const MAX_VIDEO_BYTES = 500 * 1024 * 1024; // 500MB

function basename(url: string, fallback: string): string {
  try {
    const p = new URL(url).pathname;
    const b = p.split('/').filter(Boolean).pop();
    return b && b.length <= 100 ? decodeURIComponent(b) : fallback;
  } catch {
    return fallback;
  }
}

async function download(url: string): Promise<{ buffer: Buffer; contentType: string }> {
  let res: Response;
  try {
    res = await fetch(url, { cache: 'no-store' });
  } catch (e) {
    throw new Error(`Falha ao baixar o vídeo (${e instanceof Error ? e.message : 'rede'}).`);
  }
  if (!res.ok) throw new Error(`Falha ao baixar o vídeo (HTTP ${res.status}).`);
  const ab = await res.arrayBuffer();
  if (ab.byteLength > MAX_VIDEO_BYTES) {
    throw new Error(`O vídeo é grande demais (${(ab.byteLength / 1024 / 1024).toFixed(0)}MB).`);
  }
  if (ab.byteLength === 0) throw new Error('O vídeo veio vazio.');
  const contentType = res.headers.get('content-type')?.split(';')[0]?.trim() || 'video/mp4';
  return { buffer: Buffer.from(ab), contentType };
}

/** Re-hospeda o MP4 do motor no Supabase: o cliente NUNCA vê a URL do vmake. */
async function rehostOutput(srcUrl: string, userId: string, recordId: string): Promise<string> {
  const r = await fetch(srcUrl, { cache: 'no-store' });
  if (!r.ok) throw new Error(`download do MP4 final falhou (${r.status})`);
  const buf = Buffer.from(await r.arrayBuffer());
  const sb = serviceClient();
  await sb.storage.createBucket(OUTPUT_BUCKET, { public: true }).catch(() => {});
  const path = `outputs/${userId}/${Date.now()}-${recordId}.mp4`;
  const { error } = await sb.storage
    .from(OUTPUT_BUCKET)
    .upload(path, buf, { contentType: 'video/mp4', upsert: true });
  if (error) throw new Error('re-host Supabase: ' + error.message);
  const { data } = sb.storage.from(OUTPUT_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

interface Body {
  video_url?: string;
  mode?: string;
}

const VALID_MODES = new Set(['smart', 'subtitle', 'watermark']);

export async function POST(req: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  if (!isVmakeConfigured()) {
    return NextResponse.json(
      {
        error: 'Remoção não configurada no servidor (variáveis de ambiente do provedor ausentes).',
        code: 'config_missing',
      },
      { status: 500 },
    );
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 });
  }

  const { video_url } = body;
  if (!video_url) {
    return NextResponse.json({ error: 'video_url é obrigatório.' }, { status: 400 });
  }
  const mode: VmakeMode = VALID_MODES.has(String(body.mode))
    ? (body.mode as VmakeMode)
    : 'smart';

  try {
    const video = await download(video_url);

    const result = await runOnVmakeQueue(() =>
      removeSubtitle({
        videoBuffer: video.buffer,
        videoName: basename(video_url, 'video.mp4'),
        videoType: video.contentType,
        mode,
      }),
    );

    // Esconde a origem: re-hospeda no Supabase. Se falhar, cai pra URL direta.
    let outputUrl = result.url;
    try {
      outputUrl = await rehostOutput(result.url, guard.userId, result.recordId);
    } catch (e) {
      console.error('[remove-subtitle] re-host falhou, usando URL direta:', e instanceof Error ? e.message : e);
    }

    return NextResponse.json({
      success: true,
      engine: 'autoedit',
      output_video_url: outputUrl,
      record_id: result.recordId,
    });
  } catch (err) {
    const { status, message, code, detail } = vmakeErrorToHttp(err);
    console.error('[remove-subtitle API]', code, detail);
    return NextResponse.json({ error: message, code }, { status });
  }
}
