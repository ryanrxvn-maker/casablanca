import { ENGINES, getLimits, listTalkingPhotos, processJob } from "./api.js";

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURAÇÃO DO AUTOR — EDITE ESTES VALORES ANTES DE DISTRIBUIR A EXTENSÃO
// ═══════════════════════════════════════════════════════════════════════════
const AUTHOR_CONFIG = {
  // Instagram do criador
  instagramHandle: "@euojeff.daily",
  instagramUrl: "https://www.instagram.com/euojeff.daily/",

  // Modo de doação: "pix" (chave PIX direta) | "link" (URL externa de plataforma)
  // - "pix":  mostra a chave PIX e botão Copiar (expõe nome legal — regra do BC)
  // - "link": mostra botão que abre URL externa (Mercado Pago, PicPay, BuyMeACoffee etc.)
  //          → permite esconder nome legal usando nome fantasia da plataforma
  donationMode: "link",

  // ─── Modo "pix" (preencha se donationMode === "pix") ───
  pixKey: "preencha-sua-chave-pix-aqui",
  pixKeyType: "Aleatoria",            // Email | CPF | Celular | Aleatoria
  pixBeneficiary: "Seu Nome Aqui",

  // ─── Modo "link" (preencha se donationMode === "link") ───
  // Exemplos:
  //   Mercado Pago: https://link.mercadopago.com.br/SEUHANDLE
  //   PicPay:       https://app.picpay.com/user/SEUHANDLE
  //   BuyMeACoffee: https://buymeacoffee.com/SEUHANDLE
  //   Ko-fi:        https://ko-fi.com/SEUHANDLE
  donationUrl: "https://link.mercadopago.com.br/apoieuojeff",
  donationLabel: "Apoiar agora — leva 30 segundos",
  donationNote: "PIX, cartão ou saldo MP. Sem cadastro. Você escolhe o valor.",
};
// ═══════════════════════════════════════════════════════════════════════════

// ── Estado persistido ─────────────────────────────────────────────────────
const STORAGE_AVATARS = "avatar_configs";
const STORAGE_BULK = "bulk_state";
const STORAGE_HISTORY = "queue_history_v1";
const HISTORY_CAP = 200;

// avatar_configs: { [look_id]: { engine: 'iii'|'iv'|'v', motion_prompt: string } }
let avatarConfigs = {};
let avatars = [];
let jobs = [];
let history = [];
let running = false;
let cancelRequested = false;

// Modo bulk: aplica mesma config a todos os jobs
let bulkMode = true;
let bulkConfig = { avatarId: "", engine: "iv", orientation: "portrait", resolution: "1080p", motionPrompt: "" };
let parallelism = 3;
let lastQuota = null;

// ── Helpers ───────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const uid = () => (crypto.randomUUID?.() ?? Date.now() + "-" + Math.random().toString(36).slice(2));

function escape(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function formatOrientation(o) {
  return o === "landscape" ? "16:9" : o === "square" ? "1:1" : o === "portrait" ? "9:16" : o;
}

function avatarById(id) {
  return avatars.find((a) => (a.id || a.talking_photo_id) === id);
}

// Wrapper defensivo pra storage.set — nunca crasha a UI por quota/erro
async function safeStorageSet(obj) {
  try {
    await chrome.storage.local.set(obj);
    return true;
  } catch (e) {
    console.warn("[storage.set falhou]", e?.message || e);
    return false;
  }
}

// Limita string pra evitar inflar storage com stack traces gigantes
function truncate(str, max = 500) {
  if (!str) return "";
  const s = String(str);
  return s.length > max ? s.slice(0, max) + "…" : s;
}

async function loadAvatarConfigs() {
  try {
    const { [STORAGE_AVATARS]: data = {} } = await chrome.storage.local.get(STORAGE_AVATARS);
    avatarConfigs = data;
  } catch (e) {
    console.warn("[loadAvatarConfigs falhou]", e?.message || e);
    avatarConfigs = {};
  }
}
async function saveAvatarConfigs() {
  await safeStorageSet({ [STORAGE_AVATARS]: avatarConfigs });
}
async function loadBulkState() {
  try {
    const { [STORAGE_BULK]: data } = await chrome.storage.local.get(STORAGE_BULK);
    if (data) {
      if (typeof data.bulkMode === "boolean") bulkMode = data.bulkMode;
      if (data.bulkConfig) bulkConfig = { ...bulkConfig, ...data.bulkConfig };
      if (typeof data.parallelism === "number") parallelism = Math.max(1, Math.min(5, data.parallelism));
    }
  } catch (e) {
    console.warn("[loadBulkState falhou]", e?.message || e);
  }
}
async function saveBulkState() {
  await safeStorageSet({ [STORAGE_BULK]: { bulkMode, bulkConfig, parallelism } });
}

async function loadHistory() {
  try {
    const { [STORAGE_HISTORY]: data } = await chrome.storage.local.get(STORAGE_HISTORY);
    history = Array.isArray(data) ? data : [];
  } catch (e) {
    console.warn("[loadHistory falhou]", e?.message || e);
    history = [];
  }
}
async function saveHistory() {
  if (history.length > HISTORY_CAP) history = history.slice(0, HISTORY_CAP);
  await safeStorageSet({ [STORAGE_HISTORY]: history });
}
async function pushToHistory(job, videoId) {
  const av = avatarById(job.avatarId);
  history.unshift({
    id: uid(),
    fileName: truncate(job.fileName, 200),
    title: truncate(job.title, 200),
    avatarId: job.avatarId,
    avatarName: truncate(av?.group_name || av?.name || "", 100),
    engine: job.engine,
    orientation: job.orientation,
    resolution: job.resolution,
    status: job.status,
    msg: truncate(job.msg, 500),
    videoId: videoId || null,
    createdAt: Date.now(),
  });
  await saveHistory();
  renderHistory();
}

// Limpa chaves desconhecidas do storage (lixo de versões antigas)
async function cleanupUnknownStorageKeys() {
  try {
    const KNOWN = new Set([STORAGE_AVATARS, STORAGE_BULK, STORAGE_HISTORY]);
    const all = await chrome.storage.local.get(null);
    const unknown = Object.keys(all).filter((k) => !KNOWN.has(k));
    if (unknown.length === 0) return;
    console.log("[cleanup] Removendo chaves antigas do storage:", unknown);
    await chrome.storage.local.remove(unknown);
  } catch (e) {
    console.warn("[cleanup falhou]", e?.message || e);
  }
}

// Diagnóstico: quanto cada chave ocupa
async function logStorageUsage() {
  try {
    const all = await chrome.storage.local.get(null);
    const sizes = {};
    let total = 0;
    for (const [k, v] of Object.entries(all)) {
      const sz = JSON.stringify(v).length;
      sizes[k] = `${(sz / 1024).toFixed(1)} KB`;
      total += sz;
    }
    console.log(`[storage] total=${(total/1024).toFixed(1)}KB`, sizes);
  } catch {}
}

// Reset completo do storage (escape hatch)
async function resetAllStorage() {
  try {
    await chrome.storage.local.clear();
    avatarConfigs = {};
    history = [];
    renderHistory();
    return true;
  } catch (e) {
    console.error("[reset falhou]", e?.message || e);
    return false;
  }
}

// ── Tabs ──────────────────────────────────────────────────────────────────
document.querySelectorAll(".tabs button").forEach((b) => {
  b.addEventListener("click", () => {
    document.querySelectorAll(".tabs button").forEach((x) => x.classList.toggle("active", x === b));
    document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x.id === `tab-${b.dataset.tab}`));
  });
});

