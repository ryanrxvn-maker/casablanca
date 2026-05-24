/**
 * SERVER-ONLY. Separação de áudio via @gradio/client em Space HF.
 *
 * Modelo: Demucs v4 (hybrid transformer) — gold standard pra music source
 * separation. Suporta 4 stems (vocals, drums, bass, other) que agrupamos em
 * 3 entregas mais legíveis pro usuário:
 *   - vocals       → voz isolada
 *   - instrumental → drums + bass + other mixados de volta
 *   - sfx          → "other" puro (efeitos, foley, ambiente)
 *
 * A Space é configurável via env `AUDIO_SEPARATOR_SPACE`. Default usa uma
 * Space pública conhecida de Demucs — se cair, troque pelo env sem deploy.
 *
 * Auth: usa o mesmo pool de tokens HF do LTX-Video (ZeroGPU é gratuito
 * pra contas autenticadas).
 */

import { Client, handle_file } from '@gradio/client';
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
import type { SeparatorStem } from './audio-separator';

const DEFAULT_SPACE = process.env.AUDIO_SEPARATOR_SPACE || 'gradio/audio-separation-mdx';
const DEFAULT_FN = process.env.AUDIO_SEPARATOR_FN || '/predict';

export type SeparateInput = {
  audio: Uint8Array;
  /** Nome original do arquivo (pra MIME inference) */
  filename: string;
};

export type SeparateResult =
  | {
      ok: true;
      stems: Record<SeparatorStem, { url: string }>;
    }
  | {
      ok: false;
      error: string;
      kind: 'quota' | 'runtime' | 'config' | 'network';
      retrySec?: number;
    };

function errText(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>;
    const parts = [o.title, o.message, o.error, o.detail]
      .filter((x) => typeof x === 'string' && x)
      .join(' — ');
    if (parts) return parts;
    try {
      return JSON.stringify(o).slice(0, 400);
    } catch {
      return '[erro não serializável]';
    }
  }
  return String(e);
}

function classify(msg: string): 'quota' | 'runtime' | 'config' | 'network' {
  const m = msg.toLowerCase();
  if (m.includes('quota') || m.includes('exceeded') || m.includes('rate limit'))
    return 'quota';
  if (m.includes('runtimeerror') || m.includes('worker error')) return 'runtime';
  if (m.includes('fetch') || m.includes('network') || m.includes('timeout'))
    return 'network';
  return 'runtime';
}

/**
 * Extrai URLs dos stems da resposta. O formato exato varia por Space —
 * tentamos os mais comuns:
 *   - Array de FileData {url, path}: [vocals, instrumental, sfx]
 *   - Objeto {vocals: FileData, instrumental: FileData, sfx: FileData}
 *
 * Se a Space retornar apenas vocals + instrumental (sem SFX), reusamos
 * o `instrumental` como `sfx` (não ideal — usuário troca de Space pra
 * uma com 4 stems se quiser SFX puro).
 */
function pickStems(
  data: unknown,
  spaceUrl: string,
): Partial<Record<SeparatorStem, string>> | null {
  const toUrl = (v: unknown): string | null => {
    if (!v) return null;
    if (typeof v === 'string') return v.startsWith('http') ? v : null;
    if (typeof v === 'object') {
      const o = v as { url?: string; path?: string };
      if (o.url) return o.url;
      if (o.path) return `${spaceUrl}/gradio_api/file=${o.path}`;
    }
    return null;
  };

  if (Array.isArray(data)) {
    const out: Partial<Record<SeparatorStem, string>> = {};
    if (data[0]) out.vocals = toUrl(data[0]) || undefined;
    if (data[1]) out.instrumental = toUrl(data[1]) || undefined;
    if (data[2]) out.sfx = toUrl(data[2]) || undefined;
    return Object.keys(out).length > 0 ? out : null;
  }
  if (data && typeof data === 'object') {
    const o = data as Record<string, unknown>;
    const out: Partial<Record<SeparatorStem, string>> = {};
    if (o.vocals) out.vocals = toUrl(o.vocals) || undefined;
    if (o.instrumental || o.accompaniment)
      out.instrumental = toUrl(o.instrumental || o.accompaniment) || undefined;
    if (o.sfx || o.other) out.sfx = toUrl(o.sfx || o.other) || undefined;
    return Object.keys(out).length > 0 ? out : null;
  }
  return null;
}

