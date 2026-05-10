/**
 * DARKO LAB Extension - Bridge content script
 * Roda em darkolab.vercel.app e localhost. Faz a ponte entre a pagina
 * (window.postMessage) e o background worker (chrome.runtime.sendMessage).
 */

(function () {
  const VERSION = chrome.runtime.getManifest().version;

  function sendToPage(msg) {
    // IMPORTANTE: source: 'darkolab-ext' precisa vir DEPOIS do spread,
    // senao um campo source dentro do msg (vindo de payloads do background)
    // sobrescreve o source do envelope e a page nao reconhece a mensagem.
    window.postMessage({ ...msg, source: 'darkolab-ext' }, '*');
  }

  window.addEventListener('message', (ev) => {
    const data = ev.data;
    if (!data || typeof data !== 'object') return;
    if (data.source !== 'darkolab') return;

    if (data.type === 'HG_PING') {
      sendToPage({ type: 'HG_PONG', version: VERSION });
      return;
    }

    if (data.type === 'HG_GENERATE') {
      const requestId = data.requestId;
      chrome.runtime.sendMessage(
        { type: 'HG_GENERATE', requestId, payload: data.payload },
        () => {
          if (chrome.runtime.lastError) {
            sendToPage({
              type: 'HG_ERROR',
              requestId,
              error: chrome.runtime.lastError.message ?? 'Background nao respondeu.',
            });
          }
        },
      );
      return;
    }

    if (data.type === 'HG_CANCEL') {
      chrome.runtime.sendMessage({ type: 'HG_CANCEL', requestId: data.requestId });
      return;
    }

    if (data.type === 'HG_TEST_SESSION') {
      const requestId = data.requestId;
      chrome.runtime.sendMessage(
        { type: 'HG_TEST_SESSION', requestId },
        () => {
          if (chrome.runtime.lastError) {
            sendToPage({
              type: 'HG_TEST_RESULT',
              requestId,
              ok: false,
              detail: chrome.runtime.lastError.message ?? 'Background nao respondeu.',
            });
          }
        },
      );
      return;
    }

    if (data.type === 'HG_API_FETCH') {
      const requestId = data.requestId;
      chrome.runtime.sendMessage(
        { type: 'HG_API_FETCH', requestId, req: data.req },
        () => {
          if (chrome.runtime.lastError) {
            sendToPage({ type: 'HG_API_RESULT', requestId, status: 0, ok: false, body: { message: chrome.runtime.lastError.message } });
          }
        },
      );
      return;
    }

    if (data.type === 'HG_FETCH_DOC') {
      const requestId = data.requestId;
      chrome.runtime.sendMessage(
        { type: 'HG_FETCH_DOC', requestId, url: data.url },
        () => {
          if (chrome.runtime.lastError) {
            sendToPage({
              type: 'HG_DOC_RESULT',
              requestId,
              ok: false,
              error: chrome.runtime.lastError.message ?? 'Background nao respondeu.',
            });
          }
        },
      );
      return;
    }

    if (data.type === 'HG_LIST_AVATARS') {
      const requestId = data.requestId;
      chrome.runtime.sendMessage(
        { type: 'HG_LIST_AVATARS', requestId },
        () => {
          if (chrome.runtime.lastError) {
            sendToPage({
              type: 'HG_AVATARS_RESULT',
              requestId,
              ok: false,
              avatars: [],
              error: chrome.runtime.lastError.message ?? 'Background nao respondeu.',
            });
          }
        },
      );
    }
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.source === 'darkolab-bg') {
      console.log('[DARKO LAB Bridge] <-- bg msg type=', msg.type, 'reqId=', msg.requestId, 'payload keys=', msg.payload ? Object.keys(msg.payload) : 'none');
      sendToPage({
        type: msg.type,
        requestId: msg.requestId,
        ...msg.payload,
      });
      console.log('[DARKO LAB Bridge] --> postMessage darkolab-ext type=', msg.type, 'reqId=', msg.requestId);
    }
  });

  console.log('[DARKO LAB Bridge] online v' + VERSION + ' on ' + window.location.host);
})();