// ── Aba Avatares ──────────────────────────────────────────────────────────
const $avatarsList = $("avatars-list");
const $avatarsStatus = $("avatars-status");

async function refreshAvatars() {
  $avatarsStatus.textContent = "Buscando...";
  $avatarsStatus.className = "status-msg";
  try {
    avatars = await listTalkingPhotos();
    $avatarsStatus.textContent = `${avatars.length} avatar(es) encontrado(s)`;
    $avatarsStatus.className = "status-msg ok";
    renderAvatars();
    renderBulkPanel();
    renderQueue();
  } catch (e) {
    $avatarsStatus.textContent = "Erro: " + (e?.message || e);
    $avatarsStatus.className = "status-msg err";
  }
}

function renderAvatars() {
  $avatarsList.innerHTML = "";
  for (const av of avatars) {
    const id = av.id || av.talking_photo_id;
    const cfg = avatarConfigs[id] || { engine: "iv", motion_prompt: "" };
    const row = document.createElement("div");
    row.className = "avatar-row";

    const img = document.createElement("img");
    img.src = av.image_url || "";
    img.alt = "";
    img.onerror = () => { img.style.background = "#2a2a3e"; img.removeAttribute("src"); };
    row.appendChild(img);

    const info = document.createElement("div");
    info.className = "avatar-info";
    info.innerHTML = `
      <div class="avatar-name">${escape(av.group_name || av.name || "(sem nome)")}</div>
      <div class="avatar-id">${id?.slice(0, 24) || ""}</div>
      <div class="avatar-controls">
        <select class="cfg-engine">
          ${Object.entries(ENGINES).map(([k, e]) => `<option value="${k}" ${k === cfg.engine ? "selected" : ""}>${e.label} — ${e.description}</option>`).join("")}
        </select>
        <textarea class="cfg-prompt" placeholder="Motion prompt (Avatar IV/V) — opcional" ${ENGINES[cfg.engine].supports_motion_prompt ? "" : "hidden"}>${escape(cfg.motion_prompt || "")}</textarea>
      </div>`;

    const $engine = info.querySelector(".cfg-engine");
    const $prompt = info.querySelector(".cfg-prompt");
    $engine.addEventListener("change", async () => {
      const eng = $engine.value;
      avatarConfigs[id] = { ...(avatarConfigs[id] || {}), engine: eng, motion_prompt: $prompt.value };
      $prompt.hidden = !ENGINES[eng].supports_motion_prompt;
      await saveAvatarConfigs();
    });
    $prompt.addEventListener("change", async () => {
      avatarConfigs[id] = { ...(avatarConfigs[id] || {}), engine: $engine.value, motion_prompt: $prompt.value };
      await saveAvatarConfigs();
    });

    row.appendChild(info);
    $avatarsList.appendChild(row);
  }
}

$("refresh-avatars").addEventListener("click", refreshAvatars);

// ── Painel bulk ───────────────────────────────────────────────────────────
const $bulkToggle = $("bulk-mode");
const $bulkPanel = $("bulk-panel");
const $bulkAvatarTrigger = $("bulk-avatar-trigger");
const $bulkEngine = $("bulk-engine");
const $bulkOrientation = $("bulk-orientation");
const $bulkResolution = $("bulk-resolution");
const $bulkPrompt = $("bulk-prompt");
const $bulkPromptField = $("bulk-prompt-field");

