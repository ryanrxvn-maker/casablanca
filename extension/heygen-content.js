/**
 * DARKO LAB Extension — Content Script HeyGen
 *
 * Roda em app.heygen.com. Recebe comandos do background worker pra
 * automatizar a UI do HeyGen: digitar copy, escolher avatar/voz, gerar,
 * polar status, retornar URL final.
 *
 * AVISO IMPORTANTE: HeyGen pode mudar seletores DOM a qualquer momento.
 * Esse content script e best-effort — se quebrar, atualizar os seletores.
 *
 * Estrategia:
 *  1. Navegar pra /create-video (Script-to-Video)
 *  2. Aguardar elementos carregarem
 *  3. Selecionar avatar via API interna do HeyGen (mais robusto que clicks)
 *  4. Inserir texto no textarea de script
 *  5. Selecionar voice id (se override)
 *  6. Clicar Generate
 *  7. Capturar request POST de generation, extrair video_id
 *  8. Polar GET /api/v1/video.status ate completed
 *  9. Retornar video_url
 */

// GUARD: previne injecao dupla (manifest content_scripts + auto-inject via
// chrome.scripting.executeScript). Quando ha 2 listeners ambos retornando
// "true" pra async response, Chrome fecha o canal com:
//   "A listener indicated an asynchronous response by returning true, but
//    the message channel closed before a response was received"
// Versao do content-script. Page pode checar via {type:'HG_VERSION'} ou
// no campo _extVersion de qualquer resposta de proxy. Bumpar a cada mudanca
// de proxy/protocolo pra forcar usuario a recarregar extensao.
const DARKO_EXT_VERSION = '4.13.0';
if (window.__darkolab_heygen_loaded__) {
  console.log('[DARKO LAB] content script JA carregado — skip duplicate inject (v=' + DARKO_EXT_VERSION + ')');
} else {
  window.__darkolab_heygen_loaded__ = true;
  console.log('[DARKO LAB] content script carregado v=' + DARKO_EXT_VERSION);

// Pede pro background injetar o interceptor de fetch+XHR no MAIN WORLD
// via chrome.scripting.executeScript (Manifest V3 - bypassa CSP do HeyGen
// e nao precisa de inject.js no disco).
(function requestInterceptorInjection() {
  try {
    chrome.runtime.sendMessage({ type: 'HG_INJECT_INTERCEPTOR' }, () => {
      if (chrome.runtime.lastError) {
        console.warn('[DARKO LAB] background nao respondeu pra inject:', chrome.runtime.lastError.message);
      } else {
        console.log('[DARKO LAB] background ack pra inject interceptor');
      }
    });
  } catch (e) {
    console.warn('[DARKO LAB] erro pedindo inject ao background:', e);
  }
})();

// Buffer dos video_ids interceptados pelo inject.js (ordem cronologica)
const interceptedVideoIds = [];
// Ultimo submit body NATIVO do HeyGen capturado (Espelhamento de Voz etc).
// Em memoria + persistido em chrome.storage pra o web app auto-aprender o
// shape real do voice mirror via HG_GET_LAST_SUBMIT.
let lastNativeSubmit = null;
window.addEventListener('message', (ev) => {
  const d = ev.data;
  if (!d || typeof d !== 'object' || d.source !== 'darkolab-injected') return;
  if (d.type === 'VIDEO_GENERATED' && d.video_id) {
    console.log('[DARKO LAB] video_id interceptado:', d.video_id, 'via', d.source_method, '->', d.url);
    interceptedVideoIds.push({ id: d.video_id, ts: d.ts, url: d.url });
    return;
  }
  if (d.type === 'SUBMIT_BODY_CAPTURED' && d.submitBody) {
    const rec = { url: d.submitUrl, body: d.submitBody, via: d.via, hasMirror: !!d.hasMirror, ts: d.ts || Date.now() };
    lastNativeSubmit = rec;
    // Prioriza guardar o que TEM mirror — nao deixa um submit sem mirror
    // sobrescrever o payload-ouro ja capturado.
    try {
      chrome.storage?.local?.get(['darkolab_lastSubmit'], (cur) => {
        const prev = cur?.darkolab_lastSubmit;
        if (prev?.hasMirror && !rec.hasMirror) return; // nao degrada
        chrome.storage.local.set({ darkolab_lastSubmit: rec });
      });
    } catch (e) {}
    console.log(`[DARKO LAB] 🎯 submit nativo capturado${rec.hasMirror ? ' (TEM voice mirror)' : ''} — disponivel via HG_GET_LAST_SUBMIT`);
  }
});

const SELECTORS = {
  scriptTextarea:
    'textarea[placeholder*="script" i], textarea[placeholder*="texto" i], div[contenteditable="true"]',
  generateButton: 'button[type="submit"], button:has(span:contains("Generate")), button.submit-btn',
};

let currentJob = null;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Ping pra background verificar que content script esta vivo
  if (msg && msg.type === 'HG_PING') {
    sendResponse({ ok: true, version: chrome.runtime.getManifest().version });
    return false;
  }
  if (msg && msg.type === 'HG_RUN_JOB') {
    runJob(msg.requestId, msg.payload).catch((err) => {
      reportError(msg.requestId, err?.message ?? String(err));
    });
    return false;
  }
  if (msg && msg.type === 'HG_RUN_STUDIO_JOB') {
    // VA de avatar: fluxo HeyGen Studio cena-por-cena com Mirror voice.
    // NAO usar pra task normal — esse path e exclusivo de Variacao de Avatar.
    runStudioJob(msg.requestId, msg.payload).catch((err) => {
      reportError(msg.requestId, err?.message ?? String(err));
    });
    return false;
  }
  if (msg && msg.type === 'HG_TEST_SESSION') {
    testSession()
      .then((res) => sendResponse(res))
      .catch((e) =>
        sendResponse({ ok: false, detail: e?.message ?? String(e) }),
      );
    return true;
  }
  if (msg && msg.type === 'HG_API_FETCH') {
    // PROXY: faz fetch a api2.heygen.com com cookies da aba HeyGen
    // (Origin = app.heygen.com). Retorna { status, ok, body, _uploadedBytes }.
    proxyApiFetch(msg.req).then((res) => sendResponse(res), (e) => {
      sendResponse({ status: 0, ok: false, body: { message: String(e?.message || e), _extVersion: DARKO_EXT_VERSION } });
    });
    return true; // resposta async
  }
  if (msg && msg.type === 'HG_VERSION') {
    sendResponse({ ok: true, version: DARKO_EXT_VERSION });
    return true;
  }
  if (msg && msg.type === 'HG_GET_LAST_SUBMIT') {
    // Retorna o ultimo submit NATIVO do HeyGen capturado pelo inject.js
    // (payload-ouro do Espelhamento de Voz). Le da memoria; fallback storage.
    if (lastNativeSubmit) {
      sendResponse({ ok: true, submit: lastNativeSubmit });
      return false;
    }
    try {
      chrome.storage?.local?.get(['darkolab_lastSubmit'], (cur) => {
        sendResponse({ ok: !!cur?.darkolab_lastSubmit, submit: cur?.darkolab_lastSubmit || null });
      });
      return true; // async
    } catch (e) {
      sendResponse({ ok: false, submit: null });
      return false;
    }
  }
  if (msg && msg.type === 'HG_LIST_AVATARS') {
    console.log('[DARKO LAB] >>> HG_LIST_AVATARS message received reqId=', msg.requestId);
    // PUSH PATTERN: ack imediato + manda resultado via mensagem separada.
    // Evita o bug de service worker do background hibernar durante o await
    // (que fecha o port com 'channel closed before a response was received').
    sendResponse({ accepted: true });
    const reqId = msg.requestId;
    listMyAvatars()
      .then((res) => {
        console.log('[DARKO LAB] <<< listMyAvatars done, pushing HG_TAB_AVATARS_RESULT items=', res?.avatars?.length);
        chrome.runtime.sendMessage({
          type: 'HG_TAB_AVATARS_RESULT',
          requestId: reqId,
          ok: !!res?.ok,
          avatars: res?.avatars ?? [],
          groups: res?.groups ?? [],
          error: res?.error ?? null,
          apiSource: res?.source ?? null,
        }).catch((e) => console.warn('[DARKO LAB] push avatars sendMessage err:', e?.message ?? e));
      })
      .catch((e) => {
        console.error('[DARKO LAB] !!! listMyAvatars REJECTED:', e);
        chrome.runtime.sendMessage({
          type: 'HG_TAB_AVATARS_RESULT',
          requestId: reqId,
          ok: false,
          avatars: [],
          groups: [],
          error: e?.message ?? String(e),
        }).catch(() => {});
      });
    return false; // ja respondemos sync
  }
  if (msg && msg.type === 'HG_LIST_VOICES') {
    listMyVoices()
      .then((res) => sendResponse(res))
      .catch((e) =>
        sendResponse({ ok: false, error: e?.message ?? String(e), voices: [] }),
      );
    return true;
  }
  if (msg && msg.type === 'HG_GET_CREDITS') {
    getHeyGenCredits()
      .then((res) => sendResponse(res))
      .catch((e) => sendResponse({ ok: false, error: e?.message ?? String(e) }));
    return true;
  }
  if (msg && msg.type === 'HG_CREATE_PHOTO_AVATAR') {
    // PUSH PATTERN: ack imediato + manda resultado via mensagem separada
    sendResponse({ accepted: true });
    const reqId = msg.requestId;
    createPhotoAvatar(msg.payload, (progress) => {
      chrome.runtime.sendMessage({
        type: 'HG_TAB_PHOTO_AVATAR_PROGRESS',
        requestId: reqId,
        stage: progress.stage,
        percent: progress.percent,
        message: progress.message,
      }).catch(() => {});
    })
      .then((res) => {
        chrome.runtime.sendMessage({
          type: 'HG_TAB_PHOTO_AVATAR_RESULT',
          requestId: reqId,
          ok: true,
          ...res,
        }).catch(() => {});
      })
      .catch((e) => {
        console.error('[DARKO LAB photo avatar] FAIL:', e);
        chrome.runtime.sendMessage({
          type: 'HG_TAB_PHOTO_AVATAR_RESULT',
          requestId: reqId,
          ok: false,
          error: e?.message ?? String(e),
        }).catch(() => {});
      });
    return false;
  }
  if (msg && msg.type === 'HG_CLONE_VOICE') {
    // PUSH PATTERN: ack imediato + manda resultado via mensagem separada
    // (clone pode demorar 20-60s e SW background hiberna no await).
    sendResponse({ accepted: true });
    const reqId = msg.requestId;
    cloneVoice(msg.payload, (progress) => {
      chrome.runtime.sendMessage({
        type: 'HG_TAB_CLONE_VOICE_PROGRESS',
        requestId: reqId,
        stage: progress.stage,
        percent: progress.percent,
        message: progress.message,
      }).catch(() => {});
    })
      .then((res) => {
        chrome.runtime.sendMessage({
          type: 'HG_TAB_CLONE_VOICE_RESULT',
          requestId: reqId,
          ok: true,
          voiceId: res.voiceId,
          voiceName: res.voiceName,
        }).catch(() => {});
      })
      .catch((e) => {
        console.error('[DARKO LAB voice clone] FAIL:', e);
        chrome.runtime.sendMessage({
          type: 'HG_TAB_CLONE_VOICE_RESULT',
          requestId: reqId,
          ok: false,
          error: e?.message ?? String(e),
        }).catch(() => {});
      });
    return false;
  }
});

/* ============================ VOICE CLONE ============================
 * Fluxo (4 endpoints, descobertos via engenharia reversa do bundle
 * voice-mB23DmLV.js do HeyGen — Nov/2025):
 *
 *   1. POST /v1/pacific/voice_clone/voice.get_upload_url
 *      Body: { request_source: 'IVC', ... }
 *      Resp: { data: { upload_url, file_url, ... } }
 *
 *   2. PUT <upload_url>
 *      Body: <binary do audio>
 *      Headers: Content-Type apropriado
 *
 *   3. POST /v2/voice/voice_clone/create
 *      Body: { name, audio_url, ... denoise/remove flags ... }
 *      Resp: { data: { voice_id | callback_id } }
 *
 *   4. GET /v1/voice/voice_clone/create_status?callback_id=...
 *      Poll ate status === 'completed' / 'ready'.
 *
 * Aceita audio (mp3/wav) OU video (mp4/mov/webm) — HeyGen extrai audio
 * server-side. Se for video, ainda preferimos extrair audio antes via
 * ffmpeg-worker do DARKO LAB pra reduzir bytes uploaded.
 *
 * Flags noise/music: removeBackgroundNoise + removeBackgroundMusic
 * mapeiam pros campos `denoise` / `remove_background_music` do HeyGen
 * (nomes inferidos — se quebrar, ajustar a partir de erro 400). */

const VOICE_CLONE_POLL_INTERVAL_MS = 3000;
const VOICE_CLONE_POLL_MAX_ATTEMPTS = 120; // 6 min total

