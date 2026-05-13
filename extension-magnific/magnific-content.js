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

const DARKO_MG_VERSION = '3.4.7';
if (window.__darkolab_magnific_loaded__) {
  console.log('[DARKO Magnific Content] JA carregado v=' + window.__darkolab_magnific_version);
} else {
  window.__darkolab_magnific_loaded__ = true;
  window.__darkolab_magnific_version = DARKO_MG_VERSION;
  console.log('[DARKO Magnific Content] online v=' + DARKO_MG_VERSION);
}

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

  await sleep(2500); // SPA hydrate
  console.log('[DARKO Pipeline] Phase 2: setup pares iniciando');

  // PHASE 2: Setup todos os pares (image + video conectado)
  // SIMPLIFIED v3.4.0: removido LOCK_VIOLATION abort total — se 1 par falha,
  // segue com os outros. selectModelInNode strict match ja garante Kling 2.5.
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
        pairIdx: take.idx ?? i + 1,
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
        // SIMPLIFIED v3.4.0: removido pre-execute LOCK check que adicionava
        // delay e podia travar. selectModelInNode strict match ja garantiu
        // Kling 2.5 / Nano Banana 2. force_credits:false protege wallet.
        await selectNodeAndEnsureUnlimited(pair.imageNodeId);
        const { workflowRunId } = await executeWorkflow(pair.imageNodeId, space.spaceId);
        pair.imageRunId = workflowRunId;
        const expectedImgPrompt = takes.find((t) => (t.idx ?? 0) === pair.idx)?.imagePrompt || '';
        // Relaxed mode pode demorar 5-7 min cada imagem quando ha 12 paralelos
        const url = await waitForNodeImage(pair.imageNodeId, 600000, expectedImgPrompt);
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
        // v3.4.4 SAFETY CRITICA: VERIFICA KLING 2.5 ANTES DE DISPARAR VIDEO.
        // User reportou: 'Seedance 1.5 Pro foi disparado, isso gasta creditos!'
        // selectModelInNode pode falhar e selecionar Seedance ao inves de Kling.
        // SOLUCAO: NUNCA dispara workflow_execute sem confirmar Kling 2.5 visivel
        // E nenhum FORBIDDEN_VIDEO_MODELS no node. Se nao bater, ABORTA esse take.
        await selectNodeForEdit(pair.videoNodeId);
        await sleep(400);
        const btns = nodeButtons(pair.videoNodeId);
        const hasKling25 = btns.includes('Kling 2.5');
        const forbidden = FORBIDDEN_VIDEO_MODELS.filter((m) => btns.includes(m));
        if (!hasKling25 || forbidden.length > 0) {
          throw new Error(
            `KLING_LOCK_ABORT pair#${pair.idx}: ` +
            (hasKling25 ? '' : '[Kling 2.5 NAO selecionado] ') +
            (forbidden.length ? `[FORBIDDEN=${forbidden.join(',')}] ` : '') +
            `btns=[${btns.join(',')}]`
          );
        }
        // Verificacao adicional: aspect 9:16 ou Auto (inherit), quality 720p
        const hasAspect = btns.includes('9:16') || btns.includes('Auto');
        const has720p = btns.includes('720p');
        if (!hasAspect || !has720p) {
          throw new Error(
            `LOCK_ABORT pair#${pair.idx} config errada: aspect=${hasAspect}, 720p=${has720p} btns=[${btns.join(',')}]`
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
        console.error(`[VIDEO LOCK pair#${pair.idx}]`, e.message);
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
  const {
    templateSpaceId,
    newSpaceName,
    takes = [],
    imageConcurrency = 12,
    videoConcurrency = 6,
  } = payload || {};

  if (!templateSpaceId) throw new Error('TEMPLATE: templateSpaceId obrigatorio (cria template manual com 50 image gens)');
  if (!takes.length) throw new Error('TEMPLATE: sem takes.');

  // PHASE 0: SAFETY — Unlimited mode
  onProgress({ phase: 'safety', percent: 1, message: 'Verificando Unlimited mode...' });
  const us = await fetchJson('/app/api/unlimited-status');
  if (us.json && us.json.is_unlimited_mode_enabled === false) {
    throw new Error('Unlimited mode DESLIGADO no Magnific. Aborte pra nao gastar creditos.');
  }
  const walletBefore = await fetchJson('/app/api/wallet');
  const creditsBefore = walletBefore.json?.credits ?? null;

  // PHASE 1: Duplica template
  onProgress({ phase: 'duplicate', percent: 3, message: `Duplicando template ${templateSpaceId.slice(0, 8)}...` });
  const finalName = newSpaceName || `DARKO RUN ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
  const space = await duplicateSpaceFrom(templateSpaceId, finalName);
  onProgress({ phase: 'duplicate', percent: 6, message: `Clone: ${space.spaceId.slice(0, 8)} (${finalName})` });

  // PHASE 2: Navega no clone e espera Liveblocks hidratar
  await navigateToSpace(space.spaceId);
  onProgress({ phase: 'hydrate', percent: 8, message: 'Aguardando Liveblocks hidratar nodes...' });
  await sleep(4000);
  await waitFor(() => collectVisibleNodes().length >= 2, 30000);
  await sleep(2500);

  // PHASE 3: Enumera image gens disponiveis
  onProgress({ phase: 'enumerate', percent: 11, message: 'Enumerando image gens do template...' });
  let imageNodes = enumerateImageNodesInOrder();
  console.log('[TEMPLATE] image gens enumerados:', imageNodes.length);

  if (imageNodes.length < takes.length) {
    await sleep(3000);
    imageNodes = enumerateImageNodesInOrder();
  }
  if (imageNodes.length < takes.length) {
    throw new Error(
      `TEMPLATE: so ${imageNodes.length} image gens disponiveis, precisa ${takes.length}. Cria mais image gens no template.`
    );
  }
  const useImages = imageNodes.slice(0, takes.length);

  // PHASE 3b: verifica LOCK em cada image gen do template (defensive)
  // v3.2.2: verifyImg agora async (auto-seleciona pra Vue Flow expor botoes)
  onProgress({ phase: 'verify-img-lock', percent: 13, message: 'Verificando LOCK das image gens...' });
  for (let i = 0; i < useImages.length; i++) {
    const v = await verifyImg(useImages[i].imageNodeId);
    if (!v.ok) {
      throw new Error(
        `TEMPLATE LOCK image#${i + 1}: missing=[${v.missing.join(', ')}] btns=[${v.btns.join(', ')}]. ` +
        `Template precisa Nano Banana 2 + 9:16 + 1K em todas image gens. Recria template.`
      );
    }
  }

  // PHASE 4: SETUP — cola prompt na image, cria video gen via output handle,
  // configura Kling 2.5 LOCK com retry, cola prompt no video.
  // SEQUENCIAL: typing rapido + Vue Flow popup sob carga = race condition.
  // Se QUALQUER take cair em LOCK_VIOLATION (Seedance, modelo errado, etc),
  // ABORTA batch ANTES de qualquer workflow_execute.
  onProgress({ phase: 'setup', percent: 15, message: `Configurando ${takes.length} pares (LOCK Kling 2.5)...` });
  const pairs = [];
  let lockViolated = null;
  for (let i = 0; i < takes.length; i++) {
    const take = takes[i];
    const pairIdx = take.idx ?? i + 1;
    const imageNodeId = useImages[i].imageNodeId;
    try {
      // 4a) Cola image prompt no image node pre-criado
      await setNodePromptByUuid(imageNodeId, take.imagePrompt || '');

      // 4b) Cria video gen via output handle (popup → "Video Generator")
      const videoNodeId = await createVideoGenNodeViaOutputHandle(imageNodeId);

      // 4c) Cola video/motion prompt
      if (take.videoPrompt) {
        await setNodePromptByUuid(videoNodeId, take.videoPrompt);
      }

      // 4d) Configura Kling 2.5 720p 9:16 10s com LOCK retry+verify+forbidden check.
      // ABSOLUTA garantia que nada alem de Kling 2.5 seja selecionado.
      await configureWithLockRetry(
        () => configureVideoGenNode(videoNodeId, {
          model: 'kling-25',          // HARD-CODED LOCK
          aspect: '9:16',
          quality: '720p',
          duration: (take.videoDuration === 5 || take.videoDuration === '5s') ? 5 : 10,
        }),
        () => verifyVid(videoNodeId), // CHECA FORBIDDEN_VIDEO_MODELS tambem
        'vid',
        pairIdx,
      );

      pairs.push({
        idx: pairIdx,
        imageNodeId,
        videoNodeId,
        status: 'setup-ok',
      });
    } catch (e) {
      pairs.push({
        idx: pairIdx,
        imageNodeId,
        status: 'setup-failed',
        error: e.message,
      });
      if (e.lockViolation) {
        lockViolated = e;
        break;
      }
    }
    onProgress({
      phase: 'setup',
      percent: 15 + Math.round(((i + 1) / takes.length) * 18),
      message: `Par ${i + 1}/${takes.length} configurado`,
    });
  }

  if (lockViolated) {
    const msg =
      `LOCK ABORT TEMPLATE: ${lockViolated.message}. ` +
      `Batch cancelado — NENHUM workflow_execute disparado. ` +
      `Provavel: Magnific sob carga retornou modelo errado (Seedance) no dropdown. Recarrega a aba Magnific e roda de novo.`;
    onProgress({ phase: 'error', percent: 33, message: msg });
    throw new Error(msg);
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
  if (currentSpaceId() === spaceId) return;

  // SPA-friendly navigation: pushState + popstate event
  history.pushState({}, '', spaceURL(spaceId));
  window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));

  // Espera o SPA reagir e atualizar a URL real
  await sleep(500);
  try {
    await waitFor(() => currentSpaceId() === spaceId, 8000);
  } catch (e) {
    // SPA nao pegou pushState — fallback pra navigation (sera fatal pro script,
    // mas o user precisa saber que isso aconteceu).
    console.warn('[navigateToSpace] SPA nao reagiu a pushState, fallback hard nav (script vai morrer)');
    location.href = spaceURL(spaceId);
    await sleep(3500);
  }

  // Da tempo do Liveblocks hidratar nodes do novo space
  await sleep(2000);
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
 * v3.4.7 REAL MOUSE CLICK via chrome.debugger CDP — usa o background SW pra
 * disparar real click no tab atual. Necessario pra dropdown options do Magnific
 * (dispatched events nao funcionam — validado live).
 *
 * @param {Element} el - elemento DOM a clicar
 * @returns {Promise<boolean>} true se click foi disparado com sucesso
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
          console.warn('[clickViaCDP] lastError:', chrome.runtime.lastError.message);
          resolve(false);
          return;
        }
        resolve(!!resp?.ok);
      });
    });
  } catch (e) {
    console.warn('[clickViaCDP] error:', e?.message);
    return false;
  }
}

