/**
 * /api/tools/lipsync — INÍCIO (assíncrono) da geração de lipsync via DreamFace.
 *
 * MODO ASSÍNCRONO (por quê): a função serverless da Vercel morre em 300s. Um
 * render de áudio longo no motor passa disso fácil — antes a gente segurava a
 * função esperando o render e ela estourava o timeout (erro "demorou demais"
 * mesmo o motor TENDO concluído). Agora:
 *   1. Este POST só BAIXA os arquivos, SOBE pro motor e SUBMETE o job —
 *      volta em segundos com um TOKEN de job assinado (sem esperar o render).
 *   2. O cliente acompanha o render com GET /api/tools/lipsync/status?job=...
 *      (poll leve), que resolve+re-hospeda o MP4 quando fica pronto.
 * Resultado: a ÚNICA espera vira o render do motor — nada estoura timeout.
 *
 * FLUXO:
 *   - Client sobe vídeo (rosto) + áudio pro Supabase → URLs públicas.
 *   - Manda { video_url, audio_url, audio_ms } pra cá.
 *   - O servidor BAIXA as duas URLs, escolhe a melhor conta do pool e roda o
 *     START (upload→registra avatar→submit), tudo por 1 cookie + 1 IP (proxy).
 *   - Devolve { success, status:'generating', job } — token opaco assinado.
 *
 * ANTI-BLOQUEIO: ver lib/dreamface-api.ts e lib/dreamface-pool.ts.
 *   O IP do usuário final nunca chega no DreamFace — é tudo server-side.
 *
 * Pro + Admin (requireToolAccess('/tools/lipsync','pro')).
 */

import { NextResponse } from 'next/server';
import { requireToolAccess } from '@/lib/require-tier';
import { startLipsync, dreamFaceErrorToHttp } from '@/lib/dreamface-api';
import { runWithDreamFaceAccount, hasAccounts } from '@/lib/dreamface-pool';
import { signLipsyncJob } from '@/lib/lipsync-job-token';
import { safeFetch, SsrfError } from '@/lib/safe-fetch';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * Re-tenta uma leitura idempotente (GET) com backoff. NÃO re-tenta URL
 * bloqueada por SSRF (erro definitivo). Garante que um blip de rede no
 * server→Supabase não derrube o início de uma geração.
 */
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

interface LipSyncBody {
  video_url?: string;
  audio_url?: string;
  audio_ms?: number;
}

const MAX_VIDEO_BYTES = 300 * 1024 * 1024; // 300MB
const MAX_AUDIO_BYTES = 60 * 1024 * 1024; // 60MB
const MAX_AUDIO_MS = 185_000; // DreamFace limita ~180s por geração (por trecho)

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
    // safeFetch: valida a URL do usuário e cada redirect contra destinos
    // internos (anti-SSRF) antes de baixar. Re-tenta blip de rede / 5xx
    // (o storage acabou de receber o upload — às vezes leva 1 retry pra
    // ficar consistente/disponível).
    res = await withRetryServer(async () => {
      const rr = await safeFetch(url, { cache: 'no-store' });
      if (!rr.ok && rr.status >= 500) throw new Error(`HTTP ${rr.status}`);
      return rr;
    });
  } catch (e) {
    if (e instanceof SsrfError) throw new Error(`URL do ${label} não permitida.`);
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

  if (!hasAccounts()) {
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
    // Baixa vídeo + áudio em paralelo (URLs públicas do Supabase).
    const [video, audio] = await Promise.all([
      download(video_url, MAX_VIDEO_BYTES, 'vídeo'),
      download(audio_url, MAX_AUDIO_BYTES, 'áudio'),
    ]);

    // Pool inteligente: escolhe a melhor conta DreamFace (menos ocupada),
    // roda em paralelo com as outras e faz FAILOVER automático se a conta
    // cair (auth/rede) — tenta a próxima conta saudável sozinho. O slot é
    // segurado só durante o START (upload+submit), não durante o render.
    let usedLabel = '';
    const { animateId } = await runWithDreamFaceAccount(async (config, label) => {
      usedLabel = label;
      return startLipsync(
        {
          videoBuffer: video.buffer,
          videoName: basename(video_url, 'face.mp4'),
          videoType: video.contentType || 'video/mp4',
          audioBuffer: audio.buffer,
          audioName: basename(audio_url, 'voice.mp3'),
          audioType: audio.contentType || 'audio/mpeg',
          audioMs,
        },
        config,
      );
    });

    // Token opaco assinado: carrega {conta, animate_id, user} pro /status
    // pollar o MESMO motor — sem banco, válido cross-instância.
    const job = signLipsyncJob({ label: usedLabel, animateId, userId: guard.userId });

    return NextResponse.json({
      success: true,
      engine: 'autoedit',
      status: 'generating',
      job,
    });
  } catch (err) {
    // `detail` (cru, pode citar o motor) vai SÓ pro log. `message` (sem
    // marca) é o que volta pro cliente.
    const { status, message, code, detail } = dreamFaceErrorToHttp(err);
    console.error('[lipsync API]', code, detail);
    return NextResponse.json({ error: message, code }, { status });
  }
}
