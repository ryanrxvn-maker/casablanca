/**
 * Bridge DARKO LAB <-> Chrome Extension — ElevenLabs.
 *
 * Mesmo protocolo do HeyGen ([[heygen-extension-bridge]]), so que os recados
 * saem com prefixo EL_ e caem na aba do elevenlabs.io:
 *
 *   page → { source: 'darkolab', type: 'EL_API_FETCH', requestId, req }
 *   ext  → { source: 'darkolab-ext', type: 'EL_API_RESULT', requestId, status, ok, body }
 *
 * POR QUE PELA EXTENSAO E NAO PELA API: a geracao tem que sair pela SESSAO
 * que o user ja paga no ElevenLabs. Chave de API cobraria por fora, em cima
 * de credito comprado separado — exatamente o que a gente NAO quer. A
 * extensao reusa a sessao aberta no navegador, igual ja acontece no HeyGen.
 *
 * O credencial NUNCA chega aqui: ele fica dentro da extensao. Esta camada so
 * ve { status, ok, body }.
 */

export type ElevenApiReq = {
  /** Absoluta ou comecando com "/" (a extensao resolve o host da conta). */
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  bodyText?: string;
  bodyBase64?: string;
  bodyType?: string;
  /** Quanto esperar pela captura da sessao dentro da aba (ms). */
  authTimeoutMs?: number;
};

export type ElevenApiRes = {
  status: number;
  ok: boolean;
  body: any;
};

/** Teto de espera por chamada. TTS de copy longa passa fácil de 1min, então
 *  o default é generoso; leitura (lista de vozes) usa um valor curto. */
const DEFAULT_TIMEOUT_MS = 300000; // 5 min

export function elevenApiFetch(
  req: ElevenApiReq,
  opts: { timeoutMs?: number } = {},
): Promise<ElevenApiRes> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') {
      resolve({ status: 0, ok: false, body: { message: 'Sem window.' } });
      return;
    }
    const requestId = `el_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const handler = (ev: MessageEvent) => {
      if (
        ev.data?.source === 'darkolab-ext' &&
        ev.data?.type === 'EL_API_RESULT' &&
        ev.data?.requestId === requestId
      ) {
        window.removeEventListener('message', handler);
        clearTimeout(timeoutId);
        resolve({
          status: ev.data.status ?? 0,
          ok: !!ev.data.ok,
          body: ev.data.body ?? null,
        });
      }
    };
    window.addEventListener('message', handler);
    window.postMessage({ source: 'darkolab', type: 'EL_API_FETCH', requestId, req }, '*');
    const timeoutId = setTimeout(() => {
      window.removeEventListener('message', handler);
      resolve({
        status: 0,
        ok: false,
        body: {
          message:
            'A extensão não respondeu. Deixe UMA aba do elevenlabs.io aberta e logada e tente de novo.',
        },
      });
    }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  });
}

/**
 * Pergunta pra extensao se a sessao do ElevenLabs esta viva. Se `ok`, gerar
 * voz vai funcionar. O `detail` ja vem pronto pra mostrar na tela (inclui o
 * consumo de caracteres da conta quando disponivel).
 *
 * Timeout de 60s porque, sem aba do elevenlabs.io aberta, a extensao precisa
 * ABRIR uma e esperar o app carregar — isso sozinho passa de 15s. Com teto
 * curto, o teste acusava "extensão não respondeu" com tudo certo (mesma
 * lição do testHeygenSession).
 */
export function testElevenSession(): Promise<{ ok: boolean; detail?: string }> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') {
      resolve({ ok: false, detail: 'Sem window.' });
      return;
    }
    const requestId = `eltest_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const handler = (ev: MessageEvent) => {
      if (
        ev.data?.source === 'darkolab-ext' &&
        ev.data?.type === 'EL_TEST_RESULT' &&
        ev.data?.requestId === requestId
      ) {
        window.removeEventListener('message', handler);
        clearTimeout(timeoutId);
        resolve({ ok: !!ev.data.ok, detail: ev.data.detail ?? '' });
      }
    };
    window.addEventListener('message', handler);
    window.postMessage({ source: 'darkolab', type: 'EL_TEST_SESSION', requestId }, '*');
    const timeoutId = setTimeout(() => {
      window.removeEventListener('message', handler);
      resolve({
        ok: false,
        detail:
          'Sem resposta em 60s. Deixe UMA aba do elevenlabs.io aberta e logada e teste de novo.',
      });
    }, 60000);
  });
}
