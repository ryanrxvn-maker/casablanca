/**
 * DARKO LAB Magnific - Content Script
 * Roda em www.magnific.com/* — tem acesso aos cookies da sessao
 * (Premium+ obrigatorio). Faz requests pra API Magnific direto.
 *
 * ESTADO: endpoints REAIS ainda nao 100% mapeados.
 * - /v1/spaces (create space)         ← placeholder
 * - /v1/spaces/{id}/generations       ← placeholder
 * - /v1/generations/{id}              ← placeholder (poll status)
 *
 * Quando user fizer 1 generate manual com DevTools Network aberto:
 *   1. F12 → Network
 *   2. Click "Generate" no Magnific
 *   3. Filtra por "api" ou "generations"
 *   4. Copy as cURL → me cola
 *   5. Eu adapto endpoints exatos
 *
 * PUSH PATTERN pra resultados (evita 'channel closed' do SW hibernar):
 *   sendResponse({ accepted: true })  — sync ack
 *   chrome.runtime.sendMessage({ type: 'MG_TAB_RESULT', ... })  — async result
 */

const DARKO_MG_VERSION = '1.0.0';
if (window.__darkolab_magnific_loaded__) {
  console.log('[DARKO Magnific Content] JA carregado, skip v=' + DARKO_MG_VERSION);
} else {
  window.__darkolab_magnific_loaded__ = true;
  console.log('[DARKO Magnific Content] online v=' + DARKO_MG_VERSION);
}

const MG_API = 'https://api.magnific.com'; // PLACEHOLDER — confirmar
const PIKASO_API = 'https://pikaso.cdnpk.net'; // visto nas requests

async function fetchWithTimeout(url, opts = {}, timeoutMs = 30000) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal, credentials: 'include' });
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

  // PUSH PATTERN: ack imediato + manda result via sendMessage
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

// ========================= HANDLERS =========================

/** Testa sessao — chama /v1/me ou similar pra confirmar logado.
 *  REAL ENDPOINT a confirmar com primeira captura live. */
async function handleTestSession() {
  const candidates = [
    'https://api.magnific.com/v1/me',
    'https://www.magnific.com/api/v1/me',
    'https://magnific.com/api/v1/account.get',
    'https://www.magnific.com/api/v1/account.get',
  ];
  for (const url of candidates) {
    try {
      const r = await fetchWithTimeout(url, { method: 'GET' }, 5000);
      if (r.ok) {
        const j = await r.json().catch(() => null);
        return { ok: true, endpoint: url, sample: j };
      }
    } catch {}
  }
  throw new Error('Nenhum endpoint /me respondeu. Logado em magnific.com? Endpoints listados sao placeholders — captura 1 request real do app pra eu ajustar.');
}

/** Pega plano + status Premium+. Bloqueia automacao se nao for Premium+. */
async function handleGetPlan() {
  // Placeholder — adaptar quando user fornecer endpoint real
  return {
    tier: 'unknown',
    premiumPlus: false,
    warning: 'Endpoint plan/billing ainda nao mapeado. F12 no Magnific → Network → procura "/billing" ou "/subscription" → me cola.',
  };
}

/** Cria um Space novo pra uma task/AD.
 *  Payload: { name: 'AD15VN-PRPB06', projectId?: string } */
async function handleCreateSpace(payload) {
  const { name } = payload || {};
  if (!name) throw new Error('Sem name pro space.');
  // PLACEHOLDER endpoint
  const candidates = [
    { url: 'https://api.magnific.com/v1/spaces', method: 'POST', body: { name, type: 'board' } },
    { url: 'https://www.magnific.com/api/v1/spaces', method: 'POST', body: { name } },
  ];
  for (const c of candidates) {
    try {
      const r = await fetchWithTimeout(c.url, {
        method: c.method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(c.body),
      }, 15000);
      if (r.ok) {
        const j = await r.json();
        const spaceId = j?.id || j?.data?.id || j?.space_id;
        if (spaceId) return { spaceId, url: 'https://www.magnific.com/app/spaces/' + spaceId };
      }
    } catch {}
  }
  throw new Error('Endpoint create space nao mapeado. F12 → click "New space" no Magnific → capture o POST → me cola.');
}

/** Gera 1 imagem via Nano Banana 2 (1K, ilimitado no Premium+).
 *  Payload: { spaceId, prompt, model?: 'nano-banana-2' | 'nano-banana-pro' } */
