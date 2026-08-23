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

// ═══════════════════════════════════════════════════════════════
// AUTO CORTES (v1.8.0) — `darko-fetch`: entrega os BYTES pra PÁGINA.
//
// Por que isto existe: em tudo que veio antes o arquivo cai na BARRA DE
// DOWNLOADS (chrome.downloads) — a página nunca vê um byte. O Auto Cortes
// precisa do vídeo DENTRO do navegador (OPFS) pra cortar sem subir nada
// pro servidor, e a página não consegue buscar sozinha:
//   - Motor local: só libera CORS pra origens chrome-extension:// (o site
//     não tem token, nem ACAO, nem Allow-Private-Network).
//   - Google Drive: precisa dos COOKIES do usuário (arquivo privado) e da
//     cadeia de confirmação de arquivo grande.
// O service worker consegue os dois (host_permissions) — então ele faz o
// fetch em STREAM e repassa o corpo em pedaços pro content script, que
// converte em ArrayBuffer e entrega pra página.
//
// Protocolo (SW → content script, via chrome.tabs.sendMessage):
//   darko-fetch-meta     { reqId, filename, size|null, mime }
//   darko-fetch-chunk    { reqId, idx, b64 }        (8 MB CRUS por chunk)
//   darko-fetch-progress { reqId, received, total|null, phase }
//   darko-fetch-done     { reqId, total, chunks }
//   darko-fetch-error    { reqId, error }
// Cada mensagem é ACKada pelo bridge (sendResponse) — o SW só manda o
// próximo chunk depois do ack. Isso é BACKPRESSURE: sem ele, o SW despeja
// 8 MB a cada poucos ms, a fila do Chrome estoura e volta o velho "chunk N
// faltou (chrome.tabs.sendMessage perdeu mensagem)".
//
// 8 MB crus → ~10,7 MB de base64 (limite de mensagem é 64 MiB — folga de 6×).
// Inatividade: 90 s sem bytes aborta. Teto absoluto: 45 min por pedido.
// ═══════════════════════════════════════════════════════════════

const FETCH_RAW_CHUNK = 8 * 1024 * 1024; // 8 MB crus -> ~10,7 MB base64
const FETCH_IDLE_MS = 90000; // 90 s sem bytes = conexão morta
const FETCH_ABSOLUTE_MS = 45 * 60 * 1000; // teto duro por pedido
const FETCH_ACK_MS = 120000; // ack do content script (aba ocupada gravando)
// O Motor roda o yt-dlp INTEIRO antes de escrever o 1º byte da resposta
// (server.cjs: `await processDownload(...)` e só então res.writeHead). Num
// podcast de 2 h isso passa de 90 s fácil — por isso o cabeçalho do Motor
// tem prazo próprio e a página recebe pulsos pra não achar que morreu.
const FETCH_ENGINE_HEADERS_MS = 40 * 60 * 1000;

/** Pedidos vivos: reqId -> estado (permite abortar de fora). */
const activeFetches = new Map();

function b64FromBytes(bytes) {
  let binary = '';
  const STEP = 0x8000;
  for (let i = 0; i < bytes.length; i += STEP) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + STEP));
  }
  return btoa(binary);
}

/** chrome.tabs.sendMessage em Promise — resolve no ACK do content script. */
function sendToTab(tabId, msg) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(arg);
    };
    const timer = setTimeout(
      () => done(reject, new Error('a aba não confirmou o recebimento')),
      FETCH_ACK_MS,
    );
    try {
      chrome.tabs.sendMessage(tabId, msg, () => {
        const err = chrome.runtime.lastError;
        if (!err) return done(resolve, undefined);
        const m = String(err.message || '');
        // "message port closed" = entregou mas ninguém respondeu (bridge
        // antigo). Não é motivo pra derrubar o download.
        if (/message port closed/i.test(m)) return done(resolve, undefined);
        done(reject, new Error(m || 'aba não respondeu'));
      });
    } catch (e) {
      done(reject, e instanceof Error ? e : new Error(String(e)));
    }
  });
}

