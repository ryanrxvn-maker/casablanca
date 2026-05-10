// Cliente da API interna da HeyGen.
// Hospedado em api2.heygen.com, autenticado por cookies da sessao do browser.
// host_permissions no manifest garante que cookies sao incluidos.

const API_BASE = "https://api2.heygen.com";

// ── Proxy: rota todas as chamadas atraves do content-script da aba HeyGen ──
// Sem isso, requests originam de chrome-extension://... e a HeyGen retorna
// 403 forbidden. Routeando pela aba, o Origin vira https://app.heygen.com
// (que e o que eles aceitam) e os cookies da sessao vao junto.

// Cache do tabId saudavel pra nao pingar a cada request
let cachedTabId = null;

async function pingTab(tabId) {
  try {
    const r = await chrome.tabs.sendMessage(tabId, { type: "ping" });
    return !!r?.ok;
  } catch { return false; }
}

async function findHeyGenTab() {
  // Reusa o cache se ainda responde
  if (cachedTabId !== null && await pingTab(cachedTabId)) return cachedTabId;
  cachedTabId = null;

  const tabs = await chrome.tabs.query({ url: "https://*.heygen.com/*" });
  if (!tabs.length) {
    throw new Error("Nenhuma aba app.heygen.com aberta. Abra https://app.heygen.com em uma aba.");
  }
  // Procura a primeira aba que responde ao ping (com content-script ativo)
  for (const t of tabs) {
    if (await pingTab(t.id)) { cachedTabId = t.id; return t.id; }
  }
  throw new Error(`${tabs.length} aba(s) HeyGen aberta(s) mas nenhuma com extensao ativa. Recarregue a aba (F5).`);
}

// Erros transientes que valem retry
function isTransientError(status, message) {
  if (status >= 500) return true;
  if (status === 429) return true;
  if (status === 408) return true;
  if (typeof message === "string" && /network|timeout|aborted/i.test(message)) return true;
  return false;
}

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function proxyFetch(req, { retries = 3 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const tabId = await findHeyGenTab();
      const res = await chrome.tabs.sendMessage(tabId, { type: "api-fetch", req });
      if (!res) throw new Error("Sem resposta do content-script.");
      // Retry em status transientes
      if (!res.ok && isTransientError(res.status, res.body?.message)) {
        if (attempt < retries) {
          await sleep(500 * Math.pow(2, attempt) + Math.random() * 200);
          continue;
        }
      }
      return res;
    } catch (e) {
      lastErr = e;
      // Conexao com tab perdeu — invalida cache e tenta de novo
      cachedTabId = null;
      const msg = String(e?.message || e);
      if (/Could not establish connection|Receiving end does not exist/i.test(msg)) {
        if (attempt < retries) {
          await sleep(500 + Math.random() * 200);
          continue;
        }
        throw new Error("Aba HeyGen perdeu conexao. Recarregue a aba (F5) e tente de novo.");
      }
      if (attempt < retries) {
        await sleep(500 * Math.pow(2, attempt) + Math.random() * 200);
        continue;
      }
      throw e;
    }
  }
  throw lastErr || new Error("Falha apos retries");
}

// ── Motores de geracao ─────────────────────────────────────────────────────
// Configuracao por motor descoberta interceptando o front da HeyGen.
export const ENGINES = {
  iii: {
    label: "Avatar III",
    description: "Lip sync. Uso ilimitado.",
    source_type: "avatar_video_shortcut_modal",
    default_resolution: "720p",
    supports_motion_prompt: false,
    settings: () => ({ use_avatar_iv_model: false, use_unlimited_mode: true }),
  },
  iv: {
    label: "Avatar IV",
    description: "Movimento generico que se adapta ao audio.",
    source_type: "avatar_video_shortcut_modal_with_avatar_iv",
    default_resolution: "1080p",
    supports_motion_prompt: true,
    settings: () => ({ use_avatar_iv_model: true, model: "4.3_turbo_edge", resolution: "1080p", alpha: 0.5 }),
  },
  v: {
    label: "Avatar V",
    description: "Estilo de movimento consistente que se adapta ao audio.",
    source_type: "avatar_video_shortcut_modal_with_avatar_iv",
    default_resolution: "1080p",
    supports_motion_prompt: true,
    settings: (avatarId) => ({ use_avatar_iv_model: true, model: "tokyo_v2_1_pde", resolution: "1080p", cross_ref_avatar_id: avatarId }),
  },
};

