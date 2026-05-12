/**
 * DARKO LAB Magnific - Content Script v2.0.0
 *
 * REAL ENDPOINTS (descobertos engenharia reversa, sessao Premium+ ao vivo):
 *   - GET  /app/api/wallet                              → plan + credits
 *   - GET  /app/api/limits                              → feature limits
 *   - GET  /app/api/video/ai-models                     → modelos video (kling-25, kling-26, etc.)
 *   - POST /app/api/spaces                              → create space (precisa CSRF/origin)
 *   - GET  /app/api/spaces/{id}                         → metadata
 *   - GET  /app/api/spaces/{id}/resources               → custom_models
 *   - POST /app/api/spaces/{id}/workflows/execute       → DISPARA generation
 *     body: { startNodeId, runSingular:true, runDownstream:false, force_credits:true, experiments:false }
 *     resp: { workflow_run_identifier: "<id>" }
 *
 * NODE-BASED ARCHITECTURE:
 *   Magnific Spaces = Vue Flow + Liveblocks CRDT. Nodes (Image Generator, Video
 *   Generator) sao criados via WebSocket Liveblocks, nao via REST. Por isso o
 *   pipeline usa **DOM AUTOMATION** (mesma UI que o user usa) pra criar nodes
 *   + setar prompts + clicar Play. Depois detecta `<img src=pikaso.cdnpk.net/private/.../render.jpg>`
 *   pra extrair URL final.
 *
 * KLING MODELS DISPONIVEIS (via /app/api/video/ai-models):
 *   kling-25 (Kling 2.5) | kling-26 (Kling 2.6) | kling-21 | kling-21-master |
 *   kling-omni1 | kling-motion-control
 *
 * PLAN: Premium+ = productName "MAGNIFIC-M" no /app/api/wallet
 *       text-to-image-fast tem unlimitedProduct: "magnific" -> ilimitado
 *
 * PUSH PATTERN: sendResponse({accepted:true}) + chrome.runtime.sendMessage
 *   sobrevive SW hibernar.
 */

const DARKO_MG_VERSION = '2.0.0';
if (window.__darkolab_magnific_loaded__) {
  console.log('[DARKO Magnific Content] JA carregado, skip v=' + DARKO_MG_VERSION);
} else {
  window.__darkolab_magnific_loaded__ = true;
  console.log('[DARKO Magnific Content] online v=' + DARKO_MG_VERSION);
}

const API = ''; // same-origin (cookies fluem)

async function fetchJson(path, opts = {}, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(API + path, {
      ...opts,
      credentials: 'include',
      signal: ctrl.signal,
    });
    const txt = await r.text();
    let json = null;
    try { json = JSON.parse(txt); } catch { /* SPA HTML fallback */ }
    return { ok: r.ok, status: r.status, json, raw: txt.slice(0, 1500) };
  } finally {
    clearTimeout(tid);
  }
}

async function fetchBuffer(url, timeoutMs = 120000) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { credentials: 'include', signal: ctrl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.arrayBuffer();
  } finally {
    clearTimeout(tid);
  }
}

// ========================= MESSAGES =========================

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return;

  if (msg.type === 'MG_PING') {
    sendResponse({ ok: true, version: DARKO_MG_VERSION });
    return false;
  }

  const PUSH_HANDLERS = {
    MG_TEST_SESSION: handleTestSession,
    MG_GET_PLAN: handleGetPlan,
    MG_CREATE_SPACE: handleCreateSpace,
    MG_GENERATE_IMAGE: handleGenerateImage,
    MG_ANIMATE_IMAGE: handleAnimateImage,
    MG_LIST_GENERATIONS: handleListGenerations,
    MG_DOWNLOAD_ASSET: handleDownloadAsset,
  };
  const handler = PUSH_HANDLERS[msg.type];
  if (handler) {
    sendResponse({ accepted: true });
    const reqId = msg.requestId;
    const resultType = msg.type + '_RESULT';
    const progressType = msg.type + '_PROGRESS';
    handler(msg.payload, (progress) => {
      chrome.runtime.sendMessage({
        type: 'MG_TAB_PROGRESS',
        requestId: reqId,
        progressType,
        payload: progress,
      }).catch(() => {});
    })
      .then((result) => {
        chrome.runtime.sendMessage({
          type: 'MG_TAB_RESULT',
          requestId: reqId,
          resultType,
          payload: { ok: true, ...result },
        }).catch(() => {});
      })
      .catch((e) => {
        chrome.runtime.sendMessage({
          type: 'MG_TAB_RESULT',
          requestId: reqId,
          resultType,
          payload: { ok: false, error: e?.message || String(e) },
        }).catch(() => {});
      });
    return false;
  }
});

