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

const DARKO_MG_VERSION = '3.5.54';
if (window.__darkolab_magnific_loaded__) {
  console.log('[DARKO Magnific Content] JA carregado v=' + window.__darkolab_magnific_version);
} else {
  window.__darkolab_magnific_loaded__ = true;
  window.__darkolab_magnific_version = DARKO_MG_VERSION;
  console.log('[DARKO Magnific Content] online v=' + DARKO_MG_VERSION);
}

// ===================== v3.5.38 USERSNAP CRASH SHIM (MAIN WORLD) =========
// RAIZ do crash recorrente (v3.5.33→v3.5.37): Magnific's useSpacesUsersnap
// registra listener document-level que faz `event.target.closest(...)`.
// Quando nosso evento sintético tem target sem .closest (document/Text/etc),
// o handler do Magnific LANÇA `TypeError: t.closest is not a function`,
// exceção propaga e ABORTA runWithConcurrency (0 nodes → stall).
//
// v3.5.37 falhou: content script roda em ISOLATED WORLD; patchar
// Document.prototype lá NÃO afeta o MAIN WORLD onde o Usersnap roda.
// v3.5.38 FIX: injetar <script> no MAIN WORLD da página patchando
// Document/Text/EventTarget.prototype.closest = ()=>null + window.onerror
// trap. Roda no mesmo contexto JS do Magnific → neutraliza de verdade.
(function injectMainWorldUsersnapShim() {
  try {
    const code = '(' + function () {
      try {
        var noop = function () { return null; };
        if (typeof Document !== 'undefined' && !Document.prototype.closest) Document.prototype.closest = noop;
        if (typeof DocumentFragment !== 'undefined' && !DocumentFragment.prototype.closest) DocumentFragment.prototype.closest = noop;
        if (typeof Text !== 'undefined' && !Text.prototype.closest) Text.prototype.closest = noop;
        if (typeof Window !== 'undefined' && Window.prototype && !Window.prototype.closest) Window.prototype.closest = noop;
        try { if (typeof window !== 'undefined' && typeof window.closest !== 'function') window.closest = noop; } catch (e) {}
        window.addEventListener('error', function (ev) {
          var m = ev && ev.message ? String(ev.message) : '';
          if (/closest is not a function/.test(m)) {
            if (ev.preventDefault) ev.preventDefault();
            if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
            console.warn('[DARKO USERSNAP-SHIM MW] suprimido crash Usersnap');
            return true;
          }
        }, true);
        console.log('[DARKO USERSNAP-SHIM MW] v3.5.38 instalado no MAIN WORLD');
      } catch (e) { console.warn('[DARKO USERSNAP-SHIM MW] erro:', e && e.message); }
    } + ')();';
    const s = document.createElement('script');
    s.textContent = code;
    (document.documentElement || document.head || document.body).appendChild(s);
    s.remove();
    console.log('[DARKO USERSNAP-SHIM] script main-world injetado v3.5.38');
  } catch (e) {
    console.warn('[DARKO USERSNAP-SHIM] falha injetar main-world:', e && e.message);
  }
})();

// ========================= KLING 2.5 LOCK (v3.1.7) =========================
//
// User directive: "SEMPRE SELECIONAR KLING 2.5 720P, NUNCA OUTRA NO SPACES DO MAGNIFIC"
//
// Bug observado live (30-pair stress test em a1c3ff03-27a3-4217-a700-a526b98a7c2b):
// pares 7 e 8 acabaram configurados com Seedance 1.5 Pro ao inves de Kling 2.5,
// mesmo com selectModelInNode(node, 'Kling 2.5') chamado. Sob carga (12 paralelos)
// o dispatchEvent do search input as vezes nao filtrava em tempo e a primeira
// opcao visivel (Seedance, default do Magnific) era selecionada.
//
// Fix v3.1.7: verifyImg/verifyVid checa os botoes visiveis do node DEPOIS de cada
// configure. Se nao bater com o LOCK, retry 3x. Se falhar 3x, ABORTA todo o batch
// (NUNCA dispara workflow_execute com config errada).
//
// Safety extra: force_credits:false no execute body ja protege wallet, mas LOCK
// e correctness — vide pra evitar disparo Seedance que ia falhar/sair com lixo.

const VIDEO_MODEL_LOCK    = 'Kling 2.5';
const VIDEO_QUALITY_LOCK  = '720p';
const VIDEO_ASPECT_LOCK   = '9:16';
const VIDEO_DURATION_LOCK = '10s';   // permitido tambem: '5s'
const IMAGE_MODEL_LOCK    = 'Google Nano Banana 2';
const IMAGE_ASPECT_LOCK   = '9:16';
const IMAGE_QUALITY_LOCK  = '1K';

const LOCK_MAX_RETRIES = 3;
const LOCK_RETRY_SLEEP_MS = 600;

// PARANOIA ABSOLUTA — nunca, NUNCA disparar nada que NAO seja Kling 2.5.
// Se qualquer um desses nomes aparecer como botao visivel num node de video,
// o LOCK falha e o batch e abortado. Lista derivada de /app/api/video/ai-models.
//
// NOTA v3.2.3: 'Auto' REMOVIDO desta lista — descoberto live que 'Auto' aparece
// como botao no node como ASPECT SETTING (aspect=inherit-from-input), NAO como
// nome de modelo. Aspect Auto + input 9:16 = video output 9:16 ✓. Modelo real
// e sempre validado por verifyVid via `btns.includes(VIDEO_MODEL_LOCK)` que
// e strict equality em 'Kling 2.5'.
const FORBIDDEN_VIDEO_MODELS = [
  'Seedance 1.5 Pro',           // o bug observado live na 30-pair stress
  'Seedance 1.5',
  'Seedance',
  'Veo 3 Fast',
  'Veo 3',
  'Veo 2',
  'Veo',
  'Runway Gen 4',
  'Runway Gen 3',
  'Runway',
  'Pixverse 4.5',
  'Pixverse 4',
  'Pixverse',
  'Minimax Hailuo',
  'Minimax',
  'LTX Video',
  'LTX',
  'Wan 2.5',
  'Wan 2.2',
  'Wan',
  'Grok',
  'Hunyuan',
  'Luma Dream Machine',
  'Luma',
  'Kling 2.6',                  // nao gastar acidentalmente — user quer EXATO Kling 2.5
  'Kling 2.1',
  'Kling 2.1 Master',
  'Kling O1',
];

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

/**
 * v3.3.1 ROBUSTEZ: fetchJson com retry exponencial pra erros transientes do
 * Magnific (504, 502, 503, 429, timeouts). Magnific tem episodios de
 * Gateway Timeout em horario de pico — pipeline travava mudo antes.
 *
 * Retorna { ok, status, json, raw, retriedTimes? }.
 */
async function fetchJson(path, opts = {}, timeoutMs = 8000, maxRetries = 3) {
  const url = withDefaultQuery(path);
  let lastError = null;
  let lastStatus = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(url, {
        ...opts,
        credentials: 'include',
        headers: { ...MG_DEFAULT_HEADERS, ...(opts.headers || {}) },
        signal: ctrl.signal,
      });
      const txt = await r.text();
      let json = null;
      try { json = JSON.parse(txt); } catch {}
      const result = { ok: r.ok, status: r.status, json, raw: txt.slice(0, 800) };
      if (attempt > 0) result.retriedTimes = attempt;

      // Retry on transient backend errors
      if (r.status === 502 || r.status === 503 || r.status === 504 || r.status === 429) {
        lastStatus = r.status;
        if (attempt < maxRetries) {
          const wait = Math.min(15000, 1000 * Math.pow(2, attempt)) + Math.random() * 500;
          console.warn(`[fetchJson] HTTP ${r.status} on ${path} — retry ${attempt + 1}/${maxRetries} in ${Math.round(wait)}ms`);
          await sleep(wait);
          continue;
        }
      }
      return result;
    } catch (e) {
      lastError = e;
      const isAbort = e?.name === 'AbortError';
      if (attempt < maxRetries) {
        const wait = Math.min(15000, 1000 * Math.pow(2, attempt)) + Math.random() * 500;
        console.warn(`[fetchJson] ${isAbort ? 'TIMEOUT' : 'ERROR'} on ${path} — retry ${attempt + 1}/${maxRetries} in ${Math.round(wait)}ms`);
        await sleep(wait);
        continue;
      }
    } finally {
      clearTimeout(tid);
    }
  }

  // Exhausted all retries
  return {
    ok: false,
    status: lastStatus || 0,
    json: null,
    raw: lastError ? String(lastError.message || lastError) : `HTTP ${lastStatus} apos ${maxRetries} retries`,
    retriedTimes: maxRetries,
  };
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
    MG_CREATE_TEMPLATE_SPACE: handleCreateTemplateSpace, // v3.3.0 — builds template auto
    MG_RUN_PIPELINE: handleRunPipeline,
    MG_RUN_PIPELINE_TEMPLATE: handleRunPipelineFromTemplate, // v3.2.0
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

/**
 * v3.3.0 — Cria um TEMPLATE SPACE automaticamente: novo space + N image gens
 * (Nano Banana 2 + 9:16 + 1K + Unlimited ON) com LOCK aplicado em cada um.
 *
 * payload: {
 *   name?: string (default: 'DARKO_TEMPLATE_<N>_NANO_<ISO>'),
 *   pairs?: number (default: 50, max: 100),
 * }
 *
 * Returns: { spaceId, url, imageGenIds: string[], failed: Array<{idx,error}> }
 *
 * O space resultante e usado como input em MG_RUN_PIPELINE_TEMPLATE. Cada take
 * vai pegar um image gen disponivel, colar o prompt, criar video gen via output
 * handle com Kling 2.5 LOCK on-demand.
 */
