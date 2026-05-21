// Service worker: recebe pedido do botao na pagina e dispara o
// download pelo motor local via chrome.downloads (endpoint GET /get,
// token na query — sem precisar de blob no service worker).

// Pre-warm: assim que o Chrome inicia / a extensao instala, busca o
// token vivo do motor e guarda. Acaba o cenario "reiniciei o PC e
// pediu pra colar codigo de novo" — quando voce abrir o popup ele ja
// esta pareado. Tenta varias vezes pq o motor pode demorar uns segs
// pra subir junto com o Windows.
function prewarmToken() {
  let tries = 0;
  const tick = () => {
    tries++;
    discoverEngine(47923)
      .then((eng) => {
        if (!eng && tries < 30) setTimeout(tick, 2000); // ~1min de tentativas
      })
      .catch(() => {
        if (tries < 30) setTimeout(tick, 2000);
      });
  };
  tick();
}
chrome.runtime.onInstalled.addListener(() => prewarmToken());
chrome.runtime.onStartup.addListener(() => prewarmToken());

function getCfg() {
  return new Promise((r) =>
    chrome.storage.local.get(['token', 'port'], (v) => r(v || {})),
  );
}

// Descobre a porta E pareia automaticamente (pega o token do motor
// vivo). Acaba o pareamento manual e o 401 por token desatualizado.
async function discoverEngine(preferred) {
  const tries = [preferred, 47923, 47924, 47925, 47926, 47927, 47928].filter(
    (v, i, a) => v && a.indexOf(v) === i,
  );
  for (const p of tries) {
    try {
      const h = await fetch(`http://127.0.0.1:${p}/health`);
      if (!h.ok) continue;
      const j = await h.json();
      if (!j || j.app !== 'darkolab-downloader-engine') continue;
      // auto-pair: pega o token REAL desse motor
      const pr = await fetch(`http://127.0.0.1:${p}/pair`);
      if (!pr.ok) continue;
      const pj = await pr.json();
      if (pj && pj.token) {
        chrome.storage.local.set({ token: pj.token, port: p });
        return { port: p, token: pj.token, allowAdult: pj.allowAdult === true };
      }
    } catch {
      /* tenta proxima */
    }
  }
  return null;
}

function sendProgress(tabId, payload) {
  if (!tabId) return;
  try {
    chrome.tabs.sendMessage(tabId, { type: 'darko-dl-progress', ...payload });
  } catch {
    /* aba pode ter fechado */
  }
}

async function tryDownloadOnce({ url, mode, quality, adult, tabId }) {
  const eng = await discoverEngine((await getCfg()).port || 47923);
  if (!eng) {
    return {
      ok: false,
      authFail: false,
      error: 'Motor local não está rodando. Abra o DarkoLab Downloader.',
    };
  }
  const params = {
    t: eng.token,
    url,
    mode: mode || 'video',
    quality: quality || '1080',
  };
  if (adult === true) params.adult = '1';
  const qs = new URLSearchParams(params).toString();
  const dlUrl = `http://127.0.0.1:${eng.port}/get?${qs}`;

  return new Promise((resolve) => {
    chrome.downloads.download({ url: dlUrl, saveAs: false }, (id) => {
      if (chrome.runtime.lastError || id === undefined) {
        resolve({
          ok: false,
          authFail: false,
          error: chrome.runtime.lastError?.message || 'falha ao iniciar',
        });
        return;
      }
      let settled = false;
      const finish = (r) => {
        if (settled) return;
        settled = true;
        chrome.downloads.onChanged.removeListener(onChanged);
        clearInterval(poller);
        clearTimeout(cap);
        resolve(r);
      };
      // PROGRESSO REAL: polling de chrome.downloads.search → manda %
      // pro content script (botao mostra carregando ate subir na barra).
      const poller = setInterval(() => {
        try {
          chrome.downloads.search({ id }, (items) => {
            const it = items && items[0];
            if (!it) return;
            const total = Number(it.totalBytes) || 0;
            const recv = Number(it.bytesReceived) || 0;
            const pct = total > 0 ? Math.min(99, Math.floor((recv / total) * 100)) : -1;
            sendProgress(tabId, { id, state: it.state, pct, recv, total });
            if (it.state === 'complete') {
              sendProgress(tabId, { id, state: 'complete', pct: 100 });
              finish({ ok: true });
            } else if (it.state === 'interrupted') {
              const err = it.error || 'FAILED';
              sendProgress(tabId, { id, state: 'interrupted', pct, error: err });
              finish({
                ok: false,
                authFail: /FORBIDDEN|SERVER_UNAUTHORIZED|SERVER_BAD_CONTENT/i.test(
                  err,
                ),
                error: err,
              });
            }
          });
        } catch {
          /* SW pode estar suspendendo — proxima tick ok */
        }
      }, 600);
      // event-driven backup
      const onChanged = (delta) => {
        if (delta.id !== id) return;
        if (delta.state && delta.state.current === 'complete') {
          sendProgress(tabId, { id, state: 'complete', pct: 100 });
          finish({ ok: true });
        } else if (delta.error && delta.error.current) {
          const e = String(delta.error.current);
          sendProgress(tabId, { id, state: 'interrupted', error: e });
          finish({
            ok: false,
            authFail: /FORBIDDEN|SERVER_UNAUTHORIZED|SERVER_BAD_CONTENT/i.test(
              e,
            ),
            error: e,
          });
        }
      };
      chrome.downloads.onChanged.addListener(onChanged);
      const cap = setTimeout(
        () =>
          finish({
            ok: false,
            authFail: false,
            error: 'tempo esgotado — tente de novo.',
          }),
        600000,
      );
    });
  });
}

