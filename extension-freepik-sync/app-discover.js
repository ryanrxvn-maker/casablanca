/**
 * app-discover.js — content script
 *
 * Roda em qualquer URL onde o app Auto Edit pode estar (dominios
 * proprios, localhost). Dois jobs:
 *
 * 1) DISCOVERY: verifica se a pagina é o app via meta tag
 *    <meta name="auto-edit-app" content="true">. Se for, registra
 *    location.origin no background pra ser usado como endpoint nos syncs.
 *
 * 2) MAGNIFIC PROXY: bridge entre window.postMessage (page) e chrome.runtime
 *    (background). O page chama window.postMessage({type:'auto-edit-magnific-fetch',
 *    reqId, path, init}) e recebe resposta via window.postMessage de volta.
 *    Background usa fetch em contexto browser real -> passa Cloudflare.
 *
 * Tambem expõe um ping pra page detectar se extensao ta instalada.
 */

(() => {
  /* ────────── 1) Discovery ────────── */
  try {
    const meta = document.querySelector('meta[name="auto-edit-app"]');
    if (meta) {
      const content = meta.getAttribute('content') || '';
      if (content === 'true' || content === '1' || content === '') {
        chrome.runtime.sendMessage(
          { type: 'register-app-origin', origin: location.origin },
          () => {
            if (chrome.runtime.lastError) {
              /* background dormindo — ignora */
            }
          },
        );
      }
    }
  } catch (e) {
    console.warn('[auto-edit-discover]', e);
  }

  /* ────────── 2) Magnific proxy bridge ────────── */

  // Anuncia presenca pra page (page pode esperar este evento OU consultar window var)
  try {
    const tag = document.createElement('meta');
    tag.name = 'auto-edit-extension';
    tag.content = '1.0.8';
    (document.head || document.documentElement).appendChild(tag);
    window.dispatchEvent(
      new CustomEvent('auto-edit-extension-ready', {
        detail: { version: '1.0.8' },
      }),
    );
  } catch (e) {
    /* noop */
  }

  // Listener para requests vindas do page
  window.addEventListener('message', (ev) => {
    if (ev.source !== window) return;
    const msg = ev.data;
    if (!msg || typeof msg !== 'object') return;

    // PING — page detecta extensao
    if (msg.type === 'auto-edit-extension-ping') {
      window.postMessage(
        { type: 'auto-edit-extension-pong', version: '1.0.8', reqId: msg.reqId },
        '*',
      );
      return;
    }

    // FETCH magnific via background
    if (msg.type === 'auto-edit-magnific-fetch' && msg.reqId) {
      const reqId = msg.reqId;
      chrome.runtime.sendMessage(
        {
          type: 'magnific-fetch',
          path: msg.path,
          init: msg.init || {},
        },
        (resp) => {
          if (chrome.runtime.lastError) {
            window.postMessage(
              {
                type: 'auto-edit-magnific-fetch-response',
                reqId,
                error: chrome.runtime.lastError.message || 'Erro de extensão',
              },
              '*',
            );
            return;
          }
          window.postMessage(
            {
              type: 'auto-edit-magnific-fetch-response',
              reqId,
              ...resp,
            },
            '*',
          );
        },
      );
    }
  });
})();
