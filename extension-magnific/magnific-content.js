/**
 * DARKO LAB Magnific — Content Script v3.0.0
 *
 * PIPELINE BATCH otimizado:
 *   1. Ensure Space (cria 1 novo se nao passar spaceId)
 *   2. Para cada take (N takes):
 *      a) Cria Image Generator node
 *      b) Configura: Google Nano Banana 2 + 1K + 9:16 + UNLIMITED ON
 *      c) Cola prompt da imagem
 *      d) Click output handle -> popup -> Video Generator (conexao automatica)
 *      e) Configura video: Kling 2.5 + 720p + 9:16 + 10s + UNLIMITED ON
 *      f) Cola prompt do video (motion)
 *   3. Dispara workflow_execute em ondas: max 12 imagens simultaneas
 *   4. Quando imagens terminam: dispara videos em ondas de 6
 *   5. Detecta render via img.src=pikaso.cdnpk.net/private/.../render.jpg
 *      e video.src=mp4
 *   6. Retorna { results: [{imageUrl, videoUrl}, ...] }
 *
 * CRITICAL: NUNCA gastar creditos — sempre confirma Unlimited ON
 * antes de cada disparo. Se Unlimited estiver OFF, clica pra ligar.
 *
 * REAL ENDPOINTS:
 *   - GET  /app/api/wallet
 *   - POST /app/api/spaces                                       create space
 *   - POST /app/api/spaces/{id}/workflows/execute                trigger generation
 *     body: { startNodeId, runSingular:true, runDownstream:false, force_credits:true, experiments:false }
 *     resp: { workflow_run_identifier }
 *
 * KLING IDs: kling-25 (2.5) | kling-26 (2.6) | kling-21 | kling-omni1
 *
 * PUSH PATTERN: sendResponse({accepted:true}) + chrome.runtime.sendMessage
 */

const DARKO_MG_VERSION = '3.1.5';
if (window.__darkolab_magnific_loaded__) {
  console.log('[DARKO Magnific Content] JA carregado v=' + window.__darkolab_magnific_version);
} else {
  window.__darkolab_magnific_loaded__ = true;
  window.__darkolab_magnific_version = DARKO_MG_VERSION;
  console.log('[DARKO Magnific Content] online v=' + DARKO_MG_VERSION);
}

// ========================= NETWORK =========================

/**
 * CRITICAL (descoberto live v3.1.2): Magnific retorna SPA HTML (302 ou 200 com
 * <!DOCTYPE>) em endpoints REST se nao mandar `Accept: application/json` +
 * `X-Requested-With: XMLHttpRequest`. Com esses headers, retorna JSON real.
 * Sem isso, parseJSON falha e tudo quebra silenciosamente.
 *
 * Tambem injeta `?lang=en_US&user_id=<id>` por default se o path nao tem query
 * (a UI usa esses params em TODOS requests).
 */
const MG_DEFAULT_HEADERS = {
  'accept': 'application/json',
  'x-requested-with': 'XMLHttpRequest',
};

let __darkoUserId = null;
function getUserIdSync() {
  if (__darkoUserId) return __darkoUserId;
  // Try parse from any analytics URL in the DOM/perf entries
  try {
    const perfEntries = performance.getEntriesByType('resource');
    for (const e of perfEntries) {
      const m = (e.name || '').match(/[?&]user_id=(\d+)/);
      if (m) { __darkoUserId = m[1]; return m[1]; }
    }
  } catch {}
  return null;
}

function withDefaultQuery(path) {
  if (path.includes('?')) return path;
  const uid = getUserIdSync();
  return path + (uid ? `?lang=en_US&user_id=${uid}` : '?lang=en_US');
}

async function fetchJson(path, opts = {}, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const url = withDefaultQuery(path);
    const r = await fetch(url, {
      ...opts,
      credentials: 'include',
      headers: { ...MG_DEFAULT_HEADERS, ...(opts.headers || {}) },
      signal: ctrl.signal,
    });
    const txt = await r.text();
    let json = null;
    try { json = JSON.parse(txt); } catch {}
    return { ok: r.ok, status: r.status, json, raw: txt.slice(0, 800) };
  } finally {
    clearTimeout(tid);
  }
}

async function fetchBuffer(url, timeoutMs = 120000) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // URLs assinados de pikaso.cdnpk.net usam signed-token; credentials:'include'
    // pode falhar com CORS. Tenta 'omit' primeiro (signed), depois 'include' como
    // fallback pra endpoints same-origin.
    const isSignedCdn = /pikaso\.cdnpk\.net|cdnpk\.net/i.test(url);
    const r = await fetch(url, {
      credentials: isSignedCdn ? 'omit' : 'include',
      signal: ctrl.signal,
    });
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
    MG_RUN_PIPELINE: handleRunPipeline,
    MG_GENERATE_IMAGE: handleGenerateImage,
    MG_ANIMATE_IMAGE: handleAnimateImage,
    MG_DOWNLOAD_ASSET: handleDownloadAsset,
  };
  const handler = PUSH_HANDLERS[msg.type];
  if (!handler) return;

  sendResponse({ accepted: true });
  const reqId = msg.requestId;
  const resultType = msg.type + '_RESULT';
  const progressType = msg.type + '_PROGRESS';
  const onProgress = (progress) => {
    chrome.runtime.sendMessage({
      type: 'MG_TAB_PROGRESS',
      requestId: reqId,
      progressType,
      payload: progress,
    }).catch(() => {});
  };
  handler(msg.payload, onProgress)
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
});

