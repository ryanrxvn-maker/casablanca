/**
 * /api/tools/lipsync — gera lipsync via DreamFace (API privada do app
 * web, conta paga consumer). "Ilimitado", sem créditos, server-to-server.
 *
 * Antes: Replicate Wav2Lip (por geração). Agora: DreamFace Avatar Video
 * lipsync rodando na conta anual — custo fixo da conta, gerações ilimitadas.
 *
 * FLUXO:
 *   - Client sobe vídeo (rosto) + áudio pro fal.storage → URLs públicas.
 *   - Manda { video_url, audio_url, audio_ms } pra cá.
 *   - O servidor BAIXA as duas URLs e roda o pipeline DreamFace
 *     (upload→registra avatar→submit→poll→resolve MP4), tudo por 1
 *     cookie + 1 IP fixo (proxy), em fila serial (ritmo humano).
 *   - Devolve { success, output_video_url } (MP4 final no OSS).
 *
 * ANTI-BLOQUEIO: ver lib/dreamface-api.ts e lib/dreamface-queue.ts.
 *   O IP do usuário final nunca chega no DreamFace — é tudo server-side.
 *
 * Admin-only (requireAdmin).
 */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/app/api/admin/_helpers';
import {
  generateLipsync,
  isDreamFaceConfigured,
  dreamFaceErrorToHttp,
} from '@/lib/dreamface-api';
import { runOnDreamFaceQueue } from '@/lib/dreamface-queue';

export const runtime = 'nodejs';
export const maxDuration = 300;

interface LipSyncBody {
  video_url?: string;
  audio_url?: string;
  audio_ms?: number;
}

const MAX_VIDEO_BYTES = 300 * 1024 * 1024; // 300MB
const MAX_AUDIO_BYTES = 60 * 1024 * 1024; // 60MB
const MAX_AUDIO_MS = 185_000; // DreamFace limita ~180s

function basename(url: string, fallback: string): string {
  try {
    const p = new URL(url).pathname;
    const b = p.split('/').filter(Boolean).pop();
    return b && b.length <= 80 ? b : fallback;
  } catch {
    return fallback;
  }
}

async function download(
  url: string,
  maxBytes: number,
  label: string,
): Promise<{ buffer: Buffer; contentType: string }> {
  let res: Response;
  try {
    res = await fetch(url, { cache: 'no-store' });
  } catch (e) {
    throw new Error(`Falha ao baixar o ${label} (${e instanceof Error ? e.message : 'rede'}).`);
  }
  if (!res.ok) throw new Error(`Falha ao baixar o ${label} (HTTP ${res.status}).`);
  const ab = await res.arrayBuffer();
  if (ab.byteLength > maxBytes) {
    throw new Error(`O ${label} é grande demais (${(ab.byteLength / 1024 / 1024).toFixed(0)}MB).`);
  }
  if (ab.byteLength === 0) throw new Error(`O ${label} veio vazio.`);
  const contentType = res.headers.get('content-type')?.split(';')[0]?.trim() || '';
  return { buffer: Buffer.from(ab), contentType };
}

export async function POST(req: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  if (!isDreamFaceConfigured()) {
    return NextResponse.json(
      {
        error:
          'DreamFace não configurado no servidor. Defina DREAMFACE_ACCOUNT_ID e DREAMFACE_USER_ID (ver .env.local.example).',
        code: 'config_missing',
      },
      { status: 500 },
    );
  }

  let body: LipSyncBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 });
  }

  const { video_url, audio_url } = body;
  if (!video_url || !audio_url) {
    return NextResponse.json(
      { error: 'video_url e audio_url são obrigatórios.' },
      { status: 400 },
    );
  }

  const audioMs = Number(body.audio_ms);
  if (!Number.isFinite(audioMs) || audioMs <= 0) {
    return NextResponse.json(
      { error: 'audio_ms (duração do áudio em ms) é obrigatório e deve ser > 0.' },
      { status: 400 },
    );
  }
  if (audioMs > MAX_AUDIO_MS) {
    return NextResponse.json(
      { error: `Áudio acima de ${Math.round(MAX_AUDIO_MS / 1000)}s. O DreamFace limita ~180s por geração.` },
      { status: 422 },
    );
  }

  try {
    // Baixa vídeo + áudio em paralelo (URLs públicas do fal — sem proxy,
    // download direto e rápido).
    const [video, audio] = await Promise.all([
      download(video_url, MAX_VIDEO_BYTES, 'vídeo'),
      download(audio_url, MAX_AUDIO_BYTES, 'áudio'),
    ]);

    const result = await runOnDreamFaceQueue(() =>
      generateLipsync({
        videoBuffer: video.buffer,
        videoName: basename(video_url, 'face.mp4'),
        videoType: video.contentType || 'video/mp4',
        audioBuffer: audio.buffer,
        audioName: basename(audio_url, 'voice.mp3'),
        audioType: audio.contentType || 'audio/mpeg',
        audioMs,
      }),
    );

    return NextResponse.json({
      success: true,
      engine: 'dreamface',
      output_video_url: result.url,
      work_id: result.workId,
    });
  } catch (err) {
    const { status, message, code } = dreamFaceErrorToHttp(err);
    console.error('[lipsync API · DreamFace]', code, message);
    return NextResponse.json({ error: message, code }, { status });
  }
}
