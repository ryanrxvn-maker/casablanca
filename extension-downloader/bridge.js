/**
 * DarkoLab Downloader — Bridge content script.
 * Roda no site do DARKO (vercel/localhost). Ponte pagina <-> extensao:
 * a pagina manda DL_PING, respondemos DL_PONG { version, engine }
 * (engine = se o motor local esta vivo). Mesmo padrao do Magnific.
 */
(function () {
  'use strict';
  let VERSION = '?';
  try {
    VERSION = chrome.runtime.getManifest().version;
  } catch {
    return; // contexto invalido
  }

  function toPage(m) {
    try {
      window.postMessage({ ...m, source: 'darko-dl-ext' }, '*');
    } catch {
      /* ignore */
    }
  }

  function announce() {
    try {
      chrome.runtime.sendMessage({ type: 'darko-ping-engine' }, (resp) => {
        const err = chrome.runtime.lastError; // evita unchecked warning
        toPage({
          type: 'DL_PONG',
          version: VERSION,
          engine: !err && !!(resp && resp.connected),
          port: resp && resp.port,
        });
      });
    } catch {
      toPage({ type: 'DL_PONG', version: VERSION, engine: false });
    }
  }

  window.addEventListener('message', (ev) => {
    const d = ev.data;
    if (!d || typeof d !== 'object' || d.source !== 'darko-dl') return;
    if (d.type === 'DL_PING' || d.type === 'DL_TEST') announce();
  });

  // anuncia proativamente (a pagina pode ja estar ouvindo)
  announce();
  setTimeout(announce, 800);
})();
