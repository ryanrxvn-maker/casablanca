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
if (window.__darkolab_heygen_loaded__) {
  console.log('[DARKO LAB] content script JA carregado — skip duplicate inject');
} else {
  window.__darkolab_heygen_loaded__ = true;

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
});

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
    const { copy, avatarId, motor, partLabel } = payload;

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

    // 4) Seleciona avatar via dialog "Choose an Avatar"
    reportProgress(requestId, 'Selecionando avatar...');
    await selectAvatarInUI(avatarId);

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
    if (generateClicked) {
      console.warn('[DARKO LAB UI] generate JA foi clicado uma vez, skip duplo click');
    } else {
      console.log('[DARKO LAB UI] clicando Generate, aguardando interceptor capturar video_id...');
      clickElement(generateBtn);
      generateClicked = true;
    }

    // 8) Aguarda inject.js interceptar a request POST de generate e
    //    capturar o video_id REAL retornado pela response. Garantia 100%
    //    de que eh o video que A GENTE gerou, nao outro user.
    reportProgress(requestId, 'Aguardando HeyGen aceitar request...');
    const myVideoId = await waitForInterceptedVideoId(clickStartTs, 30000);
    if (!myVideoId) {
      throw new Error(
        'Nao consegui interceptar a request de generate em 30s. Verifica se ' +
        'a aba HeyGen carregou completa antes de gerar (precisa do inject.js ' +
        'rodar). Cola os logs [DARKO LAB inject] e [DARKO LAB UI] do console.'
      );
    }
    console.log('[DARKO LAB UI] video_id confirmado interceptado:', myVideoId);

    // 9) Pola video_status.get DESSE video_id especifico ate completar
    reportProgress(requestId, 'HeyGen processando...');
    const videoUrl = await waitForVideoCompletionById(requestId, myVideoId);
    if (!videoUrl) throw new Error('Timeout aguardando video pronto.');

    reportProgress(requestId, 'Video pronto!', 100);
    reportResult(requestId, videoUrl);
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
async function waitForInterceptedVideoId(clickStartTs, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // Procura no buffer interceptedVideoIds o primeiro com ts >= clickStartTs
    for (const item of interceptedVideoIds) {
      if (item.ts >= clickStartTs) {
        return item.id;
      }
    }
    await sleep(300);
  }
  return null;
}

/**
 * Pola video_status.get pra UM video_id especifico ate ele completar.
 * Esse video_id veio do inject.js que interceptou a response da nossa
 * propria request - 100% garantido que eh o nosso.
 */
async function waitForVideoCompletionById(requestId, videoId) {
  const deadline = Date.now() + 15 * 60 * 1000; // 15min
  let lastPercent = -1;

  const statusUrls = [
    `https://api2.heygen.com/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`,
    `https://api2.heygen.com/v2/video_status.get?video_id=${encodeURIComponent(videoId)}`,
    `https://api2.heygen.com/v1/video.private.get?video_id=${encodeURIComponent(videoId)}`,
  ];

  while (Date.now() < deadline) {
    if (currentJob !== requestId) throw new Error('Job foi cancelado.');

    for (const url of statusUrls) {
      try {
        const r = await fetch(url, { method: 'GET', credentials: 'include' });
        if (!r.ok) continue;
        const j = await r.json().catch(() => null);
        const data = j?.data ?? j;
        const status = String(data?.status ?? '').toLowerCase();
        const videoUrl =
          data?.video_url ??
          data?.video_url_caption ??
          data?.cdn_url ??
          data?.url ??
          null;
        const pct = data?.percent ?? data?.progress ?? null;
        if (pct != null && pct !== lastPercent) {
          lastPercent = pct;
          reportProgress(requestId, `HeyGen processando... ${pct}%`, pct);
        }
        if (
          status === 'completed' ||
          status === 'success' ||
          status === 'done'
        ) {
          if (videoUrl) {
            console.log(`[DARKO LAB UI] video ${videoId} completed via ${url}, mp4:`, videoUrl);
            return videoUrl;
          }
          // Fallback: tenta endpoint de download
          for (const dlUrl of [
            `https://api2.heygen.com/v1/video.download?video_id=${encodeURIComponent(videoId)}`,
            `https://api2.heygen.com/v2/video.download?video_id=${encodeURIComponent(videoId)}`,
          ]) {
            try {
              const dr = await fetch(dlUrl, { method: 'GET', credentials: 'include' });
              if (dr.ok) {
                const dj = await dr.json().catch(() => null);
                const u = dj?.data?.url ?? dj?.url ?? dj?.data?.video_url;
                if (u) {
                  console.log('[DARKO LAB UI] mp4 via download endpoint:', u);
                  return u;
                }
              }
            } catch {}
          }
          console.warn(
            '[DARKO LAB UI] status completed mas sem video_url em:',
            JSON.stringify(data).slice(0, 400)
          );
        }
        if (status === 'failed' || status === 'error') {
          throw new Error('HeyGen reportou status failed: ' + (data?.error_msg ?? status));
        }
        break; // pegou primeira resposta valida, aguarda proximo poll
      } catch (e) {
        if (String(e).includes('failed')) throw e;
      }
    }
    await sleep(4000);
  }
  return null;
}

