/**
 * DARKO LAB Extension - Background Service Worker
 */

const activeJobs = new Map();
// Map<requestId, { bridgeTabId, timeoutId }> pra correlacionar push do
// content script (HG_TAB_AVATARS_RESULT) de volta com o requester original.
const pendingListJobs = new Map();
const HEYGEN_CREATE_URL = 'https://app.heygen.com/avatar';

async function findOrCreateHeyGenTab() {
  const tabs = await chrome.tabs.query({
    url: ['https://app.heygen.com/*'],
  });
  if (tabs.length > 0) {
    const tab = tabs[0];
    if (
      tab.url &&
      (tab.url.includes('/create-video') || tab.url.includes('/404'))
    ) {
      await chrome.tabs.update(tab.id, { url: HEYGEN_CREATE_URL });
    }
    return tab;
  }
  return await chrome.tabs.create({
    url: HEYGEN_CREATE_URL,
    active: false,
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return;

  if (msg.type === 'HG_GENERATE') {
    const requestId = msg.requestId;
    handleGenerate(requestId, msg.payload, sender.tab?.id).catch((err) => {
      reportToPage(sender.tab?.id, requestId, 'HG_ERROR', {
        error: err?.message ?? String(err),
      });
    });
    sendResponse({ accepted: true });
    return true;
  }

  if (msg.type === 'HG_TEST_SESSION') {
    const requestId = msg.requestId;
    handleTestSession(requestId, sender.tab?.id).catch((err) => {
      reportToPage(sender.tab?.id, requestId, 'HG_TEST_RESULT', {
        ok: false,
        detail: err?.message ?? String(err),
      });
    });
    sendResponse({ accepted: true });
    return true;
  }

  if (msg.type === 'HG_API_FETCH') {
    const requestId = msg.requestId;
    handleApiFetch(requestId, msg.req, sender.tab?.id).catch((err) => {
      reportToPage(sender.tab?.id, requestId, 'HG_API_RESULT', {
        status: 0, ok: false, body: { message: err?.message ?? String(err) },
      });
    });
    sendResponse({ accepted: true });
    return true;
  }

  if (msg.type === 'HG_RELOAD_SELF') {
    // Pagina pede pra extensao se reinstalar (re-le manifest + scripts)
    // Util pra updates futuros: page detecta versao velha → page chama
    // HG_RELOAD_SELF → extensao se reinicia → user nao precisa abrir
    // chrome://extensions e clicar reload manualmente.
    try { sendResponse({ accepted: true }); } catch {}
    setTimeout(() => {
      try { chrome.runtime.reload(); } catch (e) {
        console.error('[DARKO LAB BG] reload self falhou:', e?.message);
      }
    }, 100);
    return;
  }

  if (msg.type === 'HG_FETCH_DOC') {
    // READ-ONLY: abre/reusa tab docs.google.com com a URL e le innerText
    // via /mobilebasic (renderiza HTML completo). Devolve texto bruto.
    const requestId = msg.requestId;
    const docUrl = msg.url;
    handleFetchDoc(requestId, docUrl, sender.tab?.id).catch((err) => {
      reportToPage(sender.tab?.id, requestId, 'HG_DOC_RESULT', {
        ok: false, error: err?.message ?? String(err),
      });
    });
    sendResponse({ accepted: true });
    return true;
  }

  if (msg.type === 'HG_INJECT_INTERCEPTOR') {
    const tabId = sender.tab?.id;
    // Responde IMEDIATO (sync) pra fechar o canal e nao gerar warning.
    try { sendResponse({ accepted: true }); } catch {}
    if (tabId) {
      injectInterceptorIntoMainWorld(tabId)
        .then((ok) => {
          console.log('[DARKO LAB BG] inject interceptor result tabId=', tabId, 'ok=', ok);
        })
        .catch((e) => {
          console.error('[DARKO LAB BG] !!! inject interceptor THREW:', e?.message ?? e);
        });
    }
    return; // sem return true (sync)
  }

  if (msg.type === 'HG_LIST_AVATARS') {
    const requestId = msg.requestId;
    handleListAvatars(requestId, sender.tab?.id).catch((err) => {
      reportToPage(sender.tab?.id, requestId, 'HG_AVATARS_RESULT', {
        ok: false,
        error: err?.message ?? String(err),
        avatars: [],
      });
    });
    sendResponse({ accepted: true });
    return true;
  }

  if (msg.type === 'HG_CANCEL') {
    const job = activeJobs.get(msg.requestId);
    if (job) {
      activeJobs.delete(msg.requestId);
      reportToPage(job.bridgeTabId, msg.requestId, 'HG_ERROR', {
        error: 'Cancelado pelo usuario.',
      });
    }
    return false;
  }

  if (msg.type === 'HG_TAB_PROGRESS') {
    const job = activeJobs.get(msg.requestId);
    if (job) {
      reportToPage(job.bridgeTabId, msg.requestId, 'HG_PROGRESS', {
        stage: msg.stage,
        percent: msg.percent,
      });
    }
    return false;
  }

  if (msg.type === 'HG_TAB_RESULT') {
    const job = activeJobs.get(msg.requestId);
    if (job) {
      activeJobs.delete(msg.requestId);
      reportToPage(job.bridgeTabId, msg.requestId, 'HG_RESULT', {
        videoUrl: msg.videoUrl,
      });
    }
    return false;
  }

  if (msg.type === 'HG_TAB_AVATARS_RESULT') {
    const job = pendingListJobs.get(msg.requestId);
    if (job) {
      clearTimeout(job.timeoutId);
      pendingListJobs.delete(msg.requestId);
      console.log('[DARKO LAB BG] <-- pushed AVATARS_RESULT reqId=', msg.requestId, 'avatars=', msg.avatars?.length, 'groups=', msg.groups?.length);
      reportToPage(job.bridgeTabId, msg.requestId, 'HG_AVATARS_RESULT', {
        ok: !!msg.ok,
        avatars: msg.avatars ?? [],
        groups: msg.groups ?? [],
        error: msg.error ?? null,
        apiSource: msg.apiSource ?? null,
      });
    } else {
      console.warn('[DARKO LAB BG] !! recebido HG_TAB_AVATARS_RESULT sem job pendente reqId=', msg.requestId);
    }
    return false;
  }

  if (msg.type === 'HG_TAB_ERROR') {
    const job = activeJobs.get(msg.requestId);
    if (job) {
      activeJobs.delete(msg.requestId);
      reportToPage(job.bridgeTabId, msg.requestId, 'HG_ERROR', {
        error: msg.error,
      });
    }
    return false;
  }
});

async function handleTestSession(requestId, bridgeTabId) {
  const tab = await findOrCreateHeyGenTab();
  await waitForTabReady(tab.id);
  try {
    const resp = await chrome.tabs.sendMessage(tab.id, {
      type: 'HG_TEST_SESSION',
      requestId,
    });
    reportToPage(bridgeTabId, requestId, 'HG_TEST_RESULT', {
      ok: !!resp?.ok,
      detail: resp?.detail ?? '',
    });
  } catch (e) {
    reportToPage(bridgeTabId, requestId, 'HG_TEST_RESULT', {
      ok: false,
      detail:
        'Aba HeyGen nao respondeu - recarregue chrome://extensions e tente de novo. (' +
        (e?.message ?? '') +
        ')',
    });
  }
}

async function handleListAvatars(requestId, bridgeTabId) {
  console.log('[DARKO LAB BG] >>> handleListAvatars START reqId=', requestId, 'bridgeTabId=', bridgeTabId);
  const tab = await findOrCreateHeyGenTab();
  console.log('[DARKO LAB BG] heygen tab=', tab.id, 'url=', tab.url);
  await waitForTabReady(tab.id);
  console.log('[DARKO LAB BG] heygen tab ready, sending HG_LIST_AVATARS to content script (push pattern)');

  // PUSH PATTERN: NAO fazemos await da resposta. Content script vai
  // empurrar HG_TAB_AVATARS_RESULT via runtime.sendMessage quando tiver
  // o resultado. Aqui a gente so 'envia' (fire-and-forget) e registra
  // um job pendente que sera resolvido pelo handler de HG_TAB_AVATARS_RESULT.
  // Isso evita o problema do SW do background hibernar durante o await
  // (que fechava o port com 'channel closed before a response').

  // Timeout de seguranca - se em 60s nao recebermos o push, falha.
  const timeoutId = setTimeout(() => {
    if (pendingListJobs.has(requestId)) {
      console.warn('[DARKO LAB BG] !!! pending list job timeout 60s reqId=', requestId);
      pendingListJobs.delete(requestId);
      reportToPage(bridgeTabId, requestId, 'HG_AVATARS_RESULT', {
        ok: false,
        avatars: [],
        groups: [],
        error: 'Timeout 60s aguardando resposta do content script HeyGen.',
      });
    }
  }, 60000);

  pendingListJobs.set(requestId, { bridgeTabId, timeoutId });

  try {
    // Fire-and-forget. O sendResponse imediato do content script
    // ({ accepted: true }) nao nos importa - o resultado real vem via push.
    chrome.tabs.sendMessage(tab.id, { type: 'HG_LIST_AVATARS', requestId })
      .then(() => {
        console.log('[DARKO LAB BG] HG_LIST_AVATARS dispatched OK, aguardando push HG_TAB_AVATARS_RESULT...');
      })
      .catch((e) => {
        // Erro ao DESPACHAR (raro - aba fechou antes da msg sair). Ignora
        // o channel-closed (esperado pq retornamos sync no content). So se
        // for algo realmente fatal vai cair aqui (No tab with id).
        const m = e?.message ?? String(e);
        if (m.includes('channel closed') || m.includes('listener indicated')) {
          // Esperado - sendResponse({accepted:true}) feito sync, canal fecha. OK.
          console.log('[DARKO LAB BG] dispatch ack channel-close (esperado), aguardando push...');
        } else {
          console.error('[DARKO LAB BG] !!! dispatch HG_LIST_AVATARS THREW:', m);
          if (pendingListJobs.has(requestId)) {
            clearTimeout(timeoutId);
            pendingListJobs.delete(requestId);
            reportToPage(bridgeTabId, requestId, 'HG_AVATARS_RESULT', {
              ok: false,
              avatars: [],
              groups: [],
              error: 'Aba HeyGen nao respondeu. Abra app.heygen.com e tente de novo. (' + m + ')',
            });
          }
        }
      });
  } catch (e) {
    console.error('[DARKO LAB BG] !!! handleListAvatars sync throw:', e?.message ?? e);
    if (pendingListJobs.has(requestId)) {
      clearTimeout(timeoutId);
      pendingListJobs.delete(requestId);
      reportToPage(bridgeTabId, requestId, 'HG_AVATARS_RESULT', {
        ok: false,
        avatars: [],
        groups: [],
        error: 'Erro inesperado: ' + (e?.message ?? String(e)),
      });
    }
  }
}

async function handleGenerate(requestId, payload, bridgeTabId) {
  console.log('[DARKO LAB BG] handleGenerate START reqId=', requestId);
  const tab = await findOrCreateHeyGenTab();
  activeJobs.set(requestId, { tabId: tab.id, payload, bridgeTabId });

  reportToPage(bridgeTabId, requestId, 'HG_PROGRESS', {
    stage: 'Abrindo HeyGen...',
  });

  // CRITICO: SEMPRE navega pra /avatar fresh antes de cada dispatch.
  // Apos clicar Generate, HeyGen muda a UI (mostra processing, esconde
  // textarea, etc). Pra proximos trechos precisamos de UI limpa.
  // Navegamos via chrome.tabs.update (sobrevive reload do content script).
  reportToPage(bridgeTabId, requestId, 'HG_PROGRESS', {
    stage: 'Resetando HeyGen pra Quick Create limpa...',
  });
  console.log('[DARKO LAB BG] navegando pra /avatar pra UI limpa');
  await chrome.tabs.update(tab.id, { url: 'https://app.heygen.com/avatar' });
  await waitForTabComplete(tab.id, 30000);
  // Espera React montar a UI + Quick Create render
  await new Promise((r) => setTimeout(r, 3500));

  await waitForTabReady(tab.id);

  reportToPage(bridgeTabId, requestId, 'HG_PROGRESS', {
    stage: 'Comandando automacao na aba HeyGen...',
  });

  try {
    await chrome.tabs.sendMessage(tab.id, {
      type: 'HG_RUN_JOB',
      requestId,
      payload,
    });
    console.log('[DARKO LAB BG] HG_RUN_JOB despachado pra tab', tab.id);
  } catch (e) {
    activeJobs.delete(requestId);
    reportToPage(bridgeTabId, requestId, 'HG_ERROR', {
      error:
        'Aba HeyGen nao respondeu - recarregue a aba e tente de novo. (' +
        (e?.message ?? '') +
        ')',
    });
  }
}

/**
 * Aguarda tab.status === 'complete' (load finished). Retorna true se OK,
 * false se timeout.
 */
async function waitForTabComplete(tabId, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const t = await chrome.tabs.get(tabId);
      if (t.status === 'complete') return true;
    } catch {
      return false; // aba fechada
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

function reportToPage(bridgeTabId, requestId, type, payload) {
  if (!bridgeTabId) {
    console.warn('[DARKO LAB BG] !!! reportToPage called WITHOUT bridgeTabId. type=', type, 'reqId=', requestId);
    return;
  }
  console.log('[DARKO LAB BG] reportToPage -> tab', bridgeTabId, 'type=', type, 'reqId=', requestId);
  chrome.tabs
    .sendMessage(bridgeTabId, {
      source: 'darkolab-bg',
      type,
      requestId,
      payload,
    })
    .then(() => {
      console.log('[DARKO LAB BG] reportToPage delivered OK to tab', bridgeTabId, 'type=', type);
    })
    .catch((err) => {
      console.error('[DARKO LAB BG] !!! reportToPage FAILED to tab', bridgeTabId, 'type=', type, 'err=', err?.message ?? err);
    });
}

async function waitForTabReady(tabId) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === 'complete') break;
    } catch {
      throw new Error('Aba HeyGen foi fechada.');
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  await ensureContentScriptLoaded(tabId);
}

