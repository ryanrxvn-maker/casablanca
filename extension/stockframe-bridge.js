/** Bridge isolado Pilot <-> StockFrame background module. */
(function () {
  const extensionId = chrome.runtime.id;
  const version = chrome.runtime.getManifest().version;
  const allowed = new Set(['status', 'configure', 'disconnect', 'list', 'smartSearch', 'mediaUrls', 'download']);

  function page(message) {
    window.postMessage({ ...message, source: 'stockframe-extension', extensionId, version }, window.location.origin);
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const message = event.data;
    if (message?.source !== 'pilot-stockframe') return;
    if (message.type === 'SF_PING' && typeof message.requestId === 'string') {
      try {
        chrome.runtime.sendMessage({ type: 'HG_BRIDGE_HEALTH' }, (response) => {
          if (!chrome.runtime.lastError && response?.ok) page({ type: 'SF_PONG', requestId: message.requestId });
        });
      } catch {}
      return;
    }
    if (message.type !== 'SF_REQUEST' || message.extensionId !== extensionId || !allowed.has(message.action) || typeof message.requestId !== 'string') return;
    try {
      chrome.runtime.sendMessage({ type: 'SF_REQUEST', requestId: message.requestId, action: message.action, payload: message.payload || {} }, (response) => {
        if (chrome.runtime.lastError || !response?.accepted) {
          page({ type: 'SF_ERROR', requestId: message.requestId, error: chrome.runtime.lastError?.message || 'A extensão não aceitou o pedido StockFrame.' });
        }
      });
    } catch (error) {
      page({ type: 'SF_ERROR', requestId: message.requestId, error: error?.message || String(error) });
    }
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.source === 'stockframe-background') page(message);
  });

  console.log(`[AutoEdit StockFrame] bridge online v${version}`);
})();