async function cloneVoice(payload, onProgress) {
  const {
    audioBase64,
    filename = 'voice.wav',
    displayName,
    mimeType = 'audio/wav',
    removeBackgroundNoise = true,
    removeBackgroundMusic = true,
    language = null,
    model = 'V3',
  } = payload || {};

  if (!audioBase64) throw new Error('Sem audio (audioBase64 vazio).');
  if (!displayName) throw new Error('Sem displayName (nome do clone).');

  // Decode base64 → Uint8Array
  const bin = atob(audioBase64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  console.log('[DARKO LAB voice clone] start', { filename, displayName, sizeBytes: bytes.length, removeBackgroundNoise, removeBackgroundMusic });

  // === STEP 1: get_upload_url ===
  onProgress?.({ stage: 'get_upload_url', percent: 5, message: 'Pedindo URL de upload...' });
  const uploadUrlResp = await fetchWithTimeout(
    'https://api2.heygen.com/v1/pacific/voice_clone/voice.get_upload_url',
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        request_source: 'IVC',
        filename,
        file_type: mimeType,
        file_size: bytes.length,
        // is_video: true se mimeType ou filename indicar video. False = audio puro.
        // Nos extraimos audio do video antes do upload no bridge do DARKO LAB
        // (ffmpeg-worker.extractAudio), entao isso aqui sempre vai ser false
        // — mas mantemos a logica resiliente caso futuro mude.
        is_video: /^video\//.test(mimeType) || /\.(mp4|mov|webm|mkv)$/i.test(filename),
      }),
    },
    15000,
  );
  if (!uploadUrlResp.ok) {
    const errBody = await uploadUrlResp.text().catch(() => '');
    throw new Error(`get_upload_url HTTP ${uploadUrlResp.status}: ${errBody.slice(0, 300)}`);
  }
  const uploadUrlJson = await uploadUrlResp.json();
  // HeyGen retorna `file_upload_url` (URL S3 presigned com query params de auth)
  // e tipicamente algum field tipo `key`, `file_path`, ou `file_url` pro caminho
  // final. Fallback resiliente em todos.
  const d = uploadUrlJson?.data || {};
  const uploadUrl = d.file_upload_url || d.upload_url || d.put_url || d.url;
  // file_url = URL final do arquivo apos upload (S3 sem signature). Se o
  // HeyGen nao retornar um separado, derivamos do file_upload_url tirando
  // os query params (?X-Amz-...).
  const fileUrl = d.file_url
    || d.audio_url
    || d.asset_url
    || d.file_path
    || d.key
    || (uploadUrl ? uploadUrl.split('?')[0] : null);
  if (!uploadUrl) throw new Error('Sem upload_url no response. Keys: ' + Object.keys(d).join(','));
  console.log('[DARKO LAB voice clone] got upload_url, fileUrl=', fileUrl?.slice(0, 100), 'allKeys=', Object.keys(d).join(','));

  // === STEP 2: PUT no S3 ===
  // S3 presigned URL valida signature contra TODOS os headers inclusos em
  // X-Amz-SignedHeaders. HeyGen assina tipicamente:
  //   host;x-amz-server-side-encryption
  // Precisamos enviar EXATAMENTE esses (host vai automatico, mas o
  // x-amz-server-side-encryption = AES256 precisa ser explicito).
  // Se algum header signed nao for mandado OU mandado com valor diferente,
  // S3 retorna 403 SignatureDoesNotMatch.
  let signedHeaders = '';
  try {
    const u = new URL(uploadUrl);
    signedHeaders = (u.searchParams.get('X-Amz-SignedHeaders') || '').toLowerCase();
  } catch {}
  const putHeaders = {};
  const signedList = signedHeaders.split(';').map(s => s.trim()).filter(Boolean);
  for (const sh of signedList) {
    if (sh === 'host') continue; // browser manda automatico
    if (sh === 'content-type') putHeaders['Content-Type'] = mimeType;
    else if (sh === 'x-amz-server-side-encryption') putHeaders['x-amz-server-side-encryption'] = 'AES256';
    else if (sh === 'content-length') {} // browser calcula
    else if (sh.startsWith('x-amz-')) {
      // Header AWS desconhecido — log mas nao manda (talvez quebre)
      console.warn('[DARKO LAB voice clone] header signed desconhecido:', sh);
    }
  }
  console.log('[DARKO LAB voice clone] PUT signedHeaders=', signedHeaders, 'sending headers=', Object.keys(putHeaders));
  onProgress?.({ stage: 'upload', percent: 20, message: `Subindo ${(bytes.length / (1024 * 1024)).toFixed(1)}MB pro S3...` });
  const putResp = await fetchWithTimeout(
    uploadUrl,
    {
      method: 'PUT',
      body: bytes,
      headers: putHeaders,
    },
    120000, // 2 min pra upload
  );
  if (!putResp.ok) {
    const errBody = await putResp.text().catch(() => '');
    throw new Error(`PUT S3 HTTP ${putResp.status} (signedHeaders=${signedHeaders}): ${errBody.slice(0, 300)}`);
  }
  console.log('[DARKO LAB voice clone] PUT OK');

  // === STEP 3: create voice clone ===
  onProgress?.({ stage: 'create', percent: 55, message: 'Criando clone no HeyGen...' });
  const createBody = {
    voice_name: displayName,     // <-- nome correto (descoberto iter 6)
    name: displayName,           // <-- alias pra safety
    file_url: fileUrl,           // <-- nome correto (descoberto iter 5)
    audio_url: fileUrl,          // <-- alias pra safety
    request_source: 'IVC',
    is_video: false,
  };
  // Flags pra remover ruido/musica de fundo — nomes inferidos do bundle
  if (removeBackgroundNoise) createBody.denoise = true;
  if (removeBackgroundMusic) createBody.remove_background_music = true;
  if (language) createBody.language = language;
  // Modelo do clone — HeyGen aceita 'V3' (default), 'V2' (legacy), 'multilingual'.
  // Mandamos varias keys redundantes (HeyGen acerta uma) pra robustez.
  if (model) {
    const mUpper = String(model).toUpperCase();
    createBody.model = mUpper === 'MULTILINGUAL' ? 'multilingual' : mUpper;
    createBody.model_id = createBody.model;
    createBody.voice_model = createBody.model;
    createBody.engine = createBody.model;
  }

  const createResp = await fetchWithTimeout(
    'https://api2.heygen.com/v2/voice/voice_clone/create',
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createBody),
    },
    30000,
  );
  if (!createResp.ok) {
    const errBody = await createResp.text().catch(() => '');
    throw new Error(`create HTTP ${createResp.status}: ${errBody.slice(0, 300)}`);
  }
  const createJson = await createResp.json();
  const createData = createJson?.data || {};
  const voiceIdImmediate = createData.voice_id;
  // HeyGen retorna `job_id` no response (descoberto iter 7). Fallback
  // resiliente em varios nomes (varia por endpoint version).
  const callbackId = createData.job_id || createData.callback_id || createData.id;
  console.log('[DARKO LAB voice clone] create resp', { voiceIdImmediate, callbackId, keys: Object.keys(createData) });

  // === STEP 4: poll status ===
  if (voiceIdImmediate) {
    onProgress?.({ stage: 'done', percent: 100, message: 'Pronto' });
    return { voiceId: voiceIdImmediate, voiceName: displayName };
  }
  if (!callbackId) throw new Error('Sem job_id/callback_id/voice_id no response do create. Keys: ' + Object.keys(createData).join(','));

  for (let attempt = 0; attempt < VOICE_CLONE_POLL_MAX_ATTEMPTS; attempt++) {
    await new Promise((r) => setTimeout(r, VOICE_CLONE_POLL_INTERVAL_MS));
    const percent = 60 + Math.min(35, attempt * 1.5);
    onProgress?.({ stage: 'polling', percent, message: `Aguardando processamento (${attempt + 1}/${VOICE_CLONE_POLL_MAX_ATTEMPTS})...` });
    // Manda job_id E callback_id (mesma value) — HeyGen aceita um ou outro
    // dependendo da versao do endpoint
    const statusUrl = `https://api2.heygen.com/v1/voice/voice_clone/create_status?job_id=${encodeURIComponent(callbackId)}&callback_id=${encodeURIComponent(callbackId)}`;
    const statusResp = await fetchWithTimeout(statusUrl, { method: 'GET', credentials: 'include' }, 10000)
      .catch((e) => { console.warn('[DARKO LAB voice clone] poll err:', e); return null; });
    if (!statusResp || !statusResp.ok) continue;
    const statusJson = await statusResp.json().catch(() => null);
    const sd = statusJson?.data || {};
    const status = String(sd.status || sd.state || '').toLowerCase();
    const vid = sd.voice_id || sd.id;
    console.log('[DARKO LAB voice clone] poll', attempt, 'status=', status, 'voice_id=', vid, 'keys=', Object.keys(sd).join(','));
    if (status === 'completed' || status === 'ready' || status === 'success' || status === 'done') {
      if (!vid) throw new Error('Status completed mas sem voice_id. Keys: ' + Object.keys(sd).join(','));
      onProgress?.({ stage: 'done', percent: 100, message: 'Pronto' });
      return { voiceId: vid, voiceName: displayName };
    }
    if (status === 'failed' || status === 'error') {
      throw new Error('HeyGen voice clone falhou: status=' + status + ' msg=' + (sd.error_msg || sd.message || 'sem detalhes'));
    }
  }
  throw new Error('Voice clone timeout — HeyGen nao respondeu completed em 6min');
}

/**
 * Lista vozes da conta HeyGen (custom + favoritas) via cookies de sessao.
 */
/**
 * Pega saldo de creditos HeyGen via /v1/pacific/account.get (cookies sessao).
 * Retorna:
 *   plan_credit.amount / .total — creditos pagos do plano (pra Avatar IV/V)
 *   unlimited_regular.amount / .total — slots "priority" Avatar III
 *   plan_name, tier, is_unlimited, is_paid, left_days, expired_ts
 *   monthly_priority: { count, limit } — videos priority deste mes
 *   usage: { paid_videos_last_14_days, paid_videos_since_billing, next_renewal }
 */
async function getHeyGenCredits() {
  const out = { ok: true };
  try {
    const r1 = await fetchWithTimeout(
      'https://api2.heygen.com/v1/pacific/account.get?include_ff=true',
      { method: 'GET', credentials: 'include' },
      8000,
    );
    if (!r1.ok) throw new Error('account.get HTTP ' + r1.status);
    const j1 = await r1.json();
    const upv = j1?.data?.space_info?.user_plan_v2 || {};
    const planCredit = upv?.available_quota_v2?.plan_credit || upv?.addon_quota?.plan_credit || {};
    const unlimitedReg = upv?.available_quota_v2?.unlimited_regular || upv?.addon_quota?.unlimited_regular || {};
    out.plan_credit = { amount: planCredit.amount ?? 0, total: planCredit.total ?? 0 };
    out.unlimited_regular = { amount: unlimitedReg.amount ?? 0, total: unlimitedReg.total ?? 0 };
    out.plan_name = upv.plan_name || null;
    out.tier = upv.tier || null;
    out.is_unlimited = !!upv.is_unlimited;
    out.is_paid = !!upv.is_paid;
    out.left_days = upv.left_days ?? null;
    out.expired_ts = upv.expired_ts ?? null;
  } catch (e) {
    out.account_error = e.message;
  }
  try {
    const r2 = await fetchWithTimeout(
      'https://api2.heygen.com/v1/video_history/monthly_priority_video_count',
      { method: 'GET', credentials: 'include' },
      5000,
    );
    if (r2.ok) {
      const j2 = await r2.json();
      out.monthly_priority = { count: j2?.data?.count ?? 0, limit: j2?.data?.limit ?? 0 };
    }
  } catch {}
  try {
    const r3 = await fetchWithTimeout(
      'https://api2.heygen.com/v1/account/usage',
      { method: 'GET', credentials: 'include' },
      5000,
    );
    if (r3.ok) {
      const j3 = await r3.json();
      out.usage = {
        paid_videos_last_14_days: j3?.data?.paid_videos_created_last_14_days ?? 0,
        paid_videos_since_billing: j3?.data?.paid_videos_created_since_last_billing_cycle ?? 0,
        next_renewal_ts: j3?.data?.next_renewal_date ?? null,
        last_billing_ts: j3?.data?.last_billing_cycle_date ?? null,
      };
    }
  } catch {}
  return out;
}

/**
 * Cria Photo Avatar persistente no HeyGen a partir de uma imagem.
 *
 * Fluxo (descoberto via interceptor + endpoints conhecidos):
 *   1. POST /v2/photo_avatar/upload_url  →  upload_url assinada S3
 *   2. PUT na S3                        →  imagem subida
 *   3. POST /v2/photo_avatar/create      →  avatar_id + group_id
 *   4. Poll status                       →  ate ready
 *
 * Como endpoints podem variar, tenta cascata: v2 → v1 → talking_photo
 * fallback. Marca como BETA ate user confirmar live.
 *
 * IMPORTANTE: cada Photo Avatar consome 1 slot (instant avatar slots).
 * User tem total 5 + remaining 5 nos testes (12/05/2026).
 */
async function createPhotoAvatar(payload, onProgress) {
  const { imageBase64, imageMime = 'image/png', imageName = 'avatar.png', avatarName = 'DARKO Avatar' } = payload || {};
  if (!imageBase64) throw new Error('Sem imageBase64.');
  if (!avatarName) throw new Error('Sem avatarName.');

  // Decode base64 → Uint8Array
  const bin = atob(imageBase64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  console.log('[DARKO LAB photo avatar] start name=', avatarName, 'bytes=', bytes.length, 'mime=', imageMime);

  // === STEP 1: get upload URL ===
  onProgress?.({ stage: 'upload_url', percent: 5, message: 'Pedindo URL upload imagem...' });
  const uploadUrlEndpoints = [
    'https://api2.heygen.com/v2/photo_avatar/upload_url',
    'https://api2.heygen.com/v1/photo_avatar/upload_url',
    'https://api2.heygen.com/v1/pacific/photo_avatar/upload_url',
  ];
  let uploadUrl = null, fileUrl = null, lastErr = '';
  for (const ep of uploadUrlEndpoints) {
    try {
      const r = await fetchWithTimeout(ep, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: imageName,
          file_type: imageMime,
          file_size: bytes.length,
          request_source: 'PHOTO_AVATAR',
        }),
      }, 15000);
      if (!r.ok) { lastErr = `${ep}: HTTP ${r.status}`; continue; }
      const j = await r.json();
      const d = j?.data || {};
      uploadUrl = d.file_upload_url || d.upload_url || d.put_url || d.url;
      fileUrl = d.file_url || d.asset_url || (uploadUrl ? uploadUrl.split('?')[0] : null);
      if (uploadUrl) {
        console.log('[DARKO LAB photo avatar] upload_url via', ep);
        break;
      }
    } catch (e) {
      lastErr = `${ep}: ${e.message}`;
    }
  }
  if (!uploadUrl) throw new Error('Nenhum endpoint de upload_url respondeu. ' + lastErr);

  // === STEP 2: PUT na S3 ===
  onProgress?.({ stage: 'upload', percent: 20, message: `Subindo imagem (${(bytes.length / 1024).toFixed(0)}KB)...` });
  let signedHeaders = '';
  try {
    const u = new URL(uploadUrl);
    signedHeaders = (u.searchParams.get('X-Amz-SignedHeaders') || '').toLowerCase();
  } catch {}
  const putHeaders = {};
  for (const sh of signedHeaders.split(';').map(s => s.trim()).filter(Boolean)) {
    if (sh === 'host' || sh === 'content-length') continue;
    if (sh === 'content-type') putHeaders['Content-Type'] = imageMime;
    else if (sh === 'x-amz-server-side-encryption') putHeaders['x-amz-server-side-encryption'] = 'AES256';
  }
  const putResp = await fetchWithTimeout(uploadUrl, {
    method: 'PUT',
    body: bytes,
    headers: putHeaders,
  }, 60000);
  if (!putResp.ok) {
    const errBody = await putResp.text().catch(() => '');
    throw new Error(`PUT S3 imagem HTTP ${putResp.status}: ${errBody.slice(0, 200)}`);
  }
  console.log('[DARKO LAB photo avatar] PUT OK fileUrl=', fileUrl?.slice(0, 100));

  // === STEP 3: create photo avatar ===
  onProgress?.({ stage: 'create', percent: 50, message: 'Criando Photo Avatar no HeyGen...' });
  const createEndpoints = [
    'https://api2.heygen.com/v2/photo_avatar/create',
    'https://api2.heygen.com/v1/photo_avatar/create',
    'https://api2.heygen.com/v2/avatar_group/create',
    'https://api2.heygen.com/v1/avatar_group/create',
  ];
  const createBody = {
    name: avatarName,
    avatar_name: avatarName,
    image_url: fileUrl,
    image_key: fileUrl,
    file_url: fileUrl,
    asset_url: fileUrl,
    request_source: 'PHOTO_AVATAR',
  };
  let avatarId = null, groupId = null, lookId = null, jobId = null;
  for (const ep of createEndpoints) {
    try {
      const r = await fetchWithTimeout(ep, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createBody),
      }, 30000);
      if (!r.ok) {
        const errBody = await r.text().catch(() => '');
        lastErr = `${ep}: HTTP ${r.status} ${errBody.slice(0, 150)}`;
        continue;
      }
      const j = await r.json();
      const d = j?.data || {};
      avatarId = d.avatar_id || d.id || d.photo_avatar_id || d.look_id;
      groupId = d.group_id || d.avatar_group_id || d.photo_avatar_group_id;
      lookId = d.look_id || d.avatar_look_id || avatarId;
      jobId = d.job_id || d.callback_id || d.task_id;
      if (avatarId || jobId) {
        console.log('[DARKO LAB photo avatar] create via', ep, '→', { avatarId, groupId, lookId, jobId });
        break;
      }
    } catch (e) {
      lastErr = `${ep}: ${e.message}`;
    }
  }
  if (!avatarId && !jobId) throw new Error('Nenhum endpoint create funcionou. ' + lastErr);

  // === STEP 4: poll status (se tem job_id) ===
  if (!avatarId && jobId) {
    onProgress?.({ stage: 'polling', percent: 70, message: 'Aguardando processamento (pode demorar 30-90s)...' });
    const statusEndpoints = [
      `https://api2.heygen.com/v2/photo_avatar/${jobId}`,
      `https://api2.heygen.com/v1/photo_avatar/${jobId}`,
      `https://api2.heygen.com/v1/photo_avatar/create_status?job_id=${encodeURIComponent(jobId)}`,
    ];
    for (let attempt = 0; attempt < 60; attempt++) { // 60×3s = 3min
      await new Promise(r => setTimeout(r, 3000));
      onProgress?.({ stage: 'polling', percent: 70 + Math.min(25, attempt), message: `Aguardando avatar pronto (${attempt + 1}/60)...` });
      for (const ep of statusEndpoints) {
        try {
          const r = await fetchWithTimeout(ep, { method: 'GET', credentials: 'include' }, 8000);
          if (!r.ok) continue;
          const j = await r.json();
          const d = j?.data || {};
          const status = String(d.status || d.state || '').toLowerCase();
          const vid = d.avatar_id || d.id || d.photo_avatar_id;
          if (status === 'completed' || status === 'ready' || status === 'success' || vid) {
            avatarId = vid;
            groupId = d.group_id || groupId;
            lookId = d.look_id || avatarId;
            break;
          }
          if (status === 'failed' || status === 'error') {
            throw new Error('HeyGen reportou photo avatar failed: ' + (d.error_msg || d.message || 'sem detalhes'));
          }
        } catch (e) {
          if (String(e.message).includes('photo avatar failed')) throw e;
        }
      }
      if (avatarId) break;
    }
    if (!avatarId) throw new Error('Timeout 3min aguardando avatar processar.');
  }

  onProgress?.({ stage: 'done', percent: 100, message: 'Avatar criado: ' + avatarId });
  return { avatarId, groupId, lookId };
}

async function listMyVoices() {
  const endpoints = [
    'https://api2.heygen.com/v2/voice.list?limit=200&page=1',
    'https://api2.heygen.com/v1/voice.list?limit=200&page=1',
    'https://api2.heygen.com/v2/voices?limit=200',
    'https://app.heygen.com/api/v2/voice.list',
    'https://api.heygen.com/v2/voices',
  ];

  // SIMPLE REQUEST sem headers — evita CORS preflight
  const results = await Promise.all(
    endpoints.map(async (url) => {
      try {
        const r = await fetchWithTimeout(
          url,
          { method: 'GET', credentials: 'include' },
          5000,
        );
        if (!r.ok) {
          console.warn(`[DARKO LAB voice] FAIL ${url}: HTTP ${r.status}`);
          return { url, error: `${r.status}`, voices: null };
        }
        const text = await r.text();
        const json = JSON.parse(text);
        const voices = parseVoicesResponse(json);
        console.log(`[DARKO LAB voice] OK ${url}: ${voices.length} voices`);
        return { url, voices };
      } catch (e) {
        console.warn(`[DARKO LAB voice] EXC ${url}: ${e.message}`);
        return { url, error: e.name === 'AbortError' ? 'timeout' : e.message, voices: null };
      }
    }),
  );

  for (const r of results) {
    if (r.voices && r.voices.length > 0) {
      return { ok: true, voices: r.voices, source: r.url };
    }
  }
  return {
    ok: false,
    error: results.map((r) => `${r.url}: ${r.error ?? '0'}`).join(' | '),
    voices: [],
  };
}

function parseVoicesResponse(json) {
  if (!json) return [];
  const items = [];
  const list = json.data?.voices ?? json.data?.list ?? json.data ?? [];
  if (Array.isArray(list)) {
    for (const v of list) {
      items.push({
        id: v.voice_id ?? v.id,
        name: v.name ?? v.display_name ?? '(sem nome)',
        gender: v.gender ?? null,
        language: v.language ?? v.locale ?? null,
        previewAudio: v.preview_audio ?? v.preview_url ?? null,
      });
    }
  }
  // Dedup
  const seen = new Set();
  return items.filter((v) => {
    if (!v.id) return false;
    if (seen.has(v.id)) return false;
    seen.add(v.id);
    return true;
  });
}

