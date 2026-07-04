'use strict';

const ADULT_SITES = [
  'pornhub.com',
  'xvideos.com',
  'xhamster.com',
  'redtube.com',
  'youporn.com',
  'xvideosputaria.com',
  'buceteiro.com',
];

const $ = (id) => document.getElementById(id);
const state = { token: '', port: 47923, mode: 'video', quality: '1080', adult: false };

function engineBase() {
  return `http://127.0.0.1:${state.port}`;
}

async function storageGet() {
  return new Promise((r) =>
    chrome.storage.local.get(['token', 'port'], (v) => r(v || {})),
  );
}
async function storageSet(v) {
  return new Promise((r) => chrome.storage.local.set(v, r));
}

// fetch com timeout DURO — NUNCA pendura. Uma porta zumbi (socket
// meio-aberto, antivirus/firewall segurando, motor travado) nao pode mais
// congelar a conexao: o AbortSignal aborta em `ms` e a promise rejeita.
function tfetch(url, ms) {
  return fetch(url, { signal: AbortSignal.timeout(ms) });
}

// Testa UMA porta: /health tem que responder com o app certo, dai /pair
// devolve o token. Resolve com o engine ou LANCA (pra Promise.any pular
// pra proxima). Timeout curto (1.4s) por chamada.
async function probePort(p) {
  const h = await tfetch(`http://127.0.0.1:${p}/health`, 1400);
  if (!h.ok) throw 0;
  const j = await h.json();
  if (!j || j.app !== 'darkolab-downloader-engine') throw 0;
  const pr = await tfetch(`http://127.0.0.1:${p}/pair`, 1400);
  if (!pr.ok) throw 0;
  const pj = await pr.json();
  if (!pj || !pj.token) throw 0;
  return { port: p, token: pj.token, allowAdult: pj.allowAdult === true };
}

// AUTO-PAIR DEFINITIVO: varre TODAS as portas EM PARALELO com timeout. A
// primeira que tiver o motor vivo ganha; porta lenta/zumbi nao atrasa as
// outras NEM trava a funcao. (O loop serial-sem-timeout antigo pendurava
// pra sempre numa porta meio-morta -> popup eterno em "Conectando".)
// Nunca usa token cacheado stale — sempre pega o /pair atual do motor.
async function refreshPair() {
  const tries = [state.port, 47923, 47924, 47925, 47926, 47927, 47928].filter(
    (v, i, a) => v && a.indexOf(v) === i,
  );
  try {
    const eng = await Promise.any(tries.map(probePort));
    state.token = eng.token;
    state.port = eng.port;
    await storageSet({ token: eng.token, port: eng.port });
    return { allowAdult: eng.allowAdult };
  } catch {
    return null; // nenhuma porta respondeu a tempo
  }
}

function show(boxId) {
  for (const id of ['appBox', 'noEngine'])
    $(id).classList.toggle('hidden', id !== boxId);
}

// Guarda anti-reentrancia: se ja estamos varrendo, nao dispara outra —
// evita duas varreduras concorrentes pisando no state.
let refreshing = false;

async function refresh() {
  if (refreshing) return;
  refreshing = true;
  const lbl = $('engineLabel');
  if (lbl) lbl.textContent = 'Conectando';
  $('engineDot').className = 'dot off';
  try {
    const cfg = await storageGet();
    state.token = cfg.token || '';
    state.port = cfg.port || 47923;

    const eng = await refreshPair();
    $('engineDot').className = 'dot ' + (eng ? 'on' : 'off');
    if (lbl) lbl.textContent = eng ? 'Online' : 'Offline';

    if (!eng) {
      show('noEngine');
      return;
    }
    show('appBox');
    // +18 liberado pra todos
    $('adultBtn').classList.remove('hidden');
  } catch {
    // Qualquer erro inesperado -> estado terminal claro, NUNCA limbo.
    $('engineDot').className = 'dot off';
    if (lbl) lbl.textContent = 'Offline';
    show('noEngine');
  } finally {
    refreshing = false;
  }
}

// HARD REFRESH: reconexao limpa e forcada. Apaga token/porta/cache stale,
// pede pro service worker redescobrir do zero e revarre as portas. Para o
// usuario nunca ter que "ficar esperando" quando algo trava — 1 clique
// resolve. (Botao ↻ no header.)
async function hardRefresh() {
  const btn = $('hardRefresh');
  if (btn) btn.classList.add('spin');
  const lbl = $('engineLabel');
  if (lbl) lbl.textContent = 'Reconectando';
  try {
    await new Promise((r) =>
      chrome.storage.local.remove(
        ['token', 'port', 'engineUp', 'enginePortCache', 'engineCheckedAt'],
        () => r(),
      ),
    );
    state.token = '';
    state.port = 47923;
    // limpa tambem o cache do background (fire-and-forget)
    try {
      chrome.runtime.sendMessage({ type: 'darko-force-rediscover' }, () => {
        void chrome.runtime.lastError;
      });
    } catch {
      /* SW pode estar acordando */
    }
  } catch {
    /* segue pro refresh de qualquer jeito */
  }
  await refresh();
  if (btn) btn.classList.remove('spin');
}

