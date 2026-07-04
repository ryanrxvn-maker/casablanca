// Service worker: recebe pedido do botao na pagina e dispara o
// download pelo motor local via chrome.downloads (endpoint GET /get,
// token na query — sem precisar de blob no service worker).
//
// Auto-pareamento DEFINITIVO: a extensao NUNCA pede codigo. A cada
// operacao, varre as portas conhecidas, acha o motor vivo e pega o
// token atual via /pair. Storage local serve so de cache rapido.

// ═══════════════════════════════════════════════════════════════
// KEEPALIVE MV3 (fix 2026-05-28) — service worker NUNCA hiberna.
//
// Problema: Chrome MV3 mata o service worker após ~30s ocioso. Quando
// morto, a página vê "desconectado" mesmo com o motor local rodando.
// User reportou: "downloader desconecta e para de funcionar pra todos".
//
// Solução em 3 camadas:
//  1. chrome.alarms a cada 0.4min (24s < 30s) → acorda o SW antes de
//     hibernar. NUNCA morre.
//  2. Cache de status no storage (engineUp/enginePort/checkedAt) →
//     o ping responde INSTANTÂNEO do cache, sem esperar o fetch localhost.
//  3. Re-check do engine no alarm → cache sempre fresco (<24s de idade).
// ═══════════════════════════════════════════════════════════════

const KEEPALIVE_ALARM = 'darko-keepalive';
const ENGINE_CACHE_TTL_MS = 30_000; // cache vale 30s

/** Re-descobre o engine + atualiza cache no storage. Idempotente. */
async function recheckEngine() {
  try {
    const { port } = await getCfg();
    const eng = await discoverEngine(port || 47923);
    await chrome.storage.local.set({
      engineUp: !!eng,
      enginePortCache: eng ? eng.port : (port || 47923),
      engineCheckedAt: Date.now(),
    });
    return eng;
  } catch {
    // não derruba o cache num erro pontual de rede; só marca timestamp
    return null;
  }
}

/** Lê o status cacheado (rápido, sem fetch). */
function getEngineCache() {
  return new Promise((r) =>
    chrome.storage.local.get(['engineUp', 'enginePortCache', 'engineCheckedAt'], (v) => r(v || {})),
  );
}

function ensureKeepalive() {
  // periodInMinutes 0.4 = 24s. Mínimo de produção do Chrome é 0.5 (30s),
  // mas valores menores funcionam em unpacked; o Chrome clampa pra 0.5 se
  // necessário — 30s ainda mantém vivo o suficiente combinado com o cache.
  chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.4 });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEPALIVE_ALARM) {
    // O simples fato do handler rodar já reseta o timer de hibernação.
    // Aproveita pra manter o cache do engine fresco.
    recheckEngine();
  }
});

function prewarmToken() {
  ensureKeepalive();
  let tries = 0;
  const tick = () => {
    tries++;
    recheckEngine()
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
// Também garante keepalive quando o SW acorda por qualquer evento
ensureKeepalive();

function getCfg() {
  return new Promise((r) =>
    chrome.storage.local.get(['token', 'port'], (v) => r(v || {})),
  );
}

// fetch com timeout DURO — NUNCA pendura. Uma porta zumbi (socket
// meio-aberto, antivirus/firewall segurando, motor travado) nao pode mais
// congelar a descoberta. Sem isso, o service worker ficava preso numa
// promise pendente e a pagina via "desconectado" com o motor vivo.
function tfetch(url, ms) {
  return fetch(url, { signal: AbortSignal.timeout(ms) });
}

// Testa UMA porta: /health precisa responder com o app certo, dai /pair
// devolve o token. Resolve com o engine ou LANCA (pra Promise.any pular).
async function probePort(p) {
  const h = await tfetch(`http://127.0.0.1:${p}/health`, 1400);
  if (!h.ok) throw 0;
  const j = await h.json();
  if (!j || j.app !== 'darkolab-downloader-engine') throw 0;
  const pr = await tfetch(`http://127.0.0.1:${p}/pair`, 1400);
  if (!pr.ok) throw 0;
  const pj = await pr.json();
  if (!pj || !pj.token) throw 0;
  chrome.storage.local.set({ token: pj.token, port: p });
  return { port: p, token: pj.token, allowAdult: pj.allowAdult === true };
}

// Descobre a porta E pareia automaticamente (pega o token do motor vivo).
// Varre TODAS as portas EM PARALELO com timeout: porta lenta/zumbi nao
// atrasa nem trava. (O loop serial-sem-timeout antigo pendurava o SW pra
// sempre numa porta meio-morta.) Acaba o pareamento manual e o 401 stale.
async function discoverEngine(preferred) {
  const tries = [preferred, 47923, 47924, 47925, 47926, 47927, 47928].filter(
    (v, i, a) => v && a.indexOf(v) === i,
  );
  try {
    return await Promise.any(tries.map(probePort));
  } catch {
    return null; // nenhuma porta respondeu a tempo
  }
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
  // SEMPRE refaz pair antes do download. Custo: 1 GET extra (<5ms localhost),
  // mas elimina de vez o 401 por token stale.
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
  // Se 401/auth (token defasado), re-pair forcado e tenta de novo —
  // usuario nao precisa fazer nada manualmente. NUNCA mostra dialogo
  // de codigo.
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
        ? 'Motor reiniciando — tente novamente em alguns segundos.'
        : 'Falha: ' + r.error,
  };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'darko-download') {
    const tabId = sender && sender.tab && sender.tab.id;
    startDownload({ ...msg, tabId }).then(sendResponse);
    return true; // resposta assíncrona
  }
  if (msg && msg.type === 'darko-force-rediscover') {
    // Hard-refresh do popup: apaga cache/token stale e redescobre do zero.
    (async () => {
      try {
        await new Promise((r) =>
          chrome.storage.local.remove(
            ['token', 'engineUp', 'enginePortCache', 'engineCheckedAt'],
            () => r(),
          ),
        );
      } catch {
        /* segue */
      }
      const eng = await recheckEngine();
      sendResponse({ connected: !!eng, port: eng ? eng.port : 47923 });
    })();
    return true;
  }
  if (msg && msg.type === 'darko-ping-engine') {
    (async () => {
      ensureKeepalive(); // garante alarm vivo a cada ping também
      const cache = await getEngineCache();
      const cacheAge = Date.now() - (cache.engineCheckedAt || 0);

      // Cache FRESCO (<30s): responde NA HORA com o status conhecido.
      // Evita a página marcar "desconectado" enquanto o fetch localhost
      // demora ou o SW está acordando. Re-verifica em background.
      if (cache.engineCheckedAt && cacheAge < ENGINE_CACHE_TTL_MS) {
        sendResponse({ connected: !!cache.engineUp, port: cache.enginePortCache || 47923 });
        recheckEngine(); // atualiza pra próxima (fire-and-forget)
        return;
      }

      // Cache velho/ausente: verifica agora (primeira vez ou >30s parado).
      const eng = await recheckEngine();
      sendResponse({
        connected: !!eng,
        port: eng ? eng.port : (cache.enginePortCache || 47923),
      });
    })();
    return true;
  }
});
