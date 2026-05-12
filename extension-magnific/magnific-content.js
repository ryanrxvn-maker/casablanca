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

const DARKO_MG_VERSION = '3.0.0';
if (window.__darkolab_magnific_loaded__) {
  console.log('[DARKO Magnific Content] JA carregado v=' + window.__darkolab_magnific_version);
} else {
  window.__darkolab_magnific_loaded__ = true;
  window.__darkolab_magnific_version = DARKO_MG_VERSION;
  console.log('[DARKO Magnific Content] online v=' + DARKO_MG_VERSION);
}

// ========================= NETWORK =========================

async function fetchJson(path, opts = {}, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(path, {
      ...opts,
      credentials: 'include',
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
        const url = await waitForNodeImage(pair.imageNodeId, 240000);
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
        const url = await waitForNodeVideo(pair.videoNodeId, 720000);
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

  onProgress({ phase: 'done', percent: 100, message: 'Pipeline completa.' });
  return {
    spaceId: space.spaceId,
    spaceUrl: space.url,
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

async function ensureSpaceWithName(name) {
  // Tenta REST primeiro (rapido)
  const r = await fetchJson('/app/api/spaces', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: name || 'DARKO LAB', type: 'board' }),
  }, 15000);
  if (r.ok && r.json) {
    const id = r.json.id || r.json?.data?.id || r.json?.space_id;
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

async function createImageGenNode() {
  const before = collectVisibleNodes();
  // Clica botao "Image Generator" do toolbar — pode aparecer em sidebar de tools
  // Tenta varios padroes
  const btn = await waitFor(() => {
    const cands = Array.from(document.querySelectorAll('button, [role=button]'));
    return cands.find((b) => {
      const t = ((b.textContent || '') + ' ' + (b.getAttribute('aria-label') || '') + ' ' + (b.getAttribute('title') || '')).toLowerCase();
      return /image\s*generator/.test(t) && !/video/i.test(t);
    });
  }, 8000);
  clickRealElement(btn);
  const newId = await waitFor(() => {
    const now = collectVisibleNodes();
    const diff = now.filter((u) => !before.includes(u));
    return diff[0] || null;
  }, 6000);
  await sleep(400);
  return newId;
}

async function createVideoGenNodeViaOutputHandle(imageNodeId) {
  const before = collectVisibleNodes();
  const node = findNodeElement(imageNodeId);
  if (!node) throw new Error('Image node nao achado: ' + imageNodeId);
  // Output handle: dentro do node, classe vue-flow__handle ou ".handle-source"
  // Identificacao: aria-label "Add" ou classe contendo "output" ou icone "image"
  const handle = node.querySelector('.vue-flow__handle-right, .vue-flow__handle.source, [class*="handle"][class*="source"], [class*="output"]');
  if (handle) {
    clickRealElement(handle);
  } else {
    // Fallback: tenta clicar no botao "+" da direita do node
    const plusBtn = node.querySelector('button[aria-label*="add" i], button[title*="add" i]');
    if (plusBtn) clickRealElement(plusBtn);
  }
  // Aguarda popup com lista (Image Generator / Video Generator / etc.)
  await sleep(500);
  // Click "Video Generator" na lista
  const opt = await waitFor(() => {
    const all = Array.from(document.querySelectorAll('button,[role=option],[role=menuitem],div,li'));
    return all.find((e) => {
      const t = (e.textContent || '').trim();
      if (t.length > 30) return null;
      return /^video\s*generator$/i.test(t);
    });
  }, 6000);
  clickRealElement(opt);
  const newId = await waitFor(() => {
    const now = collectVisibleNodes();
    const diff = now.filter((u) => u !== imageNodeId && !before.includes(u));
    return diff[0] || null;
  }, 6000);
  await sleep(400);
  return newId;
}

async function setNodePromptByUuid(uuid, prompt) {
  const node = findNodeElement(uuid);
  if (!node) throw new Error('Node sumiu pra prompt: ' + uuid);
  // Seleciona o node primeiro (Vue Flow precisa)
  clickRealElement(node);
  await sleep(300);
  // Acha contenteditable dentro do node
  const ed = await waitFor(() => {
    const eds = node.querySelectorAll('[contenteditable="true"]');
    return eds[eds.length - 1] || null;
  }, 3000);
  ed.focus();
  ed.innerText = prompt || '';
  ed.dispatchEvent(new InputEvent('input', { bubbles: true, data: prompt || '', inputType: 'insertText' }));
  ed.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(200);
}

async function configureImageGenNode(uuid, { model, aspect, quality }) {
  const node = findNodeElement(uuid);
  if (!node) throw new Error('Node sumiu pra config: ' + uuid);
  clickRealElement(node);
  await sleep(300);

  // MODEL — click dropdown "Auto" e seleciona via search
  await selectModelInNode(node, modelDisplayName(model));

  // ASPECT — click dropdown e seleciona aspect
  await selectAspectInNode(node, aspect);

  // QUALITY — click dropdown ("1K" e default; mas seta se foi pedido outro)
  if (quality && quality !== '1K') {
    await selectQualityInNode(node, quality);
  }

  // UNLIMITED — abre sidebar settings e confirma ON
  await ensureUnlimitedON(node, uuid);
}

async function configureVideoGenNode(uuid, { model, aspect, quality, duration }) {
  const node = findNodeElement(uuid);
  if (!node) throw new Error('Video node sumiu: ' + uuid);
  clickRealElement(node);
  await sleep(300);

  // MODEL: Kling 2.5
  await selectModelInNode(node, modelDisplayName(model));

  // ASPECT
  await selectAspectInNode(node, aspect);

  // QUALITY (720p)
  if (quality) await selectQualityInNode(node, quality);

  // DURATION (10s)
  if (duration) await selectDurationInNode(node, duration);

  // UNLIMITED
  await ensureUnlimitedON(node, uuid);
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

async function selectModelInNode(node, displayName) {
  // Abre dropdown — botao com texto "Auto" OU nome de algum modelo OU label MODEL
  const dropdown = await waitFor(() => {
    const all = node.querySelectorAll('button,[role=button]');
    for (const b of all) {
      const t = (b.textContent || '').trim();
      // O dropdown atual mostra o modelo selecionado ("Auto" ou nome anterior)
      if (/^(auto|google|kling|flux|cinematic|classic|imagen|nano|gpt|seedream|recraft|veo|sora|seedance|runway|pixverse|minimax|ltx)/i.test(t) && t.length < 30) return b;
    }
    return null;
  }, 3000);
  clickRealElement(dropdown);
  await sleep(400);
  // Busca o input de search no popup
  const input = await waitFor(() => {
    const ins = document.querySelectorAll('input[type="text"],input[placeholder*="earch" i],input[placeholder*="usca" i]');
    for (const i of ins) {
      const r = i.getBoundingClientRect();
      if (r.width > 80 && r.height > 10) return i;
    }
    return null;
  }, 3000);
  input.focus();
  input.value = '';
  // Digite chunk inicial pro filtro funcionar
  const chunk = displayName.split(' ')[0]; // "Google" / "Kling" / "Nano"
  for (const ch of chunk) {
    input.value += ch;
    input.dispatchEvent(new InputEvent('input', { bubbles: true, data: ch, inputType: 'insertText' }));
  }
  await sleep(500);
  // Encontra opcao com o nome
  const opt = await waitFor(() => {
    const all = Array.from(document.querySelectorAll('div,li,button,[role=option]'));
    return all.find((e) => {
      const t = (e.textContent || '').trim();
      // permite suffix "New" — texto pode ser "Google Nano Banana 2New"
      return t === displayName || t === displayName + 'New' || t.startsWith(displayName);
    });
  }, 4000);
  clickRealElement(opt);
  await sleep(500);
}

async function selectAspectInNode(node, aspect) {
  // Dropdown atual mostra ratio tipo "1:1", "16:9", "9:16", "Auto"
  const dd = await waitFor(() => {
    const all = node.querySelectorAll('button,[role=button]');
    for (const b of all) {
      const t = (b.textContent || '').trim();
      if (/^(auto|\d+:\d+)$/.test(t)) return b;
    }
    return null;
  }, 3000);
  clickRealElement(dd);
  await sleep(300);
  const opt = await waitFor(() => {
    const all = Array.from(document.querySelectorAll('div,li,button,[role=option]'));
    return all.find((e) => (e.textContent || '').trim() === aspect);
  }, 3000);
  clickRealElement(opt);
  await sleep(300);
}

async function selectQualityInNode(node, qualityLabel) {
  // Dropdown mostra "1K", "2K", "720p", "1080p" etc.
  const dd = await waitFor(() => {
    const all = node.querySelectorAll('button,[role=button]');
    for (const b of all) {
      const t = (b.textContent || '').trim();
      if (/^(1k|2k|4k|512|720p|1080p|sd|hd)$/i.test(t)) return b;
    }
    return null;
  }, 3000);
  clickRealElement(dd);
  await sleep(300);
  const opt = await waitFor(() => {
    const all = Array.from(document.querySelectorAll('div,li,button,[role=option]'));
    return all.find((e) => (e.textContent || '').trim().toLowerCase() === qualityLabel.toLowerCase());
  }, 3000);
  clickRealElement(opt);
  await sleep(300);
}

async function selectDurationInNode(node, seconds) {
  const dd = await waitFor(() => {
    const all = node.querySelectorAll('button,[role=button]');
    for (const b of all) {
      const t = (b.textContent || '').trim();
      if (/^\d+s$/.test(t)) return b;
    }
    return null;
  }, 3000);
  clickRealElement(dd);
  await sleep(300);
  const opt = await waitFor(() => {
    const all = Array.from(document.querySelectorAll('div,li,button,[role=option]'));
    return all.find((e) => (e.textContent || '').trim() === seconds + 's');
  }, 3000);
  clickRealElement(opt);
  await sleep(300);
}

/** Confirma Unlimited ON. Abre sidebar settings, checa pill "ON"/"OFF" e clica se OFF. */
async function ensureUnlimitedON(node, uuid) {
  // Acha o icone de Settings no node (o ⚙ ao lado da quality)
  const settingsBtn = node.querySelector('button[aria-label*="setting" i], button[title*="setting" i]');
  if (settingsBtn) {
    clickRealElement(settingsBtn);
    await sleep(700);
  }
  // Agora a sidebar tem botao "ON" ou "OFF"
  let toggle = null;
  try {
    toggle = await waitFor(() => {
      const all = document.querySelectorAll('button,[role=button]');
      for (const b of all) {
        const t = (b.textContent || '').trim();
        if (/^on$|^off$/i.test(t)) {
          const r = b.getBoundingClientRect();
          if (r.x > window.innerWidth * 0.6) return b; // sidebar esta no lado direito
        }
      }
      return null;
    }, 3000);
  } catch {}
  if (toggle && /off/i.test(toggle.textContent || '')) {
    clickRealElement(toggle);
    await sleep(500);
  }
  // Fecha sidebar se ela ainda esta aberta
  const closeBtn = document.querySelector('aside button[aria-label*="close" i], aside button[title*="close" i], [class*="sidebar"] button[aria-label*="close" i]');
  if (closeBtn) {
    clickRealElement(closeBtn);
    await sleep(300);
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
      force_credits: true,
      experiments: false,
    }),
  }, 30000);
  if (!r.ok) throw new Error('execute HTTP ' + r.status + ': ' + r.raw.slice(0, 200));
  return { workflowRunId: r.json?.workflow_run_identifier || '?' };
}

// ---- Wait for renders ----

async function waitForNodeImage(uuid, timeoutMs) {
  return await waitFor(() => {
    const node = findNodeElement(uuid);
    if (!node) return null;
    const imgs = node.querySelectorAll('img');
    for (const im of imgs) {
      const s = im.src || '';
      if (/pikaso\.cdnpk\.net\/private\/production\//.test(s) && !/placeholder|spaces-cover/i.test(s)) {
        return s;
      }
    }
    return null;
  }, timeoutMs, 1500);
}

async function waitForNodeVideo(uuid, timeoutMs) {
  return await waitFor(() => {
    const node = findNodeElement(uuid);
    if (!node) return null;
    const vids = node.querySelectorAll('video, source');
    for (const v of vids) {
      const s = v.src || v.currentSrc || '';
      if (/\.mp4/i.test(s) && /cdnpk|pikaso|magnific/i.test(s)) return s;
    }
    const a = node.querySelector('a[href*=".mp4"]');
    if (a) return a.href;
    return null;
  }, timeoutMs, 2000);
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
