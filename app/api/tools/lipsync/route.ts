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
import { serviceClient } from '@/app/api/admin/_helpers';
import { requireToolAccess } from '@/lib/require-tier';
import {
  generateLipsync,
  isDreamFaceConfigured,
  dreamFaceErrorToHttp,
} from '@/lib/dreamface-api';
import { runOnDreamFaceQueue } from '@/lib/dreamface-queue';

export const runtime = 'nodejs';
export const maxDuration = 300;

const OUTPUT_BUCKET = 'lipsync-uploads';

/**
 * Re-hospeda o MP4 do motor no Supabase: o cliente NUNCA vê a URL de
 * origem (privacidade do motor), libera CORS pro pós-processamento
 * client-side, e dá uma URL estável (sem expiração de assinatura).
 */
async function rehostOutput(srcUrl: string, userId: string, workId: string): Promise<string> {
  const r = await fetch(srcUrl, { cache: 'no-store' });
  if (!r.ok) throw new Error(`download do MP4 falhou (${r.status})`);
  const buf = Buffer.from(await r.arrayBuffer());
  const sb = serviceClient();
  await sb.storage.createBucket(OUTPUT_BUCKET, { public: true }).catch(() => {});
  const path = `outputs/${userId}/${Date.now()}-${workId}.mp4`;
  const { error } = await sb.storage
    .from(OUTPUT_BUCKET)
    .upload(path, buf, { contentType: 'video/mp4', upsert: true });
  if (error) throw new Error('re-host Supabase: ' + error.message);
  const { data } = sb.storage.from(OUTPUT_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

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
  const guard = await requireToolAccess('/tools/lipsync', 'pro');
  if (!guard.ok) return guard.response;

  if (!isDreamFaceConfigured()) {
    // Erro de setup (só admin vê) — mantém sem marca do motor por segurança.
    return NextResponse.json(
      {
        error: 'Geração não configurada no servidor (variáveis de ambiente do provedor ausentes).',
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

    // Esconde a origem: re-hospeda o MP4 no Supabase. Se falhar, cai pra
    // URL direta (gerar é melhor que falhar), mas o normal é re-hospedar.
    let outputUrl = result.url;
    try {
      outputUrl = await rehostOutput(result.url, guard.userId, result.workId);
    } catch (e) {
      console.error('[lipsync] re-host falhou, usando URL direta:', e instanceof Error ? e.message : e);
    }

    return NextResponse.json({
      success: true,
      engine: 'autoedit',
      output_video_url: outputUrl,
      work_id: result.workId,
    });
  } catch (err) {
    // `detail` (cru, pode citar o motor) vai SÓ pro log. `message` (sem
    // marca) é o que volta pro cliente.
    const { status, message, code, detail } = dreamFaceErrorToHttp(err);
    console.error('[lipsync API]', code, detail);
    return NextResponse.json({ error: message, code }, { status });
  }
}
