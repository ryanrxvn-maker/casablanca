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
  if (!bridgeTabId) return;
  chrome.tabs
    .sendMessage(bridgeTabId, {
      source: 'darkolab-bg',
      type,
      requestId,
      payload,
    })
    .catch(() => {
      /* aba pode ter fechado */
    });
}

async function waitForTabReady(tabId) {
  // Espera ate 30s pra aba carregar (HeyGen e pesado)
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === 'complete') return;
    } catch {
      throw new Error('Aba HeyGen foi fechada.');
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

// Se o user fecha a aba HeyGen no meio de um job, falha todos os jobs
// que estavam usando essa aba.
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
