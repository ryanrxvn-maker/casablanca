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

// TODAS as portas em que o motor pode subir (47923..47930 no server.cjs);
// varremos ate 47931 com folga pra nunca "nao achar" um motor vivo.
const ENGINE_PORTS = [47923, 47924, 47925, 47926, 47927, 47928, 47929, 47930, 47931];

// fetch com timeout DURO — NUNCA pendura. Uma porta zumbi (socket
// meio-aberto, antivirus/firewall segurando, motor travado) nao pode mais
// congelar a descoberta. Sem isso, o service worker ficava preso numa
// promise pendente e a pagina via "desconectado" com o motor vivo.
// Fallback pra AbortController onde AbortSignal.timeout nao existir.
function tfetch(url, ms) {
  if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) {
    return fetch(url, { signal: AbortSignal.timeout(ms) });
  }
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  return fetch(url, { signal: ac.signal }).finally(() => clearTimeout(t));
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
  const tries = [preferred, ...ENGINE_PORTS].filter(
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

// ═══════════════════════════════════════════════════════════════
// INSTAGRAM — resolve pela SESSÃO LOGADA do próprio usuário.
//
// O IG bloqueou 100% o acesso anônimo (motor/yt-dlp e qualquer IP de
// datacenter recebem "login_required"). Sites tipo sssinstagram só
// funcionam porque o SERVIDOR deles mantém contas-robô + proxies. Nós
// não precisamos disso: o usuário JÁ está logado no Instagram no próprio
// navegador. Com host_permission de instagram.com, o fetch credenciado
// DESTE service worker manda os cookies da sessão dele — então
// resolvemos o mp4 real (com áudio) aqui, sem servidor e sem contas.
//
// Fluxo: permalink → media_id → API interna /api/v1/media/<id>/info/ →
// video_versions (mp4 progressivo). A URL do CDN é ASSINADA e baixa sem
// referer/cookie (testado), então entregamos direto pro chrome.downloads.
// ═══════════════════════════════════════════════════════════════
const IG_APP_ID = '936619743392459'; // app id oficial do web client

function isInstagramUrl(u) {
  try {
    return /(^|\.)instagram\.com$/.test(new URL(u).hostname);
  } catch {
    return false;
  }
}

function igShortcode(u) {
  try {
    const m = new URL(u).pathname.match(/\/(?:reel|reels|p|tv)\/([\w-]+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

// Resolve a melhor mp4 do post/reel na sessão logada. Retorna a URL do
// CDN ou null (sem sessão, post privado sem acesso, ou não-vídeo).
async function resolveInstagram(pageUrl) {
  const sig = () =>
    typeof AbortSignal !== 'undefined' && AbortSignal.timeout
      ? AbortSignal.timeout(20000)
      : undefined;
  // HTML do permalink (server-render logado) → media_id.
  const html = await fetch(pageUrl, {
    credentials: 'include',
    signal: sig(),
  }).then((r) => r.text());
  const mid =
    (html.match(/instagram:\/\/media\?id=(\d+)/) || [])[1] ||
    (html.match(/"media_id":"(\d+)"/) || [])[1];
  if (!mid) return null;
  const r = await fetch(
    `https://www.instagram.com/api/v1/media/${mid}/info/`,
    {
      credentials: 'include',
      headers: { 'x-ig-app-id': IG_APP_ID },
      signal: sig(),
    },
  );
  if (!r.ok) return null;
  const item = (((await r.json()) || {}).items || [])[0];
  const best = (it) =>
    it && it.video_versions && it.video_versions.length
      ? it.video_versions
          .slice()
          .sort((a, b) => (b.width || 0) - (a.width || 0))[0].url
      : null;
  let url = best(item);
  if (!url && item && item.carousel_media) {
    for (const cm of item.carousel_media) {
      url = best(cm);
      if (url) break;
    }
  }
  return url || null;
}

// Baixa uma URL DIRETA (já resolvida) via chrome.downloads, reportando
// progresso REAL pro content script/popup. Mesmo motor de progresso do
// tryDownloadOnce, mas sem passar pelo motor local.
function downloadDirect({ url, filename, tabId }) {
  return new Promise((resolve) => {
    chrome.downloads.download({ url, filename, saveAs: false }, (id) => {
      if (chrome.runtime.lastError || id === undefined) {
        resolve({
          ok: false,
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
      const poller = setInterval(() => {
        try {
          chrome.downloads.search({ id }, (items) => {
            const it = items && items[0];
            if (!it) return;
            const total = Number(it.totalBytes) || 0;
            const recv = Number(it.bytesReceived) || 0;
            const pct =
              total > 0 ? Math.min(99, Math.floor((recv / total) * 100)) : -1;
            sendProgress(tabId, { id, state: it.state, pct, recv, total });
            if (it.state === 'complete') {
              sendProgress(tabId, { id, state: 'complete', pct: 100 });
              finish({ ok: true });
            } else if (it.state === 'interrupted') {
              sendProgress(tabId, {
                id,
                state: 'interrupted',
                pct,
                error: it.error || 'FAILED',
              });
              finish({ ok: false, error: it.error || 'FAILED' });
            }
          });
        } catch {
          /* SW suspendendo — próxima tick ok */
        }
      }, 600);
      const onChanged = (delta) => {
        if (delta.id !== id) return;
        if (delta.state && delta.state.current === 'complete') {
          sendProgress(tabId, { id, state: 'complete', pct: 100 });
          finish({ ok: true });
        } else if (delta.error && delta.error.current) {
          sendProgress(tabId, {
            id,
            state: 'interrupted',
            error: String(delta.error.current),
          });
          finish({ ok: false, error: String(delta.error.current) });
        }
      };
      chrome.downloads.onChanged.addListener(onChanged);
      const cap = setTimeout(
        () => finish({ ok: false, error: 'tempo esgotado' }),
        600000,
      );
    });
  });
}

// Tenta baixar um link de Instagram pela sessão logada. Retorna
// { handled: true, ok } se conseguiu resolver (mesmo que o download
// falhe depois), ou { handled: false } pra deixar o fluxo do motor seguir.
async function tryInstagramSession({ url, tabId }) {
  try {
    const cdn = await resolveInstagram(url);
    if (!cdn) return { handled: false };
    const filename = `instagram-${igShortcode(url) || Date.now()}.mp4`;
    const r = await downloadDirect({ url: cdn, filename, tabId });
    return { handled: true, ok: r.ok, error: r.error };
  } catch {
    return { handled: false };
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
      error: 'O Motor não está aberto neste computador. Abra o Auto Edit Downloader pelo menu Iniciar e tente de novo.',
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
  // INSTAGRAM (vídeo, não +18): resolve pela sessão logada do usuário
  // ANTES de tentar o motor. O motor não consegue (IG exige login), então
  // este é o caminho principal pra IG. Só cai no motor se a resolução
  // falhar (post sem vídeo, sem sessão, etc.) — comportamento preservado.
  if (adult !== true && mode === 'video' && isInstagramUrl(url)) {
    const ig = await tryInstagramSession({ url, tabId });
    if (ig.handled) {
      if (ig.ok) return { ok: true };
      return { ok: false, error: 'Falha: ' + (ig.error || 'instagram') };
    }
    // não resolvido → segue pro motor (fallback)
  }

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
  if (msg && msg.type === 'darko-ig-resolve') {
    // Resolve um link de Instagram pela sessão logada e devolve a URL do
    // CDN (mp4 com áudio) ou null. Usado pelo popup e pela página do site
    // (via bridge) pra baixar por link colado, sem passar pelo motor.
    (async () => {
      try {
        const cdn = await resolveInstagram(msg.url);
        sendResponse({ ok: !!cdn, url: cdn || null });
      } catch (e) {
        sendResponse({ ok: false, error: String(e && e.message).slice(0, 160) });
      }
    })();
    return true;
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