/**
 * Lista os avatares EXATAMENTE como aparecem na biblioteca da conta do user
 * em https://app.heygen.com/avatars.
 *
 * Usa o mesmo endpoint INTERNO que o site HeyGen usa pra renderizar a tela
 * "Choose an Avatar" / "My Avatars". Cookies da sessao logada autenticam.
 *
 * Tenta varios endpoints potenciais — HeyGen muda nomes ocasionalmente.
 * Retorna a lista crua + metadados (thumb, name, version) pra exibicao
 * fiel no DARKO LAB.
 */
async function listMyAvatars() {
  console.log('[DARKO LAB] === STEP 1: listMyAvatars iniciando ===');

  // 1) Lista grupos da biblioteca via api2.heygen.com (cookies)
  let groups = [];
  try {
    console.log('[DARKO LAB] fetching grupos...');
    const r = await fetchWithTimeout(
      'https://api2.heygen.com/v2/avatar_group.private.list?limit=200&page=1',
      { method: 'GET', credentials: 'include' },
      5000,
    );
    console.log('[DARKO LAB] grupos response status:', r.status);
    if (!r.ok) {
      return {
        ok: false,
        error: `HeyGen retornou HTTP ${r.status} ao listar grupos.`,
        avatars: [],
      };
    }
    const json = await r.json();
    groups = json?.data?.avatar_groups ?? [];
    console.log(`[DARKO LAB] STEP 2: ${groups.length} grupos encontrados`);
  } catch (e) {
    console.error('[DARKO LAB] erro ao listar grupos:', e);
    return {
      ok: false,
      error: 'Falha ao listar grupos: ' + (e.message ?? e),
      avatars: [],
    };
  }

  if (groups.length === 0) {
    return {
      ok: false,
      error: 'Sua biblioteca esta vazia. Cadastre avatares em app.heygen.com.',
      avatars: [],
    };
  }

  // 2) Pra cada grupo, busca os looks EM PARALELO via v1 direto
  // (v2 sempre da 404, descobrimos via debug — economiza ~50% do tempo)
  console.log(
    `[DARKO LAB] STEP 3: buscando looks de ${groups.length} grupos em PARALELO...`,
  );
  const t0 = performance.now();
  const looksByGroup = await Promise.all(
    groups.map(async (g) => {
      const url = `https://api2.heygen.com/v1/avatar_look.private.list?group_id=${g.id}&limit=50`;
      try {
        const r = await fetchWithTimeout(
          url,
          { method: 'GET', credentials: 'include' },
          5000,
        );
        if (!r.ok) {
          console.warn(`[DARKO LAB] grupo ${g.name}: HTTP ${r.status}`);
          return { group: g, looks: [] };
        }
        const j = await r.json();
        const looks =
          j?.data?.avatar_looks ??
          j?.data?.avatar_look_list ??
          j?.data?.list ??
          (Array.isArray(j?.data) ? j.data : null) ??
          [];
        if (Array.isArray(looks)) {
          return { group: g, looks };
        }
        return { group: g, looks: [] };
      } catch (e) {
        console.warn(`[DARKO LAB] grupo ${g.name} ERR:`, e.message);
        return { group: g, looks: [] };
      }
    }),
  );
  const t1 = performance.now();
  console.log(
    `[DARKO LAB] STEP 4: looks coletados em ${Math.round(t1 - t0)}ms`,
  );
  // Log de quantos looks por grupo
  for (const { group, looks } of looksByGroup) {
    console.log(`[DARKO LAB]   grupo ${group.name}: ${looks.length} looks`);
  }

  // 3) Monta DUAS estruturas:
  //    a) groups[] - hierarquico (1 entrada por avatar, com array de looks aninhados)
  //    b) items[] - flat (1 entrada por look, p/ retrocompat + filtro instantaneo)
  // O DARKO LAB usa groups pra UI hierarquica, e cada look tem groupId pra rastrear.
  const groupsOut = [];
  const items = [];
  for (const { group, looks } of looksByGroup) {
    const groupName = group.name ?? '(sem nome)';
    const groupThumb =
      group.preview_image ??
      group.preview_image_url ??
      group.thumbnail_url ??
      null;
    const groupVersion = detectAvatarVersion(group);
    const groupType = group.is_photo || group.talking_photo_id ? 'photo' : 'avatar';

    if (looks.length === 0) {
      // Grupo sem looks fetched - usa o grupo como single look item
      const onlyLook = {
        id: group.id,
        name: groupName,
        thumb: groupThumb,
        videoPreview: group.preview_video ?? group.preview_video_url ?? null,
        type: groupType,
        version: groupVersion,
        groupId: group.id,
        groupName,
      };
      groupsOut.push({
        id: group.id,
        name: groupName,
        thumb: groupThumb,
        type: groupType,
        version: groupVersion,
        looksCount: 1,
        looks: [onlyLook],
      });
      items.push(onlyLook);
      continue;
    }

    // Grupo com looks reais - extrai cada look
    const groupLooks = [];
    for (const wrapper of looks) {
      const look =
        wrapper && typeof wrapper === 'object' && wrapper.look
          ? wrapper.look
          : wrapper;
      const lookType = wrapper?.look_type ?? null;

      if (items.length === 0) {
        console.log(
          '[DARKO LAB] SAMPLE look REAL (struct):',
          JSON.stringify(look).slice(0, 800),
        );
        console.log(
          '[DARKO LAB] SAMPLE look REAL (keys):',
          Object.keys(look).join(', '),
        );
        if (lookType) {
          console.log('[DARKO LAB] look_type detectado:', lookType);
        }
      }

      const id = findIdField(look);
      if (!id) {
        if (items.length === 0) {
          console.warn(
            '[DARKO LAB] look real sem ID detectavel, keys:',
            Object.keys(look).join(', '),
          );
        }
        continue;
      }
      const lookName =
        findNameField(look) ?? `${groupName} look ${groupLooks.length + 1}`;
      const lookThumb = findThumbField(look) ?? groupThumb;
      const lookVersion =
        detectAvatarVersion(look) || groupVersion;
      const lookTypeFinal =
        look.talking_photo_id ||
        look.is_photo ||
        group.is_photo ||
        lookType === 'photo'
          ? 'photo'
          : 'avatar';
      const lookItem = {
        id,
        name: lookName,
        thumb: lookThumb,
        videoPreview:
          look.preview_video ??
          look.preview_video_url ??
          look.motion_preview_url ??
          null,
        type: lookTypeFinal,
        version: lookVersion,
        groupId: group.id,
        groupName,
        // Voz default ja embutida no payload do look — evita lookup posterior
        // (endpoints de avatar.detail nao funcionam pra talking_photo)
        voiceId:
          look.voice_config?.voice_id ??
          look.voice_item?.voice_id ??
          look.default_voice_id ??
          look.voice_id ??
          null,
        // voice_name geralmente e o @username do material original clonado
        // (ex: '@marcella.malvar2'). Critico pra avatar matching no ClickUp
        // Pilot (briefings referenciam avatares por @username, nao por nome
        // do avatar HeyGen — que pode ser qualquer coisa tipo "Johan").
        voiceName:
          look.voice_name ??
          look.voice_config?.voice_name ??
          look.voice_item?.voice_name ??
          null,
      };
      groupLooks.push(lookItem);
      items.push(lookItem);
    }

    if (groupLooks.length > 0) {
      // Thumb do grupo: prefere o primeiro look (ou o thumb do grupo)
      const firstLookThumb = groupLooks[0].thumb;
      groupsOut.push({
        id: group.id,
        name: groupName,
        thumb: groupThumb ?? firstLookThumb,
        type: groupType,
        version: groupVersion,
        looksCount: groupLooks.length,
        looks: groupLooks,
      });
    }
  }

  console.log(
    `[DARKO LAB] STEP 5: biblioteca completa: ${items.length} looks em ${groupsOut.length} avatares`,
  );

  // Dedup looks flat por id (defensivo)
  const seen = new Set();
  const dedup = items.filter((a) => {
    if (!a.id) return false;
    if (seen.has(a.id)) return false;
    seen.add(a.id);
    return true;
  });

  console.log(`[DARKO LAB] STEP 6: retornando ${groupsOut.length} groups + ${dedup.length} flat looks`);

  return {
    ok: true,
    groups: groupsOut,
    avatars: dedup,
    source: 'api2.heygen.com/v2/avatar_group.private.list + avatar_look.private.list',
  };
}

function detectAvatarVersion(obj) {
  if (!obj) return 'IV';
  if (
    obj.is_avatar_v3 ||
    obj.is_v3 ||
    obj.avatar_type === 'V' ||
    obj.version === 'v3'
  )
    return 'V';
  if (
    obj.is_avatar_v2 ||
    obj.is_v2 ||
    obj.avatar_type === 'IV' ||
    obj.version === 'v2'
  )
    return 'IV';
  if (obj.talking_photo_id || obj.is_photo || obj.type === 'photo') return 'III';
  return 'IV';
}

/**
 * Encontra qualquer campo que pareca um ID (id, *_id, *Id, uuid, key, ref).
 * HeyGen usa nomes diferentes em endpoints diferentes (avatar_look_id,
 * pose_id, image_key, look_uuid, etc).
 */
function findIdField(obj) {
  if (!obj || typeof obj !== 'object') return null;
  // Prioridade explicita pra campos conhecidos
  const explicit = [
    'avatar_look_id',
    'look_id',
    'avatar_id',
    'talking_photo_id',
    'photo_id',
    'pose_id',
    'image_key',
    'id',
    'uuid',
  ];
  for (const k of explicit) {
    const v = obj[k];
    if (v && typeof v === 'string' && v.length > 5) return v;
  }
  // Fallback: qualquer campo terminando em _id ou _key
  for (const key of Object.keys(obj)) {
    if (
      key.endsWith('_id') ||
      key.endsWith('Id') ||
      key.endsWith('_key') ||
      key === 'uuid'
    ) {
      const v = obj[key];
      if (v && typeof v === 'string' && v.length > 5) return v;
    }
  }
  return null;
}

/**
 * Encontra qualquer campo que pareca nome.
 */
function findNameField(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const fields = [
    'avatar_look_name',
    'look_name',
    'avatar_name',
    'name',
    'display_name',
    'title',
    'pose_name',
  ];
  for (const k of fields) {
    const v = obj[k];
    if (v && typeof v === 'string') return v;
  }
  return null;
}

/**
 * Encontra qualquer campo que pareca URL de thumbnail.
 */
function findThumbField(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const fields = [
    'preview_image',
    'preview_image_url',
    'normal_preview',
    'thumbnail_url',
    'thumbnail_image_url',
    'image_url',
    'avatar_image_url',
    'cover_image_url',
    'photo_url',
  ];
  for (const k of fields) {
    const v = obj[k];
    if (v && typeof v === 'string' && v.startsWith('http')) return v;
  }
  return null;
}

/**
 * Parser robusto pros varios formatos de resposta do HeyGen.
 * Cada endpoint retorna um shape diferente — testamos todos os campos.
 */
function parseAvatarsResponse(json) {
  if (!json) return [];
  const items = [];

  function detectVersion(obj) {
    // HeyGen marca a versao em diferentes campos dependendo do endpoint.
    // is_avatar_v3 / is_v3 / type === 'avatar_v3' etc.
    if (obj.is_avatar_v3 || obj.is_v3 || obj.avatar_type === 'V' || obj.version === 'v3') return 'V';
    if (obj.is_avatar_v2 || obj.is_v2 || obj.avatar_type === 'IV' || obj.version === 'v2') return 'IV';
    if (obj.talking_photo_id || obj.is_photo || obj.type === 'photo') return 'III';
    return 'IV'; // default razoavel
  }

  function pushItem(obj, fallbackName) {
    const id =
      obj.avatar_id ??
      obj.id ??
      obj.talking_photo_id ??
      obj.avatar_look_id ??
      obj.look_id ??
      obj.default_look?.id ??
      obj.default_avatar_look_id ??
      null;
    if (!id) return;
    items.push({
      id,
      name: obj.avatar_name ?? obj.name ?? fallbackName ?? '(sem nome)',
      thumb:
        obj.preview_image_url ??
        obj.normal_preview ??
        obj.thumbnail_url ??
        obj.image_url ??
        obj.thumbnail_image_url ??
        obj.default_look?.preview_image_url ??
        null,
      videoPreview:
        obj.preview_video_url ?? obj.default_look?.preview_video_url ?? null,
      type: obj.talking_photo_id || obj.is_photo ? 'photo' : 'avatar',
      version: detectVersion(obj),
    });
  }

  // Formato avatar_group.private.list: { data: { avatar_group_list: [...] } }
  // ou { data: { list: [...] } } ou { data: [...] }
  const groups =
    json.data?.avatar_group_list ??
    json.data?.list ??
    (Array.isArray(json.data) ? json.data : null) ??
    json.data?.groups ??
    [];

  if (Array.isArray(groups)) {
    for (const g of groups) {
      // Cada grupo pode ter "avatars" (looks) ou ja vir flat
      if (Array.isArray(g.avatars) && g.avatars.length > 0) {
        for (const a of g.avatars) {
          pushItem(a, g.name ?? g.group_name);
        }
      } else if (Array.isArray(g.looks) && g.looks.length > 0) {
        for (const l of g.looks) {
          pushItem(l, g.name ?? g.group_name);
        }
      } else {
        // Grupo sem looks expandidos — usa o proprio grupo
        pushItem(g, g.name ?? g.group_name);
      }
    }
  }

  // Formato v2/avatars: { data: { avatars: [...], talking_photos: [...] } }
  if (Array.isArray(json.data?.avatars)) {
    for (const a of json.data.avatars) pushItem(a);
  }
  if (Array.isArray(json.data?.talking_photos)) {
    for (const p of json.data.talking_photos) pushItem(p);
  }

  // Dedup por id
  const seen = new Set();
  return items.filter((a) => {
    if (!a.id) return false;
    if (seen.has(a.id)) return false;
    seen.add(a.id);
    return true;
  });
}

/**
 * Tenta uma chamada leve pro HeyGen pra confirmar se a sessao esta valida.
 * Endpoint /api/v1/user/info costuma responder com info do usuario logado.
 */
async function testSession() {
  const headers = getInternalAuthHeaders();
  const endpoints = [
    'https://api2.heygen.com/v1/user.info',
    'https://api2.heygen.com/v2/user.info',
    'https://api2.heygen.com/v1/user/info',
    'https://app.heygen.com/api/v1/user/info',
    'https://app.heygen.com/api/v2/user.info',
  ];
  for (const url of endpoints) {
    try {
      const r = await fetch(url, {
        method: 'GET',
        credentials: 'include',
        headers,
      });
      if (r.ok) {
        const j = await r.json().catch(() => null);
        const email = j?.data?.email ?? j?.email ?? null;
        return {
          ok: true,
          detail: email ? `Logado como ${email}` : 'Sessao valida.',
        };
      }
      if (r.status === 401 || r.status === 403) {
        return { ok: false, detail: 'Sessao expirada — faca login novamente.' };
      }
    } catch {
      /* tenta proximo */
    }
  }
  return {
    ok: false,
    detail: 'Nao consegui verificar sessao. Faca login em app.heygen.com.',
  };
}

function reportProgress(requestId, stage, percent) {
  console.log('[DARKO LAB UI progress]', stage, percent != null ? `(${percent}%)` : '');
  chrome.runtime.sendMessage({
    type: 'HG_TAB_PROGRESS',
    requestId,
    stage,
    percent,
  });
}

function reportResult(requestId, videoUrl) {
  chrome.runtime.sendMessage({
    type: 'HG_TAB_RESULT',
    requestId,
    videoUrl,
  });
}

function reportError(requestId, error) {
  chrome.runtime.sendMessage({
    type: 'HG_TAB_ERROR',
    requestId,
    error,
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(predicate, timeoutMs = 15000, interval = 250) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const v = predicate();
    if (v) return v;
    await sleep(interval);
  }
  throw new Error('Timeout esperando elemento.');
}

/** Igual waitFor mas retorna null em vez de throw - pra fallback chains */
async function waitForOrNull(predicate, timeoutMs = 5000, interval = 200) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const v = predicate();
    if (v) return v;
    await sleep(interval);
  }
  return null;
}

/**
 * Tenta capturar a sessao do HeyGen pra fazer chamadas pra propria API
 * interna deles. Pega cookies + token salvo no localStorage.
 *
 * Tudo dentro do contexto autenticado da aba — nao consome a API publica.
 */
function getInternalAuthHeaders() {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
  };
  // HeyGen pode guardar token em varios lugares. Tentamos todos.
  try {
    const candidates = [
      localStorage.getItem('access_token'),
      localStorage.getItem('token'),
      localStorage.getItem('heygen_token'),
      localStorage.getItem('auth_token'),
      localStorage.getItem('jwt'),
      localStorage.getItem('id_token'),
      sessionStorage.getItem('access_token'),
      sessionStorage.getItem('token'),
    ].filter(Boolean);

    // Token raw (provavelmente JWT comecando com "eyJ") — usa o primeiro
    const token = candidates.find((t) => /^[A-Za-z0-9._-]+$/.test(t));
    if (token) headers['Authorization'] = 'Bearer ' + token;

    // Tambem tenta extrair x-csrf-token de cookies (se HeyGen usar)
    const csrfMatch = document.cookie.match(/(?:^|;\s*)csrf[-_]?token=([^;]+)/i);
    if (csrfMatch) headers['X-CSRF-Token'] = decodeURIComponent(csrfMatch[1]);
  } catch (e) {
    /* ignora */
  }
  return headers;
}

