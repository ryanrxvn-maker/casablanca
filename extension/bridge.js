/**
 * DARKO LAB Extension — Bridge content script
 *
 * Roda em darkolab.vercel.app e localhost. Faz a ponte entre a pagina
 * (window.postMessage) e o background worker (chrome.runtime.sendMessage).
 *
 * Mensagens da pagina (com source: 'darkolab'):
 *   HG_PING       — checa se a extension esta conectada
 *   HG_GENERATE   — inicia uma geracao
 *   HG_CANCEL     — cancela geracao em andamento
 *
 * Mensagens da extension de volta (source: 'darkolab-ext'):
 *   HG_PONG       — confirmacao de presenca + versao
 *   HG_PROGRESS   — atualizacao de progresso
 *   HG_RESULT     — URL do MP4 gerado
 *   HG_ERROR      — erro
 */

(function () {
  const VERSION = chrome.runtime.getManifest().version;

  function sendToPage(msg) {
    window.postMessage({ source: 'darkolab-ext', ...msg }, '*');
  }

  // Listener pra mensagens da pagina
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
        {
          type: 'HG_GENERATE',
          requestId,
          payload: data.payload,
        },
        (response) => {
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
      chrome.runtime.sendMessage({
        type: 'HG_CANCEL',
        requestId: data.requestId,
      });
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
              detail:
                chrome.runtime.lastError.message ?? 'Background nao respondeu.',
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
              error:
                chrome.runtime.lastError.message ?? 'Background nao respondeu.',
            });
          }
        },
      );
    }
  });

  // Listener pra mensagens do background → encaminha pra pagina
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
