/**
 * Bridge entre DARKO LAB <-> Chrome Extension "DARKO LAB Magnific Auto".
 *
 * Protocolo (window.postMessage):
 *
 * Page -> Extension:
 *   { source: 'darkolab-magnific', type: 'MG_PING' }
 *   { source: 'darkolab-magnific', type: 'MG_TEST_SESSION', requestId }
 *   { source: 'darkolab-magnific', type: 'MG_CREATE_SPACE', requestId, payload: { name } }
 *   { source: 'darkolab-magnific', type: 'MG_GENERATE_IMAGE', requestId, payload: { spaceId, prompt, model } }
 *   { source: 'darkolab-magnific', type: 'MG_ANIMATE_IMAGE', requestId, payload: { spaceId, imageGenerationId, prompt, model } }
 *   { source: 'darkolab-magnific', type: 'MG_DOWNLOAD_ASSET', requestId, payload: { url } }
 *
 * Extension -> Page:
 *   { source: 'darkolab-magnific-ext', type: 'MG_PONG', version }
 *   { source: 'darkolab-magnific-ext', type: 'MG_TEST_SESSION_RESULT', requestId, ok, error?, endpoint? }
 *   { source: 'darkolab-magnific-ext', type: 'MG_CREATE_SPACE_RESULT', requestId, ok, spaceId?, url?, error? }
 *   { source: 'darkolab-magnific-ext', type: 'MG_GENERATE_IMAGE_PROGRESS', requestId, stage, percent, message }
 *   { source: 'darkolab-magnific-ext', type: 'MG_GENERATE_IMAGE_RESULT', requestId, ok, generationId?, imageUrl?, error? }
 *   { source: 'darkolab-magnific-ext', type: 'MG_ANIMATE_IMAGE_PROGRESS', requestId, stage, percent, message }
 *   { source: 'darkolab-magnific-ext', type: 'MG_ANIMATE_IMAGE_RESULT', requestId, ok, videoGenerationId?, videoUrl?, error? }
 *   { source: 'darkolab-magnific-ext', type: 'MG_DOWNLOAD_ASSET_RESULT', requestId, ok, base64?, size?, error? }
 */

export type MagnificExtensionStatus =
  | { connected: true; version: string }
  | { connected: false };

export type ImageModel = 'nano-banana-2' | 'nano-banana-pro' | 'text-to-image-fast' | 'text-to-image-flux';
// Kling ids reais descobertos via /app/api/video/ai-models:
//   kling-25 (Kling 2.5) | kling-26 (Kling 2.6) | kling-21 | kling-21-master | kling-omni1
export type VideoModel = 'kling-25' | 'kling-26' | 'kling-21' | 'kling-21-master' | 'kling-omni1';

export type ProgressFn = (stage: string, percent: number, message: string) => void;

const PAGE_SRC = 'darkolab-magnific';
const EXT_SRC = 'darkolab-magnific-ext';

let listenerInstalled = false;
type Pending = {
  resolveType: string;
  resolve: (data: any) => void;
  reject: (e: Error) => void;
  onProgress?: ProgressFn;
  progressType?: string;
};
const pending = new Map<string, Pending>();

function installListener() {
  if (listenerInstalled || typeof window === 'undefined') return;
  listenerInstalled = true;
  window.addEventListener('message', (ev: MessageEvent) => {
    const data = ev.data;
    if (!data || typeof data !== 'object') return;
    if (data.source !== EXT_SRC) return;
    const requestId = String(data.requestId ?? '');
    if (!requestId) return;
    const p = pending.get(requestId);
    if (!p) return;

    if (p.progressType && data.type === p.progressType) {
      p.onProgress?.(
        String(data.stage ?? ''),
        Number(data.percent ?? 0),
        String(data.message ?? ''),
      );
      return;
    }
    if (data.type === p.resolveType) {
      pending.delete(requestId);
      if (data.ok === false) {
        p.reject(new Error(String(data.error ?? 'Extension reportou erro.')));
      } else {
        p.resolve(data);
      }
    }
  });
}

function newRequestId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Detecta extension Magnific instalada + ativa. Retorna em ate 700ms.
 */
export function detectMagnificExtension(): Promise<MagnificExtensionStatus> {
  installListener();
  return new Promise((resolve) => {
    if (typeof window === 'undefined') {
      resolve({ connected: false });
      return;
    }
    let resolved = false;
    const handler = (ev: MessageEvent) => {
      if (
        ev.data &&
        ev.data.source === EXT_SRC &&
        ev.data.type === 'MG_PONG'
      ) {
        resolved = true;
        window.removeEventListener('message', handler);
        resolve({ connected: true, version: String(ev.data.version ?? '?') });
      }
    };
    window.addEventListener('message', handler);
    window.postMessage({ source: PAGE_SRC, type: 'MG_PING' }, '*');
    setTimeout(() => {
      if (!resolved) {
        window.removeEventListener('message', handler);
        resolve({ connected: false });
      }
    }, 700);
  });
}