async function handleGenerateImage(payload, onProgress) {
  const { spaceId, prompt, model = 'nano-banana-2' } = payload || {};
  if (!prompt) throw new Error('Sem prompt.');

  onProgress?.({ stage: 'submit', percent: 5, message: 'Submetendo prompt...' });
  // PLACEHOLDER — endpoint real precisa captura ao vivo
  const submitUrl = spaceId
    ? `https://api.magnific.com/v1/spaces/${spaceId}/generations`
    : 'https://api.magnific.com/v1/generations';
  let generationId = null;
  try {
    const r = await fetchWithTimeout(submitUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, model, type: 'image' }),
    }, 20000);
    if (!r.ok) throw new Error('submit HTTP ' + r.status);
    const j = await r.json();
    generationId = j?.id || j?.generation_id || j?.data?.id;
  } catch (e) {
    throw new Error('Endpoint generate image nao mapeado. Captura 1 generate manual pra eu adaptar. (' + e.message + ')');
  }
  if (!generationId) throw new Error('Sem generation_id no response.');

  // Poll status
  onProgress?.({ stage: 'polling', percent: 15, message: 'Aguardando geracao...' });
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    onProgress?.({ stage: 'polling', percent: 15 + Math.min(80, i * 1.5), message: `Polling ${i + 1}/60...` });
    try {
      const sr = await fetchWithTimeout(`https://api.magnific.com/v1/generations/${generationId}`, { method: 'GET' }, 8000);
      if (sr.ok) {
        const sj = await sr.json();
        const status = String(sj?.status || '').toLowerCase();
        const imageUrl = sj?.image_url || sj?.url || sj?.result?.url;
        if (status === 'completed' || status === 'done' || imageUrl) {
          onProgress?.({ stage: 'done', percent: 100, message: 'Imagem pronta.' });
          return { generationId, imageUrl };
        }
        if (status === 'failed' || status === 'error') {
          throw new Error('Geracao falhou: ' + (sj?.error || 'sem detalhes'));
        }
      }
    } catch (e) {
      if (String(e.message).includes('Geracao falhou')) throw e;
    }
  }
  throw new Error('Timeout 3min aguardando imagem.');
}

/** Anima 1 imagem via Kling 2.5 (720p, ilimitado Premium+).
 *  Payload: { spaceId, imageGenerationId, prompt?, model?: 'kling-2.5' } */
async function handleAnimateImage(payload, onProgress) {
  const { spaceId, imageGenerationId, imageUrl, prompt, model = 'kling-2.5' } = payload || {};
  if (!imageGenerationId && !imageUrl) throw new Error('Sem imagem fonte.');

  onProgress?.({ stage: 'submit', percent: 5, message: 'Submetendo animacao Kling...' });
  let videoGenerationId = null;
  try {
    const r = await fetchWithTimeout('https://api.magnific.com/v1/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'video',
        model,
        source_generation_id: imageGenerationId,
        source_image_url: imageUrl,
        prompt: prompt || '',
        space_id: spaceId,
      }),
    }, 20000);
    if (!r.ok) throw new Error('submit HTTP ' + r.status);
    const j = await r.json();
    videoGenerationId = j?.id || j?.generation_id;
  } catch (e) {
    throw new Error('Endpoint animate nao mapeado. Captura 1 animate real pra eu adaptar. (' + e.message + ')');
  }
  if (!videoGenerationId) throw new Error('Sem video generation_id no response.');

  // Poll — video demora mais (1-5 min)
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    onProgress?.({ stage: 'polling', percent: 10 + Math.min(85, i * 0.75), message: `Renderizando Kling 2.5 (${i + 1}/120)...` });
    try {
      const sr = await fetchWithTimeout(`https://api.magnific.com/v1/generations/${videoGenerationId}`, { method: 'GET' }, 8000);
      if (sr.ok) {
        const sj = await sr.json();
        const status = String(sj?.status || '').toLowerCase();
        const videoUrl = sj?.video_url || sj?.url || sj?.result?.url;
        if (status === 'completed' || status === 'done' || videoUrl) {
          onProgress?.({ stage: 'done', percent: 100, message: 'Video pronto.' });
          return { videoGenerationId, videoUrl };
        }
        if (status === 'failed' || status === 'error') {
          throw new Error('Animate falhou: ' + (sj?.error || 'sem detalhes'));
        }
      }
    } catch (e) {
      if (String(e.message).includes('Animate falhou')) throw e;
    }
  }
  throw new Error('Timeout 10min aguardando video.');
}

async function handleListGenerations(payload) {
  // Placeholder
  return { generations: [], warning: 'Endpoint list nao mapeado.' };
}

/** Baixa URL → retorna bytes como base64. Usado pra entregar ZIP pro user. */
async function handleDownloadAsset(payload) {
  const { url } = payload || {};
  if (!url) throw new Error('Sem url.');
  const r = await fetchWithTimeout(url, { method: 'GET' }, 120000);
  if (!r.ok) throw new Error('Download HTTP ' + r.status);
  const buf = await r.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return { base64: btoa(binary), size: bytes.length };
}
