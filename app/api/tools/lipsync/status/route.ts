/**
 * GET /api/tools/lipsync/status?job=<token> — POLL leve do render assíncrono.
 *
 * O POST /api/tools/lipsync submete o job e volta na hora com um token assinado.
 * O cliente chama ESTE endpoint a cada poucos segundos até ficar pronto. Cada
 * chamada é barata (1 request ao motor) e NUNCA segura a função esperando o
 * render — por isso nada estoura o teto de 300s da Vercel.
 *
 * Respostas (sempre HTTP 200 nos estados conhecidos, pra o cliente ler o body):
 *   { status: 'generating' }                          → ainda renderizando
 *   { status: 'done', output_video_url }              → pronto (MP4 re-hospedado)
 *   { status: 'failed', error, code }                 → motor reportou falha real
 * HTTP != 200 só em erro de setup/autorização (token inválido, sem permissão).
 *
 * Pro + Admin (requireToolAccess('/tools/lipsync','pro')).
 */

import { NextResponse } from 'next/server';
import { serviceClient } from '@/app/api/admin/_helpers';
import { requireToolAccess } from '@/lib/require-tier';
import { checkLipsyncStatus, resolveMp4, dreamFaceErrorToHttp } from '@/lib/dreamface-api';
import { getAccountConfigByLabel } from '@/lib/dreamface-pool';
import { verifyLipsyncJob } from '@/lib/lipsync-job-token';

export const runtime = 'nodejs';
export const maxDuration = 60;

const OUTPUT_BUCKET = 'lipsync-uploads';

/** Mensagem (sem marca do motor) pra falha definitiva de geração. */
const FAILED_MSG =
  'A geração falhou. Use um vídeo com rosto frontal nítido e um áudio limpo, e tenta de novo.';

async function withRetryServer<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let last: unknown;
  for (let i = 1; i <= tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (i >= tries) break;
      await new Promise((r) => setTimeout(r, 500 * i));
    }
  }
  throw last;
}

/**
 * Re-hospeda o MP4 do motor no Supabase: o cliente NUNCA vê a URL de origem
 * (privacidade do motor), libera CORS, e dá uma URL estável (sem expiração).
 */
async function rehostOutput(srcUrl: string, userId: string, workId: string): Promise<string> {
  const r = await withRetryServer(async () => {
    const rr = await fetch(srcUrl, { cache: 'no-store' });
    if (!rr.ok) throw new Error(`download do MP4 falhou (${rr.status})`);
    return rr;
  });
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

export async function GET(req: Request) {
  const guard = await requireToolAccess('/tools/lipsync', 'pro');
  if (!guard.ok) return guard.response;

  const token = new URL(req.url).searchParams.get('job');
  const job = verifyLipsyncJob(token);
  if (!job) {
    return NextResponse.json(
      { status: 'error', error: 'Sessão de geração inválida ou expirada. Dispara de novo.', code: 'bad_job' },
      { status: 400 },
    );
  }
  // O job tem que ser do próprio usuário logado (defesa extra além da assinatura).
  if (job.userId !== guard.userId) {
    return NextResponse.json({ status: 'error', error: 'Não autorizado.', code: 'forbidden' }, { status: 403 });
  }

  const config = getAccountConfigByLabel(job.label);
  if (!config) {
    // Conta sumiu do pool (env mudou) — trata como ainda gerando; o cliente
    // re-tenta. Raríssimo e auto-recupera.
    return NextResponse.json({ status: 'generating' });
  }

  try {
    const st = await checkLipsyncStatus(config, job.animateId);

    if (st.status === 'generating') {
      return NextResponse.json({ status: 'generating' });
    }
    if (st.status === 'failed') {
      return NextResponse.json({ status: 'failed', error: FAILED_MSG, code: 'generation_failed' });
    }

    // done → resolve a URL do MP4 e re-hospeda no Supabase.
    const srcUrl = await resolveMp4(config, st.workId!);
    let outputUrl = srcUrl;
    try {
      outputUrl = await rehostOutput(srcUrl, guard.userId, st.workId!);
    } catch (e) {
      // Re-host falhou: cai pra URL direta (entregar é melhor que falhar).
      console.error('[lipsync status] re-host falhou, usando URL direta:', e instanceof Error ? e.message : e);
    }
    return NextResponse.json({ status: 'done', output_video_url: outputUrl, work_id: st.workId });
  } catch (err) {
    const { message, code, detail } = dreamFaceErrorToHttp(err);
    console.error('[lipsync status]', code, detail);
    // Erro TRANSITÓRIO no poll (rede/auth/instabilidade do motor) NÃO é falha
    // da geração — o render segue lá. Devolve 'generating' pra o cliente
    // continuar pollando (o job não se perde por um blip).
    if (code === 'auth' || code === 'api_error' || code === 'bad_response' || code === 'internal') {
      return NextResponse.json({ status: 'generating' });
    }
    // Erro definitivo (no_output_url, timeout do resolve, etc) → falha real.
    return NextResponse.json({ status: 'failed', error: message, code });
  }
}
