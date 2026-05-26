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

  // HEARTBEAT: anuncia proativamente em multiplos timings pra cobrir
  // race condition de quem chegou primeiro (page listener pode estar
  // sendo registrado enquanto a extension já anunciou).
  // Burst inicial + heartbeat contínuo cada 3s.
  [0, 100, 300, 600, 1500, 3000].forEach((delay) => setTimeout(announce, delay));
  setInterval(announce, 3000);
})();