function findScriptTextarea() {
  // Heygen usa textarea com placeholder "Type or paste your script here..."
  const selectors = [
    'textarea[placeholder*="script" i]',
    'textarea[placeholder*="paste" i]',
    'textarea[placeholder*="type" i]',
    'textarea[placeholder*="aqui" i]',
    'textarea[placeholder*="cole" i]',
    '[data-testid*="script" i]',
    '[data-testid*="textarea"]',
    'div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"][aria-label*="script" i]',
    'div[contenteditable="true"]',
    'textarea', // ultimo recurso: qualquer textarea visivel
  ];
  for (const sel of selectors) {
    const els = document.querySelectorAll(sel);
    for (const el of els) {
      if (el.offsetParent !== null) {
        const rect = el.getBoundingClientRect();
        // Tem que ser visivel + tamanho razoavel (> 200px largura)
        if (rect.width > 200 && rect.height > 50) {
          return el;
        }
      }
    }
  }
  return null;
}

/**
 * Log diagnostico - chama quando findScriptTextarea() falhar pra a gente
 * ver o que tem no DOM e qual seletor faltou.
 */
function dumpScriptDiagnostics() {
  console.log('[DARKO LAB UI diag] location:', location.href);
  console.log('[DARKO LAB UI diag] readyState:', document.readyState);
  const allTextareas = document.querySelectorAll('textarea');
  console.log('[DARKO LAB UI diag] textareas count:', allTextareas.length);
  for (const t of allTextareas) {
    const rect = t.getBoundingClientRect();
    console.log('[DARKO LAB UI diag] textarea:', {
      placeholder: t.placeholder,
      ariaLabel: t.getAttribute('aria-label'),
      dataTestId: t.getAttribute('data-testid'),
      visible: t.offsetParent !== null,
      width: rect.width,
      height: rect.height,
    });
  }
  const editables = document.querySelectorAll('[contenteditable="true"]');
  console.log('[DARKO LAB UI diag] contenteditables count:', editables.length);
  for (const e of editables) {
    console.log('[DARKO LAB UI diag] contenteditable:', {
      role: e.getAttribute('role'),
      ariaLabel: e.getAttribute('aria-label'),
      tag: e.tagName,
      visible: e.offsetParent !== null,
    });
  }
}

/**
 * Seleciona motor (Avatar III/IV/V) clicando no dropdown atual e depois
 * no item correto do menu. HeyGen UI: tem botao "Avatar IV ^" no canto
 * inferior que ABRE um dropdown com 3 opcoes (V/IV/III). Precisa abrir
 * o dropdown E clicar no item exato.
 */