async function ensureContentScriptLoaded(tabId) {
  try {
    const resp = await Promise.race([
      chrome.tabs.sendMessage(tabId, { type: 'HG_PING' }),
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error('PING timeout')), 1500),
      ),
    ]);
    if (resp?.ok) return true;
  } catch (e) {
    /* nada - vai injetar */
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['heygen-content.js'],
    });
    await new Promise((r) => setTimeout(r, 1000));

    try {
      const resp = await Promise.race([
        chrome.tabs.sendMessage(tabId, { type: 'HG_PING' }),
        new Promise((_, rej) =>
          setTimeout(() => rej(new Error('PING timeout pos-inject')), 2000),
        ),
      ]);
      if (resp?.ok) return true;
    } catch (e) {
      throw new Error(
        'Content script injetado mas nao respondeu. Recarregue a aba app.heygen.com manualmente (F5).',
      );
    }
  } catch (e) {
    throw new Error(
      'Falha ao injetar content script: ' +
        (e?.message ?? e) +
        '. Recarregue a aba app.heygen.com manualmente.',
    );
  }
  return false;
}

/**
 * Injeta o interceptor de fetch+XHR diretamente no MAIN WORLD da aba HeyGen
 * via chrome.scripting.executeScript. Bypass do CSP do HeyGen e nao depende
 * de arquivo inject.js no disco.
 */