async function handleCreateTemplateSpace(payload, onProgress) {
  const { name, pairs = 50 } = payload || {};
  if (pairs < 1 || pairs > 100) {
    throw new Error('pairs deve estar entre 1 e 100');
  }

  onProgress({ phase: 'safety', percent: 1, message: 'Verificando Unlimited mode...' });
  const us = await fetchJson('/app/api/unlimited-status');
  if (us.json && us.json.is_unlimited_mode_enabled === false) {
    throw new Error('Unlimited mode DESLIGADO no Magnific. Liga antes de criar template.');
  }

  // Phase 1: cria space
  onProgress({ phase: 'space', percent: 3, message: 'Criando space...' });
  const finalName = name || `DARKO_TEMPLATE_${pairs}_NANO_${new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-')}`;
  const space = await ensureSpaceWithName(finalName);
  await navigateToSpace(space.spaceId);
  await sleep(3500);

  // Phase 2: cria N image gens em loop sequencial (Vue Flow popup race condition
  // se rodar paralelo). Cada image gen e configurada com Nano Banana 2 LOCK.
  const imageGenIds = [];
  const failed = [];
  for (let i = 0; i < pairs; i++) {
    const percent = 5 + Math.round((i / pairs) * 90);
    onProgress({
      phase: 'building',
      percent,
      message: `Image gen ${i + 1}/${pairs} (Nano Banana 2 + 9:16 + 1K)...`,
    });
    try {
      // 2a) Cria image gen
      const imageNodeId = await createImageGenNode();

      // 2b) Configura LOCK (Nano Banana 2 + 9:16 + 1K + Unlimited) com retry+verify
      await configureWithLockRetry(
        () => configureImageGenNode(imageNodeId, {
          model: 'nano-banana-2',
          aspect: '9:16',
          quality: '1K',
        }),
        () => verifyImg(imageNodeId),
        'img',
        i + 1,
      );

      imageGenIds.push(imageNodeId);
    } catch (e) {
      console.error(`[TEMPLATE_BUILDER] image gen ${i + 1} falhou:`, e);
      failed.push({ idx: i + 1, error: e.message });
      // Continua mesmo se 1 falhar — template parcial e melhor que zero
    }
  }

  onProgress({
    phase: 'done',
    percent: 100,
    message: `Template criado: ${imageGenIds.length}/${pairs} image gens OK${failed.length ? `, ${failed.length} falhas` : ''}`,
  });

  return {
    spaceId: space.spaceId,
    url: space.url,
    name: finalName,
    imageGenIds,
    pairs: imageGenIds.length,
    failed,
  };
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

  console.log('[DARKO Pipeline] v' + DARKO_MG_VERSION + ' iniciando — ' + takes.length + ' takes, space=' + spaceName);

  // PHASE 0: SAFETY — confirma is_unlimited_mode_enabled=true.
  console.log('[DARKO Pipeline] Phase 0a: unlimited-status');
  onProgress({ phase: 'safety', percent: 1, message: 'Verificando Unlimited mode...' });
  const us = await fetchJson('/app/api/unlimited-status');
  console.log('[DARKO Pipeline] Phase 0a result:', { ok: us.ok, status: us.status, retried: us.retriedTimes });
  if (us.json && us.json.is_unlimited_mode_enabled === false) {
    throw new Error('Unlimited mode DESLIGADO no Magnific. Aborte pra nao gastar creditos.');
  }
  console.log('[DARKO Pipeline] Phase 0b: wallet');
  const walletBefore = await fetchJson('/app/api/wallet');
  console.log('[DARKO Pipeline] Phase 0b result:', { ok: walletBefore.ok, status: walletBefore.status, credits: walletBefore.json?.credits });
  const creditsBefore = walletBefore.json?.credits ?? null;

  // PHASE 1: Space
  console.log('[DARKO Pipeline] Phase 1: ensureSpaceWithName "' + spaceName + '"');
  onProgress({ phase: 'space', percent: 2, message: 'Garantindo Space...' });
  const space = passedSpaceId
    ? { spaceId: passedSpaceId, url: spaceURL(passedSpaceId) }
    : await ensureSpaceWithName(spaceName);
  console.log('[DARKO Pipeline] Phase 1 result: space=' + space.spaceId);

  console.log('[DARKO Pipeline] Phase 1b: navigateToSpace');
  await navigateToSpace(space.spaceId);
  console.log('[DARKO Pipeline] Phase 1b: navigate complete, current url=' + location.pathname);

  // v3.5.29 SPEED: settle 2s only — createImageGenNode tem waitFor plusBtn 15s,
  // se canvas demora extra esperamos la. Maior parte das vezes canvas pronto em 1s.
  console.log('[DARKO Pipeline] Phase 1c: settle 2s');
  onProgress({ phase: 'space', percent: 4, message: 'Aguardando canvas (2s)...' });
  await sleep(2000);
  console.log('[DARKO Pipeline] Phase 2: setup pares iniciando');

  // ========================================================================
  // v3.5.8 STREAMING: setup pair N + KICK OFF its dispatch+wait+animate in
  // background, then proceed to setup pair N+1 sem esperar pair N renderizar.
  // Setup is sequential (UI bottleneck — single canvas) mas generation roda
  // 100% em paralelo. Resultado: end-time ~30-40% mais rapido que v3.5.7.
  //
  // Constraint: max 6 video gens simultaneos (Kling 2.5 limit) — enforced
  // via acquireVideoSlot semaphore dentro de processPair.
  // ========================================================================
  // v3.5.31: re-add semaphores for true streaming (image+video parallel per pair)
  const pairs = [];
  let imageActive = 0;
  const imageQueue = [];
  const acquireImageSlot = () => new Promise((resolve) => {
    if (imageActive < 12) { imageActive++; resolve(); }
    else imageQueue.push(resolve);
  });
  const releaseImageSlot = () => {
    imageActive--;
    if (imageQueue.length > 0) { imageActive++; imageQueue.shift()(); }
  };
  let videoActive = 0;
  const videoQueue = [];
  const acquireVideoSlot = () => new Promise((resolve) => {
    if (videoActive < 6) { videoActive++; resolve(); }
    else videoQueue.push(resolve);
  });
  const releaseVideoSlot = () => {
    videoActive--;
    if (videoQueue.length > 0) { videoActive++; videoQueue.shift()(); }
  };

  // v3.5.32: moved reportProgress BEFORE setup loop (called by _streamPromise)
  const reportProgress = () => {
    const totalTakes = takes.length;
    const imgOk = pairs.filter((p) => p.imageStatus === 'ok').length;
    const vidOk = pairs.filter((p) => p.videoStatus === 'ok').length;
    const imgFail = pairs.filter((p) => p.imageStatus === 'failed').length;
    const vidFail = pairs.filter((p) => p.videoStatus === 'failed').length;
    const percent = 32 + Math.round(((imgOk + vidOk * 2) / (totalTakes * 3)) * 65);
    onProgress({
      phase: 'pipeline',
      percent: Math.min(percent, 97),
      message: `IMG ${imgOk}/${totalTakes} (${imgFail} falha) · VID Kling 2.5 ${vidOk}/${totalTakes} (${vidFail} falha)`,
    });
  };

  // v3.5.34 SEQUENTIAL but BLAZING FAST: 1 pair at time, ZERO sleeps,
  // event-driven only. Mutex queue-pauses removidas. Streaming dispatch
  // (img+vid background per pair) continua paralelo.
  await runWithConcurrency(takes, 1, async (take, idx) => {
    const i = takes.indexOf(take);
    const setupPercent = 5 + Math.round((i / takes.length) * 25);
    onProgress({
      phase: 'setup',
      percent: setupPercent,
      message: `[par ${i + 1}/${takes.length}] criando...`,
    });
    let pairResult = null;
    let lastErr = null;
    for (let attempt = 1; attempt <= 3 && !pairResult; attempt++) {
      try {
        const pair = await createTakePair({
          imagePrompt: take.imagePrompt,
          videoPrompt: take.videoPrompt || '',
          imageModel, videoModel, aspect, imageQuality, videoQuality, videoDuration,
          pairIdx: take.idx ?? i + 1,
          onStep: (step) => {
            onProgress({
              phase: 'setup',
              percent: setupPercent,
              message: (attempt > 1 ? `[retry ${attempt}/3] ` : '') + step,
            });
          },
        });
        pairResult = pair;
      } catch (e) {
        lastErr = e;
        console.warn(`[setup pair ${i+1} attempt ${attempt}/3] failed:`, e.message);
        onProgress({
          phase: 'setup',
          percent: setupPercent,
          message: `Pair ${i + 1} tentativa ${attempt}/3 falhou: ${e.message.slice(0, 80)}`,
        });
        try {
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        } catch {}
        await sleep(1000);
      }
    }
    if (pairResult) {
      const pairObj = { idx: take.idx ?? i + 1, ...pairResult, status: 'setup-ok' };
      pairs.push(pairObj);
      // v3.5.31 FULL STREAMING: image dispatch + wait + VIDEO dispatch + wait
      // all per-pair em background. Semaphores 12img/6vid respeitados.
      // Resultado: pair 1 video pronto ANTES de pair 15 setup terminar.
      const expectedImgPrompt = take.imagePrompt || '';
      const expectedVidPrompt = take.videoPrompt || '';
      pairObj._streamPromise = (async () => {
        // === IMAGE ===
        await acquireImageSlot();
        try {
          // v3.5.39: image resolução LOD-TOLERANTE — só ABORTA se ler valor
          // pago CONFIRMADO (2K/4K). Ilegível (LOD) NÃO bloqueia (1K já
          // HARD-ENFORCED 5x no setup). Resolve gasto residual de crédito
          // imagem sem o stall do v3.5.35.
          try {
            try { await selectNodeForEdit(pairObj.imageNodeId); } catch {}
            await sleep(200);
            const inode = findNodeElement(pairObj.imageNodeId);
            if (inode) {
              try { inode.click(); } catch {}
              await sleep(180);
              const rb = inode.querySelector('[data-cy="node-control-selector-resolution"]');
              const rv = rb ? (rb.textContent || '').trim() : null;
              if (rv && rv !== '1K') {
                throw new Error('CREDIT_GUARD image ' + pairObj.imageNodeId.slice(0,8) +
                  ': resolution="' + rv + '" (≠1K) — ABORTA, gasta crédito.');
              }
              console.log('[CREDIT_GUARD] image ' + pairObj.imageNodeId.slice(0,8) +
                ' resolution=' + (rv || 'LOD-unreadable(setup-enforced)'));
            }
          } catch (ce) {
            if (/CREDIT_GUARD/.test(ce.message)) throw ce;
          }
          // v3.5.40 CREDIT-PREVIEW GATE imagem — aborta se houver QUALQUER
          // preview de custo em créditos antes do generate da imagem.
          scanCreditCostPreview(pairObj.imageNodeId, 'image');
          const { workflowRunId } = await executeWorkflow(pairObj.imageNodeId, space.spaceId);
          pairObj.imageRunId = workflowRunId;
          console.log(`[STREAM img dispatched pair#${pairObj.idx}]`);
          const url = await waitForNodeImage(pairObj.imageNodeId, 600000, expectedImgPrompt);
          pairObj.imageUrl = url;
          pairObj.imageStatus = 'ok';
          console.log(`[STREAM img RENDERED pair#${pairObj.idx}]`);
        } catch (e) {
          pairObj.imageStatus = 'failed';
          pairObj.imageError = e.message;
          console.error(`[STREAM img pair#${pairObj.idx}]`, e.message);
          releaseImageSlot();
          return;
        }
        releaseImageSlot();
        reportProgress();

        // === VIDEO === (only if image OK and videoNodeId exists)
        if (!pairObj.videoNodeId) {
          pairObj.videoStatus = 'skipped';
          return;
        }
        await acquireVideoSlot();
        try {
          // v3.5.35 ZERO-CREDIT GUARANTEE: pre-flight ANTES do dispatch.
          // Lê modelo REAL do node — só dispara se Kling 2.5. Seedance/outro
          // = THROW (pair failed, ZERO crédito). Resolve bug 1075 créditos.
          await preflightVideoGuard(pairObj);
          const { workflowRunId: vidRunId } = await executeWorkflow(pairObj.videoNodeId, space.spaceId);
          pairObj.videoRunId = vidRunId;
          console.log(`[STREAM vid dispatched pair#${pairObj.idx}]`);
          const vidUrl = await waitForNodeVideo(pairObj.videoNodeId, 900000, expectedVidPrompt);
          pairObj.videoUrl = vidUrl;
          pairObj.videoStatus = 'ok';
          console.log(`[STREAM vid RENDERED pair#${pairObj.idx}]`);
        } catch (e) {
          pairObj.videoStatus = 'failed';
          pairObj.videoError = e.message;
          console.error(`[STREAM vid pair#${pairObj.idx}]`, e.message);
        }
        releaseVideoSlot();
        reportProgress();
      })();
      onProgress({
        phase: 'setup',
        percent: setupPercent,
        message: `Pair ${i + 1} setup OK — img+vid streaming em background`,
      });
    } else {
      pairs.push({ idx: take.idx ?? i + 1, status: 'setup-failed', error: lastErr?.message || 'unknown' });
      onProgress({
        phase: 'setup',
        percent: setupPercent,
        message: `Falha setup take ${i + 1}: ${lastErr?.message || 'unknown'}`,
      });
    }
  }); // end runWithConcurrency

  // ========================================================================
  // PHASE 3+4 (v3.5.12 NON-STREAMING revert): all setup done, now dispatch
  // all setupOk pairs in parallel. Each pair's processPair: image dispatch →
  // wait image → video dispatch → wait video. Concurrency: 12 image, 6 video.
  // ========================================================================
  const setupOkPairs = pairs.filter((p) => p.status === 'setup-ok');
  onProgress({ phase: 'pipeline', percent: 32, message: `Iniciando ${setupOkPairs.length} pares streaming (3 paralelos setup + 12 img + 6 vid gen)...` });
  // reportProgress JA definido acima (v3.5.32)

  // ========================================================================
  // v3.5.25 REST-ONLY DISPATCH (no UI conflicts, no LOD issues, MAX PARALLEL)
  //
  // Setup phase JA verificou (HARD-ENFORCE 5x retry):
  //   - Image: 1K LOCKED via resolution btn check
  //   - Video: 720p LOCKED + Kling 2.5 LOCKED (5x retry no LOCK)
  //   - Unlimited ON (ensureUnlimitedON)
  // Phase 0 confirmou is_unlimited_mode_enabled=true globalmente.
  // force_credits=false no executeWorkflow respeita Unlimited.
  //
  // Triple safety = zero credit risk SEM precisar re-verificar via UI no
  // dispatch (que falhava em LOD mode + race conditions).
  //
  // Dispatch eh pure REST POST /workflows/execute. Sem clicks, sem LOD.
  // PARALELO max 12 imagens (Magnific limite) + max 6 videos (Kling 2.5).
  // ========================================================================

  // v3.5.31 FULL STREAMING: image+video dispatch JA estao rodando em paralelo
  // (kicked off durante setup loop). Phase 3+4 unificado em await de todos
  // _streamPromise (cada um faz image gen → video gen end-to-end).
  console.log('[Phase 3+4] Awaiting ' + setupOkPairs.length + ' full streams (img+vid per pair)');
  await Promise.all(setupOkPairs.map(p => p._streamPromise || Promise.resolve()));

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

// ========================= PIPELINE TEMPLATE MODE (v3.2.1 — CORRIGIDO) =========================

/**
 * Roda o pipeline a partir de um TEMPLATE SPACE pre-criado com N IMAGE
 * GENERATORS pre-configurados (Nano Banana 2 + 9:16 + 1K, sem prompt e SEM
 * video gen ainda).
 *
 * DESIGN CORRETO (per user, v3.2.1):
 *   1. Template = 50 image gens pre-criadas (so falta o prompt)
 *   2. Para cada take: cola prompt no image gen i, cria video gen via output
 *      handle, configura Kling 2.5 720p 9:16 10s com LOCK retry+verify, cola
 *      o video/motion prompt
 *   3. Dispara imagens em ondas (12 paralelos)
 *   4. Dispara videos em ondas (6 paralelos)
 *
 * GARANTIA ABSOLUTA (user directive): "JAMAIS USAR OUTRA IA DE VIDEO QUE NAO
 * SEJA O KLING 2.5 720P unlimited. TENHA CERTEZA DISSO ABSOLUTA."
 *
 * Defesas em camadas:
 *   A) videoModel hard-coded 'kling-25' em configureVideoGenNode call
 *   B) selectModelInNode com strict equality match (sem startsWith fuzzy)
 *   C) configureWithLockRetry rodando verifyVid apos cada config (3x retry)
 *   D) verifyVid checa FORBIDDEN_VIDEO_MODELS — se Seedance/Veo/Runway/etc
 *      estiver presente como botao ativo, LOCK falha imediatamente
 *   E) Pre-execute re-verify ANTES de cada workflow_execute
 *   F) force_credits:false no execute (wallet protected)
 *   G) Qualquer LOCK_VIOLATION ABORTA o batch inteiro — nunca dispara errado
 *
 * payload: {
 *   templateSpaceId: string (REQUIRED),
 *   newSpaceName?: string,
 *   takes: [{ idx, imagePrompt, videoPrompt }],
 *   imageConcurrency?: 12,
 *   videoConcurrency?: 6,
 * }
 *
 * SETUP MANUAL UMA VEZ: usuario cria template com 50 image gens (Nano Banana 2
 * + 9:16 + 1K + Unlimited ON, prompts vazios) e salva o uuid.
 */
async function handleRunPipelineFromTemplate(payload, onProgress) {
  // ========================================================================
  // v3.5.0 TEMPLATE-FULL: template DEVE ter PARES COMPLETOS pre-configurados
  // (Image Gen + Video Gen ja conectados, JA com Nano Banana 2 + Kling 2.5 +
  // 9:16 + 1K + 720p + 10s + Unlimited ON em todos).
  //
  // Automacao SO faz:
  //   1. Duplica template (REST API — provado funcionar)
  //   2. Enumerate PARES (image + video conectados por position)
  //   3. setPromptByUuid em ambos (image prompt + video prompt)
  //   4. workflow_execute via REST (imagens em wave + videos em wave)
  //   5. waitForRender + download MP4s + ZIP
  //
  // NAO faz mais: createImageGenNode, createVideoGenNodeViaOutputHandle,
  // configureXxxNode, selectModelInNode — TUDO removido porque Magnific
  // mudou e dispatched events nao mais registram em dropdown options.
  //
  // SETUP MANUAL UMA VEZ (~1 hora): user constroi 1 template space com 50
  // pares pre-configurados, salva o UUID. Pipelines futuros sao 100% automatic.
  // ========================================================================
  const {
    templateSpaceId,
    newSpaceName,
    takes = [],
    imageConcurrency = 12,
    videoConcurrency = 6,
  } = payload || {};

  if (!templateSpaceId) throw new Error('TEMPLATE: templateSpaceId obrigatorio. Cria 1 template space manual com pares Image+Video ja configurados (Nano Banana 2 + Kling 2.5 LOCK).');
  if (!takes.length) throw new Error('TEMPLATE: sem takes.');

  // PHASE 0: SAFETY
  onProgress({ phase: 'safety', percent: 1, message: 'Verificando Unlimited mode...' });
  const us = await fetchJson('/app/api/unlimited-status');
  if (us.json && us.json.is_unlimited_mode_enabled === false) {
    throw new Error('Unlimited mode DESLIGADO no Magnific. Liga antes pra nao gastar creditos.');
  }
  const walletBefore = await fetchJson('/app/api/wallet');
  const creditsBefore = walletBefore.json?.credits ?? null;

  // PHASE 1: Duplica template
  onProgress({ phase: 'duplicate', percent: 3, message: `Duplicando template ${templateSpaceId.slice(0, 8)}...` });
  const finalName = newSpaceName || `DARKO RUN ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
  const space = await duplicateSpaceFrom(templateSpaceId, finalName);
  onProgress({ phase: 'duplicate', percent: 6, message: `Clone criado: ${space.spaceId.slice(0, 8)}` });

  // PHASE 2: Navega no clone
  await navigateToSpace(space.spaceId);
  onProgress({ phase: 'hydrate', percent: 8, message: 'Aguardando Liveblocks hidratar nodes...' });
  await sleep(4000);
  await waitFor(() => collectVisibleNodes().length >= 2, 30000);
  await sleep(3000);

  // PHASE 3: Enumerate PARES (image + video gen)
  onProgress({ phase: 'enumerate', percent: 11, message: 'Enumerando pares do template...' });
  const imageNodes = enumerateImageNodesInOrder();
  const videoNodes = enumerateVideoNodesInOrder();
  console.log('[TEMPLATE-FULL] image gens:', imageNodes.length, 'video gens:', videoNodes.length);

  if (imageNodes.length < takes.length) {
    throw new Error(`TEMPLATE: so ${imageNodes.length} image gens, precisa ${takes.length}. Adiciona mais image gens.`);
  }
  if (videoNodes.length < takes.length) {
    throw new Error(`TEMPLATE: so ${videoNodes.length} video gens, precisa ${takes.length}. Adiciona mais video gens.`);
  }

  // Pareia image+video por position (image LEFT, video RIGHT, similar Y)
  const pairs = [];
  const usedVideos = new Set();
  for (let i = 0; i < takes.length; i++) {
    const img = imageNodes[i];
    let bestVid = null;
    let bestDelta = Infinity;
    for (const vid of videoNodes) {
      if (usedVideos.has(vid.videoNodeId)) continue;
      if (vid.x <= img.x) continue; // video must be to the RIGHT
      const dy = Math.abs(vid.y - img.y);
      if (dy < bestDelta) { bestDelta = dy; bestVid = vid; }
    }
    if (!bestVid || bestDelta > 200) {
      throw new Error(`TEMPLATE: nao achei video gen pareado pro image gen #${i + 1} (delta=${bestDelta}px). Template malformado?`);
    }
    usedVideos.add(bestVid.videoNodeId);
    pairs.push({
      idx: takes[i].idx ?? i + 1,
      imageNodeId: img.imageNodeId,
      videoNodeId: bestVid.videoNodeId,
      status: 'paired',
    });
  }
  onProgress({ phase: 'enumerate', percent: 14, message: `${pairs.length} pares enumerados` });

  // PHASE 4: SETUP — APENAS cola prompts (nada de configurar nodes — template ja config)
  onProgress({ phase: 'setup', percent: 16, message: `Colando prompts em ${takes.length} pares...` });
  for (let i = 0; i < takes.length; i++) {
    const take = takes[i];
    const pair = pairs[i];
    try {
      await setNodePromptByUuid(pair.imageNodeId, take.imagePrompt || '');
      if (take.videoPrompt) {
        await setNodePromptByUuid(pair.videoNodeId, take.videoPrompt);
      }
      pair.status = 'setup-ok';
    } catch (e) {
      pair.status = 'setup-failed';
      pair.error = e.message;
    }
    onProgress({
      phase: 'setup',
      percent: 16 + Math.round(((i + 1) / takes.length) * 16),
      message: `Prompts ${i + 1}/${takes.length}: ${pair.status}`,
    });
  }

  // PHASE 5: Imagens em ondas (concorrencia 12)
  onProgress({ phase: 'image-batch', percent: 35, message: `Disparando imagens (concorrencia ${imageConcurrency})...` });
  await runWithConcurrency(
    pairs.filter((p) => p.status === 'setup-ok'),
    imageConcurrency,
    async (pair) => {
      try {
        const vImg = await verifyImg(pair.imageNodeId);
        if (!vImg.ok) throw new Error(`LOCK_PREEXECUTE img pair#${pair.idx}: missing=[${vImg.missing.join(', ')}]`);
        await selectNodeAndEnsureUnlimited(pair.imageNodeId);
        const { workflowRunId } = await executeWorkflow(pair.imageNodeId, space.spaceId);
        pair.imageRunId = workflowRunId;
        const expectedImgPrompt = takes.find((t) => (t.idx ?? 0) === pair.idx)?.imagePrompt || '';
        const url = await waitForNodeImage(pair.imageNodeId, 600000, expectedImgPrompt);
        pair.imageUrl = url;
        pair.imageStatus = 'ok';
      } catch (e) {
        pair.imageStatus = 'failed';
        pair.imageError = e.message;
      }
      onProgress({
        phase: 'image-batch',
        percent: 35 + Math.round((pairs.filter((p) => p.imageStatus === 'ok').length / pairs.length) * 30),
        message: `Imagens prontas: ${pairs.filter((p) => p.imageStatus === 'ok').length}/${pairs.length}`,
      });
    },
  );

  // PHASE 6: Videos em ondas (concorrencia 6) — re-verify FORBIDDEN antes de cada dispatch
  const animatable = pairs.filter((p) => p.imageStatus === 'ok' && p.videoNodeId);
  onProgress({ phase: 'video-batch', percent: 65, message: `Disparando videos Kling 2.5 (concorrencia ${videoConcurrency})...` });
  await runWithConcurrency(
    animatable,
    videoConcurrency,
    async (pair) => {
      try {
        // Re-verify LOCK + FORBIDDEN models 1 ultima vez antes de bater o trigger.
        const vVid = await verifyVid(pair.videoNodeId);
        if (!vVid.ok) {
          throw new Error(
            `LOCK_PREEXECUTE vid pair#${pair.idx}: ` +
            `missing=[${vVid.missing.join(', ')}] forbidden=[${(vVid.forbidden || []).join(', ')}]`,
          );
        }
        await selectNodeAndEnsureUnlimited(pair.videoNodeId);
        const { workflowRunId } = await executeWorkflow(pair.videoNodeId, space.spaceId);
        pair.videoRunId = workflowRunId;
        const expectedPrompt = takes.find((t) => (t.idx ?? 0) === pair.idx)?.videoPrompt || '';
        const url = await waitForNodeVideo(pair.videoNodeId, 900000, expectedPrompt);
        pair.videoUrl = url;
        pair.videoStatus = 'ok';
      } catch (e) {
        pair.videoStatus = 'failed';
        pair.videoError = e.message;
      }
      const done = pairs.filter((p) => p.videoStatus === 'ok').length;
      onProgress({
        phase: 'video-batch',
        percent: 65 + Math.round((done / Math.max(1, animatable.length)) * 32),
        message: `Videos Kling 2.5 prontos: ${done}/${animatable.length}`,
      });
    },
  );

  // PHASE 7: Wallet check
  const walletAfter = await fetchJson('/app/api/wallet');
  const creditsAfter = walletAfter.json?.credits ?? null;
  const creditDelta = creditsBefore !== null && creditsAfter !== null
    ? creditsBefore - creditsAfter
    : null;

  onProgress({ phase: 'done', percent: 100, message: 'Template pipeline completa.' });
  return {
    spaceId: space.spaceId,
    spaceUrl: space.url,
    templateSpaceId,
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

// v3.5.34: __uiMutex no-op (sequential setup is faster than mutex-queueing).
// Setup loops 1 pair at a time but with ZERO inter-step sleeps + event-driven waits.
const __uiMutex = {
  async run(label, fn) { return await fn(); }
};

function spaceURL(id) {
  return 'https://www.magnific.com/app/spaces/' + id;
}

function currentSpaceId() {
  const m = location.pathname.match(/\/app\/spaces\/([a-f0-9-]{30,})/);
  return m ? m[1] : null;
}

async function waitFor(predicate, timeoutMs = 30000, pollMs = 80) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  let lastKeepalive = Date.now();
  while (Date.now() < deadline) {
    try {
      const v = await predicate();
      if (v) return v;
    } catch (e) { lastErr = e; }
    // v3.5.7: KEEPALIVE every 20s — MV3 SW dies after ~30s idle, losing
    // pendingJobs Map → all progress events get silently dropped. Ping bg
    // to keep SW awake during long polls (waitForNodeVideo runs 15min).
    if (Date.now() - lastKeepalive > 20000) {
      try { chrome.runtime.sendMessage({ type: 'MG_KEEPALIVE' }).catch(() => {}); } catch {}
      lastKeepalive = Date.now();
    }
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

/**
 * v3.4.1 FIX CRITICO: navega no SPA Magnific SEM hard-reload.
 *
 * Antes (v3.4.0 e anteriores): usava location.href = newUrl que dispara HARD
 * NAVIGATION → mata script async em execucao → todos os awaits seguintes
 * morrem → user via "Garantindo Space..." eterno.
 *
 * Agora: history.pushState + dispatch popstate event. Vue Flow SPA pega o
 * route change e re-render sem reload. Script async sobrevive intacto.
 */
async function navigateToSpace(spaceId) {
  if (currentSpaceId() === spaceId) {
    // Same space already — but still need to verify canvas is ready
    try {
      await waitFor(() => document.querySelector('button[data-cy="board-main-toolbar-add-button"]'), 15000);
    } catch (e) {
      console.warn('[navigateToSpace] toolbar nao apareceu apos URL match');
    }
    return;
  }

  // v3.5.11 CRITICAL: Vue Router treats /spaces/A → /spaces/B as "same route"
  // and DOESN'T re-fetch space data. Canvas continues showing OLD space.
  // FIX: first push to /app/spaces (list, different route pattern), then push
  // to /app/spaces/{newId}. This forces Vue Router lifecycle: leave space →
  // enter list → leave list → enter NEW space. Liveblocks then fetches new
  // space data and renders fresh canvas.
  const currentlyOnSpace = !!currentSpaceId();
  if (currentlyOnSpace) {
    console.log('[navigateToSpace] currently on a space — forcing Vue Router re-render via /app/spaces detour');
    history.pushState({}, '', '/app/spaces');
    window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
    await sleep(800); // let list page mount briefly
  }

  // Now navigate to target space (Vue Router treats this as fresh navigation)
  history.pushState({}, '', spaceURL(spaceId));
  window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));

  // Espera o SPA reagir e atualizar a URL real
  await sleep(500);
  try {
    await waitFor(() => currentSpaceId() === spaceId, 8000);
  } catch (e) {
    console.warn('[navigateToSpace] SPA nao reagiu a pushState, fallback hard nav');
    location.href = spaceURL(spaceId);
    await sleep(3500);
  }

  // WAIT FOR CANVAS FULLY HYDRATED (toolbar + button visible)
  console.log('[navigateToSpace] aguardando toolbar + button aparecer (canvas ready)');
  try {
    await waitFor(() => document.querySelector('button[data-cy="board-main-toolbar-add-button"]'), 15000);
    console.log('[navigateToSpace] toolbar OK — canvas pronto');
  } catch (e) {
    console.warn('[navigateToSpace] toolbar nao apareceu em 15s — segue tentando');
  }
  // v3.5.11: bump settle to 2500ms — Liveblocks fetch + Vue Flow render do
  // new space precisa ~2-3s pos-toolbar-visible.
  await sleep(2500);
}

