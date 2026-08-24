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

/**
 * AUTO CORTES (v1.8.0) — relay de BYTES página <-> service worker.
 *
 * IIFE separada de propósito: o relay antigo (DL_PING / DL_ENGINE_DOWNLOAD /
 * DL_IG_DOWNLOAD) continua exatamente como estava.
 *
 * página → nós:  DL_FETCH { reqId, url, kind:'engine'|'drive', mode, quality }
 *                DL_FETCH_ABORT { reqId }
 * SW → nós:      darko-fetch-meta / -chunk / -progress / -done / -error
 * nós → página:  DL_FETCH_META  { reqId, filename, size, mime }
 *                DL_FETCH_CHUNK { reqId, idx, buf: ArrayBuffer }  (transferido)
 *                DL_FETCH_PROGRESS { reqId, received, total, phase }
 *                DL_FETCH_DONE  { reqId, total, chunks }
 *                DL_FETCH_ERROR { reqId, error }
 *
 * O ack (sendResponse) de cada mensagem do SW é o que segura o ritmo: o SW
 * só manda o próximo pedaço depois que este content script confirmou. Sem
 * isso a fila do Chrome estoura e chunk se perde no caminho.
 */
(function () {
  'use strict';
  try {
    if (!chrome || !chrome.runtime || !chrome.runtime.id) return;
  } catch {
    return; // contexto inválido
  }

  function toPage(m, transfer) {
    try {
      if (transfer && transfer.length) {
        window.postMessage({ ...m, source: 'darko-dl-ext' }, '*', transfer);
        return;
      }
      window.postMessage({ ...m, source: 'darko-dl-ext' }, '*');
    } catch {
      // Transferência recusada (mundo isolado sem transferable): manda cópia.
      try {
        window.postMessage({ ...m, source: 'darko-dl-ext' }, '*');
      } catch {
        /* aba indo embora */
      }
    }
  }

  function b64ToBuf(b64) {
    const bin = atob(b64);
    const len = bin.length;
    const buf = new ArrayBuffer(len);
    const view = new Uint8Array(buf);
    for (let i = 0; i < len; i++) view[i] = bin.charCodeAt(i);
    return buf;
  }

  // ── SW → página ────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || typeof msg.type !== 'string' || msg.type.indexOf('darko-fetch-') !== 0) {
      return; // não é nosso: deixa outro listener responder
    }
    try {
      if (msg.type === 'darko-fetch-meta') {
        toPage({
          type: 'DL_FETCH_META',
          reqId: msg.reqId,
          filename: msg.filename,
          size: typeof msg.size === 'number' ? msg.size : null,
          mime: msg.mime,
        });
      } else if (msg.type === 'darko-fetch-chunk') {
        const buf = b64ToBuf(String(msg.b64 || ''));
        toPage({ type: 'DL_FETCH_CHUNK', reqId: msg.reqId, idx: msg.idx, buf }, [buf]);
      } else if (msg.type === 'darko-fetch-progress') {
        toPage({
          type: 'DL_FETCH_PROGRESS',
          reqId: msg.reqId,
          received: msg.received,
          total: typeof msg.total === 'number' ? msg.total : null,
          phase: msg.phase || 'baixando',
        });
      } else if (msg.type === 'darko-fetch-done') {
        toPage({
          type: 'DL_FETCH_DONE',
          reqId: msg.reqId,
          total: msg.total,
          chunks: msg.chunks,
        });
      } else if (msg.type === 'darko-fetch-error') {
        toPage({ type: 'DL_FETCH_ERROR', reqId: msg.reqId, error: String(msg.error || 'falhou') });
      }
      sendResponse({ ok: true });
    } catch (e) {
      // Falhou aqui = a página não recebeu esse pedaço. Avisa e deixa o
      // watchdog dela encerrar — melhor que um arquivo furado.
      toPage({
        type: 'DL_FETCH_ERROR',
        reqId: msg.reqId,
        error: 'falha ao repassar o pedaço: ' + String((e && e.message) || e),
      });
      sendResponse({ ok: false, error: String((e && e.message) || e) });
    }
    return true;
  });

  // ── página → SW ────────────────────────────────────────────────
  window.addEventListener('message', (ev) => {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || typeof d !== 'object' || d.source !== 'darko-dl') return;

    if (d.type === 'DL_FETCH' && d.url && d.reqId) {
      try {
        chrome.runtime.sendMessage(
          {
            type: 'darko-fetch',
            reqId: d.reqId,
            url: d.url,
            kind: d.kind === 'drive' ? 'drive' : 'engine',
            mode: d.mode || 'video',
            quality: d.quality || '1080',
          },
          (resp) => {
            const err = chrome.runtime.lastError;
            if (err || !resp || !resp.ok) {
              toPage({
                type: 'DL_FETCH_ERROR',
                reqId: d.reqId,
                error: err ? err.message : (resp && resp.error) || 'a extensão não aceitou o pedido',
              });
            }
          },
        );
      } catch (e) {
        toPage({
          type: 'DL_FETCH_ERROR',
          reqId: d.reqId,
          error: String((e && e.message) || e),
        });
      }
      return;
    }

    if (d.type === 'DL_FETCH_ABORT' && d.reqId) {
      try {
        chrome.runtime.sendMessage({ type: 'darko-fetch-abort', reqId: d.reqId }, () => {
          void chrome.runtime.lastError; // evita unchecked warning
        });
      } catch {
        /* nada a fazer */
      }
    }
  });
})();