// ========================= REST HANDLERS =========================

async function handleTestSession() {
  const r = await fetchJson('/app/api/wallet');
  if (!r.ok || !r.json) throw new Error('Sessao invalida HTTP ' + r.status);
  const j = r.json;
  return {
    ok: true,
    endpoint: '/app/api/wallet',
    detail: `${j.productName || j.product || '?'} | credits ${j.credits}/${j.totalCredits}`,
  };
}

async function handleGetPlan() {
  const [w, l] = await Promise.all([fetchJson('/app/api/wallet'), fetchJson('/app/api/limits')]);
  if (!w.ok || !w.json) throw new Error('wallet HTTP ' + w.status);
  const wj = w.json;
  const lj = l.json || {};
  const unlimitedKeys = Object.values(lj.limits || {})
    .filter((v) => v?.unlimitedProduct === 'magnific')
    .map((v) => v.key);
  const isPremiumPlus =
    /premium/i.test(wj.productName || '') ||
    /magnific/i.test(wj.product || '') ||
    unlimitedKeys.length > 0;
  return {
    tier: wj.productName || wj.product || '?',
    productCode: wj.product,
    premiumPlus: isPremiumPlus,
    credits: wj.credits,
    totalCredits: wj.totalCredits,
    unlimitedCount: unlimitedKeys.length,
  };
}

async function handleCreateSpace(payload) {
  return await ensureSpaceWithName((payload || {}).name);
}

async function handleDownloadAsset(payload) {
  const { url } = payload || {};
  if (!url) throw new Error('Sem url.');
  const buf = await fetchBuffer(url, 120000);
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
  }
  return { base64: btoa(bin), size: bytes.length };
}

// ========================= PIPELINE BATCH (entrypoint principal) =========================

/**
 * payload: {
 *   spaceName: string,
 *   spaceId?: string,
 *   takes: [{ idx, imagePrompt, videoPrompt }],
 *   imageModel?: 'nano-banana-2' | 'nano-banana-pro',
 *   videoModel?: 'kling-25' | 'kling-26',
 *   imageConcurrency?: 12,
 *   videoConcurrency?: 6,
 *   aspect?: '9:16',
 *   imageQuality?: '1K',
 *   videoQuality?: '720p',
 *   videoDuration?: 10,
 * }
 */