async function selectMotor(motor) {
  const target = `Avatar ${motor}`;
  console.log('[DARKO LAB UI motor] alvo=', target);

  // Verifica se ja esta no motor certo (toggle mostra Avatar X)
  const currentBtn = findCurrentMotorToggle();
  if (currentBtn) {
    const t = (currentBtn.textContent || '').trim();
    console.log('[DARKO LAB UI motor] toggle atual mostra:', t);
    if (t.includes(target)) {
      console.log('[DARKO LAB UI motor] ja esta em', target, '- skip');
      return true;
    }
  }

  // 3 tentativas pra abrir dropdown e clicar item
  for (let attempt = 1; attempt <= 3; attempt++) {
    console.log(`[DARKO LAB UI motor] tentativa ${attempt}/3 abrir dropdown`);

    // Fecha qualquer popover/dropdown aberto antes (ESC)
    if (attempt > 1) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await sleep(300);
    }

    const toggle = findCurrentMotorToggle();
    if (toggle) {
      console.log(`[DARKO LAB UI motor] clicando toggle (tentativa ${attempt})`);
      clickElement(toggle);
      await sleep(500 + attempt * 300); // espera mais a cada tentativa
    } else {
      console.warn('[DARKO LAB UI motor] toggle nao achado nessa tentativa');
    }

    // Procura item EM TODO o documento (busca brute force por texto)
    const item = await waitForOrNull(() => findMotorMenuItem(motor), 3000, 200);
    if (item) {
      console.log(`[DARKO LAB UI motor] item encontrado! Texto:`, (item.textContent || '').slice(0, 60));
      await clickWithAncestors(item);
      await sleep(900);
      const newToggle = findCurrentMotorToggle();
      const newText = newToggle ? (newToggle.textContent || '').trim() : '';
      if (newText.includes(target)) {
        console.log('[DARKO LAB UI motor] sucesso (click) na tentativa', attempt);
        return true;
      }
      console.warn('[DARKO LAB UI motor] click foi mas toggle ainda nao mostra', target, '- tentando keyboard');

      // KEYBOARD FALLBACK: ArrowDown + ArrowDown + Enter (etc) ate matchar
      // Posicao do item desejado entre os 3 (V=0, IV=1, III=2 geralmente)
      const order = { V: 0, IV: 1, III: 2 };
      const targetIdx = order[motor] ?? 2;
      // Tenta navegar pelo teclado: pressiona Down N vezes + Enter
      for (let downs = 0; downs <= 4; downs++) {
        document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
        await sleep(120);
      }
      // Volta pra cima e tenta a posicao certa
      for (let ups = 0; ups <= 4; ups++) {
        document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
        await sleep(120);
      }
      // Agora desce ate o targetIdx
      for (let downs = 0; downs < targetIdx + 1; downs++) {
        document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
        await sleep(150);
      }
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await sleep(900);
      const tk = findCurrentMotorToggle();
      const tkText = tk ? (tk.textContent || '').trim() : '';
      if (tkText.includes(target)) {
        console.log('[DARKO LAB UI motor] sucesso (keyboard) na tentativa', attempt);
        return true;
      }
    }
  }

  console.warn('[DARKO LAB UI motor] item de menu nao achado em 4s, tentando fallback global');

  // Fallback: procura ANY clickable com texto Avatar X visivel no DOM
  // (item de menu em dropdown que nao tem role=menuitem padrao)
  const allBtns = Array.from(document.querySelectorAll(
    'button, [role="button"], [role="menuitem"], [role="option"], [role="menuitemradio"], div[tabindex], li'
  ));
  for (const b of allBtns) {
    if (b.offsetParent === null) continue;
    const t = (b.textContent || '').trim();
    // Match exato ou comeco da string com Avatar X seguido de descricao
    if (t === target || t.startsWith(target + ' ') || t.startsWith(target + '\n') ||
        t.startsWith(target + 'Premium') || t.startsWith(target + '\t')) {
      // Excluir o botao toggle (que ja eh visivel mas nao seleciona)
      if (b === currentBtn) continue;
      console.log('[DARKO LAB UI motor] fallback - clicando element com texto:', t.slice(0, 60));
      clickElement(b);
      await sleep(800);
      return true;
    }
  }

  console.warn('[DARKO LAB UI motor] NAO conseguiu selecionar', target, '- tentou abrir dropdown mas item nao apareceu');
  // Diagnostico DETALHADO: lista TODOS elementos visiveis com Avatar III/IV/V
  const debug = Array.from(document.querySelectorAll('*'))
    .filter((e) => /Avatar (III|IV|V)\b/.test((e.textContent || '').trim()))
    .map((e) => {
      const r = e.getBoundingClientRect();
      return {
        tag: e.tagName,
        cls: (e.className || '').toString().slice(0, 50),
        children: e.children.length,
        text: (e.textContent || '').trim().slice(0, 80),
        visible: e.offsetParent !== null,
        x: Math.round(r.left),
        y: Math.round(r.top),
        w: Math.round(r.width),
        h: Math.round(r.height),
      };
    })
    .slice(0, 15);
  console.log('[DARKO LAB UI motor diag] elementos com Avatar X no DOM:', JSON.stringify(debug, null, 2));
  return false;
}

/**
 * Acha o botao de toggle do motor atual (mostra "Avatar IV", "Avatar V",
 * "Avatar III" + um icone de seta pra cima/baixo). Geralmente fica na
 * barra inferior do composer Quick Create.
 */
