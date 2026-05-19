/**
 * SERVER-ONLY. Fala com a Space LTX-2.3 via @gradio/client autenticado.
 * Raw REST não funciona no ZeroGPU — só o handshake do gradio client com
 * hf_token concede GPU. Aqui fica a rotação de token (pool HF_TOKENS).
 */

import { Client, handle_file } from '@gradio/client';
import { buildLtxData, LTX_FN, LTX_SPACE } from './ltx-video';

export function hfTokens(): string[] {
  const raw =
    process.env.HF_TOKENS ||
    process.env.HF_TOKEN ||
    process.env.HUGGINGFACE_TOKEN ||
    '';
  return raw
    .split(/[,\s]+/)
    .map((t) => t.trim())
    .filter((t) => t.startsWith('hf_'));
}

export type LtxGenInput = {
  prompt: string;
  duration: number;
  width: number;
  height: number;
  enhancePrompt?: boolean;
  seed?: number;
  /** bytes de uma imagem (último frame) p/ continuação image-to-video */
  imageBytes?: Uint8Array | null;
};

export type LtxGenResult =
  | { ok: true; videoUrl: string; seed: number | null; tokenIndex: number }
  | {
      ok: false;
      error: string;
      kind: 'quota' | 'runtime' | 'config' | 'network';
      tokenIndex: number;
      tokenTotal: number;
    };

function classify(msg: string): 'quota' | 'runtime' | 'config' | 'network' {
  const m = msg.toLowerCase();
  if (m.includes('quota') || m.includes('exceeded') || m.includes('rate'))
    return 'quota';
  if (m.includes('runtimeerror') || m.includes('worker error')) return 'runtime';
  if (m.includes('fetch') || m.includes('network') || m.includes('timeout'))
    return 'network';
  return 'config';
}

function pickVideoUrl(data: unknown): string | null {
  const arr = Array.isArray(data) ? data : [data];
  const v = arr[0] as { url?: string; path?: string; video?: { url?: string } } | string | null;
  if (!v) return null;
  if (typeof v === 'string') return v.startsWith('http') ? v : null;
  if (v.video?.url) return v.video.url;
  if (v.url) return v.url;
  if (v.path && typeof v.path === 'string')
    return `https://lightricks-ltx-2-3.hf.space/gradio_api/file=${v.path}`;
  return null;
}

/**
 * Gera 1 chunk. Tenta o token `startIndex`; se a quota estourar, rotaciona
 * automaticamente pelos demais tokens do pool antes de desistir.
 */
export async function ltxGenerate(
  input: LtxGenInput,
  startIndex = 0,
): Promise<LtxGenResult> {
  const pool = hfTokens();
  const total = pool.length;
  if (total === 0) {
    return {
      ok: false,
      kind: 'config',
      tokenIndex: 0,
      tokenTotal: 0,
      error:
        'Nenhum token HF configurado. O ZeroGPU exige auth — configure HF_TOKENS.',
    };
  }

  let lastErr = 'falha desconhecida';
  let lastKind: 'quota' | 'runtime' | 'config' | 'network' = 'config';

  for (let hop = 0; hop < total; hop++) {
    const idx = (startIndex + hop) % total;
    const token = pool[idx] as `hf_${string}`;

    let app: Awaited<ReturnType<typeof Client.connect>>;
    try {
      app = await Client.connect(LTX_SPACE, { token });
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      lastKind = classify(lastErr);
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
        continue;
      }
      const seedVal =
        Array.isArray(r?.data) && typeof (r.data as unknown[])[1] === 'number'
          ? ((r.data as unknown[])[1] as number)
          : null;
      return { ok: true, videoUrl: url, seed: seedVal, tokenIndex: idx };
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      lastKind = classify(lastErr);
      // quota -> tenta próximo token; runtime/config -> idem (pode ser
      // worker daquele token); só desiste quando esgotar o pool.
      continue;
    }
  }

  return {
    ok: false,
    error: lastErr,
    kind: lastKind,
    tokenIndex: startIndex,
    tokenTotal: total,
  };
}
