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

const SELECTORS = {
  scriptTextarea:
    'textarea[placeholder*="script" i], textarea[placeholder*="texto" i], div[contenteditable="true"]',
  generateButton: 'button[type="submit"], button:has(span:contains("Generate")), button.submit-btn',
};

let currentJob = null;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
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
    listMyAvatars()
      .then((res) => sendResponse(res))
      .catch((e) =>
        sendResponse({ ok: false, error: e?.message ?? String(e), avatars: [] }),
      );
    return true;
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
  const headers = getInternalAuthHeaders();
  // Mesmo padrao dos avatares — api2.heygen.com primeiro
  const endpoints = [
    'https://api2.heygen.com/v2/voice.list?limit=200&page=1',
    'https://api2.heygen.com/v1/voice.list?limit=200&page=1',
    'https://api2.heygen.com/v2/voices?limit=200',
    'https://app.heygen.com/api/v2/voice.list',
    'https://api.heygen.com/v2/voices',
  ];
  const errors = [];
  for (const url of endpoints) {
    try {
      const r = await fetchWithTimeout(
        url,
        { method: 'GET', credentials: 'include', headers },
        6000,
      );
      if (r.status === 401 || r.status === 403) {
        errors.push(`${url} → ${r.status}`);
        continue;
      }
      if (!r.ok) {
        errors.push(`${url} → ${r.status}`);
        continue;
      }
      const text = await r.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        errors.push(`${url} → nao-JSON`);
        continue;
      }
      const voices = parseVoicesResponse(json);
      if (voices.length > 0) {
        return { ok: true, voices, source: url };
      }
      errors.push(`${url} → 0 itens`);
    } catch (e) {
      errors.push(`${url} → ${e.name === 'AbortError' ? 'timeout' : e.message}`);
    }
  }
  return { ok: false, error: errors.join(' | '), voices: [] };
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
  const headers = getInternalAuthHeaders();

  // Endpoint REAL confirmado via DevTools: api2.heygen.com/v2/...
  // Origin app.heygen.com aceito via CORS (Access-Control-Allow-Origin).
  // Limit=200 traz tudo de uma vez (HeyGen aceita ate 200 por pagina).
  const endpoints = [
    'https://api2.heygen.com/v2/avatar_group.private.list?limit=200&page=1',
    'https://api2.heygen.com/v1/avatar_group.private.list?limit=200&page=1',
    'https://api2.heygen.com/v2/avatar_group.private.list?limit=10&page=1',
    'https://app.heygen.com/api/v2/avatar_group.private.list?limit=200&page=1',
    'https://app.heygen.com/api/v2/avatars',
    'https://api.heygen.com/v2/avatars',
  ];

  const errors = [];
  console.log('[DARKO LAB] listMyAvatars iniciando, headers:', Object.keys(headers));

  for (const url of endpoints) {
    try {
      const r = await fetchWithTimeout(
        url,
        { method: 'GET', credentials: 'include', headers },
        6000,
      );

      if (r.status === 401 || r.status === 403) {
        errors.push(`${url} → ${r.status} (auth required)`);
        continue;
      }
      if (!r.ok) {
        errors.push(`${url} → ${r.status}`);
        continue;
      }

      // Pega o body como texto primeiro. Se for HTML (redirect login) NAO e' o endpoint.
      const text = await r.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        errors.push(`${url} → 200 mas resposta nao-JSON`);
        continue;
      }

      const items = parseAvatarsResponse(json);
      console.log(
        `[DARKO LAB] Avatars from ${url}: ${items.length} items`,
        items.length === 0 ? 'rawData:' : '',
        items.length === 0 ? json : '',
      );

      if (items.length > 0) {
        return { ok: true, avatars: items, source: url };
      }
      errors.push(`${url} → 200 OK mas 0 itens parseados`);
    } catch (e) {
      const msg = e.name === 'AbortError' ? 'timeout 6s' : e.message ?? e;
      errors.push(`${url} → ${msg}`);
    }
  }

  return {
    ok: false,
    error: 'Nenhum endpoint funcionou. ' + errors.slice(0, 3).join(' | '),
    avatars: [],
    debug: errors,
  };
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
async function runJob(requestId, payload) {
  if (currentJob) {
    reportError(
      requestId,
      'Outra geracao em andamento na mesma aba — aguarde finalizar.',
    );
    return;
  }
  currentJob = requestId;

  try {
    const {
      copy,
      audioBase64,
      audioFilename,
      avatarId,
      voiceId,
      motor,
      partLabel,
    } = payload;

    if (!avatarId) {
      throw new Error('payload invalido: avatarId obrigatorio.');
    }
    if (!copy && !audioBase64) {
      throw new Error('payload invalido: copy OU audioBase64 obrigatorio.');
    }

    reportProgress(requestId, `Preparando ${partLabel ?? ''}...`);

    const headers = getInternalAuthHeaders();

    // 1) Se modo audio: faz upload do audio pro HeyGen primeiro
    let voiceBlock;
    if (audioBase64) {
      reportProgress(requestId, 'Uploadando audio pro HeyGen...');
      const audioUrl = await uploadAudioToHeyGen(
        audioBase64,
        audioFilename ?? `${partLabel ?? 'audio'}.mp3`,
        headers,
      );
      voiceBlock = {
        type: 'audio',
        audio_url: audioUrl,
      };
    } else {
      voiceBlock = voiceId
        ? { type: 'text', input_text: copy, voice_id: voiceId }
        : { type: 'text', input_text: copy };
    }

    // avatar_style "normal" funciona pra talking_photos e studio avatars.
    // O "motor" (III/IV/V) e' propriedade do avatar_id em si — nao precisa
    // mandar separado. Se o avatar foi gravado como Avatar V, ele JA e' V.
    const generateBody = {
      video_inputs: [
        {
          character: {
            type: 'avatar',
            avatar_id: avatarId,
            avatar_style: 'normal',
          },
          voice: voiceBlock,
          background: { type: 'color', value: '#0a0a0a' },
        },
      ],
      dimension: { width: 1080, height: 1920 },
      title: partLabel
        ? `DARKO LAB ${partLabel} (motor ${motor})`
        : `DARKO LAB Auto (motor ${motor})`,
    };
    void motor; // motor e' label/info — nao influencia o payload diretamente

    reportProgress(requestId, 'Enviando job pro HeyGen...');

    // api2.heygen.com confirmado via DevTools como dominio oficial das requests
    // autenticadas via cookie. Usa esse primeiro.
    const generateEndpoints = [
      'https://api2.heygen.com/v2/video.generate',
      'https://api2.heygen.com/v1/video.generate',
      'https://api2.heygen.com/v2/video/generate',
      'https://app.heygen.com/api/v2/video/generate',
      'https://api.heygen.com/v2/video/generate',
    ];

    let videoId = null;
    let lastErrorDetail = '';

    for (const url of generateEndpoints) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          credentials: 'include',
          headers,
          body: JSON.stringify(generateBody),
        });
        if (res.status === 401 || res.status === 403) {
          lastErrorDetail = `Login expirado em ${url} (${res.status})`;
          continue; // tenta proximo
        }
        if (!res.ok) {
          const t = await res.text().catch(() => '');
          lastErrorDetail = `${url} → ${res.status}: ${t.slice(0, 150)}`;
          continue;
        }
        const json = await res.json().catch(() => null);
        videoId =
          json?.data?.video_id ??
          json?.data?.id ??
          json?.video_id ??
          json?.id ??
          null;
        if (videoId) break;
        lastErrorDetail = `${url} sem video_id no body`;
      } catch (e) {
        lastErrorDetail = `${url}: ${e.message ?? e}`;
      }
    }

    if (!videoId) {
      throw new Error(
        `HeyGen rejeitou a request — login expirou ou endpoint mudou. Faca login em https://app.heygen.com e tente de novo. Detalhe: ${lastErrorDetail}`,
      );
    }

    // 2) Polar status
    reportProgress(requestId, 'HeyGen processando avatar...', 0);

    const pollDeadline = Date.now() + 15 * 60 * 1000; // 15min max
    let lastPercent = 0;

    const statusEndpoints = [
      `https://api2.heygen.com/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`,
      `https://api2.heygen.com/v2/video.status?video_id=${encodeURIComponent(videoId)}`,
      `https://app.heygen.com/api/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`,
      `https://api.heygen.com/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`,
    ];

    while (Date.now() < pollDeadline) {
      if (currentJob !== requestId) {
        throw new Error('Job foi cancelado.');
      }

      let data = null;
      for (const url of statusEndpoints) {
        try {
          const r = await fetch(url, {
            method: 'GET',
            credentials: 'include',
            headers,
          });
          if (r.ok) {
            const j = await r.json().catch(() => null);
            data = j?.data ?? j ?? null;
            if (data) break;
          }
        } catch {
          /* tenta proximo */
        }
      }

      if (!data) {
        await sleep(5000);
        continue;
      }

      const status = String(data.status ?? '');
      const videoUrl = data.video_url ?? data.url ?? '';

      if (status === 'completed' && videoUrl) {
        reportProgress(requestId, 'Concluido!', 1);
        reportResult(requestId, videoUrl);
        currentJob = null;
        return;
      }

      if (status === 'failed') {
        throw new Error(
          data?.error?.message ?? data?.error ?? 'HeyGen retornou status failed.',
        );
      }

      lastPercent = Math.min(0.9, lastPercent + 0.05);
      reportProgress(
        requestId,
        `HeyGen: ${status || 'processando'}...`,
        lastPercent,
      );
      await sleep(5000);
    }

    throw new Error('Timeout — HeyGen demorou mais de 15min.');
  } catch (e) {
    reportError(requestId, e?.message ?? String(e));
  } finally {
    if (currentJob === requestId) currentJob = null;
  }
}

/**
 * Upload de audio pro HeyGen. Retorna URL hospedada nos servidores deles
 * pra usar no campo voice.audio_url.
 *
 * Tenta multiplos endpoints (HeyGen as vezes muda) — usa o que responder OK.
 */
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