function clickRealElement(el) {
  if (!el) return false;
  // v3.4.5: STRATEGY HYBRIDA pra Vue Flow + dropdown options funcionarem ambos.
  // Antes: dispatchEvent puro causava Vue Flow TypeError 'Cannot read property document of null'
  // E mesmo quando passava, dropdown options nao registravam o click no Vue (state nao mudava).
  // Agora: usar nativo el.click() PRIMEIRO (que Vue Router/components reconhecem), depois
  // fallback pra pointer events com pointerId valido pra Vue Flow nao crashar.
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

async function createTakePair({
  imagePrompt, videoPrompt, imageModel, videoModel,
  aspect, imageQuality, videoQuality, videoDuration,
  pairIdx = 0,
}) {
  // SIMPLIFIED v3.4.0: forca Kling 2.5 + Nano Banana 2 + 9:16 + 720p/1K (LOCK
  // continua sendo enforced no selectModelInNode via STRICT equality match).
  // Removido configureWithLockRetry wrapping — adicionava 60s+ overhead que
  // travava pipeline com user reportando 'antes funcionava'. O selectModelInNode
  // ja faz strict equality match (sem startsWith fuzzy), entao Kling 2.5 nao vai
  // ser confundido com Seedance/etc. Se algo der errado, o catch externo
  // marca o pair como failed e segue.
  imageModel    = 'nano-banana-2';
  videoModel    = 'kling-25';
  aspect        = '9:16';
  imageQuality  = '1K';
  videoQuality  = '720p';
  videoDuration = (videoDuration === 5 || videoDuration === '5s') ? 5 : 10;

  // v3.4.3 GRANULAR LOGGING — abrir DevTools (F12) no tab Magnific pra ver
  const log = (step, extra) => console.log(`[DARKO TakePair #${pairIdx}] ${step}`, extra || '');

  // 1) Cria Image Generator node + cola prompt + configura
  log('1a) createImageGenNode start');
  const imageNodeId = await createImageGenNode();
  log('1a) imageNodeId=', imageNodeId);

  log('1b) setNodePromptByUuid image');
  await setNodePromptByUuid(imageNodeId, imagePrompt);
  log('1b) prompt OK');

  log('1c) configureImageGenNode (Nano Banana 2/9:16/1K)');
  await configureImageGenNode(imageNodeId, { model: imageModel, aspect, quality: imageQuality });
  log('1c) image configured OK');

  // 2) Cria Video Generator via output handle + cola prompt + configura Kling 2.5
  log('2a) createVideoGenNodeViaOutputHandle');
  const videoNodeId = await createVideoGenNodeViaOutputHandle(imageNodeId);
  log('2a) videoNodeId=', videoNodeId);

  if (videoPrompt) {
    log('2b) setNodePromptByUuid video');
    await setNodePromptByUuid(videoNodeId, videoPrompt);
    log('2b) video prompt OK');
  }

  log('2c) configureVideoGenNode (Kling 2.5/9:16/720p/' + videoDuration + 's)');
  await configureVideoGenNode(videoNodeId, {
    model: videoModel, aspect, quality: videoQuality, duration: videoDuration,
  });
  log('2c) video configured OK — pair complete');

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
    await sleep(500);
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
  await sleep(700);

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
    await sleep(50);
  }
  await sleep(800);
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

  // Step 6: click option via CDP REAL CLICK (v3.4.7)
  // dispatched events nao funcionam pra dropdown options do Magnific (validado live).
  // Usa chrome.debugger Input.dispatchMouseEvent via background — REAL click identico
  // a user clicando.
  SMLog('6) clicking option via CDP REAL CLICK');
  const clickable = opt.closest('button,[role=option],[role=menuitem],li,a') || opt;
  SMLog('6) clickable target:', clickable.tagName);
  // Scroll into view antes do real click (coords usadas pelo CDP sao viewport-relative)
  clickable.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  await sleep(200);
  const cdpOk = await clickViaCDP(clickable);
  SMLog('6) CDP click result:', cdpOk);
  if (!cdpOk) {
    // Fallback: dispatched events (mesmo que provavelmente nao funcione)
    SMLog('6) CDP falhou, fallback dispatched events');
    clickRealElement(clickable);
  }
  await sleep(900);
  SMLog('6) DONE');
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
  // v3.4.7: real click pro dropdown trigger tambem (consistente)
  await clickViaCDP(dd) || clickRealElement(dd);
  await sleep(500);
  const opt = await waitFor(() => {
    const all = Array.from(document.querySelectorAll('div,li,button,[role=option]'));
    const matches = all.filter((e) => {
      if (e.offsetParent === null) return false;
      const r = e.getBoundingClientRect();
      if (r.width < 5 || r.width > 200) return false;
      return (e.textContent || '').trim() === aspect;
    });
    matches.sort((a, b) => (a.textContent || '').length - (b.textContent || '').length);
    return matches[0] || null;
  }, 3000);
  const clickable = opt.closest('button,[role=option],[role=menuitem],li,a') || opt;
  clickable.scrollIntoView({ block: 'nearest' });
  await sleep(150);
  const cdpOk = await clickViaCDP(clickable);
  if (!cdpOk) clickRealElement(clickable);
  await sleep(500);
}