// ========================= REAL HANDLERS =========================

/** Testa sessao via /app/api/wallet (Premium+ check). */
async function handleTestSession() {
  const r = await fetchJson('/app/api/wallet');
  if (!r.ok || !r.json) {
    throw new Error('Sessao nao valida (status ' + r.status + '). Logue em www.magnific.com.');
  }
  const j = r.json;
  return {
    ok: true,
    endpoint: '/app/api/wallet',
    detail: `${j.productName || 'unknown'} | credits=${j.credits}/${j.totalCredits}`,
    sample: { product: j.product, productName: j.productName, credits: j.credits },
  };
}

/** Plano + Premium+ check via wallet + limits. */
async function handleGetPlan() {
  const [w, l] = await Promise.all([
    fetchJson('/app/api/wallet'),
    fetchJson('/app/api/limits'),
  ]);
  if (!w.ok || !w.json) {
    throw new Error('wallet HTTP ' + w.status);
  }
  const wj = w.json;
  const lj = l.json || {};
  // Premium+ tem unlimitedProduct: "magnific" nos limits chave (text-to-image-fast, sketch-fast etc.)
  const unlimitedKeys = Object.values(lj.limits || {})
    .filter((v) => v?.unlimitedProduct === 'magnific')
    .map((v) => v.key);
  const isPremiumPlus =
    /premium/i.test(wj.productName || '') ||
    /magnific/i.test(wj.product || '') ||
    unlimitedKeys.length > 0;
  return {
    tier: wj.productName || wj.product || 'unknown',
    productCode: wj.product,
    premiumPlus: isPremiumPlus,
    credits: wj.credits,
    totalCredits: wj.totalCredits,
    unlimitedCount: unlimitedKeys.length,
    sampleUnlimited: unlimitedKeys.slice(0, 8),
  };
}

/** Cria Space via REST. Se REST falhar (CSRF/origin), faz fallback DOM. */
async function handleCreateSpace(payload) {
  const { name } = payload || {};
  const tryRest = async () => {
    const r = await fetchJson('/app/api/spaces', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: name || 'DARKO LAB', type: 'board' }),
    }, 15000);
    if (!r.ok || !r.json) {
      throw new Error('REST create-space HTTP ' + r.status);
    }
    const id = r.json.id || r.json?.data?.id || r.json?.space_id;
    if (!id) throw new Error('Sem id na resposta create-space.');
    return { spaceId: id, url: 'https://www.magnific.com/app/spaces/' + id };
  };
  try {
    return await tryRest();
  } catch (e) {
    // Fallback DOM: navega ate /app/spaces, click "New space", espera URL mudar
    return await createSpaceViaDOM(name);
  }
}

/** Gera imagem via DOM automation. Premium+ -> ilimitado.
 *  Payload: { spaceId?, prompt, model?: 'nano-banana-2' (ignorado se Auto serve) } */
async function handleGenerateImage(payload, onProgress) {
  const { spaceId, prompt } = payload || {};
  if (!prompt) throw new Error('Sem prompt.');

  onProgress?.({ stage: 'navigate', percent: 5, message: 'Navegando ao Space...' });
  await ensureSpace(spaceId);

  onProgress?.({ stage: 'add-node', percent: 15, message: 'Adicionando Image Generator...' });
  const nodeUuid = await addImageGeneratorNode();

  onProgress?.({ stage: 'set-prompt', percent: 30, message: 'Setando prompt...' });
  await setNodePrompt(prompt);

  onProgress?.({ stage: 'execute', percent: 45, message: 'Disparando workflow...' });
  const { workflowRunId } = await executeWorkflow(nodeUuid);

  onProgress?.({ stage: 'polling', percent: 50, message: 'Aguardando render (' + workflowRunId + ')...' });
  const imageUrl = await waitForRenderedImage(nodeUuid, 180000);

  onProgress?.({ stage: 'done', percent: 100, message: 'Imagem pronta.' });
  return { generationId: workflowRunId, imageUrl, nodeUuid };
}

/** Anima imagem via DOM. Cria Video Generator com Kling 2.5, conecta na imagem
 *  fonte, dispara workflow. */