/**
 * Testa se a sessao do Magnific (cookies) esta valida. Faz uma chamada
 * leve via content-script com credentials:include.
 */
export function testMagnificSession(): Promise<{ ok: boolean; detail?: string; endpoint?: string }> {
  installListener();
  return new Promise((resolve) => {
    if (typeof window === 'undefined') {
      resolve({ ok: false, detail: 'Sem window.' });
      return;
    }
    const requestId = newRequestId('test');
    pending.set(requestId, {
      resolveType: 'MG_TEST_SESSION_RESULT',
      resolve: (d) => resolve({ ok: !!d.ok, detail: d.detail ?? d.endpoint, endpoint: d.endpoint }),
      reject: (e) => resolve({ ok: false, detail: e.message }),
    });
    window.postMessage({ source: PAGE_SRC, type: 'MG_TEST_SESSION', requestId }, '*');
    setTimeout(() => {
      if (pending.has(requestId)) {
        pending.delete(requestId);
        resolve({ ok: false, detail: 'Extension nao respondeu em 12s.' });
      }
    }, 12000);
  });
}

/**
 * Cria um Space novo no Magnific. Returns { spaceId, url }.
 * Endpoints reais ainda nao 100% mapeados — pode falhar e cair em fallback.
 */
export function createMagnificSpace(name: string): Promise<{ spaceId: string; url: string }> {
  installListener();
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('Sem window.'));
      return;
    }
    const requestId = newRequestId('space');
    pending.set(requestId, {
      resolveType: 'MG_CREATE_SPACE_RESULT',
      resolve: (d) => resolve({ spaceId: String(d.spaceId ?? ''), url: String(d.url ?? '') }),
      reject,
    });
    window.postMessage(
      { source: PAGE_SRC, type: 'MG_CREATE_SPACE', requestId, payload: { name } },
      '*',
    );
    setTimeout(() => {
      if (pending.has(requestId)) {
        pending.delete(requestId);
        reject(new Error('Timeout 30s aguardando create-space.'));
      }
    }, 30000);
  });
}

export type GenerateImagePayload = {
  spaceId?: string;
  prompt: string;
  model?: ImageModel;
};

export function generateMagnificImage(
  payload: GenerateImagePayload,
  onProgress?: ProgressFn,
): Promise<{ generationId: string; imageUrl: string }> {
  installListener();
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('Sem window.'));
      return;
    }
    const requestId = newRequestId('img');
    pending.set(requestId, {
      resolveType: 'MG_GENERATE_IMAGE_RESULT',
      progressType: 'MG_GENERATE_IMAGE_PROGRESS',
      resolve: (d) =>
        resolve({
          generationId: String(d.generationId ?? ''),
          imageUrl: String(d.imageUrl ?? ''),
        }),
      reject,
      onProgress,
    });
    window.postMessage(
      { source: PAGE_SRC, type: 'MG_GENERATE_IMAGE', requestId, payload },
      '*',
    );
    // sem timeout — bg ja tem 3min
  });
}

export type AnimateImagePayload = {
  spaceId?: string;
  imageGenerationId?: string;
  imageUrl?: string;
  prompt?: string;
  model?: VideoModel;
};

export function animateMagnificImage(
  payload: AnimateImagePayload,
  onProgress?: ProgressFn,
): Promise<{ videoGenerationId: string; videoUrl: string }> {
  installListener();
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('Sem window.'));
      return;
    }
    const requestId = newRequestId('vid');
    pending.set(requestId, {
      resolveType: 'MG_ANIMATE_IMAGE_RESULT',
      progressType: 'MG_ANIMATE_IMAGE_PROGRESS',
      resolve: (d) =>
        resolve({
          videoGenerationId: String(d.videoGenerationId ?? ''),
          videoUrl: String(d.videoUrl ?? ''),
        }),
      reject,
      onProgress,
    });
    window.postMessage(
      { source: PAGE_SRC, type: 'MG_ANIMATE_IMAGE', requestId, payload },
      '*',
    );
    // bg timeout 10min
  });
}

/** Baixa um asset via content-script (cookies Magnific incluidos) -> base64 */
export function downloadMagnificAsset(url: string): Promise<{ base64: string; size: number }> {
  installListener();
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('Sem window.'));
      return;
    }
    const requestId = newRequestId('dl');
    pending.set(requestId, {
      resolveType: 'MG_DOWNLOAD_ASSET_RESULT',
      resolve: (d) =>
        resolve({ base64: String(d.base64 ?? ''), size: Number(d.size ?? 0) }),
      reject,
    });
    window.postMessage(
      { source: PAGE_SRC, type: 'MG_DOWNLOAD_ASSET', requestId, payload: { url } },
      '*',
    );
    setTimeout(() => {
      if (pending.has(requestId)) {
        pending.delete(requestId);
        reject(new Error('Timeout 130s no download.'));
      }
    }, 130000);
  });
}

/** Util: converte base64 -> Blob (no browser). */
export function base64ToBlob(base64: string, mime = 'application/octet-stream'): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