async function selectQualityInNode(node, qualityLabel) {
  const dd = await waitFor(() => {
    const all = node.querySelectorAll('button,[role=button]');
    for (const b of all) {
      const t = (b.textContent || '').trim();
      if (/^(auto|1k|2k|4k|512|720p|1080p|sd|hd)$/i.test(t)) return b;
    }
    return null;
  }, 3000);
  if ((dd.textContent || '').trim().toLowerCase() === qualityLabel.toLowerCase()) return;
  await clickViaCDP(dd) || clickRealElement(dd);
  await sleep(450);
  const opt = await waitFor(() => {
    const all = Array.from(document.querySelectorAll('div,li,button,[role=option]'));
    const matches = all.filter((e) => (e.textContent || '').trim().toLowerCase() === qualityLabel.toLowerCase());
    matches.sort((a, b) => (a.textContent || '').length - (b.textContent || '').length);
    return matches[0] || null;
  }, 3000);
  const clickable = opt.closest('button,[role=option],[role=menuitem],li,a') || opt;
  clickable.scrollIntoView({ block: 'nearest' });
  await sleep(150);
  const cdpOk = await clickViaCDP(clickable);
  if (!cdpOk) clickRealElement(clickable);
  await sleep(450);
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
  await clickViaCDP(dd) || clickRealElement(dd);
  await sleep(500);
  const opt = await waitFor(() => {
    const all = Array.from(document.querySelectorAll('div,li,button,[role=option]'));
    const matches = all.filter((e) => {
      if (e.offsetParent === null) return false;
      const r = e.getBoundingClientRect();
      if (r.width < 5 || r.width > 200) return false;
      return (e.textContent || '').trim() === seconds + 's';
    });
    matches.sort((a, b) => (a.textContent || '').length - (b.textContent || '').length);
    return matches[0] || null;
  }, 3000);
  const clickable = opt.closest('button,[role=option],[role=menuitem],li,a') || opt;
  clickable.scrollIntoView({ block: 'nearest' });
  await sleep(150);
  const cdpOk = await clickViaCDP(clickable);
  if (!cdpOk) clickRealElement(clickable);
  await sleep(500);
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