const retryLink = $('retry');
if (retryLink)
  retryLink.addEventListener('click', (e) => {
    e.preventDefault();
    refresh();
  });

const hardBtn = $('hardRefresh');
if (hardBtn) hardBtn.addEventListener('click', hardRefresh);

// Ultimo recurso: recarrega a extensao inteira — mata service worker
// zumbi/travado e reinicia tudo do zero. (Fecha o popup.)
const reloadLink = $('reloadExt');
if (reloadLink)
  reloadLink.addEventListener('click', (e) => {
    e.preventDefault();
    try {
      chrome.runtime.reload();
    } catch {
      /* ignore */
    }
  });

// ---- chips ----
function wireChips(containerId, key) {
  const c = $(containerId);
  c.addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    [...c.children].forEach((x) => x.classList.toggle('on', x === b));
    state[key] = b.dataset.v;
    if (key === 'mode') {
      const isVid = state.mode === 'video';
      [...$('quals').children].forEach((x) => (x.disabled = !isVid));
    }
  });
}
wireChips('modes', 'mode');
wireChips('quals', 'quality');

// ---- +18 ----
$('adultBtn').addEventListener('click', () => {
  state.adult = !state.adult;
  $('adultBtn').classList.toggle('on', state.adult);
  const list = $('adultList');
  list.classList.toggle('hidden', !state.adult);
  if (state.adult)
    list.textContent = 'Sites +18: ' + ADULT_SITES.join('  ·  ');
});

// ---- download ----
function parseFilename(cd, fallback) {
  const m = /filename="?([^"]+)"?/i.exec(cd || '');
  return (m && m[1]) || fallback;
}

function addJob(url) {
  const el = document.createElement('div');
  el.className = 'job';
  el.innerHTML = `<span class="u">${url}</span><span class="tag run">baixando</span>`;
  $('jobs').appendChild(el);
  return el;
}

async function postDownload(url) {
  return fetch(`${engineBase()}/download`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${state.token}`,
    },
    body: JSON.stringify({
      url,
      mode: state.mode,
      quality: state.quality,
      adult: state.adult,
    }),
  });
}

async function downloadOne(url, el) {
  try {
    // pega token vivo antes (sempre fresh — invalida storage stale)
    if (!state.token) await refreshPair();
    let res = await postDownload(url);
    if (res.status === 401) {
      // motor regerou token? re-pair forcado e tenta de novo
      if (await refreshPair()) {
        res = await postDownload(url);
      }
    }
    if (!res.ok) {
      let msg = 'HTTP ' + res.status;
      try {
        msg = (await res.json()).error || msg;
      } catch {}
      throw new Error(msg);
    }
    const cd = res.headers.get('content-disposition') || '';
    const blob = await res.blob();
    const name = parseFilename(cd, `download-${Date.now()}`);
    const objUrl = URL.createObjectURL(blob);
    await new Promise((resolve, reject) => {
      chrome.downloads.download(
        { url: objUrl, filename: name, saveAs: false },
        (id) => {
          if (chrome.runtime.lastError || id === undefined)
            reject(new Error(chrome.runtime.lastError?.message || 'download'));
          else resolve(id);
        },
      );
    });
    setTimeout(() => URL.revokeObjectURL(objUrl), 60000);
    el.querySelector('.tag').className = 'tag ok';
    el.querySelector('.tag').textContent = 'ok';
  } catch (e) {
    el.querySelector('.tag').className = 'tag err';
    el.querySelector('.tag').textContent = (e.message || 'erro').slice(0, 40);
  }
}

function setDownloadLabel(text) {
  // O botão tem estrutura HTML; só troca o texto do <span> interno.
  const btn = $('go');
  const labelSpan = btn.querySelector('.download-btn-content span:last-child');
  if (labelSpan) labelSpan.textContent = text;
}

$('go').addEventListener('click', async () => {
  const urls = $('urls')
    .value.split(/[\n\s]+/)
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\//i.test(s));
  if (!urls.length) return;
  await refreshPair();
  $('jobs').innerHTML = '';
  $('go').disabled = true;
  setDownloadLabel('Baixando…');
  const els = urls.map(addJob);
  let next = 0;
  const worker = async () => {
    while (next < urls.length) {
      const i = next++;
      await downloadOne(urls[i], els[i]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(3, urls.length) }, worker),
  );
  $('go').disabled = false;
  setDownloadLabel('Baixar');
});

refresh();
// Pos-restart do PC: motor pode demorar uns segs pra subir. Reconecta
// sozinho enquanto o popup esta aberto — SEMPRE que nao estiver conectado
// (appBox escondido), nao so no card de erro. Cobre inclusive o estado
// inicial em que os dois boxes ainda estao ocultos.
setInterval(() => {
  if (refreshing) return;
  const appBox = document.getElementById('appBox');
  const connected = appBox && !appBox.classList.contains('hidden');
  if (!connected) refresh();
}, 2500);