function findCurrentMotorToggle() {
  // Procura QUALQUER button visivel com texto contendo 'Avatar III/IV/V'.
  // Texto pode comecar com 'IV' (icone) ou outros prefixos - usa includes.
  const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
  let candidates = [];
  for (const b of buttons) {
    if (b.offsetParent === null) continue;
    if (b.disabled) continue;
    const t = (b.textContent || '').trim();
    if (!/Avatar (III|IV|V)\b/.test(t)) continue;
    if (t.length > 80) continue; // exclui containers grandes
    const rect = b.getBoundingClientRect();
    if (rect.width < 30 || rect.height < 20) continue;
    candidates.push({ el: b, rect, text: t });
  }
  if (candidates.length === 0) return null;
  // Prefere o mais inferior (composer fica embaixo)
  candidates.sort((a, b) => b.rect.top - a.rect.top);
  console.log(`[DARKO LAB UI motor] findCurrentMotorToggle: ${candidates.length} candidatos, top: "${candidates[0].text.slice(0, 50)}"`);
  return candidates[0].el;
}

/**
 * Procura item de menu correspondente ao motor dentro de um dropdown aberto.
 */
/**
 * BRUTE FORCE: percorre todos elementos visiveis do DOM procurando aquele
 * que contem EXATAMENTE 'Avatar III' (ou IV/V) como texto. HeyGen nao usa
 * Radix com role=menuitem, entao seletores especificos falham. Aqui a gente
 * pega o NODE MAIS ESPECIFICO (menos children) que tem o texto certo,
 * fora do toggle atual.
 */
function findMotorMenuItem(motor) {
  const target = `Avatar ${motor}`;
  const currentToggle = findCurrentMotorToggle();
  const candidates = [];

  // Walker por todo o DOM, pegando elementos visiveis com texto certo
  const all = document.querySelectorAll('div, button, li, span, a, [role]');
  for (const el of all) {
    if (el === currentToggle) continue;
    if (currentToggle && currentToggle.contains(el)) continue;
    if (el.offsetParent === null) continue;

    // Texto direto (do proprio elemento + filhos imediatos), trim
    const t = (el.textContent || '').trim();
    if (!t || t.length > 250) continue;

    // Tem que comecar com "Avatar III/IV/V" + (espaco|fim|Premium|outras letras OK)
    if (!t.startsWith(target)) continue;
    const next = t.charAt(target.length);
    // Rejeita se proximo char eh digito/letra (ex: "Avatar IV" matchando "Avatar I")
    if (next && /[0-9A-HJ-Za-hj-z]/.test(next)) continue;

    // Tem que ter dimensao razoavel (pelo menos 50x20)
    const rect = el.getBoundingClientRect();
    if (rect.width < 50 || rect.height < 20) continue;
    if (rect.width > 800) continue; // exclui containers grandes

    candidates.push({ el, depth: getDepth(el), childCount: el.querySelectorAll('*').length });
  }

  if (candidates.length === 0) return null;

  // Prefere o mais ESPECIFICO (menor childCount + maior depth - mais profundo)
  candidates.sort((a, b) => {
    if (a.childCount !== b.childCount) return a.childCount - b.childCount;
    return b.depth - a.depth;
  });
  console.log(`[DARKO LAB UI motor] candidates pra ${target}:`, candidates.length, 'top:', {
    tag: candidates[0].el.tagName,
    children: candidates[0].childCount,
    depth: candidates[0].depth,
    text: (candidates[0].el.textContent || '').slice(0, 80),
  });
  return candidates[0].el;
}

function getDepth(el) {
  let d = 0;
  let p = el;
  while (p && p !== document.body) { d++; p = p.parentElement; }
  return d;
}

/**
 * Tenta clicar UM elemento de varias formas. Se o click no proprio nao
 * dispara handler, sobe pelos ancestrais e tenta neles tambem.
 */
async function clickWithAncestors(el) {
  if (!el) return false;
  el.scrollIntoView({ block: 'center', behavior: 'instant' });
  await sleep(150);

  // Tenta no proprio elemento + 4 ancestrais
  let target = el;
  for (let i = 0; i < 5 && target; i++) {
    clickElement(target);
    target = target.parentElement;
  }
  return true;
}