async function handleRunPipeline(payload, onProgress) {
  const {
    spaceName = 'DARKO LAB',
    spaceId: passedSpaceId,
    takes = [],
    imageModel = 'nano-banana-2',
    videoModel = 'kling-25',
    imageConcurrency = 12,
    videoConcurrency = 6,
    aspect = '9:16',
    imageQuality = '1K',
    videoQuality = '720p',
    videoDuration = 10,
  } = payload || {};

  if (!takes.length) throw new Error('Sem takes.');

  // PHASE 0: SAFETY — confirma is_unlimited_mode_enabled=true.
  // Se nao estiver, ABORTA antes de qualquer execute (NUNCA gastar creditos).
  onProgress({ phase: 'safety', percent: 1, message: 'Verificando Unlimited mode...' });
  const us = await fetchJson('/app/api/unlimited-status');
  if (us.json && us.json.is_unlimited_mode_enabled === false) {
    throw new Error('Unlimited mode DESLIGADO no Magnific. Aborte pra nao gastar creditos.');
  }
  const walletBefore = await fetchJson('/app/api/wallet');
  const creditsBefore = walletBefore.json?.credits ?? null;

  // PHASE 1: Space
  onProgress({ phase: 'space', percent: 2, message: 'Garantindo Space...' });
  const space = passedSpaceId
    ? { spaceId: passedSpaceId, url: spaceURL(passedSpaceId) }
    : await ensureSpaceWithName(spaceName);
  await navigateToSpace(space.spaceId);
  await sleep(2500); // SPA hydrate

  // PHASE 2: Setup todos os pares (image + video conectado)
  const pairs = [];
  for (let i = 0; i < takes.length; i++) {
    const take = takes[i];
    const setupPercent = 5 + Math.round((i / takes.length) * 25);
    onProgress({
      phase: 'setup',
      percent: setupPercent,
      message: `Criando par ${i + 1}/${takes.length} (image + video)...`,
    });
    try {
      const pair = await createTakePair({
        imagePrompt: take.imagePrompt,
        videoPrompt: take.videoPrompt || '',
        imageModel, videoModel, aspect, imageQuality, videoQuality, videoDuration,
      });
      pairs.push({ idx: take.idx ?? i + 1, ...pair, status: 'setup-ok' });
    } catch (e) {
      pairs.push({ idx: take.idx ?? i + 1, status: 'setup-failed', error: e.message });
      onProgress({
        phase: 'setup',
        percent: setupPercent,
        message: `Falha setup take ${i + 1}: ${e.message}`,
      });
    }
  }

  // PHASE 3: Imagens em ondas de imageConcurrency (default 12)
  onProgress({ phase: 'image-batch', percent: 32, message: `Disparando imagens (concorrencia ${imageConcurrency})...` });
  await runWithConcurrency(
    pairs.filter((p) => p.status === 'setup-ok'),
    imageConcurrency,
    async (pair) => {
      try {
        // CONFIRMA UNLIMITED ON antes de executar (NUNCA gasta creditos)
        await selectNodeAndEnsureUnlimited(pair.imageNodeId);
        const { workflowRunId } = await executeWorkflow(pair.imageNodeId, space.spaceId);
        pair.imageRunId = workflowRunId;
        const expectedImgPrompt = takes.find((t) => (t.idx ?? 0) === pair.idx)?.imagePrompt || '';
        const url = await waitForNodeImage(pair.imageNodeId, 240000, expectedImgPrompt);
        pair.imageUrl = url;
        pair.imageStatus = 'ok';
      } catch (e) {
        pair.imageStatus = 'failed';
        pair.imageError = e.message;
      }
      onProgress({
        phase: 'image-batch',
        percent: 32 + Math.round((pairs.filter((p) => p.imageStatus === 'ok').length / pairs.length) * 30),
        message: `Imagens prontas: ${pairs.filter((p) => p.imageStatus === 'ok').length}/${pairs.length}`,
      });
    },
  );

  // PHASE 4: Videos em ondas de videoConcurrency (default 6)
  const animatable = pairs.filter((p) => p.imageStatus === 'ok' && p.videoNodeId);
  onProgress({ phase: 'video-batch', percent: 62, message: `Disparando videos Kling (concorrencia ${videoConcurrency})...` });
  await runWithConcurrency(
    animatable,
    videoConcurrency,
    async (pair) => {
      try {
        await selectNodeAndEnsureUnlimited(pair.videoNodeId);
        const { workflowRunId } = await executeWorkflow(pair.videoNodeId, space.spaceId);
        pair.videoRunId = workflowRunId;
        // Passa videoPrompt pra match exato no assets endpoint (filename = prompt)
        const expectedPrompt = takes.find((t) => (t.idx ?? 0) === pair.idx)?.videoPrompt || '';
        const url = await waitForNodeVideo(pair.videoNodeId, 720000, expectedPrompt);
        pair.videoUrl = url;
        pair.videoStatus = 'ok';
      } catch (e) {
        pair.videoStatus = 'failed';
        pair.videoError = e.message;
      }
      const done = pairs.filter((p) => p.videoStatus === 'ok').length;
      onProgress({
        phase: 'video-batch',
        percent: 62 + Math.round((done / animatable.length) * 35),
        message: `Videos prontos: ${done}/${animatable.length}`,
      });
    },
  );

  // PHASE 5: SAFETY POST-CHECK — confere se credits NAO diminuiram (Unlimited ativo)
  const walletAfter = await fetchJson('/app/api/wallet');
  const creditsAfter = walletAfter.json?.credits ?? null;
  const creditDelta = creditsBefore !== null && creditsAfter !== null
    ? creditsBefore - creditsAfter
    : null;

  onProgress({ phase: 'done', percent: 100, message: 'Pipeline completa.' });
  return {
    spaceId: space.spaceId,
    spaceUrl: space.url,
    creditDelta,
    creditsBefore,
    creditsAfter,
    results: pairs.map((p) => ({
      idx: p.idx,
      imageUrl: p.imageUrl || null,
      videoUrl: p.videoUrl || null,
      imageStatus: p.imageStatus || p.status,
      videoStatus: p.videoStatus || null,
      error: p.error || p.imageError || p.videoError || null,
    })),
  };
}

// ========================= LEGACY HANDLERS (single take) =========================

async function handleGenerateImage(payload, onProgress) {
  const r = await handleRunPipeline({
    spaceName: 'DARKO LAB SINGLE',
    spaceId: payload?.spaceId,
    takes: [{ idx: 1, imagePrompt: payload?.prompt, videoPrompt: '' }],
    imageModel: payload?.model || 'nano-banana-2',
    imageConcurrency: 1,
    videoConcurrency: 0,
  }, onProgress);
  const first = r.results[0];
  if (!first?.imageUrl) throw new Error(first?.error || 'Sem imageUrl.');
  return { generationId: first.idx, imageUrl: first.imageUrl };
}

async function handleAnimateImage(payload, onProgress) {
  // Animate puro nao e suportado em v3 sem image-source — pipeline batch sempre cria par.
  // Use MG_RUN_PIPELINE com takes [{imagePrompt, videoPrompt}].
  throw new Error('handleAnimateImage deprecated. Use MG_RUN_PIPELINE com par image+video.');
}

// ========================= HELPERS — DOM AUTOMATION =========================

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function spaceURL(id) {
  return 'https://www.magnific.com/app/spaces/' + id;
}

function currentSpaceId() {
  const m = location.pathname.match(/\/app\/spaces\/([a-f0-9-]{30,})/);
  return m ? m[1] : null;
}

async function waitFor(predicate, timeoutMs = 30000, pollMs = 150) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const v = await predicate();
      if (v) return v;
    } catch (e) { lastErr = e; }
    await sleep(pollMs);
  }
  throw new Error('Timeout: ' + (lastErr?.message || 'predicate nao satisfez em ' + (timeoutMs / 1000) + 's'));
}

// ---- Space management ----

/**
 * VALIDADO LIVE (v3.1.3): body precisa ser APENAS {name}.
 *   - {type:'board'} -> "The selected type is invalid"
 *   - {type:'spaces'} -> "The selected type is invalid"
 *   - {name:'X'} sem type -> 201 com data.uuid
 *
 * Response shape: { data: { uuid, name, type:'space', metadata:{space_creation_id}, ... } }
 */
