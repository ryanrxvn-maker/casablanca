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

  // v3.4.7: REAL MOUSE CLICK via chrome.debugger CDP.
  // Content script chama isso quando dispatched events nao funcionam (dropdown options
  // do Magnific). Background attaches debugger pro tab + dispatches Input.dispatchMouseEvent
  // que simula REAL mouse click (mesmo que MCP/Chrome devtools fazem).
  if (msg.type === 'MG_REAL_CLICK') {
    const tabId = sender.tab?.id;
    const { x, y } = msg.payload || {};
    if (!tabId || typeof x !== 'number' || typeof y !== 'number') {
      sendResponse({ ok: false, error: 'invalid tabId/coords' });
      return false;
    }
    (async () => {
      const target = { tabId };
      try {
        // Try attach (may already be attached, that's fine)
        try { await chrome.debugger.attach(target, '1.3'); } catch (e) {
          if (!/already/i.test(e?.message || '')) {
            // re-throw if not "already attached"
            throw e;
          }
        }
        // Move + press + release at coords (REAL mouse click)
        await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
          type: 'mouseMoved', x, y, button: 'none', buttons: 0, clickCount: 0
        });
        await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
          type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1
        });
        await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
          type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1
        });
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: e?.message || String(e) });
      }
    })();
    return true; // keep channel open for async sendResponse
  }

  // v3.4.2: SELF-RELOAD — bridge ou page pede a extension pra recarregar-se.
  // chrome.runtime.reload() reinicia o service worker E re-injeta todos os
  // content scripts. Util quando shippado nova versao e usuario nao quer ir
  // em chrome://extensions clicar Reload manualmente.
  if (msg.type === 'MG_SELF_RELOAD') {
    sendResponse({ ok: true, willReload: true });
    setTimeout(() => {
      try { chrome.runtime.reload(); } catch (e) { console.error('[BG] reload failed:', e); }
    }, 100);
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
      // v3.3.2: clear setup heartbeat assim que chega primeiro progress
      if (!job.firstProgressAt) {
        job.firstProgressAt = Date.now();
        if (job.heartbeatId) { clearTimeout(job.heartbeatId); job.heartbeatId = null; }
      }
      reportToPage(job.bridgeTabId, msg.requestId, msg.progressType, msg.payload);
    }
    return false;
  }
});

async function handleForward(msg, bridgeTabId) {
  const requestId = msg.requestId;

  // v3.3.2 ROBUSTEZ TOTAL: TUDO dentro de try/catch.
  // Antes (v3.3.1): se findOrCreateMagnificTab / waitForTabComplete / ensureContentLoaded
  // lancasse, o erro virava unhandled promise rejection e o user via STALL MUDO.
  // Agora: erro propaga 100% pro user via reportToPage.
  try {
    const tab = await findOrCreateMagnificTab();
    await waitForTabComplete(tab.id);
    await ensureContentLoaded(tab.id);

    // Timeout maximo por tipo
    const timeouts = {
      MG_GENERATE_IMAGE: 240000,
      MG_ANIMATE_IMAGE: 720000,
      MG_DOWNLOAD_ASSET: 120000,
      MG_RUN_PIPELINE: 14400000,
      MG_RUN_PIPELINE_TEMPLATE: 14400000,
      MG_CREATE_TEMPLATE_SPACE: 1800000,
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

    // v3.3.2: aguarda heartbeat de progress dentro de SETUP_HEARTBEAT_MS — se
    // nao chegar nenhum progress nesse tempo, ABORTA com erro claro. Isso evita
    // o stall de 4h se o content script for messageado mas nao processar.
    const SETUP_HEARTBEAT_MS = 60000; // 60s pra ver ALGUM progress de Phase 0/1
    const heartbeatId = setTimeout(() => {
      if (pendingJobs.has(requestId)) {
        const job = pendingJobs.get(requestId);
        if (!job.firstProgressAt) {
          clearTimeout(job.timeoutId);
          pendingJobs.delete(requestId);
          reportToPage(bridgeTabId, requestId, msg.type + '_RESULT', {
            ok: false,
            error:
              `SETUP_HEARTBEAT_TIMEOUT (${SETUP_HEARTBEAT_MS / 1000}s sem progress). ` +
              `Causa provavel: content script nao iniciou ou Magnific nao respondeu. ` +
              `Solucao: F5 na aba Magnific + retry. Se persistir, abre DevTools (F12) na aba Magnific Console pra ver erros.`,
          });
        }
      }
    }, SETUP_HEARTBEAT_MS);
    const job = pendingJobs.get(requestId);
    if (job) { job.heartbeatId = heartbeatId; }

    chrome.tabs.sendMessage(tab.id, {
      type: msg.type,
      requestId,
      payload: msg.payload,
    }).catch((e) => {
      if (pendingJobs.has(requestId)) {
        const j = pendingJobs.get(requestId);
        clearTimeout(j.timeoutId);
        if (j.heartbeatId) clearTimeout(j.heartbeatId);
        pendingJobs.delete(requestId);
        reportToPage(bridgeTabId, requestId, msg.type + '_RESULT', {
          ok: false,
          error:
            'Aba Magnific nao recebeu mensagem (' + (e?.message ?? String(e)) + '). ' +
            'Solucao: F5 na aba Magnific (content script pode estar morto apos reload da extension).',
        });
      }
    });
  } catch (e) {
    // ensureContentLoaded / findOrCreateMagnificTab THROW chegam aqui
    if (pendingJobs.has(requestId)) {
      const j = pendingJobs.get(requestId);
      clearTimeout(j.timeoutId);
      if (j.heartbeatId) clearTimeout(j.heartbeatId);
      pendingJobs.delete(requestId);
    }
    reportToPage(bridgeTabId, requestId, msg.type + '_RESULT', {
      ok: false,
      error: 'Setup falhou: ' + (e?.message ?? String(e)),
    });
  }
}

console.log('[DARKO Magnific BG] online v' + chrome.runtime.getManifest().version);
