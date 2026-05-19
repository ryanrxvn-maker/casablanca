/**
 * SERVER-ONLY. Geração LTX-2.3 via @gradio/client autenticado, com pool
 * de até 10 contas HF (rotação ilimitada, anti-ban) em ltx-token-pool.
 */

import { Client, handle_file } from '@gradio/client';
import { buildLtxData, LTX_FN, LTX_SPACE } from './ltx-video';
import {
  jitter,
  markOk,
  markQuota,
  markRuntime,
  markUsed,
  nextToken,
  parseRetrySeconds,
  poolSize,
} from './ltx-token-pool';

export type LtxGenInput = {
  prompt: string;
  duration: number;
  width: number;
  height: number;
  enhancePrompt?: boolean;
  seed?: number;
  imageBytes?: Uint8Array | null;
};

export type LtxGenResult =
  | { ok: true; videoUrl: string; seed: number | null }
  | {
      ok: false;
      error: string;
      kind: 'quota' | 'runtime' | 'config' | 'network';
      retrySec?: number;
    };

function classify(msg: string): 'quota' | 'runtime' | 'config' | 'network' {
  const m = msg.toLowerCase();
  if (m.includes('quota') || m.includes('exceeded') || m.includes('rate limit'))
    return 'quota';
  if (m.includes('runtimeerror') || m.includes('worker error')) return 'runtime';
  if (m.includes('fetch') || m.includes('network') || m.includes('timeout'))
    return 'network';
  // Default NUNCA é 'config' — 'config' significa SÓ "nenhum token no
  // servidor" (setado explicitamente no ltxGenerate quando poolSize=0).
  // Erro desconhecido vindo da Space/cliente = runtime (mostra o texto
  // real pro usuário em vez de mentir "configure HF_TOKENS").
  return 'runtime';
}

function pickVideoUrl(data: unknown): string | null {
  const arr = Array.isArray(data) ? data : [data];
  const v = arr[0] as
    | { url?: string; path?: string; video?: { url?: string } }
    | string
    | null;
  if (!v) return null;
  if (typeof v === 'string') return v.startsWith('http') ? v : null;
  if (v.video?.url) return v.video.url;
  if (v.url) return v.url;
  if (v.path && typeof v.path === 'string')
    return `https://lightricks-ltx-2-3.hf.space/gradio_api/file=${v.path}`;
  return null;
}

/**
 * Gera 1 chunk. Percorre o pool: pega a conta livre menos usada, tenta;
 * em quota respeita o cooldown do HF e pula pra próxima conta; só desiste
 * quando TODAS as contas estão sem quota (e diz quando libera).
 */
export async function ltxGenerate(input: LtxGenInput): Promise<LtxGenResult> {
  const size = poolSize();
  if (size === 0) {
    return {
      ok: false,
      kind: 'config',
      error:
        'Nenhum token HF configurado. O ZeroGPU exige auth — configure HF_TOKENS (até 10 contas).',
    };
  }

  let lastErr = 'falha desconhecida';
  let lastKind: 'quota' | 'runtime' | 'config' | 'network' = 'config';

  // No máximo `size` tentativas (1 por conta livre).
  for (let attempt = 0; attempt < size; attempt++) {
    const pick = nextToken();
    if (pick.token === null) {
      const secs = Math.ceil(pick.soonestMs / 1000);
      return {
        ok: false,
        kind: 'quota',
        retrySec: secs,
        error:
          `Todas as ${size} contas estão sem quota ZeroGPU agora. ` +
          `Libera em ~${Math.ceil(secs / 60)} min. Adicione mais contas pra zerar a espera.`,
      };
    }

    const { token, state } = pick;
    markUsed(state);
    if (attempt > 0) await jitter(); // anti-rajada ao trocar de conta

    let app: Awaited<ReturnType<typeof Client.connect>>;
    try {
      app = await Client.connect(LTX_SPACE, { token: token as `hf_${string}` });
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      lastKind = classify(lastErr);
      if (lastKind === 'quota') markQuota(state, parseRetrySeconds(lastErr));
      else markRuntime(state);
      continue;
    }

    const inputImage = input.imageBytes
      ? await handle_file(
          new Blob([input.imageBytes as BlobPart], { type: 'image/jpeg' }),
        )
      : null;

    const data = buildLtxData({
      prompt: input.prompt,
      duration: input.duration,
      width: input.width,
      height: input.height,
      inputImage,
      enhancePrompt: input.enhancePrompt,
      seed: input.seed,
    });

    try {
      const r = (await app.predict(LTX_FN, data)) as { data?: unknown };
      const url = pickVideoUrl(r?.data);
      if (!url) {
        lastErr = 'Space não retornou vídeo.';
        lastKind = 'runtime';
        markRuntime(state);
        continue;
      }
      const seedVal =
        Array.isArray(r?.data) && typeof (r.data as unknown[])[1] === 'number'
          ? ((r.data as unknown[])[1] as number)
          : null;
      markOk(state);
      return { ok: true, videoUrl: url, seed: seedVal };
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      lastKind = classify(lastErr);
      if (lastKind === 'quota') markQuota(state, parseRetrySeconds(lastErr));
      else markRuntime(state);
      continue;
    }
  }

  return { ok: false, error: lastErr, kind: lastKind };
}