async function handleApiFetch(requestId, req, bridgeTabId) {
  console.log('[DARKO LAB BG] HG_API_FETCH', req.method, req.url?.slice(0, 80));
  const tab = await findOrCreateHeyGenTab();
  await waitForTabReady(tab.id);
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'HG_API_FETCH', req });
    reportToPage(bridgeTabId, requestId, 'HG_API_RESULT', {
      status: res?.status ?? 0,
      ok: !!res?.ok,
      body: res?.body ?? null,
    });
  } catch (e) {
    reportToPage(bridgeTabId, requestId, 'HG_API_RESULT', {
      status: 0, ok: false, body: { message: 'Aba HeyGen nao respondeu: ' + (e?.message ?? '') },
    });
  }
}

async function injectInterceptorIntoMainWorld(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => {
        if (window.__darkolab_intercept_loaded__) return;
        window.__darkolab_intercept_loaded__ = true;
        // Dedup de captura: se 2 POST identicas (mesma URL) em <3s,
        // emite VIDEO_GENERATED so 1x. Protege contra dispatch duplo do
        // React/automacao.
        const recentEmits = new Map(); // url -> ts
        function shouldEmit(url, ts) {
          const last = recentEmits.get(url);
          if (last && ts - last < 3000) return false;
          recentEmits.set(url, ts);
          // Limpa entradas velhas (>60s)
          for (const [k, v] of recentEmits) {
            if (ts - v > 60000) recentEmits.delete(k);
          }
          return true;
        }
        // Captura QUALQUER POST a heygen.com (mais amplo). Excluimos
        // endpoints conhecidos de NAO-generate pra reduzir spam: tracking,
        // metrics, log, analytics, recommendation, search, voices.list,
        // avatar_group.private.list etc.
        const HG_RE = /heygen\.(com|ai)/i;
        // SKIP so endpoints OBVIAMENTE nao-generate. Removido: status,
        // preview, asset (alguns generates passam por esses padroes).
        const SKIP_RE = /(\/v\d+\/(tracking|telemetry|analytics|metrics|log|notification|recommendation|search|voice\.list|avatar_group\.private|avatar_look\.private|user\.info|favorite))/i;
        function emit(payload) {
          try {
            window.postMessage({ source: 'darkolab-injected', type: 'VIDEO_GENERATED', ts: Date.now(), ...payload }, '*');
          } catch (e) {}
        }
        function tryExtractId(j) {
          if (!j || typeof j !== 'object') return null;
          return (
            j?.data?.video_id ?? j?.data?.id ?? j?.data?.uuid ??
            j?.video_id ?? j?.id ?? j?.uuid ??
            j?.data?.task_id ?? j?.task_id ??
            null
          );
        }
        const origFetch = window.fetch;
        window.fetch = function (input, init) {
          const url = typeof input === 'string' ? input : input?.url || '';
          const method = ((init && init.method) || (typeof input === 'object' && input?.method) || 'GET').toUpperCase();
          const isHG = HG_RE.test(url) && !SKIP_RE.test(url);
          const isInteresting = method === 'POST' && isHG;
          const p = origFetch.apply(this, arguments);
          if (isInteresting) {
            // Loga inicio pra debug (mostra TODAS POSTs HeyGen relevantes)
            console.log('[DARKO LAB inject] POST capturado:', url);
            p.then(async (res) => {
              try {
                if (!res) return;
                const clone = res.clone();
                const text = await clone.text().catch(() => '');
                console.log('[DARKO LAB inject] POST resp', url, 'status', res.status, 'body 200ch:', text.slice(0, 200));
                if (res.status >= 400) return;
                let j = null;
                try { j = JSON.parse(text); } catch { return; }
                const id = tryExtractId(j);
                if (id) {
                  if (!shouldEmit(url, Date.now())) {
                    console.log('[DARKO LAB inject] DUP video_id capturado em <3s, IGNORADO:', id, 'via', url);
                    return;
                  }
                  console.log('[DARKO LAB inject] fetch capturou video_id', id, 'via', url);
                  emit({ video_id: id, url, source_method: 'fetch' });
                }
              } catch (e) {}
            }).catch(() => {});
          }
          return p;
        };
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
              try { j = JSON.parse(text); } catch { return; }
              const id = tryExtractId(j);
              if (id) {
                if (!shouldEmit(_url, Date.now())) {
                  console.log('[DARKO LAB inject] DUP video_id (XHR) em <3s, IGNORADO:', id);
                  return;
                }
                console.log('[DARKO LAB inject] XHR capturou video_id', id, 'via', _url);
                emit({ video_id: id, url: _url, source_method: 'xhr' });
              }
            } catch (e) {}
          });
          return xhr;
        }
        PatchedXHR.prototype = OrigXHR.prototype;
        for (const k in OrigXHR) {
          try { PatchedXHR[k] = OrigXHR[k]; } catch (e) {}
        }
        window.XMLHttpRequest = PatchedXHR;
        console.log('[DARKO LAB inject] fetch+XHR patched (via executeScript MAIN world)');
      },
    });
    return true;
  } catch (e) {
    console.error('[DARKO LAB BG] !!! injectInterceptorIntoMainWorld erro:', e?.message ?? e);
    return false;
  }
}

