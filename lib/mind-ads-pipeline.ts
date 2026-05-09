/**
 * Mind Ads — orquestracao client-side do pipeline.
 *
 * Funcoes utilitarias pra:
 *  - polling de jobs HeyGen e Replicate (sem timeout, com cancelamento)
 *  - geracao de B-rolls em paralelo (imagem -> animacao por take)
 *  - download/blob handling
 */

import type { MindAdsTier } from './mind-ads-models';

export type PipelineSignal = {
  /** Funcao que retorna true se o usuario cancelou */
  isCancelled: () => boolean;
  /** Reporta status atual pra UI */
  onStage?: (msg: string) => void;
  /** Reporta progresso percentual (0..1) — opcional */
  onProgress?: (p: number | null) => void;
};

export class CancelledError extends Error {
  constructor() {
    super('Pipeline cancelado');
    this.name = 'CancelledError';
  }
}

const POLL_INTERVAL_MS = 4_000;

function sleep(ms: number, signal: PipelineSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      if (signal.isCancelled()) reject(new CancelledError());
      else resolve();
    }, ms);
    // checagem opcional periodica em sleeps longos (nao precisa pra 4s)
    if (signal.isCancelled()) {
      clearTimeout(t);
      reject(new CancelledError());
    }
  });
}

/* ===========================================================
 * HeyGen
 * =========================================================== */

export type HeyGenStartInput = {
  avatarId: string;
  copy: string;
  voiceId?: string;
  avatarType?: 'III' | 'IV' | 'V';
};

export async function heygenStart(
  input: HeyGenStartInput,
): Promise<{ videoId: string }> {
  const res = await fetch('/api/mind-ads/heygen/start', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Falha ao iniciar HeyGen.');
  return { videoId: json.videoId };
}

/**
 * Pola o HeyGen ate completar. SEM TIMEOUT — so para se cancelar.
 * Retorna a URL do video final.
 */
export async function heygenPollUntilDone(
  videoId: string,
  signal: PipelineSignal,
): Promise<string> {
  let lastStatus = '';
  for (;;) {
    if (signal.isCancelled()) throw new CancelledError();

    const res = await fetch(
      `/api/mind-ads/heygen/status?id=${encodeURIComponent(videoId)}`,
    );
    const json = (await res.json()) as {
      status?: string;
      videoUrl?: string | null;
      error?: string | null;
    };

    if (!res.ok) {
      throw new Error(json.error || 'Falha no status HeyGen.');
    }

    const status = String(json.status ?? 'unknown');
    if (status !== lastStatus) {
      lastStatus = status;
      signal.onStage?.(`HeyGen: ${status}...`);
    }

    if (status === 'completed' && json.videoUrl) return json.videoUrl;
    if (status === 'failed') {
      throw new Error(json.error || 'HeyGen falhou ao gerar video.');
    }

    await sleep(POLL_INTERVAL_MS, signal);
  }
}

/* ===========================================================
 * Replicate
 * =========================================================== */

async function replicatePoll(
  predictionId: string,
  signal: PipelineSignal,
  label: string,
): Promise<string> {
  let lastStatus = '';
  for (;;) {
    if (signal.isCancelled()) throw new CancelledError();

    const res = await fetch(
      `/api/mind-ads/replicate/status?id=${encodeURIComponent(predictionId)}`,
    );
    const json = (await res.json()) as {
      status?: string;
      outputUrl?: string | null;
      error?: string | null;
    };

    if (!res.ok) {
      throw new Error(json.error || `Falha no status Replicate (${label}).`);
    }

    const status = String(json.status ?? 'unknown');
    if (status !== lastStatus) {
      lastStatus = status;
      signal.onStage?.(`${label}: ${status}...`);
    }

    if (status === 'succeeded' && json.outputUrl) return json.outputUrl;
    if (status === 'failed' || status === 'canceled') {
      throw new Error(
        json.error || `Replicate (${label}) falhou: ${status}.`,
      );
    }

    await sleep(POLL_INTERVAL_MS, signal);
  }
}

export async function replicateImage(
  prompt: string,
  signal: PipelineSignal,
  takeN: number,
  tier: MindAdsTier = 'eco',
): Promise<string> {
  const res = await fetch('/api/mind-ads/replicate/start-image', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt, tier, aspectRatio: '9:16' }),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(
      json.error || `Falha ao iniciar imagem do take ${takeN}.`,
    );
  }
  return replicatePoll(json.predictionId, signal, `Imagem T${takeN}`);
}

