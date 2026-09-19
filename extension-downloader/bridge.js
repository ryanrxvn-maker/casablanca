/* Page bridge. Acknowledgement means queued; success is sent only after
   Chrome confirms the file is complete. Polling also recovers missed events. */
(function () {
  'use strict';
  let version;
  try { version = chrome.runtime.getManifest().version; } catch { return; }
  const pending = new Map();
  const toPage = message => window.postMessage({ ...message, source: 'darko-dl-ext' }, location.origin);
  function message(data) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('A extensão demorou para responder. Recarregue esta página.')), 12000);
      try { chrome.runtime.sendMessage(data, result => {
        clearTimeout(timeout);
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message)); else resolve(result);
      }); } catch (error) { clearTimeout(timeout); reject(error); }
    });
  }
  async function announce(force = false) {
    // An old content script can outlive extension removal/update. Prove that
    // its runtime is alive before advertising installation to the website.
    try {
      if (!chrome.runtime.id) return;
      const health = await message({ type: 'darko-bridge-health' });
      if (!health?.ok || !chrome.runtime.id) return;
      version = health.version || version;
    } catch { return; }
    toPage({ type: 'DL_PONG', version, installed: true, checking: true, capabilities: ['durable-downloads-v1'] });
    try {
      const result = await message({ type: force ? 'darko-force-rediscover' : 'darko-ping-engine' });
      toPage({ type: 'DL_PONG', version, installed: true, engine: !!result?.connected,
        port: result?.port, engineVersion: result?.engineVersion || null,
        engineCompatible: !!result?.engineCompatible, capabilities: ['durable-downloads-v1'] });
    } catch { if (chrome.runtime.id) toPage({ type: 'DL_PONG', version, installed: true, engine: false, engineCompatible: false }); }
  }
  function progress(job) {
    if (!job) return;
    for (const [reqId, request] of pending) {
      if (request.jobId !== job.id && request.jobId !== job.jobId) continue;
      toPage({ type: 'DL_ENGINE_PROGRESS', reqId, phase: job.phase, pct: job.pct, state: job.state });
      if (['complete', 'error', 'canceled'].includes(job.state)) {
        toPage({ type: request.resultType, reqId, ok: job.state === 'complete', error: job.error, code: job.code });
        pending.delete(reqId);
      }
    }
  }
  chrome.runtime.onMessage.addListener(msg => { if (msg?.type === 'darko-dl-progress') progress(msg); });
  window.addEventListener('message', async event => {
    const data = event.data;
    if (event.source !== window || event.origin !== location.origin || data?.source !== 'darko-dl') return;
    if (data.type === 'DL_PING' || data.type === 'DL_TEST') { announce(data.force === true); return; }
    if (!['DL_ENGINE_DOWNLOAD', 'DL_IG_DOWNLOAD'].includes(data.type) || !data.url || !data.reqId) return;
    if (pending.has(data.reqId)) return;
    const resultType = data.type === 'DL_IG_DOWNLOAD' ? 'DL_IG_RESULT' : 'DL_ENGINE_RESULT';
    const request = { resultType, jobId: null };
    pending.set(data.reqId, request);
    try {
      const response = await message({ type: 'darko-enqueue', reqId: data.reqId, url: data.url,
        mode: data.mode || 'video', quality: data.quality || '1080', adult: false });
      if (!response?.ok) throw new Error(response?.error || 'Não foi possível adicionar o download.');
      request.jobId = response.jobId;
      progress(response.job);
    } catch (error) {
      pending.delete(data.reqId);
      toPage({ type: resultType, reqId: data.reqId, ok: false, error: error.message });
    }
  });
  setInterval(async () => {
    if (!pending.size) return;
    try {
      const response = await message({ type: 'darko-jobs' });
      for (const job of response?.jobs || []) progress(job);
    } catch { /* A suspended worker is retried; the queue remains durable. */ }
  }, 2500);
  [0, 300, 1500].forEach(delay => setTimeout(announce, delay));
  setInterval(announce, 10000);
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
