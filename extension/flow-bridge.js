/* Flow has its own protocol. It does not share HeyGen jobs or listeners. */
(() => {
  const version = chrome.runtime.getManifest().version;
  const extensionId = chrome.runtime.id;
  const allowed = new Set(['inspect', 'quote', 'generate', 'status', 'cancel', 'download', 'open']);
  const send = (message) => window.postMessage({ ...message, source: 'flow-extension', extensionId, version }, window.location.origin);
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const message = event.data;
    if (message?.source === 'pilot-flow' && message.type === 'FLOW_PING' && typeof message.requestId === 'string') {
      try {
        chrome.runtime.sendMessage({ type: 'FLOW_HEALTH' }, (response) => {
          if (!chrome.runtime.lastError && response?.ok) send({ type: 'FLOW_PONG', requestId: message.requestId, version });
        });
      } catch { /* Removed or invalidated extension must not advertise availability. */ }
      return;
    }
    if (message?.source !== 'pilot-flow' || message.type !== 'FLOW_REQUEST' || !allowed.has(message.action)) return;
    if (message.extensionId !== extensionId) return;
    if (typeof message.requestId !== 'string' || message.requestId.length > 160) return;
    try {
      chrome.runtime.sendMessage({ type: 'FLOW_REQUEST', requestId: message.requestId, action: message.action, payload: message.payload || {} }, (response) => {
        const error = chrome.runtime.lastError;
        if (error) send({ type: 'FLOW_ERROR', requestId: message.requestId, error: error.message });
        else if (response?.accepted) send({ type: 'FLOW_ACK', requestId: message.requestId });
        else send({ type: 'FLOW_ERROR', requestId: message.requestId, error: response?.error || 'O módulo Flow não respondeu. Atualize a extensão e recarregue o Pilot.' });
      });
    } catch (error) {
      send({ type: 'FLOW_ERROR', requestId: message.requestId, error: /context invalidated/i.test(error?.message || '') ? 'A extensão foi atualizada. Recarregue o Pilot para reconectar ao Flow.' : String(error?.message || error) });
    }
  });
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.source === 'flow-background') send(message);
  });
})();
