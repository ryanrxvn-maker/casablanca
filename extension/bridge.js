/**
 * DARKO LAB Extension - Bridge content script
 * Roda em darkoautoedit.com e localhost. Faz a ponte entre a pagina
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

    if (data.type === 'HG_STUDIO_GENERATE') {
      const requestId = data.requestId;
      chrome.runtime.sendMessage(
        { type: 'HG_STUDIO_GENERATE', requestId, payload: data.payload },
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

    if (data.type === 'HG_RELOAD_SELF') {
      chrome.runtime.sendMessage({ type: 'HG_RELOAD_SELF' });
      // Sem resposta — extensao vai reiniciar, perde a conexao
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
      return;
    }

    if (data.type === 'HG_GET_CREDITS') {
      const requestId = data.requestId;
      chrome.runtime.sendMessage(
        { type: 'HG_GET_CREDITS', requestId },
        () => {
          if (chrome.runtime.lastError) {
            sendToPage({
              type: 'HG_CREDITS_RESULT',
              requestId,
              ok: false,
              error: chrome.runtime.lastError.message ?? 'Background nao respondeu.',
            });
          }
        },
      );
      return;
    }

    if (data.type === 'HG_CREATE_PHOTO_AVATAR') {
      const requestId = data.requestId;
      chrome.runtime.sendMessage(
        { type: 'HG_CREATE_PHOTO_AVATAR', requestId, payload: data.payload },
        () => {
          if (chrome.runtime.lastError) {
            sendToPage({
              type: 'HG_PHOTO_AVATAR_RESULT',
              requestId,
              ok: false,
              error: chrome.runtime.lastError.message ?? 'Background nao respondeu.',
            });
          }
        },
      );
      return;
    }

    if (data.type === 'HG_DRIVE_LIST_FOLDER') {
      const requestId = data.requestId;
      chrome.runtime.sendMessage(
        { type: 'HG_DRIVE_LIST_FOLDER', requestId, folderId: data.folderId },
        () => {
          if (chrome.runtime.lastError) {
            sendToPage({
              type: 'HG_DRIVE_LIST_FOLDER_RESULT',
              requestId,
              ok: false,
              error: chrome.runtime.lastError.message ?? 'Background nao respondeu.',
              files: [],
            });
          }
        },
      );
      return;
    }

    if (data.type === 'HG_DOWNLOAD_DRIVE') {
      const requestId = data.requestId;
      chrome.runtime.sendMessage(
        { type: 'HG_DOWNLOAD_DRIVE', requestId, fileId: data.fileId },
        () => {
          if (chrome.runtime.lastError) {
            sendToPage({
              type: 'HG_DRIVE_DOWNLOAD_RESULT',
              requestId,
              ok: false,
              error: chrome.runtime.lastError.message ?? 'Background nao respondeu.',
            });
          }
        },
      );
      return;
    }

    if (data.type === 'HG_CLONE_VOICE') {
      const requestId = data.requestId;
      chrome.runtime.sendMessage(
        { type: 'HG_CLONE_VOICE', requestId, payload: data.payload },
        () => {
          if (chrome.runtime.lastError) {
            sendToPage({
              type: 'HG_CLONE_VOICE_RESULT',
              requestId,
              ok: false,
              error: chrome.runtime.lastError.message ?? 'Background nao respondeu.',
            });
          }
        },
      );
      return;
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