// ── Picker compartilhado (bulk + por-job) ─────────────────────────────────
const $sharedGrid = $("shared-avatar-grid");
let pickerOwner = null;
let pickerFilter = "";

function renderAvatarTrigger(triggerEl, avatarId) {
  const av = avatarById(avatarId);
  const $img = triggerEl.querySelector(".avatar-picker-image");
  const $name = triggerEl.querySelector(".avatar-picker-name");
  if (!$img || !$name) return;
  if (av) {
    $img.style.backgroundImage = av.image_url ? `url("${av.image_url.replace(/"/g, "%22")}")` : "";
    $name.innerHTML =
      `<span class="primary">${escape(av.group_name || av.name || "Avatar")}</span>` +
      (av.preferred_orientation ? `<span class="secondary">${formatOrientation(av.preferred_orientation)}</span>` : "");
  } else {
    $img.style.backgroundImage = "";
    $name.innerHTML = `<span class="primary">${avatars.length ? "Escolha um avatar" : "Detectar avatares primeiro"}</span>`;
  }
}

function renderSharedGrid() {
  const f = pickerFilter.toLowerCase().trim();
  const currentId = pickerOwner?.getCurrentId?.();
  const filtered = avatars.filter((a) => {
    if (!f) return true;
    return (a.name || "").toLowerCase().includes(f) ||
           (a.group_name || "").toLowerCase().includes(f);
  });
  const html = [
    `<input class="avatar-picker-search" placeholder="Buscar..." value="${escape(pickerFilter)}">`,
    ...(filtered.length === 0
      ? [`<div style="grid-column:1/-1;text-align:center;color:#6b7280;padding:14px;font-size:11px">Nenhum avatar encontrado.</div>`]
      : []),
    ...filtered.map((a) => {
      const id = a.id || a.talking_photo_id;
      const sel = id === currentId ? "selected" : "";
      const orient = a.preferred_orientation ? formatOrientation(a.preferred_orientation) : "";
      const safeImg = (a.image_url || "").replace(/"/g, "%22").replace(/'/g, "%27");
      return `<div class="avatar-tile ${sel}" data-id="${escape(id)}" title="${escape(a.group_name || a.name || id)}">
        <div class="avatar-tile-image" style="background-image:url('${safeImg}')"></div>
        <div class="avatar-tile-name">${escape(a.group_name || a.name || "?")}</div>
        ${orient ? `<div class="avatar-tile-group">${orient}</div>` : ""}
      </div>`;
    }),
  ].join("");
  $sharedGrid.innerHTML = html;
  const $search = $sharedGrid.querySelector(".avatar-picker-search");
  if ($search) {
    $search.focus();
    try { $search.setSelectionRange(pickerFilter.length, pickerFilter.length); } catch {}
  }
}

function positionSharedGrid(triggerEl) {
  // Se o trigger não existe mais no DOM (ex: job removido), retorna false pra fechar
  if (!triggerEl || !document.body.contains(triggerEl)) return false;
  const r = triggerEl.getBoundingClientRect();
  const margin = 4;
  const width = Math.max(280, r.width);
  $sharedGrid.style.width = width + "px";
  let left = r.left;
  if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
  if (left < 8) left = 8;
  $sharedGrid.style.left = left + "px";
  $sharedGrid.style.top = (r.bottom + margin) + "px";
  $sharedGrid.style.bottom = "";
  const gridRect = $sharedGrid.getBoundingClientRect();
  if (gridRect.bottom > window.innerHeight - 8 && r.top > window.innerHeight - r.bottom) {
    $sharedGrid.style.top = "";
    $sharedGrid.style.bottom = (window.innerHeight - r.top + margin) + "px";
  }
  return true;
}

function openPicker(owner) {
  pickerOwner = owner;
  pickerFilter = "";
  renderSharedGrid();
  positionSharedGrid(owner.triggerEl);
  $sharedGrid.classList.remove("hidden");
}

function closePicker() {
  pickerOwner = null;
  $sharedGrid.classList.add("hidden");
}

$sharedGrid.addEventListener("click", (e) => {
  e.stopPropagation();
  const tile = e.target.closest(".avatar-tile");
  if (tile && tile.dataset.id && pickerOwner) {
    pickerOwner.onSelect(tile.dataset.id);
    closePicker();
  }
});
$sharedGrid.addEventListener("mousedown", (e) => e.stopPropagation());
$sharedGrid.addEventListener("input", (e) => {
  if (e.target.classList.contains("avatar-picker-search")) {
    pickerFilter = e.target.value;
    renderSharedGrid();
  }
});

document.addEventListener("click", (e) => {
  if (!pickerOwner) return;
  if ($sharedGrid.contains(e.target) || pickerOwner.triggerEl.contains(e.target)) return;
  closePicker();
});
window.addEventListener("scroll", (e) => {
  if (!pickerOwner) return;
  // Não fecha se o scroll é DENTRO da grid do picker (usuário rolando pra ver mais avatares)
  if (e.target instanceof Node && $sharedGrid.contains(e.target)) return;
  // Scroll fora: reposiciona o picker grudado no trigger; se trigger sumiu do DOM, fecha
  if (!positionSharedGrid(pickerOwner.triggerEl)) closePicker();
}, true);
window.addEventListener("resize", () => {
  if (!pickerOwner) return;
  if (!positionSharedGrid(pickerOwner.triggerEl)) closePicker();
});

$bulkAvatarTrigger.addEventListener("click", (e) => {
  e.stopPropagation();
  if (pickerOwner?.triggerEl === $bulkAvatarTrigger) { closePicker(); return; }
  openPicker({
    triggerEl: $bulkAvatarTrigger,
    getCurrentId: () => bulkConfig.avatarId,
    onSelect: async (id) => {
      bulkConfig.avatarId = id;
      const av = avatarById(id);
      if (av?.preferred_orientation) {
        bulkConfig.orientation = av.preferred_orientation;
        $bulkOrientation.value = bulkConfig.orientation;
      }
      const cfg = avatarConfigs[id];
      if (cfg) {
        if (cfg.engine) { bulkConfig.engine = cfg.engine; $bulkEngine.value = cfg.engine; }
        if (cfg.motion_prompt) { bulkConfig.motionPrompt = cfg.motion_prompt; $bulkPrompt.value = cfg.motion_prompt; }
        $bulkPromptField.style.display = ENGINES[bulkConfig.engine].supports_motion_prompt ? "" : "none";
      }
      try { await saveBulkState(); } catch {}
      renderAvatarTrigger($bulkAvatarTrigger, bulkConfig.avatarId);
      applyBulkToAllJobs();
      renderQueue();
    },
  });
});

function renderBulkPanel() {
  $bulkToggle.checked = bulkMode;
  $bulkPanel.classList.toggle("hidden", !bulkMode);

  if (avatars.length && !avatarById(bulkConfig.avatarId)) {
    bulkConfig.avatarId = avatars[0].id || avatars[0].talking_photo_id;
  }

  renderAvatarTrigger($bulkAvatarTrigger, bulkConfig.avatarId);

  $bulkEngine.innerHTML = Object.entries(ENGINES).map(([k, e]) =>
    `<option value="${k}" ${k === bulkConfig.engine ? "selected" : ""}>${e.label} — ${e.description}</option>`
  ).join("");

  $bulkOrientation.value = bulkConfig.orientation;
  $bulkResolution.value = bulkConfig.resolution;
  $bulkPrompt.value = bulkConfig.motionPrompt || "";
  $bulkPromptField.style.display = ENGINES[bulkConfig.engine].supports_motion_prompt ? "" : "none";
}

function applyBulkToAllJobs() {
  if (!bulkMode) return;
  for (const j of jobs) {
    if (j.status === "running" || j.status === "done") continue;
    j.avatarId = bulkConfig.avatarId;
    j.engine = bulkConfig.engine;
    j.orientation = bulkConfig.orientation;
    j.resolution = bulkConfig.resolution;
    j.motionPrompt = bulkConfig.motionPrompt;
  }
}

$bulkToggle.addEventListener("change", async () => {
  bulkMode = $bulkToggle.checked;
  await saveBulkState();
  renderBulkPanel();
  if (bulkMode) applyBulkToAllJobs();
  renderQueue();
});

$bulkEngine.addEventListener("change", async () => {
  bulkConfig.engine = $bulkEngine.value;
  $bulkPromptField.style.display = ENGINES[bulkConfig.engine].supports_motion_prompt ? "" : "none";
  bulkConfig.resolution = ENGINES[bulkConfig.engine].default_resolution;
  $bulkResolution.value = bulkConfig.resolution;
  await saveBulkState();
  applyBulkToAllJobs();
  renderQueue();
});

$bulkOrientation.addEventListener("change", async () => {
  bulkConfig.orientation = $bulkOrientation.value;
  await saveBulkState();
  applyBulkToAllJobs();
  renderQueue();
});

$bulkResolution.addEventListener("change", async () => {
  bulkConfig.resolution = $bulkResolution.value;
  await saveBulkState();
  applyBulkToAllJobs();
  renderQueue();
});

$bulkPrompt.addEventListener("input", async () => {
  bulkConfig.motionPrompt = $bulkPrompt.value;
  applyBulkToAllJobs();
  await saveBulkState();
});

// ── Aba Fila ──────────────────────────────────────────────────────────────
const $dropzone = $("dropzone");
const $pickFiles = $("pick-files");
const $fileInput = $("file-input");
const $queueList = $("queue-list");
const $queueCount = $("queue-count");
const $startQueue = $("start-queue");
const $clearQueue = $("clear-queue");
const $quotaBox = $("quota-box");

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB (limite da HeyGen)
const VALID_AUDIO_EXT = /\.(mp3|wav|m4a|aac|ogg|flac)$/i;

$pickFiles.addEventListener("click", (e) => { e.preventDefault(); $fileInput.click(); });
$fileInput.addEventListener("change", (e) => addFiles([...e.target.files]));

["dragenter", "dragover"].forEach((ev) => $dropzone.addEventListener(ev, (e) => { e.preventDefault(); $dropzone.classList.add("drag"); }));
["dragleave", "drop"].forEach((ev) => $dropzone.addEventListener(ev, (e) => { e.preventDefault(); $dropzone.classList.remove("drag"); }));
$dropzone.addEventListener("drop", (e) => {
  const files = [...(e.dataTransfer?.files || [])];
  addFiles(files);
});

function defaultTitleFromFilename(name) {
  const noExt = name.replace(/\.[^.]+$/, "").trim();
  if (noExt) return noExt;
  return name.trim() || `Audio ${new Date().toISOString().slice(0, 19)}`;
}

function addFiles(files) {
  if (!files?.length) return;
  let rejected = 0;
  for (const f of files) {
    const isAudio = /^audio\//i.test(f.type) || VALID_AUDIO_EXT.test(f.name);
    if (!isAudio) { rejected++; continue; }
    if (f.size > MAX_FILE_SIZE) { rejected++; continue; }
    if (f.size === 0) { rejected++; continue; }
    const initial = bulkMode
      ? { avatarId: bulkConfig.avatarId, engine: bulkConfig.engine, orientation: bulkConfig.orientation, resolution: bulkConfig.resolution, motionPrompt: bulkConfig.motionPrompt }
      : { avatarId: avatars[0]?.id || avatars[0]?.talking_photo_id || "", engine: "iv", orientation: "portrait", resolution: "1080p", motionPrompt: "" };
    jobs.push({
      id: uid(),
      file: f,
      fileName: f.name,
      title: defaultTitleFromFilename(f.name),
      ...initial,
      status: "pending",
      msg: "",
    });
  }
  if (!bulkMode) {
    for (const j of jobs) applyAvatarDefaultIfMissing(j);
  }
  if (rejected > 0) {
    flashStatus(`${rejected} arquivo(s) ignorado(s) (formato/tamanho invalido — max 100MB, mp3/wav/m4a/aac/ogg/flac)`);
  }
  renderQueue();
}

function applyAvatarDefaultIfMissing(job) {
  if (!job.avatarId && avatars[0]) {
    job.avatarId = avatars[0].id || avatars[0].talking_photo_id;
  }
  if (job.avatarId) {
    const cfg = avatarConfigs[job.avatarId];
    if (cfg) {
      if (!job.engine) job.engine = cfg.engine;
      if (!job.motionPrompt && cfg.motion_prompt) job.motionPrompt = cfg.motion_prompt;
    }
    const av = avatarById(job.avatarId);
    if (!job.orientation && av?.preferred_orientation) job.orientation = av.preferred_orientation;
  }
  if (!job.engine) job.engine = "iv";
  if (!job.orientation) job.orientation = "portrait";
  if (!job.resolution) job.resolution = ENGINES[job.engine]?.default_resolution || "1080p";
}

$clearQueue.addEventListener("click", () => {
  if (running) return;
  jobs = [];
  renderQueue();
});

$startQueue.addEventListener("click", () => {
  if (running) {
    cancelRequested = true;
    $startQueue.textContent = "Cancelando...";
    $startQueue.disabled = true;
  } else {
    runQueue();
  }
});

const $parallelism = $("parallelism");
$parallelism.addEventListener("change", async () => {
  parallelism = parseInt($parallelism.value, 10) || 3;
  await saveBulkState();
});

function flashStatus(msg) {
  $queueCount.textContent = msg;
  $queueCount.className = "status-msg err";
  setTimeout(() => {
    $queueCount.className = "status-msg";
    $queueCount.textContent = `${jobs.length} audio${jobs.length === 1 ? "" : "s"}`;
  }, 4000);
}

function renderQueue() {
  $queueCount.textContent = `${jobs.length} audio${jobs.length === 1 ? "" : "s"}`;
  $queueCount.className = "status-msg";
  const pending = jobs.filter((j) => j.status === "pending").length;
  const hasAvatar = (bulkMode ? !!bulkConfig.avatarId : avatars.length > 0);

  if (running) {
    if (cancelRequested) {
      $startQueue.disabled = true;
      $startQueue.textContent = "Cancelando...";
    } else {
      $startQueue.disabled = false;
      $startQueue.textContent = "Cancelar";
    }
    $startQueue.classList.remove("primary");
    $startQueue.classList.add("danger");
  } else {
    $startQueue.disabled = pending === 0 || !hasAvatar;
    $startQueue.textContent = `Iniciar (${pending})`;
    $startQueue.classList.remove("danger");
    $startQueue.classList.add("primary");
  }
  $clearQueue.disabled = running;

  $queueList.innerHTML = "";
  for (const j of jobs) {
    applyAvatarDefaultIfMissing(j);
    const li = document.createElement("li");
    li.className = "job";

    if (bulkMode) {
      li.innerHTML = `
        <div class="job-head">
          <div class="job-name">${escape(j.fileName)}</div>
          <span class="job-status ${statusClass(j.status)}">${statusLabel(j.status)}</span>
          <button class="job-remove" data-id="${j.id}" title="Remover">×</button>
        </div>
        <input class="j-title bulk-title" data-id="${j.id}" type="text" value="${escape(j.title)}" placeholder="Titulo do video">
        ${j.msg ? `<div class="job-progress ${j.status === "failed" ? "err" : j.status === "done" ? "ok" : ""}">${escape(j.msg)}</div>` : ""}
      `;
    } else {
      const eng = ENGINES[j.engine] || ENGINES.iv;
      li.innerHTML = `
        <div class="job-head">
          <div class="job-name">${escape(j.fileName)}</div>
          <span class="job-status ${statusClass(j.status)}">${statusLabel(j.status)}</span>
          <button class="job-remove" data-id="${j.id}" title="Remover">×</button>
        </div>
        <div class="job-controls">
          <button type="button" class="avatar-picker-trigger j-avatar-trigger full" data-job-id="${j.id}">
            <span class="avatar-picker-image"></span>
            <span class="avatar-picker-name"></span>
            <span class="avatar-picker-caret">▼</span>
          </button>
          <select class="j-engine" data-id="${j.id}">
            ${Object.entries(ENGINES).map(([k, e]) => `<option value="${k}" ${k === j.engine ? "selected" : ""}>${e.label}</option>`).join("")}
          </select>
          <select class="j-orient" data-id="${j.id}">
            <option value="portrait" ${j.orientation === "portrait" ? "selected" : ""}>9:16</option>
            <option value="landscape" ${j.orientation === "landscape" ? "selected" : ""}>16:9</option>
            <option value="square" ${j.orientation === "square" ? "selected" : ""}>1:1</option>
          </select>
          <select class="j-res" data-id="${j.id}">
            <option value="720p" ${j.resolution === "720p" ? "selected" : ""}>720p</option>
            <option value="1080p" ${j.resolution === "1080p" ? "selected" : ""}>1080p</option>
          </select>
          <input class="j-title full" data-id="${j.id}" type="text" value="${escape(j.title)}" placeholder="Titulo do video">
          <textarea class="j-prompt full" data-id="${j.id}" placeholder="Motion prompt (Avatar IV/V)" ${eng.supports_motion_prompt ? "" : "hidden"}>${escape(j.motionPrompt)}</textarea>
        </div>
        ${j.msg ? `<div class="job-progress ${j.status === "failed" ? "err" : j.status === "done" ? "ok" : ""}">${escape(j.msg)}</div>` : ""}
      `;
    }
    $queueList.appendChild(li);
  }

  $queueList.querySelectorAll(".job-remove").forEach((b) => b.addEventListener("click", () => {
    if (running) return;
    const id = b.dataset.id;
    jobs = jobs.filter((x) => x.id !== id);
    renderQueue();
  }));
  $queueList.querySelectorAll(".j-title").forEach((i) => i.addEventListener("input", (e) => {
    const j = jobs.find((x) => x.id === e.target.dataset.id);
    if (j) j.title = e.target.value;
  }));
  if (!bulkMode) {
    $queueList.querySelectorAll(".j-avatar-trigger").forEach((trig) => {
      const jobId = trig.dataset.jobId;
      const j = jobs.find((x) => x.id === jobId);
      if (j) renderAvatarTrigger(trig, j.avatarId);
      trig.addEventListener("click", (e) => {
        e.stopPropagation();
        const job = jobs.find((x) => x.id === trig.dataset.jobId);
        if (!job) return;
        if (pickerOwner?.triggerEl === trig) { closePicker(); return; }
        openPicker({
          triggerEl: trig,
          getCurrentId: () => job.avatarId,
          onSelect: (id) => {
            job.avatarId = id;
            const av = avatarById(id);
            if (av?.preferred_orientation) job.orientation = av.preferred_orientation;
            const cfg = avatarConfigs[id];
            if (cfg) {
              if (cfg.engine) job.engine = cfg.engine;
              if (cfg.motion_prompt && !job.motionPrompt) job.motionPrompt = cfg.motion_prompt;
            }
            renderAvatarTrigger(trig, job.avatarId);
            renderQueue();
          },
        });
      });
    });
    $queueList.querySelectorAll(".j-engine").forEach((s) => s.addEventListener("change", (e) => {
      const j = jobs.find((x) => x.id === e.target.dataset.id);
      if (j) { j.engine = e.target.value; j.resolution = ENGINES[j.engine].default_resolution; renderQueue(); }
    }));
    $queueList.querySelectorAll(".j-orient").forEach((s) => s.addEventListener("change", (e) => {
      const j = jobs.find((x) => x.id === e.target.dataset.id);
      if (j) j.orientation = e.target.value;
    }));
    $queueList.querySelectorAll(".j-res").forEach((s) => s.addEventListener("change", (e) => {
      const j = jobs.find((x) => x.id === e.target.dataset.id);
      if (j) j.resolution = e.target.value;
    }));
    $queueList.querySelectorAll(".j-prompt").forEach((t) => t.addEventListener("input", (e) => {
      const j = jobs.find((x) => x.id === e.target.dataset.id);
      if (j) j.motionPrompt = e.target.value;
    }));
  }
}

function statusClass(s) { return s === "running" ? "running" : s === "done" ? "done" : s === "failed" ? "failed" : "pending"; }
function statusLabel(s) { return s === "running" ? "rodando" : s === "done" ? "ok" : s === "failed" ? "erro" : "fila"; }

// ── Validacao up-front ────────────────────────────────────────────────────
function validateBeforeStart() {
  const pending = jobs.filter((j) => j.status === "pending");
  if (pending.length === 0) return "Nenhum audio na fila.";
  for (const j of pending) {
    if (!j.avatarId) return `"${j.fileName}": avatar nao selecionado.`;
    if (!avatarById(j.avatarId)) return `"${j.fileName}": avatar selecionado nao existe mais. Detecte avatares de novo.`;
    if (!j.title || !j.title.trim()) return `"${j.fileName}": titulo vazio.`;
    if (!ENGINES[j.engine]) return `"${j.fileName}": motor invalido.`;
  }
  // Aviso de quota: se o batch usa Avatar IV/V e nao tem creditos, avisa antes
  const usesPaid = pending.some((j) => j.engine !== "iii");
  if (usesPaid && lastQuota && lastQuota.is_hit_monthly_limit) {
    return "Sem creditos para Avatar IV/V. Troca pra Avatar III (uso ilimitado) ou recarrega creditos na HeyGen.";
  }
  return null;
}

// ── Worker pool ───────────────────────────────────────────────────────────
async function processOneJob(j) {
  if (cancelRequested) {
    j.status = "failed"; j.msg = "Cancelado pelo usuario";
    renderQueue();
    await pushToHistory(j, null);
    return;
  }
  j.status = "running"; j.msg = "Iniciando...";
  renderQueue();
  let videoId = null;
  try {
    const result = await processJob({
      file: j.file,
      title: j.title,
      avatarId: j.avatarId,
      engine: j.engine,
      motionPrompt: j.motionPrompt || undefined,
      orientation: j.orientation,
      resolution: j.resolution,
    }, {
      onProgress: (stage, info) => {
        j.msg = stageLabel(stage, info);
        renderQueue();
      },
    });
    videoId = result.videoId;
    j.videoId = videoId;
    j.status = "done";
    j.msg = `OK — video_id: ${String(videoId).slice(0, 12)}...`;
  } catch (e) {
    j.status = "failed";
    j.msg = e?.message || String(e);
  }
  renderQueue();
  await pushToHistory(j, videoId);
}

async function runQueue() {
  if (running) return;
  const error = validateBeforeStart();
  if (error) { flashStatus(error); return; }

  cancelRequested = false;
  running = true;
  renderQueue();
  try {
    const N = Math.max(1, Math.min(5, parallelism));
    let cursor = 0;
    const pickNext = () => {
      if (cancelRequested) return null;
      while (cursor < jobs.length) {
        const j = jobs[cursor++];
        if (j.status === "pending") return j;
      }
      return null;
    };
    async function worker() {
      while (true) {
        const j = pickNext();
        if (!j) return;
        await processOneJob(j);
      }
    }
    await Promise.all(Array.from({ length: N }, () => worker()));
  } finally {
    running = false;
    cancelRequested = false;
    renderQueue();
    refreshQuota();
  }
}

function stageLabel(stage, info) {
  switch (stage) {
    case "upload": return "Preparando upload...";
    case "upload-url": return "Pegando URL de upload...";
    case "upload-put": return "Enviando audio...";
    case "upload-register": return "Registrando arquivo...";
    case "upload-poll": return `Transcodificando${info?.status !== undefined ? ` (status ${info.status})` : "..."}`;
    case "upload-asr": return "Analisando audio...";
    case "submitting": return `Gerando video (${info?.duration?.toFixed?.(1) || "?"}s)...`;
    case "renaming": return "Renomeando...";
    case "done": return "Concluido";
    default: return stage;
  }
}

// ── Quota ─────────────────────────────────────────────────────────────────
async function refreshQuota() {
  try {
    const limits = await getLimits();
    if (!limits) return;
    lastQuota = limits;
    const total = limits.total_limit || 0;
    const remain = limits.remain || 0;
    const used = limits.total_consumed || 0;
    const empty = limits.is_hit_monthly_limit;
    const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
    $quotaBox.classList.remove("hidden", "warn", "empty");
    if (empty) $quotaBox.classList.add("empty");
    else if (remain < total * 0.1) $quotaBox.classList.add("warn");
    $quotaBox.innerHTML = `
      <div>Quota: <strong>${used}</strong> / ${total} ${limits.unit || "s"} usados — <strong>${remain}</strong> restante(s)${empty ? " <span style=\"color:#f87171\">(limite mensal atingido — Avatar III continua ilimitado)</span>" : ""}</div>
      <div class="quota-bar"><div style="width:${pct}%"></div></div>`;
  } catch {
    $quotaBox.classList.add("hidden");
    lastQuota = null;
  }
}

// ── Histórico ─────────────────────────────────────────────────────────────
function renderHistory() {
  const $count = $("history-count");
  const $list = $("history-list");
  if (!$count || !$list) return;
  $count.textContent = String(history.length);

  if (history.length === 0) {
    $list.innerHTML = `<li class="history-empty">Histórico vazio. Os videos gerados aparecerão aqui (mesmo após fechar o painel).</li>`;
    return;
  }

  $list.innerHTML = history.map((h) => {
    const date = new Date(h.createdAt).toLocaleString("pt-BR", {
      day: "2-digit", month: "2-digit", year: "2-digit",
      hour: "2-digit", minute: "2-digit",
    });
    const statusCls = h.status === "done" ? "ok" : "err";
    const statusText = h.status === "done" ? "OK" : "ERR";
    const engineLabel = ENGINES[h.engine]?.label || h.engine || "?";
    const meta = [
      h.avatarName || "(avatar removido)",
      engineLabel,
      formatOrientation(h.orientation),
      date,
    ].filter(Boolean).join(" · ");
    return `
      <li class="history-item">
        <div class="history-row">
          <span class="history-status ${statusCls}">${statusText}</span>
          <div class="history-info">
            <div class="history-title">${escape(h.title || h.fileName)}</div>
            <div class="history-meta">${escape(meta)}</div>
            ${h.status === "failed" && h.msg ? `<div class="history-error">${escape(h.msg)}</div>` : ""}
            ${h.videoId ? `<div class="history-vid">id: <code>${escape(h.videoId)}</code></div>` : ""}
          </div>
          <div class="history-actions">
            ${h.videoId ? `<button class="history-copy" data-id="${escape(h.videoId)}" title="Copiar video_id">copiar</button>` : ""}
            <button class="history-remove" data-hid="${escape(h.id)}" title="Remover do histórico">×</button>
          </div>
        </div>
      </li>
    `;
  }).join("");

  $list.querySelectorAll(".history-copy").forEach((b) => b.addEventListener("click", async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(b.dataset.id);
      const orig = b.textContent;
      b.textContent = "ok";
      setTimeout(() => { b.textContent = orig; }, 1200);
    } catch {}
  }));
  $list.querySelectorAll(".history-remove").forEach((b) => b.addEventListener("click", async (e) => {
    e.stopPropagation();
    history = history.filter((h) => h.id !== b.dataset.hid);
    await saveHistory();
    renderHistory();
  }));
}

