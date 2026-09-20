'use client';

import {
  normalizeStockFrameAccount,
  normalizeStockFramePage,
  type StockFrameAccount,
  type StockFrameFilters,
  type StockFramePage,
  type StockFrameVideo,
} from './stockframe';

type StockFrameStatus = {
  configured: boolean;
  account?: StockFrameAccount;
  error?: string;
  version?: string;
};

type Pending = {
  action: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
  discovery?: ReturnType<typeof setTimeout>;
  connectionTimeout?: ReturnType<typeof setTimeout>;
  deadline: number;
  extensionId?: string;
  candidates: Map<string, string>;
  chunks: Map<number, Uint8Array>;
  bytes: number;
  dispatch: (extensionId: string) => void;
  onProgress?: (message: string, percent?: number) => void;
};

const pending = new Map<string, Pending>();
const MAX_DOWNLOAD = 256 * 1024 * 1024;
const MIN_STOCKFRAME_VERSION = '4.46.1';
let listenerInstalled = false;

function versionAtLeast(version: string, minimum = MIN_STOCKFRAME_VERSION): boolean {
  const actual = version.split('.').map((item) => Number(item));
  const required = minimum.split('.').map((item) => Number(item));
  if (actual.some((item) => !Number.isInteger(item) || item < 0)) return false;
  for (let index = 0; index < Math.max(actual.length, required.length); index++) {
    if ((actual[index] || 0) !== (required[index] || 0)) return (actual[index] || 0) > (required[index] || 0);
  }
  return true;
}

function decodeBase64(value: string): Uint8Array {
  const raw = atob(value);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index++) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

function settle(requestId: string, error?: Error, value?: unknown) {
  const item = pending.get(requestId);
  if (!item) return;
  clearTimeout(item.timeout);
  if (item.discovery) clearTimeout(item.discovery);
  if (item.connectionTimeout) clearTimeout(item.connectionTimeout);
  pending.delete(requestId);
  if (error) item.reject(error); else item.resolve(value);
}

function installListener() {
  if (listenerInstalled || typeof window === 'undefined') return;
  listenerInstalled = true;
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const message = event.data;
    if (message?.source !== 'stockframe-extension' || typeof message.requestId !== 'string') return;
    const item = pending.get(message.requestId);
    if (!item) return;

    if (message.type === 'SF_PONG' && !item.extensionId) {
      if (typeof message.extensionId !== 'string' || !message.extensionId || message.extensionId.length > 128) return;
      item.candidates.set(message.extensionId, String(message.version || '0'));
      if (!item.discovery) {
        item.discovery = setTimeout(() => {
          const choice = [...item.candidates].sort((a, b) => {
            const av = a[1].split('.').map((part) => Number(part) || 0);
            const bv = b[1].split('.').map((part) => Number(part) || 0);
            for (let index = 0; index < Math.max(av.length, bv.length); index++) {
              const diff = (bv[index] || 0) - (av[index] || 0);
              if (diff) return diff;
            }
            return a[0].localeCompare(b[0]);
          })[0];
          if (!choice) return;
          if (!versionAtLeast(choice[1])) {
            settle(message.requestId, new Error(`Atualize a extensão Hey Auto para a versão ${MIN_STOCKFRAME_VERSION} ou superior.`));
            return;
          }
          item.dispatch(choice[0]);
        }, 420);
      }
      return;
    }

    if (!item.extensionId || message.extensionId !== item.extensionId) return;
    if (message.type === 'SF_PROGRESS') {
      // O limite por minuto espera na extensão com progresso. Esse período
      // não é inatividade; preserva um teto absoluto para uma fila travada.
      clearTimeout(item.timeout);
      item.timeout = setTimeout(() => settle(message.requestId, new Error('O StockFrame não concluiu a operação dentro do prazo. Tente novamente.')),
        Math.max(1, Math.min(90_000, item.deadline - Date.now())));
      item.onProgress?.(String(message.payload?.message || 'Baixando do StockFrame…'), Number(message.payload?.percent));
      return;
    }
    if (message.type === 'SF_DOWNLOAD_CHUNK') {
      try {
        const payload = message.payload || {};
        if (item.action !== 'download' || !Number.isInteger(payload.index) || payload.index < 0 ||
            typeof payload.data !== 'string' || payload.data.length > 1_500_000 || item.chunks.has(payload.index)) return;
        const bytes = decodeBase64(payload.data);
        item.bytes += bytes.length;
        if (item.bytes > MAX_DOWNLOAD) throw new Error('O take do StockFrame excede 256 MB.');
        item.chunks.set(payload.index, bytes);
      } catch (error) {
        settle(message.requestId, error instanceof Error ? error : new Error('O download do StockFrame chegou corrompido.'));
      }
      return;
    }
    if (message.type === 'SF_ERROR') {
      settle(message.requestId, new Error(String(message.error || message.payload?.error || 'O StockFrame não concluiu a operação.')));
      return;
    }
    if (message.type === 'SF_RESULT') {
      const result = message.payload || {};
      if (item.action === 'download') {
        const total = Number(result.totalChunks);
        if (!Number.isInteger(total) || total < 1 || total > 512 || item.chunks.size !== total ||
            Array.from({ length: total }, (_, index) => !item.chunks.has(index)).some(Boolean) ||
            (result.bytes !== undefined && (!Number.isInteger(result.bytes) || result.bytes !== item.bytes))) {
          settle(message.requestId, new Error('Faltam partes do download do StockFrame. Tente novamente.'));
          return;
        }
        const blob = new Blob(Array.from({ length: total }, (_, index) => item.chunks.get(index)! as BlobPart), {
          type: typeof result.mimeType === 'string' ? result.mimeType : 'video/mp4',
        });
        settle(message.requestId, undefined, { ...result, blob });
      } else {
        settle(message.requestId, undefined, result);
      }
    }
  });
}