/** Nome do arquivo pelo content-disposition; senão pelo caminho da URL. */
function filenameFromResponse(res, url, fallback) {
  const cd = res.headers.get('content-disposition') || '';
  let m = cd.match(/filename\*=UTF-8''([^;]+)/i);
  if (m) {
    try {
      return decodeURIComponent(m[1]).trim();
    } catch {
      /* segue pro filename simples */
    }
  }
  m = cd.match(/filename="([^"]+)"/i) || cd.match(/filename=([^;]+)/i);
  if (m) return m[1].trim();
  try {
    const p = new URL(url).pathname.split('/').filter(Boolean).pop();
    if (p && /\.[a-z0-9]{2,5}$/i.test(p)) return decodeURIComponent(p);
  } catch {
    /* ignora */
  }
  return fallback || 'video.mp4';
}

/** Extrai o ID do arquivo do Drive de uma URL/ID cru (mesma regra da lib). */
function driveFileIdFrom(input) {
  const s = String(input || '');
  if (/^[a-zA-Z0-9_-]{20,60}$/.test(s)) return s;
  const pats = [
    /\/file\/d\/([a-zA-Z0-9_-]{20,60})/,
    /[?&]id=([a-zA-Z0-9_-]{20,60})/,
    /\/d\/([a-zA-Z0-9_-]{20,60})/,
  ];
  for (const re of pats) {
    const m = s.match(re);
    if (m) return m[1];
  }
  return null;
}

/**
 * Baixa UMA url em stream e emite os chunks pra aba.
 * Retorna { done: true, size } | { err, confirm?, uuid? }.
 * Nunca lança — erro vira { err }.
 */
