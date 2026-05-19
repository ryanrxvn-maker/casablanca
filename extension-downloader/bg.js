// Service worker: recebe pedido do botao na pagina e dispara o
// download pelo motor local via chrome.downloads (endpoint GET /get,
// token na query — sem precisar de blob no service worker).

chrome.runtime.onInstalled.addListener(() => {});

function getCfg() {
  return new Promise((r) =>
    chrome.storage.local.get(['token', 'port'], (v) => r(v || {})),
  );
}

async function findEnginePort(preferred) {
  const tries = [preferred, 47923, 47924, 47925, 47926, 47927, 47928].filter(
    (v, i, a) => v && a.indexOf(v) === i,
  );
  for (const p of tries) {
    try {
      const h = await fetch(`http://127.0.0.1:${p}/health`, {
        method: 'GET',
      });
      if (h.ok) {
        const j = await h.json();
        if (j && j.app === 'darkolab-downloader-engine') return p;
      }
    } catch {
      /* tenta proxima */
    }
  }
  return null;
}

async function startDownload({ url, mode, quality }) {
  const { token, port } = await getCfg();
  if (!token) {
    return { ok: false, error: 'Extensão não pareada. Abra a extensão e pareie com o motor.' };
  }
  const p = await findEnginePort(port || 47923);
  if (!p) {
    return { ok: false, error: 'Motor local não está rodando. Abra o DarkoLab Downloader.' };
  }
  if (p !== port) chrome.storage.local.set({ port: p });

  const qs = new URLSearchParams({
    t: token,
    url,
    mode: mode || 'video',
    quality: quality || '1080',
  }).toString();
  const dlUrl = `http://127.0.0.1:${p}/get?${qs}`;

  return new Promise((resolve) => {
    chrome.downloads.download({ url: dlUrl, saveAs: false }, (id) => {
      if (chrome.runtime.lastError || id === undefined) {
        resolve({
          ok: false,
          error: chrome.runtime.lastError?.message || 'falha ao iniciar',
        });
        return;
      }
      // acompanha pra reportar erro do servidor (ex.: 502/baixa vazia)
      const onChanged = (delta) => {
        if (delta.id !== id) return;
        if (delta.state && delta.state.current === 'complete') {
          chrome.downloads.onChanged.removeListener(onChanged);
          resolve({ ok: true });
        } else if (delta.error && delta.error.current) {
          chrome.downloads.onChanged.removeListener(onChanged);
          resolve({ ok: false, error: 'servidor: ' + delta.error.current });
        }
      };
      chrome.downloads.onChanged.addListener(onChanged);
      // resposta otimista após 1.2s se nada falhou ainda
      setTimeout(() => resolve({ ok: true }), 1200);
    });
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'darko-download') {
    startDownload(msg).then(sendResponse);
    return true; // resposta assíncrona
  }
});
