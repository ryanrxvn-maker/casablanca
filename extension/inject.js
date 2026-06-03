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

  // É um submit de criação de video? (Quick Create / VA / Espelhamento de Voz)
  const SUBMIT_RE = /shortcut\/submit|\/submit\b|generate|\/create/i;

  // Captura o REQUEST BODY do submit NATIVO do HeyGen (a request 200/xhr do
  // vendor-*.js que dispara quando o user marca "Espelhamento de Voz"). Esse
  // é o payload-ouro: o shape EXATO que o HeyGen aceita pra voice mirror.
  // Guardado COMPLETO (sem truncar) em window pra reverse-eng confiavel —
  // acaba a adivinhacao de nome de campo no nosso createVideo().
  function captureSubmitBody(url, method, bodyStr, via) {
    try {
      if (!bodyStr) return;
      // Detecta sinais de voice mirror pra destacar no log
      const hasMirror = /mirror|voice_id|voice_setting|espelh/i.test(bodyStr);
      const rec = { url: String(url).slice(0, 200), method, via, body: bodyStr, ts: Date.now(), hasMirror };
      window.__darkolab_lastSubmitBody = rec;
      window.__darkolab_submitBodies = (window.__darkolab_submitBodies || []).slice(-9);
      window.__darkolab_submitBodies.push(rec);
      console.log(
        `%c[DARKO LAB inject] 🎯 SUBMIT BODY capturado (${via})${hasMirror ? ' — TEM voice mirror!' : ''}`,
        'color:#00e5ff;font-weight:bold',
        '\nurl:', rec.url,
        '\nbody:', bodyStr,
      );
      // Pretty: facilita copiar so o JSON
      try { console.log('[DARKO LAB inject] 🎯 SUBMIT BODY (pretty):\n' + JSON.stringify(JSON.parse(bodyStr), null, 2)); } catch {}
      // Repassa pro content script persistir/expor pro web app (auto-aprende o shape)
      emit({ type: 'SUBMIT_BODY_CAPTURED', submitUrl: rec.url, submitBody: bodyStr, via, hasMirror });
    } catch (e) {}
  }

  function bodyToString(b) {
    try {
      if (b == null) return '';
      if (typeof b === 'string') return b;
      if (b instanceof URLSearchParams) return b.toString();
      if (typeof FormData !== 'undefined' && b instanceof FormData) {
        const o = {}; b.forEach((v, k) => { o[k] = typeof v === 'string' ? v : '[blob]'; });
        return JSON.stringify(o);
      }
      if (typeof b === 'object') { try { return JSON.stringify(b); } catch { return ''; } }
      return '';
    } catch { return ''; }
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
    // Captura REQUEST BODY de /submit (Quick Create / VA / Espelhamento de
    // Voz) pra reverse-eng do shape real. Body COMPLETO via captureSubmitBody.
    if (method === 'POST' && SUBMIT_RE.test(url) && init && init.body != null) {
      captureSubmitBody(url, method, bodyToString(init.body), 'fetch');
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
    // Patch send pra capturar o REQUEST BODY do submit NATIVO do HeyGen.
    // A request 200/xhr do "Espelhamento de Voz" vem por aqui (vendor-*.js) —
    // antes so pegavamos a RESPONSE (video_id); agora pegamos o body-ouro.
    const origSend = xhr.send;
    xhr.send = function (body) {
      try {
        if (_method === 'POST' && SUBMIT_RE.test(_url) && body != null) {
          captureSubmitBody(_url, _method, bodyToString(body), 'xhr');
        }
      } catch (e) {}
      return origSend.apply(this, arguments);
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