/**
 * fetch com timeout explicito (5s default). Evita 1 endpoint lento
 * comer todo o orcamento de tempo.
 */
async function fetchWithTimeout(url, opts, timeoutMs = 6000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

/**
 * Job principal. Estrategia hibrida: usa API interna do HeyGen pra
 * generation (mais robusto que click-fu) com cookies de sessao.
 */
/**
 * runJob - UI AUTOMATION na tela Quick Create do HeyGen (/avatar).
 *
 * Fluxo:
 *  1. Navega pra https://app.heygen.com/avatar (Quick Create)
 *  2. Garante que tab "Script to video" esta ativa
 *  3. Seleciona motor (Avatar III/IV/V) clicando no toggle do topo
 *  4. Abre dialog "Choose an Avatar", busca pelo groupName, clica no avatar
 *     e seleciona o look correto (se grupo com >1 looks)
 *  5. Cola o script no textarea (com React onChange trigger)
 *  6. Clica botao Generate (seta no canto inferior direito)
 *  7. Aguarda HeyGen processar e captura URL do MP4 final
 */
async function runJob(requestId, payload) {
  if (currentJob) {
    console.warn('[DARKO LAB UI] runJob ignorado - currentJob=', currentJob, 'novo reqId=', requestId);
    reportError(
      requestId,
      'Outra geracao em andamento - aguarde finalizar.',
    );
    return;
  }
  currentJob = requestId;
  let generateClicked = false; // pra garantir click 1x

  try {
    const { copy, avatarId, motor, partLabel, avatarName, groupName } = payload;

    if (!avatarId) throw new Error('payload invalido: avatarId obrigatorio.');
    if (!copy) throw new Error('payload invalido: copy obrigatoria. (Pra modo audio use processJob da API direta, NAO runJob via UI.)');

    reportProgress(requestId, `Preparando ${partLabel ?? 'video'} via UI...`);

    // 1) Aguarda textarea visivel ate 30s (React HeyGen demora a montar).
    //    Background.js ja navegou pra /avatar antes de chamar runJob.
    console.log('[DARKO LAB UI] runJob iniciando, location=', location.href);
    reportProgress(requestId, 'Aguardando UI HeyGen...');
    const textarea = await waitForOrNull(
      () => findScriptTextarea(),
      30000,
      400,
    );
    if (!textarea) {
      dumpScriptDiagnostics();
      throw new Error(
        'Textarea de script nao apareceu em 30s na ' + location.href +
        '. Abre F12 na aba HeyGen e me cola os logs [DARKO LAB UI diag].'
      );
    }
    const r = textarea.getBoundingClientRect();
    console.log('[DARKO LAB UI] textarea encontrado, dimensoes:', r.width, 'x', r.height);

    // 3) Seleciona motor (Avatar III / IV / V) com VERIFICACAO obrigatoria.
    //    CRITICO: avatar IV/V consomem creditos pagos. Se a gente errou e
    //    selecionou IV em vez de III, o user paga sem querer. Se nao
    //    conseguir confirmar o motor exato, ABORTA.
    if (motor) {
      reportProgress(requestId, `Selecionando motor Avatar ${motor}...`);
      const ok = await selectMotor(motor);
      if (!ok) {
        throw new Error(
          `Nao consegui selecionar motor Avatar ${motor} no HeyGen. ` +
          `Aborti pra nao gastar credito errado. Tente abrir manualmente ` +
          `o seletor Avatar X no canto inferior do HeyGen e re-tentar.`
        );
      }
      // Verifica APOS selecionar
      await sleep(500);
      const after = findCurrentMotorToggle();
      const afterText = after ? (after.textContent || '').trim() : '';
      console.log('[DARKO LAB UI motor] toggle apos selecionar:', afterText);
      if (after && !afterText.includes(`Avatar ${motor}`)) {
        throw new Error(
          `Verificacao de motor falhou: queria Avatar ${motor} mas o toggle ` +
          `mostra "${afterText.slice(0, 50)}". Aborti pra nao gastar credito errado.`
        );
      }
    }

    // 4) Seleciona avatar via Change Avatar -> gallery -> looks
    reportProgress(requestId, `Selecionando ${groupName ?? 'avatar'}...`);
    await selectAvatarInUI(avatarId, avatarName, groupName);

    // 5) Cola script no textarea com React onChange trigger
    reportProgress(requestId, 'Colando script...');
    await pasteScriptIntoTextarea(textarea, copy);
    await sleep(500);

    // 6) Marca o timestamp ANTES do click Generate. So consideramos
    //    video_ids interceptados a partir desse momento (garante que NAO
    //    confundimos com um generate de outra pessoa na mesma conta que
    //    aconteceu antes).
    const clickStartTs = Date.now();

    // 7) Clica Generate (seta no canto inferior direito)
    reportProgress(requestId, 'Clicando Generate...');
    const generateBtn = await waitForOrNull(() => findGenerateButton(), 8000, 300);
    if (!generateBtn) throw new Error('Botao Generate nao encontrado.');
    // GUARD anti-duplicacao: se ja houve um video gerado nos ultimos 90s
    // (capturado pelo interceptor), REUSA esse video em vez de clicar
    // Generate de novo. Isso protege contra:
    //  a) User clicando Gerar 2x no DARKO LAB
    //  b) Retry apos falha do motor
    //  c) Qualquer race condition que cause 2 dispatch
    const ANTI_DUP_WINDOW_MS = 90000;
    const recentVideo = interceptedVideoIds
      .filter((v) => Date.now() - v.ts < ANTI_DUP_WINDOW_MS)
      .pop(); // pega o mais recente (ultimo do array)
    if (recentVideo) {
      console.warn('[DARKO LAB UI] !! Generate SKIP - video ja foi gerado nos ultimos 90s:', recentVideo.id, 'idade:', Math.round((Date.now() - recentVideo.ts)/1000) + 's');
      console.warn('[DARKO LAB UI] !! Reusando esse video pra evitar duplicacao. Pra forcar nova geracao, espere 90s.');
      // Marca generateClicked pra waitForInterceptedVideoId aceitar
      generateClicked = true;
    } else if (generateClicked) {
      console.warn('[DARKO LAB UI] generate JA foi clicado uma vez, skip duplo click');
    } else {
      console.log('[DARKO LAB UI] clicando Generate, aguardando interceptor capturar video_id...');
      clickElement(generateBtn);
      generateClicked = true;
    }

    // 8) MODO DISPATCH-ONLY: nao esperamos o video ficar pronto.
    //    Apenas aguarda 3s pra request POST de generate sair (HeyGen
    //    aceitar a fila). Depois reporta sucesso e libera pro proximo
    //    trecho. Usuario vai pegar os videos prontos manualmente no
    //    HeyGen depois.
    reportProgress(requestId, 'Enviando request pro HeyGen...');
    await sleep(3500);

    // Tenta capturar o video_id (best-effort, nao critico)
    let myVideoId = null;
    for (const item of interceptedVideoIds) {
      if (item.ts >= clickStartTs - 5000) {
        myVideoId = item.id;
        break;
      }
    }
    if (myVideoId) {
      console.log('[DARKO LAB UI] dispatch OK, video_id capturado:', myVideoId);
    } else {
      console.log('[DARKO LAB UI] dispatch OK (sem video_id capturado, mas request foi enviada)');
    }

    reportProgress(requestId, 'Trecho enviado pro HeyGen!', 100);
    // Reporta resultado com placeholder QUEUED ou videoId capturado
    reportResult(requestId, myVideoId ? `QUEUED:${myVideoId}` : 'QUEUED');
  } catch (e) {
    console.error('[DARKO LAB UI] runJob FAIL:', e);
    reportError(requestId, e?.message ?? String(e));
  } finally {
    currentJob = null;
  }
}

/* ============= UI Helpers ============= */

/**
 * Aguarda o inject.js interceptar uma POST de generate cuja response
 * contenha video_id. So aceita events com timestamp >= clickStartTs (pra
 * nao pegar generate de outra pessoa que rodou antes).
 */
async function waitForInterceptedVideoId(clickStartTs, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  let lastLogTs = 0;
  let fallbackTried = false;

  while (Date.now() < deadline) {
    // 1) Procura no buffer interceptedVideoIds o primeiro com ts >= clickStartTs
    for (const item of interceptedVideoIds) {
      if (item.ts >= clickStartTs) {
        console.log('[DARKO LAB UI] waitForInterceptedVideoId: ACHOU id=', item.id, 'via', item.url);
        return item.id;
      }
    }

    // 2) Log periodico do estado do buffer (a cada 10s) pra debug
    if (Date.now() - lastLogTs > 10000) {
      lastLogTs = Date.now();
      console.log(`[DARKO LAB UI] waitForInterceptedVideoId aguardando... buffer tem ${interceptedVideoIds.length} items, clickStartTs=${new Date(clickStartTs).toISOString()}`);
      if (interceptedVideoIds.length > 0) {
        console.log('[DARKO LAB UI] items no buffer:', interceptedVideoIds.map((i) => ({
          id: i.id?.slice(0, 12) + '...',
          tsAge: Math.round((Date.now() - i.ts) / 1000) + 's',
          url: i.url?.slice(0, 80),
        })));
      }
    }

    // 3) FALLBACK apos 15s: tenta DOM Recents
    if (!fallbackTried && Date.now() - clickStartTs > 15000) {
      fallbackTried = true;
      console.warn('[DARKO LAB UI] waitForInterceptedVideoId 15s sem captura - fallback DOM Recents');
      const recentVid = scanRecentsForJustNow();
      if (recentVid) {
        console.log('[DARKO LAB UI] FALLBACK Recents: detectado video =', recentVid);
        return recentVid;
      }
    }
    // 4) FALLBACK FINAL apos 25s: API video.list pegando video newest da conta
    if (Date.now() - clickStartTs > 25000) {
      const newest = await findNewestVideoFromAccount(180000);
      if (newest && newest.id) {
        console.log('[DARKO LAB UI] FALLBACK API: usando video mais recente da conta =', newest.id, 'via', newest.endpoint);
        return newest.id;
      }
    }

    await sleep(500);
  }
  console.warn('[DARKO LAB UI] waitForInterceptedVideoId TIMEOUT', timeoutMs, 'ms - 0 captures atribuiveis');
  return null;
}

/**
 * Scan da sidebar Recents do HeyGen procurando item com 'just now' /
 * 'seconds ago' (criado pela nossa automacao). Retorna video_id se achar.
 */
function scanRecentsForJustNow() {
  // Procura todos elementos visiveis com texto contendo "ago", "now", "agora"
  const all = document.querySelectorAll('a, [role="link"], li, div');
  let bestMatch = null;
  for (const el of all) {
    if (el.offsetParent === null) continue;
    const text = (el.textContent || '').trim().toLowerCase();
    if (!text) continue;
    // "just now", "a few seconds ago", "1 minute ago"
    if (
      text.includes('just now') ||
      text.includes('seconds ago') ||
      text.includes('1 minute ago') ||
      text.includes('agora mesmo')
    ) {
      // Busca href com video_id
      const href = el.getAttribute('href') || el.querySelector('a')?.getAttribute('href') || '';
      const m = href.match(/(?:video|share|projects?)[\/=]([a-f0-9]{20,})/i);
      if (m) {
        bestMatch = m[1];
        break;
      }
    }
  }
  return bestMatch;
}

/**
 * Fallback robusto: busca o video MAIS RECENTE da conta HeyGen via
 * endpoints internos. Retorna { id, createdAt } se created_at <= maxAgeMs.
 */
async function findNewestVideoFromAccount(maxAgeMs = 180000) {
  const endpoints = [
    'https://api2.heygen.com/v1/video.list?limit=5&page=1',
    'https://api2.heygen.com/v2/video.list?limit=5&page=1',
    'https://api2.heygen.com/v1/pacific.video.list?limit=5',
    'https://api2.heygen.com/v1/video_list.get?limit=5',
    'https://app.heygen.com/api/v2/videos?limit=5',
    'https://app.heygen.com/api/v1/video.list?limit=5',
  ];
  for (const url of endpoints) {
    try {
      const r = await fetch(url, { method: 'GET', credentials: 'include' });
      if (!r.ok) continue;
      const j = await r.json().catch(() => null);
      const list = extractVideoList(j);
      if (!list || list.length === 0) continue;
      // Sort por created_at/create_time/timestamp DESC
      list.sort((a, b) => {
        const ta = a?.created_at ?? a?.create_time ?? a?.created ?? a?.timestamp ?? 0;
        const tb = b?.created_at ?? b?.create_time ?? b?.created ?? b?.timestamp ?? 0;
        return tb - ta;
      });
      const newest = list[0];
      const id = newest?.video_id ?? newest?.id ?? newest?.uuid;
      const createdRaw = newest?.created_at ?? newest?.create_time ?? newest?.created ?? 0;
      // created_at do HeyGen pode ser em segundos ou ms - normaliza pra ms
      const createdAt = createdRaw > 1e12 ? createdRaw : createdRaw * 1000;
      const ageMs = createdAt > 0 ? Date.now() - createdAt : 0;
      console.log(`[DARKO LAB UI] findNewestVideoFromAccount via ${url}: id=${id} ageMs=${Math.round(ageMs/1000)}s`);
      if (id && (ageMs === 0 || ageMs <= maxAgeMs)) {
        return { id, createdAt, endpoint: url };
      }
    } catch (e) { /* tenta proximo */ }
  }
  return null;
}

/**
 * Pola video_status.get pra UM video_id especifico ate ele completar.
 * Esse video_id veio do inject.js que interceptou a response da nossa
 * propria request - 100% garantido que eh o nosso.
 */

/* waitForVideoCompletionById removido em v3.3.0 (modo dispatch-only) */
async function waitForVideoCompletionById(requestId, videoId) {
  console.warn('[DARKO LAB UI] waitForVideoCompletionById nao usado em modo dispatch-only');
  return null;
}

async function uploadAudioToHeyGen(audioBase64, filename, headers) {
  const binary = atob(audioBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: 'audio/mpeg' });
  const formData = new FormData();
  formData.append('file', blob, filename);
  const endpoints = [
    'https://upload.heygen.com/v1/asset',
    'https://api.heygen.com/v1/asset',
    'https://api2.heygen.com/v1/asset',
  ];
  let lastError = '';
  for (const ep of endpoints) {
    try {
      const res = await fetch(ep, { method: 'POST', credentials: 'include', body: formData });
      if (!res.ok) { lastError = ep + ' HTTP ' + res.status; continue; }
      const json = await res.json().catch(() => null);
      const url = json?.data?.url ?? json?.data?.file_url ?? json?.url ?? json?.file_url ?? '';
      if (url) return url;
      lastError = ep + ' sem URL no body';
    } catch (e) {
      lastError = ep + ': ' + e.message;
    }
  }
  throw new Error('Nenhum endpoint de upload de audio respondeu. ' + lastError);
}

console.log('[DARKO LAB HeyGen Content] online');


/* ============= UI Helpers (re-adicionadas v3.3.3) ============= */

function findScriptTextarea() {
  const sels = [
    'textarea[placeholder*="script" i]',
    'textarea[placeholder*="paste" i]',
    'textarea[placeholder*="type" i]',
    'textarea[placeholder*="aqui" i]',
    'textarea[placeholder*="cole" i]',
    'div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"]',
    'textarea',
  ];
  for (const sel of sels) {
    const els = document.querySelectorAll(sel);
    for (const el of els) {
      if (el.offsetParent !== null) {
        const r = el.getBoundingClientRect();
        if (r.width >= 100 && r.height >= 30) return el;
      }
    }
  }
  return null;
}

function dumpScriptDiagnostics() {
  console.log('[DARKO LAB UI diag] location:', location.href);
  console.log('[DARKO LAB UI diag] readyState:', document.readyState);
  const tas = document.querySelectorAll('textarea');
  console.log('[DARKO LAB UI diag] textareas count:', tas.length);
  for (const t of tas) {
    console.log('[DARKO LAB UI diag] textarea:', {
      placeholder: t.placeholder,
      ariaLabel: t.getAttribute('aria-label'),
      visible: t.offsetParent !== null,
    });
  }
}

async function selectMotor(motor) {
  const target = `Avatar ${motor}`;
  console.log('[DARKO LAB UI motor] alvo=', target);
  await dismissAnnouncementModals();
  const currentBtn = findCurrentMotorToggle();
  if (currentBtn) {
    const t = (currentBtn.textContent || '').trim();
    console.log('[DARKO LAB UI motor] toggle atual mostra:', t);
    if (t.includes(target)) { console.log('[DARKO LAB UI motor] ja esta em', target); return true; }
  }
  for (let attempt = 1; attempt <= 3; attempt++) {
    console.log(`[DARKO LAB UI motor] tentativa ${attempt}/3 abrir dropdown`);
    if (attempt > 1) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await sleep(300);
    }
    const toggle = findCurrentMotorToggle();
    if (toggle) {
      console.log(`[DARKO LAB UI motor] clicando toggle (tentativa ${attempt})`);
      clickElement(toggle);
      await sleep(500 + attempt * 300);
    }
    const item = await waitForOrNull(() => findMotorMenuItem(motor), 3000, 200);
    if (item) {
      console.log(`[DARKO LAB UI motor] item encontrado:`, (item.textContent || '').slice(0, 60));
      await clickWithAncestors(item);
      await sleep(900);
      const newToggle = findCurrentMotorToggle();
      if (newToggle && (newToggle.textContent || '').includes(target)) {
        console.log('[DARKO LAB UI motor] sucesso na tentativa', attempt);
        return true;
      }
    }
  }
  return false;
}