async function darkoFetchStream(ctx, url, opts) {
  const { tabId, reqId, state } = ctx;
  const controller = new AbortController();
  state.controller = controller;
  let idle = null;
  let pulse = null;
  const armIdle = (ms) => {
    clearTimeout(idle);
    idle = setTimeout(() => {
      state.idleAbort = true;
      try {
        controller.abort();
      } catch {
        /* ignora */
      }
    }, ms || FETCH_IDLE_MS);
  };
  const stopTimers = () => {
    clearTimeout(idle);
    if (pulse) clearInterval(pulse);
    pulse = null;
  };
  try {
    // Enquanto o Motor prepara o arquivo não chega byte nenhum: manda pulso
    // pra página não estourar o watchdog dela.
    if (opts.pulse) {
      pulse = setInterval(() => {
        sendToTab(tabId, {
          type: 'darko-fetch-progress',
          reqId,
          received: state.received,
          total: state.total,
          phase: 'motor',
        }).catch(() => {
          /* aba sumiu — o próprio fetch cai depois */
        });
      }, 5000);
    }
    armIdle(opts.headersTimeoutMs);
    const r = await fetch(url, {
      method: 'GET',
      credentials: opts.credentials || 'omit',
      redirect: 'follow',
      signal: controller.signal,
    });
    if (pulse) {
      clearInterval(pulse);
      pulse = null;
    }
    armIdle();
    if (!r.ok) {
      stopTimers();
      return { err: `HTTP ${r.status}`, status: r.status };
    }
    if (!r.body) {
      stopTimers();
      return { err: 'resposta sem corpo' };
    }
    const total = parseInt(r.headers.get('content-length') || '0', 10) || null;
    state.total = total;
    const mime =
      (r.headers.get('content-type') || '').split(';')[0].trim() ||
      'application/octet-stream';
    const filename = filenameFromResponse(r, url, opts.fallbackName);

    const reader = r.body.getReader();
    let pending = [];
    let pendingLen = 0;
    let sniffed = !opts.sniffHtml;
    let htmlMode = false;
    let htmlParts = [];
    let lastProgressAt = 0;

    const sendMeta = async () => {
      if (state.metaSent) return;
      state.metaSent = true;
      await sendToTab(tabId, {
        type: 'darko-fetch-meta',
        reqId,
        filename,
        size: total,
        mime,
      });
    };

    const flush = async (force) => {
      while (pendingLen >= FETCH_RAW_CHUNK || (force && pendingLen > 0)) {
        const take = Math.min(FETCH_RAW_CHUNK, pendingLen);
        const out = new Uint8Array(take);
        let off = 0;
        while (off < take) {
          const head = pending[0];
          const need = take - off;
          if (head.length <= need) {
            out.set(head, off);
            off += head.length;
            pending.shift();
          } else {
            out.set(head.subarray(0, need), off);
            pending[0] = head.subarray(need);
            off += need;
          }
        }
        pendingLen -= take;
        await sendToTab(tabId, {
          type: 'darko-fetch-chunk',
          reqId,
          idx: state.sentChunks,
          b64: b64FromBytes(out),
        });
        state.sentChunks++;
        armIdle(); // ack conta como sinal de vida
      }
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      armIdle();
      state.received += value.length;
      pending.push(value);
      pendingLen += value.length;

      if (!sniffed) {
        if (pendingLen < 3000) continue;
        const headBytes = new Uint8Array(3000);
        let o = 0;
        for (const p of pending) {
          const n = Math.min(p.length, 3000 - o);
          headBytes.set(p.subarray(0, n), o);
          o += n;
          if (o >= 3000) break;
        }
        sniffed = true;
        htmlMode = /<html|<!DOCTYPE/i.test(new TextDecoder().decode(headBytes));
        if (!htmlMode) await sendMeta();
      }
      if (htmlMode) {
        // página de confirm/erro é pequena — guarda inteira pra parsear
        htmlParts = htmlParts.concat(pending);
        pending = [];
        pendingLen = 0;
        continue;
      }
      await flush(false);
      const now = Date.now();
      if (now - lastProgressAt > 700) {
        lastProgressAt = now;
        await sendToTab(tabId, {
          type: 'darko-fetch-progress',
          reqId,
          received: state.received,
          total,
          phase: 'baixando',
        });
        armIdle();
      }
    }

    if (!sniffed) {
      // arquivo menor que 3000 bytes — sniffa o que veio
      const all = new Uint8Array(pendingLen);
      let o = 0;
      for (const p of pending) {
        all.set(p, o);
        o += p.length;
      }
      sniffed = true;
      if (/<html|<!DOCTYPE/i.test(new TextDecoder().decode(all))) {
        htmlMode = true;
        htmlParts = [all];
        pending = [];
        pendingLen = 0;
      }
    }

    if (htmlMode) {
      stopTimers();
      let len = 0;
      for (const p of htmlParts) len += p.length;
      const htmlAll = new Uint8Array(len);
      let o = 0;
      for (const p of htmlParts) {
        htmlAll.set(p, o);
        o += p.length;
      }
      const allText = new TextDecoder().decode(htmlAll);
      const confirmMatch = allText.match(/confirm=([0-9A-Za-z_-]+)/);
      const uuidMatch = allText.match(/uuid=([0-9a-f-]+)/);
      const formAction = allText.match(/action="([^"]+download[^"]*)"/);
      if (confirmMatch || uuidMatch || formAction) {
        return {
          err: 'needs_confirm',
          confirm: confirmMatch ? confirmMatch[1] : undefined,
          uuid: uuidMatch ? uuidMatch[1] : undefined,
        };
      }
      if (/sign in|signin|accounts\.google/i.test(allText.slice(0, 3000))) {
        return { err: 'login (arquivo privado OU você não está logado no Google)' };
      }
      return { err: 'o link devolveu uma página, não um arquivo (sem permissão?)' };
    }

    if (!state.metaSent) await sendMeta();
    await flush(true);
    stopTimers();
    await sendToTab(tabId, {
      type: 'darko-fetch-progress',
      reqId,
      received: state.received,
      total,
      phase: 'baixando',
    });
    return { done: true, size: state.received };
  } catch (e) {
    stopTimers();
    const aborted = e && e.name === 'AbortError';
    if (aborted && state.canceled) return { err: 'cancelado' };
    if (aborted && state.idleAbort) {
      state.idleAbort = false;
      return { err: 'inatividade 90s (a conexão parou de mandar bytes)' };
    }
    if (aborted) return { err: 'tempo esgotado' };
    return { err: 'falha de rede: ' + ((e && e.message) || e) };
  }
}