export async function replicateVideo(
  imageUrl: string,
  prompt: string,
  signal: PipelineSignal,
  takeN: number,
  duration: 3 | 5 | 7 | 10 = 5,
  tier: MindAdsTier = 'eco',
): Promise<string> {
  const res = await fetch('/api/mind-ads/replicate/start-video', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ imageUrl, prompt, tier, duration }),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(
      json.error || `Falha ao iniciar video do take ${takeN}.`,
    );
  }
  return replicatePoll(json.predictionId, signal, `Animacao T${takeN}`);
}

/* ===========================================================
 * B-roll pipeline (imagem -> video) por take, em paralelo
 * =========================================================== */

export type BrollTake = {
  n: number;
  imagePrompt: string;
  animationPrompt: string;
};

export type BrollResult = {
  n: number;
  imageUrl: string;
  videoUrl: string;
};

/**
 * Gera todos os b-rolls em paralelo. Cada take faz imagem -> video em
 * sequencia. Falhas individuais propagam (cancela o lote inteiro).
 *
 * Concorrencia limitada pra nao estourar rate-limit do Replicate. Com
 * pool=3 dao pra rodar uns 5-8 takes confortavelmente.
 */
export async function generateBrolls(
  takes: BrollTake[],
  signal: PipelineSignal,
  pool = 3,
  tier: MindAdsTier = 'eco',
): Promise<BrollResult[]> {
  const results: BrollResult[] = [];
  let cursor = 0;
  let inFlight = 0;
  let failed: Error | null = null;

  return new Promise((resolve, reject) => {
    const tryDispatch = () => {
      if (failed) return;
      while (inFlight < pool && cursor < takes.length) {
        const take = takes[cursor++];
        inFlight++;
        (async () => {
          try {
            if (signal.isCancelled()) throw new CancelledError();
            const imageUrl = await replicateImage(
              take.imagePrompt,
              signal,
              take.n,
              tier,
            );
            const videoUrl = await replicateVideo(
              imageUrl,
              take.animationPrompt,
              signal,
              take.n,
              5,
              tier,
            );
            results.push({ n: take.n, imageUrl, videoUrl });
          } catch (e) {
            if (!failed) failed = e as Error;
          } finally {
            inFlight--;
            if (failed && inFlight === 0) {
              reject(failed);
              return;
            }
            if (cursor >= takes.length && inFlight === 0) {
              if (failed) reject(failed);
              else resolve(results.sort((a, b) => a.n - b.n));
              return;
            }
            tryDispatch();
          }
        })();
      }
    };
    tryDispatch();
  });
}

/* ===========================================================
 * Download helpers
 * =========================================================== */

/**
 * Baixa uma URL remota como ArrayBuffer (pra alimentar FFmpeg WASM).
 * Usa o proxy /api/mind-ads/proxy pra evitar CORS dos CDNs Replicate/HeyGen.
 */
export async function downloadAsBuffer(
  url: string,
  signal: PipelineSignal,
): Promise<Uint8Array> {
  if (signal.isCancelled()) throw new CancelledError();
  const proxyUrl = `/api/mind-ads/proxy?url=${encodeURIComponent(url)}`;
  const res = await fetch(proxyUrl);
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Falha ao baixar asset: ${t.slice(0, 200)}`);
  }
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

export async function downloadAsBlob(
  url: string,
  signal: PipelineSignal,
  mime = 'video/mp4',
): Promise<Blob> {
  const buf = await downloadAsBuffer(url, signal);
  // Copia pra ArrayBuffer puro pra evitar typing issue
  // (Uint8Array<ArrayBufferLike> nao satisfaz BlobPart em TS strict)
  const copy = new Uint8Array(buf.length);
  copy.set(buf);
  return new Blob([copy.buffer], { type: mime });
}

/* ===========================================================
 * SRT — usa /api/mind-ads/transcribe-srt (Groq + AssemblyAI fallback)
 * =========================================================== */

export async function generateSrtFromAudio(
  audio: Blob,
  copy: string,
  tier: MindAdsTier = 'eco',
): Promise<{ srt: string; provider: string }> {
  // tier eco/padrao tenta Groq primeiro (com fallback AAI), premium vai direto AAI
  const provider = tier === 'premium' ? 'assemblyai' : 'groq';

  const fd = new FormData();
  fd.append('audio', audio, 'avatar.opus');
  fd.append('copy', copy);
  fd.append('provider', provider);

  const res = await fetch('/api/mind-ads/transcribe-srt', {
    method: 'POST',
    body: fd,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Falha ao gerar SRT.');
  return {
    srt: String(json.srt ?? ''),
    provider: String(json.provider ?? provider),
  };
}