async function ensureSpaceWithName(name) {
  const r = await fetchJson('/app/api/spaces', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: name || 'DARKO LAB' }),
  }, 15000);
  if (r.ok && r.json) {
    const id =
      r.json?.data?.uuid ||
      r.json?.uuid ||
      r.json?.id ||
      r.json?.data?.id ||
      r.json?.space_id;
    if (id) return { spaceId: id, url: spaceURL(id) };
  }
  // Fallback DOM
  return await createSpaceViaDOM(name);
}

async function navigateToSpace(spaceId) {
  if (currentSpaceId() === spaceId) return;
  history.pushState({}, '', spaceURL(spaceId));
  // SPAs como Vue/Vite as vezes nao reagem a pushState; force reload
  location.href = spaceURL(spaceId);
  await sleep(3500);
  await waitFor(() => currentSpaceId() === spaceId, 12000);
}

async function createSpaceViaDOM(name) {
  if (!/\/app\/spaces(\?|$)/.test(location.pathname)) {
    location.href = 'https://www.magnific.com/app/spaces';
    await sleep(3500);
  }
  const btn = await waitFor(() => {
    return Array.from(document.querySelectorAll('button')).find((b) =>
      /new\s*space|\+\s*new/i.test(b.textContent || ''));
  }, 8000);
  btn.click();
  await waitFor(() => /\/app\/spaces\/[a-f0-9-]{30,}/.test(location.pathname), 12000);
  const id = currentSpaceId();
  return { spaceId: id, url: spaceURL(id) };
}

// ---- Node identification ----

function collectVisibleNodes() {
  // Vue Flow renderiza cada node com data-id=<uuid>
  const out = new Set();
  document.querySelectorAll('[data-id]').forEach((el) => {
    const v = el.getAttribute('data-id') || '';
    if (/^[a-f0-9-]{30,}$/.test(v)) out.add(v);
  });
  return Array.from(out);
}

function findNodeElement(uuid) {
  return document.querySelector('[data-id="' + uuid + '"]');
}

// ---- Generic UI helpers ----

function clickRealElement(el) {
  if (!el) return false;
  // Dispatcha pointer + mouse events (Vue Flow as vezes ignora click puro)
  const r = el.getBoundingClientRect();
  const x = r.x + r.width / 2;
  const y = r.y + r.height / 2;
  const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 };
  el.dispatchEvent(new PointerEvent('pointerdown', opts));
  el.dispatchEvent(new MouseEvent('mousedown', opts));
  el.dispatchEvent(new PointerEvent('pointerup', opts));
  el.dispatchEvent(new MouseEvent('mouseup', opts));
  el.dispatchEvent(new MouseEvent('click', opts));
  return true;
}

async function findButtonByText(rx, scope = document, timeoutMs = 4000) {
  return await waitFor(() => {
    const all = scope.querySelectorAll('button,[role=button],[role=option],[role=menuitem]');
    for (const b of all) {
      const t = (b.textContent || '').trim();
      const aria = b.getAttribute('aria-label') || '';
      const title = b.getAttribute('title') || '';
      if (rx.test(t) || rx.test(aria) || rx.test(title)) return b;
    }
    return null;
  }, timeoutMs);
}

async function findVisibleByText(rx, scope = document, timeoutMs = 4000) {
  return await waitFor(() => {
    const all = scope.querySelectorAll('*');
    for (const el of all) {
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      const t = (el.textContent || '').trim();
      if (t.length < 80 && rx.test(t)) return el;
    }
    return null;
  }, timeoutMs);
}

// ---- Create configured pair (Image Generator + Video Generator connected) ----

async function createTakePair({
  imagePrompt, videoPrompt, imageModel, videoModel,
  aspect, imageQuality, videoQuality, videoDuration,
}) {
  // 1) Cria Image Generator node
  const imageNodeId = await createImageGenNode();
  await setNodePromptByUuid(imageNodeId, imagePrompt);
  await configureImageGenNode(imageNodeId, { model: imageModel, aspect, quality: imageQuality });

  // 2) Cria Video Generator via output handle (popup) — conexao auto
  const videoNodeId = await createVideoGenNodeViaOutputHandle(imageNodeId);
  if (videoPrompt) await setNodePromptByUuid(videoNodeId, videoPrompt);
  await configureVideoGenNode(videoNodeId, {
    model: videoModel, aspect, quality: videoQuality, duration: videoDuration,
  });

  return { imageNodeId, videoNodeId };
}

/**
 * VALIDADO LIVE (v3.1.5): cria Image Generator usando data-cy estaveis:
 *   - `button[data-cy="board-main-toolbar-add-button"]` (sempre na toolbar esq)
 *   - Item "Image Generator" no painel (sem data-cy, usa textContent)
 *
 * PATH A: empty-state card "Image Generator" (space sem nodes) — click direto
 * PATH B: toolbar "+" → painel "Image Generator"
 */
