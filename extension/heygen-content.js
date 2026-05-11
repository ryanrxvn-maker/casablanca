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
const DARKO_EXT_VERSION = '4.1.4';
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
window.addEventListener('message', (ev) => {
  const d = ev.data;
  if (
    d &&
    typeof d === 'object' &&
    d.source === 'darkolab-injected' &&
    d.type === 'VIDEO_GENERATED' &&
    d.video_id
  ) {
    console.log('[DARKO LAB] video_id interceptado:', d.video_id, 'via', d.source_method, '->', d.url);
    interceptedVideoIds.push({ id: d.video_id, ts: d.ts, url: d.url });
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
    name: displayName,
    audio_url: fileUrl,
    request_source: 'IVC',
  };
  // Flags pra remover ruido/musica de fundo — nomes inferidos do bundle
  if (removeBackgroundNoise) createBody.denoise = true;
  if (removeBackgroundMusic) createBody.remove_background_music = true;
  if (language) createBody.language = language;

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
  const voiceIdImmediate = createJson?.data?.voice_id;
  const callbackId = createJson?.data?.callback_id || createJson?.data?.id;
  console.log('[DARKO LAB voice clone] create resp', { voiceIdImmediate, callbackId, keys: Object.keys(createJson?.data || {}) });

  // === STEP 4: poll status ===
  if (voiceIdImmediate) {
    // Alguns retornam o voice_id ja pronto
    onProgress?.({ stage: 'done', percent: 100, message: 'Pronto' });
    return { voiceId: voiceIdImmediate, voiceName: displayName };
  }
  if (!callbackId) throw new Error('Sem callback_id nem voice_id no response do create: ' + JSON.stringify(createJson).slice(0, 300));

  for (let attempt = 0; attempt < VOICE_CLONE_POLL_MAX_ATTEMPTS; attempt++) {
    await new Promise((r) => setTimeout(r, VOICE_CLONE_POLL_INTERVAL_MS));
    const percent = 60 + Math.min(35, attempt * 1.5);
    onProgress?.({ stage: 'polling', percent, message: `Aguardando processamento (${attempt + 1}/${VOICE_CLONE_POLL_MAX_ATTEMPTS})...` });
    const statusResp = await fetchWithTimeout(
      `https://api2.heygen.com/v1/voice/voice_clone/create_status?callback_id=${encodeURIComponent(callbackId)}`,
      { method: 'GET', credentials: 'include' },
      10000,
    ).catch((e) => { console.warn('[DARKO LAB voice clone] poll err:', e); return null; });
    if (!statusResp || !statusResp.ok) continue;
    const statusJson = await statusResp.json().catch(() => null);
    const status = statusJson?.data?.status;
    const vid = statusJson?.data?.voice_id;
    console.log('[DARKO LAB voice clone] poll', attempt, 'status=', status, 'voice_id=', vid);
    if (status === 'completed' || status === 'ready' || status === 'success') {
      if (!vid) throw new Error('Status completed mas sem voice_id: ' + JSON.stringify(statusJson).slice(0, 300));
      onProgress?.({ stage: 'done', percent: 100, message: 'Pronto' });
      return { voiceId: vid, voiceName: displayName };
    }
    if (status === 'failed' || status === 'error') {
      throw new Error('HeyGen voice clone falhou: ' + JSON.stringify(statusJson).slice(0, 300));
    }
  }
  throw new Error('Voice clone timeout — HeyGen nao respondeu completed em 6min');
}

/**
 * Lista vozes da conta HeyGen (custom + favoritas) via cookies de sessao.
 */
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
    if (!copy) throw new Error('payload invalido: copy obrigatoria.');

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


} // fim do guard __darkolab_heygen_loaded__
