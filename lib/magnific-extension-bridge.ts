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
    // backstop: se o RESULT nunca chegar (SW morto etc.), rejeita em
    // tempo limitado — NUNCA fica pendente pra sempre travando a fila.
    setTimeout(() => {
      if (pending.has(requestId)) {
        pending.delete(requestId);
        reject(new Error('Timeout 6min no generate-image (sem resposta da extensao).'));
      }
    }, 360000);
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
    setTimeout(() => {
      if (pending.has(requestId)) {
        pending.delete(requestId);
        reject(new Error('Timeout 15min no animate-image (sem resposta da extensao).'));
      }
    }, 900000);
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

// ============ MG_RUN_PIPELINE (entrypoint v3.0) ============

export type PipelineTake = {
  idx: number;
  imagePrompt: string;
  videoPrompt?: string;
};

export type PipelineRunPayload = {
  spaceName: string;
  spaceId?: string;
  takes: PipelineTake[];
  imageModel?: ImageModel;
  videoModel?: VideoModel;
  imageConcurrency?: number;
  videoConcurrency?: number;
  aspect?: '9:16' | '16:9' | '1:1';
  imageQuality?: '1K' | '2K';
  videoQuality?: '720p' | '1080p';
  videoDuration?: 5 | 10;
};

export type PipelineRunResult = {
  spaceId: string;
  spaceUrl: string;
  results: Array<{
    idx: number;
    imageUrl: string | null;
    videoUrl: string | null;
    imageStatus: string;
    videoStatus: string | null;
    error: string | null;
  }>;
};

export function runMagnificPipelineExt(
  payload: PipelineRunPayload,
  onProgress?: ProgressFn,
): Promise<PipelineRunResult> {
  installListener();
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('Sem window.'));
      return;
    }
    const requestId = newRequestId('pipe');
    pending.set(requestId, {
      resolveType: 'MG_RUN_PIPELINE_RESULT',
      progressType: 'MG_RUN_PIPELINE_PROGRESS',
      resolve: (d) =>
        resolve({
          spaceId: String(d.spaceId ?? ''),
          spaceUrl: String(d.spaceUrl ?? ''),
          results: Array.isArray(d.results) ? d.results : [],
        }),
      reject,
      onProgress,
    });
    window.postMessage(
      { source: PAGE_SRC, type: 'MG_RUN_PIPELINE', requestId, payload },
      '*',
    );
    // backstop absoluto: o bg corta em 30min e manda RESULT(ok:false);
    // este timeout (35min) so dispara se o RESULT NUNCA chegar (SW
    // morto). Garante que runMagnificPipeline sempre resolve -> a fila
    // do ClickUp Pilot NUNCA congela a noite toda.
    setTimeout(() => {
      if (pending.has(requestId)) {
        pending.delete(requestId);
        reject(new Error('Timeout 35min no pipeline (sem resposta da extensao).'));
      }
    }, 2_100_000);
  });
}

// ============ MG_CREATE_TEMPLATE_SPACE (v3.3.0) ============
//
// Cria automaticamente um TEMPLATE SPACE com N image gens (Nano Banana 2 +
// 9:16 + 1K + Unlimited ON). Cada image gen e LOCK-verified. Pipeline depois
// duplica esse template e usa cada image gen pra criar 1 video gen Kling 2.5
// on-demand por take.

export type CreateTemplatePayload = {
  name?: string;
  pairs?: number; // default 50, max 100
};

export type CreateTemplateResult = {
  spaceId: string;
  url: string;
  name: string;
  imageGenIds: string[];
  pairs: number;
  failed: Array<{ idx: number; error: string }>;
};