// ── HTTP helpers ───────────────────────────────────────────────────────────

async function jsonCall(method, path, body) {
  const req = { url: API_BASE + path, method, headers: {} };
  if (body !== undefined) {
    req.headers["Content-Type"] = "application/json";
    req.bodyText = JSON.stringify(body);
  }
  const r = await proxyFetch(req);
  return { status: r.status, ok: r.ok && r.body?.code === 100, body: r.body };
}

function unwrap(r) {
  if (!r.ok) throw new Error(`API ${r.status}: ${r.body?.message || r.body?.msg || "erro desconhecido"}`);
  return r.body.data;
}

// ── Account / quotas / listagens ───────────────────────────────────────────

export async function getAccount() {
  return unwrap(await jsonCall("GET", "/v1/pacific/account.get"));
}

export async function getLimits() {
  return unwrap(await jsonCall("GET", "/v1/avatar/video_generate/limits"));
}

async function listAvatarGroupsPage(page = 1, limit = 30) {
  const data = unwrap(await jsonCall("GET", `/v2/avatar_group.private.list?page=${page}&limit=${limit}`));
  return data;
}

async function listLooksOfGroup(groupId) {
  const data = unwrap(await jsonCall("GET", `/v2/avatar_group/look.list?group_id=${groupId}`));
  return data?.avatar_looks || [];
}

/**
 * Lista todos os "looks" (talking photos) do usuario.
 * Combina avatar_group.private.list + look.list por grupo.
 * Retorna array flat de looks com a forma que o sidepanel espera:
 *   { id (look_id), name, image_url, support_avatar_iv, unlimited_mode_disabled,
 *     preferred_orientation, group_id, group_name, group_type }
 */
export async function listTalkingPhotos() {
  const all = [];
  let page = 1;
  while (true) {
    const data = await listAvatarGroupsPage(page, 30);
    const groups = data?.avatar_groups || [];
    if (groups.length === 0) break;
    // Resolve looks de cada grupo em paralelo
    const lookLists = await Promise.all(groups.map((g) =>
      listLooksOfGroup(g.id).catch(() => [])
    ));
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      for (const wrapped of lookLists[i]) {
        const look = wrapped.look || wrapped;
        all.push({
          id: look.look_id || look.id,
          name: look.name || look.look_name || g.name,
          image_url: look.image_url,
          support_avatar_iv: !!look.support_avatar_iv,
          unlimited_mode_disabled: !!look.unlimited_mode_disabled,
          preferred_orientation: look.preferred_orientation || g.preferred_orientation,
          group_id: g.id,
          group_name: g.name,
          group_type: g.group_type,
          look_type: wrapped.look_type,
          is_favorite: !!look.is_favorite,
        });
      }
    }
    if (data?.total && all.length >= data.total) break;
    if (groups.length < 30) break;
    page += 1;
    if (page > 20) break; // hard cap defensivo
  }
  return all;
}

export async function listProjectItems(limit = 30) {
  const data = unwrap(await jsonCall("GET", `/v1/project/items?limit=${limit}`));
  return data?.items || [];
}

// ── Rename (validado em producao) ──────────────────────────────────────────

export async function updateVideoTitle(videoId, title) {
  return unwrap(await jsonCall("POST", "/v1/pacific/video.update", { id: videoId, params: { title } }));
}

// ── Upload de audio (4 passos) ─────────────────────────────────────────────

async function getSignedUploadUrl(contentType) {
  const ct = encodeURIComponent(contentType || "audio/wav");
  return unwrap(await jsonCall("GET", `/v1/file/url.get?file_type=audio&content_type=${ct}`));
}

