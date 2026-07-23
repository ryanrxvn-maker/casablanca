/**
 * DarkoLab Downloader — Bridge content script.
 * Roda no site do DARKO (darkoautoedit.com/localhost). Ponte pagina <-> extensao:
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
    // Site pede pra baixar um link de Instagram pela sessão logada do
    // usuário (o motor não consegue — IG exige login). Relaia pro service
    // worker, que resolve com os cookies do próprio usuário e baixa via
    // chrome.downloads. Devolve DL_IG_RESULT { reqId, ok, error } pro site.
    // Site pede pra baixar QUALQUER link pelo Motor local (YouTube, TikTok,
    // Pinterest... — o servidor do site nao baixa esses; o Motor baixa).
    // Relaia pro service worker com modo/qualidade escolhidos na pagina e
    // devolve DL_ENGINE_RESULT { reqId, ok, error } pro site. (v1.7.0+)
    if (d.type === 'DL_ENGINE_DOWNLOAD' && d.url && d.reqId) {
      try {
        chrome.runtime.sendMessage(
          {
            type: 'darko-download',
            url: d.url,
            mode: d.mode || 'video',
            quality: d.quality || '1080',
            adult: false,
          },
          (resp) => {
            const err = chrome.runtime.lastError;
            toPage({
              type: 'DL_ENGINE_RESULT',
              reqId: d.reqId,
              ok: !err && !!(resp && resp.ok),
              error: err ? err.message : resp && resp.error,
            });
          },
        );
      } catch (e) {
        toPage({
          type: 'DL_ENGINE_RESULT',
          reqId: d.reqId,
          ok: false,
          error: String(e && e.message),
        });
      }
    }
    if (d.type === 'DL_IG_DOWNLOAD' && d.url && d.reqId) {
      try {
        chrome.runtime.sendMessage(
          {
            type: 'darko-download',
            url: d.url,
            mode: 'video',
            quality: '1080',
            adult: false,
          },
          (resp) => {
            const err = chrome.runtime.lastError;
            toPage({
              type: 'DL_IG_RESULT',
              reqId: d.reqId,
              ok: !err && !!(resp && resp.ok),
              error: err ? err.message : resp && resp.error,
            });
          },
        );
      } catch (e) {
        toPage({
          type: 'DL_IG_RESULT',
          reqId: d.reqId,
          ok: false,
          error: String(e && e.message),
        });
      }
    }
  });

  // HEARTBEAT: anuncia proativamente em multiplos timings pra cobrir
  // race condition de quem chegou primeiro (page listener pode estar
  // sendo registrado enquanto a extension já anunciou).
  // Burst inicial + heartbeat contínuo cada 3s.
  [0, 100, 300, 600, 1500, 3000].forEach((delay) => setTimeout(announce, delay));
  setInterval(announce, 3000);
})();