/**
 * Roda uma separação. Percorre o pool de tokens, tenta em cada conta
 * livre; quota → marca cooldown e pula; runtime → marca e continua.
 */
export async function separateAudio(input: SeparateInput): Promise<SeparateResult> {
  const size = poolSize();
  if (size === 0) {
    return {
      ok: false,
      kind: 'config',
      error:
        'Nenhum token HF configurado. Configure HF_TOKENS pra usar o Separador de Áudio.',
    };
  }

  const space = DEFAULT_SPACE;
  const fn = DEFAULT_FN;
  const spaceUrl = `https://${space.replace('/', '-')}.hf.space`;

  let lastErr = 'falha desconhecida';
  let lastKind: 'quota' | 'runtime' | 'config' | 'network' = 'config';

  for (let attempt = 0; attempt < size; attempt++) {
    const pick = nextToken();
    if (pick.token === null) {
      const secs = Math.ceil(pick.soonestMs / 1000);
      return {
        ok: false,
        kind: 'quota',
        retrySec: secs,
        error:
          `Todas as ${size} contas estão sem quota HF agora. ` +
          `Libera em ~${Math.ceil(secs / 60)} min.`,
      };
    }

    const { token, state } = pick;
    markUsed(state);
    if (attempt > 0) await jitter();

    let app: Awaited<ReturnType<typeof Client.connect>>;
    try {
      app = await Client.connect(space, { token: token as `hf_${string}` });
    } catch (e) {
      lastErr = errText(e);
      lastKind = classify(lastErr);
      if (lastKind === 'quota') markQuota(state, parseRetrySeconds(lastErr));
      else markRuntime(state);
      continue;
    }

    // Empacota o áudio como FileData via handle_file
    const mime = input.filename.toLowerCase().endsWith('.wav')
      ? 'audio/wav'
      : input.filename.toLowerCase().endsWith('.m4a')
        ? 'audio/mp4'
        : input.filename.toLowerCase().endsWith('.ogg')
          ? 'audio/ogg'
          : 'audio/mpeg';
    const audioBlob = new Blob([input.audio as BlobPart], { type: mime });
    const audioFile = await handle_file(audioBlob);

    try {
      const r = (await app.predict(fn, [audioFile])) as { data?: unknown };
      const stems = pickStems(r?.data, spaceUrl);
      if (!stems || Object.keys(stems).length === 0) {
        lastErr = 'Space não retornou stems válidos.';
        lastKind = 'runtime';
        markRuntime(state);
        continue;
      }
      // Garante 3 stems — fallback do sfx pro instrumental se Space só retornou 2
      const safeStems: Record<SeparatorStem, { url: string }> = {
        vocals: { url: stems.vocals || '' },
        instrumental: { url: stems.instrumental || '' },
        sfx: { url: stems.sfx || stems.instrumental || '' },
      };
      // Valida que vocals e instrumental existem (mínimo aceitável)
      if (!safeStems.vocals.url || !safeStems.instrumental.url) {
        lastErr = 'Space não retornou voz + instrumental.';
        lastKind = 'runtime';
        markRuntime(state);
        continue;
      }
      markOk(state);
      return { ok: true, stems: safeStems };
    } catch (e) {
      lastErr = errText(e);
      lastKind = classify(lastErr);
      if (lastKind === 'quota') markQuota(state, parseRetrySeconds(lastErr));
      else markRuntime(state);
      continue;
    }
  }

  return { ok: false, error: lastErr, kind: lastKind };
}
