// Service worker: recebe pedido do botao na pagina e dispara o
// download pelo motor local via chrome.downloads (endpoint GET /get,
// token na query — sem precisar de blob no service worker).

chrome.runtime.onInstalled.addListener(() => {});

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

async function startDownload({ url, mode, quality, adult }) {
  const eng = await discoverEngine((await getCfg()).port || 47923);
  if (!eng) {
    return {
      ok: false,
      error: 'Motor local não está rodando. Abra o DarkoLab Downloader.',
    };
  }
  const p = eng.port;
  const params = {
    t: eng.token,
    url,
    mode: mode || 'video',
    quality: quality || '1080',
  };
  if (adult === true) params.adult = '1';
  const qs = new URLSearchParams(params).toString();
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
      let settled = false;
      const finish = (r) => {
        if (settled) return;
        settled = true;
        chrome.downloads.onChanged.removeListener(onChanged);
        clearTimeout(cap);
        resolve(r);
      };
      // espera o RESULTADO REAL (sem "ok" otimista): so resolve quando
      // completar de verdade ou der erro do servidor (401/502/etc).
      const onChanged = (delta) => {
        if (delta.id !== id) return;
        if (delta.state && delta.state.current === 'complete') {
          finish({ ok: true });
        } else if (delta.error && delta.error.current) {
          const e = String(delta.error.current);
          const friendly = /FORBIDDEN|SERVER_FAILED|BLOCKED|FAILED/i.test(e)
            ? 'Falha no motor (código pode ter mudado — re-pareie pelo CODIGO.cmd) ou link inválido.'
            : 'servidor: ' + e;
          finish({ ok: false, error: friendly });
        }
      };
      chrome.downloads.onChanged.addListener(onChanged);
      // teto de seguranca: nunca prende a UI pra sempre
      const cap = setTimeout(
        () => finish({ ok: false, error: 'tempo esgotado — tente de novo.' }),
        300000,
      );
    });
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'darko-download') {
    startDownload(msg).then(sendResponse);
    return true; // resposta assíncrona
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