function findCurrentMotorToggle() {
  const all = Array.from(document.querySelectorAll('button, [role="button"], div, span, a'));
  let candidates = [];
  for (const el of all) {
    if (el.offsetParent === null) continue;
    if (el.disabled) continue;
    const t = (el.textContent || '').trim();
    if (!/Avatar (III|IV|V)\b/.test(t)) continue;
    if (t.length > 80) continue;
    if (el.children.length > 5) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 50 || r.height < 20 || r.width > 400) continue;
    if (r.top < window.innerHeight * 0.4) continue;
    const style = window.getComputedStyle(el);
    const isClickable = style.cursor === 'pointer' || el.tagName === 'BUTTON' || el.getAttribute('role') === 'button' || (el.className || '').includes('cursor-pointer');
    candidates.push({ el, rect: r, isClickable });
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => (a.isClickable !== b.isClickable) ? (a.isClickable ? -1 : 1) : (b.rect.top - a.rect.top));
  return candidates[0].el;
}

function findMotorMenuItem(motor) {
  const target = `Avatar ${motor}`;
  const currentToggle = findCurrentMotorToggle();
  const candidates = [];
  for (const el of document.querySelectorAll('div, button, li, span, a, [role]')) {
    if (el === currentToggle || (currentToggle && currentToggle.contains(el))) continue;
    if (el.offsetParent === null) continue;
    const t = (el.textContent || '').trim();
    if (!t || t.length > 250) continue;
    if (!t.startsWith(target)) continue;
    const next = t.charAt(target.length);
    if (next && /[0-9A-HJ-Za-hj-z]/.test(next)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 50 || r.height < 20 || r.width > 800) continue;
    candidates.push({ el, depth: getDepth(el), childCount: el.querySelectorAll('*').length });
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => (a.childCount !== b.childCount) ? a.childCount - b.childCount : b.depth - a.depth);
  return candidates[0].el;
}

function getDepth(el) {
  let d = 0; let p = el;
  while (p && p !== document.body) { d++; p = p.parentElement; }
  return d;
}

async function clickWithAncestors(el) {
  if (!el) return false;
  el.scrollIntoView({ block: 'center', behavior: 'instant' });
  await sleep(150);
  let target = el;
  for (let i = 0; i < 5 && target; i++) {
    clickElement(target);
    target = target.parentElement;
  }
  return true;
}

async function dismissAnnouncementModals() {
  const dialogs = document.querySelectorAll('[role="dialog"], [data-state="open"]');
  for (const d of dialogs) {
    const buttons = d.querySelectorAll('button');
    for (const b of buttons) {
      const txt = (b.textContent || '').trim().toLowerCase();
      if (b.offsetParent === null) continue;
      const al = (b.getAttribute('aria-label') || '').toLowerCase();
      if (al.includes('close') || al.includes('dismiss') || txt === '' || txt === 'close' || txt === 'skip' || txt === 'maybe later') {
        const r = b.getBoundingClientRect();
        if (r.width < 60 && r.height < 60) {
          console.log('[DARKO LAB UI motor] fechando modal');
          clickElement(b);
          await sleep(400);
        }
      }
    }
  }
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await sleep(200);
}

function findGenerateButton() {
  const candidates = Array.from(document.querySelectorAll('button'));
  const W = window.innerWidth; const H = window.innerHeight;
  const all = [];
  for (const b of candidates) {
    if (b.disabled || b.offsetParent === null) continue;
    const r = b.getBoundingClientRect();
    if (r.width < 30 || r.height < 30 || r.width > 100 || r.height > 100) continue;
    if (r.right < W * 0.7 || r.bottom < H * 0.6) continue;
    const al = (b.getAttribute('aria-label') || '').toLowerCase();
    const t = (b.textContent || '').trim().toLowerCase();
    const dt = (b.getAttribute('data-testid') || '').toLowerCase();
    const bg = window.getComputedStyle(b).backgroundColor || '';
    const m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    let isBlue = false;
    if (m) { const r2=+m[1],g=+m[2],blue=+m[3]; isBlue = blue>150 && blue>r2+30 && blue>g-30; }
    const svg = b.querySelector('svg');
    let hasArrowUp = false; let hasPlayIcon = false;
    if (svg) {
      const html = svg.innerHTML.toLowerCase();
      if (html.includes('m12 19') || html.includes('arrow') || html.includes('19v5') || html.includes('m5 12l7-7')) hasArrowUp = true;
      if (html.includes('polygon') || html.includes('m8 5v14') || html.includes('play')) hasPlayIcon = true;
    }
    let score = 0;
    if (al.includes('generate') || al.includes('submit') || dt.includes('generate')) score += 100;
    if (t === 'generate' || t === 'gerar') score += 80;
    if (isBlue) score += 30;
    if (hasArrowUp) score += 40;
    if (hasPlayIcon) score -= 100;
    if (al.includes('play') || al.includes('voice') || al.includes('preview')) score -= 100;
    score += Math.round((r.right - W * 0.7) / (W * 0.3) * 20);
    all.push({ btn: b, score });
  }
  if (!all.length) return null;
  all.sort((a, b) => b.score - a.score);
  return all[0].btn;
}

async function pasteScriptIntoTextarea(textarea, text) {
  textarea.focus();
  if (textarea.tagName === 'TEXTAREA') {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(textarea, '');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(100);
    setter.call(textarea, text);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
  } else if (textarea.isContentEditable) {
    textarea.innerHTML = '';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(100);
    document.execCommand('insertText', false, text);
  }
}

/* ============= AUDIO MODE (legacy helpers v4.7.x) ===================
 * NAO USADOS no fluxo atual. Audio mode no DARKO LAB roda via API
 * direta usando processJob() em lib/heygen-api-direct.ts (mesmo path
 * do /tools/heygen-auto). Helpers ficam aqui caso futuro queiramos
 * mexer via UI, mas runJob() so trata MODO TEXTO agora.
 */

function findUploadAudioToggle() {
  const all = Array.from(document.querySelectorAll('div[role="button"], button'));
  for (const el of all) {
    if (el.offsetParent === null) continue;
    const txt = (el.textContent || '').trim();
    if (txt !== 'Upload') continue;
    const r = el.getBoundingClientRect();
    // E o botaozinho do Quick Create (compacto, ~36x36 ate ~120x60)
    if (r.width < 20 || r.height < 20 || r.width > 200 || r.height > 100) continue;
    return el;
  }
  return null;
}

/** Click no botao "Upload" pra abrir o modal Upload Audio. */
async function switchToAudioMode() {
  console.log('[DARKO LAB UI audio] procurando botao Upload...');
  // Aguarda o botao aparecer (UI HeyGen pode demorar a montar)
  const uploadBtn = await waitForOrNull(() => findUploadAudioToggle(), 10000, 300);
  if (!uploadBtn) {
    console.warn('[DARKO LAB UI audio] botao Upload NAO encontrado. Sample buttons:');
    const sample = Array.from(document.querySelectorAll('button, [role="button"]'))
      .filter((b) => b.offsetParent !== null)
      .slice(0, 20)
      .map((b) => (b.textContent || '').trim().slice(0, 40));
    console.warn('  sample:', sample);
    return false;
  }
  const r = uploadBtn.getBoundingClientRect();
  console.log('[DARKO LAB UI audio] clicando Upload em', r.left, r.top);
  clickElement(uploadBtn);
  // Aguarda o modal abrir
  const modal = await waitForOrNull(() => findUploadModal(), 5000, 200);
  if (!modal) {
    console.warn('[DARKO LAB UI audio] modal Upload Audio nao abriu apos click');
    return false;
  }
  console.log('[DARKO LAB UI audio] modal aberto.');
  // Garante que "Upload Audio" tab esta selecionada (e default mas safety)
  await sleep(300);
  const uploadTab = Array.from(modal.querySelectorAll('button[role="tab"]'))
    .find((b) => (b.textContent || '').trim() === 'Upload Audio');
  if (uploadTab && uploadTab.getAttribute('aria-selected') !== 'true') {
    console.log('[DARKO LAB UI audio] Upload Audio tab nao ativa, clicando...');
    clickElement(uploadTab);
    await sleep(400);
  }
  return true;
}

/** Encontra o modal [role="dialog"] da Upload Audio. */
function findUploadModal() {
  const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
  for (const d of dialogs) {
    if (d.offsetParent === null) continue;
    const txt = d.textContent || '';
    // Modal de upload de audio sempre tem essa string
    if (/Upload\s+Audio/i.test(txt) || /Record\s+Audio/i.test(txt)) {
      return d;
    }
  }
  return null;
}

/** Encontra <input type="file"> dentro do modal de upload (hidden). */
function findAudioFileInput() {
  const modal = findUploadModal();
  if (modal) {
    const inp = modal.querySelector('input[type="file"]');
    if (inp) return inp;
  }
  // Fallback: input file em qualquer lugar com accept=audio
  const inputs = document.querySelectorAll('input[type="file"]');
  for (const inp of inputs) {
    const accept = (inp.getAttribute('accept') || '').toLowerCase();
    if (accept.includes('audio') || accept.includes('mp3') || accept.includes('wav')) {
      return inp;
    }
  }
  return null;
}

/** Upload de audio: encontra file input dentro do modal + dispara change. */
async function uploadAudioToScriptArea(audioBase64, filename) {
  const fileInput = await waitForOrNull(() => findAudioFileInput(), 8000, 200);
  if (!fileInput) {
    throw new Error('Input file de audio nao encontrado apos abrir modal. Tente: F12 console + cole logs [DARKO LAB UI audio].');
  }
  console.log('[DARKO LAB UI audio] file input encontrado dentro do modal, fazendo upload...');
  // Decodifica base64 → Uint8Array → File
  const bin = atob(audioBase64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const ext = (filename || '').toLowerCase().match(/\.(\w+)$/)?.[1] || 'wav';
  const mime = ext === 'mp3' ? 'audio/mpeg' : ext === 'm4a' ? 'audio/mp4' : 'audio/wav';
  const file = new File([bytes], filename || 'audio.wav', { type: mime });
  // DataTransfer + change event (formato padrao pra programmatic file upload em React)
  const dt = new DataTransfer();
  dt.items.add(file);
  fileInput.files = dt.files;
  fileInput.dispatchEvent(new Event('change', { bubbles: true }));
  console.log('[DARKO LAB UI audio] file dispatched:', filename, 'size:', bytes.length);
}

/** Aguarda upload completar. Modal FECHA automaticamente apos OK
 *  (verificado live). Tambem aceita 'Uploading...' sumir como sucesso. */
async function waitForAudioUploadComplete(timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  let lastUploading = Date.now();
  while (Date.now() < deadline) {
    const modal = findUploadModal();
    if (!modal) {
      // Modal fechou → upload OK
      console.log('[DARKO LAB UI audio] modal fechou, upload OK');
      return true;
    }
    const txt = modal.textContent || '';
    const uploadingShown = /Uploading\.\.\./i.test(txt);
    if (uploadingShown) lastUploading = Date.now();
    // Texto de erro
    if (/upload failed|invalid|corrupted|nao suportado|not supported/i.test(txt)) {
      throw new Error('HeyGen reportou erro no upload de audio. Modal text: ' + txt.slice(0, 200));
    }
    // Se "Uploading..." sumiu mas modal continua aberto, aguarda mais 3s entao
    // tenta selecionar o audio recem-uploaded da lista
    if (!uploadingShown && Date.now() - lastUploading > 3000) {
      console.log('[DARKO LAB UI audio] Uploading sumiu, modal aberto — tentando selecionar audio recem-uploaded');
      // Procura o item mais recente na lista (geralmente primeiro)
      const items = modal.querySelectorAll('button, [role="button"], li');
      for (const it of items) {
        const itxt = (it.textContent || '').trim();
        if (/\d{1,2}:\d{2}/.test(itxt) && /just now|seconds ago|agora/i.test(itxt)) {
          clickElement(it);
          await sleep(500);
          break;
        }
      }
      // Procura botao Use/Apply pra confirmar
      const useBtn = Array.from(modal.querySelectorAll('button')).find((b) => {
        const t = (b.textContent || '').trim().toLowerCase();
        return t === 'use' || t === 'apply' || t === 'use audio' || t === 'select' || t === 'confirm';
      });
      if (useBtn) {
        console.log('[DARKO LAB UI audio] clicando Use/Apply');
        clickElement(useBtn);
        await sleep(800);
      }
    }
    await sleep(500);
  }
  console.warn('[DARKO LAB UI audio] waitForAudioUploadComplete timeout. Continua mesmo assim.');
  return false;
}

function clickElement(el) {
  if (!el) return;
  if (el.tagName === 'BUTTON' || (typeof el.click === 'function' && el.tagName !== 'DIV' && el.tagName !== 'SPAN')) {
    try { el.click(); return; } catch {}
  }
  const r = el.getBoundingClientRect();
  const opts = { bubbles: true, cancelable: true, view: window, clientX: r.left + r.width/2, clientY: r.top + r.height/2, button: 0, buttons: 1 };
  try {
    el.dispatchEvent(new PointerEvent('pointerdown', { ...opts, pointerType: 'mouse' }));
    el.dispatchEvent(new PointerEvent('pointerup', { ...opts, pointerType: 'mouse' }));
  } catch {}
  el.dispatchEvent(new MouseEvent('click', opts));
}

async function selectAvatarInUI(avatarId, avatarName, groupName) {
  const grp = groupName || avatarName;
  console.log('[DARKO LAB UI avatar] alvo avatarId=', avatarId, 'name=', avatarName, 'group=', grp);
  let changeBtn = findButtonByText(['change avatar', 'change my avatar']);
  if (!changeBtn) changeBtn = findAvatarPreviewClickable();
  if (!changeBtn) { console.warn('[DARKO LAB UI avatar] NAO consegui abrir gallery'); return; }
  console.log('[DARKO LAB UI avatar] clicando Change Avatar');
  clickElement(changeBtn);
  await sleep(1800);
  if (grp) {
    const card = findGalleryCardByName(grp);
    if (card) { console.log('[DARKO LAB UI avatar] clicando card', grp); clickElement(card); await sleep(1800); }
    else console.warn('[DARKO LAB UI avatar] card', grp, 'nao achado');
  }
  await sleep(800);
  const lookOk = await clickAvatarCardByImageId(avatarId);
  if (!lookOk) console.warn('[DARKO LAB UI avatar] look', avatarId, 'nao achado');
  await sleep(1000);
  const useBtn = findButtonByText(['use avatar', 'use this avatar', 'apply']);
  if (useBtn) { console.log('[DARKO LAB UI avatar] clicando Use Avatar'); clickElement(useBtn); await sleep(1000); }
  console.log('[DARKO LAB UI avatar] selecao concluida');
}

function findButtonByText(textsLower) {
  const all = Array.from(document.querySelectorAll('button, [role="button"], a, div[tabindex]'));
  for (const el of all) {
    if (el.offsetParent === null || el.disabled) continue;
    const t = (el.textContent || '').trim().toLowerCase();
    if (!t || t.length > 50) continue;
    for (const target of textsLower) {
      if (t === target || t.includes(target)) return el;
    }
  }
  return null;
}

function findAvatarPreviewClickable() {
  for (const img of document.querySelectorAll('img')) {
    const r = img.getBoundingClientRect();
    if (r.width > 100 && r.height > 100 && r.right > window.innerWidth * 0.5) {
      let p = img.parentElement;
      while (p && p !== document.body) {
        const c = window.getComputedStyle(p).cursor;
        if (p.tagName === 'BUTTON' || p.getAttribute('role') === 'button' || c === 'pointer') return p;
        p = p.parentElement;
      }
    }
  }
  return null;
}

function findGalleryCardByName(name) {
  const target = name.toLowerCase().trim();
  const candidates = [];
  for (const el of document.querySelectorAll('div, button, [role="button"]')) {
    if (el.offsetParent === null) continue;
    const t = (el.textContent || '').trim().toLowerCase();
    if (!t || t.length > 50) continue;
    if (t !== target && !t.startsWith(target)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 60 || r.height < 60 || r.width > 300) continue;
    if (!el.querySelector('img')) continue;
    let target_el = el;
    while (target_el && target_el !== document.body) {
      const c = window.getComputedStyle(target_el).cursor;
      if (target_el.tagName === 'BUTTON' || target_el.getAttribute('role') === 'button' || c === 'pointer') break;
      target_el = target_el.parentElement;
    }
    candidates.push({ el: target_el || el, exact: t === target });
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => (b.exact ? 1 : 0) - (a.exact ? 1 : 0));
  return candidates[0].el;
}

async function clickAvatarCardByImageId(avatarId) {
  for (const img of document.querySelectorAll('img')) {
    if (img.offsetParent === null) continue;
    if (!img.src || !img.src.includes(avatarId)) continue;
    let target = img;
    while (target && target !== document.body) {
      const c = window.getComputedStyle(target).cursor;
      if (target.tagName === 'BUTTON' || target.getAttribute('role') === 'button' || c === 'pointer') {
        clickElement(target); return true;
      }
      target = target.parentElement;
    }
    clickElement(img); return true;
  }
  return false;
}

function extractVideoList(j) {
  if (!j) return null;
  const candidates = [j?.data?.videos, j?.data?.list, j?.data?.video_list, j?.data?.items, j?.videos, j?.list, j?.items, Array.isArray(j?.data) ? j.data : null];
  for (const c of candidates) if (Array.isArray(c)) return c;
  return null;
}




/* ============= API Proxy (engenharia reversa de @euojeff.daily) ============= */

function base64ToBytes(b64) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

async function proxyApiFetch({ url, method = 'GET', headers = {}, bodyText, bodyBase64, bodyType }) {
  const opts = { method, headers: { ...headers } };
  let host = '';
  try { host = new URL(url).host; } catch {}
  if (host.endsWith('heygen.com') || host.endsWith('heygen.ai')) {
    opts.credentials = 'include';
  }
  let uploadedBytes = 0;
  if (bodyText !== undefined) {
    opts.body = bodyText;
    uploadedBytes = bodyText.length;
  } else if (bodyBase64) {
    const bytes = base64ToBytes(bodyBase64);
    uploadedBytes = bytes.byteLength;
    opts.body = new Blob([bytes], { type: bodyType || 'application/octet-stream' });
  }
  const r = await fetch(url, opts);
  let data;
  const ct = r.headers.get('content-type') || '';
  // NDJSON (newline-delimited JSON) — usado por endpoints de streaming
  // como /v2/online/text_to_speech.stream. content-type: application/x-ndjson.
  // CHECAR ANTES do .includes('json') porque "x-ndjson" tambem matchea "json".
  if (/ndjson/i.test(ct)) {
    try {
      const txt = await r.text();
      const lines = txt.split(/\r?\n/).filter((l) => l.trim().length > 0);
      const chunks = [];
      let parseErr = null;
      for (const line of lines) {
        try { chunks.push(JSON.parse(line)); }
        catch (e) { parseErr = String(e?.message || e); }
      }
      // Assemblea audio dos chunks: cada chunk tem audio_bytes em base64 SEPARADO
      // (com padding '==' proprio). NAO da pra concatenar as strings base64
      // direto — tem que decodificar cada uma pra bytes E concatenar os bytes.
      const chunkByteArrays = [];
      let totalBytes = 0;
      let audioUrlFromChunks = null;
      let chunksWithAudio = 0;
      for (const c of chunks) {
        const b = c?.audio_bytes ?? c?.data?.audio_bytes ?? c?.audio ?? c?.audio_b64 ?? c?.chunk ?? c?.bytes;
        if (b && typeof b === 'string') {
          try {
            const bin = atob(b);
            const arr = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
            chunkByteArrays.push(arr);
            totalBytes += arr.length;
            chunksWithAudio++;
          } catch (decodeErr) {
            console.warn('[DARKO LAB] chunk base64 invalido, skip:', String(decodeErr?.message || decodeErr));
          }
        }
        const u = c?.audio_url ?? c?.url ?? c?.data?.audio_url;
        if (u && typeof u === 'string' && !audioUrlFromChunks) audioUrlFromChunks = u;
      }
      // Concatena bytes em um unico Uint8Array e re-encoda em base64 valido
      let assembledBase64 = '';
      if (chunkByteArrays.length > 0) {
        const merged = new Uint8Array(totalBytes);
        let off = 0;
        for (const a of chunkByteArrays) { merged.set(a, off); off += a.length; }
        // Chunked encode pra evitar call stack overflow em audios grandes
        const CHUNK = 0x8000;
        let bin = '';
        for (let i = 0; i < merged.length; i += CHUNK) {
          bin += String.fromCharCode.apply(null, merged.subarray(i, i + CHUNK));
        }
        assembledBase64 = btoa(bin);
      }
      data = {
        _ndjson: chunks,
        _ndjsonLines: lines.length,
        _ndjsonChunksWithAudio: chunksWithAudio,
        _ndjsonParseErr: parseErr,
        _bytesBase64: assembledBase64 || undefined,
        _byteLength: totalBytes,
        _audioUrl: audioUrlFromChunks || undefined,
        _rawPreview: txt.slice(0, 500),
        _rawLength: txt.length,
        _contentType: 'audio/mpeg',
        _ndjsonOriginalCt: ct,
        _extVersion: DARKO_EXT_VERSION,
      };
      console.log(`[DARKO LAB] proxy ndjson ${lines.length} lines, ${chunksWithAudio} c/audio, decoded=${totalBytes}B, audioUrl=${audioUrlFromChunks ? 'yes' : 'no'}`);
    } catch (e) {
      data = { _ndjsonError: String(e?.message || e), _contentType: ct, _extVersion: DARKO_EXT_VERSION };
    }
  } else if (ct.includes('json')) {
    try {
      data = await r.json();
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        data._contentType = ct;
        data._extVersion = DARKO_EXT_VERSION;
      }
    } catch (e) {
      data = { _jsonParseError: String(e?.message || e), _contentType: ct, _extVersion: DARKO_EXT_VERSION };
    }
  } else if (/^(audio|video|image|application\/octet-stream)/i.test(ct)) {
    try {
      const buf = await r.arrayBuffer();
      const bytes = new Uint8Array(buf);
      // Chunked binary→string pra evitar string concat O(n^2) em audios grandes
      const CHUNK = 0x8000;
      let bin = '';
      for (let i = 0; i < bytes.length; i += CHUNK) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
      }
      data = { _bytesBase64: btoa(bin), _contentType: ct, _byteLength: bytes.length, _extVersion: DARKO_EXT_VERSION };
      console.log(`[DARKO LAB] proxy binary ${ct} ${bytes.length}B → base64`);
    } catch (e) {
      data = { _binaryError: String(e?.message || e), _contentType: ct, _extVersion: DARKO_EXT_VERSION };
    }
  } else {
    try {
      const txt = await r.text();
      data = { _text: txt.slice(0, 2000), _textLength: txt.length, _contentType: ct, _extVersion: DARKO_EXT_VERSION };
    } catch (e) {
      data = { _readError: String(e?.message || e), _contentType: ct, _extVersion: DARKO_EXT_VERSION };
    }
  }
  return { status: r.status, ok: r.ok, body: data, _uploadedBytes: uploadedBytes };
}


