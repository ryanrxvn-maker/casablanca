/**
 * DARKO LAB Magnific - Bridge content script
 * Roda em darkoautoedit.com e localhost. Ponte entre a pagina (window.postMessage)
 * e o background worker (chrome.runtime.sendMessage).
 *
 * Mensagens suportadas (source: 'darkolab-magnific' → bridge):
 *   - MG_PING                  → MG_PONG { version }
 *   - MG_TEST_SESSION          → MG_TEST_RESULT { ok, detail }
 *   - MG_CREATE_SPACE          → MG_SPACE_RESULT { ok, spaceId, url }
 *   - MG_GENERATE_IMAGE        → MG_IMAGE_PROGRESS / MG_IMAGE_RESULT
 *   - MG_ANIMATE_IMAGE         → MG_VIDEO_PROGRESS / MG_VIDEO_RESULT
 *   - MG_LIST_GENERATIONS      → MG_GENERATIONS_RESULT
 *   - MG_GET_PLAN              → MG_PLAN_RESULT { ok, tier, premiumPlus, ... }
 */
(function () {
  const VERSION = chrome.runtime.getManifest().version;

  function sendToPage(msg) {
    window.postMessage({ ...msg, source: 'darkolab-magnific-ext' }, '*');
  }

  window.addEventListener('message', (ev) => {
    const data = ev.data;
    if (!data || typeof data !== 'object') return;
    if (data.source !== 'darkolab-magnific') return;

    const route = (type, extra) => {
      const requestId = data.requestId;
      chrome.runtime.sendMessage(
        { type, requestId, ...extra },
        () => {
          if (chrome.runtime.lastError) {
            sendToPage({
              type: type + '_RESULT',
              requestId,
              ok: false,
              error: chrome.runtime.lastError.message ?? 'Background nao respondeu.',
            });
          }
        },
      );
    };

    if (data.type === 'MG_PING') {
      sendToPage({ type: 'MG_PONG', version: VERSION });
      return;
    }
    if (data.type === 'MG_SELF_RELOAD') {
      // v3.4.2: forward to background which calls chrome.runtime.reload()
      chrome.runtime.sendMessage({ type: 'MG_SELF_RELOAD' }, (resp) => {
        sendToPage({ type: 'MG_SELF_RELOAD_RESULT', ok: !!resp?.ok, willReload: !!resp?.willReload });
      });
      return;
    }
    if (data.type === 'MG_ABORT_ALL') {
      // v3.5.55: fire-and-forget — bg mata pipelines e recarrega a aba
      try {
        chrome.runtime.sendMessage({ type: 'MG_ABORT_ALL' }, () => {
          void chrome.runtime.lastError;
        });
      } catch {}
      return;
    }
    if (data.type === 'MG_TEST_SESSION') return route('MG_TEST_SESSION');
    if (data.type === 'MG_GET_PLAN') return route('MG_GET_PLAN');
    if (data.type === 'MG_CREATE_SPACE') return route('MG_CREATE_SPACE', { payload: data.payload });
    if (data.type === 'MG_GENERATE_IMAGE') return route('MG_GENERATE_IMAGE', { payload: data.payload });
    if (data.type === 'MG_ANIMATE_IMAGE') return route('MG_ANIMATE_IMAGE', { payload: data.payload });
    if (data.type === 'MG_LIST_GENERATIONS') return route('MG_LIST_GENERATIONS', { payload: data.payload });
    if (data.type === 'MG_DOWNLOAD_ASSET') return route('MG_DOWNLOAD_ASSET', { payload: data.payload });
    if (data.type === 'MG_RUN_PIPELINE') return route('MG_RUN_PIPELINE', { payload: data.payload });
    if (data.type === 'MG_RUN_PIPELINE_TEMPLATE') return route('MG_RUN_PIPELINE_TEMPLATE', { payload: data.payload });
    if (data.type === 'MG_CREATE_TEMPLATE_SPACE') return route('MG_CREATE_TEMPLATE_SPACE', { payload: data.payload });
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.source === 'darkolab-magnific-bg') {
      sendToPage({
        type: msg.type,
        requestId: msg.requestId,
        ...msg.payload,
      });
    }
  });

  console.log('[DARKO Magnific Bridge] online v' + VERSION + ' on ' + window.location.host);
})();
