/**
 * DARKO LAB Extension — Background Service Worker
 *
 * Recebe jobs da bridge, abre/reusa aba do HeyGen, envia comandos pro
 * content script do HeyGen, retorna a URL do MP4 quando pronto.
 *
 * Estado interno:
 *   activeJobs: Map<requestId, { tabId, payload, callback }>
 *
 * Cada job tem seu proprio requestId. Pode ter multiplos em paralelo
 * (HeyGen suporta varias requests simultaneas dentro do plano).
 */

const activeJobs = new Map();
// URL correta da tela "Script to Video" no HeyGen (antes era /create-video que da 404)
const HEYGEN_CREATE_URL = 'https://app.heygen.com/avatar';

// Util: encontra ou cria aba HeyGen
async function findOrCreateHeyGenTab() {
  const tabs = await chrome.tabs.query({
    url: ['https://app.heygen.com/*'],
  });
  if (tabs.length > 0) {
    // Se a aba existente esta numa URL valida do HeyGen, reusa.
    // Se esta no 404 ou em pagina invalida, navega ela pra /avatar.
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

// Quando bridge envia um GENERATE, processa
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

  // Mensagens vindas do content script HeyGen
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
        'Aba HeyGen nao respondeu — recarregue chrome://extensions e tente de novo. (' +
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
  console.log('[DARKO LAB BG] heygen tab ready, sending HG_LIST_AVATARS to content script');
  try {
    const resp = await chrome.tabs.sendMessage(tab.id, {
      type: 'HG_LIST_AVATARS',
      requestId,
    });
    console.log('[DARKO LAB BG] got resp from heygen content script: ok=', resp?.ok, 'avatars=', resp?.avatars?.length, 'err=', resp?.error);
    console.log('[DARKO LAB BG] >>> calling reportToPage with HG_AVATARS_RESULT');
    // OBS: usamos `apiSource` (nao `source`) pra NAO conflitar com o campo
    // `source: 'darkolab-ext'` que o bridge.js spreada na postMessage final.
    // Bug v2.4.0 e anteriores: source do payload sobrescrevia source do envelope.
    reportToPage(bridgeTabId, requestId, 'HG_AVATARS_RESULT', {
      ok: !!resp?.ok,
      avatars: resp?.avatars ?? [],
      error: resp?.error ?? null,
      apiSource: resp?.source ?? null,
    });
  } catch (e) {
    console.error('[DARKO LAB BG] !!! sendMessage to heygen tab THREW:', e?.message ?? e);
    reportToPage(bridgeTabId, requestId, 'HG_AVATARS_RESULT', {
      ok: false,
      avatars: [],
      error:
        'Aba HeyGen nao respondeu. Abra app.heygen.com e tente de novo. (' +
        (e?.message ?? '') +
        ')',
    });
  }
}

async function handleGenerate(requestId, payload, bridgeTabId) {
  // Encontra aba HeyGen
  const tab = await findOrCreateHeyGenTab();
  activeJobs.set(requestId, { tabId: tab.id, payload, bridgeTabId });

  reportToPage(bridgeTabId, requestId, 'HG_PROGRESS', {
    stage: 'Abrindo HeyGen...',
  });

  // Aguarda a aba estar pronta (esperar load complete + content script estar rodando)
  await waitForTabReady(tab.id);

  reportToPage(bridgeTabId, requestId, 'HG_PROGRESS', {
    stage: 'Comandando automacao na aba HeyGen...',
  });

  // Envia comando pro content script da aba HeyGen
  try {
    await chrome.tabs.sendMessage(tab.id, {
      type: 'HG_RUN_JOB',
      requestId,
      payload,
    });
  } catch (e) {
    activeJobs.delete(requestId);
    reportToPage(bridgeTabId, requestId, 'HG_ERROR', {
      error:
        'Aba HeyGen nao respondeu — recarregue a aba e tente de novo. (' +
        (e?.message ?? '') +
        ')',
    });
  }
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
  // Espera ate 30s pra aba carregar (HeyGen e pesado)
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === 'complete') break;
    } catch {
      throw new Error('Aba HeyGen foi fechada.');
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  // Garante que o content script esta injetado e respondendo
  await ensureContentScriptLoaded(tabId);
}

/**
 * Garante que o content script esta carregado na aba HeyGen.
 * Tenta um PING primeiro — se falhar, injeta manualmente via
 * chrome.scripting.executeScript (resolve o caso classico de aba que foi
 * aberta antes da extension ser instalada/atualizada).
 */
async function ensureContentScriptLoaded(tabId) {
  // Tenta PING. Se responder, content script ja esta vivo.
  try {
    const resp = await Promise.race([
      chrome.tabs.sendMessage(tabId, { type: 'HG_PING' }),
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error('PING timeout')), 1500),
      ),
    ]);
    if (resp?.ok) return true;
  } catch (e) {
    // Content script nao respondeu — vai injetar
  }

  // Tenta injetar manualmente
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['heygen-content.js'],
    });
    // Espera o script inicializar
    await new Promise((r) => setTimeout(r, 1000));

    // Confirma com PING
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

// Se o user fecha a aba HeyGen no meio de um job, falha todos os jobs
// que estavam usando essa aba.
chrome.tabs.onRemoved.addListener((tabId) => {
  for (const [requestId, job] of activeJobs.entries()) {
    if (job.tabId === tabId) {
      activeJobs.delete(requestId);
      reportToPage(job.bri