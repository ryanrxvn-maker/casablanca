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

async function checkEngine() {
  const tries = [state.port, 47923, 47924, 47925, 47926, 47927, 47928].filter(
    (v, i, a) => v && a.indexOf(v) === i,
  );
  for (const p of tries) {
    try {
      const res = await fetch(`http://127.0.0.1:${p}/health`, {
        method: 'GET',
      });
      if (!res.ok) continue;
      const j = await res.json();
      if (j && j.app === 'darkolab-downloader-engine') {
        if (p !== state.port) {
          state.port = p;
          await storageSet({ port: p });
        }
        return j;
      }
    } catch {
      /* tenta proxima porta */
    }
  }
  return null;
}

function show(boxId) {
  for (const id of ['pairBox', 'appBox', 'noEngine'])
    $(id).classList.toggle('hidden', id !== boxId);
}

async function refresh() {
  const cfg = await storageGet();
  state.token = cfg.token || '';
  state.port = cfg.port || 47923;

  const health = await checkEngine();
  $('engineDot').className = 'dot ' + (health ? 'on' : 'off');

  if (!health) return show('noEngine');
  if (!state.token) return show('pairBox');

  show('appBox');
  // +18 só aparece se o motor permitir
  if (health.allowAdult) {
    $('adultBtn').classList.remove('hidden');
  } else {
    $('adultBtn').classList.add('hidden');
    state.adult = false;
  }
}

// ---- pareamento ----
$('pairBtn').addEventListener('click', async () => {
  const tok = $('pairToken').value.trim();
  const port = parseInt($('pairPort').value, 10) || 47923;
  if (tok.length < 16) {
    $('pairMsg').textContent = 'Código muito curto.';
    return;
  }
  await storageSet({ token: tok, port });
  state.token = tok;
  state.port = port;
  // valida fazendo um /health (token nao e exigido la, mas confirma porta)
  const h = await checkEngine();
  if (!h) {
    $('pairMsg').textContent = 'Motor não respondeu nessa porta.';
    return;
  }
  await refresh();
});

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

async function downloadOne(url, el) {
  try {
    const res = await fetch(`${engineBase()}/download`, {
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

$('go').addEventListener('click', async () => {
  const urls = $('urls')
    .value.split(/[\n\s]+/)
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\//i.test(s));
  if (!urls.length) return;
  $('jobs').innerHTML = '';
  $('go').disabled = true;
  $('go').textContent = 'Baixando…';
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
  $('go').textContent = 'Baixar';
});

refresh();