function findGenerateButton() {
  // Botao de generate no canto inferior direito (seta)
  // HeyGen usa varios atributos diferentes ao longo do tempo.
  const candidates = Array.from(document.querySelectorAll('button'));
  // Por aria-label
  for (const b of candidates) {
    const al = (b.getAttribute('aria-label') || '').toLowerCase();
    if (al.includes('generate') || al.includes('submit') || al.includes('send')) {
      if (!b.disabled && b.offsetParent !== null) return b;
    }
  }
  // Por texto
  for (const b of candidates) {
    const t = (b.textContent || '').trim().toLowerCase();
    if (t === 'generate' || t === 'gerar' || t === 'submit') {
      if (!b.disabled && b.offsetParent !== null) return b;
    }
  }
  // Por SVG arrow up icon (botao circular comum no HeyGen)
  for (const b of candidates) {
    if (b.disabled || b.offsetParent === null) continue;
    const svg = b.querySelector('svg');
    if (!svg) continue;
    const html = svg.innerHTML.toLowerCase();
    if (html.includes('arrow') || html.includes('m12') || html.includes('m4 12')) {
      // botao com SVG de arrow
      const rect = b.getBoundingClientRect();
      // canto inferior direito
      if (rect.right > window.innerWidth * 0.7 && rect.bottom > window.innerHeight * 0.5) {
        return b;
      }
    }
  }
  return null;
}

async function selectAvatarInUI(avatarId) {
  // Procura algum botao/area que abra o dialog "Choose an Avatar"
  // ou um seletor de avatar no painel direito.
  // A estrategia mais simples: clicar no preview/thumb do avatar atual,
  // que abre o dialog.
  const triggers = [
    'button[aria-label*="avatar" i]',
    'button[aria-label*="choose" i]',
    'button[aria-label*="customize" i]',
    '[data-testid*="avatar" i]',
  ];
  let trigger = null;
  for (const sel of triggers) {
    const candidates = document.querySelectorAll(sel);
    for (const el of candidates) {
      if (el.offsetParent !== null && !el.disabled) {
        trigger = el;
        break;
      }
    }
    if (trigger) break;
  }
  // Fallback: procura imagem/avatar grande no lado direito
  if (!trigger) {
    const imgs = Array.from(document.querySelectorAll('img'));
    for (const img of imgs) {
      const rect = img.getBoundingClientRect();
      // Imagem grande no lado direito
      if (
        rect.width > 100 &&
        rect.height > 100 &&
        rect.right > window.innerWidth * 0.5
      ) {
        // Sobe ate achar um button/clickable
        let p = img.parentElement;
        while (p && p !== document.body) {
          if (p.tagName === 'BUTTON' || p.getAttribute('role') === 'button') {
            trigger = p;
            break;
          }
          p = p.parentElement;
        }
        if (trigger) break;
      }
    }
  }

  if (!trigger) {
    console.warn('[DARKO LAB UI] gatilho do dialog Choose an Avatar nao achado, seguindo com avatar atual');
    return;
  }

  console.log('[DARKO LAB UI] abrindo dialog Choose an Avatar');
  clickElement(trigger);
  await sleep(1200);

  // Procura o avatar pelo ID no dialog. Cada avatar geralmente eh um div/button
  // com a imagem dentro. O HeyGen renderiza o look_id em algum data-* ou no key.
  // Estrategia mais simples: clicar no avatar por POSICAO usando o ID na URL da img.
  const avatarCards = document.querySelectorAll('[role="dialog"] button, [role="dialog"] [role="button"], [role="dialog"] img');
  for (const card of avatarCards) {
    let foundId = false;
    // Verifica src de img dentro do card
    const imgs = card.tagName === 'IMG' ? [card] : Array.from(card.querySelectorAll('img'));
    for (const img of imgs) {
      if (img.src && img.src.includes(avatarId)) {
        foundId = true;
        break;
      }
    }
    if (foundId) {
      // Sobe ate achar clickable
      let target = card;
      while (target && target.tagName !== 'BUTTON' && target.getAttribute('role') !== 'button') {
        target = target.parentElement;
        if (!target || target === document.body) break;
      }
      if (target) {
        console.log('[DARKO LAB UI] avatar encontrado, clicando');
        clickElement(target);
        await sleep(1000);

        // Pode aparecer um sub-dialog com "Use Avatar" - clicar
        const useBtn = Array.from(document.querySelectorAll('button'))
          .find((b) => /use\s*avatar/i.test(b.textContent || ''));
        if (useBtn && useBtn.offsetParent !== null) {
          console.log('[DARKO LAB UI] clicando "Use Avatar"');
          clickElement(useBtn);
          await sleep(800);
        }
        return;
      }
    }
  }

  console.warn('[DARKO LAB UI] avatar', avatarId, 'nao achado no dialog. Fechando dialog e usando avatar atual.');
  // Fecha o dialog (Esc ou click fora)
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  await sleep(500);
}

