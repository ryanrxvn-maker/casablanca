/**
 * Voice Isolator NEURAL (qualidade profissional).
 *
 * Usa Demucs v4 (Meta) via a rota /api/separador-audio → HuggingFace Space.
 * Demucs é state-of-the-art em music source separation — separa vocals dos
 * outros stems (drums/bass/other) com qualidade muito superior ao filtro
 * FFmpeg (highpass+lowpass+afftdn).
 *
 * Diferença audível:
 *   FFmpeg filter → voz com "bolha" de música baixa, artefatos de denoise,
 *                   timbre alterado pelo compand
 *   Demucs neural → voz LIMPA, timbre preservado, sem artefatos
 *
 * Quando usar:
 *   - VA de Avatar (CRÍTICO — voz vai pro HeyGen lipsync)
 *   - Qualquer cenário onde a voz precisa soar natural
 *
 * Quando NÃO usar:
 *   - Áudio sem música de fundo (já é limpo)
 *   - Necessidade de latência <1s (Demucs leva 30s-3min)
 *
 * Cost: gasta quota HF ZeroGPU (limitada por dia/conta). Pool de tokens.
 */

export type NeuralIsolatorOptions = {
  onProgress?: (msg: string, percent?: number) => void;
  /** Timeout total. Default 5 min (Demucs em ZeroGPU é lento). */
  timeoutMs?: number;
};

export type NeuralIsolatorResult = {
  ok: true;
  vocalsBlob: Blob;
  /** Tamanho original do audio mandado */
  inputSize: number;
  /** Tamanho do blob de voz isolada (deve ser ~mesma duração) */
  outputSize: number;
  /** ms total */
  elapsedMs: number;
};

export type NeuralIsolatorError = {
  ok: false;
  error: string;
  kind: 'quota' | 'runtime' | 'config' | 'network' | 'timeout';
  retrySec?: number;
};

/**
 * Isola voz usando Demucs neural. Roda client-side (chama API server).
 *
 * Throws nunca — retorna sempre {ok, ...}. Caller decide se faz fallback.
 */
export async function isolateVoiceNeural(
  audioBlob: Blob,
  opts: NeuralIsolatorOptions = {},
): Promise<NeuralIsolatorResult | NeuralIsolatorError> {
  const t0 = performance.now();
  const timeoutMs = opts.timeoutMs ?? 5 * 60 * 1000;

  if (!audioBlob || audioBlob.size === 0) {
    return { ok: false, kind: 'config', error: 'audio vazio' };
  }

  opts.onProgress?.('Enviando audio pro Demucs neural (Replicate)...', 5);

  // 1. Sobe pro /api/voice-isolate-pro (Replicate Demucs v4 — PRIMARY)
  //    Se falhar, tenta /api/separador-audio (HF Space — FALLBACK)
  const form = new FormData();
  const filename = audioBlob.type.includes('wav') ? 'audio.wav' : 'audio.mp3';
  form.append('audio', audioBlob, filename);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  let vocalsUrl: string | null = null;
  let lastErr: NeuralIsolatorError | null = null;

  // === TENTATIVA 1: Replicate Demucs (PRIMARY — confiável) ===
  try {
    const r = await fetch('/api/voice-isolate-pro', {
      method: 'POST',
      body: form,
      signal: ctrl.signal,
    });
    if (r.ok) {
      const j = (await r.json()) as { vocals_url?: string };
      if (j?.vocals_url) {
        vocalsUrl = j.vocals_url;
        opts.onProgress?.('Demucs Replicate completou. Baixando voz...', 80);
      }
    } else {
      const j = await r.json().catch(() => ({}) as Record<string, unknown>);
      lastErr = {
        ok: false,
        kind: (j as { kind?: NeuralIsolatorError['kind'] })?.kind || 'runtime',
        error: (j as { error?: string })?.error || `HTTP ${r.status}`,
      };
      console.warn('[isolator-neural] Replicate falhou:', lastErr.error);
    }
  } catch (e) {
    const isAbort = (e as Error)?.name === 'AbortError';
    lastErr = {
      ok: false,
      kind: isAbort ? 'timeout' : 'network',
      error: `Replicate request falhou: ${(e as Error)?.message}`,
    };
  }

  // === TENTATIVA 2 (fallback): HF Space via /api/separador-audio ===
  if (!vocalsUrl) {
    opts.onProgress?.('Replicate indisponível — tentando HF Space...', 30);
    try {
      // Cria FormData novo pq o anterior já foi consumido pelo fetch
      const form2 = new FormData();
      form2.append('audio', audioBlob, filename);
      const r = await fetch('/api/separador-audio', {
        method: 'POST',
        body: form2,
        signal: ctrl.signal,
      });
      if (r.ok) {
        const j = (await r.json()) as { stems?: { vocals?: { url: string } } };
        if (j?.stems?.vocals?.url) {
          vocalsUrl = j.stems.vocals.url;
          opts.onProgress?.('HF Demucs completou. Baixando voz...', 80);
        }
      } else {
        const j = await r.json().catch(() => ({}) as Record<string, unknown>);
        lastErr = {
          ok: false,
          kind: (j as { kind?: NeuralIsolatorError['kind'] })?.kind || 'runtime',
          retrySec: (j as { retrySec?: number })?.retrySec,
          error: (j as { error?: string })?.error || `HTTP ${r.status}`,
        };
      }
    } catch (e) {
      const isAbort = (e as Error)?.name === 'AbortError';
      if (!lastErr) {
        lastErr = {
          ok: false,
          kind: isAbort ? 'timeout' : 'network',
          error: `HF request falhou: ${(e as Error)?.message}`,
        };
      }
    }
  }

  clearTimeout(timer);

  if (!vocalsUrl) {
    return lastErr || {
      ok: false,
      kind: 'runtime',
      error: 'Nenhum provedor de neural isolation respondeu OK',
    };
  }

  opts.onProgress?.('Baixando voz isolada...', 90);

  // 2. Baixa o stem vocals (URL é HuggingFace Space — pode demorar)
  let vocalsBlob: Blob;
  try {
    const r = await fetch(vocalsUrl);
    if (!r.ok) {
      return {
        ok: false,
        kind: 'network',
        error: `Falha download vocals: HTTP ${r.status}`,
      };
    }
    vocalsBlob = await r.blob();
  } catch (e) {
    return {
      ok: false,
      kind: 'network',
      error: 'Falha ao baixar vocals: ' + (e as Error)?.message,
    };
  }

  if (vocalsBlob.size < 1024) {
    return {
      ok: false,
      kind: 'runtime',
      error: `Vocals blob muito pequeno (${vocalsBlob.size}b) — provavelmente vazio`,
    };
  }

  opts.onProgress?.('Voz isolada (Demucs neural) — qualidade pro.', 100);

  return {
    ok: true,
    vocalsBlob,
    inputSize: audioBlob.size,
    outputSize: vocalsBlob.size,
    elapsedMs: performance.now() - t0,
  };
}