async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result || "");
      // strip "data:audio/wav;base64,"
      resolve(s.slice(s.indexOf(",") + 1));
    };
    r.onerror = () => reject(r.error || new Error("FileReader error"));
    r.readAsDataURL(file);
  });
}

async function putToS3(signedUrl, file) {
  // O signed URL da HeyGen exige o header x-amz-server-side-encryption: AES256
  // (esta nos signed_headers). Sem ele a assinatura nao bate (403).
  // Roteamos via content-script para evitar CORS e cookies indesejados.
  // Bytes vao em base64 porque chrome.tabs.sendMessage usa JSON serialization
  // (ArrayBuffer/Blob viram {} vazio se enviados diretamente).
  const b64 = await fileToBase64(file);
  const r = await proxyFetch({
    url: signedUrl,
    method: "PUT",
    headers: {
      "Content-Type": file.type || "audio/wav",
      "x-amz-server-side-encryption": "AES256",
    },
    bodyBase64: b64,
    bodyType: file.type || "audio/wav",
  });
  if (!r.ok) {
    throw new Error(`S3 PUT falhou (${r.status}): ${r.body?._text || r.body?.message || ""}`);
  }
  if (r.body?._uploadedBytes === 0) {
    throw new Error("S3 PUT enviou 0 bytes — bug no transporte");
  }
}

async function registerUpload(uploadId, file) {
  const body = {
    name: file.name,
    id: uploadId,
    file_type: "audio",
    content_type: file.type || "audio/wav",
    filename: file.name,
    properties: { audio_source: "voice_recording" },
  };
  return unwrap(await jsonCall("POST", "/v1/file.upload", body));
}

async function getAsset(assetId) {
  return unwrap(await jsonCall("GET", `/v1/asset.get?id=${assetId}`));
}

