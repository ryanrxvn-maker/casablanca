/**
 * DARKO LAB - inject.js (roda no MAIN WORLD da pagina HeyGen)
 *
 * Patch window.fetch + XMLHttpRequest pra capturar TODAS as POST requests
 * a endpoints de generate do HeyGen. Quando capturar uma response com
 * video_id, posta uma message darkolab-injected que o content script
 * (isolated world) vai escutar.
 *
 * Por que precisa rodar no main world: content scripts em isolated world
 * nao conseguem fazer patch do window.fetch da pagina (o site usa o fetch
 * dele, nao o nosso). Inject script via <script> tag roda no contexto da
 * pagina e consegue interceptar.
 *
 * Garantia 100%: o video_id capturado AQUI eh exatamente o retornado pela
 * request que A GENTE disparou clicando Generate, NAO o de outra pessoa
 * usando a mesma conta HeyGen ao mesmo tempo.
 */
(function () {
  if (window.__darkolab_intercept_loaded__) return;
  window.__darkolab_intercept_loaded__ = true;

  const URL_RE = /heygen\.com.*(?:video|generate|create)/i;

  function emit(payload) {
    try {
      window.postMessage(
        {
          source: 'darkolab-injected',
          type: 'VIDEO_GENERATED',
          ts: Date.now(),
          ...payload,
        },
        '*',
      );
    } catch (e) {}
  }

  function tryExtractId(j) {
    if (!j || typeof j !== 'object') return null;
    return (
      j?.data?.video_id ??
      j?.data?.id ??
      j?.data?.uuid ??
      j?.video_id ??
      j?.id ??
      j?.uuid ??
      null
    );
  }

  // --- Patch window.fetch ---
  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : input?.url || '';
    const method = (
      (init && init.method) ||
      (typeof input === 'object' && input?.method) ||
      'GET'
    ).toUpperCase();
    const isInteresting = method === 'POST' && URL_RE.test(url);
    // Log REQUEST BODY de /submit (Quick Create / VA) pra reverse-eng
    // de param names tipo voice_mirroring. Logado no console + window.
    if (isInteresting && /shortcut|submit|generate|create/.test(url) && init && init.body) {
      try {
        const b = init.body;
        let bodyStr = '';
        if (typeof b === 'string') bodyStr = b;
        else if (b instanceof FormData) {
          const o = {}; b.forEach((v, k) => { o[k] = String(v).slice(0, 200); });
          bodyStr = JSON.stringify(o);
        }
        if (bodyStr) {
          console.log('[DARKO LAB inject] REQ BODY', url.slice(0, 80), bodyStr.slice(0, 2000));
          window.__darkolab_lastReqBody = { url, body: bodyStr.slice(0, 5000), ts: Date.now() };
        }
      } catch (e) {}
    }
    const p = origFetch.apply(this, arguments);
    if (isInteresting) {
      p.then(async (res) => {
        try {
          if (!res || res.status >= 400) return;
          const clone = res.clone();
          const j = await clone.json().catch(() => null);
          const id = tryExtractId(j);
          if (id) {
            console.log('[DARKO LAB inject] fetch capturou video_id', id, 'via', url);
            emit({ video_id: id, url, source_method: 'fetch' });
          }
        } catch (e) {}
      }).catch(() => {});
    }
    return p;
  };

  // --- Patch XMLHttpRequest ---
  const OrigXHR = window.XMLHttpRequest;
  function PatchedXHR() {
    const xhr = new OrigXHR();
    let _url = '';
    let _method = '';
    const origOpen = xhr.open;
    xhr.open = function (method, url) {
      _method = String(method || '').toUpperCase();
      _url = String(url || '');
      return origOpen.apply(this, arguments);
    };
    xhr.addEventListener('load', function () {
      try {
        if (_method !== 'POST' || !URL_RE.test(_url)) return;
        if (this.status >= 400) return;
        const text = this.responseText;
        if (!text) return;
        let j = null;
        try {
          j = JSON.parse(text);
        } catch {
          return;
        }
        const id = tryExtractId(j);
        if (id) {
          console.log('[DARKO LAB inject] XHR capturou video_id', id, 'via', _url);
          emit({ video_id: id, url: _url, source_method: 'xhr' });
        }
      } catch (e) {}
    });
    return xhr;
  }
  PatchedXHR.prototype = OrigXHR.prototype;
  // Copia propriedades estaticas
  for (const k in OrigXHR) {
    try {
      PatchedXHR[k] = OrigXHR[k];
    } catch (e) {}
  }
  window.XMLHttpRequest = PatchedXHR;

  console.log('[DARKO LAB inject] fetch+XHR patched - listening pra video_id em POST a *heygen.com*video*');
})();