async function pasteScriptIntoTextarea(textarea, text) {
  textarea.focus();
  // Limpa primeiro
  if (textarea.tagName === 'TEXTAREA') {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value',
    ).set;
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
  const rect = el.getBoundingClientRect();
  const opts = {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
    button: 0,
    buttons: 1,
  };
  // Pointer events (Radix UI / shadcn / modern React libs precisam)
  try {
    el.dispatchEvent(new PointerEvent('pointerover', { ...opts, pointerType: 'mouse' }));
    el.dispatchEvent(new PointerEvent('pointerenter', { ...opts, pointerType: 'mouse' }));
    el.dispatchEvent(new PointerEvent('pointerdown', { ...opts, pointerType: 'mouse' }));
    el.dispatchEvent(new PointerEvent('pointerup', { ...opts, pointerType: 'mouse' }));
  } catch {}
  // Mouse events (compat)
  el.dispatchEvent(new MouseEvent('mouseover', opts));
  el.dispatchEvent(new MouseEvent('mousedown', opts));
  el.dispatchEvent(new MouseEvent('mouseup', opts));
  el.dispatchEvent(new MouseEvent('click', opts));
  // Fallback nativo
  if (typeof el.click === 'function') {
    try { el.click(); } catch {}
  }
}

/**
 * Apos clicar Generate, o HeyGen redireciona pra uma URL com video_id ou
 * mostra o video numa tela de status. A gente intercepta:
 *  a) mudanca de URL pra /video/<id> ou /share/<id>
 *  b) elemento <video> com src .mp4 no DOM
 *  c) request XHR pra video_status que retorne CDN URL
 *
 * Polar tudo em paralelo a cada 5s ate 15min.
 */
/**
 * Snapshot dos video IDs existentes na conta. Tiramos ANTES de clicar
 * Generate, depois polamos pra detectar o NOVO video que aparece (eh o que
 * a gente acabou de criar).
 */
/**
 * Snapshot via DOM da sidebar Recents do HeyGen + API list fallback.
 * Sidebar mostra "Avatar Video • just now / 1 minute ago" - quando aparece
 * um item NOVO ou um existente vira "just now", esse eh o nosso video.
 */
async function snapshotExistingVideoIds() {
  // 1) Snapshot DOM Recents
  const domIds = collectRecentsItemSignatures();
  console.log('[DARKO LAB UI] snapshot DOM Recents:', domIds.size, 'items');

  // 2) Snapshot API list (fallback - alguns endpoints podem nao estar disponiveis)
  const apiIds = new Set();
  let apiEndpoint = null;
  const endpoints = [
    'https://api2.heygen.com/v1/video.list?limit=30&page=1',
    'https://api2.heygen.com/v2/video.list?limit=30&page=1',
    'https://api2.heygen.com/v1/video.private.list?limit=30',
    'https://api2.heygen.com/v1/pacific.video.list?limit=30',
  ];
  for (const url of endpoints) {
    try {
      const r = await fetch(url, { method: 'GET', credentials: 'include' });
      if (!r.ok) continue;
      const j = await r.json().catch(() => null);
      const list = extractVideoList(j);
      if (list && list.length > 0) {
        console.log(`[DARKO LAB UI] snapshot API via ${url}: ${list.length} videos`);
        for (const v of list) {
          const id = v?.video_id ?? v?.id ?? v?.uuid;
          if (id) apiIds.add(id);
        }
        apiEndpoint = url;
        break;
      }
    } catch (e) { /* */ }
  }
  return { domIds, apiIds, apiEndpoint };
}

/**
 * Coleta assinaturas (texto + href + data-*) dos items da sidebar Recents.
 * Cada item eh tipo: 'Avatar Video|just now|<href>'.
 */
function collectRecentsItemSignatures() {
  const set = new Set();
  // Procura container que contenha "Recents" ou "RECENTS"
  const candidates = document.querySelectorAll('a, [role="link"], li, [data-testid*="recent" i]');
  for (const item of candidates) {
    const text = (item.textContent || '').trim();
    // Items recentes geralmente tem "Avatar Video", "Video sem titulo", etc + tempo
    if (!/avatar video|video|untitled/i.test(text)) continue;
    if (text.length > 100) continue; // evita capturar containers grandes
    const href = item.getAttribute('href') || item.dataset?.href || '';
    const sig = (text + '|' + href).slice(0, 200);
    set.add(sig);
  }
  return set;
}

/**
 * Tenta extrair video_id de um item da sidebar Recents (via href, data-id, etc).
 */