async function pollAssetReady(assetId, { timeoutMs = 120000, intervalMs = 1000, onTick } = {}) {
  const t0 = Date.now();
  let lastStatus;
  while (Date.now() - t0 < timeoutMs) {
    try {
      const data = await getAsset(assetId);
      onTick?.(data);
      lastStatus = data?.file_meta?.status;
      if (data?.file_meta?.status === 2 && data?.file_meta?.meta?.audios?.mp3) {
        return data;
      }
      // status 3 = falhou no transcode (HeyGen marca asi)
      if (data?.file_meta?.status === 3) {
        throw new Error("HeyGen rejeitou o audio (transcode falhou). Verifique formato/duracao.");
      }
    } catch (e) {
      // Erros transientes ja tem retry interno via proxyFetch. Aqui se chegou
      // erro, propaga.
      if (Date.now() - t0 > timeoutMs - intervalMs) throw e;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timeout (${Math.round(timeoutMs/1000)}s) esperando transcode${lastStatus !== undefined ? ` (ultimo status: ${lastStatus})` : ""}`);
}

async function fastAsr(audioMp3Url) {
  const r = await jsonCall("POST", "/v1/audio/fast_asr", { url: audioMp3Url });
  const data = unwrap(r);
  return { duration: data?.data?.duration, words: data?.data?.words || [], text: data?.data?.text || "" };
}

/**
 * Faz upload de um File de audio. Retorna { audio_url, duration, words, text, asset_id }.
 * Pode receber callbacks para progress/status:
 *   onStep(step, info) - "url", "put", "register", "poll", "asr"
 */
export async function uploadAudio(file, { onStep } = {}) {
  onStep?.("url", { name: file.name, size: file.size });
  const { id: uploadId, url: signedUrl } = await getSignedUploadUrl(file.type);

  onStep?.("put", { uploadId });
  await putToS3(signedUrl, file);

  onStep?.("register", { uploadId });
  const reg = await registerUpload(uploadId, file);
  const assetId = reg.id;

  onStep?.("poll", { assetId });
  // Timeout escala pelo tamanho do arquivo: 60s base + 1s por MB,
  // capado em 5min. Arquivos pequenos sao processados em <5s; grandes
  // (50MB+) podem demorar minutos.
  const sizeMB = (file.size || 0) / (1024 * 1024);
  const transcodeTimeout = Math.min(300000, 60000 + Math.round(sizeMB * 1000));
  const asset = await pollAssetReady(assetId, {
    timeoutMs: transcodeTimeout,
    onTick: (a) => onStep?.("poll", { status: a?.file_meta?.status }),
  });
  const audioUrl = asset.file_meta.meta.audios.mp3;

  onStep?.("asr", {});
  const { duration, words, text } = await fastAsr(audioUrl);

  return { audio_url: audioUrl, duration, words, text, asset_id: assetId };
}

// ── Criar video ────────────────────────────────────────────────────────────

/**
 * Submete a criacao do video.
 * params: { title, avatarId, engine ('iii'|'iv'|'v'), audio (resultado de uploadAudio),
 *           orientation ('portrait'|'landscape'|'square'), resolution ('720p'|'1080p'),
 *           motionPrompt (opcional, para IV/V) }
 * Retorna { video_id, avatar_id }.
 */
export async function createVideo(params) {
  const { title, avatarId, engine, audio, orientation = "portrait", resolution, motionPrompt } = params;
  const eng = ENGINES[engine];
  if (!eng) throw new Error(`Motor desconhecido: ${engine}`);

  const settings = typeof eng.settings === "function" ? eng.settings(avatarId) : eng.settings;
  if (motionPrompt && eng.supports_motion_prompt) {
    // O campo exato ainda precisa ser confirmado por captura. Uso ambos os
    // nomes mais provaveis para nao quebrar quando descobrir o correto.
    settings.motion_prompt = motionPrompt;
    settings.prompt = motionPrompt;
  }

  const body = {
    video_title: title || "Avatar Video",
    video_orientation: orientation,
    resolution: resolution || eng.default_resolution,
    avatar_id: avatarId,
    source_type: eng.source_type,
    fit: "cover",
    audio_data: {
      audio_type: "uploaded",
      audio_url: audio.audio_url,
      duration: audio.duration,
      words: audio.words,
      text: audio.text || "",
    },
    avatar_settings: settings,
    enable_caption: false,
    create_new_avatar: false,
  };
  const r = await jsonCall("POST", "/v2/avatar/shortcut/submit", body);
  if (!r.ok) {
    const err = new Error(r.body?.message || `Falha ao criar video (status ${r.status})`);
    err.status = r.status;
    err.code = r.body?.code;
    throw err;
  }
  return r.body.data;
}

// ── Pipeline completo: audio File -> video gerado e renomeado ──────────────

/**
 * Processa um job inteiro do zero.
 * job: { file, title, avatarId, engine, orientation?, resolution?, motionPrompt? }
 * Callbacks:
 *   onProgress(stage, info) - "uploading-url", "uploading-put", "uploading-register",
 *                              "transcoding", "asr", "submitting", "renaming", "done"
 */
export async function processJob(job, { onProgress } = {}) {
  onProgress?.("upload", { msg: "Preparando upload..." });
  const audio = await uploadAudio(job.file, {
    onStep: (step, info) => onProgress?.(`upload-${step}`, info),
  });

  onProgress?.("submitting", { duration: audio.duration });
  const created = await createVideo({
    title: job.title,
    avatarId: job.avatarId,
    engine: job.engine,
    audio,
    orientation: job.orientation,
    resolution: job.resolution,
    motionPrompt: job.motionPrompt,
  });

  // Embora o title seja setado na criacao, o front da HeyGen usa "Avatar Video"
  // como default e renomeia depois. Vamos garantir o nome aqui, idempotente.
  if (job.title && job.title !== "Avatar Video") {
    onProgress?.("renaming", { videoId: created.video_id });
    try { await updateVideoTitle(created.video_id, job.title); } catch (e) { /* nao fatal */ }
  }

  onProgress?.("done", { videoId: created.video_id });
  return { videoId: created.video_id, avatarId: created.avatar_id, audio };
}
