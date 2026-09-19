'use client';

import type { DownloaderHistoryJob } from './history';

export type DownloaderMode = 'video' | 'audio-mp3' | 'audio-wav';
export type DownloaderQuality = '1080' | '720' | '480' | 'best';

function bridgeError(raw: unknown): string {
  const value = String(raw || '').trim();
  const lower = value.toLowerCase();
  if (!value) return 'O download falhou agora. Tente novamente em instantes.';
  if (/(user_canceled|cancelado pelo usu)/.test(lower)) return 'Download cancelado no navegador.';
  if (/(engine_offline|não está aberto|nao esta aberto|abra o motor)/.test(lower)) return 'Abra o Auto Edit Downloader no computador e tente novamente.';
  if (/(extension|extensão|recarregue|receiving end|message port)/.test(lower)) return 'A extensão foi atualizada. Volte ao Downloader e clique em Verificar conexão.';
  return value;
}

/** Puxa a fila durável da extensão — inclui página, popup e botão flutuante. */
export function requestDownloaderJobs(timeoutMs = 4000): Promise<DownloaderHistoryJob[]> {
  if (typeof window === 'undefined') return Promise.resolve([]);
  return new Promise((resolve) => {
    const reqId = `hist-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let done = false;
    const finish = (jobs: DownloaderHistoryJob[]) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      resolve(jobs);
    };
    const onMessage = (event: MessageEvent) => {
      const data = event.data;
      if (event.source !== window || event.origin !== window.location.origin ||
        data?.source !== 'darko-dl-ext' || data.type !== 'DL_HISTORY_JOBS' || data.reqId !== reqId) return;
      finish(Array.isArray(data.jobs) ? data.jobs : []);
    };
    const timer = setTimeout(() => finish([]), timeoutMs);
    window.addEventListener('message', onMessage);
    window.postMessage({ source: 'darko-dl', type: 'DL_HISTORY_PULL', reqId }, window.location.origin);
  });
}

/** Dispara novamente uma receita do histórico sem depender dos bytes antigos. */
export function enqueueDownloaderSource(
  input: {
    url: string;
    mode?: DownloaderMode;
    quality?: DownloaderQuality;
    sourceTitle?: string;
    thumbnailUrl?: string;
  },
  onProgress?: (job: DownloaderHistoryJob & { phase?: string; pct?: number }) => void,
): Promise<DownloaderHistoryJob> {
  return new Promise((resolve, reject) => {
    const reqId = `redl-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let settled = false;
    let idleTimer: ReturnType<typeof setTimeout>;
    const cleanup = () => {
      window.removeEventListener('message', onMessage);
      clearTimeout(idleTimer);
      clearTimeout(overallTimer);
    };
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(message));
    };
    const keepAlive = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => fail('A extensão parou de responder. Abra o Downloader e clique em Verificar conexão.'), 120_000);
    };
    const onMessage = (event: MessageEvent) => {
      const data = event.data;
      if (event.source !== window || event.origin !== window.location.origin ||
        data?.source !== 'darko-dl-ext' || data.reqId !== reqId) return;
      if (data.type === 'DL_ENGINE_PROGRESS') {
        keepAlive();
        onProgress?.(data.job || data);
        return;
      }
      if (data.type !== 'DL_ENGINE_RESULT') return;
      if (!data.ok || !data.job) return fail(bridgeError(data.error));
      settled = true;
      cleanup();
      resolve(data.job as DownloaderHistoryJob);
    };
    window.addEventListener('message', onMessage);
    const overallTimer = setTimeout(() => fail('Esse download excedeu uma hora. Tente outra qualidade.'), 60 * 60_000);
    keepAlive();
    window.postMessage({
      source: 'darko-dl',
      type: 'DL_ENGINE_DOWNLOAD',
      reqId,
      url: input.url,
      mode: input.mode || 'video',
      quality: input.quality || '1080',
      sourceTitle: input.sourceTitle,
      thumbnailUrl: input.thumbnailUrl,
    }, window.location.origin);
  });
}