function extractVideoIdFromRecentsItem(el) {
  if (!el) return null;
  // 1) href
  const href = el.getAttribute('href') || el.querySelector('a')?.getAttribute('href') || '';
  const m = href.match(/(?:video|share|projects?)[\/=]([a-f0-9]{20,})/i);
  if (m) return m[1];
  // 2) data attrs
  for (const attr of el.attributes || []) {
    if (/^data-/.test(attr.name) && /^[a-f0-9]{20,}$/i.test(attr.value)) {
      return attr.value;
    }
  }
  // 3) procura em filhos
  const allEls = el.querySelectorAll('*');
  for (const child of allEls) {
    for (const attr of child.attributes || []) {
      if (/^data-/.test(attr.name) && /^[a-f0-9]{20,}$/i.test(attr.value)) {
        return attr.value;
      }
    }
  }
  return null;
}

function extractVideoList(j) {
  if (!j) return null;
  const candidates = [
    j?.data?.videos,
    j?.data?.list,
    j?.data?.video_list,
    j?.data?.items,
    j?.videos,
    j?.list,
    j?.items,
    Array.isArray(j?.data) ? j.data : null,
  ];
  for (const c of candidates) {
    if (Array.isArray(c)) return c;
  }
  return null;
}

async function waitForVideoCompletion(requestId, snapshot) {
  const deadline = Date.now() + 15 * 60 * 1000;
  const beforeDomSigs = snapshot?.domIds ?? new Set();
  const beforeApiIds = snapshot?.apiIds ?? new Set();
  const apiEndpoint = snapshot?.apiEndpoint;
  let newVideoId = null;
  let lastPercent = -1;

  console.log(`[DARKO LAB UI] waitForVideoCompletion start. DOM: ${beforeDomSigs.size} items. API: ${beforeApiIds.size} videos via ${apiEndpoint}`);

  while (Date.now() < deadline) {
    if (currentJob !== requestId) throw new Error('Job foi cancelado.');

    // ESTRATEGIA 1: scan DOM Recents pra achar item NOVO
    if (!newVideoId) {
      const candidates = document.querySelectorAll('a, [role="link"], li, [data-testid*="recent" i]');
      for (const item of candidates) {
        const text = (item.textContent || '').trim();
        if (!/avatar video|video|untitled/i.test(text)) continue;
        if (text.length > 100) continue;
        const href = item.getAttribute('href') || item.dataset?.href || '';
        const sig = (text + '|' + href).slice(0, 200);
        if (!beforeDomSigs.has(sig)) {
          // Item NOVO encontrado na sidebar
          const id = extractVideoIdFromRecentsItem(item);
          if (id) {
            newVideoId = id;
            console.log('[DARKO LAB UI] video NOVO detectado via DOM Recents:', id, 'sig:', sig.slice(0, 60));
            break;
          }
          // Mesmo sem ID, marcamos: indica que o video apareceu (item novo)
          // Vamos continuar tentando achar o ID via API
        }
      }
    }

    // ESTRATEGIA 2: pola API video.list (fallback)
    if (!newVideoId && apiEndpoint) {
      try {
        const r = await fetch(apiEndpoint, { method: 'GET', credentials: 'include' });
        if (r.ok) {
          const j = await r.json().catch(() => null);
          const list = extractVideoList(j);
          if (list) {
            for (const v of list) {
              const id = v?.video_id ?? v?.id ?? v?.uuid;
              if (id && !beforeApiIds.has(id)) {
                newVideoId = id;
                console.log('[DARKO LAB UI] video NOVO detectado via API list:', id);
                break;
              }
            }
          }
        }
      } catch (e) { /* continua */ }
    }

    // ESTRATEGIA 3: detecta videoId na URL (caso HeyGen redirecione)
    if (!newVideoId) {
      const m = location.href.match(/(?:video|share|projects?)[\/=]([a-f0-9]{20,})/i);
      if (m) {
        newVideoId = m[1];
        console.log('[DARKO LAB UI] videoId detectado na URL:', newVideoId);
      }
    }

    // ESTRATEGIA 3: procura <video> com mp4 no DOM
    const videos = document.querySelectorAll('video');
    for (const v of videos) {
      const src = v.src || v.currentSrc || v.querySelector('source')?.src;
      if (src && /\.mp4/i.test(src) && /heygen|cloudfront|amazonaws/i.test(src)) {
        console.log('[DARKO LAB UI] <video> com mp4 detectado:', src);
        return src;
      }
    }

    // ESTRATEGIA 4: procura qualquer link/href pra mp4 do CDN HeyGen
    const allLinks = document.querySelectorAll('a[href*=".mp4"], [data-src*=".mp4"], [data-url*=".mp4"]');
    for (const a of allLinks) {
      const url = a.href || a.getAttribute('data-src') || a.getAttribute('data-url');
      if (url && /heygen|cloudfront|amazonaws/i.test(url)) {
        console.log('[DARKO LAB UI] link mp4 HeyGen detectado:', url);
        return url;
      }
    }

    // Se ja temos video_id, pola status pra ver se ta pronto
    if (newVideoId) {
      const statusUrls = [
        `https://api2.heygen.com/v1/video_status.get?video_id=${encodeURIComponent(newVideoId)}`,
        `https://api2.heygen.com/v2/video_status.get?video_id=${encodeURIComponent(newVideoId)}`,
        `https://api2.heygen.com/v1/video.private.get?video_id=${encodeURIComponent(newVideoId)}`,
      ];
      for (const url of statusUrls) {
        try {
          const r = await fetch(url, { method: 'GET', credentials: 'include' });
          if (!r.ok) continue;
          const j = await r.json().catch(() => null);
          const data = j?.data ?? j;
          const status = String(data?.status ?? '').toLowerCase();
          const videoUrl =
            data?.video_url ??
            data?.video_url_caption ??
            data?.cdn_url ??
            data?.url ??
            null;
          const pct = data?.percent ?? data?.progress ?? null;
          if (pct != null && pct !== lastPercent) {
            lastPercent = pct;
            reportProgress(requestId, `HeyGen processando... ${pct}%`, pct);
          }
          if (status === 'completed' || status === 'success' || status === 'done') {
            if (videoUrl) {
              console.log(`[DARKO LAB UI] video completed via ${url}, url:`, videoUrl);
              return videoUrl;
            }
            // Sem URL no body - tenta fetch de download direto
            const dlUrl = `https://api2.heygen.com/v1/video.download?video_id=${encodeURIComponent(newVideoId)}`;
            try {
              const dr = await fetch(dlUrl, { method: 'GET', credentials: 'include' });
              if (dr.ok) {
                const dj = await dr.json().catch(() => null);
                const u = dj?.data?.url ?? dj?.url;
                if (u) return u;
              }
            } catch {}
            console.warn('[DARKO LAB UI] status completed mas sem video_url no body:', JSON.stringify(data).slice(0, 300));
          }
          if (status === 'failed' || status === 'error') {
            throw new Error('HeyGen reportou status failed: ' + (data?.error_msg ?? status));
          }
          break; // pega so o primeiro endpoint que respondeu OK
        } catch (e) {
          if (String(e).includes('failed')) throw e;
          /* tenta proximo */
        }
      }
    }

    await sleep(4000);
  }
  return null;
}

