/**
 * POST /api/tools/remove-subtitle — INÍCIO (assíncrono) da remoção de
 * legenda/marca d'água de UM TRECHO do vídeo.
 *
 * MODO ASSÍNCRONO (por quê): a função serverless da Vercel morre em 300s.
 * O motor renderiza cada trecho em segundos-a-minutos; antes a gente segurava
 * a função esperando e ela estourava o timeout. Agora:
 *   1. Este POST só BAIXA o trecho, SOBE pro motor e SUBMETE — volta na hora
 *      com um TOKEN de job assinado (sem esperar o render).
 *   2. O cliente acompanha com GET /api/tools/remove-subtitle/status?job=...
 *      (poll leve), que resolve+re-hospeda o MP4 limpo quando fica pronto.
 *
 * O cliente pica o vídeo em trechos, sobe cada um pro Supabase (signed URL) e
 * manda a URL pra cá; o servidor baixa e roda o pipeline no motor. O cliente
 * final NUNCA vê o motor (nome/URL/endpoints) nem sabe que o vídeo foi picado.
 *
 * Admin-only.
 */

import { NextResponse } from 'next/server';
import { requireTier } from '@/lib/require-tier';
import { startWatermarkRemoval, dreamFaceErrorToHttp } from '@/lib/dreamface-api';
import { runWithDreamFaceAccount, hasAccounts } from '@/lib/dreamface-pool';
import { signLipsyncJob } from '@/lib/lipsync-job-token';
import { safeFetch, SsrfError } from '@/lib/safe-fetch';

export const runtime = 'nodejs';
export const maxDuration = 120;

// Um TRECHO cabe no limite do motor (≤30s / ≤100MB). Damos folga.
const MAX_VIDEO_BYTES = 120 * 1024 * 1024;

interface Body {
  video_url?: string;
  width?: number;
  height?: number;
  duration_sec?: number;
}

async function withRetryServer<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let last: unknown;
  for (let i = 1; i <= tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (e instanceof SsrfError) throw e;
      if (i >= tries) break;
      await new Promise((r) => setTimeout(r, 500 * i));
    }
  }
  throw last;
}

function basename(url: string, fallback: string): string {
  try {
    const p = new URL(url).pathname;
    const b = p.split('/').filter(Boolean).pop();
    return b && b.length <= 80 ? b : fallback;
  } catch {
    return fallback;
  }
}

async function download(url: string, maxBytes: number): Promise<{ buffer: Buffer; contentType: string }> {
  let res: Response;
  try {
    res = await withRetryServer(async () => {
      const rr = await safeFetch(url, { cache: 'no-store' });
      if (!rr.ok && rr.status >= 500) throw new Error(`HTTP ${rr.status}`);
      return rr;
    });
  } catch (e) {
    if (e instanceof SsrfError) throw new Error('URL do vídeo não permitida.');
    throw new Error(`Falha ao baixar o vídeo (${e instanceof Error ? e.message : 'rede'}).`);
  }
  if (!res.ok) throw new Error(`Falha ao baixar o vídeo (HTTP ${res.status}).`);
  const declaredLen = parseInt(res.headers.get('content-length') || '', 10);
  if (Number.isFinite(declaredLen) && declaredLen > maxBytes) {
    throw new Error(`O trecho é grande demais (${(declaredLen / 1024 / 1024).toFixed(0)}MB).`);
  }
  const ab = await res.arrayBuffer();
  if (ab.byteLength > maxBytes) {
    throw new Error(`O trecho é grande demais (${(ab.byteLength / 1024 / 1024).toFixed(0)}MB).`);
  }
  if (ab.byteLength === 0) throw new Error('O trecho veio vazio.');
  const contentType = res.headers.get('content-type')?.split(';')[0]?.trim() || '';
  return { buffer: Buffer.from(ab), contentType };
}

export async function POST(req: Request) {
  const guard = await requireTier('admin', { unlockTools: ['/tools/remover-elementos'] });
  if (!guard.ok) return guard.response;

  if (!hasAccounts()) {
    return NextResponse.json(
      { error: 'Remoção não configurada no servidor (variáveis de ambiente do provedor ausentes).', code: 'config_missing' },
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

  try {
    const video = await download(video_url, MAX_VIDEO_BYTES);

    // Pool inteligente: escolhe a melhor conta (menos ocupada), roda em
    // paralelo com as outras e faz FAILOVER se a conta cair. O slot é segurado
    // só durante o START (upload+submit), não durante o render.
    let usedLabel = '';
    const { animateId } = await runWithDreamFaceAccount(async (config, label) => {
      usedLabel = label;
      return startWatermarkRemoval(
        {
          videoBuffer: video.buffer,
          videoName: basename(video_url, 'clip.mp4'),
          videoType: video.contentType || 'video/mp4',
          width: Number(body.width) || 0,
          height: Number(body.height) || 0,
          durationSec: Number(body.duration_sec) || 0,
        },
        config,
      );
    });

    // Token opaco assinado (mesmo formato do lipsync): {conta, animate_id, user}.
    const job = signLipsyncJob({ label: usedLabel, animateId, userId: guard.userId });

    return NextResponse.json({ success: true, status: 'generating', job });
  } catch (err) {
    const { status, message, code, detail } = dreamFaceErrorToHttp(err);
    console.error('[remove-subtitle start]', code, detail);
    return NextResponse.json({ error: message, code }, { status });
  }
}