function request<T>(action: string, payload: unknown = {}, options: { timeoutMs?: number; onProgress?: (message: string, percent?: number) => void } = {}): Promise<T> {
  if (typeof window === 'undefined') return Promise.reject(new Error('Abra o Pilot no Chrome com a extensão Hey Auto.'));
  installListener();
  const requestId = `sf_${crypto.randomUUID()}`;
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => settle(requestId, new Error(action === 'download'
      ? 'O download do StockFrame demorou demais. Confira sua cota e tente novamente.'
      : 'A extensão Hey Auto não respondeu. Atualize-a e recarregue o Pilot.')), options.timeoutMs || 45_000);
    const item: Pending = {
      action,
      resolve: (value) => resolve(value as T),
      reject,
      timeout,
      deadline: Date.now() + (options.timeoutMs || 3 * 60_000),
      candidates: new Map(),
      chunks: new Map(),
      bytes: 0,
      onProgress: options.onProgress,
      dispatch: (extensionId) => {
        if (item.extensionId || !pending.has(requestId)) return;
        item.extensionId = extensionId;
        if (item.connectionTimeout) clearTimeout(item.connectionTimeout);
        window.postMessage({ source: 'pilot-stockframe', type: 'SF_REQUEST', requestId, extensionId, action, payload }, window.location.origin);
      },
    };
    pending.set(requestId, item);
    item.connectionTimeout = setTimeout(() => {
      if (!item.extensionId) settle(requestId, new Error('A extensão Hey Auto não respondeu. Atualize-a e recarregue o Pilot.'));
    }, 6000);
    window.postMessage({ source: 'pilot-stockframe', type: 'SF_PING', requestId }, window.location.origin);
  });
}

export async function stockFrameStatus(): Promise<StockFrameStatus> {
  const result = await request<{ configured?: boolean; account?: unknown; error?: string; version?: string }>('status');
  return {
    configured: result.configured === true,
    account: result.account ? normalizeStockFrameAccount(result.account) : undefined,
    error: result.error,
    version: result.version,
  };
}

export async function stockFrameConfigure(apiKey: string): Promise<StockFrameStatus> {
  const key = apiKey.trim();
  if (key.length < 12 || key.length > 1024) throw new Error('Cole uma chave de API válida do seu perfil StockFrame.');
  const result = await request<{ configured?: boolean; account?: unknown }>('configure', { apiKey: key });
  if (!result.configured || !result.account) throw new Error('O StockFrame não confirmou esta conta.');
  return { configured: true, account: normalizeStockFrameAccount(result.account) };
}

export function stockFrameDisconnect(): Promise<{ configured: false }> {
  return request('disconnect');
}

export async function stockFrameList(filters: StockFrameFilters = {}): Promise<StockFramePage> {
  const result = await request<{ data?: unknown }>('list', { filters });
  return normalizeStockFramePage(result.data ?? result, { page: filters.page, perPage: filters.perPage });
}

export async function stockFrameDownload(video: Pick<StockFrameVideo, 'id' | 'title' | 'code'>, onProgress?: (message: string, percent?: number) => void): Promise<File> {
  if (!/^[\w-]{1,180}$/.test(video.id)) throw new Error('Este take não tem um identificador válido para download.');
  const result = await request<{ blob: Blob; filename?: string; mimeType?: string }>('download', { videoId: video.id }, { timeoutMs: 12 * 60_000, onProgress });
  if (!result.blob?.size || result.blob.size > MAX_DOWNLOAD || !result.blob.type.startsWith('video/')) {
    throw new Error('O StockFrame não devolveu um arquivo de vídeo válido.');
  }
  const safeTitle = (video.code || video.title || video.id).replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 90) || video.id;
  const extension = result.blob.type.includes('webm') ? 'webm' : result.blob.type.includes('quicktime') ? 'mov' : 'mp4';
  const filename = typeof result.filename === 'string' && /\.(?:mp4|mov|webm)$/i.test(result.filename)
    ? result.filename.replace(/[\\/:*?"<>|]/g, '-')
    : `StockFrame-${safeTitle}.${extension}`;
  return new File([result.blob], filename, { type: result.blob.type });
}

export { MIN_STOCKFRAME_VERSION };