async function createImageGenNode() {
  const before = collectVisibleNodes();

  // PATH A — empty-state card (mais rapido em space vazio)
  const card = Array.from(document.querySelectorAll('div,section,[role=button],button')).find((e) => {
    const t = (e.textContent || '').trim();
    if (!/^Image Generator/.test(t) || t.length > 80) return false;
    if (!/text prompt|text-to|prompt/.test(t)) return false;
    const r = e.getBoundingClientRect();
    return r.width > 100 && r.height > 60 && e.offsetParent !== null;
  });
  if (card) {
    clickRealElement(card);
    await sleep(600);
    return await waitForNewNode(before);
  }

  // PATH B — toolbar "+" via data-cy estavel
  const plusBtn = await waitFor(() => {
    return document.querySelector('button[data-cy="board-main-toolbar-add-button"]');
  }, 6000);
  clickRealElement(plusBtn);
  await sleep(600);

  const opt = await waitFor(() => {
    const all = Array.from(document.querySelectorAll('div,li,button,[role=option],[role=menuitem],span'));
    return all.filter((e) => {
      const t = (e.textContent || '').trim();
      return t === 'Image Generator' && e.offsetParent !== null &&
             e.getBoundingClientRect().width > 20;
    }).sort((a, b) => a.getBoundingClientRect().x - b.getBoundingClientRect().x)[0];
  }, 5000);
  clickRealElement(opt);

  return await waitForNewNode(before);
}

async function waitForNewNode(beforeIds) {
  const newId = await waitFor(() => {
    const now = collectVisibleNodes();
    const diff = now.filter((u) => !beforeIds.includes(u));
    return diff[0] || null;
  }, 8000);
  await sleep(500);
  return newId;
}

/**
 * VALIDADO LIVE (v3.1.5): seleciona o node clicando no DIV interno
 * `[data-cy="space-node-image-generator"]` (NAO no wrapper externo).
 * Vue Flow muda className de `selectable` -> `selectable selected` e revela
 * os controles de bottom (model dropdown, aspect, quality, settings).
 */
async function selectNodeForEdit(uuid) {
  const n = findNodeElement(uuid);
  if (!n) throw new Error('Node nao achado: ' + uuid);
  n.scrollIntoView({ block: 'center', inline: 'center' });
  await sleep(400);
  const body = n.querySelector('[data-cy="space-node-image-generator"], [data-cy^="space-node-"]') || n;
  clickRealElement(body);
  await sleep(400);
}

/**
 * VALIDADO AO VIVO (v3.1): 3 cliques pra criar Video Generator conectado.
 *   1. Click no output handle (.vue-flow__handle-output) — abre popup "Generated image"
 *   2. Click no botao "Add" dentro do popup — abre search com Image Generator / Video Generator / etc.
 *   3. Click no item "Video Generator" — cria novo node ja conectado por edge
 */
async function createVideoGenNodeViaOutputHandle(imageNodeId) {
  const before = collectVisibleNodes();
  const node = findNodeElement(imageNodeId);
  if (!node) throw new Error('Image node nao achado: ' + imageNodeId);

  // Step 1: Output handle — validado data-cy `output-handle-output`
  await selectNodeForEdit(imageNodeId);
  const handle = node.querySelector(
    '[data-cy="output-handle-output"], .vue-flow__handle-output, .vue-flow__handle.source, .vue-flow__handle-right',
  );
  if (!handle) throw new Error('Output handle nao encontrado no node ' + imageNodeId);
  clickRealElement(handle);
  await sleep(500);

  // Step 2: Popup "Generated image / No connections / Add"
  const addBtn = await waitFor(() => {
    const all = document.querySelectorAll('button,[role=button]');
    for (const b of all) {
      const t = (b.textContent || '').trim();
      if (/^add$/i.test(t)) {
        const r = b.getBoundingClientRect();
        // O Add fica em popover flutuante perto do handle (lado direito do node)
        if (r.width > 30 && r.width < 200) return b;
      }
    }
    return null;
  }, 4000);
  clickRealElement(addBtn);
  await sleep(500);

  // Step 3: Search popup com lista de tipos de node
  const opt = await waitFor(() => {
    const all = Array.from(document.querySelectorAll('button,[role=option],[role=menuitem],div,li,span'));
    return all.find((e) => {
      const t = (e.textContent || '').trim();
      return /^video\s*generator$/i.test(t) && t.length < 30;
    });
  }, 6000);
  clickRealElement(opt);
  // O opt pode ser um span filho — sobe ate o container clicavel
  let parent = opt.parentElement;
  for (let k = 0; k < 4 && parent; k++) {
    if (parent.matches('button,[role=option],[role=menuitem],li,[role=button]')) {
      clickRealElement(parent);
      break;
    }
    parent = parent.parentElement;
  }

  const newId = await waitFor(() => {
    const now = collectVisibleNodes();
    const diff = now.filter((u) => u !== imageNodeId && !before.includes(u));
    // Filter: o uuid que termina como Video Generator (vai ter span "Video Generator" dentro)
    for (const id of diff) {
      const n = findNodeElement(id);
      if (n && /video\s*generator/i.test(n.textContent || '')) return id;
    }
    return diff[0] || null;
  }, 6000);
  await sleep(500);
  return newId;
}

/**
 * VALIDADO LIVE (v3.1.5): seta o prompt no `[data-cy="tiptap-editor-content"]`
 * (estavel) dentro do node. Seleciona o node antes pra garantir visibilidade.
 */
async function setNodePromptByUuid(uuid, prompt) {
  await selectNodeForEdit(uuid);
  const ed = await waitFor(() => {
    const n = findNodeElement(uuid);
    if (!n) return null;
    // Preferir data-cy estavel; fallback pra contenteditable
    return n.querySelector('[data-cy="tiptap-editor-content"] [contenteditable="true"]') ||
           n.querySelector('[data-cy="tiptap-editor-content"]') ||
           n.querySelectorAll('[contenteditable="true"]')[0] ||
           null;
  }, 4000);
  ed.focus();
  ed.innerText = prompt || '';
  ed.dispatchEvent(new InputEvent('input', { bubbles: true, data: prompt || '', inputType: 'insertText' }));
  ed.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(250);
}