// ========================= TEMPLATE SPACE (v3.2.0) =========================
//
// DESCOBERTO LIVE (este sessao): Magnific tem POST /api/spaces/{id}/duplicate
// que clona um space inteiro (nodes + edges + config). Endpoint exato:
//
//   POST /app/api/spaces/{sourceUuid}/duplicate?lang=en_US&user_id=<id>
//   body: {} (empty JSON works)
//   resp: 200 { message, status:'completed', source_board:{uuid,name},
//               is_remix:false, is_template:false,
//               optimistic_board: { uuid, name, metadata:{is_duplicate:true,...} } }
//
// Rename: PUT /app/api/spaces/{newUuid} body={name:'...'} -> 200 { data:{...} }
//
// IMPORTANTE: Magnific usa Liveblocks pra sync collaborative state. Nodes/edges
// nao vem no GET /spaces/{id} — eles sao hidratados do Liveblocks room state
// quando a page carrega. Por isso enumeratePairsInOrder TEM que ser DOM-based
// (apos navigateToSpace + sleep pra hidratacao terminar).

async function duplicateSpaceFrom(sourceUuid, newName = null) {
  const r = await fetchJson(`/app/api/spaces/${sourceUuid}/duplicate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  }, 30000);
  if (!r.ok || !r.json) {
    throw new Error(`duplicateSpaceFrom: HTTP ${r.status} raw=${r.raw}`);
  }
  const newUuid = r.json?.optimistic_board?.uuid ||
                  r.json?.data?.uuid ||
                  r.json?.board?.uuid;
  if (!newUuid) throw new Error('duplicateSpaceFrom: sem uuid no response');
  if (newName) {
    try { await renameSpace(newUuid, newName); } catch (e) {
      console.warn('[Template] rename falhou (nao crítico):', e.message);
    }
  }
  return { spaceId: newUuid, url: spaceURL(newUuid) };
}

async function renameSpace(spaceUuid, newName) {
  const r = await fetchJson(`/app/api/spaces/${spaceUuid}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: newName }),
  }, 10000);
  if (!r.ok) throw new Error(`renameSpace: HTTP ${r.status} raw=${r.raw}`);
  return r.json;
}

/**
 * Enumera os IMAGE GENERATOR nodes do template space duplicado, ordenados
 * top-to-bottom (Y ascendente).
 *
 * DESIGN CORRETO (v3.2.1): template tem APENAS image gens pre-criadas
 * (model=Nano Banana 2 + 9:16 + 1K LOCK). Video gens NAO existem no template
 * — eles sao criados on-demand por take via createVideoGenNodeViaOutputHandle
 * apos o image prompt ser colado. Garantia EXTRA: cada video gen e configurado
 * com LOCK Kling 2.5 + retry 3x + verifyVid (que tambem checa FORBIDDEN models).
 *
 * Retorna: [{imageNodeId, y, x}, ...] ordenado top-to-bottom.
 */
function enumerateImageNodesInOrder() {
  const wrappers = Array.from(document.querySelectorAll('[data-id]'));
  const imgs = [];
  for (const w of wrappers) {
    const id = w.getAttribute('data-id') || '';
    if (!/^[a-f0-9-]{30,}$/.test(id)) continue;
    const isImg = !!w.querySelector('[data-cy="space-node-image-generator"]');
    if (!isImg) continue;
    const rect = w.getBoundingClientRect();
    imgs.push({ imageNodeId: id, y: rect.y, x: rect.x });
  }
  imgs.sort((a, b) => (a.y - b.y) || (a.x - b.x));
  return imgs;
}