export function createMagnificTemplate(
  payload: CreateTemplatePayload,
  onProgress?: ProgressFn,
): Promise<CreateTemplateResult> {
  installListener();
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('Sem window.'));
      return;
    }
    const requestId = newRequestId('tplbuild');
    pending.set(requestId, {
      resolveType: 'MG_CREATE_TEMPLATE_SPACE_RESULT',
      progressType: 'MG_CREATE_TEMPLATE_SPACE_PROGRESS',
      resolve: (d) =>
        resolve({
          spaceId: String(d.spaceId ?? ''),
          url: String(d.url ?? ''),
          name: String(d.name ?? ''),
          imageGenIds: Array.isArray(d.imageGenIds) ? d.imageGenIds : [],
          pairs: Number(d.pairs ?? 0),
          failed: Array.isArray(d.failed) ? d.failed : [],
        }),
      reject,
      onProgress,
    });
    window.postMessage(
      { source: PAGE_SRC, type: 'MG_CREATE_TEMPLATE_SPACE', requestId, payload },
      '*',
    );
    setTimeout(() => {
      if (pending.has(requestId)) {
        pending.delete(requestId);
        reject(new Error('Timeout 35min no create-template (sem resposta da extensao).'));
      }
    }, 2_100_000);
  });
}

// ============ MG_RUN_PIPELINE_TEMPLATE (v3.2.0) ============
//
// Roda pipeline a partir de um TEMPLATE SPACE pre-criado.
// VANTAGEM: pula fase node-creation inteira — duplica template, atribui prompts,
// dispara. Elimina race condition Seedance (modelo errado sob carga) e reduz
// setup de ~5min pra ~20s.
//
// SETUP MANUAL: usuario cria 1x um space com N (>= takes) pares Kling 2.5 LOCK
// usando extension v3.1.7+ e salva o uuid.

export type PipelineTemplatePayload = {
  templateSpaceId: string;        // UUID do space template
  newSpaceName?: string;          // default: "DARKO RUN <iso-datetime>"
  takes: PipelineTake[];
  imageConcurrency?: number;
  videoConcurrency?: number;
  strictLock?: boolean;            // default true — verifica LOCK em cada par antes
};

export type PipelineTemplateResult = PipelineRunResult & {
  templateSpaceId: string;
  creditDelta: number | null;
  creditsBefore: number | null;
  creditsAfter: number | null;
};

export function runMagnificPipelineTemplateExt(
  payload: PipelineTemplatePayload,
  onProgress?: ProgressFn,
): Promise<PipelineTemplateResult> {
  installListener();
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('Sem window.'));
      return;
    }
    const requestId = newRequestId('tpl');
    pending.set(requestId, {
      resolveType: 'MG_RUN_PIPELINE_TEMPLATE_RESULT',
      progressType: 'MG_RUN_PIPELINE_TEMPLATE_PROGRESS',
      resolve: (d) =>
        resolve({
          spaceId: String(d.spaceId ?? ''),
          spaceUrl: String(d.spaceUrl ?? ''),
          templateSpaceId: String(d.templateSpaceId ?? payload.templateSpaceId),
          creditDelta: d.creditDelta ?? null,
          creditsBefore: d.creditsBefore ?? null,
          creditsAfter: d.creditsAfter ?? null,
          results: Array.isArray(d.results) ? d.results : [],
        }),
      reject,
      onProgress,
    });
    window.postMessage(
      { source: PAGE_SRC, type: 'MG_RUN_PIPELINE_TEMPLATE', requestId, payload },
      '*',
    );
    setTimeout(() => {
      if (pending.has(requestId)) {
        pending.delete(requestId);
        reject(new Error('Timeout 35min no pipeline-template (sem resposta da extensao).'));
      }
    }, 2_100_000);
  });
}

/**
 * Aborta QUALQUER pipeline Magnific em andamento na extensao e recarrega
 * a aba Magnific (mata loop/orfao no content-script). Fire-and-forget —
 * usado pelo watchdog/anti-concorrencia antes de disparar o proximo job,
 * pra garantir que NUNCA rode 2 pipelines na mesma aba ao mesmo tempo.
 */
export function abortAllMagnific(): void {
  if (typeof window === 'undefined') return;
  installListener();
  try {
    window.postMessage({ source: PAGE_SRC, type: 'MG_ABORT_ALL' }, '*');
  } catch {
    /* noop */
  }
}

/** Util: converte base64 -> Blob (no browser). */
export function base64ToBlob(base64: string, mime = 'application/octet-stream'): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
