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
    reportError(
      requestId,
      'Outra geracao em andamento na mesma aba - aguarde finalizar.',
    );
    return;
  }
  currentJob = requestId;

  try {
    const { copy, avatarId, motor, partLabel } = payload;

    if (!avatarId) throw new Error('payload invalido: avatarId obrigatorio.');
    if (!copy) throw new Error('payload invalido: copy obrigatoria.');

    reportProgress(requestId, `Preparando ${partLabel ?? 'video'} via UI...`);

    // 1) Se ja temos textarea visivel, nao navega - estamos numa tela boa.
    //    Senao, vai pra /avatar (Quick Create).
    if (!findScriptTextarea()) {
      console.log('[DARKO LAB UI] sem textarea, navegando pra /avatar (era ' + location.href + ')');
      location.href = 'https://app.heygen.com/avatar';
      // Aguarda navegacao + React app montar
      await sleep(4000);
    } else {
      console.log('[DARKO LAB UI] textarea ja presente, sem navegacao necessaria');
    }

    // 2) Aguarda textarea de script aparecer (UI carregada)
    reportProgress(requestId, 'Aguardando UI HeyGen carregar...');
    console.log('[DARKO LAB UI] aguardando textarea, location=', location.href);
    const textarea = await waitFor(
      () => findScriptTextarea(),
      45000,
      400,
    );
    if (!textarea) {
      // Loga diagnostico pra debug
      dumpScriptDiagnostics();
      throw new Error(
        'Textarea de script nao apareceu em 45s na ' + location.href +
        '. Confira se a aba HeyGen esta em /avatar (Quick Create). ' +
        'Abre F12 na aba HeyGen e me cola os logs [DARKO LAB UI diag].'
      );
    }
    console.log('[DARKO LAB UI] textarea de script encontrado');

    // 3) Seleciona motor (Avatar III / IV / V) - clica no botao do topo
    if (motor) {
      reportProgress(requestId, `Selecionando motor Avatar ${motor}...`);
      const motorBtn = findMotorButton(motor);
      if (motorBtn) {
        console.log('[DARKO LAB UI] clicando motor', motor);
        clickElement(motorBtn);
        await sleep(800);
      } else {
        console.warn('[DARKO LAB UI] motor button Avatar', motor, 'nao achado - seguindo com motor atual');
      }
    }

    // 4) Seleciona avatar via dialog "Choose an Avatar"
    reportProgress(requestId, 'Selecionando avatar...');
    await selectAvatarInUI(avatarId);

    // 5) Cola script no textarea com React onChange trigger
    reportProgress(requestId, 'Colando script...');
    await pasteScriptIntoTextarea(textarea, copy);
    await sleep(500);

    // 6) ANTES de clicar Generate, snapshot dos video IDs existentes pra
    //    detectar qual eh o NOVO depois.
    reportProgress(requestId, 'Snapshot da conta...');
    const snapshot = await snapshotExistingVideoIds();
    console.log('[DARKO LAB UI] snapshot:', snapshot.ids.size, 'videos pre-existentes');

    // 7) Clica Generate (seta no canto inferior direito)
    reportProgress(requestId, 'Clicando Generate...');
    const generateBtn = await waitFor(() => findGenerateButton(), 8000, 300);
    if (!generateBtn) throw new Error('Botao Generate nao encontrado.');
    console.log('[DARKO LAB UI] clicando Generate');
    clickElement(generateBtn);

    // 8) Aguarda video processar - poll video.list pra detectar video NOVO
    reportProgress(requestId, 'HeyGen processando...');
    const videoUrl = await waitForVideoCompletion(requestId, snapshot);
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

function findMotorButton(motor) {
  // Procura botoes que contenham texto "Avatar III", "Avatar IV", "Avatar V"
  const target = `Avatar ${motor}`;
  const buttons = Array.from(document.querySelectorAll('button, [role="button"], [role="tab"]'));
  return buttons.find((b) => {
    const t = (b.textContent || '').trim();
    return t === target || t.startsWith(target + ' ') || t === target.toUpperCase();
  });
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
  // Dispara mouse events completos (alguns sites precisam)
  const rect = el.getBoundingClientRect();
  const opts = {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
  };
  el.dispatchEvent(new MouseEvent('mouseover', opts));
  el.dispatchEvent(new MouseEvent('mousedown', opts));
  el.dispatchEvent(new MouseEvent('mouseup', opts));
  el.dispatchEvent(new MouseEvent('click', opts));
  // Fallback nativo
  if (typeof el.click === 'function') el.click();
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
async function snapshotExistingVideoIds() {
  const ids = new Set();
  // Tenta varios endpoints de listagem
  const endpoints = [
    'https://api2.heygen.com/v1/video.list?limit=20&page=1',
    'https://api2.heygen.com/v2/video.list?limit=20&page=1',
    'https://api2.heygen.com/v1/video.private.list?limit=20',
    'https://api2.heygen.com/v1/pacific.video.list?limit=20',
  ];
  for (const url of endpoints) {
    try {
      const r = await fetch(url, { method: 'GET', credentials: 'include' });
      if (!r.ok) continue;
      const j = await r.json().catch(() => null);
      const list = extractVideoList(j);
      if (list && list.length > 0) {
        console.log(`[DARKO LAB UI] snapshot via ${url}: ${list.length} videos`);
        for (const v of list) {
          const id = v?.video_id ?? v?.id ?? v?.uuid;
          if (id) ids.add(id);
        }
        return { ids, listEndpoint: url };
      }
    } catch (e) {
      /* tenta proximo */
    }
  }
  return { ids, listEndpoint: null };
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
  const beforeIds = snapshot?.ids ?? new Set();
  const listEndpoint = snapshot?.listEndpoint;
  let newVideoId = null;
  let lastPercent = -1;

  console.log(`[DARKO LAB UI] waitForVideoCompletion start, ${beforeIds.size} videos pre-existentes, listEndpoint=${listEndpoint}`);

  while (Date.now() < deadline) {
    if (currentJob !== requestId) throw new Error('Job foi cancelado.');

    // ESTRATEGIA 1: pola video.list pra achar video NOVO (criado depois do snapshot)
    if (!newVideoId && listEndpoint) {
      try {
        const r = await fetch(listEndpoint, { method: 'GET', credentials: 'include' });
        if (r.ok) {
          const j = await r.json().catch(() => null);
          const list = extractVideoList(j);
          if (list) {
            // Acha o primeiro video que NAO estava no snapshot
            for (const v of list) {
              const id = v?.video_id ?? v?.id ?? v?.uuid;
              if (id && !beforeIds.has(id)) {
                newVideoId = id;
                console.log('[DARKO LAB UI] video NOVO detectado via list:', id);
                break;
              }
            }
          }
        }
      } catch (e) {
        /* continua */
      }
    }

    // ESTRATEGIA 2: detecta videoId na URL (caso HeyGen redirecione)
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
