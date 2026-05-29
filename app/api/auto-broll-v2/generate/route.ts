/**
 * POST /api/auto-broll-v2/generate
 *
 * Auto B-roll v2 — server-side via API direta do Magnific.com.
 * Bypass total da extension/UI automation. 10x mais rápido + 100% robusto.
 *
 * Body:
 * {
 *   "takes": [
 *     { "imagePrompt": "...", "videoPrompt": "..." },
 *     ...
 *   ],
 *   "imageConcurrency": 12,  // max image gens simultâneos (Magnific limit)
 *   "videoConcurrency": 6    // max video gens simultâneos (Kling limit)
 * }
 *
 * Response: JSON com URLs finais por take + métricas.
 *
 * Pipeline:
 *   1. Dispara N images em paralelo (limit 12 simultâneos)
 *   2. Conforme cada image pronta, ENFILEIRA video pro Kling (limit 6 simultâneos)
 *   3. Pipeline image+video por take roda end-to-end paralelo respeitando limites
 *
 * Auth: lê cookies Magnific do user (salvos via /api/auto-broll-v2/save-creds).
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireTier } from '@/lib/require-tier';
import {
  generateImage,
  generateVideoFromImage,
  assertZeroCreditCost,
  createBatchPoller,
  type MagnificCreds,
} from '@/lib/magnific-api-server';
import { decryptSecret } from '@/lib/secrets';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5min de Vercel cap
export const dynamic = 'force-dynamic';

type TakeInput = {
  imagePrompt: string;
  videoPrompt?: string;
};

type TakeResult = {
  idx: number;
  imagePrompt: string;
  videoPrompt: string;
  imageUrl?: string;
  videoUrl?: string;
  imageMs?: number;
  videoMs?: number;
  error?: string;
};

/**
 * Semaphore simples — limita N operações simultâneas.
 * Usado pra respeitar limites Magnific: 12 image gens / 6 video gens.
 */
class Semaphore {
  private active = 0;
  private queue: Array<() => void> = [];
  constructor(public readonly max: number) {}
  async acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
    this.active++;
  }
  release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }
}

export async function POST(req: NextRequest) {
  const gate = await requireTier('pro');
  if (!gate.ok) return gate.response;
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
  }
  const userId = userData.user.id;

  let body: { takes?: TakeInput[]; imageConcurrency?: number; videoConcurrency?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }
  const takes = Array.isArray(body.takes) ? body.takes : [];
  if (takes.length === 0) {
    return NextResponse.json({ error: 'Nenhum take fornecido' }, { status: 400 });
  }
  // Limites Magnific descobertos via captura live:
  //   - start-tti-v2 reserva 24 tokens, mas Magnific UI faz ~12 simultâneo
  //   - Kling 2.5: 6 simultâneo no UI (semáforo na extension também era 6)
  const imageConcurrency = Math.max(1, Math.min(12, body.imageConcurrency || 12));
  const videoConcurrency = Math.max(1, Math.min(6, body.videoConcurrency || 6));

  // Carrega creds
  const { data: credsRow } = await supabase
    .from('user_secrets')
    .select('magnific_cookie, magnific_xsrf_token, magnific_user_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (!credsRow?.magnific_cookie || !credsRow?.magnific_user_id) {
    return NextResponse.json(
      {
        error:
          'Credenciais Magnific não configuradas. Vá em /configuracoes/magnific pra configurar.',
      },
      { status: 412 },
    );
  }
  // Decifra cookie + xsrf
  let creds: MagnificCreds;
  try {
    creds = {
      cookie: decryptSecret(credsRow.magnific_cookie),
      xsrfToken: credsRow.magnific_xsrf_token
        ? decryptSecret(credsRow.magnific_xsrf_token)
        : '',
      userId: credsRow.magnific_user_id,
    };
  } catch (e) {
    return NextResponse.json(
      {
        error:
          'Falha ao decifrar credenciais. Reconfigure em /configuracoes/magnific. ' +
          (e instanceof Error ? e.message : String(e)),
      },
      { status: 500 },
    );
  }

  // 🛡️ GUARD: confirma Unlimited mode + simula custo zero ANTES de disparar.
  // Se algo gastaria créditos, ABORTA (412) antes de tocar quota.
  try {
    const guard = await assertZeroCreditCost(creds);
    if (guard.status.usagePercent >= 100) {
      return NextResponse.json(
        {
          error: `Quota Unlimited estourada (${guard.status.usagePercent}%). Throttle ativo — disparar pode falhar. Reset em ${guard.status.cycleResetDate || 'breve'}.`,
        },
        { status: 429 },
      );
    }
  } catch (e) {
    return NextResponse.json(
      {
        error:
          'Guard anti-créditos REJEITOU disparo: ' +
          (e instanceof Error ? e.message : String(e)),
      },
      { status: 402 },
    );
  }

  // 2 semáforos separados — respeita limites real do Magnific
  const imgSem = new Semaphore(imageConcurrency);
  const vidSem = new Semaphore(videoConcurrency);

  // 1 poller batch compartilhado (1 GET /creations?ids[]=... pra TODOS os
  // identifiers ativos por ciclo, em vez de 1 GET por creation).
  const poller = createBatchPoller(creds);

  const results: TakeResult[] = takes.map((t, i) => ({
    idx: i + 1,
    imagePrompt: t.imagePrompt,
    videoPrompt: t.videoPrompt || t.imagePrompt,
  }));

  // Dispara N takes em paralelo. Cada take faz image (sem semáforo de
  // pair, mas com semáforo image) → video (semáforo video). Image e video
  // de diferentes takes podem rodar simultâneos respeitando os limites.
  try {
  await Promise.all(
    takes.map(async (take, i) => {
      const t0 = Date.now();
      try {
        // === IMAGE ===
        await imgSem.acquire();
        let imageUrl: string;
        try {
          const img = await generateImage(creds, {
            prompt: take.imagePrompt,
            aspectRatio: '9:16',
            resolution: '1k',
            smartPrompt: true,
          }, poller);
          if (img.status !== 'completed' || !img.url) {
            results[i].error = `Image falhou: ${img.status}`;
            results[i].imageMs = Date.now() - t0;
            return;
          }
          imageUrl = img.url;
          results[i].imageUrl = imageUrl;
          results[i].imageMs = Date.now() - t0;
        } finally {
          imgSem.release();
        }

        // === VIDEO ===
        const tVid = Date.now();
        await vidSem.acquire();
        try {
          const vid = await generateVideoFromImage(creds, {
            prompt: take.videoPrompt || take.imagePrompt,
            startImageUrl: imageUrl,
            aspectRatio: '9:16',
            resolution: '720p',
            duration: 10,
          }, poller);
          if (vid.status !== 'completed' || !vid.url) {
            results[i].error = `Video falhou: ${vid.status}`;
            results[i].videoMs = Date.now() - tVid;
            return;
          }
          results[i].videoUrl = vid.url;
          results[i].videoMs = Date.now() - tVid;
        } finally {
          vidSem.release();
        }
      } catch (e) {
        results[i].error = e instanceof Error ? e.message : String(e);
      }
    }),
  );
  } finally {
    // Encerra o loop de batch polling
    poller.stop();
  }

  return NextResponse.json({
    total: takes.length,
    success: results.filter((r) => r.videoUrl).length,
    failed: results.filter((r) => r.error).length,
    imageConcurrency,
    videoConcurrency,
    results,
  });
}