/* ================================================================== *
 *  HEYGEN STUDIO — VA DE AVATAR (cena-por-cena, Mirror voice)         *
 * ------------------------------------------------------------------ *
 *  Fluxo EXCLUSIVO de Variacao de Avatar. NAO usar pra task normal.   *
 *  background.js navega pra /avatar (My Avatars). Aqui a gente:       *
 *   1. Abre o editor Studio "Build scene-by-scene" do avatar exato    *
 *      (match por avatarId na img do card — avatar ja vem bound na    *
 *      Scene 1, entao NUNCA arriscamos avatar errado).                *
 *   2. Pra cada parte de audio: cria cena (Add scene a partir da 2a), *
 *      upa parteN.wav, forca "Use avatar voice" => Mirror voice,      *
 *      (opcional) seta a voz, da PLAY pra carregar a fala.            *
 *   3. Verifica que TODAS as cenas estao em Mirror voice (aborta se   *
 *      qualquer uma ficou Recorded — requisito duro do VA).           *
 *   4. Clica Generate 1x. Captura video_id via interceptor.           *
 *   5. Retorna QUEUED:<id> (dispatch-only). A page faz poll+download. *
 *                                                                    *
 *  HeyGen ja concatena as cenas no video final na ordem — o timing    *
 *  do audio original e preservado (1 parte = 1 cena, sem decupagem).  *
 * ================================================================== */

function studioLog(...a) { console.log('[DARKO LAB STUDIO]', ...a); }
function studioWarn(...a) { console.warn('[DARKO LAB STUDIO]', ...a); }

/** Click CONFIAVEL (isTrusted=true) via CDP Input.dispatchMouseEvent.
 *  Usado pros botoes que so respondem a eventos confiaveis (Add audio,
 *  linha da biblioteca, pilula Use avatar voice no create-v4). */
async function cdpClick(x, y) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'HG_CDP_CLICK', x: Math.round(x), y: Math.round(y) }, (res) => {
      resolve(res || { ok: false, error: 'no response' });
    });
  });
}
async function cdpClickEl(el, label) {
  if (!el) { studioWarn(`cdpClickEl ${label || ''}: elemento nulo`); return false; }
  try { el.scrollIntoView({ block: 'center', behavior: 'instant' }); } catch {}
  await sleep(150);
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) { studioWarn(`cdpClickEl ${label || ''}: rect zero`); return false; }
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  const res = await cdpClick(x, y);
  if (!res.ok) studioWarn(`cdpClickEl ${label || ''}: falhou - ${res.error}`);
  else studioLog(`cdpClick ${label || ''} @${Math.round(x)},${Math.round(y)} OK`);
  return !!res.ok;
}
async function cdpDetachBg() {
  try {
    await new Promise((r) => chrome.runtime.sendMessage({ type: 'HG_CDP_DETACH' }, () => r()));
  } catch {}
}

function studioDumpDiag(tag) {
  try {
    const btns = Array.from(document.querySelectorAll('button, [role="button"]'))
      .filter((b) => b.offsetParent !== null)
      .slice(0, 40)
      .map((b) => ((b.textContent || '').trim() || b.getAttribute('aria-label') || '').slice(0, 32))
      .filter(Boolean);
    studioWarn(`diag[${tag}] url=${location.href}`);
    studioWarn(`diag[${tag}] botoes visiveis:`, btns);
  } catch {}
}

/** True se ja estamos dentro do editor Studio (painel Script + cenas). */
function isInStudioEditor() {
  const txt = (document.body.textContent || '');
  const hasScript = /(^|\s)Script(\s|$)/.test(txt) || !!document.querySelector('[class*="scene" i], [data-testid*="scene" i]');
  const hasAddScene = !!findAddSceneButton();
  const hasGen = !!findStudioGenerateButton();
  return (hasScript && (hasAddScene || hasGen));
}

/** Botao "Add scene" / "Adicionar cena" no rodape do painel Script. */
function findAddSceneButton() {
  const all = Array.from(document.querySelectorAll('button, [role="button"], div[tabindex]'));
  for (const el of all) {
    if (el.offsetParent === null || el.disabled) continue;
    const t = (el.textContent || '').trim().toLowerCase();
    if (!t || t.length > 40) continue;
    if (
      t === 'add scene' || t === 'adicionar cena' ||
      t === '+ add scene' || t.includes('add scene') || t.includes('adicionar cena')
    ) return el;
  }
  return null;
}

/** Botao Generate do Studio: topo-direita, texto "Generate" (NAO
 *  "Render Scene", NAO o play ▶). Pill largo (>=70px). */
function findStudioGenerateButton() {
  const W = window.innerWidth;
  const cands = [];
  for (const b of document.querySelectorAll('button, [role="button"]')) {
    if (b.disabled || b.offsetParent === null) continue;
    const r = b.getBoundingClientRect();
    if (r.width < 60 || r.height < 22 || r.height > 90) continue;
    const t = (b.textContent || '').trim().toLowerCase();
    const al = (b.getAttribute('aria-label') || '').toLowerCase();
    const dt = (b.getAttribute('data-testid') || '').toLowerCase();
    if (t.includes('render scene') || t.includes('renderizar cena')) continue;
    let score = 0;
    if (t === 'generate' || t === 'gerar') score += 100;
    else if (t.startsWith('generate') || t.startsWith('gerar')) score += 70;
    if (al.includes('generate') || dt.includes('generate')) score += 60;
    if (r.top < window.innerHeight * 0.25) score += 30;     // topo
    score += Math.round(((r.right) / W) * 20);              // mais a direita
    if (score > 0) cands.push({ b, score });
  }
  if (!cands.length) return null;
  cands.sort((x, y) => y.score - x.score);
  return cands[0].b;
}

/** Lista os blocos de cena no painel Script (esquerda). Heuristica:
 *  blocos que contem um chip de audio (parteN.wav / mm:ss) e/ou o
 *  toggle de voz (Recorded voice / Mirror voice). */
function getSceneScriptBlocks() {
  const blocks = [];
  const seen = new Set();
  const toggles = Array.from(document.querySelectorAll('button, [role="button"], span, div'))
    .filter((el) => {
      if (el.offsetParent === null) return false;
      const t = (el.textContent || '').trim().toLowerCase();
      return t === 'recorded voice' || t === 'mirror voice' || t === 'use avatar voice';
    });
  for (const tog of toggles) {
    // sobe ate um container "cena" razoavel (tem o chip de audio OU numero)
    let p = tog;
    for (let i = 0; i < 8 && p && p !== document.body; i++) {
      p = p.parentElement;
      if (!p) break;
      const txt = (p.textContent || '');
      if (/\.wav|\.mp3|\d{1,2}:\d{2}/.test(txt)) {
        const r = p.getBoundingClientRect();
        if (r.height > 40 && r.height < 600) break;
      }
    }
    const container = p || tog.parentElement || tog;
    const key = container;
    if (seen.has(key)) continue;
    seen.add(key);
    blocks.push(container);
  }
  return blocks;
}

/** Acha o toggle de modo de voz dentro de um escopo (ou doc todo). */
function findVoiceModeToggle(scope) {
  const root = scope || document;
  const cand = Array.from(root.querySelectorAll('button, [role="button"], div[tabindex], span'));
  let best = null, bestN = Infinity;
  for (const el of cand) {
    if (el.offsetParent === null) continue;
    const t = (el.textContent || '').trim().toLowerCase();
    if (!t || t.length > 30) continue;
    const isToggle = t === 'recorded voice' || t === 'mirror voice' ||
      ((t.includes('recorded voice') || t.includes('mirror voice')) && t.length < 24);
    if (!isToggle) continue;
    // menor elemento (label puro) — evita pegar container grande
    const n = el.querySelectorAll('*').length;
    if (n < bestN) { bestN = n; best = el; }
  }
  if (!best) return null;
  let c = best;
  for (let i = 0; i < 4 && c && c !== document.body; i++) {
    if (c.tagName === 'BUTTON' || c.getAttribute('role') === 'button' ||
        window.getComputedStyle(c).cursor.includes('pointer')) return c;
    c = c.parentElement;
  }
  return best;
}

/** Garante que UMA cena (scope) esta em "Mirror voice".
 *  Se estiver "Recorded voice": clica o toggle e seleciona a opcao
 *  "Use avatar voice" (popover pode estar portalado fora do scope).
 *  Retorna true se confirmou Mirror voice. */
async function setSceneMirrorVoice(scope, sceneLabel) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const tog = findVoiceModeToggle(scope) || findVoiceModeToggle(document);
    if (!tog) {
      studioWarn(`${sceneLabel}: toggle de voz nao encontrado (tentativa ${attempt})`);
      await sleep(700);
      continue;
    }
    const cur = (tog.textContent || '').trim().toLowerCase();
    if (cur.includes('mirror voice')) {
      studioLog(`${sceneLabel}: ja esta em Mirror voice ✓`);
      return true;
    }
    studioLog(`${sceneLabel}: esta em "${cur}" — forcando Use avatar voice (tentativa ${attempt}) via CDP`);
    await cdpClickEl(tog, 'voice-toggle');
    await sleep(900);
    // procura a opcao "Use avatar voice" / "Mirror voice" num popover/menu
    // (HeyGen portala menus no body, entao busca global).
    let opt = null, optN = Infinity;
    const PHRASES = ['use avatar voice', 'mirror voice', 'avatar voice', 'usar voz do avatar', 'voz do avatar'];
    const opts = Array.from(document.querySelectorAll('[role="menuitem"], [role="option"], button, li, div[tabindex], div, span, p'));
    for (const o of opts) {
      if (o.offsetParent === null) continue;
      const t = (o.textContent || '').trim().toLowerCase();
      if (!t || t.length > 40) continue;
      const hit = PHRASES.some((p) => t === p || t.startsWith(p));
      if (!hit) continue;
      const n = o.querySelectorAll('*').length; // menor elemento = label puro
      if (n < optN) { optN = n; opt = o; }
    }
    if (opt) {
      let c = opt;
      for (let i = 0; i < 4 && c && c !== document.body; i++) {
        if (c.tagName === 'BUTTON' || c.getAttribute('role') === 'menuitem' ||
            c.getAttribute('role') === 'option' || window.getComputedStyle(c).cursor.includes('pointer')) break;
        c = c.parentElement;
      }
      await cdpClickEl(c || opt, 'use-avatar-voice');
      await sleep(1100);
    } else {
      // toggle pode ser switch direto (sem menu) — re-checa
      studioLog(`${sceneLabel}: sem menu visivel, assumindo toggle direto`);
      await sleep(600);
    }
    // re-verifica
    const tog2 = findVoiceModeToggle(scope) || findVoiceModeToggle(document);
    const cur2 = tog2 ? (tog2.textContent || '').trim().toLowerCase() : '';
    if (cur2.includes('mirror voice')) {
      studioLog(`${sceneLabel}: confirmado Mirror voice ✓`);
      return true;
    }
    // fecha eventual popover aberto antes de retentar
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(500);
  }
  return false;
}

/** Da play na cena ativa pra HeyGen "carregar a fala" do avatar antes
 *  do Generate. Best-effort: clica o ▶ do scope e espera o loading
 *  sumir. */