async function uploadAudioToHeyGen(audioBase64, filename, headers) {
  // Decodifica base64 pra binary
  const binary = atob(audioBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const ext = (filename.match(/\.([a-z0-9]+)$/i)?.[1] ?? 'mp3').toLowerCase();
  const mime =
    ext === 'wav'
      ? 'audio/wav'
      : ext === 'm4a'
        ? 'audio/mp4'
        : ext === 'ogg' || ext === 'opus'
          ? 'audio/ogg'
          : 'audio/mpeg';
  const blob = new Blob([bytes.buffer], { type: mime });

  // Tenta endpoint v1 upload
  const uploadHeaders = { ...headers };
  delete uploadHeaders['Content-Type']; // deixa o browser setar com boundary
  uploadHeaders['Content-Type'] = mime;

  // api2.heygen.com primeiro (autenticado via cookies)
  const endpoints = [
    'https://api2.heygen.com/v1/asset',
    'https://api2.heygen.com/v2/asset',
    'https://upload.heygen.com/v1/asset',
    'https://app.heygen.com/api/v1/upload/asset',
    'https://api.heygen.com/v1/asset',
  ];

  let lastError = '';
  for (const ep of endpoints) {
    try {
      const res = await fetch(ep, {
        method: 'POST',
        credentials: 'include',
        headers: uploadHeaders,
        body: blob,
      });
      if (!res.ok) {
        lastError = `${res.status} em ${ep}`;
        continue;
      }
      const json = await res.json().catch(() => null);
      const url =
        json?.data?.url ??
        json?.data?.file_url ??
        json?.url ??
        json?.file_url ??
        '';
      if (url) return url;
      lastError = `${ep} sem URL no body`;
    } catch (e) {
      lastError = `${ep}: ${e.message}`;
    }
  }
  throw new Error(`Nenhum endpoint de upload de audio respondeu. ${lastError}`);
}

console.log('[DARKO LAB HeyGen Content] online');

} // fim do guard __darkolab_heygen_loaded__