let _historyClearArmed = false;
function setupHistoryButtons() {
  const $toggle = $("history-toggle");
  const $list = $("history-list");
  $toggle?.addEventListener("click", () => {
    $toggle.classList.toggle("open");
    $list.classList.toggle("hidden");
  });

  $("history-open-heygen")?.addEventListener("click", () => {
    chrome.tabs.create({ url: "https://app.heygen.com/projects" });
  });

  const $clear = $("history-clear");
  $clear?.addEventListener("click", async () => {
    if (history.length === 0) return;
    if (!_historyClearArmed) {
      _historyClearArmed = true;
      const orig = $clear.textContent;
      $clear.textContent = "Confirmar?";
      $clear.style.color = "#f87171";
      setTimeout(() => {
        _historyClearArmed = false;
        $clear.textContent = orig;
        $clear.style.color = "";
      }, 3000);
      return;
    }
    history = [];
    await saveHistory();
    renderHistory();
    _historyClearArmed = false;
    $clear.textContent = "Limpar";
    $clear.style.color = "";
  });
}

// ── Modal Apoiar ──────────────────────────────────────────────────────────
function renderDonationCard() {
  const $container = $("donation-card-container");
  if (!$container) return;

  if (AUTHOR_CONFIG.donationMode === "link") {
    $container.innerHTML = `
      <div class="donation-link-card">
        <button id="open-donation" class="btn-donate" type="button">
          ${escape(AUTHOR_CONFIG.donationLabel || "Apoiar")}
        </button>
        ${AUTHOR_CONFIG.donationNote ? `<div class="donation-note">${escape(AUTHOR_CONFIG.donationNote)}</div>` : ""}
      </div>
    `;
    $("open-donation")?.addEventListener("click", () => {
      chrome.tabs.create({ url: AUTHOR_CONFIG.donationUrl });
    });
  } else {
    $container.innerHTML = `
      <div class="pix-card">
        <div class="pix-label">Chave PIX (${escape(AUTHOR_CONFIG.pixKeyType || "Email")})</div>
        <div class="pix-key-row">
          <code id="pix-key">${escape(AUTHOR_CONFIG.pixKey)}</code>
          <button id="copy-pix" class="btn-copy" type="button">Copiar</button>
        </div>
        <div class="pix-foot">
          Beneficiário: <span>${escape(AUTHOR_CONFIG.pixBeneficiary)}</span><br>
          PIX direto entre PF — sem taxa, sem intermediário.
        </div>
      </div>
    `;
    $("copy-pix")?.addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      try {
        await navigator.clipboard.writeText(AUTHOR_CONFIG.pixKey);
        const orig = btn.textContent;
        btn.textContent = "Copiado!";
        btn.style.background = "#059669";
        setTimeout(() => {
          btn.textContent = orig;
          btn.style.background = "";
        }, 1800);
      } catch {
        btn.textContent = "Erro";
        setTimeout(() => { btn.textContent = "Copiar"; }, 1500);
      }
    });
  }
}

