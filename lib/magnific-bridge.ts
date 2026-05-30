/**
 * magnific-bridge — client-side helper que talk com a extension Freepik Sync
 * via window.postMessage. A extension faz fetch real em magnific.com pelo
 * browser (passa Cloudflare TLS fingerprint).
 *
 * Uso (em "use client" components):
 *   const r = await magnificFetch('/app/api/auth/verify');
 *   const j = await r.json();
 */

let extensionPresent: boolean | null = null;

export type MagnificFetchInit = {
  method?: string;
  headers?: Record<string, string>;
  /** string -> usado as-is; objeto -> JSON.stringify + content-type:application/json */
  body?: string | Record<string, unknown> | unknown[];
};

export class ExtensionNotInstalledError extends Error {
  constructor() {
    super('Extensão Auto Edit · Freepik Sync não detectada. Instale em /configuracoes/magnific.');
    this.name = 'ExtensionNotInstalledError';
  }
}

/** Verifica se a extensão tá instalada e respondendo. Cacheado após primeira chamada. */
export async function isExtensionInstalled(force = false): Promise<boolean> {
  if (!force && extensionPresent !== null) return extensionPresent;
  if (typeof window === 'undefined') return false;

  // Heurística 1: meta tag injetada pelo content script
  const meta = document.querySelector('meta[name="auto-edit-extension"]');
  if (meta) {
    extensionPresent = true;
    return true;
  }

  // Heurística 2: ping ativo
  return new Promise((resolve) => {
    const reqId = `ping-${Math.random().toString(36).slice(2)}`;
    const timeout = setTimeout(() => {
      window.removeEventListener('message', onPong);
      extensionPresent = false;
      resolve(false);
    }, 800);
    function onPong(ev: MessageEvent) {
      const m = ev.data;
      if (!m || m.type !== 'auto-edit-extension-pong' || m.reqId !== reqId) return;
      clearTimeout(timeout);
      window.removeEventListener('message', onPong);
      extensionPresent = true;
      resolve(true);
    }
    window.addEventListener('message', onPong);
    window.postMessage({ type: 'auto-edit-extension-ping', reqId }, '*');
  });
}

/** Fetch em magnific.com via extensão. Retorna Response-like. */
export async function magnificFetch(
  path: string,
  init: MagnificFetchInit = {},
  timeoutMs = 60_000,
): Promise<{
  ok: boolean;
  status: number;
  statusText?: string;
  headers: Record<string, string>;
  /** parse helper — chama JSON.parse no body. Throws se não-json. */
  json: () => unknown;
  /** body raw como string */
  text: () => string;
  url?: string;
}> {
  if (typeof window === 'undefined') {
    throw new Error('magnificFetch só pode ser chamado no client.');
  }
  if (!(await isExtensionInstalled())) {
    throw new ExtensionNotInstalledError();
  }

  return new Promise((resolve, reject) => {
    const reqId = `mfetch-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const t = setTimeout(() => {
      window.removeEventListener('message', onResp);
      reject(new Error(`Timeout (${timeoutMs}ms) chamando magnific via extensão: ${path}`));
    }, timeoutMs);

    function onResp(ev: MessageEvent) {
      const m = ev.data;
      if (!m || m.type !== 'auto-edit-magnific-fetch-response' || m.reqId !== reqId) return;
      clearTimeout(t);
      window.removeEventListener('message', onResp);
      if (m.error) {
        reject(new Error(m.error));
        return;
      }
      const body: string = m.body ?? '';
      // DETECÇÃO DE PAYWALL — REFINADA (2026-05-30):
      // Antes marcávamos QUALQUER HTML como cap exceeded. Mas o Magnific às
      // vezes devolve HTML por outras razões (redirect transitório, página
      // de promo, request fora de hora), sem ser bloqueio real. User
      // comprovou: gerou manual ok mesmo com a gente "detectando paywall".
      //
      // Agora só marca como CAP_EXCEEDED se o HTML tiver MARCADORES
      // CONCRETOS de paywall/upgrade. Caso contrário, deixa passar com
      // erro genérico (caller pode retry).
      const lower = body.trim().toLowerCase();
      const isHtmlResponse = lower.startsWith('<!doctype') || lower.startsWith('<html');
      // Paths "geradores" onde HTML = sinal de paywall/redirect. Atualizado
      // 2026-05-30 pra cobrir nova arquitetura:
      //   - /api/v2/ai/simulate-generation  (preflight)
      //   - /api/render/v4                  (image generation, ARQUITETURA NOVA)
      //   - /api/video/generate             (video generation)
      //   - /api/generate                   (legacy — provavelmente já não é chamado)
      //   - /api/v2/ai/start-tti*           (legacy — não chamamos mais, mas mantido)
      if (
        isHtmlResponse &&
        /api\/(render\/v\d+|video\/generate|generate$|v\d+\/ai\/(start-tti|simulate-generation))/.test(
          path,
        )
      ) {
        const paywallMarkers = [
          'upgrade your plan',
          'cap exceeded',
          'usage limit',
          'limit reached',
          'unlimited cap',
          'you have reached',
          'limite atingido',
          'plano premium',
        ];
        const isRealPaywall = paywallMarkers.some((mk) => lower.includes(mk));
        if (isRealPaywall) {
          reject(new Error('MAGNIFIC_CAP_EXCEEDED: seu limite interno mensal do Magnific acabou'));
          return;
        }
        // HTML genérico (promo, redirect, página normal) — devolve como
        // erro retryable. O pipeline vai tentar de novo (com backoff).
        reject(new Error(
          `Magnific devolveu HTML inesperado em ${path.slice(0, 60)} — ` +
          `provavelmente cache/redirect. Vou tentar de novo. Se persistir, ` +
          `recarregue a aba magnific.com.`,
        ));
        return;
      }
      resolve({
        ok: !!m.ok,
        status: m.status ?? 0,
        statusText: m.statusText,
        headers: m.headers || {},
        url: m.url,
        text: () => body,
        json: () => JSON.parse(body),
      });
    }
    window.addEventListener('message', onResp);
    window.postMessage(
      {
        type: 'auto-edit-magnific-fetch',
        reqId,
        path,
        init,
      },
      '*',
    );
  });
}