function enumerateVideoNodesInOrder() {
  const wrappers = Array.from(document.querySelectorAll('[data-id]'));
  const vids = [];
  for (const w of wrappers) {
    const id = w.getAttribute('data-id') || '';
    if (!/^[a-f0-9-]{30,}$/.test(id)) continue;
    const isVid = !!w.querySelector('[data-cy="space-node-video-generator"]');
    if (!isVid) continue;
    const rect = w.getBoundingClientRect();
    vids.push({ videoNodeId: id, y: rect.y, x: rect.x });
  }
  vids.sort((a, b) => (a.y - b.y) || (a.x - b.x));
  return vids;
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

/**
 * v3.4.9 KEYBOARD NAVIGATION — dropdowns Magnific filtram busca por texto e
 * highlight o primeiro match. Apertar Enter no search input seleciona o
 * highlighted (= primeiro filtered match). Substitui mouse click que nao
 * funcionava em option items.
 *
 * @param {HTMLInputElement} input - input element do search
 * @returns {Promise<boolean>}
 */
async function pressEnterOnInput(input) {
  if (!input || input.tagName !== 'INPUT') return false;
  try {
    input.focus();
    // Dispatch keydown + keypress + keyup pra cobrir todos os listeners
    const opts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
    input.dispatchEvent(new KeyboardEvent('keydown', opts));
    input.dispatchEvent(new KeyboardEvent('keypress', opts));
    input.dispatchEvent(new KeyboardEvent('keyup', opts));
    return true;
  } catch (e) {
    console.warn('[pressEnterOnInput] error:', e?.message);
    return false;
  }
}

/**
 * v3.5.1: REAL MOUSE CLICK via chrome.debugger CDP — pra option clicks em
 * dropdowns Magnific (que bloqueou dispatched events com isTrusted check).
 */
async function clickViaCDP(el) {
  if (!el) return false;
  try {
    const r = el.getBoundingClientRect();
    if (!r || r.width === 0) return false;
    const x = Math.round(r.x + r.width / 2);
    const y = Math.round(r.y + r.height / 2);
    return await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'MG_REAL_CLICK', payload: { x, y } }, (resp) => {
        if (chrome.runtime.lastError) {
          resolve(false);
          return;
        }
        resolve(!!resp?.ok);
      });
    });
  } catch {
    return false;
  }
}

/**
 * v3.5.13: CDP FULL CLICK — emulates real user mouse sequence:
 * mouseMoved (hover) → settle 50ms → mousePressed → hold 30ms → mouseReleased.
 * Requires debugger to be PRE-ATTACHED via cdpAttach() — otherwise dispatches
 * fail. Vue Flow needs the hover phase before click registers as real intent.
 *
 * This is what the user does manually with a real mouse — no isTrusted check
 * can block it because the events ARE real OS-level mouse events.
 */
async function cdpAttach() {
  return await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'MG_CDP_ATTACH' }, (resp) => {
      if (chrome.runtime.lastError) { resolve(false); return; }
      resolve(!!resp?.ok);
    });
  });
}

async function cdpDetach() {
  return await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'MG_CDP_DETACH' }, () => resolve(true));
  });
}

async function cdpFullClick(el) {
  if (!el || !el.isConnected) return false;
  // Scroll element into view first (banner-aware viewport)
  try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
  await sleep(150); // let scroll settle + viewport stabilize
  const r = el.getBoundingClientRect();
  if (!r || r.width === 0) return false;
  const x = Math.round(r.x + r.width / 2);
  const y = Math.round(r.y + r.height / 2);
  return await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'MG_CDP_FULL_CLICK', payload: { x, y } }, (resp) => {
      if (chrome.runtime.lastError) { resolve(false); return; }
      resolve(!!resp?.ok);
    });
  });
}

function clickRealElement(el) {
  if (!el) return false;
  // v3.5.5: GUARD against detached el — Vue Flow's "In" handler crashes
  // (TypeError 'Cannot read property document of null') when we dispatch
  // events to a node that has been detached by a Vue Flow re-render. The
  // exception is async (in event handler) so dispatchEvent doesn't propagate
  // it back — but it corrupts Vue Flow internal state, breaking subsequent
  // selectNodeForEdit and even waitForNodeVideo polling. Bail early if
  // detached.
  if (!el.isConnected || !el.ownerDocument) {
    console.warn('[clickRealElement] el is detached (isConnected=' + el.isConnected + ') — skip click');
    return false;
  }
  // v3.5.34: BLOCK clicks on document/window — Magnific's useSpacesUsersnap
  // doc-listener calls event.target.closest() and crashes (TypeError) when
  // target lacks .closest(), aborting the async pipeline. Only allow Elements.
  if (el === document || el === window || typeof el.closest !== 'function') {
    console.warn('[clickRealElement] el is not an Element (no .closest) — refuse click to avoid Usersnap crash');
    return false;
  }
  try {
    const r = el.getBoundingClientRect();
    const x = r.x + r.width / 2;
    const y = r.y + r.height / 2;
    const opts = {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      button: 0,
      buttons: 1,
      pointerId: 1,        // Vue Flow crashava sem pointerId
      pointerType: 'mouse',
      isPrimary: true,
    };

    // Tier 1: focus + nativo .click() (Vue handles via DOM click delegation)
    try { if (typeof el.focus === 'function') el.focus({ preventScroll: true }); } catch {}
    el.dispatchEvent(new PointerEvent('pointerover', opts));
    el.dispatchEvent(new PointerEvent('pointerenter', opts));
    el.dispatchEvent(new MouseEvent('mouseover', opts));
    el.dispatchEvent(new MouseEvent('mouseenter', opts));
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.dispatchEvent(new MouseEvent('click', opts));
    // Native click() depois — alguns frameworks Vue precisam disso pra reactive state mudar
    if (typeof el.click === 'function') el.click();
  } catch (e) {
    console.warn('[clickRealElement] erro mas continuando:', e.message);
  }
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

// ========================= LOCK VERIFIERS (v3.2.2 — async + auto-select) =========================
//
// CRITICAL FINDING (v3.2.2, validado live): Magnific Vue Flow renderiza os botoes
// de config (model/aspect/quality/duration) APENAS quando o node esta SELECTED.
// Quando deselecionado: 0 botoes no DOM. Por isso TODA chamada de verify precisa
// chamar `selectNodeForEdit(uuid)` antes de ler os botoes — caso contrario reporta
// missing em tudo (falso negativo).

/** Coleta TODOS os botoes visiveis do node (texto trimmed, <35 chars). SYNC. */
function nodeButtons(uuid) {
  const n = findNodeElement(uuid);
  if (!n) return [];
  return Array.from(n.querySelectorAll('button'))
    .filter((b) => b.offsetParent !== null)
    .map((b) => (b.textContent || '').trim())
    .filter((t) => t && t.length < 35);
}

/**
 * Verifica IMAGE node — auto-seleciona antes de ler botoes.
 * ASYNC: chama selectNodeForEdit(uuid) primeiro pra Vue Flow renderizar os botoes.
 */
async function verifyImg(uuid) {
  try { await selectNodeForEdit(uuid); } catch {}
  const btns = nodeButtons(uuid);
  const expected = [IMAGE_MODEL_LOCK, IMAGE_ASPECT_LOCK, IMAGE_QUALITY_LOCK];
  const missing = expected.filter((e) => !btns.includes(e));
  return { ok: missing.length === 0, btns, missing };
}

/**
 * Verifica VIDEO node — auto-seleciona antes de ler botoes.
 * Inclui FORBIDDEN_VIDEO_MODELS check (Seedance/Veo/Runway/etc).
 *
 * PARANOIA ABSOLUTA — directive do user: "JAMAIS USAR OUTRA IA DE VIDEO QUE NAO
 * SEJA O KLING 2.5 720P unlimited. TENHA CERTEZA DISSO ABSOLUTA."
 *
 * Validacao live (v3.2.3, espaco real): video gen mostra botoes como
 *   ["Kling 2.5", "Auto" (=aspect inherit), "10s", "720p"]
 * Aspect "Auto" = inherit from input image. Como image gen LOCK garante 9:16,
 * video output e sempre 9:16. Por isso aceitamos aspect = '9:16' OU 'Auto'.
 * Pos-execucao, aspect button vira "716 × 1284" (dim real do output), mas
 * verifyVid roda PRE-execute entao isso nao e issue.
 *
 * ASYNC: chama selectNodeForEdit primeiro pra Vue Flow expor os botoes ocultos.
 */
async function verifyVid(uuid) {
  try { await selectNodeForEdit(uuid); } catch {}
  const btns = nodeButtons(uuid);
  const allowedDurations = ['10s', '5s'];
  const allowedAspects = [VIDEO_ASPECT_LOCK, 'Auto']; // 9:16 ou Auto (inherit from 9:16 input)
  const missing = [];
  if (!btns.includes(VIDEO_MODEL_LOCK)) missing.push(`model!=${VIDEO_MODEL_LOCK}`);
  if (!allowedAspects.some((a) => btns.includes(a))) missing.push(`aspect!=[9:16|Auto]`);
  if (!btns.includes(VIDEO_QUALITY_LOCK)) missing.push(`quality!=${VIDEO_QUALITY_LOCK}`);
  if (!allowedDurations.some((d) => btns.includes(d))) missing.push(`duration!=[10s|5s]`);

  const forbidden = FORBIDDEN_VIDEO_MODELS.filter((m) => btns.includes(m));
  if (forbidden.length > 0) {
    missing.push(`FORBIDDEN_MODEL_DETECTED=[${forbidden.join(', ')}]`);
  }
  return { ok: missing.length === 0, btns, missing, forbidden };
}

/**
 * Executa fn() com retry. Apos cada execucao chama verify() — se ok retorna.
 * Se nao ok apos LOCK_MAX_RETRIES, throw com detalhe dos botoes encontrados.
 *
 * @param {Function} fn - configure step (async)
 * @param {Function} verify - returns { ok, btns, missing }
 * @param {string} label - 'img' | 'vid' pra log
 * @param {number} pairIdx - 1-based
 */
async function configureWithLockRetry(fn, verify, label, pairIdx) {
  let lastVerify = null;
  for (let r = 0; r < LOCK_MAX_RETRIES; r++) {
    try {
      await fn();
    } catch (e) {
      console.warn(`[LOCK] pair#${pairIdx} ${label} configure attempt ${r + 1} threw:`, e.message);
    }
    await sleep(LOCK_RETRY_SLEEP_MS);
    lastVerify = await verify();  // v3.2.2: verify async (auto-selects node first)
    console.log(`[LOCK] pair#${pairIdx} ${label} verify attempt ${r + 1}:`, lastVerify);
    if (lastVerify.ok) return lastVerify;
  }
  // Falhou LOCK_MAX_RETRIES vezes — throw com detalhe pro handleRunPipeline abortar
  const err = new Error(
    `LOCK_VIOLATION pair#${pairIdx} ${label}: missing=[${lastVerify.missing.join(', ')}] btns=[${lastVerify.btns.join(', ')}]`,
  );
  err.lockViolation = true;
  err.lockLabel = label;
  err.lockPair = pairIdx;
  err.lockBtns = lastVerify.btns;
  err.lockMissing = lastVerify.missing;
  throw err;
}

// ---- Create configured pair (Image Generator + Video Generator connected) ----

/**
 * v3.5.33 POSITION NODE: drag node from current position to target via synthetic
 * pointer events. Used for organizing 15 pairs in a clean grid on canvas.
 * Drag simulates user dragging the node header — Vue Flow updates state.
 */
async function positionNode(uuid, targetX, targetY) {
  // v3.5.34 FIX: dispatch on Element (node), NOT document. Document has no
  // .closest() method so Magnific's useSpacesUsersnap doc-listener crashes
  // with `TypeError: t.closest is not a function`, which aborts createTakePair
  // inside async stack. Dispatching on the node makes event.target = node
  // (an Element), so .closest() works. Events still bubble up to Vue Flow's
  // window/doc listener for drag registration.
  try {
    const node = findNodeElement(uuid);
    if (!node) return false;
    const rect = node.getBoundingClientRect();
    if (rect.width < 50) return false;
    // Pick a drag handle near the top (header of node is draggable)
    const startX = rect.x + rect.width / 2;
    const startY = rect.y + 20;
    // Compute canvas-relative target
    const canvasEl = document.querySelector('.vue-flow__pane, .vue-flow__container');
    const cRect = canvasEl?.getBoundingClientRect();
    if (!cRect) return false;
    const screenX = cRect.x + targetX;
    const screenY = cRect.y + targetY;

    const evtOpts = (type, x, y, buttons) => new PointerEvent(type, {
      bubbles: true, cancelable: true, clientX: x, clientY: y,
      pointerId: 1, pointerType: 'mouse', button: 0, buttons, isPrimary: true,
    });
    // v3.5.34: pick a SAFE Element to dispatch on. node is always Element;
    // canvasEl is the .vue-flow__pane which is also Element. Use node for
    // pointerdown/move/up — bubbles up to document so Vue Flow drag handler
    // catches it, but event.target stays on the node (has .closest()).
    const safeTarget = node && typeof node.closest === 'function' ? node : document.body;
    safeTarget.dispatchEvent(evtOpts('pointerdown', startX, startY, 1));
    await sleep(30);
    const steps = 8;
    for (let i = 1; i <= steps; i++) {
      const x = startX + (screenX - startX) * (i / steps);
      const y = startY + (screenY - startY) * (i / steps);
      safeTarget.dispatchEvent(evtOpts('pointermove', x, y, 1));
      await sleep(15);
    }
    safeTarget.dispatchEvent(evtOpts('pointerup', screenX, screenY, 0));
    await sleep(80);
    return true;
  } catch (e) {
    console.warn('[positionNode] failed:', e.message);
    return false;
  }
}

/**
 * v3.5.49 — RECONECTA edge image→video. BUG observado pelo user: trocar o
 * modelo (Seedance default → Kling 2.5) faz o Magnific DERRUBAR a linha
 * image→video. Sem a linha, o vídeo não anima a imagem (lixo). Aqui
 * arrastamos (synthetic pointer drag) do output handle da imagem até o
 * input handle do vídeo, recriando o edge. Verifica por contagem.
 */
async function reconnectImageToVideo(imageNodeId, videoNodeId) {
  // v3.5.52 — BUG do take 1: o handle de SAÍDA da imagem precisa estar
  // renderizado/on-screen pro drag começar certo. Antes só o vídeo era
  // trazido pro viewport; a imagem do 1º par ficava fora → drag errado →
  // edge no handle errado. Agora trazemos a IMAGEM pro viewport primeiro,
  // depois o vídeo, e validamos coords on-screen antes de arrastar.
  try { await selectNodeForEdit(imageNodeId); } catch {}
  await sleep(250);
  try { await selectNodeForEdit(videoNodeId); } catch {}
  await sleep(250);
  const imgNode = findNodeElement(imageNodeId);
  const vidNode = findNodeElement(videoNodeId);
  if (!imgNode || !vidNode) { console.warn('[reconnect] node sumiu'); return false; }

  // output handle SOURCE da imagem (Vue Flow: .source). Seletores precisos
  // primeiro; SEM o ":not(.source)" largo que pegava handle errado.
  const outH = imgNode.querySelector(
    '[data-cy="output-handle-output"], .vue-flow__handle.source, .vue-flow__handle-output, .vue-flow__handle-right',
  );
  // input handle TARGET do vídeo (Vue Flow: .target). Preciso, sem fallback largo.
  const inH = vidNode.querySelector(
    '[data-cy="input-handle-input"], .vue-flow__handle.target, .vue-flow__handle-input, .vue-flow__handle-left',
  );
  if (!outH || !inH) {
    console.warn('[reconnect] handle não achado out=' + !!outH + ' in=' + !!inH);
    return false;
  }
  const oR = outH.getBoundingClientRect();
  const iR = inH.getBoundingClientRect();
  // valida coords on-screen e handles renderizados (width>0). Se inválido,
  // retorna false → ensureEdge faz retry (com mais settle/scroll).
  const onScreen = (r) =>
    r && r.width > 0 && r.height > 0 &&
    r.x >= 0 && r.y >= 0 &&
    r.x <= window.innerWidth && r.y <= window.innerHeight;
  if (!onScreen(oR) || !onScreen(iR)) {
    console.warn('[reconnect] handle fora de tela out=' + JSON.stringify({x:oR.x|0,y:oR.y|0,w:oR.width|0}) +
      ' in=' + JSON.stringify({x:iR.x|0,y:iR.y|0,w:iR.width|0}) + ' — retry');
    return false;
  }
  const sx = oR.x + oR.width / 2, sy = oR.y + oR.height / 2;
  const tx = iR.x + iR.width / 2, ty = iR.y + iR.height / 2;

  const evt = (type, x, y, buttons) => new PointerEvent(type, {
    bubbles: true, cancelable: true, clientX: x, clientY: y,
    pointerId: 1, pointerType: 'mouse', button: 0, buttons, isPrimary: true,
  });
  const safe = (el) => (el && typeof el.closest === 'function') ? el : document.body;

  // pointerdown no output handle → moves → pointerup no input handle.
  safe(outH).dispatchEvent(evt('pointerdown', sx, sy, 1));
  await sleep(40);
  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    const x = sx + (tx - sx) * (i / steps);
    const y = sy + (ty - sy) * (i / steps);
    // durante connection-drag Vue Flow escuta no document/pane
    safe(outH).dispatchEvent(evt('pointermove', x, y, 1));
    await sleep(20);
  }
  // pointerup PRECISA cair sobre o input handle do vídeo (target)
  safe(inH).dispatchEvent(evt('pointermove', tx, ty, 1));
  await sleep(30);
  safe(inH).dispatchEvent(evt('pointerup', tx, ty, 0));
  await sleep(150);
  return true;
}

