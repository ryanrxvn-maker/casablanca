/**
 * DARKO LAB Extension — Content Script ElevenLabs
 *
 * Roda em elevenlabs.io (mundo ISOLADO). E a ponte entre o interceptor do
 * MAIN world (elevenlabs-inject.js, que ve a sessao do app) e o background
 * worker — e quem de fato FAZ as chamadas pra API do ElevenLabs.
 *
 * Por que a chamada sai DAQUI e nao do background: com host_permissions de
 * elevenlabs.io, o fetch do content script vai com os cookies da conta e sem
 * barreira de CORS, exatamente como o heygen-content.js ja faz. Resultado: a
 * geracao sai pela SESSAO do user (o plano que ele ja paga), nunca por
 * credito de API.
 *
 * O credencial capturado fica SO aqui e em chrome.storage.session (memoria,
 * morre ao fechar o Chrome). Ele nunca volta pro DARKO LAB.
 */

const DARKO_EL_VERSION = '4.18.0';

if (window.__darkolab_el_content__) {
  console.log('[DARKO LAB EL] content script ja carregado — skip');
} else {
  window.__darkolab_el_content__ = true;

  /** Sessao capturada do app: { [apiHost]: { headers, ts } } */
  const sessions = new Map();
  /** Shape da ultima chamada nativa de TTS (diagnostico). */
  let ttsShape = null;

  /** Host de API preferido. O app do user hoje fala com api.us.elevenlabs.io,
   *  mas contas de outras regioes usam outro — por isso a gente usa o que FOI
   *  OBSERVADO em vez de fixar no codigo. Só cai no global se nada foi visto. */
  const FALLBACK_API_HOST = 'api.elevenlabs.io';

  function preferredHost() {
    let best = null;
    for (const [host, rec] of sessions) {
      if (!best || rec.ts > sessions.get(best).ts) best = host;
    }
    return best || FALLBACK_API_HOST;
  }

  /* ─────────── recebe a sessao do interceptor (MAIN world) ─────────── */

  window.addEventListener('message', (ev) => {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || typeof d !== 'object' || d.source !== 'darkolab-el-injected') return;

    if (d.type === 'EL_AUTH' && d.apiHost && d.headers) {
      const had = sessions.has(d.apiHost);
      sessions.set(d.apiHost, { headers: d.headers, ts: d.ts || Date.now() });
      if (!had) {
        console.log(
          '[DARKO LAB EL] sessao capturada em',
          d.apiHost,
          '(' + Object.keys(d.headers).join(', ') + ')',
        );
      }
      // De proposito: a sessao vive SO em memoria, nesta aba. Nada de
      // chrome.storage — nem local (disco, nunca) nem session (que por padrao
      // sequer e legivel de content script). Se a aba morre, a captura morre
      // junto, e a proxima aba recomeca pelo replay do interceptor.
      return;
    }

    if (d.type === 'EL_TTS_SHAPE' && d.shape) {
      ttsShape = d.shape;
    }
  });

  /** Pede pro MAIN world reenviar o que ja viu (o content script pode ter
   *  subido depois). */
  function askReplay() {
    try {
      window.postMessage(
        { source: 'darkolab-el-content', type: 'EL_AUTH_REPLAY' },
        window.location.origin,
      );
    } catch (e) {
      /* ignora */
    }
  }

  /** Espera ate ter sessao pra um host de API. Retorna os headers ou null.
   *  A cada tentativa pede replay pro MAIN world — se o app ja fez qualquer
   *  chamada desde o boot, a captura chega em milissegundos. */
  async function waitForAuth(timeoutMs = 12000) {
    if (sessions.size > 0) return { host: preferredHost(), headers: sessions.get(preferredHost()).headers };
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      askReplay();
      if (sessions.size > 0) {
        const host = preferredHost();
        return { host, headers: sessions.get(host).headers };
      }
      await new Promise((r) => setTimeout(r, 350));
    }
    return null;
  }

  /* ─────────────────────────── proxy de API ─────────────────────────── */

  function base64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function bytesToBase64(bytes) {
    // Em pedaços pra nao estourar a pilha em audio grande.
    const CHUNK = 0x8000;
    let bin = '';
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(bin);
  }

  /**
   * Faz a chamada de verdade pro ElevenLabs, com a sessao do user.
   *
   * `url` pode vir SEM host (ex "/v1/voices") — a gente resolve pro host que
   * foi observado na sessao. Isso e de proposito: quem chama (o DARKO LAB)
   * nao precisa saber a regiao da conta.
   */
  async function proxyElevenFetch(req) {
    const auth = await waitForAuth(req.authTimeoutMs ?? 12000);
    if (!auth) {
      return {
        status: 0,
        ok: false,
        body: {
          message:
            'Não consegui ler a sessão do ElevenLabs nesta aba. Recarregue a aba do elevenlabs.io (F5) já logado e tente de novo.',
          _needsSession: true,
          _extVersion: DARKO_EL_VERSION,
        },
      };
    }

    let url = String(req.url || '');
    if (url.startsWith('/')) url = 'https://' + auth.host + url;

    let host = '';
    try {
      host = new URL(url).host;
    } catch (e) {
      return { status: 0, ok: false, body: { message: 'URL inválida: ' + url, _extVersion: DARKO_EL_VERSION } };
    }

    // BLINDAGEM: esse proxy só fala com o ElevenLabs. Sem isso, um bug (ou
    // uma página maliciosa que conseguisse falar com a extensão) transformaria
    // a extensão num proxy autenticado pra qualquer host da internet.
    if (!/(^|\.)elevenlabs\.io$/i.test(host)) {
      return {
        status: 0,
        ok: false,
        body: { message: 'Host bloqueado (o proxy só fala com elevenlabs.io): ' + host, _extVersion: DARKO_EL_VERSION },
      };
    }

    const headers = { ...(req.headers || {}) };
    // A auth da sessao SEMPRE vence o que veio de fora — quem chama nunca
    // define credencial.
    for (const k of Object.keys(auth.headers)) headers[k] = auth.headers[k];

    const opts = { method: req.method || 'GET', headers, credentials: 'include' };
    if (req.bodyText !== undefined) opts.body = req.bodyText;
    else if (req.bodyBase64) {
      opts.body = new Blob([base64ToBytes(req.bodyBase64)], {
        type: req.bodyType || 'application/octet-stream',
      });
    }

    let r;
    try {
      r = await fetch(url, opts);
    } catch (e) {
      return {
        status: 0,
        ok: false,
        body: { message: 'Falha de rede falando com o ElevenLabs: ' + String(e?.message || e), _extVersion: DARKO_EL_VERSION },
      };
    }

    const ct = r.headers.get('content-type') || '';
    // O ElevenLabs devolve o id da geracao num header. Ele e o que permite
    // encadear previous_request_ids nos pedacos seguintes — sem isso, uma
    // copy longa troca de entonacao no meio da emenda.
    const reqIdHeader =
      r.headers.get('request-id') || r.headers.get('x-request-id') || null;
    let data;

    if (/^(audio|application\/octet-stream)/i.test(ct)) {
      // O caso que importa: o MP3 gerado. Volta em base64 pro DARKO LAB.
      try {
        const buf = await r.arrayBuffer();
        const bytes = new Uint8Array(buf);
        data = {
          _bytesBase64: bytesToBase64(bytes),
          _contentType: ct,
          _byteLength: bytes.length,
          _requestId: reqIdHeader,
          _extVersion: DARKO_EL_VERSION,
        };
      } catch (e) {
        data = { _binaryError: String(e?.message || e), _contentType: ct, _extVersion: DARKO_EL_VERSION };
      }
    } else if (/json/i.test(ct)) {
      try {
        data = await r.json();
        if (data && typeof data === 'object' && !Array.isArray(data)) {
          data._contentType = ct;
          data._extVersion = DARKO_EL_VERSION;
        }
      } catch (e) {
        data = { _jsonParseError: String(e?.message || e), _contentType: ct, _extVersion: DARKO_EL_VERSION };
      }
    } else {
      try {
        const txt = await r.text();
        data = {
          _text: txt.slice(0, 2000),
          _textLength: txt.length,
          _contentType: ct,
          _extVersion: DARKO_EL_VERSION,
        };
      } catch (e) {
        data = { _readError: String(e?.message || e), _contentType: ct, _extVersion: DARKO_EL_VERSION };
      }
    }

    return { status: r.status, ok: r.ok, body: data };
  }

  /** Teste de sessao: bate num endpoint leve e diz se a conta responde. */
  async function testSession() {
    const auth = await waitForAuth(8000);
    if (!auth) {
      return {
        ok: false,
        detail:
          'Nenhuma sessão do ElevenLabs capturada. Deixe UMA aba do elevenlabs.io aberta e logada, dê F5 nela e teste de novo.',
      };
    }
    const r = await proxyElevenFetch({ url: '/v1/user/subscription', method: 'GET' });
    if (r.ok) {
      const b = r.body || {};
      const usados = Number(b.character_count ?? 0);
      const limite = Number(b.character_limit ?? 0);
      const tier = b.tier || b.subscription?.tier || null;
      return {
        ok: true,
        detail: limite
          ? `Conectado${tier ? ' (' + tier + ')' : ''} — ${usados.toLocaleString('pt-BR')} de ${limite.toLocaleString('pt-BR')} caracteres usados.`
          : 'Conectado.',
      };
    }
    if (r.status === 401 || r.status === 403) {
      return { ok: false, detail: 'A sessão do ElevenLabs expirou. Faça login de novo em elevenlabs.io e dê F5.' };
    }
    return { ok: false, detail: r.body?.message || `ElevenLabs respondeu ${r.status}.` };
  }

  /* ─────────────────────── mensagens do background ─────────────────────── */

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'EL_PING') {
      sendResponse({ ok: true, version: DARKO_EL_VERSION, hasSession: sessions.size > 0 });
      return false;
    }

    if (msg.type === 'EL_API_FETCH') {
      proxyElevenFetch(msg.req).then(
        (res) => sendResponse(res),
        (e) =>
          sendResponse({
            status: 0,
            ok: false,
            body: { message: String(e?.message || e), _extVersion: DARKO_EL_VERSION },
          }),
      );
      return true; // async
    }

    if (msg.type === 'EL_TEST_SESSION') {
      testSession().then(
        (res) => sendResponse(res),
        (e) => sendResponse({ ok: false, detail: String(e?.message || e) }),
      );
      return true;
    }

    if (msg.type === 'EL_TTS_SHAPE') {
      sendResponse({ ok: !!ttsShape, shape: ttsShape });
      return false;
    }

    return false;
  });

  // Boot: pede o replay logo de cara — cobre o caso de o interceptor ja ter
  // visto a auth antes deste script subir.
  askReplay();
  setTimeout(askReplay, 1500);
  setTimeout(askReplay, 4000);

  console.log('[DARKO LAB EL] content script online v' + DARKO_EL_VERSION);
}