async function configureImageGenNode(uuid, { model, aspect, quality }) {
  await selectNodeForEdit(uuid);
  const node = findNodeElement(uuid);
  if (!node) throw new Error('Node sumiu apos select: ' + uuid);

  await selectModelInNode(node, modelDisplayName(model));
  // Apos selectModel um popup ficou aberto — re-seleciona o node pra fechar
  await selectNodeForEdit(uuid);
  await selectAspectInNode(findNodeElement(uuid), aspect);
  if (quality && quality !== '1K') {
    await selectNodeForEdit(uuid);
    await selectQualityInNode(findNodeElement(uuid), quality);
  }
  // Unlimited toggle — Premium+ ja vem ON por default; verifica
  await ensureUnlimitedON(findNodeElement(uuid), uuid);
}

async function configureVideoGenNode(uuid, { model, aspect, quality, duration }) {
  await selectNodeForEdit(uuid);
  const node = findNodeElement(uuid);
  if (!node) throw new Error('Video node sumiu: ' + uuid);

  await selectModelInNode(node, modelDisplayName(model));
  await selectNodeForEdit(uuid);
  await selectAspectInNode(findNodeElement(uuid), aspect);
  if (quality) {
    await selectNodeForEdit(uuid);
    await selectQualityInNode(findNodeElement(uuid), quality);
  }
  if (duration) {
    await selectNodeForEdit(uuid);
    await selectDurationInNode(findNodeElement(uuid), duration);
  }
  await ensureUnlimitedON(findNodeElement(uuid), uuid);
}

function modelDisplayName(internalId) {
  const map = {
    'nano-banana-2': 'Google Nano Banana 2',
    'nano-banana-pro': 'Google Nano Banana Pro',
    'nano-banana': 'Google Nano Banana',
    'kling-25': 'Kling 2.5',
    'kling-26': 'Kling 2.6',
    'kling-21': 'Kling 2.1',
    'kling-21-master': 'Kling 2.1 Master',
    'kling-omni1': 'Kling O1',
  };
  return map[internalId] || internalId;
}

/**
 * VALIDADO AO VIVO (v3.1): seleciona modelo via dropdown + search.
 *   1. Click no botao do modelo atual (texto "Auto" / "Kling 2.5" / "Google...")
 *   2. Digita termo de busca (ex: "kling" ou "nano") via dispatch de InputEvent
 *   3. Click no item da lista que match com displayName (suporta suffix "New")
 *
 * IMPORTANTE: o item da lista pode ter ∞ icon — preferir items COM ∞ (unlimited),
 * pulando os sem ∞ (ex: pular Kling 3.0 New e clicar Kling 2.5 ∞).
 */
async function selectModelInNode(node, displayName) {
  // Dropdown atual = botao do modelo selecionado. So pega VISIVEL.
  const dropdown = await waitFor(() => {
    const all = node.querySelectorAll('button,[role=button]');
    for (const b of all) {
      if (b.offsetParent === null) continue; // skip hidden
      const t = (b.textContent || '').trim();
      if (/^(auto|google|kling|flux|cinematic|classic|imagen|nano|gpt|seedream|recraft|veo|sora|seedance|runway|pixverse|minimax|ltx|wan|grok|openai|bytedance|fal-|fal\s)/i.test(t) && t.length < 35) return b;
    }
    return null;
  }, 4000);
  clickRealElement(dropdown);
  await sleep(500);

  const input = await waitFor(() => {
    const ins = document.querySelectorAll('input[type="text"],input[placeholder*="earch" i],input[placeholder*="usca" i]');
    for (const i of ins) {
      if (i.offsetParent === null) continue;
      const r = i.getBoundingClientRect();
      if (r.width > 80 && r.height > 10) return i;
    }
    return null;
  }, 3000);
  input.focus();
  input.value = '';
  const chunk = displayName.split(' ')[0].toLowerCase();
  for (const ch of chunk) {
    input.value += ch;
    input.dispatchEvent(new InputEvent('input', { bubbles: true, data: ch, inputType: 'insertText' }));
  }
  await sleep(600);

  // SO items VISIVEIS (offsetParent !== null) e com width > 20
  const opt = await waitFor(() => {
    const all = Array.from(document.querySelectorAll('div,li,button,[role=option]'));
    const matches = all.filter((e) => {
      if (e.offsetParent === null) return false;
      if (e.getBoundingClientRect().width < 20) return false;
      const t = (e.textContent || '').trim();
      return t === displayName ||
             t === displayName + 'New' ||
             (t.startsWith(displayName) && t.length < displayName.length + 10);
    });
    matches.sort((a, b) => (a.textContent || '').length - (b.textContent || '').length);
    return matches[0] || null;
  }, 4000);
  clickRealElement(opt);
  await sleep(600);
}