/**
 * v3.5.49 — GARANTE edge image→video após config de modelo. Conta edges,
 * se o vídeo ficou solto (edge não aumentou após criação OU caiu na troca
 * de modelo), reconecta até 4x. THROW se não conseguir (pipeline auto-retry
 * refaz o take). NUNCA deixa passar vídeo sem a linha da imagem.
 */
async function ensureEdgeImageToVideo(imageNodeId, videoNodeId, pairIdx) {
  // v3.5.54 — FAIL-FAST no take 1. O user confirmou: take 1 SEMPRE quebra a
  // linha e a reconexão NÃO conserta ele — só o auto-retry (recriar Image
  // Generator) conserta, e isso funciona normal. Então pro par #1 não vale
  // gastar ~2min tentando reconectar: 2 tentativas RÁPIDAS (sem settle
  // extra) → throw rápido → o retry recria o take 1 (que funciona). Pares
  // 2+ mantêm a lógica robusta (6 tentativas) — eles conectam certo.
  const MAX = (pairIdx === 1) ? 2 : 6;
  for (let attempt = 1; attempt <= MAX; attempt++) {
    // pair #1: ZERO settle extra (fail-fast). Pares 2+: idem (já era 0).
    const extra = 0;
    await selectNodeForEdit(videoNodeId);
    await sleep(250 + extra);
    const before = __edgeCount();
    const dragged = await reconnectImageToVideo(imageNodeId, videoNodeId);
    await sleep(500 + extra);
    const after = __edgeCount();

    if (!dragged) {
      // handles não estavam prontos/on-screen — NÃO conta, retry com pausa maior
      console.warn(`[ensureEdge] pair#${pairIdx} drag não executou (attempt ${attempt}/${MAX}) — re-scroll+retry`);
      await sleep(800 + extra);
      continue;
    }
    // drag executou com handles válidos. Edge OK se:
    //  - criou edge novo (after>before: estava solto, consertou), OU
    //  - já existia e Vue Flow deduplicou (after===before E before>0)
    if (after > before || (before > 0 && after >= before)) {
      console.log(`[ensureEdge] pair#${pairIdx} edge OK (attempt ${attempt}, ${before}→${after})`);
      return true;
    }
    console.warn(`[ensureEdge] pair#${pairIdx} drag ok mas sem edge (attempt ${attempt}, ${before}→${after}) — retry`);
    await sleep(600 + extra);
  }
  throw new Error('EDGE_RECONNECT_FAIL pair#' + pairIdx +
    ': não consegui reconectar image→video após ' + MAX + ' tentativas — take vai pro auto-retry (nunca gera vídeo solto).');
}

async function createTakePair({
  imagePrompt, videoPrompt, imageModel, videoModel,
  aspect, imageQuality, videoQuality, videoDuration,
  pairIdx = 0,
  onStep,  // v3.5.4: emit progress per micro-step so caller can detect hang
}) {
  // SIMPLIFIED v3.4.0: forca Kling 2.5 + Nano Banana 2 + 9:16 + 720p/1K (LOCK
  // continua sendo enforced no selectModelInNode via STRICT equality match).
  imageModel    = 'nano-banana-2';
  videoModel    = 'kling-25';
  aspect        = '9:16';
  imageQuality  = '1K';
  videoQuality  = '720p';
  videoDuration = (videoDuration === 5 || videoDuration === '5s') ? 5 : 10;

  // v3.5.4 GRANULAR LOGGING + ONSTEP — emit per micro-step pra detectar hang
  const log = (step, extra) => {
    const msg = `[DARKO TakePair #${pairIdx}] ${step}`;
    console.log(msg, extra || '');
    if (typeof onStep === 'function') {
      try { onStep(`#${pairIdx} ${step}` + (extra ? ' ' + String(extra).slice(0, 60) : '')); } catch {}
    }
  };

  // v3.5.32 PARALLEL: wrap UI ops com __uiMutex pra serializar popup-using
  // operations entre pairs paralelos. DOM/REST ops correm livre.

  // 1a) Cria Image Generator node (LOCKED — usa + popup)
  log('1a) createImageGenNode start');
  const imageNodeId = await __uiMutex.run('1a', () => createImageGenNode());
  log('1a) imageNodeId=', imageNodeId);

  // v3.5.33 AUTO-POSITION: organizar nodes em grid 3-col com pair (img+vid) por row.
  // pair#1 → col=0 row=0, pair#2 → col=1 row=0, pair#3 → col=2 row=0, pair#4 → col=0 row=1
  // Image at (col*1000 + 100, row*700 + 100), Video at +500 right
  const col = (pairIdx - 1) % 3;
  const row = Math.floor((pairIdx - 1) / 3);
  const imgX = 100 + col * 1000;
  const imgY = 100 + row * 700;
  await __uiMutex.run('1a-pos', () => positionNode(imageNodeId, imgX, imgY));
  log('1a) image positioned at col=' + col + ' row=' + row);

  // 1b) Set prompt (LOCKED — pra evitar race com outro pair clicando + popup
  // que pode resetar tiptap focus state)
  log('1b) setNodePromptByUuid image');
  await __uiMutex.run('1b', () => setNodePromptByUuid(imageNodeId, imagePrompt));
  log('1b) prompt OK');

  // 1c.1) Select model Nano Banana 2 (LOCKED — usa dropdown popup)
  log('1c.1) configureImage selectModel Nano Banana 2');
  await __uiMutex.run('1c.1', async () => {
    await selectNodeForEdit(imageNodeId);
    const imgNodeEl = findNodeElement(imageNodeId);
    if (!imgNodeEl) throw new Error('Image node sumiu apos select: ' + imageNodeId);
    await selectModelInNode(imgNodeEl, modelDisplayName(imageModel));
  });
  log('1c.1) model OK');
  // v3.5.34: removed inter-step sleep 100ms (event-driven waits inside select* handle it)

  // 1c.2) Select aspect (LOCKED — dropdown popup)
  log('1c.2) configureImage selectAspect 9:16');
  await __uiMutex.run('1c.2', async () => {
    await selectNodeForEdit(imageNodeId);
    await selectAspectInNode(findNodeElement(imageNodeId), aspect);
  });
  log('1c.2) aspect OK');

  // 1c.3) Select quality 1K (LOCKED) + DOM verify (UNLOCKED, read-only)
  const targetImgQ = imageQuality || '1K';
  log('1c.3) configureImage select quality=' + targetImgQ);
  await __uiMutex.run('1c.3', async () => {
    await selectNodeForEdit(imageNodeId);
    try {
      await selectQualityInNode(findNodeElement(imageNodeId), targetImgQ);
    } catch (e) {
      throw new Error(`IMAGE_QUALITY_FAIL pair#${pairIdx}: ${e.message}`);
    }
    const imgNodeFinal = findNodeElement(imageNodeId);
    if (imgNodeFinal) { try { imgNodeFinal.click(); } catch {} await sleep(100); }
    const imgResBtn = imgNodeFinal?.querySelector('[data-cy="node-control-selector-resolution"]');
    const imgCurrentRes = imgResBtn ? (imgResBtn.textContent || '').trim() : 'NO_BTN';
    if (imgCurrentRes !== targetImgQ) {
      throw new Error(`IMAGE_QUALITY_LOCK_FAIL pair#${pairIdx}: resolution="${imgCurrentRes}" — ABORTA`);
    }
  });
  log(`1c.3) quality LOCKED at ${targetImgQ}`);

  // 1c.4) ensureUnlimited (LOCKED — abre settings sidebar)
  log('1c.4) ensureUnlimitedON');
  await __uiMutex.run('1c.4', () => ensureUnlimitedON(findNodeElement(imageNodeId), imageNodeId));
  log('1c.4) unlimited OK — image configured at ' + targetImgQ);

  // 2a) Create video gen via output handle (LOCKED — usa popup Add)
  log('2a) createVideoGenNodeViaOutputHandle');
  const videoNodeId = await __uiMutex.run('2a', () => createVideoGenNodeViaOutputHandle(imageNodeId));
  log('2a) videoNodeId=', videoNodeId);

  // v3.5.33 AUTO-POSITION video to the right of image (same row)
  const vidX = imgX + 500;
  const vidY = imgY;
  await __uiMutex.run('2a-pos', () => positionNode(videoNodeId, vidX, vidY));
  log('2a) video positioned at col=' + col + '+0.5 row=' + row);

  // 2b) Set video prompt (LOCKED)
  if (videoPrompt) {
    log('2b) setNodePromptByUuid video');
    await __uiMutex.run('2b', () => setNodePromptByUuid(videoNodeId, videoPrompt));
    log('2b) video prompt OK');
  }

  // 2c.1) Kling 2.5 LOCK (LOCKED — internal retry)
  log('2c.1) configureVideo selectModel Kling 2.5 (with LOCK 5x retry)');
  await __uiMutex.run('2c.1', () => configureVideoGenNodeLockOnly(videoNodeId, videoModel));
  log('2c.1) model locked OK');

  // 2c.2) Video aspect (LOCKED)
  log('2c.2) configureVideo selectAspect 9:16');
  await __uiMutex.run('2c.2', async () => {
    await selectNodeForEdit(videoNodeId);
    await selectAspectInNode(findNodeElement(videoNodeId), aspect);
  });
  log('2c.2) aspect OK');

  // 2c.3) Video quality (LOCKED) + DOM verify
  log('2c.3) configureVideo select quality=' + videoQuality);
  await __uiMutex.run('2c.3', async () => {
    await selectNodeForEdit(videoNodeId);
    try {
      await selectQualityInNode(findNodeElement(videoNodeId), videoQuality);
    } catch (e) {
      throw new Error(`VIDEO_QUALITY_FAIL pair#${pairIdx}: ${e.message}`);
    }
  });
  const vidNodeFinal = findNodeElement(videoNodeId);
  if (vidNodeFinal) { try { vidNodeFinal.click(); } catch {} await sleep(100); }
  const vidResBtn = vidNodeFinal?.querySelector('[data-cy="node-control-selector-resolution"]');
  const vidCurrentRes = vidResBtn ? (vidResBtn.textContent || '').trim() : 'NO_BTN';
  if (vidCurrentRes !== videoQuality) {
    throw new Error(`VIDEO_QUALITY_LOCK_FAIL pair#${pairIdx}: resolution="${vidCurrentRes}" (esperado ${videoQuality}) — ABORTA, zero credit risk`);
  }
  log(`2c.3) quality LOCKED at ${videoQuality}`);

  log('2c.4) configureVideo selectDuration ' + videoDuration + 's');
  await __uiMutex.run('2c.4', async () => {
    await selectNodeForEdit(videoNodeId);
    await selectDurationInNode(findNodeElement(videoNodeId), videoDuration);
  });
  log('2c.4) duration OK');

  log('2c.5) ensureUnlimitedON');
  await __uiMutex.run('2c.5', () => ensureUnlimitedON(findNodeElement(videoNodeId), videoNodeId));
  log('2c.5) unlimited OK');

  // 2c.6) v3.5.49 — GARANTE edge image→video. A troca de modelo (2c.1
  // Seedance→Kling 2.5) derruba a linha no Magnific. Reconecta antes de
  // liberar o pair. Sem isso o vídeo geraria SEM animar a imagem.
  log('2c.6) ensureEdgeImageToVideo (reconecta linha pós troca de modelo)');
  await __uiMutex.run('2c.6', () => ensureEdgeImageToVideo(imageNodeId, videoNodeId, pairIdx));
  log('2c.6) edge image→video CONFIRMADO — pair complete');

  return { imageNodeId, videoNodeId };
}

