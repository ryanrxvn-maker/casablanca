/**
 * DARKO LAB Extension — Interceptor MAIN WORLD do ElevenLabs
 *
 * Roda em elevenlabs.io no MUNDO DA PAGINA (world: MAIN) e em
 * document_start — ANTES do bundle do app subir. Isso e o que garante que a
 * gente veja a PRIMEIRA chamada autenticada que o app faz (o
 * /v1/auth-account do boot) e nunca fique sem sessao.
 *
 * POR QUE ISSO EXISTE (e nao um "cole sua API key aqui"):
 *  a geracao TEM que sair pela SESSAO do user, igual ja fazemos no HeyGen —
 *  nada de creditos de API. So que, diferente do HeyGen (que autentica por
 *  cookie), o app do ElevenLabs manda um header de autorizacao proprio. Um
 *  content script sozinho nao enxerga esse header: ele nasce dentro do
 *  bundle da pagina. Entao a gente observa a propria requisicao do app e
 *  reusa o MESMO cabecalho pra falar com a MESMA conta.
 *
 * REGRA DE OURO — o credencial NUNCA sai da extensao:
 *   MAIN world (aqui) → content script (isolado) → background → fetch pro
 *   ElevenLabs. Ele nao volta pro DARKO LAB, nao vai pro servidor, nao entra
 *   em log. O que a pagina do DARKO LAB recebe e so { ok, detail }.
 *
 * Tambem guardamos o SHAPE da chamada nativa de TTS (URL + campos do corpo,
 * SEM o texto) como "payload-ouro" de diagnostico: se o ElevenLabs mudar o
 * contrato, da pra ver o que o app real manda hoje em vez de adivinhar.
 * Mesmo padrao do HG_GET_LAST_SUBMIT do HeyGen.
 */