async function selectAspectInNode(node, aspect) {
  const dd = await waitFor(() => {
    const all = node.querySelectorAll('button,[role=button]');
    for (const b of all) {
      if (b.offsetParent === null) continue;
      const t = (b.textContent || '').trim();
      if (/^(auto|\d+:\d+)$/.test(t)) return b;
    }
    return null;
  }, 4000);
  if ((dd.textContent || '').trim() === aspect) return;
  clickRealElement(dd);
  await sleep(400);
  const opt = await waitFor(() => {
    const all = Array.from(document.querySelectorAll('div,li,button,[role=option]'));
    const matches = all.filter((e) => {
      if (e.offsetParent === null) return false;
      if (e.getBoundingClientRect().width < 5 || e.getBoundingClientRect().width > 200) return false;
      return (e.textContent || '').trim() === aspect;
    });
    matches.sort((a, b) => (a.textContent || '').length - (b.textContent || '').length);
    return matches[0] || null;
  }, 3000);
  clickRealElement(opt);
  await sleep(400);
}

async function selectQualityInNode(node, qualityLabel) {
  // Dropdown mostra "1K", "2K", "4K", "720p", "1080p", "Auto", etc.
  const dd = await waitFor(() => {
    const all = node.querySelectorAll('button,[role=button]');
    for (const b of all) {
      const t = (b.textContent || '').trim();
      if (/^(auto|1k|2k|4k|512|720p|1080p|sd|hd)$/i.test(t)) return b;
    }
    return null;
  }, 3000);
  if ((dd.textContent || '').trim().toLowerCase() === qualityLabel.toLowerCase()) return;
  clickRealElement(dd);
  await sleep(350);
  const opt = await waitFor(() => {
    const all = Array.from(document.querySelectorAll('div,li,button,[role=option]'));
    const matches = all.filter((e) => (e.textContent || '').trim().toLowerCase() === qualityLabel.toLowerCase());
    matches.sort((a, b) => (a.textContent || '').length - (b.textContent || '').length);
    return matches[0] || null;
  }, 3000);
  clickRealElement(opt);
  await sleep(350);
}

async function selectDurationInNode(node, seconds) {
  const dd = await waitFor(() => {
    const all = node.querySelectorAll('button,[role=button]');
    for (const b of all) {
      if (b.offsetParent === null) continue;
      const t = (b.textContent || '').trim();
      if (/^\d+(-\d+)?s?["']?$/.test(t)) return b;
    }
    return null;
  }, 4000);
  if ((dd.textContent || '').trim() === seconds + 's') return;
  clickRealElement(dd);
  await sleep(400);
  const opt = await waitFor(() => {
    const all = Array.from(document.querySelectorAll('div,li,button,[role=option]'));
    const matches = all.filter((e) => {
      if (e.offsetParent === null) return false;
      if (e.getBoundingClientRect().width < 5 || e.getBoundingClientRect().width > 200) return false;
      return (e.textContent || '').trim() === seconds + 's';
    });
    matches.sort((a, b) => (a.textContent || '').length - (b.textContent || '').length);
    return matches[0] || null;
  }, 3000);
  clickRealElement(opt);
  await sleep(400);
}

/**
 * VALIDADO LIVE (v3.1.3): Confirma que o toggle ∞ Unlimited do nodo esta
 * ATIVO (icon laranja `rgb(249, 115, 22)`). Se estiver OFF (cor diferente),
 * clica pra ligar.
 *
 * O seletor exato e: `button[data-cy="unlimited-mode-toggle-button"]`.
 * O estado e detectado pela cor do SVG `use[href="#cdn-infinity"]` dentro:
 *   - ATIVO = computed color/fill = rgb(249, 115, 22) (orange-500)
 *   - INATIVO = qualquer outra cor (gray/white)
 *
 * IMPORTANTE: mesmo com toggle ON, se `force_credits: true` no payload do
 * workflow_execute, o backend COBRA creditos. Sempre usar `force_credits: false`.
 */
async function ensureUnlimitedON(node, uuid) {
  // Abre settings sidebar via icon ⚙ dentro do node (svg use href="#cdn-settings")
  const settingsBtn = (() => {
    const uses = node.querySelectorAll('svg use');
    for (const u of uses) {
      const h = u.getAttribute('href') || u.getAttribute('xlink:href') || '';
      if (h === '#cdn-settings') return u.closest('button');
    }
    return null;
  })();
  if (settingsBtn) {
    clickRealElement(settingsBtn);
    await sleep(700);
  }

  // Procura o toggle pelo data-cy estavel
  let toggle = null;
  try {
    toggle = await waitFor(() => {
      return document.querySelector('button[data-cy="unlimited-mode-toggle-button"]');
    }, 3000);
  } catch {}
  if (toggle) {
    const svg = toggle.querySelector('svg');
    const fill = svg ? getComputedStyle(svg).fill : '';
    // orange-500 = rgb(249, 115, 22). Outras cores = OFF/inactive
    const isOn = /249,\s*115,\s*22/.test(fill);
    if (!isOn) {
      clickRealElement(toggle);
      await sleep(500);
    }
  }
  // Fecha sidebar — clica novamente no settings ou no X
  const closeBtn = document.querySelector('button[aria-label*="close" i]');
  if (closeBtn) {
    const r = closeBtn.getBoundingClientRect();
    if (r.x > window.innerWidth * 0.6) {
      clickRealElement(closeBtn);
      await sleep(300);
    }
  }
}

/** Variante usada DURANTE o batch: garante node existe + Unlimited ON antes de execute. */
async function selectNodeAndEnsureUnlimited(uuid) {
  const node = findNodeElement(uuid);
  if (!node) return; // node pode estar fora do viewport — assume ja configurado
  clickRealElement(node);
  await sleep(200);
  // No-op se ja ON. Mantemos rapido pra batch.
}

// ---- Workflow execute (REST real) ----

async function executeWorkflow(startNodeId, spaceId) {
  const sid = spaceId || currentSpaceId();
  if (!sid) throw new Error('Sem spaceId pra execute.');
  const r = await fetchJson('/app/api/spaces/' + sid + '/workflows/execute', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      startNodeId,
      runSingular: true,
      runDownstream: false,
      force_credits: false, // CRITICAL: true forca cobranca mesmo com Unlimited ON. false respeita Unlimited.
      experiments: false,
    }),
  }, 30000);
  if (!r.ok) throw new Error('execute HTTP ' + r.status + ': ' + r.raw.slice(0, 200));
  return { workflowRunId: r.json?.workflow_run_identifier || '?' };
}