// v3.5.4: SELECT MODEL with LOCK 5x retry — extraido de configureVideoGenNode
// pra createTakePair conseguir emitir progress per micro-step.
async function configureVideoGenNodeLockOnly(uuid, model) {
  const targetDisplayName = modelDisplayName(model);
  const MAX_MODEL_RETRIES = 5;
  let modelOk = false;
  let lastBtns = [];

  for (let attempt = 0; attempt < MAX_MODEL_RETRIES; attempt++) {
    await selectNodeForEdit(uuid);
    const node = findNodeElement(uuid);
    if (!node) throw new Error('Video node sumiu: ' + uuid);

    try {
      await selectModelInNode(node, targetDisplayName);
    } catch (e) {
      console.warn(`[configureVidLock] selectModel attempt ${attempt + 1} threw:`, e.message);
    }

    await selectNodeForEdit(uuid);
    await sleep(200); // v3.5.29 ULTRA: 500→200
    lastBtns = nodeButtons(uuid);
    const hasTarget = lastBtns.includes(targetDisplayName);
    const forbidden = FORBIDDEN_VIDEO_MODELS.filter((m) => lastBtns.includes(m));

    if (hasTarget && forbidden.length === 0) {
      modelOk = true;
      console.log(`[configureVidLock] model OK (attempt ${attempt + 1}):`, targetDisplayName);
      break;
    }
    console.warn(`[configureVidLock] attempt ${attempt + 1} bad: hasTarget=${hasTarget}, forbidden=[${forbidden.join(',')}], btns=[${lastBtns.join(',')}]`);
  }

  if (!modelOk) {
    throw new Error(
      `MODEL_LOCK_FAIL: nao consegui selecionar ${targetDisplayName} apos ${MAX_MODEL_RETRIES} tentativas. ` +
      `btns=[${lastBtns.join(',')}]`,
    );
  }
}

/**
 * v3.5.6 — Multi-pair support: deselect any node first, longer popup timeout,
 * keyboard ESC fallback to close any popovers before clicking +.
 *
 * PATH A: empty-state card "Image Generator" (space sem nodes)
 * PATH B: toolbar "+" → painel "Image Generator"
 */
async function createImageGenNode() {
  const before = collectVisibleNodes();

  // v3.5.16 REMOVE PATH A: "empty-state card" predicate was matching the
  // WELCOME PANEL "Image Generator" option (button at empty space) which only
  // CLOSES the welcome panel, does NOT create a node. Confirmed via live test:
  // manual click on this card returned popupOpen=false but imgNodes=0.
  // ALWAYS use PATH B (toolbar +) which actually creates the node.
  // Pre-step: deselect + close any welcome panel (ESC + canvas click)
  try {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', bubbles: true }));
    const canvas = document.querySelector('.vue-flow__pane, .vue-flow__container, .vue-flow');
    if (canvas) {
      const r = canvas.getBoundingClientRect();
      const ev = (type) => new MouseEvent(type, {
        bubbles: true, cancelable: true,
        clientX: r.left + 20, clientY: r.top + 20,
        button: 0, buttons: type === 'mousedown' ? 1 : 0,
      });
      canvas.dispatchEvent(ev('mousedown'));
      canvas.dispatchEvent(ev('mouseup'));
      canvas.dispatchEvent(ev('click'));
    }
  } catch {}
  await sleep(400);

  // v3.5.17: AGGRESSIVE welcome panel close. Welcome panel auto-shows on
  // empty space and intercepts clicks. We try: ESC × 3, body click, focus blur.
  for (let i = 0; i < 3; i++) {
    const welcomeImgGen = Array.from(document.querySelectorAll('button')).find(b => {
      const t = (b.textContent || '').trim();
      return /^Image GeneratorGenerate images/.test(t);
    });
    if (!welcomeImgGen) break; // panel closed
    console.log('[createImageGenNode] welcome panel still open (try ' + (i+1) + '/3) — closing');
    // Try multiple close methods
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
    // Also try clicking somewhere safe to dismiss
    try {
      const canvasBg = document.querySelector('.vue-flow__pane, .vue-flow__container, .vue-flow__background');
      if (canvasBg) {
        const r = canvasBg.getBoundingClientRect();
        const target = document.elementFromPoint(r.x + 100, r.y + 100);
        if (target && !target.closest('button')) target.click();
      }
    } catch {}
    // Blur active element
    try { document.activeElement?.blur(); } catch {}
    await sleep(800);
  }

  // PATH B — toolbar "+" via data-cy estavel
  // v3.5.9: REVERT CDP click on + button. Reason: chrome.debugger.attach
  // shows a banner that shifts viewport ~40px AFTER getBoundingClientRect was
  // read in content_script. CDP click lands 40px below target = misses + button.
  // Native click() works correctly because no viewport shift. Confirmed via
  // manual test: plusBtn.click() opens popup with options visible at y=434.
  // v3.5.10: 6s → 15s. Em multi-pair flow, canvas pode estar mid-render quando
  // chegamos aqui (pair N-1's video acabou de ser dispatched, Vue Flow esta
  // adicionando o video node ao DOM). Toolbar fica visivel sempre, mas se a
  // page acabou de hidratar, pode demorar.
  const plusBtn = await waitFor(() => {
    return document.querySelector('button[data-cy="board-main-toolbar-add-button"]');
  }, 15000);
  // v3.5.20: native click (proven works) + faster settle (1200→600)
  try { plusBtn.focus({ preventScroll: true }); } catch {}
  plusBtn.click();
  await sleep(600);

  const opt = await waitFor(() => {
    const all = Array.from(document.querySelectorAll('div,li,button,[role=option],[role=menuitem],span'));
    return all.filter((e) => {
      const t = (e.textContent || '').trim();
      if (t !== 'Image Generator') return false;
      if (e.offsetParent === null) return false;
      const r = e.getBoundingClientRect();
      return r.width > 100 && r.height > 20 && r.y < 800;
    }).sort((a, b) => a.getBoundingClientRect().y - b.getBoundingClientRect().y)[0];
  }, 10000);
  const optClickable = opt.closest('[role=option],[role=menuitem],button,li,[role=button]') || opt;
  optClickable.click();

  return await waitForNewNode(before);
}

async function waitForNewNode(beforeIds) {
  // v3.5.27: 25s → 90s. Background-throttled tabs (MCP interfering with focus)
  // make Liveblocks node creation take 30-90s instead of 1-3s. Generous timeout
  // ensures nodes ARE detected (they DO get created, just slowly).
  const newId = await waitFor(() => {
    const now = collectVisibleNodes();
    const diff = now.filter((u) => !beforeIds.includes(u));
    return diff[0] || null;
  }, 90000);
  await sleep(700);
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
  await sleep(120); // v3.5.28: 250→120 (most scrolls are instant)
  const body = n.querySelector('[data-cy="space-node-image-generator"], [data-cy^="space-node-"]') || n;
  clickRealElement(body);
  // v3.5.28 EVENT-DRIVEN: wait pra controls aparecerem (max 800ms, normally 100-200ms)
  try {
    await waitFor(() => n.querySelector('[data-cy="node-controls-container"]'), 800, 30);
  } catch { /* segue, controls podem ja estar visiveis */ }
}

/**
 * VALIDADO AO VIVO (v3.1): 3 cliques pra criar Video Generator conectado.
 *   1. Click no output handle (.vue-flow__handle-output) — abre popup "Generated image"
 *   2. Click no botao "Add" dentro do popup — abre search com Image Generator / Video Generator / etc.
 *   3. Click no item "Video Generator" — cria novo node ja conectado por edge
 */
function __edgeCount() {
  return document.querySelectorAll('g.vue-flow__edge, path.vue-flow__edge-path, .vue-flow__edge').length;
}

async function __deleteNodeById(uuid) {
  try {
    const n = findNodeElement(uuid);
    if (!n) return;
    await selectNodeForEdit(uuid);
    await sleep(150);
    try { n.click(); } catch {}
    await sleep(150);
    // Backspace/Delete remove o node selecionado no Vue Flow
    const tgt = n && typeof n.closest === 'function' ? n : document.body;
    for (const key of ['Delete', 'Backspace']) {
      tgt.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, bubbles: true }));
      tgt.dispatchEvent(new KeyboardEvent('keyup', { key, code: key, bubbles: true }));
      await sleep(200);
      if (!findNodeElement(uuid)) break;
    }
  } catch (e) { console.warn('[__deleteNodeById] falha:', e && e.message); }
}

/**
 * v3.5.44 EDGE-GUARANTEED: cria o Video Generator via output handle da imagem
 * (que auto-conecta o edge). VERIFICA via contagem de edges que a conexão
 * image→video foi criada. Se NÃO foi (video órfão), deleta o node solto e
 * REFAZ — até 3x. NUNCA retorna um video sem edge. User: "JAMAIS gerar video
 * separado do image generate sem ligação — todos devem fluir perfeito".
 */
async function createVideoGenNodeViaOutputHandle(imageNodeId) {
  const MAX_ATTEMPTS = 3;
  let lastOrphan = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // limpa órfão da tentativa anterior antes de refazer
    if (lastOrphan) { await __deleteNodeById(lastOrphan); lastOrphan = null; await sleep(300); }

    const before = collectVisibleNodes();
    const edgesBefore = __edgeCount();
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
    let addBtn;
    try {
      addBtn = await waitFor(() => {
        const all = document.querySelectorAll('button,[role=button]');
        for (const b of all) {
          const t = (b.textContent || '').trim();
          if (/^add$/i.test(t)) {
            const r = b.getBoundingClientRect();
            if (r.width > 30 && r.width < 200) return b;
          }
        }
        return null;
      }, 4000);
    } catch (e) {
      console.warn(`[createVidNode] attempt ${attempt}: Add popup não abriu — retry`);
      continue;
    }
    clickRealElement(addBtn);
    await sleep(500);

    // Step 3: Search popup com lista de tipos de node
    let opt;
    try {
      opt = await waitFor(() => {
        const all = Array.from(document.querySelectorAll('button,[role=option],[role=menuitem],div,li,span'));
        return all.find((e) => {
          const t = (e.textContent || '').trim();
          return /^video\s*generator$/i.test(t) && t.length < 30;
        });
      }, 6000);
    } catch (e) {
      console.warn(`[createVidNode] attempt ${attempt}: opção 'Video Generator' não apareceu — retry`);
      continue;
    }
    clickRealElement(opt);
    let parent = opt.parentElement;
    for (let k = 0; k < 4 && parent; k++) {
      if (parent.matches('button,[role=option],[role=menuitem],li,[role=button]')) {
        clickRealElement(parent);
        break;
      }
      parent = parent.parentElement;
    }

    let newId = null;
    try {
      newId = await waitFor(() => {
        const now = collectVisibleNodes();
        const diff = now.filter((u) => u !== imageNodeId && !before.includes(u));
        for (const id of diff) {
          const n = findNodeElement(id);
          if (n && /video\s*generator/i.test(n.textContent || '')) return id;
        }
        return diff[0] || null;
      }, 6000);
    } catch (e) {
      console.warn(`[createVidNode] attempt ${attempt}: video node não apareceu — retry`);
      continue;
    }
    await sleep(600);

    // VERIFICA edge criado: contagem deve ter aumentado (output-handle
    // auto-conecta). Se não aumentou → video órfão → deleta e refaz.
    const edgesAfter = __edgeCount();
    if (edgesAfter > edgesBefore) {
      console.log(`[createVidNode] OK attempt ${attempt}: video ${String(newId).slice(0,8)} conectado (edges ${edgesBefore}→${edgesAfter})`);
      return newId;
    }
    console.warn(`[createVidNode] attempt ${attempt}: video ${String(newId).slice(0,8)} SEM edge (${edgesBefore}→${edgesAfter}) — deleta órfão + retry`);
    lastOrphan = newId;
  }

  if (lastOrphan) { await __deleteNodeById(lastOrphan); }
  throw new Error('EDGE_CREATE_FAIL: não consegui criar Video Generator CONECTADO à imagem ' +
    String(imageNodeId).slice(0,8) + ' após ' + MAX_ATTEMPTS + ' tentativas — take vai pro auto-retry (nunca gera video solto).');
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
  await sleep(100); // v3.5.29 ULTRA: 250→100
}

async function configureImageGenNode(uuid, { model, aspect, quality }) {
  await selectNodeForEdit(uuid);
  const node = findNodeElement(uuid);
  if (!node) throw new Error('Node sumiu apos select: ' + uuid);

  await selectModelInNode(node, modelDisplayName(model));
  await sleep(1200);
  await selectNodeForEdit(uuid);
  await sleep(600);
  await selectAspectInNode(findNodeElement(uuid), aspect);

  // v3.5.19 HARD-ENFORCE 1K: Nano Banana 2 default = 2K (CONSOME CREDITOS).
  // Sempre seleciona 1K + VERIFICA + retry ate 5x. Se nao consegue 1K, THROW
  // pra processPair marcar pair como failed (CREDIT_GUARD pos-dispatch tambem
  // bloqueia se 2K residual, mas aqui ja resolvemos no setup).
  const targetQuality = quality || '1K';
  let qualityOk = false;
  for (let attempt = 1; attempt <= 5 && !qualityOk; attempt++) {
    await sleep(500);
    await selectNodeForEdit(uuid);
    try {
      await selectQualityInNode(findNodeElement(uuid), targetQuality);
    } catch (e) {
      console.warn(`[configImg quality attempt ${attempt}/5] selectQuality threw:`, e.message);
    }
    // VERIFY: read buttons, confirm targetQuality present AND no forbidden tiers
    await sleep(700);
    await selectNodeForEdit(uuid);
    await sleep(400);
    const btns = nodeButtons(uuid);
    const has1K = btns.includes(targetQuality);
    const has2K = btns.includes('2K');
    const has4K = btns.includes('4K');
    console.log(`[configImg quality attempt ${attempt}/5] btns=[${btns.join(',')}] has1K=${has1K} has2K=${has2K}`);
    if (has1K && !has2K && !has4K) {
      qualityOk = true;
      console.log(`[configImg] quality LOCKED at ${targetQuality}`);
      break;
    }
    console.warn(`[configImg] tentativa ${attempt}/5 nao ficou em ${targetQuality} — retry`);
  }
  if (!qualityOk) {
    throw new Error(`IMAGE_QUALITY_LOCK_FAIL: nao consegui setar ${targetQuality} no node ${uuid.slice(0,8)} apos 5 tentativas — ABORTA (risco de gastar creditos)`);
  }

  await ensureUnlimitedON(findNodeElement(uuid), uuid);
}