async function startDownload({ url, mode, quality, adult, tabId }) {
  // Tentativa 1
  let r = await tryDownloadOnce({ url, mode, quality, adult, tabId });
  // Se 401/auth (token defasado), faz re-pair forçado e tenta de novo
  // — usuario nao precisa fazer nada manualmente.
  if (!r.ok && r.authFail) {
    try {
      await chrome.storage.local.set({ token: '' });
    } catch {}
    r = await tryDownloadOnce({ url, mode, quality, adult, tabId });
  }
  if (r.ok) return { ok: true };
  return {
    ok: false,
    error:
      r.error === 'SERVER_UNAUTHORIZED'
        ? 'Sem autorizacao — abra o Downloader uma vez e tente de novo.'
        : 'Falha: ' + r.error,
  };
}

// === Bulk audio: chama /audio-batch do motor, streama NDJSON e
// retransmite progresso pro content script que pediu (TikTok coletor).
async function bulkAudio({ niche, urls, tabId }) {
  const eng = await discoverEngine((await getCfg()).port || 47923);
  if (!eng) return { ok: false, error: 'Motor não está rodando.' };
  try {
    const res = await fetch(`http://127.0.0.1:${eng.port}/audio-batch`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${eng.token}`,
      },
      body: JSON.stringify({ niche, urls }),
    });
    if (!res.ok || !res.body) {
      let msg = `HTTP ${res.status}`;
      try {
        msg = (await res.json()).error || msg;
      } catch {}
      return { ok: false, error: msg };
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          const ev = JSON.parse(line);
          if (tabId) {
            chrome.tabs
              .sendMessage(tabId, {
                type: 'darko-bulk-progress',
                kind: ev.type,
                ...ev,
              })
              .catch(() => {});
          }
        } catch {
          /* linha invalida — pula */
        }
      }
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'fetch failed' };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'darko-download') {
    const tabId = sender && sender.tab && sender.tab.id;
    startDownload({ ...msg, tabId }).then(sendResponse);
    return true; // resposta assíncrona
  }
  if (msg && msg.type === 'darko-bulk-audio') {
    const tabId = sender && sender.tab && sender.tab.id;
    bulkAudio({ niche: msg.niche, urls: msg.urls, tabId }).then(sendResponse);
    return true;
  }
  if (msg && msg.type === 'darko-ping-engine') {
    (async () => {
      const { port } = await getCfg();
      const eng = await discoverEngine(port || 47923);
      sendResponse({
        connected: !!eng,
        port: eng ? eng.port : port || 47923,
      });
    })();
    return true;
  }
});
