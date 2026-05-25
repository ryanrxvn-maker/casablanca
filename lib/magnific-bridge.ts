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