/** Motor local: pareia (token fresco) e faz stream do /get. */
async function darkoFetchEngine(ctx, msg) {
  const cfg = await getCfg();
  let eng = await discoverEngine(cfg.port || 47923);
  if (!eng) {
    return {
      err: 'O Motor não está aberto neste computador. Abra o Auto Edit Downloader pelo menu Iniciar e tente de novo.',
    };
  }
  const build = (token, port) =>
    `http://127.0.0.1:${port}/get?` +
    new URLSearchParams({
      t: token,
      url: msg.url,
      mode: msg.mode || 'video',
      quality: msg.quality || '1080',
    }).toString();
  const opts = {
    credentials: 'omit',
    sniffHtml: false,
    pulse: true,
    headersTimeoutMs: FETCH_ENGINE_HEADERS_MS,
    fallbackName: 'video.mp4',
  };
  let r = await darkoFetchStream(ctx, build(eng.token, eng.port), opts);
  // Token defasado (Motor reiniciou): re-pareia UMA vez — só se ainda não
  // saiu byte nenhum, senão misturaria dois downloads no mesmo reqId.
  if (!r.done && r.status === 401 && ctx.state.sentChunks === 0) {
    try {
      await chrome.storage.local.set({ token: '' });
    } catch {
      /* segue */
    }
    eng = await discoverEngine(cfg.port || 47923);
    if (eng) r = await darkoFetchStream(ctx, build(eng.token, eng.port), opts);
  }
  return r;
}

/**
 * Google Drive pela sessão logada. Cadeia de URLs portada do
 * extension/background.js `handleDownloadDrive` (extensão do HeyGen):
 * uc → uc+confirm/uuid → usercontent → usercontent+confirm → uc&confirm=t
 * → u/0/uc. Se uma estratégia JÁ emitiu chunks e caiu, NÃO tenta a próxima
 * (a página teria pedaços de dois downloads no mesmo reqId).
 */