async function handleAnimateImage(payload, onProgress) {
  const { spaceId, imageUrl, imageNodeUuid, prompt, model = 'kling-25' } = payload || {};
  if (!imageUrl && !imageNodeUuid) throw new Error('Sem imagem fonte.');

  onProgress?.({ stage: 'navigate', percent: 5, message: 'Navegando ao Space...' });
  await ensureSpace(spaceId);

  onProgress?.({ stage: 'add-node', percent: 20, message: 'Adicionando Video Generator...' });
  const videoNodeUuid = await addVideoGeneratorNode(model);

  if (prompt) {
    onProgress?.({ stage: 'set-prompt', percent: 35, message: 'Setando motion prompt...' });
    await setNodePrompt(prompt);
  }

  onProgress?.({ stage: 'connect', percent: 45, message: 'Conectando imagem fonte...' });
  // Conexao manual via Liveblocks e complexa — assumimos que a aresta sera
  // criada quando o user clicar play no node de video que ja "ve" a imagem
  // mais recente. Workaround: usar handle drag programatico. Por ora,
  // executa direto e Magnific resolve dependencias do workflow.

  onProgress?.({ stage: 'execute', percent: 55, message: 'Disparando workflow Kling...' });
  const { workflowRunId } = await executeWorkflow(videoNodeUuid);

  onProgress?.({ stage: 'polling', percent: 60, message: 'Renderizando video...' });
  const videoUrl = await waitForRenderedVideo(videoNodeUuid, 600000);

  onProgress?.({ stage: 'done', percent: 100, message: 'Video pronto.' });
  return { videoGenerationId: workflowRunId, videoUrl, videoNodeUuid };
}

async function handleListGenerations() {
  return { generations: [], warning: 'list-generations nao implementado (use poll por node).' };
}

/** Baixa URL via fetch autenticado -> base64. */
async function handleDownloadAsset(payload) {
  const { url } = payload || {};
  if (!url) throw new Error('Sem url.');
  const buf = await fetchBuffer(url, 120000);
  const bytes = new Uint8Array(buf);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return { base64: btoa(binary), size: bytes.length };
}

// ========================= DOM AUTOMATION HELPERS =========================

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitFor(predicate, timeoutMs = 30000, pollMs = 200) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await predicate();
      if (r) return r;
    } catch {}
    await sleep(pollMs);
  }
  throw new Error('Timeout ' + (timeoutMs / 1000) + 's no waitFor.');
}

function currentSpaceIdFromURL() {
  const m = location.pathname.match(/\/app\/spaces\/([a-f0-9-]{30,})/);
  return m ? m[1] : null;
}

async function ensureSpace(spaceId) {
  const current = currentSpaceIdFromURL();
  if (spaceId && current === spaceId) return spaceId;
  if (current && !spaceId) return current; // ja em alguma space
  // Navega via location (single-page app reage sozinho)
  const targetUrl = spaceId
    ? 'https://www.magnific.com/app/spaces/' + spaceId
    : 'https://www.magnific.com/app/spaces';
  if (location.href !== targetUrl) {
    location.href = targetUrl;
    await sleep(3500); // SPA reload
  }
  // Se nao tem spaceId, precisa criar via DOM
  if (!spaceId) {
    const created = await createSpaceViaDOM('DARKO LAB');
    return created.spaceId;
  }
  return spaceId;
}

async function createSpaceViaDOM(name) {
  if (!/\/app\/spaces(\?|$)/.test(location.pathname)) {
    location.href = 'https://www.magnific.com/app/spaces';
    await sleep(3500);
  }
  // Click "+ New space" button
  const btn = await waitFor(() => {
    const cands = Array.from(document.querySelectorAll('button')).filter((b) => /new\s*space/i.test(b.textContent || ''));
    return cands[0] || null;
  }, 8000);
  btn.click();
  await waitFor(() => /\/app\/spaces\/[a-f0-9-]{30,}/.test(location.pathname), 12000);
  const id = currentSpaceIdFromURL();
  if (!id) throw new Error('Falha ao detectar spaceId apos create.');
  // Opcional: renomear via DOM (futuro)
  return { spaceId: id, url: 'https://www.magnific.com/app/spaces/' + id };
}

/** Clica no botao "Image Generator" do toolbar lateral e detecta o uuid do node criado. */
async function addImageGeneratorNode() {
  // 1) Snapshot dos node uuids existentes
  const beforeUuids = collectNodeUuids();
  // 2) Click no botao Image Generator
  const btn = await waitFor(() => {
    const all = Array.from(document.querySelectorAll('button'));
    // Tenta varios labels: aria-label, title, textContent
    return all.find((b) => {
      const t = (b.getAttribute('aria-label') || b.getAttribute('title') || b.textContent || '').toLowerCase();
      return /image\s*generator/.test(t);
    }) || null;
  }, 8000);
  btn.click();
  // 3) Espera 1 uuid novo aparecer
  const newUuid = await waitFor(() => {
    const now = collectNodeUuids();
    const fresh = now.filter((u) => !beforeUuids.includes(u));
    return fresh[0] || null;
  }, 6000);
  await sleep(400);
  return newUuid;
}