function setupSupportModal() {
  const modal = $("support-modal");
  if (!modal) return;

  // Popula os campos fixos com a config do autor
  $("ig-handle").textContent = AUTHOR_CONFIG.instagramHandle;

  // Versão do manifest pra mostrar no rodapé
  try {
    const manifest = chrome.runtime.getManifest();
    $("modal-version").textContent = manifest.version;
  } catch {}

  // Renderiza o card de doação (PIX ou link, conforme o modo)
  renderDonationCard();

  const open = () => modal.classList.remove("hidden");
  const close = () => modal.classList.add("hidden");

  $("open-support")?.addEventListener("click", open);
  $("support-close")?.addEventListener("click", close);

  // Fechar clicando fora do modal
  modal.addEventListener("click", (e) => {
    if (e.target === modal) close();
  });

  // Esc fecha
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.classList.contains("hidden")) close();
  });

  // Abrir Instagram em nova aba
  $("open-ig")?.addEventListener("click", () => {
    chrome.tabs.create({ url: AUTHOR_CONFIG.instagramUrl });
  });

  // Abrir LICENSE.txt
  $("open-license")?.addEventListener("click", (e) => {
    e.preventDefault();
    try {
      chrome.tabs.create({ url: chrome.runtime.getURL("LICENSE.txt") });
    } catch {}
  });

  // Reset de emergência: limpa todo o storage da extensão (com confirmação)
  let _resetArmed = false;
  $("reset-storage")?.addEventListener("click", async (e) => {
    e.preventDefault();
    const link = e.currentTarget;
    if (!_resetArmed) {
      _resetArmed = true;
      const orig = link.textContent;
      link.textContent = "Tem certeza? Clica de novo";
      setTimeout(() => {
        _resetArmed = false;
        link.textContent = orig;
      }, 4000);
      return;
    }
    const ok = await resetAllStorage();
    link.textContent = ok ? "Resetado — recarregue" : "Falhou";
    _resetArmed = false;
    setTimeout(() => location.reload(), 1500);
  });
}

// ── Boot ──────────────────────────────────────────────────────────────────
(async () => {
  // Limpa chaves desconhecidas (lixo de versões antigas) antes de tudo
  await cleanupUnknownStorageKeys();
  // Diagnóstico: log do uso atual no console
  await logStorageUsage();

  await loadAvatarConfigs();
  await loadBulkState();
  await loadHistory();
  $parallelism.value = String(parallelism);
  renderBulkPanel();
  setupHistoryButtons();
  setupSupportModal();
  renderHistory();
  refreshAvatars().catch(() => {});
  refreshQuota().catch(() => {});
  renderQueue();
})();