(function () {
  if (window.__darkolab_el_intercept__) return;
  window.__darkolab_el_intercept__ = true;

  /** Host de API do ElevenLabs? Cobre api.elevenlabs.io e os regionais
   *  (api.us / api.eu / api.in ...). O app do user hoje fala com api.us. */
  function isApiHost(host) {
    return /^api(\.[a-z0-9-]+)?\.elevenlabs\.io$/i.test(host);
  }

  /** Headers que carregam identidade. Guardamos SO esses — nada de varrer
   *  o resto (content-type, accept e afins nao interessam e so aumentam a
   *  chance de vazar coisa que nao precisa). */
  function isAuthHeader(name) {
    const n = String(name || '').toLowerCase();
    return (
      n === 'authorization' ||
      n === 'xi-api-key' ||
      n === 'x-api-key' ||
      // Headers proprietarios do app (xi-*), menos os de telemetria.
      (n.startsWith('xi-') && !/^xi-(client-)?(version|platform|locale)$/.test(n))
    );
  }

  /** Ultimo conjunto de headers de auth visto, por host de API. */
  const authByHost = new Map();
  /** Shape da ultima chamada nativa de TTS (sem o texto). */
  let lastTts = null;

  function publishAuth(host, headers) {
    if (!host || !headers || Object.keys(headers).length === 0) return;
    const prev = authByHost.get(host);
    // Só republica quando muda de verdade — o app refaz dezenas de chamadas
    // por minuto e cada postMessage acorda o content script à toa.
    if (prev && JSON.stringify(prev) === JSON.stringify(headers)) return;
    authByHost.set(host, headers);
    try {
      window.postMessage(
        {
          source: 'darkolab-el-injected',
          type: 'EL_AUTH',
          apiHost: host,
          headers,
          ts: Date.now(),
        },
        window.location.origin,
      );
    } catch (e) {
      /* postMessage nunca pode derrubar a pagina do user */
    }
  }

  function publishTtsShape(url, bodyText) {
    try {
      let fields = null;
      if (bodyText && typeof bodyText === 'string') {
        const parsed = JSON.parse(bodyText);
        // SO os nomes dos campos + os valores curtos de configuracao. O texto
        // falado (copy do cliente) NUNCA e guardado.
        fields = {};
        for (const k of Object.keys(parsed)) {
          const v = parsed[k];
          if (k === 'text' || k === 'previous_text' || k === 'next_text') {
            fields[k] = `<${String(v || '').length} chars>`;
          } else if (v && typeof v === 'object') {
            fields[k] = v;
          } else if (typeof v === 'string' && v.length > 80) {
            fields[k] = `<${v.length} chars>`;
          } else {
            fields[k] = v;
          }
        }
      }
      lastTts = { url: String(url).slice(0, 300), fields, ts: Date.now() };
      window.postMessage(
        { source: 'darkolab-el-injected', type: 'EL_TTS_SHAPE', shape: lastTts },
        window.location.origin,
      );
    } catch (e) {
      /* body nao-JSON (multipart etc) — sem shape, segue a vida */
    }
  }

  function headersToObject(h) {
    const out = {};
    if (!h) return out;
    try {
      if (typeof Headers !== 'undefined' && h instanceof Headers) {
        h.forEach((v, k) => {
          if (isAuthHeader(k)) out[k.toLowerCase()] = v;
        });
      } else if (Array.isArray(h)) {
        for (const pair of h) {
          if (pair && pair.length >= 2 && isAuthHeader(pair[0])) {
            out[String(pair[0]).toLowerCase()] = String(pair[1]);
          }
        }
      } else if (typeof h === 'object') {
        for (const k of Object.keys(h)) {
          if (isAuthHeader(k)) out[k.toLowerCase()] = String(h[k]);
        }
      }
    } catch (e) {
      /* shape exotico de headers — ignora */
    }
    return out;
  }

  /* ─────────────────────────── fetch ─────────────────────────── */

  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      const rawUrl =
        typeof input === 'string'
          ? input
          : input && typeof input.url === 'string'
            ? input.url
            : '';
      if (rawUrl) {
        const u = new URL(rawUrl, window.location.origin);
        if (isApiHost(u.host)) {
          const headers = {
            ...headersToObject(input && input.headers),
            ...headersToObject(init && init.headers),
          };
          publishAuth(u.host, headers);
          if (/\/text-to-speech\//i.test(u.pathname) && init && typeof init.body === 'string') {
            publishTtsShape(u.host + u.pathname, init.body);
          }
        }
      }
    } catch (e) {
      /* nunca quebra a chamada original */
    }
    return origFetch.apply(this, arguments);
  };

  /* ─────────────────────────── XHR ─────────────────────────── */

  const origOpen = XMLHttpRequest.prototype.open;
  const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  const origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    try {
      const u = new URL(String(url), window.location.origin);
      this.__darkolabEl = isApiHost(u.host)
        ? { host: u.host, path: u.pathname, headers: {} }
        : null;
    } catch (e) {
      this.__darkolabEl = null;
    }
    return origOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    try {
      if (this.__darkolabEl && isAuthHeader(name)) {
        this.__darkolabEl.headers[String(name).toLowerCase()] = String(value);
      }
    } catch (e) {
      /* ignora */
    }
    return origSetHeader.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function (body) {
    try {
      const rec = this.__darkolabEl;
      if (rec) {
        publishAuth(rec.host, rec.headers);
        if (/\/text-to-speech\//i.test(rec.path) && typeof body === 'string') {
          publishTtsShape(rec.host + rec.path, body);
        }
      }
    } catch (e) {
      /* ignora */
    }
    return origSend.apply(this, arguments);
  };

  /* ───────────────── re-anuncio sob demanda ─────────────────
   * O content script pode carregar/reiniciar DEPOIS de a gente ja ter visto
   * a auth (service worker hiberna, aba antiga, etc). Quando ele acordar,
   * pede EL_AUTH_REPLAY e a gente reenvia o que ja tem — sem precisar que o
   * app faca uma chamada nova. */
  window.addEventListener('message', (ev) => {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || typeof d !== 'object') return;
    if (d.source !== 'darkolab-el-content' || d.type !== 'EL_AUTH_REPLAY') return;
    for (const [host, headers] of authByHost) {
      try {
        window.postMessage(
          { source: 'darkolab-el-injected', type: 'EL_AUTH', apiHost: host, headers, ts: Date.now() },
          window.location.origin,
        );
      } catch (e) {
        /* ignora */
      }
    }
    if (lastTts) {
      try {
        window.postMessage(
          { source: 'darkolab-el-injected', type: 'EL_TTS_SHAPE', shape: lastTts },
          window.location.origin,
        );
      } catch (e) {
        /* ignora */
      }
    }
  });

  console.log('[DARKO LAB EL] interceptor MAIN world armado');
})();