async function darkoFetchDrive(ctx, msg) {
  const fileId = driveFileIdFrom(msg.url);
  if (!fileId) return { err: 'não achei o ID do arquivo nesse link do Drive' };
  const st = ctx.state;
  const errors = [];
  const opts = {
    credentials: 'include',
    sniffHtml: true,
    pulse: false,
    headersTimeoutMs: FETCH_IDLE_MS,
    fallbackName: 'drive.mp4',
  };
  const run = (u) => darkoFetchStream(ctx, u, opts);

  let final = await run(`https://drive.google.com/uc?export=download&id=${fileId}`);
  if (!final.done && final.err === 'needs_confirm' && st.sentChunks === 0 && (final.confirm || final.uuid)) {
    errors.push('uc: pede confirmação');
    const params = new URLSearchParams({ id: fileId, export: 'download' });
    if (final.confirm) params.set('confirm', final.confirm);
    if (final.uuid) params.set('uuid', final.uuid);
    final = await run(`https://drive.google.com/uc?${params}`);
    if (!final.done) errors.push(`uc+confirm: ${final.err}`);
  } else if (!final.done) {
    errors.push(`uc: ${final.err}`);
  }
  if (!final.done && st.sentChunks === 0) {
    final = await run(
      `https://drive.usercontent.google.com/download?id=${fileId}&export=download&authuser=0&confirm=t`,
    );
    if (!final.done && final.err === 'needs_confirm' && st.sentChunks === 0 && (final.confirm || final.uuid)) {
      const params = new URLSearchParams({ id: fileId, export: 'download', authuser: '0' });
      if (final.confirm) params.set('confirm', final.confirm);
      if (final.uuid) params.set('uuid', final.uuid);
      final = await run(`https://drive.usercontent.google.com/download?${params}`);
      if (!final.done) errors.push(`usercontent+confirm: ${final.err}`);
    } else if (!final.done) {
      errors.push(`usercontent: ${final.err}`);
    }
  }
  if (!final.done && st.sentChunks === 0) {
    final = await run(`https://drive.google.com/uc?export=download&id=${fileId}&confirm=t`);
    if (!final.done) errors.push(`uc+confirm=t: ${final.err}`);
  }
  if (!final.done && st.sentChunks === 0) {
    final = await run(`https://drive.google.com/u/0/uc?id=${fileId}&export=download&confirm=t`);
    if (!final.done) errors.push(`u/0/uc: ${final.err}`);
  }
  if (!final.done) {
    const parcial =
      st.sentChunks > 0
        ? `A conexão com o Drive caiu no meio do download (${st.sentChunks} pedaços recebidos). Tente de novo. `
        : 'Não consegui baixar do Drive. Confira se você está logado no Google e se tem acesso ao arquivo. ';
    return { err: parcial + (errors.length ? 'Detalhes: ' + errors.join(' | ') : '') };
  }
  return final;
}

async function handleDarkoFetch(msg, tabId) {
  const reqId = String(msg.reqId || '');
  const state = {
    sentChunks: 0,
    received: 0,
    total: null,
    metaSent: false,
    canceled: false,
    idleAbort: false,
    controller: null,
  };
  activeFetches.set(reqId, state);
  const ctx = { tabId, reqId, state };
  const absolute = setTimeout(() => {
    state.canceled = true;
    try {
      if (state.controller) state.controller.abort();
    } catch {
      /* ignora */
    }
  }, FETCH_ABSOLUTE_MS);
  try {
    const r =
      msg.kind === 'drive'
        ? await darkoFetchDrive(ctx, msg)
        : await darkoFetchEngine(ctx, msg);
    if (r && r.done) {
      await sendToTab(tabId, {
        type: 'darko-fetch-done',
        reqId,
        total: r.size,
        chunks: state.sentChunks,
      }).catch(() => {});
    } else {
      await sendToTab(tabId, {
        type: 'darko-fetch-error',
        reqId,
        error: String((r && r.err) || 'falhou'),
      }).catch(() => {});
    }
  } catch (e) {
    try {
      await sendToTab(tabId, {
        type: 'darko-fetch-error',
        reqId,
        error: String((e && e.message) || e),
      });
    } catch {
      /* aba foi embora */
    }
  } finally {
    clearTimeout(absolute);
    activeFetches.delete(reqId);
  }
}

// Listener SEPARADO do antigo de propósito: o MV3 entrega a mensagem pra
// todos os listeners e a porta fica aberta se QUALQUER um devolver true.
// Assim o fluxo velho (darko-download / darko-ping-engine / ...) não muda
// uma vírgula.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'darko-fetch') {
    const tabId = sender && sender.tab && sender.tab.id;
    if (!tabId) {
      sendResponse({ ok: false, error: 'sem aba de origem' });
      return true;
    }
    ensureKeepalive();
    // Responde JÁ (o pedido é longo; o resultado vai por tabs.sendMessage).
    sendResponse({ ok: true, started: true });
    handleDarkoFetch(msg, tabId);
    return true;
  }
  if (msg && msg.type === 'darko-fetch-abort') {
    const st = activeFetches.get(String(msg.reqId || ''));
    if (st) {
      st.canceled = true;
      try {
        if (st.controller) st.controller.abort();
      } catch {
        /* ignora */
      }
    }
    sendResponse({ ok: true, found: !!st });
    return true;
  }
});