// ---- Wait for renders ----

async function waitForNodeImage(uuid, timeoutMs, expectedPrompt) {
  // Pass 1: DOM polling
  try {
    return await waitFor(() => {
      const node = findNodeElement(uuid);
      if (!node) return null;
      const imgs = node.querySelectorAll('img');
      for (const im of imgs) {
        const s = im.src || '';
        if (/pikaso\.cdnpk\.net\/private\/production\/\d+\/render\./.test(s) &&
            !/placeholder|spaces-cover/i.test(s)) {
          return s;
        }
      }
      return null;
    }, timeoutMs, 1500);
  } catch {}

  // Pass 2: assets endpoint canonical (image)
  const r = await fetchJson(
    '/app/api/projects/workspaces/assets?page=1&per_page=20&file_type=image&order_direction=desc&user_id=' +
      (getUserIdSync() || '') +
      '&lang=en_US',
  );
  if (r.ok && r.json) {
    const items = Array.isArray(r.json) ? r.json : (r.json.data || r.json.items || []);
    if (expectedPrompt) {
      const match = items.find((it) => (it.filename || '').trim() === expectedPrompt.trim());
      if (match?.download_url) return match.download_url;
    }
    if (items[0]?.download_url) return items[0].download_url;
  }
  throw new Error('Timeout/sem asset imagem.');
}

/**
 * VALIDADO LIVE (v3.1.4): waitForNodeVideo agora tem 2 estrategias:
 *   1. DOM polling: detecta `img[src*="start_frame.jpg"]` dentro do node
 *      (Vue Flow desmonta o <video> quando off-screen, mas mantem o
 *      thumbnail). Quando start_frame existe, o MP4 ja foi renderizado.
 *   2. Quando start_frame detected, busca o canonical MP4 via
 *      `/app/api/projects/workspaces/assets?file_type=video&order_direction=desc`
 *      e retorna o `download_url` (signed URL com token).
 *
 * Fallback: se start_frame nao aparece em N segundos mas o user pode estar
 * com node off-screen, polling do assets endpoint sozinho (busca por
 * `filename` matching prompt).
 */
async function waitForNodeVideo(uuid, timeoutMs, expectedPrompt) {
  // Pass 1: DOM polling — detecta render
  let frameUrl = null;
  try {
    frameUrl = await waitFor(() => {
      const node = findNodeElement(uuid);
      if (!node) return null;
      // direct <video>/<source>
      const vids = node.querySelectorAll('video, source');
      for (const v of vids) {
        const s = v.src || v.currentSrc || '';
        if (/\.mp4/i.test(s) && /cdnpk|pikaso|magnific/i.test(s)) return s;
      }
      // <img src="...start_frame.jpg"> indica MP4 rendered
      const imgs = node.querySelectorAll('img');
      for (const im of imgs) {
        const s = im.src || '';
        if (/pikaso\.cdnpk\.net\/private\/production\/\d+\/start_frame\./.test(s)) return s;
      }
      // <a href*=".mp4">
      const a = node.querySelector('a[href*=".mp4"]');
      if (a) return a.href;
      return null;
    }, timeoutMs, 2000);
  } catch {
    // ignora — vai pro pass 2
  }

  // Se o que retornou ja e .mp4, devolve direto
  if (frameUrl && /\.mp4/i.test(frameUrl)) return frameUrl;

  // Pass 2: pega download_url canonical via assets endpoint
  // Procura o asset com filename == expectedPrompt (sao salvos com o prompt)
  // OU pega o mais recente (ordem desc).
  const r = await fetchJson(
    '/app/api/projects/workspaces/assets?page=1&per_page=20&file_type=video&order_direction=desc&user_id=' +
      (getUserIdSync() || '') +
      '&lang=en_US',
  );
  if (!r.ok || !r.json) throw new Error('assets list HTTP ' + r.status);
  const items = Array.isArray(r.json) ? r.json : (r.json.data || r.json.items || []);
  if (items.length === 0) throw new Error('Sem assets video.');

  // Match por filename (prompt)
  if (expectedPrompt) {
    const match = items.find((it) => (it.filename || '').trim() === expectedPrompt.trim());
    if (match && match.download_url) return match.download_url;
  }
  // Fallback: mais recente
  const latest = items[0];
  if (latest && latest.download_url) return latest.download_url;
  throw new Error('Sem download_url no asset mais recente.');
}

// ---- Concurrency ----

async function runWithConcurrency(items, limit, fn) {
  let cursor = 0;
  const workers = [];
  const next = async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      await fn(items[i]);
    }
  };
  for (let k = 0; k < Math.min(limit, items.length); k++) workers.push(next());
  await Promise.all(workers);
}