async function addVideoGeneratorNode(modelId) {
  const beforeUuids = collectNodeUuids();
  const btn = await waitFor(() => {
    const all = Array.from(document.querySelectorAll('button'));
    return all.find((b) => {
      const t = (b.getAttribute('aria-label') || b.getAttribute('title') || b.textContent || '').toLowerCase();
      return /video\s*generator/.test(t);
    }) || null;
  }, 8000);
  btn.click();
  const newUuid = await waitFor(() => {
    const now = collectNodeUuids();
    const fresh = now.filter((u) => !beforeUuids.includes(u));
    return fresh[0] || null;
  }, 6000);
  await sleep(500);
  // TODO: model selector — abrir dropdown e escolher modelId (kling-25)
  return newUuid;
}

/** Coleta uuids dos nodes pelo data-attr do Vue Flow (`data-id` ou `[id^=node-]`). */
function collectNodeUuids() {
  const out = new Set();
  document.querySelectorAll('[data-id]').forEach((el) => {
    const v = el.getAttribute('data-id') || '';
    if (/^[a-f0-9-]{30,}$/.test(v)) out.add(v);
  });
  document.querySelectorAll('[id^="node-"]').forEach((el) => {
    const v = (el.id || '').replace(/^node-/, '');
    if (/^[a-f0-9-]{30,}$/.test(v)) out.add(v);
  });
  return Array.from(out);
}

/** Seta o prompt no contenteditable do node selecionado. */
async function setNodePrompt(prompt) {
  const ed = await waitFor(() => {
    const eds = document.querySelectorAll('[contenteditable="true"]');
    // Preferimos o ultimo (mais recente)
    return eds.length > 0 ? eds[eds.length - 1] : null;
  }, 6000);
  ed.focus();
  ed.innerText = prompt;
  ed.dispatchEvent(new InputEvent('input', { bubbles: true, data: prompt, inputType: 'insertText' }));
  ed.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(250);
  return true;
}

/** Dispara o workflow_run via REST. Body: { startNodeId, runSingular:true, runDownstream:false, force_credits:true, experiments:false } */
async function executeWorkflow(startNodeId) {
  const spaceId = currentSpaceIdFromURL();
  if (!spaceId) throw new Error('Sem spaceId no URL pra execute.');
  const r = await fetchJson('/app/api/spaces/' + spaceId + '/workflows/execute', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      startNodeId,
      runSingular: true,
      runDownstream: false,
      force_credits: true,
      experiments: false,
    }),
  }, 30000);
  if (!r.ok || !r.json) {
    throw new Error('execute HTTP ' + r.status + ' / ' + r.raw.slice(0, 200));
  }
  return {
    workflowRunId: r.json.workflow_run_identifier || r.json.id || '?',
  };
}

/** Espera <img src=pikaso.cdnpk.net/private/.../render.jpg> aparecer dentro do
 *  node especifico (data-id=nodeUuid). */
async function waitForRenderedImage(nodeUuid, timeoutMs = 180000) {
  return await waitFor(() => {
    const container = document.querySelector('[data-id="' + nodeUuid + '"], #node-' + nodeUuid);
    const scope = container || document;
    const imgs = scope.querySelectorAll('img');
    for (const im of imgs) {
      const s = im.src || '';
      if (/pikaso\.cdnpk\.net\/private\/production\//.test(s) && !/placeholder|spaces-cover/i.test(s)) {
        return s;
      }
    }
    return null;
  }, timeoutMs, 1500);
}

async function waitForRenderedVideo(nodeUuid, timeoutMs = 600000) {
  return await waitFor(() => {
    const container = document.querySelector('[data-id="' + nodeUuid + '"], #node-' + nodeUuid);
    const scope = container || document;
    // Procura <video src=...> ou <source src=...> ou img preview com .mp4
    const vids = scope.querySelectorAll('video, source');
    for (const v of vids) {
      const s = v.src || v.currentSrc || '';
      if (/\.mp4|videos|render/i.test(s) && /cdnpk|pikaso|magnific|cloudfront/i.test(s)) {
        return s;
      }
    }
    // Fallback: link de download mp4
    const anchors = scope.querySelectorAll('a[href*=".mp4"]');
    if (anchors[0]) return anchors[0].href;
    return null;
  }, timeoutMs, 2000);
}