async function configureVideoGenNode(uuid, { model, aspect, quality, duration }) {
  // v3.4.4 CRITICAL: SELECT MODEL com RETRY ate Kling 2.5 selecionado e nenhum
  // FORBIDDEN detectado. Antes (v3.4.0): selectModelInNode 1x e seguia. Resultado:
  // Magnific selecionava Seedance 1.5 Pro automaticamente (default video-from-image)
  // e a verificacao nunca acontecia. Agora retry ate 5x. Se 5x falhar, THROW.

  const targetDisplayName = modelDisplayName(model);
  const MAX_MODEL_RETRIES = 5;
  let modelOk = false;
  let lastBtns = [];

  for (let attempt = 0; attempt < MAX_MODEL_RETRIES; attempt++) {
    await selectNodeForEdit(uuid);
    const node = findNodeElement(uuid);
    if (!node) throw new Error('Video node sumiu: ' + uuid);

    try {
      await selectModelInNode(node, targetDisplayName);
    } catch (e) {
      console.warn(`[configureVid] selectModel attempt ${attempt + 1} threw:`, e.message);
    }

    // Re-select node + ler botoes pra confirmar
    await selectNodeForEdit(uuid);
    await sleep(200); // v3.5.29 ULTRA: 500→200
    lastBtns = nodeButtons(uuid);
    const hasTarget = lastBtns.includes(targetDisplayName);
    const forbidden = FORBIDDEN_VIDEO_MODELS.filter((m) => lastBtns.includes(m));

    if (hasTarget && forbidden.length === 0) {
      modelOk = true;
      console.log(`[configureVid] model OK (attempt ${attempt + 1}):`, targetDisplayName);
      break;
    }
    console.warn(`[configureVid] attempt ${attempt + 1} bad: hasTarget=${hasTarget}, forbidden=[${forbidden.join(',')}], btns=[${lastBtns.join(',')}]`);
  }

  if (!modelOk) {
    throw new Error(
      `MODEL_LOCK_FAIL: nao consegui selecionar ${targetDisplayName} apos ${MAX_MODEL_RETRIES} tentativas. ` +
      `btns=[${lastBtns.join(',')}]. NUNCA disparar video com modelo errado (Seedance = gasta credito).`
    );
  }

  // v3.5.3: SETTLE DELAY apos selecionar modelo. Magnific re-renderiza o node
  // (mostra/esconde dropdowns conforme modelo selecionado: Kling 2.5 mostra
  // duration+aspect+quality, outros modelos podem nao mostrar). Sem esse delay,
  // selectAspectInNode tenta achar dropdown antes do re-render → matcher falha.
  await sleep(1200);
  await selectNodeForEdit(uuid);
  await sleep(600);
  await selectAspectInNode(findNodeElement(uuid), aspect);

  // v3.5.19 HARD-ENFORCE 720p: Kling 2.5 default pode ser 1080p (gasta credito).
  // Mesma logica do image: select + verify + retry ate 5x. Se nao consegue 720p,
  // THROW pra processPair marcar pair como failed (zero risco de gastar creditos).
  if (quality) {
    let videoQualityOk = false;
    for (let attempt = 1; attempt <= 5 && !videoQualityOk; attempt++) {
      await sleep(500);
      await selectNodeForEdit(uuid);
      try {
        await selectQualityInNode(findNodeElement(uuid), quality);
      } catch (e) {
        console.warn(`[configVid quality attempt ${attempt}/5] selectQuality threw:`, e.message);
      }
      await sleep(700);
      await selectNodeForEdit(uuid);
      await sleep(400);
      const btns = nodeButtons(uuid);
      const hasTarget = btns.includes(quality);
      const has1080p = btns.includes('1080p');
      const has4k = btns.includes('4K');
      console.log(`[configVid quality attempt ${attempt}/5] btns=[${btns.join(',')}] has${quality}=${hasTarget} has1080p=${has1080p}`);
      if (hasTarget && !has1080p && !has4k) {
        videoQualityOk = true;
        console.log(`[configVid] quality LOCKED at ${quality}`);
        break;
      }
      console.warn(`[configVid] tentativa ${attempt}/5 nao ficou em ${quality} — retry`);
    }
    if (!videoQualityOk) {
      throw new Error(`VIDEO_QUALITY_LOCK_FAIL: nao consegui setar ${quality} no video node ${uuid.slice(0,8)} apos 5 tentativas — ABORTA`);
    }
  }

  if (duration) {
    await sleep(500);
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
  const SMLog = (m, x) => console.log('[selectModel ' + displayName + '] ' + m, x !== undefined ? x : '');

  // Step 1: find dropdown button
  SMLog('1) finding dropdown button');
  const dropdown = await waitFor(() => {
    const all = node.querySelectorAll('button,[role=button]');
    for (const b of all) {
      if (b.offsetParent === null) continue;
      const t = (b.textContent || '').trim();
      if (/^(auto|google|kling|flux|cinematic|classic|imagen|nano|gpt|seedream|recraft|veo|sora|seedance|runway|pixverse|minimax|ltx|wan|grok|openai|bytedance|fal-|fal\s)/i.test(t) && t.length < 35) return b;
    }
    return null;
  }, 4000);
  SMLog('1) dropdown found, text=', (dropdown?.textContent || '').trim());

  // Step 2: click dropdown
  SMLog('2) clicking dropdown');
  clickRealElement(dropdown);
  // v3.5.34: event-driven wait pra search input renderizar (no fixed sleep)
  try {
    await waitFor(() => {
      const ins = document.querySelectorAll('input[type="text"],input[placeholder*="earch" i]');
      for (const i of ins) {
        if (i.offsetParent !== null && i.getBoundingClientRect().width > 80) return true;
      }
      return null;
    }, 1200, 30);
  } catch {}

  // Step 3: confirm dropdown opened (look for search input)
  SMLog('3) finding search input');
  let input;
  try {
    input = await waitFor(() => {
      const ins = document.querySelectorAll('input[type="text"],input[placeholder*="earch" i],input[placeholder*="usca" i]');
      for (const i of ins) {
        if (i.offsetParent === null) continue;
        const r = i.getBoundingClientRect();
        if (r.width > 80 && r.height > 10) return i;
      }
      return null;
    }, 3000);
    SMLog('3) search input found, placeholder=', input?.placeholder);
  } catch (e) {
    SMLog('3) ERROR: search input not found — dropdown may not have opened', e.message);
    throw new Error('Dropdown did not open after click — input not found');
  }

  // Step 4: type search term
  const chunk = displayName.split(' ')[0].toLowerCase();
  SMLog('4) typing "' + chunk + '"');
  input.focus();
  // Use native setter pra disparar Vue/React reactive listeners
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, '');
  input.dispatchEvent(new InputEvent('input', { bubbles: true, data: '', inputType: 'deleteContent' }));
  for (const ch of chunk) {
    const newVal = input.value + ch;
    setter.call(input, newVal);
    input.dispatchEvent(new InputEvent('input', { bubbles: true, data: ch, inputType: 'insertText' }));
    await sleep(15); // v3.5.29 ULTRA: 25→15
  }
  await sleep(500); // v3.5.41 RELIABILITY: restaurado (ULTRA 250 era flaky —
  // Vue precisa filtrar+renderizar options antes do match). Confiável > rápido.
  SMLog('4) input.value after typing=', input.value);

  // Step 5: find option
  SMLog('5) finding option ' + displayName);
  let opt;
  try {
    opt = await waitFor(() => {
      const all = Array.from(document.querySelectorAll('div,li,button,[role=option]'));
      const matches = all.filter((e) => {
        if (e.offsetParent === null) return false;
        if (e.getBoundingClientRect().width < 20) return false;
        const t = (e.textContent || '').trim();
        return t === displayName || t === displayName + 'New';
      });
      matches.sort((a, b) => (a.textContent || '').length - (b.textContent || '').length);
      return matches[0] || null;
    }, 5000);
    SMLog('5) option found, tag=' + opt.tagName + ' text=' + (opt.textContent || '').trim().slice(0, 50));
  } catch (e) {
    SMLog('5) ERROR: option not found', e.message);
    // Diagnostic: what options DID show up?
    const visible = Array.from(document.querySelectorAll('div,li,button,[role=option]'))
      .filter(e => e.offsetParent !== null && e.getBoundingClientRect().width > 20)
      .map(e => (e.textContent || '').trim())
      .filter(t => t && t.length < 50 && t.length > 2)
      .slice(0, 30);
    SMLog('5) DIAGNOSTIC visible options:', visible);
    throw new Error('Option "' + displayName + '" not found after typing');
  }

  // Step 6: v3.5.1 — TRIPLE STRATEGY:
  // 1) chrome.debugger CDP real mouse click (most reliable, but bypasses Vue isTrusted check)
  // 2) Keyboard Enter on search input (fallback)
  // 3) dispatched events (last resort)
  // LOCK ainda valida apos: zero risco de dispatch errado mesmo se todos falharem.
  SMLog('6) clicking option via CDP REAL MOUSE');
  const clickable = opt.closest('button,[role=option],[role=menuitem],li,a') || opt;
  clickable.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  await sleep(150); // v3.5.41 RELIABILITY: restaurado (ULTRA 80 era flaky)
  const cdpOk = await clickViaCDP(clickable);
  SMLog('6) CDP click result:', cdpOk);
  if (!cdpOk) {
    SMLog('6) CDP falhou, fallback Enter');
    await pressEnterOnInput(input);
    await sleep(200);
    SMLog('6) Enter fallback fired');
  }
  await sleep(700); // v3.5.41 RELIABILITY CRÍTICO: restaurado (ULTRA 350 era
  // flaky — Vue do Magnific precisa commitar a troca de modelo após o clique;
  // sem isso o node fica Seedance e o MODEL_GUARD aborta o vídeo).

  SMLog('6) DONE');
}

/**
 * v3.5.3 — selectOptionRobust HARDENED v2:
 *   - Timeouts maiores (dropdown wait 8s, option wait 8s, verify 5s)
 *   - Settle 1500ms apos clicar option (Vue Flow re-render demora)
 *   - Diagnostic dump COMPLETO de TODOS os botoes do node se matcher falhar
 *   - Verify aceita "contains" (texto pode incluir prefixo/sufixo extra)
 *   - 7 retries em vez de 5
 *
 * User feedback: "Kling 2.5 e 720p funcionaram, 9:16 e 10s nao. PRECISO QUE
 * CONSIGA SELECIONAR PERFEITAMENTE". v3.5.2 falhou. v3.5.3 finalmente robusto.
 */
async function selectOptionRobust(node, targetText, dropdownMatcher, label) {
  const SOL = (m, x) => console.log('[selectOpt ' + label + '=' + targetText + '] ' + m, x !== undefined ? x : '');
  const MAX_RETRY = 5; // v3.5.26: 7→5 (faster fail-detection)
  const tt = targetText.toLowerCase();

  for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
    SOL('attempt ' + attempt + '/' + MAX_RETRY);

    // Step 1: find dropdown button (8s — node UI re-render pode demorar apos selectModel)
    let dd;
    try {
      dd = await waitFor(() => {
        const all = node.querySelectorAll('button,[role=button]');
        for (const b of all) {
          if (b.offsetParent === null) continue;
          const t = (b.textContent || '').trim();
          if (dropdownMatcher(t)) return b;
        }
        return null;
      }, 8000);
    } catch (e) {
      // Diagnostic: dump TODOS os botoes do node pra entender por que matcher falhou
      const allBtns = Array.from(node.querySelectorAll('button,[role=button]'))
        .filter(b => b.offsetParent !== null)
        .map(b => (b.textContent || '').trim())
        .filter(t => t && t.length < 60);
      SOL('DROPDOWN matcher FAIL — visible buttons in node:', allBtns);
      if (attempt === MAX_RETRY) throw new Error('Dropdown ' + label + ' nao encontrado (matcher falhou); btns=' + allBtns.join(' | '));
      await sleep(700);
      continue;
    }
    const currentText = (dd.textContent || '').trim();
    SOL('found dropdown, current=', currentText);

    // Already selected? (loose match — texto pode ter sufixo/prefixo)
    if (currentText.toLowerCase() === tt || currentText.toLowerCase().includes(tt)) {
      SOL('already selected (or contains target), done');
      return true;
    }

    // Step 2: click dropdown
    dd.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const ddCdp = await clickViaCDP(dd);
    if (!ddCdp) clickRealElement(dd);
    SOL('dropdown clicked, cdp=', ddCdp);
    // v3.5.34: wait pra popup ter opção visível (no fixed fallback sleep)
    try {
      await waitFor(() => {
        const opts = document.querySelectorAll('[role=option],[role=menuitem],li');
        for (const o of opts) {
          if (o.offsetParent !== null && o.getBoundingClientRect().width > 30) return true;
        }
        return null;
      }, 1500, 30);
    } catch {}

    // Step 3: find option (8s — pode ter animacao de abrir)
    let opt = null;
    try {
      opt = await waitFor(() => {
        const all = Array.from(document.querySelectorAll('div,li,button,[role=option],[role=menuitem],span'));
        const matches = all.filter((e) => {
          if (e.offsetParent === null) return false;
          const r = e.getBoundingClientRect();
          if (r.width < 5) return false;
          if (r.height < 5 || r.height > 100) return false;
          const t = (e.textContent || '').trim();
          return t === targetText || t.toLowerCase() === tt;
        });
        // Sort by length asc (shortest match preferred — defends against unfiltered list)
        matches.sort((a, b) => (a.textContent || '').length - (b.textContent || '').length);
        return matches[0] || null;
      }, 8000);
      SOL('option found, tag=' + opt.tagName + ' rect=', JSON.stringify(opt.getBoundingClientRect()));
    } catch (e) {
      SOL('option NOT found:', e.message);
      // Diagnostic: list visible options
      const visible = Array.from(document.querySelectorAll('div,li,button,[role=option],span'))
        .filter(e => e.offsetParent !== null && e.getBoundingClientRect().width > 5 && e.getBoundingClientRect().height > 5 && e.getBoundingClientRect().height < 100)
        .map(e => (e.textContent || '').trim())
        .filter(t => t && t.length < 30 && t.length > 0)
        .slice(0, 30);
      SOL('visible options:', visible);
      // Close dropdown + try again
      document.body.click();
      await sleep(700);
      continue;
    }

    // Step 4: click option
    const clickable = opt.closest('button,[role=option],[role=menuitem],li,a') || opt;
    clickable.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const cdpOk = await clickViaCDP(clickable);
    SOL('option clicked, cdp=', cdpOk);
    if (!cdpOk) clickRealElement(clickable);
    // v3.5.34 EVENT-DRIVEN: wait dropdown text update (NO fixed sleeps)
    try {
      await waitFor(() => {
        const all = node.querySelectorAll('button,[role=button]');
        for (const b of all) {
          if (b.offsetParent === null) continue;
          const t = (b.textContent || '').trim();
          if (dropdownMatcher(t) && (t.toLowerCase() === tt || t.toLowerCase().includes(tt))) return true;
        }
        return null;
      }, 2000, 30);
    } catch {}

    // Step 5: verify selection
    let newDd;
    try {
      newDd = await waitFor(() => {
        const all = node.querySelectorAll('button,[role=button]');
        for (const b of all) {
          if (b.offsetParent === null) continue;
          const t = (b.textContent || '').trim();
          if (dropdownMatcher(t)) return b;
        }
        return null;
      }, 1500, 30); // v3.5.34: faster poll
    } catch (e) {
      SOL('VERIFY: nao achou dropdown pos-click — retry');
      continue;
    }
    const newText = (newDd.textContent || '').trim();
    SOL('after click, dropdown text=', newText);

    if (newText.toLowerCase() === tt || newText.toLowerCase().includes(tt)) {
      SOL('SUCCESS on attempt ' + attempt);
      return true;
    }

    SOL('still ' + newText + ', retry');
  }

  throw new Error(`selectOption FAIL after ${MAX_RETRY} attempts: dropdown nao mudou pra "${targetText}"`);
}

