/**
 * DARKO LAB Magnific Auto — Service Worker
 *
 * Routing:
 *   page (darkolab) → bridge.js → background.js (here) → content-script (Magnific tab)
 *   ← results via PUSH PATTERN (content-script → bg → bridge → page)
 *
 * Estado dos endpoints REAIS: nao 100% mapeados (Magnific UI so faz
 * requests quando user interage). Quando user fizer 1 generate manual,
 * captura via DevTools Network e me cola — eu adapto pra match exato.
 */

const pendingJobs = new Map();

function reportToPage(bridgeTabId, requestId, type, payload) {
  if (!bridgeTabId) return;
  chrome.tabs.sendMessage(bridgeTabId, {
    source: 'darkolab-magnific-bg',
    type,
    requestId,
    payload,
  }).catch(() => {});
}

async function findOrCreateMagnificTab() {
  const existing = await chrome.tabs.query({ url: 'https://www.magnific.com/app/*' });
  if (existing.length > 0) return existing[0];
  const tab = await chrome.tabs.create({ url: 'https://www.magnific.com/app/spaces', active: false });
  await new Promise((r) => setTimeout(r, 4000));
  return tab;
}

async function waitForTabComplete(tabId, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const t = await chrome.tabs.get(tabId);
      if (t.status === 'complete') return true;
    } catch { return false; }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function ensureContentLoaded(tabId) {
  try {
    const r = await Promise.race([
      chrome.tabs.sendMessage(tabId, { type: 'MG_PING' }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('ping timeout')), 1500)),
    ]);
    if (r?.ok) return true;
  } catch {}
  await chrome.scripting.executeScript({ target: { tabId }, files: ['magnific-content.js'] });
  await new Promise((r) => setTimeout(r, 1000));
  return true;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return;

  // PING
  if (msg.type === 'MG_PING') {
    sendResponse({ ok: true });
    return false;
  }

  // Forward generic — todos handlers passam pelo content-script
  const FORWARD = [
    'MG_TEST_SESSION', 'MG_GET_PLAN', 'MG_CREATE_SPACE',
    'MG_GENERATE_IMAGE', 'MG_ANIMATE_IMAGE', 'MG_LIST_GENERATIONS',
    'MG_DOWNLOAD_ASSET',
    'MG_RUN_PIPELINE',          // v3.0 batch entrypoint
    'MG_RUN_PIPELINE_TEMPLATE', // v3.2.0 template entrypoint
  ];
  if (FORWARD.includes(msg.type)) {
    sendResponse({ accepted: true });
    handleForward(msg, sender.tab?.id);
    return false;
  }

  // PUSH RESULTS do content-script → bridge tab
  if (msg.type === 'MG_TAB_RESULT') {
    const job = pendingJobs.get(msg.requestId);
    if (job) {
      clearTimeout(job.timeoutId);
      pendingJobs.delete(msg.requestId);
      reportToPage(job.bridgeTabId, msg.requestId, msg.resultType, msg.payload);
    }
    return false;
  }
  if (msg.type === 'MG_TAB_PROGRESS') {
    const job = pendingJobs.get(msg.requestId);
    if (job) {
      reportToPage(job.bridgeTabId, msg.requestId, msg.progressType, msg.payload);
    }
    return false;
  }
});

async function handleForward(msg, bridgeTabId) {
  const requestId = msg.requestId;
  const tab = await findOrCreateMagnificTab();
  await waitForTabComplete(tab.id);
  await ensureContentLoaded(tab.id);

  // Timeout maximo por tipo
  const timeouts = {
    MG_GENERATE_IMAGE: 240000,   // 4min
    MG_ANIMATE_IMAGE: 720000,    // 12min
    MG_DOWNLOAD_ASSET: 120000,
    // Pipeline batch: 30 takes em relaxed mode (com 12 paralelos imagens + 6 paralelos
    // videos) pode levar 1-2h. Damos 4h de margem.
    MG_RUN_PIPELINE: 14400000,
    MG_RUN_PIPELINE_TEMPLATE: 14400000, // 4h (mesma janela)
  };
  const timeoutMs = timeouts[msg.type] || 60000;

  const timeoutId = setTimeout(() => {
    if (pendingJobs.has(requestId)) {
      pendingJobs.delete(requestId);
      reportToPage(bridgeTabId, requestId, msg.type + '_RESULT', {
        ok: false,
        error: `Timeout ${timeoutMs / 1000}s no ${msg.type}.`,
      });
    }
  }, timeoutMs);
  pendingJobs.set(requestId, { bridgeTabId, timeoutId });

  try {
    chrome.tabs.sendMessage(tab.id, {
      type: msg.type,
      requestId,
      payload: msg.payload,
    }).catch((e) => {
      if (pendingJobs.has(requestId)) {
        clearTimeout(timeoutId);
        pendingJobs.delete(requestId);
        reportToPage(bridgeTabId, requestId, msg.type + '_RESULT', {
          ok: false,
          error: 'Aba Magnific nao respondeu: ' + (e?.message ?? String(e)),
        });
      }
    });
  } catch (e) {
    if (pendingJobs.has(requestId)) {
      clearTimeout(timeoutId);
      pendingJobs.delete(requestId);
      reportToPage(bridgeTabId, requestId, msg.type + '_RESULT', {
        ok: false,
        error: 'Erro: ' + (e?.message ?? String(e)),
      });
    }
  }
}

console.log('[DARKO Magnific BG] online v' + chrome.runtime.getManifest().version);
