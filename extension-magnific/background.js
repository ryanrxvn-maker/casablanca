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

// v3.5.7: SW lifecycle fix — pendingJobs persisted in storage.session.
// MV3 SW dies after ~30s idle; in-memory Map is wiped. Storage survives.
const pendingJobs = new Map();
const STORAGE_KEY = '__darko_mg_pending_jobs__';

// v3.5.48 ANTI-THROTTLE DEFINITIVO: uma aba com chrome.debugger anexado NÃO é
// throttled pelo Chrome mesmo em background/não-focada (o renderer fica ativo
// pro debug). Mantemos o debugger anexado durante TODO o pipeline → a janela
// separada não-focada roda em VELOCIDADE TOTAL sem roubar o foco do user.
// Resolve a tensão "funciona" vs "não rouba foco" de uma vez.
const pipelineDebuggerTabs = new Set();

async function attachPipelineDebugger(tabId) {
  if (!tabId) return;
  try {
    await chrome.debugger.attach({ tabId }, '1.3');
  } catch (e) {
    if (!/already attached/i.test(e?.message || '')) {
      console.warn('[DARKO BG] attachPipelineDebugger falhou:', e?.message);
      return;
    }
  }
  pipelineDebuggerTabs.add(tabId);
  // Mantém o renderer "acordado": page lifecycle active (anti background-freeze)
  try {
    await chrome.debugger.sendCommand({ tabId }, 'Page.enable');
    await chrome.debugger.sendCommand({ tabId }, 'Emulation.setFocusEmulationEnabled', { enabled: true });
  } catch {}
  console.log('[DARKO BG] debugger anexado p/ pipeline (anti-throttle) tab=', tabId);
}

async function detachPipelineDebugger(tabId) {
  if (!tabId || !pipelineDebuggerTabs.has(tabId)) return;
  pipelineDebuggerTabs.delete(tabId);
  try { await chrome.debugger.sendCommand({ tabId }, 'Emulation.setFocusEmulationEnabled', { enabled: false }); } catch {}
  try { await chrome.debugger.detach({ tabId }); } catch {}
  console.log('[DARKO BG] debugger desanexado (fim pipeline) tab=', tabId);
}

async function persistJob(requestId, data) {
  try {
    const all = (await chrome.storage.session.get(STORAGE_KEY))[STORAGE_KEY] || {};
    all[requestId] = { bridgeTabId: data.bridgeTabId, firstProgressAt: data.firstProgressAt || null };
    await chrome.storage.session.set({ [STORAGE_KEY]: all });
  } catch {}
}

async function unpersistJob(requestId) {
  try {
    const all = (await chrome.storage.session.get(STORAGE_KEY))[STORAGE_KEY] || {};
    delete all[requestId];
    await chrome.storage.session.set({ [STORAGE_KEY]: all });
  } catch {}
}