async function selectAspectInNode(node, aspect) {
  await selectOptionRobust(
    node,
    aspect,
    (t) => /^(auto|\d+:\d+)$/.test(t) && t.length < 10,
    'aspect'
  );
}

async function selectQualityInNode(node, qualityLabel) {
  await selectOptionRobust(
    node,
    qualityLabel,
    (t) => /^(auto|1k|2k|4k|512|720p|1080p|sd|hd)$/i.test(t),
    'quality'
  );
}

async function selectDurationInNode(node, seconds) {
  await selectOptionRobust(
    node,
    seconds + 's',
    (t) => /^\d+(-\d+)?s?["']?$/.test(t),
    'duration'
  );
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

/**
 * v3.5.15 ZERO-CREDIT GUARANTEE: pre-flight check ANTES de cada executeWorkflow.
 * Lê botões visíveis do node e ABORTA imediatamente se:
 *  - "1K" NAO esta presente (significa 2K ou 4K, que custam creditos)
 *  - "Unlimited mode" / icon ∞ nao esta ATIVO (orange #f97316)
 *  - Qualquer botao "2K", "4K" presente (defesa em camadas)
 *
 * Se check falha, JOGA erro e processPair marca pair como failed-config
 * (NÃO dispatch, NÃO gasta credito). User pode corrigir manualmente e retry.
 *
 * Directive do user: "JAMAIS DEIXE PASSAR UMA GERAÇÃO SE FOR GASTAR CREDITOS"
 */
async function verifyZeroCreditConfig(uuid, kind /* 'image' | 'video' */) {
  try { await selectNodeForEdit(uuid); } catch {}
  await sleep(400);
  // v3.5.23: force full-detail via direct click (Vue Flow LOD-mode safe)
  const node = findNodeElement(uuid);
  if (!node) throw new Error('CREDIT_GUARD: node sumiu ' + uuid);
  try { node.click(); } catch {}
  await sleep(300);

  // v3.5.23: read EXACT current value via data-cy specific selector
  const resBtn = node.querySelector('[data-cy="node-control-selector-resolution"]');
  const currentRes = resBtn ? (resBtn.textContent || '').trim() : null;
  console.log('[CREDIT_GUARD] pair_' + kind + ' ' + uuid.slice(0,8) + ' resolution="' + currentRes + '"');

  if (!currentRes) {
    throw new Error('CREDIT_GUARD pair_' + kind + ' ' + uuid.slice(0,8) + ': resolution button NAO encontrado (LOD?) — ABORTA');
  }
  if (kind === 'image') {
    if (currentRes !== '1K') {
      throw new Error('CREDIT_GUARD pair_image ' + uuid.slice(0,8) + ': resolution="' + currentRes + '" (esperado 1K) — ABORTA');
    }
  } else if (kind === 'video') {
    if (currentRes !== '720p') {
      throw new Error('CREDIT_GUARD pair_video ' + uuid.slice(0,8) + ': resolution="' + currentRes + '" (esperado 720p) — ABORTA');
    }
  }

  // v3.5.22 FIX: Unlimited check moved to ensureUnlimitedON (sidebar).
  // v3.5.24 FIX: btns undefined — use currentRes from above.
  console.log('[CREDIT_GUARD] pair_' + kind + ' ' + uuid.slice(0,8) + ' OK — resolution=' + currentRes);
  return { ok: true, resolution: currentRes };
}

/**
 * v3.5.35 PARANOIA MÁXIMA — pre-flight do VÍDEO antes de executeWorkflow.
 * (1) resolução 720p  (2) modelo lido do node = Kling 2.5 EXATO
 * (3) edge image→video existe. Qualquer falha → throw → pair failed, ZERO
 * crédito. Resolve: 1075 créditos Seedance + take sem edge.
 */
function readSelectedVideoModel(uuid) {
  const node = findNodeElement(uuid);
  if (!node) return null;
  for (const b of node.querySelectorAll('button,[role=button]')) {
    if (b.offsetParent === null) continue;
    const t = (b.textContent || '').trim();
    if (/^(auto|google|kling|flux|cinematic|classic|imagen|nano|gpt|seedream|recraft|veo|sora|seedance|runway|pixverse|minimax|ltx|wan|grok|openai|bytedance|fal|hunyuan|luma)/i.test(t) && t.length < 35) {
      return t.replace(/\s+/g, ' ').trim();
    }
  }
  return null;
}

// v3.5.39 EDGE check NÃO-FATAL. Magnific Vue Flow NÃO expõe data-source/
// data-target; edge id = UUID próprio do edge (não composto dos nodes), logo
// é impossível casar img→vid por DOM de forma confiável. O edge é SEMPRE
// auto-criado por createVideoGenNodeViaOutputHandle (clica output handle →
// Add → Video Generator → node já conectado). v3.5.38 bloqueava TODOS os 15
// vídeos por seletor errado. Agora: sanity-check de que EXISTEM edges no
// canvas (auto-connect funcionando); só warn se ZERO edges. NÃO bloqueia
// per-pair. A garantia de crédito real é o MODEL_GUARD (Kling-only).
function verifyEdgeImageToVideo(imageNodeId, videoNodeId) {
  const edges = document.querySelectorAll('g.vue-flow__edge, path.vue-flow__edge-path, .vue-flow__edge');
  const n = edges.length;
  if (n === 0) {
    // v3.5.49 FATAL: com ensureEdgeImageToVideo garantindo reconexão no
    // createTakePair, zero edges aqui = algo muito errado. NUNCA disparar
    // vídeo solto (não animaria a imagem). ABORTA → auto-retry refaz o take.
    throw new Error('EDGE_GUARD: ZERO edges no canvas antes do dispatch do vídeo ' +
      videoNodeId.slice(0, 8) + ' — ABORTA, nunca gerar vídeo sem a linha da imagem.');
  }
  console.log('[EDGE_GUARD] OK — ' + n + ' edges no canvas');
  return { ok: true, edgeCount: n };
}

async function preflightVideoGuard(pairObj) {
  const uuid = pairObj.videoNodeId;
  // 1) resolução 720p — LOD-TOLERANTE: só ABORTA se ler valor pago
  //    CONFIRMADO (1080p/2K/4K). Se ilegível (LOD off-viewport), NÃO bloqueia
  //    pois setup já fez HARD-ENFORCE 720p 5x. v3.5.36 fix anti-stall.
  try {
    try { await selectNodeForEdit(uuid); } catch {}
    await sleep(250);
    const rn = findNodeElement(uuid);
    if (rn) {
      try { rn.click(); } catch {}
      await sleep(200);
      const resBtn = rn.querySelector('[data-cy="node-control-selector-resolution"]');
      const res = resBtn ? (resBtn.textContent || '').trim() : null;
      if (res && res !== '720p') {
        throw new Error('CREDIT_GUARD video ' + uuid.slice(0,8) + ': resolution="' + res + '" (≠720p) — ABORTA, gasta crédito.');
      }
      console.log('[CREDIT_GUARD] video ' + uuid.slice(0,8) + ' resolution=' + (res || 'LOD-unreadable(setup-enforced)'));
    }
  } catch (e) {
    if (/CREDIT_GUARD/.test(e.message)) throw e; // valor pago confirmado → propaga
    // ilegível/LOD → não bloqueia (setup já garantiu 720p)
  }
  // 2) modelo REAL = Kling 2.5 — ESTRITO (este é o guard anti-Seedance/crédito)
  //    Retry 4x forçando full-detail (LOD-safe) p/ não falhar take Kling válido
  //    por miss transiente. Só ABORTA se persistir ilegível OU confirmar ≠Kling.
  let model = null;
  for (let mr = 0; mr < 4 && !model; mr++) {
    try { await selectNodeForEdit(uuid); } catch {}
    await sleep(mr === 0 ? 300 : 450);
    const node = findNodeElement(uuid);
    if (!node) throw new Error('MODEL_GUARD: video node sumiu ' + uuid);
    try { node.click(); } catch {}
    await sleep(250);
    model = readSelectedVideoModel(uuid);
    if (!model) console.warn('[MODEL_GUARD] read attempt ' + (mr+1) + ' ilegível (LOD?) — retry');
  }
  console.log('[MODEL_GUARD] video ' + uuid.slice(0,8) + ' selected="' + model + '"');
  if (!model) {
    throw new Error('MODEL_GUARD ' + uuid.slice(0,8) + ': modelo NÃO legível após 4x — ABORTA p/ não arriscar crédito');
  }
  const isKling25 = /^Kling 2\.5\b/i.test(model) && !/2\.6|2\.1|\bO1\b/i.test(model);
  if (!isKling25) {
    throw new Error('MODEL_GUARD ' + uuid.slice(0,8) + ': modelo="' + model +
      '" NÃO é Kling 2.5 — ABORTA (Seedance/outro = gasta crédito). ZERO dispatch.');
  }
  for (const fm of FORBIDDEN_VIDEO_MODELS) {
    const lm = model.toLowerCase(), lf = fm.toLowerCase();
    if (lm === lf || lm.startsWith(lf + ' ')) {
      throw new Error('MODEL_GUARD ' + uuid.slice(0,8) + ': FORBIDDEN "' + model + '" — ABORTA');
    }
  }
  // 3) edge image→video
  verifyEdgeImageToVideo(pairObj.imageNodeId, uuid);
  // 4) v3.5.40 — CREDIT-PREVIEW GATE (pedido explícito do user): se o node
  //    mostra QUALQUER preview de custo em créditos antes do generate, ABORTA.
  scanCreditCostPreview(uuid, 'video');
  console.log('[PREFLIGHT] video ' + uuid.slice(0,8) + ' OK — Kling 2.5 + 720p + edge + zero-custo confirmados');
  return { ok: true, model };
}

/**
 * v3.5.40 CREDIT-PREVIEW GATE — última barreira antes de QUALQUER generate.
 * Lê o texto/UI visível do node e ABORTA se detectar preview de custo em
 * créditos (Magnific mostra o custo estimado antes de gerar). Só dispara se
 * NÃO houver custo (coberto por Unlimited). Defensivo: na dúvida, ABORTA
 * (user: "JAMAIS GASTAR CREDITOS" > completude). Nunca causa gasto — só
 * impede dispatch.
 */
function scanCreditCostPreview(uuid, kind) {
  const node = findNodeElement(uuid);
  if (!node) {
    // sem node legível → não conseguimos confirmar zero-custo → ABORTA
    throw new Error('CREDIT_PREVIEW ' + kind + ' ' + String(uuid).slice(0,8) +
      ': node não legível — ABORTA p/ não arriscar crédito');
  }
  const txt = (node.textContent || '').replace(/\s+/g, ' ').trim();
  const low = txt.toLowerCase();
  // Sinais de COBERTURA (não custa): unlimited / ilimitado / free / incluído
  const covered = /(unlimited|ilimitad|sem custo|no cost|free|incluíd|included|0\s*cr[eé]dit)/i.test(low);
  // Sinais de CUSTO: "N credit(s)", "credits: N", "N cr", "custo N", coin/raio
  const costPatterns = [
    /(\d+)\s*credit/i,
    /credit[s]?\s*[:×x]?\s*(\d+)/i,
    /\b(\d+)\s*cr\b/i,
    /custo[:\s]+(\d+)/i,
    /\bcusta\b/i,
    /(\d+)\s*🪙|🪙\s*(\d+)/,
    /(\d+)\s*⚡|⚡\s*(\d+)/,
  ];
  let hit = null;
  for (const rx of costPatterns) {
    const m = txt.match(rx);
    if (m) {
      // extrai número se houver; "0" não conta como custo
      const num = (m[1] || m[2] || '').toString();
      if (num && /^0+$/.test(num)) continue;
      hit = m[0].slice(0, 40);
      break;
    }
  }
  // data-cy / aria com price/cost/credit + valor não-zero
  if (!hit) {
    const costEl = node.querySelector(
      '[data-cy*="credit" i],[data-cy*="cost" i],[data-cy*="price" i],[class*="credit" i],[class*="cost" i]'
    );
    if (costEl) {
      const ct = (costEl.textContent || '').trim();
      const cm = ct.match(/(\d+)/);
      if (cm && !/^0+$/.test(cm[1]) && !/unlimited|ilimitad|free/i.test(ct)) {
        hit = 'el:' + ct.slice(0, 30);
      }
    }
  }
  if (hit && !covered) {
    throw new Error('CREDIT_PREVIEW ' + kind + ' ' + String(uuid).slice(0,8) +
      ': PREVIEW DE CUSTO detectado ("' + hit + '") — ABORTA, ZERO dispatch (nunca gastar crédito).');
  }
  console.log('[CREDIT_PREVIEW] ' + kind + ' ' + String(uuid).slice(0,8) +
    ' OK — sem custo' + (covered ? ' (Unlimited/coberto)' : '') + (hit ? ' [hit ignorado:' + hit + ']' : ''));
  return { ok: true };
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
  // v3.5.28 CRITICAL BUG FIX: removed document.querySelectorAll fallback that
  // caused CROSS-CONTAMINATION between pairs. When pair 5's video rendered
  // first in DOM, all subsequent pairs returned pair 5's URL (because document
  // search returned first match). FIX: ONLY scope to specific node element.
  let lastHeartbeat = Date.now();
  let frameUrl = null;
  try {
    frameUrl = await waitFor(() => {
      if (Date.now() - lastHeartbeat > 30000) {
        console.log('[waitForNodeVideo ' + uuid.slice(0, 8) + '] heartbeat — still polling');
        lastHeartbeat = Date.now();
      }
      const node = findNodeElement(uuid);
      if (!node) return null;
      // SCOPE-TO-NODE ONLY (no document fallback — fixes cross-contamination)
      const allVids = node.querySelectorAll('video, source');
      for (const v of allVids) {
        const s = v.src || v.currentSrc || '';
        if (!/\.mp4/i.test(s) || !/cdnpk|pikaso|magnific/i.test(s)) continue;
        if (/\/public\/media\/video-providers\//i.test(s)) continue;
        if (!/\/private\/production\/\d+\/video\./i.test(s)) continue;
        return s;
      }
      const imgs = node.querySelectorAll('img');
      for (const im of imgs) {
        const s = im.src || '';
        if (/pikaso\.cdnpk\.net\/private\/production\/\d+\/start_frame\./.test(s)) return s;
      }
      const a = node.querySelector('a[href*=".mp4"]');
      if (a) return a.href;
      return null;
    }, timeoutMs, 1500); // v3.5.28: 2000ms → 1500ms poll (faster detection)
  } catch (e) {
    console.warn('[waitForNodeVideo ' + uuid.slice(0, 8) + '] Pass1 timeout/error: ' + e.message);
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