/**
 * READ-ONLY: abre tab em /mobilebasic do Google Doc, espera carregar,
 * le innerText e retorna. Nunca escreve, edita ou comenta no doc.
 */
async function handleFetchDoc(requestId, docUrl, bridgeTabId) {
  try {
    if (!docUrl || typeof docUrl !== 'string') {
      reportToPage(bridgeTabId, requestId, 'HG_DOC_RESULT', {
        ok: false, error: 'docUrl invalida',
      });
      return;
    }
    // Extrai docId
    const m = docUrl.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
    if (!m) {
      reportToPage(bridgeTabId, requestId, 'HG_DOC_RESULT', {
        ok: false, error: 'URL nao parece Google Doc valido',
      });
      return;
    }
    const docId = m[1];
    const mobileUrl = `https://docs.google.com/document/d/${docId}/mobilebasic`;

    // Cria tab inativa em mobilebasic
    const tab = await chrome.tabs.create({ url: mobileUrl, active: false });
    const newTabId = tab.id;
    console.log('[DARKO LAB BG] HG_FETCH_DOC docId=', docId, 'tabId=', newTabId);

    // Espera load completo (tab.status complete)
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout 15s carregando doc')), 15000);
      const listener = (changedTabId, changeInfo) => {
        if (changedTabId === newTabId && changeInfo.status === 'complete') {
          clearTimeout(timeout);
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
    });

    // Pequena espera adicional pra react render
    await new Promise(r => setTimeout(r, 1500));

    // Le innerText
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: newTabId },
      func: () => ({
        text: document.body.innerText,
        title: document.title,
        url: location.href,
        isLogin: /accounts\.google\.com/.test(location.href),
      }),
    });

    // Fecha a tab depois de ler
    try { await chrome.tabs.remove(newTabId); } catch {}

    if (result?.isLogin) {
      reportToPage(bridgeTabId, requestId, 'HG_DOC_RESULT', {
        ok: false, error: 'Doc privado e nao logado no Google.',
      });
      return;
    }

    reportToPage(bridgeTabId, requestId, 'HG_DOC_RESULT', {
      ok: true,
      text: result?.text || '',
      title: result?.title || '',
      length: (result?.text || '').length,
    });
  } catch (e) {
    reportToPage(bridgeTabId, requestId, 'HG_DOC_RESULT', {
      ok: false, error: e?.message ?? String(e),
    });
  }
}

chrome.tabs.onRemoved.addListener((tabId) => {
  for (const [requestId, job] of activeJobs.entries()) {
    if (job.tabId === tabId) {
      activeJobs.delete(requestId);
      reportToPage(job.bridgeTabId, requestId, 'HG_ERROR', {
        error:
          'Aba HeyGen foi fechada antes da geracao terminar. Reabra app.heygen.com e tente de novo.',
      });
    }
  }
});

console.log('[DARKO LAB Background] service worker iniciado');