async function recoverJob(requestId) {
  try {
    const all = (await chrome.storage.session.get(STORAGE_KEY))[STORAGE_KEY] || {};
    return all[requestId] || null;
  } catch { return null; }
}

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

  // v3.5.18 CRITICAL: FORCE magnific tab to FOREGROUND. Chrome heavily throttles
  // background tabs (setTimeout ~1/sec, animations slow). This makes Vue Flow
  // popup rendering take 30s+ instead of 300ms. By forcing foreground BEFORE
  // pipeline starts, all UI ops run at normal speed = pipeline completes 10x faster.

  // v3.5.46 — REVERTIDO pro comportamento que FUNCIONA (v3.5.41: creditDelta=0,
  // 13/15 takes). Tentar rodar 100% invisível (v3.5.44) quebrou: Chrome
  // throttla aba oculta a ponto do handshake/criação de Space nunca completar
  // (trava em "Preparando Space"). Pra FUNCIONAR de forma confiável a aba
  // Magnific precisa estar ativa/visível durante a run. É um limite do Chrome
  // pra SPA pesado, não dá pra contornar mantendo invisível + confiável.

  // v3.5.50 — REVERTIDO 100% pro comportamento PROVADO que FUNCIONA
  // (v3.5.46: JSON 1 saiu perfeito no ambiente real do user). Tirar o foco
  // (v3.5.47/48/49) SEMPRE travou em "Preparando Space" — Chrome throttla
  // aba/janela não-focada e o handshake/SPA do Magnific nunca completa.
  // Verdade dura: pra FUNCIONAR a aba precisa estar focada/foreground. O
  // edge-fix (v3.5.49) e a serialização continuam — só o foco voltou.

  // Tier 1: active tab — foca janela tb (garante não-throttled)
  const active = existing.find((t) => t.active);
  if (active) {
    console.log('[DARKO BG] Usando active Magnific tab:', active.id);
    try { await chrome.windows.update(active.windowId, { focused: true }); } catch {}
    return active;
  }

  // Tier 2: PING; usa o primeiro vivo + traz pro foreground
  for (const t of existing) {
    try {
      const r = await Promise.race([
        chrome.tabs.sendMessage(t.id, { type: 'MG_PING' }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('ping timeout')), 1000)),
      ]);
      if (r?.ok) {
        console.log('[DARKO BG] Tab Magnific viva (PING ok):', t.id);
        try { await chrome.tabs.update(t.id, { active: true }); } catch {}
        try { await chrome.windows.update(t.windowId, { focused: true }); } catch {}
        return t;
      }
    } catch {}
  }

  // Tier 3: qualquer tab existente + foreground
  if (existing.length > 0) {
    console.log('[DARKO BG] Usando primeira Magnific tab:', existing[0].id);
    try { await chrome.tabs.update(existing[0].id, { active: true }); } catch {}
    try { await chrome.windows.update(existing[0].windowId, { focused: true }); } catch {}
    return existing[0];
  }

  // Tier 4: cria nova tab ATIVA (foreground — config que funciona)
  console.log('[DARKO BG] Criando nova Magnific tab (ativa/foreground)...');
  const tab = await chrome.tabs.create({ url: 'https://www.magnific.com/app/spaces', active: true });
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

  // v3.5.7: KEEPALIVE — content script sends every 20s during long polling
  // to keep SW awake. Critical for waitForNodeVideo (10s polls for up to 15min).
  if (msg.type === 'MG_KEEPALIVE') {
    sendResponse({ ok: true });
    return false;
  }

  // v3.5.13: PERSISTENT CDP attach — debugger stays attached for entire
  // pipeline so banner shifts viewport only ONCE. All subsequent clicks
  // use the SAME viewport so coordinates from getBoundingClientRect match
  // exactly what Input.dispatchMouseEvent expects. This emulates real
  // user interactions (isTrusted=true) without flaky coord drift.
  if (msg.type === 'MG_CDP_ATTACH') {
    const tabId = sender.tab?.id;
    if (!tabId) { sendResponse({ ok: false, error: 'no tabId' }); return false; }
    (async () => {
      try {
        await chrome.debugger.attach({ tabId }, '1.3');
        sendResponse({ ok: true });
      } catch (e) {
        if (/already attached/i.test(e?.message || '')) {
          sendResponse({ ok: true, alreadyAttached: true });
        } else {
          sendResponse({ ok: false, error: e?.message || String(e) });
        }
      }
    })();
    return true;
  }

  if (msg.type === 'MG_CDP_DETACH') {
    const tabId = sender.tab?.id;
    if (!tabId) { sendResponse({ ok: false }); return false; }
    (async () => {
      // v3.5.48: NÃO desanexa se o debugger é do pipeline (anti-throttle).
      // Só o fim do pipeline (MG_TAB_RESULT/timeout) pode desanexar.
      if (pipelineDebuggerTabs.has(tabId)) { sendResponse({ ok: true, keptForPipeline: true }); return; }
      try { await chrome.debugger.detach({ tabId }); sendResponse({ ok: true }); }
      catch (e) { sendResponse({ ok: false, error: e?.message }); }
    })();
    return true;
  }

  // v3.5.13: MG_CDP_FULL_CLICK — emulates full real-mouse sequence:
  // mouseMoved (hover) → mouseMoved (settle) → mousePressed → mouseReleased.
  // Vue Flow needs hover state before click registers correctly.
  if (msg.type === 'MG_CDP_FULL_CLICK') {
    const tabId = sender.tab?.id;
    const { x, y } = msg.payload || {};
    if (!tabId || typeof x !== 'number' || typeof y !== 'number') {
      sendResponse({ ok: false, error: 'invalid' }); return false;
    }
    (async () => {
      const target = { tabId };
      try {
        // Move to position (hover)
        await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
          type: 'mouseMoved', x, y, button: 'none', buttons: 0, clickCount: 0
        });
        // Small settle (real users dwell briefly before clicking)
        await new Promise(r => setTimeout(r, 50));
        // Press
        await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
          type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1
        });
        // Brief hold
        await new Promise(r => setTimeout(r, 30));
        // Release
        await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
          type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1
        });
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: e?.message || String(e) });
      }
    })();
    return true;
  }

  // v3.5.1: REAL MOUSE CLICK via chrome.debugger CDP — usado SO pra option click
  // em dropdown (Magnific bloqueou dispatched events com isTrusted check). LOCK
  // garante que nada seja dispatched se Kling 2.5 nao for selecionado.
  if (msg.type === 'MG_REAL_CLICK') {
    const tabId = sender.tab?.id;
    const { x, y } = msg.payload || {};
    if (!tabId || typeof x !== 'number' || typeof y !== 'number') {
      sendResponse({ ok: false, error: 'invalid tabId/coords' });
      return false;
    }
    (async () => {
      const target = { tabId };
      let attached = false;
      try {
        try { await chrome.debugger.attach(target, '1.3'); attached = true; } catch (e) {
          if (/already/i.test(e?.message || '')) {
            attached = true;
          } else {
            throw e;
          }
        }
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
      } finally {
        // v3.5.48: NÃO desanexa se é o debugger do pipeline (anti-throttle).
        // Desanexar entre cliques re-throttlaria a aba e travaria tudo.
        if (attached && !pipelineDebuggerTabs.has(tabId)) {
          try { await chrome.debugger.detach(target); } catch {}
        }
      }
    })();
    return true;
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
      if (job.timeoutId) clearTimeout(job.timeoutId);
      if (job.heartbeatId) clearTimeout(job.heartbeatId);
      pendingJobs.delete(msg.requestId);
      unpersistJob(msg.requestId);
      // v3.5.48: fim do pipeline → desanexa o debugger anti-throttle
      if (job.magnificTabId) detachPipelineDebugger(job.magnificTabId);
      reportToPage(job.bridgeTabId, msg.requestId, msg.resultType, msg.payload);
    } else {
      // v3.5.7: SW restart recovery for RESULT too
      (async () => {
        const recovered = await recoverJob(msg.requestId);
        if (recovered && recovered.bridgeTabId) {
          unpersistJob(msg.requestId);
          reportToPage(recovered.bridgeTabId, msg.requestId, msg.resultType, msg.payload);
        }
      })();
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
        persistJob(msg.requestId, job);
      }
      // v3.5.50 — RESTAURADO re-focus periódico (comportamento PROVADO
      // v3.5.46 que funcionou). Chrome throttla aba não-focada → pipeline
      // trava. Re-foca a cada ~10s pra manter velocidade e o pipeline
      // efetivamente progredir. (Trade-off conhecido: a aba vem pro foco às
      // vezes — é o preço de FUNCIONAR; SPA pesado throttled não roda.)
      const senderTabId = sender.tab?.id;
      if (senderTabId) {
        const now = Date.now();
        if (!job.lastFocusAt || (now - job.lastFocusAt > 10000)) {
          job.lastFocusAt = now;
          chrome.tabs.update(senderTabId, { active: true }).catch(() => {});
          if (sender.tab?.windowId != null) {
            chrome.windows.update(sender.tab.windowId, { focused: true }).catch(() => {});
          }
        }
      }
      reportToPage(job.bridgeTabId, msg.requestId, msg.progressType, msg.payload);
    } else {
      // v3.5.7: SW restart edge case — pendingJobs Map is empty but storage has it.
      // Recover bridgeTabId from storage and forward progress.
      (async () => {
        const recovered = await recoverJob(msg.requestId);
        if (recovered && recovered.bridgeTabId) {
          pendingJobs.set(msg.requestId, { bridgeTabId: recovered.bridgeTabId, firstProgressAt: recovered.firstProgressAt || Date.now() });
          reportToPage(recovered.bridgeTabId, msg.requestId, msg.progressType, msg.payload);
        }
      })();
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

    // v3.5.50: REMOVIDO attachPipelineDebugger (v3.5.48). Era não-comprovado
    // e correlacionou 100% com o trava "Preparando Space". Voltamos ao
    // comportamento PROVADO (foco na aba) — sem debugger-attach do pipeline.

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
        detachPipelineDebugger(tab.id);
        reportToPage(bridgeTabId, requestId, msg.type + '_RESULT', {
          ok: false,
          error: `Timeout ${timeoutMs / 1000}s no ${msg.type}.`,
        });
      }
    }, timeoutMs);
    pendingJobs.set(requestId, { bridgeTabId, timeoutId, magnificTabId: tab.id });
    // v3.5.7: persist in storage.session so SW restart can recover
    persistJob(requestId, { bridgeTabId });

    // v3.3.2: aguarda heartbeat de progress dentro de SETUP_HEARTBEAT_MS — se
    // nao chegar nenhum progress nesse tempo, ABORTA com erro claro. Isso evita
    // o stall de 4h se o content script for messageado mas nao processar.
    // v3.5.48: 60s→180s. Com debugger anexado a aba não throttla, mas a 1ª
    // carga do SPA pesado pode levar >60s. 180s evita falso-timeout no setup.
    const SETUP_HEARTBEAT_MS = 180000;
    const heartbeatId = setTimeout(() => {
      if (pendingJobs.has(requestId)) {
        const job = pendingJobs.get(requestId);
        if (!job.firstProgressAt) {
          clearTimeout(job.timeoutId);
          pendingJobs.delete(requestId);
          detachPipelineDebugger(tab.id);
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