async function playStudioScene(scope, sceneLabel) {
  const root = scope || document;
  let playBtn = null;
  for (const b of root.querySelectorAll('button, [role="button"]')) {
    if (b.offsetParent === null) continue;
    const al = (b.getAttribute('aria-label') || '').toLowerCase();
    const t = (b.textContent || '').trim().toLowerCase();
    const svg = b.querySelector('svg');
    const svgHtml = svg ? svg.innerHTML.toLowerCase() : '';
    const looksPlay =
      al.includes('play') || al.includes('preview') || t === 'play' ||
      svgHtml.includes('polygon') || svgHtml.includes('m8 5v14') || svgHtml.includes('play');
    if (looksPlay) {
      const r = b.getBoundingClientRect();
      if (r.width > 10 && r.width < 80 && r.height > 10 && r.height < 80) { playBtn = b; break; }
    }
  }
  if (!playBtn) {
    // fallback: barra de transporte do preview central
    playBtn = Array.from(document.querySelectorAll('button, [role="button"]')).find((b) => {
      if (b.offsetParent === null) return false;
      const al = (b.getAttribute('aria-label') || '').toLowerCase();
      return al === 'play' || al.includes('play scene') || al.includes('preview');
    }) || null;
  }
  if (!playBtn) {
    studioWarn(`${sceneLabel}: botao play nao achado — seguindo (HeyGen pode carregar no Generate)`);
    await sleep(1500);
    return;
  }
  studioLog(`${sceneLabel}: play pra carregar a fala via CDP...`);
  await cdpClickEl(playBtn, 'play scene');
  // espera o loading/spinner sumir (best-effort) + buffer
  const deadline = Date.now() + 30000;
  await sleep(1500);
  while (Date.now() < deadline) {
    const loading = Array.from(document.querySelectorAll('*')).some((el) => {
      if (el.offsetParent === null) return false;
      const t = (el.textContent || '').trim().toLowerCase();
      return t === 'loading...' || t === 'loading' || t === 'generating audio' || t === 'carregando...';
    });
    const spinner = document.querySelector('[class*="spinner" i]:not([style*="display: none"]), [role="progressbar"]');
    if (!loading && !spinner) break;
    await sleep(800);
  }
  await sleep(1500);
}

/** Aguarda o editor Studio cena-por-cena montar. O background ja navegou
 *  DIRETO pra URL do editor (app.heygen.com/create-v4/draft?avatarGroup
 *  =<g>&defaultLookId=<look>&fromCreateButton=true) — o avatar ja vem
 *  bound na Scene 1, sem caça a menu/DOM. So esperamos a UI ficar pronta
 *  (painel Script + Add scene/Generate). Validado em teste real. */
async function enterStudioForAvatar(avatarId, avatarName, groupName) {
  await dismissAnnouncementModals();
  const ok = await waitForOrNull(() => isInStudioEditor(), 45000, 800);
  if (!ok) {
    studioDumpDiag('enter-editor-timeout');
    throw new Error(
      'Editor Studio (create-v4) nao montou em 45s. Confere se o avatar/grupo ' +
      'existe na conta HeyGen. Cola os logs [DARKO LAB STUDIO].'
    );
  }
  // editor pesado (canvas) — folga extra pra cena 1 + avatar bound montarem
  await sleep(3500);
  // GUARDA: modal "Plans that fit your scale" e upsell que bloqueia a
  // UI. DISMISS via JS (display:none no backdrop+modal) sem clicar nada
  // do modal (botao Switch poderia cobrar plano).
  studioDismissPaywallIfShown('editor pronto');
  // Espera ate o botao Upload audio ficar REALMENTE clicavel (sem
  // overlays cobrindo). HeyGen tem loading overlay com z=999999 bg
  // solid que bloqueia tudo ate o canvas montar de verdade.
  studioLog('aguardando overlays clearem (Upload audio btn no topo)...');
  let lastTopText = '';
  const clickableOk = await waitForOrNull(() => {
    studioDismissPaywallIfShown('overlay-wait');
    const btn = findStudioUploadAudioBtn();
    if (!btn) return false;
    const r = btn.getBoundingClientRect();
    if (r.width === 0) return false;
    const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (!at) return false;
    // Aceita btn, descendente do btn, OU ancestral (elementFromPoint
    // pode retornar o container — clique propaga via bubble normal).
    if (at === btn) return true;
    if (btn.contains(at)) return true;
    if (at.contains && at.contains(btn)) return true;
    const t = at.tagName + ' z=' + (window.getComputedStyle(at).zIndex || '?');
    if (t !== lastTopText) { lastTopText = t; studioLog('overlay topo no Upload audio: ' + t); }
    return false;
  }, 60000, 1000);
  if (!clickableOk) {
    studioWarn('Upload audio btn nao ficou clicavel em 60s — seguindo mesmo assim');
  }
  await sleep(800);
  studioLog('editor Studio 100% pronto');
}

/** Se HeyGen abriu o paywall "Plans that fit your scale" — REMOVE
 *  backdrop + modal via JS (display:none). NAO clica em nada do
 *  modal (botao "Switch" poderia cobrar plano). VALIDADO: o backdrop
 *  e um DIV fixed z>=100 com bg semi-transparente cobrindo viewport.
 *  Removendo o backdrop libera os cliques no editor por tras. */
function studioDismissPaywallIfShown(where) {
  const plans = [...document.querySelectorAll('[role="dialog"]')].find((d) =>
    d.offsetParent !== null && /Plans that fit your scale/i.test(d.textContent || ''));
  let dismissed = 0;
  if (plans) {
    plans.style.display = 'none';
    dismissed++;
    studioLog(`paywall (${where}): "Plans that fit your scale" escondido`);
  }
  // Remove overlays bloqueando viewport. 2 tipos:
  //  A) backdrop semi-transparente (rgba(...,0.x), z>=100, fixed) — paywall
  //  B) overlay de transicao do HeyGen (z=999999, bg solid, contem video
  //     "animations/disappear_v1.webm" tw-hidden — fica STUCK em sessoes
  //     onde o paywall apareceu antes)
  for (const d of document.querySelectorAll('div')) {
    if (d.style.display === 'none') continue;
    const cs = window.getComputedStyle(d);
    if (cs.position !== 'fixed') continue;
    const z = parseInt(cs.zIndex) || 0;
    if (z < 100) continue;
    const r = d.getBoundingClientRect();
    if (r.width < window.innerWidth * 0.7 || r.height < window.innerHeight * 0.7) continue;
    const bg = cs.backgroundColor;
    const isSemiTrans = /rgba?\([^)]*,\s*0?\.[0-9]+\)/.test(bg);
    // HeyGen overlay sticky: z=999999 com video animations
    const hasAnimVideo = !!d.querySelector('video[src*="animations"]');
    const isStuckHeygenOverlay = z >= 999999 && hasAnimVideo;
    if (!isSemiTrans && !isStuckHeygenOverlay) continue;
    // Backdrop puro / overlay nao tem muitos botoes; dialog legit tem
    const btnsInside = d.querySelectorAll('button').length;
    if (btnsInside > 10) continue;
    d.style.display = 'none';
    dismissed++;
  }
  // Corrige ancestrais com opacity:0 dos botoes criticos do editor
  // (paywall interrompe a animacao de fade-in, deixa panel invisivel).
  const criticalBtns = [...document.querySelectorAll('button')].filter((b) => {
    if (b.offsetParent === null) return false;
    const t = (b.textContent || '').trim().toLowerCase();
    return t === 'upload audio' || t === 'generate' || t === 'add scene';
  });
  for (const btn of criticalBtns) {
    let p = btn;
    for (let i = 0; i < 10 && p && p !== document.body; i++) {
      const cs = window.getComputedStyle(p);
      if (cs.opacity === '0') {
        p.style.setProperty('opacity', '1', 'important');
        p.style.transition = 'none';
        dismissed++;
        studioLog(`paywall (${where}): forcei opacity:1 em ancestral de "${(btn.textContent||'').trim()}"`);
        break;
      }
      p = p.parentElement;
    }
  }
  if (dismissed > 0) studioLog(`paywall (${where}): ${dismissed} ajuste(s)`);
  return dismissed > 0;
}

/** Legado: agora dismiss em vez de abort. */
function studioAbortIfPaywall(where) {
  studioDismissPaywallIfShown(where);
}

/** Acha o controle "Motion Engine" do painel direito do Studio
 *  (botao/dropdown que mostra "Avatar III/IV/V"). Sem restricao de
 *  posicao vertical (painel direito varia). Prefere o que estiver
 *  perto de um rotulo "Motion Engine". */
function findStudioMotorControl() {
  const cands = [];
  for (const el of document.querySelectorAll('button, [role="button"], div[tabindex], div, span, a')) {
    if (el.offsetParent === null || el.disabled) continue;
    const t = (el.textContent || '').trim();
    if (!/^Avatar (III|IV|V)\b/.test(t)) continue;
    if (t.length > 60) continue;
    if (el.querySelectorAll('*').length > 6) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 40 || r.height < 16 || r.width > 420) continue;
    const style = window.getComputedStyle(el);
    const clickable = style.cursor.includes('pointer') || el.tagName === 'BUTTON' ||
      el.getAttribute('role') === 'button' || (el.className || '').includes('cursor-pointer');
    // bonus se houver "Motion Engine" por perto (ancestral ate 5 niveis)
    let nearLabel = false;
    let p = el;
    for (let i = 0; i < 6 && p && p !== document.body; i++) {
      p = p.parentElement;
      if (p && /motion engine|motor/i.test(p.textContent || '') && (p.textContent || '').length < 400) { nearLabel = true; break; }
    }
    cands.push({ el, clickable, nearLabel, right: r.right });
  }
  if (!cands.length) return null;
  cands.sort((a, b) =>
    (a.nearLabel !== b.nearLabel ? (a.nearLabel ? -1 : 1)
      : a.clickable !== b.clickable ? (a.clickable ? -1 : 1)
      : b.right - a.right));
  return cands[0].el;
}

/** Garante Avatar III na cena ativa (NUNCA IV/V — protege creditos
 *  pagos). Se nao confirmar III, retorna false → runStudioJob ABORTA
 *  antes do Generate. */
async function setStudioMotorAvatarIII(sceneLabel) {
  const target = 'Avatar III';
  for (let attempt = 1; attempt <= 3; attempt++) {
    const ctrl = findStudioMotorControl();
    if (!ctrl) {
      studioWarn(`${sceneLabel}: controle Motion Engine nao achado (tentativa ${attempt})`);
      await sleep(800);
      continue;
    }
    const cur = (ctrl.textContent || '').trim();
    if (/^Avatar III\b/.test(cur)) {
      studioLog(`${sceneLabel}: Motion Engine ja em Avatar III ✓`);
      return true;
    }
    studioLog(`${sceneLabel}: Motion Engine em "${cur}" — trocando pra Avatar III (tentativa ${attempt}) via CDP`);
    await cdpClickEl(ctrl, 'motor-ctrl');
    await sleep(900);
    // procura item "Avatar III" no menu (portalado no body).
    // VALIDADO EM TESTE REAL: o menu lista "Avatar V/IV/III" com
    // descricao concatenada ("Avatar IIIPremium..."). Pega o MENOR
    // elemento cujo texto COMECA com "Avatar III" (o label puro tem
    // children=0 e texto exatamente "Avatar III"). "Avatar IV/V" nao
    // dao falso-positivo (nao comecam com "Avatar III").
    let item = null, bestN = Infinity;
    for (const o of document.querySelectorAll('[role="menuitem"], [role="option"], li, button, div[tabindex], div, span, p')) {
      if (o.offsetParent === null) continue;
      const t = (o.textContent || '').trim();
      if (!t.startsWith('Avatar III')) continue;
      const n = o.querySelectorAll('*').length;
      if (n < bestN) { bestN = n; item = o; }
    }
    if (item) {
      let c = item;
      for (let i = 0; i < 4 && c && c !== document.body; i++) {
        if (c.tagName === 'BUTTON' || c.getAttribute('role') === 'menuitem' ||
            c.getAttribute('role') === 'option' || window.getComputedStyle(c).cursor.includes('pointer')) break;
        c = c.parentElement;
      }
      await cdpClickEl(c || item, 'Avatar III');
      await sleep(1100);
    } else {
      studioWarn(`${sceneLabel}: item "Avatar III" nao apareceu no menu`);
    }
    const after = findStudioMotorControl();
    if (after && /^Avatar III\b/.test((after.textContent || '').trim())) {
      studioLog(`${sceneLabel}: confirmado Avatar III ✓`);
      return true;
    }
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(500);
  }
  return false;
}

/** Varre a UI inteira: se QUALQUER coisa visivel mostrar "Avatar IV"
 *  ou "Avatar V", aborta (nao pode gerar pago em VA). */
function studioHasPaidEngineVisible() {
  for (const el of document.querySelectorAll('button, [role="button"], div, span, a')) {
    if (el.offsetParent === null) continue;
    const t = (el.textContent || '').trim();
    if (t.length > 60) continue;
    if (/^Avatar (IV|V)\b/.test(t)) {
      // ignora se for so um item de menu aberto (nao o estado atual)
      const role = el.getAttribute('role');
      if (role === 'menuitem' || role === 'option') continue;
      return t;
    }
  }
  return null;
}

/** Botao "Upload audio" do Studio (VALIDADO EM TESTE REAL: texto
 *  exatamente "Upload audio", <button> no topo do painel Script). */
function findStudioUploadAudioBtn() {
  const cands = Array.from(document.querySelectorAll('button, [role="button"], div[tabindex]'));
  // 1) match exato "Upload audio"
  for (const e of cands) {
    if (e.offsetParent === null) continue;
    if (/^upload audio$/i.test((e.textContent || '').trim())) return e;
  }
  // 2) contem "Upload audio" e e curto (evita pegar texto de modal)
  for (const e of cands) {
    if (e.offsetParent === null) continue;
    const t = (e.textContent || '').trim();
    if (/upload audio/i.test(t) && t.length < 24) return e;
  }
  // 3) legado Quick Create ("Upload")
  return findUploadAudioToggle();
}

/** Injeta o File via DataTransfer + drop events.
 *  VALIDADO AO VIVO no create-v4: a sequencia "input.files set+change"
 *  SOZINHA nao dispara o upload real; a combinacao com DragEvent(drop)
 *  na dropzone aciona o S3/asset upload (confirmado por sniff:
 *  2 PUTs S3 + 2 POSTs /asset). Drop com `new DragEvent(..., {
 *  dataTransfer })` na zona "Upload a file or drag and drop here". */
async function studioInjectAudioFile(audioBase64, filename) {
  const bin = atob(audioBase64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const ext = (filename || '').toLowerCase().match(/\.(\w+)$/)?.[1] || 'wav';
  const mime = ext === 'mp3' ? 'audio/mpeg' : ext === 'm4a' ? 'audio/mp4' : 'audio/wav';
  const file = new File([bytes], filename || 'audio.wav', { type: mime });

  const inp = await waitForOrNull(() => findAudioFileInput(), 8000, 200);
  if (inp) {
    try {
      const dt = new DataTransfer();
      dt.items.add(file);
      inp.files = dt.files;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.dispatchEvent(new Event('change', { bubbles: true }));
      studioLog(`file ${filename} setado no input (${bytes.length}B)`);
    } catch (e) { studioWarn('set input.files falhou:', e?.message || e); }
  }
  // CRITICO: drop na dropzone com DataTransfer eh o que aciona o
  // uploader real do create-v4 (validado ao vivo).
  const modal = findUploadModal();
  if (modal) {
    let zone = null;
    for (const e of modal.querySelectorAll('*')) {
      if (e.offsetParent === null) continue;
      const t = (e.textContent || '').trim();
      if (/Upload a file|drag and drop/i.test(t) && t.length < 160) { zone = e; break; }
    }
    zone = zone || modal;
    try {
      const dt2 = new DataTransfer();
      dt2.items.add(file);
      for (const type of ['dragenter', 'dragover', 'drop']) {
        try {
          const ev = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt2 });
          zone.dispatchEvent(ev);
        } catch {
          const ev = new Event(type, { bubbles: true, cancelable: true });
          try { Object.defineProperty(ev, 'dataTransfer', { value: dt2 }); } catch {}
          zone.dispatchEvent(ev);
        }
      }
      studioLog(`drop ${filename} disparado (deve iniciar S3 upload)`);
    } catch (e) { studioWarn('drop disparo falhou:', e?.message || e); }
  }
  if (!inp && !modal) {
    throw new Error('Input/dropzone de audio nao encontrado no modal Upload Audio.');
  }
}

/** Acha o modal "Confirm Audio" (segunda etapa do upload no create-v4).
 *  Contem o switch "Voice Mirroring" + botoes Back/Add audio/Close. */
function findConfirmAudioModal() {
  const dlgs = Array.from(document.querySelectorAll('[role="dialog"]'));
  for (const d of dlgs) {
    if (d.offsetParent === null) continue;
    const t = d.textContent || '';
    if (/Confirm Audio/i.test(t) && /Voice Mirroring/i.test(t) && /Add audio/i.test(t)) return d;
  }
  return null;
}

/** Upload de audio na CENA ATIVA do Studio create-v4. Fluxo VALIDADO:
 *  1) clica "Upload audio"  -> abre modal Upload Audio (library)
 *  2) drop+input.files do WAV -> S3 upload (2 PUTs + 2 POSTs /asset)
 *  3) aparece modal "Confirm Audio" com switch "Voice Mirroring"
 *  4) NAO toca no switch (ligar dispara paywall "Plans that fit your
 *     scale" que bloqueia). Mirror voice e setada DEPOIS na cena via
 *     "Use avatar voice" (sem paywall).
 *  5) clica "Add audio" -> audio aplicado na cena como Recorded voice
 *  Sucesso = Confirm modal sumiu + chip parteN.wav na cena.
 *  Mirror voice e aplicada via setSceneMirrorVoice depois. */
