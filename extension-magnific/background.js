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

/**
 * v3.3.1 ROBUSTEZ: encontra TAB ATIVO/VISIVEL Magnific de preferencia.
 * Ordem de prioridade:
 *   1. Tab active=true (foco em sua janela)
 *   2. Tab que responde MG_PING (content script vivo)
 *   3. Cria novo se nada serve
 */
async function findOrCreateMagnificTab() {
  const existing = await chrome.tabs.query({ url: 'https://www.magnific.com/app/*' });

  // Tier 1: active tab (foco do usuario) — content script provavelmente vivo
  const active = existing.find((t) => t.active);
  if (active) {
    console.log('[DARKO BG] Usando active Magnific tab:', active.id);
    return active;
  }

  // Tier 2: testa cada tab via PING; usa o primeiro que responder
  for (const t of existing) {
    try {
      const r = await Promise.race([
        chrome.tabs.sendMessage(t.id, { type: 'MG_PING' }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('ping timeout')), 1000)),
      ]);
      if (r?.ok) {
        console.log('[DARKO BG] Tab Magnific viva (PING ok):', t.id);
        return t;
      }
    } catch {}
  }

  // Tier 3: pega qualquer tab existente (vamos tentar injetar)
  if (existing.length > 0) {
    console.log('[DARKO BG] Usando primeira Magnific tab (nenhuma ativa, sem PING):', existing[0].id);
    return existing[0];
  }

  // Tier 4: cria nova tab
  console.log('[DARKO BG] Criando nova Magnific tab...');
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

/**
 * v3.3.1 ROBUSTEZ: injeta content script + verifica que pegou via second PING.
 * Se falhar mesmo apos injecao, throw error claro pro user ver no UI.
 */
async function ensureContentLoaded(tabId) {
  // First PING — content script ja vivo?
  try {
    const r = await Promise.race([
      chrome.tabs.sendMessage(tabId, { type: 'MG_PING' }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('ping timeout')), 1500)),
    ]);
    if (r?.ok) return true;
  } catch {}

  // Force-inject via chrome.scripting (works on most tabs, including some CDP-attached)
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['magnific-content.js'] });
  } catch (e) {
    console.error('[DARKO BG] chrome.scripting.executeScript falhou:', e);
    throw new Error(
      `Nao consegui injetar content script no tab Magnific (${tabId}). ` +
      `Causa provavel: tab esta sendo controlada por DevTools/CDP ou foi fechada. ` +
      `Solucao: refresh manual da aba Magnific (F5).`,
    );
  }
  await new Promise((r) => setTimeout(r, 1500));

  // Second PING — confirma que injecao pegou
  try {
    const r = await Promise.race([
      chrome.tabs.sendMessage(tabId, { type: 'MG_PING' }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('post-inject ping timeout')), 3000)),
    ]);
    if (r?.ok) {
      console.log('[DARKO BG] Content script injetado com sucesso (tab ' + tabId + ')');
      return true;
    }
  } catch (e) {
    console.warn('[DARKO BG] Post-inject PING falhou:', e?.message);
  }

  throw new Error(
    `Content script injetado mas nao responde no tab Magnific (${tabId}). ` +
    `Causa provavel: pagina nao terminou de carregar OU CDP isolation impede injecao. ` +
    `Solucao: abre/foca a aba Magnific manualmente e da F5.`,
  );
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
    'MG_CREATE_TEMPLATE_SPACE', // v3.3.0 template auto-builder
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
    MG_CREATE_TEMPLATE_SPACE: 1800000,  // 30min (50 image gens em sequencia)
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
