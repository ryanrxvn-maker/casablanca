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

// AUTO-PAIR DEFINITIVO: a cada chamada, varre as portas conhecidas, acha
// o motor vivo e PEGA o token atual via /pair. Nunca usa token cacheado
// stale. Acaba o cenario "atualizei o motor e a extensao ficou com token
// velho -> 401 Token invalido". Devolve true se conseguiu pareamento.
async function refreshPair() {
  const tries = [state.port, 47923, 47924, 47925, 47926, 47927, 47928].filter(
    (v, i, a) => v && a.indexOf(v) === i,
  );
  for (const p of tries) {
    try {
      const h = await fetch(`http://127.0.0.1:${p}/health`);
      if (!h.ok) continue;
      const j = await h.json();
      if (!j || j.app !== 'darkolab-downloader-engine') continue;
      const pr = await fetch(`http://127.0.0.1:${p}/pair`);
      if (!pr.ok) continue;
      const pj = await pr.json();
      if (pj && pj.token) {
        state.token = pj.token;
        state.port = p;
        await storageSet({ token: pj.token, port: p });
        return { allowAdult: pj.allowAdult === true };
      }
    } catch {
      /* tenta proxima */
    }
  }
  return null;
}

function show(boxId) {
  for (const id of ['appBox', 'noEngine'])
    $(id).classList.toggle('hidden', id !== boxId);
}

async function refresh() {
  const cfg = await storageGet();
  state.token = cfg.token || '';
  state.port = cfg.port || 47923;

  const eng = await refreshPair();
  $('engineDot').className = 'dot ' + (eng ? 'on' : 'off');
  const lbl = $('engineLabel');
  if (lbl) lbl.textContent = eng ? 'Online' : 'Conectando';

  if (!eng) return show('noEngine');

  show('appBox');
  // +18 liberado pra todos
  $('adultBtn').classList.remove('hidden');
}

$('retry').addEventListener('click', (e) => {
  e.preventDefault();
  refresh();
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
// sozinho enquanto o popup esta aberto.
setInterval(() => {
  const noEng = document.getElementById('noEngine');
  if (noEng && !noEng.classList.contains('hidden')) {
    refresh();
  }
}, 2500);