async function studioUploadAudioToActiveScene(audioBase64, filename, sceneLabel) {
  studioLog(`${sceneLabel}: clicando "Upload audio"...`);
  const upBtn = await waitForOrNull(() => findStudioUploadAudioBtn(), 12000, 400);
  if (!upBtn) {
    studioDumpDiag('no-upload-audio-btn');
    throw new Error(`${sceneLabel}: botao "Upload audio" nao encontrado. Cola os logs [DARKO LAB STUDIO].`);
  }
  await cdpClickEl(upBtn, 'Upload audio btn');
  const modal = await waitForOrNull(() => findUploadModal(), 8000, 250);
  if (!modal) {
    studioDumpDiag('no-upload-modal');
    throw new Error(`${sceneLabel}: modal Upload Audio nao abriu. Cola os logs [DARKO LAB STUDIO].`);
  }
  const upTab = Array.from(modal.querySelectorAll('[role="tab"], button'))
    .find((b) => b.offsetParent !== null && /^upload audio$/i.test((b.textContent || '').trim()));
  if (upTab && upTab.getAttribute('aria-selected') === 'false') { clickElement(upTab); await sleep(400); }

  await studioInjectAudioFile(audioBase64, filename);

  // Aguarda o modal "Confirm Audio" aparecer (segundo step do upload).
  // Pode demorar enquanto o S3 upload + transcribe rodam.
  studioLog(`${sceneLabel}: aguardando modal "Confirm Audio"...`);
  // 1a tentativa: ate 45s o drop disparar Confirm sozinho
  let confirmModal = await waitForOrNull(() => findConfirmAudioModal(), 45000, 600);
  // 2a tentativa (fallback validado ao vivo): se Confirm nao surgiu mas
  // o Upload modal ainda esta aberto com a biblioteca de audios, o
  // arquivo recem-upado esta no topo. Clicar a linha dele abre Confirm.
  if (!confirmModal) {
    const m = findUploadModal();
    if (m) {
      studioLog(`${sceneLabel}: Confirm nao abriu pelo drop, clicando linha da biblioteca`);
      const fnameBase = (filename || '').replace(/\.[a-z0-9]+$/i, '');
      const safeRe = new RegExp('^' + fnameBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\.wav$', 'i');
      let leaf = null;
      for (const e of m.querySelectorAll('span,div')) {
        if (e.offsetParent === null) continue;
        const t = (e.textContent || '').trim();
        if (e.children.length === 0 && safeRe.test(t)) { leaf = e; break; }
      }
      if (!leaf) {
        for (const e of m.querySelectorAll('span,div')) {
          if (e.offsetParent === null) continue;
          if (e.children.length === 0 && /\.wav$/i.test((e.textContent || '').trim()) &&
              (e.textContent || '').trim().length < 30) { leaf = e; break; }
        }
      }
      if (leaf) {
        let row = leaf;
        for (let i = 0; i < 7 && row.parentElement; i++) {
          row = row.parentElement;
          const r = row.getBoundingClientRect();
          const cur = window.getComputedStyle(row).cursor;
          if ((cur.includes('pointer') && r.height > 20 && r.height < 120) ||
              (r.height >= 34 && r.height <= 80 && /\d{1,2}:\d{2}/.test(row.textContent || ''))) break;
        }
        // CDP trusted click - linha da biblioteca exige isTrusted
        const ok = await cdpClickEl(row, 'lib-row');
        if (ok) confirmModal = await waitForOrNull(() => findConfirmAudioModal(), 30000, 500);
      }
    }
  }
  if (!confirmModal) {
    studioDumpDiag('no-confirm-modal');
    // Ultimo fallback: se sumiu o Upload modal e ja tem chip na cena,
    // o audio auto-aplicou (variante de UI). Aceita.
    const chipNow = Array.from(document.querySelectorAll('span, div')).some((e) =>
      e.offsetParent !== null &&
      /^parte\d+\.wav/i.test((e.textContent || '').trim()) &&
      /\d{1,2}:\d{2}/.test(e.textContent || '') &&
      (e.textContent || '').trim().length < 30);
    if (!findUploadModal() && chipNow) {
      studioLog(`${sceneLabel}: audio auto-aplicou (sem Confirm modal) — segue p/ Mirror via toggle da cena`);
      return;
    }
    throw new Error(
      `${sceneLabel}: modal "Confirm Audio" nao apareceu. ` +
      `Cola os logs [DARKO LAB STUDIO].`
    );
  }
  studioLog(`${sceneLabel}: Confirm Audio aberto — NAO toca no switch Voice Mirroring`);
  // CRITICO (validado ao vivo): ligar o switch "Voice Mirroring" AQUI
  // dispara um modal "Plans that fit your scale" (paywall HeyGen) que
  // bloqueia tudo. O fluxo manual correto e: deixar o switch OFF,
  // clicar Add audio (audio entra como Recorded voice), e DEPOIS
  // converter pra Mirror voice clicando "Use avatar voice" na pilula
  // da CENA (setSceneMirrorVoice mais adiante em runStudioJob). Esse
  // caminho NAO dispara paywall.

  // Clica "Add audio" via CDP (isTrusted=true). O onClick do React no
  // create-v4 ignora click sintetico — precisa de evento confiavel.
  studioLog(`${sceneLabel}: clicando "Add audio" via CDP...`);
  let addBtn = Array.from(confirmModal.querySelectorAll('button'))
    .find((b) => b.offsetParent !== null && /^add audio$/i.test((b.textContent || '').trim()));
  if (!addBtn) {
    studioDumpDiag('no-add-audio-btn');
    throw new Error(`${sceneLabel}: botao "Add audio" nao achado. Cola os logs [DARKO LAB STUDIO].`);
  }
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (!findConfirmAudioModal()) break;
    addBtn = Array.from(document.querySelectorAll('button'))
      .find((b) => b.offsetParent !== null && /^add audio$/i.test((b.textContent || '').trim())) || addBtn;
    await cdpClickEl(addBtn, 'Add audio');
    await sleep(1800);
    if (!findConfirmAudioModal()) break;
    studioLog(`${sceneLabel}: Add audio CDP click ${attempt}/3 — modal ainda aberto, retry`);
  }

  // Espera o Confirm modal fechar (= audio attached) com timeout robusto.
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (!findConfirmAudioModal()) break;
    await sleep(500);
  }
  if (findConfirmAudioModal()) {
    studioDumpDiag('confirm-not-closed');
    throw new Error(
      `${sceneLabel}: Confirm modal nao fechou apos Add audio em 60s. ` +
      `Cola os logs [DARKO LAB STUDIO].`
    );
  }
  // tambem fecha o modal Upload Audio se ainda estiver aberto (raro)
  if (findUploadModal()) {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(500);
  }
  await sleep(1500);
  studioLog(`${sceneLabel}: audio ${filename} aplicado na cena com Mirror voice ✓`);
}

/** Seleciona uma voz pelo nome no painel direito (best-effort, nao
 *  fatal — Mirror voice ja usa a voz do avatar por padrao). */
async function studioTrySelectVoice(voiceName, sceneLabel) {
  if (!voiceName) return;
  try {
    // abre o seletor de Voice (painel direito) — botao/area com a voz atual
    const voiceBtns = Array.from(document.querySelectorAll('button, [role="button"], div[tabindex]'))
      .filter((b) => b.offsetParent !== null);
    let voiceOpener = null;
    for (const b of voiceBtns) {
      const t = (b.textContent || '').trim().toLowerCase();
      if (t === 'voice' || t.startsWith('voice ') || t.includes('select voice') || t.includes('change voice')) {
        voiceOpener = b; break;
      }
    }
    if (!voiceOpener) { studioLog(`${sceneLabel}: opener de Voice nao achado — mantendo voz do avatar`); return; }
    clickElement(voiceOpener);
    await sleep(1200);
    // busca input de pesquisa de voz
    const search = Array.from(document.querySelectorAll('input[type="text"], input:not([type])'))
      .find((i) => i.offsetParent !== null &&
        /voice|voz|search|buscar/i.test((i.getAttribute('placeholder') || '')));
    if (search) {
      search.focus();
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(search, voiceName);
      search.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(1600);
    }
    // clica o primeiro resultado que casa com o nome
    const target = voiceName.toLowerCase();
    let picked = null;
    for (const o of document.querySelectorAll('[role="option"], [role="menuitem"], li, button, div[tabindex]')) {
      if (o.offsetParent === null) continue;
      const t = (o.textContent || '').trim().toLowerCase();
      if (!t || t.length > 60) continue;
      if (t === target || t.startsWith(target) || t.includes(target)) { picked = o; break; }
    }
    if (picked) { clickElement(picked); await sleep(1000); studioLog(`${sceneLabel}: voz "${voiceName}" selecionada`); }
    else studioLog(`${sceneLabel}: voz "${voiceName}" nao achada — mantendo voz do avatar`);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(500);
  } catch (e) {
    studioWarn(`${sceneLabel}: select voice falhou (nao fatal):`, e?.message || e);
  }
}

/**
 * VA de avatar: monta o projeto Studio cena-por-cena e dispara Generate.
 * payload = { avatarId, avatarName, groupName, voiceName, parts:[{audioBase64,filename,label}], jobLabel }
 */
async function runStudioJob(requestId, payload) {
  if (currentJob) {
    reportError(requestId, 'Outra geracao em andamento — aguarde finalizar.');
    return;
  }
  currentJob = requestId;
  try {
    const { avatarId, avatarName, groupName, voiceName, parts, jobLabel } = payload || {};
    if (!avatarId) throw new Error('payload invalido: avatarId obrigatorio.');
    if (!Array.isArray(parts) || parts.length === 0) throw new Error('payload invalido: parts vazio.');

    reportProgress(requestId, `VA Studio: abrindo editor de ${avatarName || avatarId}...`);
    await enterStudioForAvatar(avatarId, avatarName, groupName);

    const total = parts.length;
    for (let i = 0; i < total; i++) {
      const part = parts[i];
      const sceneLabel = `${jobLabel || 'VA'} cena ${i + 1}/${total}`;
      reportProgress(requestId, `${sceneLabel}: criando cena...`, Math.round((i / total) * 70));

      // Limpa paywall se reabrir entre cenas
      studioDismissPaywallIfShown(`${sceneLabel} start`);

      if (i > 0) {
        const addBtn = await waitForOrNull(() => findAddSceneButton(), 12000, 400);
        if (!addBtn) {
          studioDumpDiag('no-add-scene');
          throw new Error(`${sceneLabel}: botao "Add scene" nao encontrado. Cola os logs [DARKO LAB STUDIO].`);
        }
        await cdpClickEl(addBtn, 'Add scene');
        await sleep(2200);
        studioDismissPaywallIfShown(`${sceneLabel} apos add-scene`);
      }

      // upload do audio da parte na cena ativa
      reportProgress(requestId, `${sceneLabel}: upload ${part.filename}...`, Math.round((i / total) * 70) + 4);
      await studioUploadAudioToActiveScene(part.audioBase64, part.filename, sceneLabel);
      studioDismissPaywallIfShown(`${sceneLabel} pos-upload`);

      // AVATAR III obrigatorio — protege creditos pagos (NUNCA IV/V).
      reportProgress(requestId, `${sceneLabel}: garantindo Avatar III...`, Math.round((i / total) * 70) + 6);
      const motorOk = await setStudioMotorAvatarIII(sceneLabel);
      if (!motorOk) {
        studioDumpDiag('motor-iii-fail');
        throw new Error(
          `${sceneLabel}: NAO consegui confirmar Avatar III no Motion Engine. ` +
          `Abortei ANTES do Generate pra nao consumir credito pago (IV/V). ` +
          `Cola os logs [DARKO LAB STUDIO].`
        );
      }

      // 1) Seleciona a voz ANTES de Mirror voice — Mirror usa a voz
      //    que estiver bound na cena nesse momento.
      const blocks = getSceneScriptBlocks();
      const scope = blocks[blocks.length - 1] || document; // cena recem-criada = ultima
      if (voiceName) {
        reportProgress(requestId, `${sceneLabel}: setando voz "${voiceName}"...`, Math.round((i / total) * 70) + 7);
        await studioTrySelectVoice(voiceName, sceneLabel);
      }

      // 2) FORCA Mirror voice (Use avatar voice) — requisito duro do VA
      reportProgress(requestId, `${sceneLabel}: ativando "Use avatar voice" (Mirror voice)...`, Math.round((i / total) * 70) + 8);
      const mirrored = await setSceneMirrorVoice(scope, sceneLabel);
      if (!mirrored) {
        studioDumpDiag('mirror-fail');
        throw new Error(
          `${sceneLabel}: NAO consegui forcar "Mirror voice" (ficou em Recorded voice). ` +
          `VA exige Mirror voice em TODAS as cenas — abortei pra nao gerar errado. ` +
          `Cola os logs [DARKO LAB STUDIO].`
        );
      }

      // play pra carregar a fala antes do Generate
      reportProgress(requestId, `${sceneLabel}: carregando a fala (play)...`, Math.round((i / total) * 70) + 12);
      await playStudioScene(scope, sceneLabel);
    }

    // verificacao final: TODAS as cenas em Mirror voice
    reportProgress(requestId, 'Verificando Mirror voice em todas as cenas...', 78);
    {
      const toggles = Array.from(document.querySelectorAll('button, [role="button"], span, div'))
        .filter((el) => {
          if (el.offsetParent === null) return false;
          const t = (el.textContent || '').trim().toLowerCase();
          return t === 'recorded voice' || t === 'mirror voice';
        });
      const recorded = toggles.filter((el) => (el.textContent || '').trim().toLowerCase() === 'recorded voice');
      const mirror = toggles.filter((el) => (el.textContent || '').trim().toLowerCase() === 'mirror voice');
      studioLog(`verificacao: mirror=${mirror.length} recorded=${recorded.length} (esperado mirror=${total})`);
      if (recorded.length > 0) {
        // ultima tentativa de consertar as que sobraram
        for (const rEl of recorded) {
          let p = rEl;
          for (let k = 0; k < 8 && p && p !== document.body; k++) p = p.parentElement;
          await setSceneMirrorVoice(p || document, 'fix-final');
        }
        const stillRec = Array.from(document.querySelectorAll('button, [role="button"], span, div'))
          .filter((el) => el.offsetParent !== null &&
            (el.textContent || '').trim().toLowerCase() === 'recorded voice');
        if (stillRec.length > 0) {
          studioDumpDiag('mirror-verify-fail');
          throw new Error(
            `${stillRec.length} cena(s) ainda em "Recorded voice" apos retry. ` +
            `VA exige Mirror voice em todas — abortei. Cola os logs [DARKO LAB STUDIO].`
          );
        }
      }
    }

    // Dismiss paywall se reabriu antes do Generate final
    studioDismissPaywallIfShown('pre-Generate');

    // GUARDA FINAL DE CREDITO: se qualquer cena/painel mostrar Avatar
    // IV ou V, ABORTA antes do Generate (VA so pode gerar em III).
    reportProgress(requestId, 'Verificacao final: Avatar III em tudo...', 82);
    {
      const paid = studioHasPaidEngineVisible();
      if (paid) {
        studioDumpDiag('paid-engine-visible');
        throw new Error(
          `Detectei "${paid}" na UI antes do Generate. VA exige Avatar III ` +
          `(sem custo). Abortei pra NAO consumir credito pago. ` +
          `Cola os logs [DARKO LAB STUDIO].`
        );
      }
      studioLog('verificacao final OK — nenhum Avatar IV/V visivel');
    }

    // Generate (1x) com guarda anti-duplicacao
    reportProgress(requestId, 'Clicando Generate...', 85);
    const genBtn = await waitForOrNull(() => findStudioGenerateButton(), 12000, 400);
    if (!genBtn) {
      studioDumpDiag('no-generate');
      throw new Error('Botao Generate do Studio nao encontrado. Cola os logs [DARKO LAB STUDIO].');
    }
    const clickStartTs = Date.now();
    const ANTI_DUP_MS = 90000;
    const recentVideo = interceptedVideoIds.filter((v) => Date.now() - v.ts < ANTI_DUP_MS).pop();
    if (recentVideo) {
      studioWarn('Generate SKIP — video ja gerado nos ultimos 90s:', recentVideo.id);
    } else {
      await cdpClickEl(genBtn, 'Generate');
      // Studio as vezes abre modal de confirmacao ("Generate"/"Submit")
      await sleep(1800);
      const confirm = Array.from(document.querySelectorAll('[role="dialog"] button, [role="alertdialog"] button'))
        .find((b) => {
          if (b.offsetParent === null) return false;
          const t = (b.textContent || '').trim().toLowerCase();
          return t === 'generate' || t === 'submit' || t === 'confirm' || t === 'gerar' || t === 'continue';
        });
      if (confirm) { studioLog('confirmando modal de Generate via CDP'); await cdpClickEl(confirm, 'Generate confirm'); }
    }
    reportProgress(requestId, 'Enviando pro HeyGen...', 92);
    await sleep(4500);

    let myVideoId = null;
    for (const item of interceptedVideoIds) {
      if (item.ts >= clickStartTs - 5000) { myVideoId = item.id; break; }
    }
    if (!myVideoId) {
      const newest = await findNewestVideoFromAccount(180000);
      if (newest && newest.id) myVideoId = newest.id;
    }
    if (myVideoId) studioLog('dispatch OK, video_id =', myVideoId);
    else studioWarn('dispatch OK mas sem video_id capturado (page vai cair no fallback newest).');

    reportProgress(requestId, 'Projeto VA enviado pro HeyGen!', 100);
    reportResult(requestId, myVideoId ? `QUEUED:${myVideoId}` : 'QUEUED');
  } catch (e) {
    console.error('[DARKO LAB STUDIO] runStudioJob FAIL:', e);
    reportError(requestId, e?.message ?? String(e));
  } finally {
    currentJob = null;
    // remove a barra amarela "DARKO LAB started debugging" do Chrome
    try { await cdpDetachBg(); } catch {}
  }
}


} // fim do guard __darkolab_heygen_loaded__
