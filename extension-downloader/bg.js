'use strict';
importScripts('download-utils.js');
const { terminal, normalizeUrl, humanError, isMedia, newerVersion } = DownloaderUtils;
const KEEPALIVE_ALARM = 'darko-download-recovery';
const ENGINE_PORTS = [47923, 47924, 47925, 47926, 47927, 47928, 47929, 47930, 47931];
const QUEUE_KEY = 'downloadJobsV2';
const MAX_JOB_MS = 60 * 60 * 1000;
let jobs = null;
let loadingJobs = null;
let saving = Promise.resolve();
let ticking = false;
let tickTimer;
let discovery;

// Alarms recover work after MV3 suspension; they do not prevent suspension.
// Jobs and Chrome download ids are durable, and listeners register at top level.
function ensureKeepalive() { chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.5 }); }
function getCfg() { return chrome.storage.local.get(['token', 'port']); }
function tfetch(url, ms = 12000, options = {}) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(ms), cache: 'no-store' });
}
async function probePort(port) {
  const r = await tfetch(`http://127.0.0.1:${port}/health`, 1800);
  const health = r.ok ? await r.json() : null;
  if (health?.app !== 'darkolab-downloader-engine') throw new Error('not-engine');
  const pairResponse = await tfetch(`http://127.0.0.1:${port}/pair`, 1800);
  const pair = pairResponse.ok ? await pairResponse.json() : null;
  if (!pair?.token) throw new Error('not-paired');
  return { port, token: pair.token, allowAdult: pair.allowAdult === true, version: health.version || null,
    compatible: health.capabilities?.includes('download-jobs-v1') === true };
}
async function discoverEngine(preferred) {
  if (discovery) return discovery;
  discovery = (async () => {
    // Prefer a compatible engine when an old installation also runs locally.
    const ports = [...new Set([preferred, ...ENGINE_PORTS].filter(Boolean))];
    const results = await Promise.allSettled(ports.map(probePort));
    const found = results.filter(x => x.status === 'fulfilled').map(x => x.value);
    const compatible = found.filter(x => x.compatible);
    const eng = compatible.reduce((best, current) =>
      !best || newerVersion(current.version, best.version) ? current : best, null) || found[0] || null;
    if (eng) await chrome.storage.local.set({ token: eng.token, port: eng.port });
    return eng;
  })().finally(() => { discovery = null; });
  return discovery;
}
async function recheckEngine() {
  const eng = await discoverEngine((await getCfg()).port || 47923);
  await chrome.storage.local.set({ engineUp: !!eng, enginePortCache: eng?.port || 47923,
    engineVersion: eng?.version || null, engineCompatible: !!eng?.compatible, engineCheckedAt: Date.now() });
  return eng;
}
async function pingEngine(force = false) {
  const cache = await chrome.storage.local.get(['engineUp', 'enginePortCache', 'engineVersion', 'engineCompatible', 'engineCheckedAt']);
  if (!force && Date.now() - (cache.engineCheckedAt || 0) < 10000) return {
    connected: !!cache.engineUp, port: cache.enginePortCache, engineVersion: cache.engineVersion,
    engineCompatible: !!cache.engineCompatible };
  const eng = await recheckEngine();
  return { connected: !!eng, port: eng?.port || 47923, engineVersion: eng?.version || null, engineCompatible: !!eng?.compatible };
}
async function loadJobs() {
  if (jobs) return jobs;
  if (!loadingJobs) loadingJobs = chrome.storage.local.get(QUEUE_KEY).then(value => {
    jobs = Array.isArray(value[QUEUE_KEY]) ? value[QUEUE_KEY] : [];
    return jobs;
  });
  return loadingJobs;
}
function persist() {
  const snapshot = JSON.parse(JSON.stringify(jobs));
  saving = saving.catch(() => {}).then(() => chrome.storage.local.set({ [QUEUE_KEY]: snapshot }));
  return saving;
}
function publicJob(job) {
  const { id, url, mode, quality, adult, state, phase, pct, error, code, filename, createdAt, updatedAt, downloadId } = job;
  return { id, url, mode, quality, adult, state, phase, pct, error, code, filename, createdAt, updatedAt, downloadId };
}
function emit(job) {
  const message = { type: 'darko-dl-progress', ...publicJob(job), jobId: job.id, reqId: job.reqId };
  if (Number.isInteger(job.tabId)) chrome.tabs.sendMessage(job.tabId, message, () => { void chrome.runtime.lastError; });
  chrome.runtime.sendMessage(message, () => { void chrome.runtime.lastError; });
}
async function update(job, patch) {
  Object.assign(job, patch, { updatedAt: Date.now() });
  await persist();
  emit(job);
}
function wake(delay = 0) { clearTimeout(tickTimer); tickTimer = setTimeout(() => { tick().catch(() => {}); }, delay); }
function errorCode(error) { return String(error?.code || error?.message || error || 'FAILED'); }
async function fail(job, error) {
  const code = errorCode(error);
  await update(job, { state: /USER_CANCELED/.test(code) ? 'canceled' : 'error', phase: 'error', error: humanError(error), code });
}
async function enqueue(input, sender = {}) {
  await loadJobs();
  const url = normalizeUrl(input.url);
  const mode = ['video', 'audio-mp3', 'audio-wav'].includes(input.mode) ? input.mode : 'video';
  const quality = ['1080', '720', '480', 'best'].includes(input.quality) ? input.quality : '1080';
  // A repeated click or lost acknowledgement must not start a second file.
  const previous = jobs.find(j => (input.reqId && j.reqId === input.reqId) ||
    (!terminal(j.state) && j.url === url && j.mode === mode && j.quality === quality && j.adult === !!input.adult));
  if (previous) return previous;
  if (jobs.filter(j => !terminal(j.state)).length >= 30) throw new Error('A fila tem 30 links. Aguarde alguns downloads antes de adicionar outros.');
  const recentCompleted = new Set(jobs.filter(j => terminal(j.state) && Date.now() - j.updatedAt < 7 * 86400000).slice(-70).map(j => j.id));
  jobs = jobs.filter(j => !terminal(j.state) || recentCompleted.has(j.id));
  const job = { id: crypto.randomUUID(), reqId: input.reqId || null, tabId: sender.tab?.id,
    url, mode, quality, adult: input.adult === true, state: 'queued', phase: 'queued', pct: -1,
    createdAt: Date.now(), updatedAt: Date.now(), retries: 0, transportErrors: 0 };
  jobs.push(job);
  await persist();
  ensureKeepalive();
  wake();
  return job;
}
async function engineJson(eng, path, options = {}) {
  let response = await tfetch(`http://127.0.0.1:${eng.port}${path}`, 15000,
    { ...options, headers: { authorization: `Bearer ${eng.token}`, 'content-type': 'application/json', ...options.headers } });
  if (response.status === 401) {
    const repaired = await probePort(eng.port);
    Object.assign(eng, repaired);
    response = await tfetch(`http://127.0.0.1:${eng.port}${path}`, 15000,
      { ...options, headers: { authorization: `Bearer ${eng.token}`, 'content-type': 'application/json', ...options.headers } });
  }
  const value = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(value.error || `HTTP ${response.status}`); error.status = response.status; throw error; }
  return value;
}
function chromeSearch(query) {
  return new Promise((resolve, reject) => chrome.downloads.search(query, items => {
    if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message)); else resolve(items || []);
  }));
}
async function inspectDownload(job) {
  const [item] = await chromeSearch({ id: job.downloadId });
  if (!item) { await fail(job, 'O download não está mais no navegador. Tente novamente.'); return; }
  if (item.state === 'complete') {
    if (Math.max(Number(item.fileSize) || 0, Number(item.bytesReceived) || 0) <= 0 || /json|html|text\/plain/i.test(item.mime || '') || /\.(json|html?)$/i.test(item.filename || '')) {
      await fail(job, 'INVALID_MEDIA'); return;
    }
    await update(job, { state: 'complete', phase: 'complete', pct: 100, error: null, filename: job.filename || item.filename?.split(/[\\/]/).pop() });
  } else if (item.state === 'interrupted') {
    const reason = item.error || 'SERVER_FAILED';
    if (/^(NETWORK_|SERVER_FAILED|SERVER_UNREACHABLE|SERVER_UNAUTHORIZED|SERVER_FORBIDDEN)/.test(reason) && job.retries < 2) {
      await update(job, { state: 'preparing', phase: 'retrying', retries: job.retries + 1,
        downloadId: null, delivery: null, nextAttemptAt: Date.now() + 1500 * (job.retries + 1) });
    } else await fail(job, reason);
  } else {
    const pct = item.totalBytes > 0 ? Math.min(99, Math.floor(item.bytesReceived / item.totalBytes * 100)) : -1;
    if (job.pct !== pct || job.phase !== 'saving') await update(job, { state: 'downloading', phase: 'saving', pct });
  }
}
async function startBrowserDownload(job, url, filename) {
  // Persist delivery intent before invoking Chrome. If SW dies between the
  // browser call and id persistence, recovery looks up that exact intent.
  if (!job.delivery) await update(job, { delivery: { url, startedAt: Date.now() }, state: 'delivering', phase: 'saving' });
  const matches = await chromeSearch({ startedAfter: new Date(job.delivery.startedAt - 1000).toISOString(), limit: 50 });
  const existing = matches.find(x => x.url === job.delivery.url && x.state !== 'interrupted');
  const id = existing?.id ?? await new Promise((resolve, reject) => chrome.downloads.download(
    { url: job.delivery.url, filename, saveAs: false, conflictAction: 'uniquify' }, result => {
      const error = chrome.runtime.lastError;
      if (error || result === undefined) reject(new Error(error?.message || 'Falha ao iniciar o download.'));
      else resolve(result);
    }));
  await update(job, { downloadId: id, state: 'downloading', phase: 'saving', filename });
  await inspectDownload(job);
}
const IG_APP_ID = '936619743392459';
function isInstagramUrl(url) { try { return /(^|\.)instagram\.com$/.test(new URL(url).hostname); } catch { return false; } }
async function resolveInstagram(pageUrl) {
  const html = await tfetch(pageUrl, 20000, { credentials: 'include' }).then(r => r.text());
  const mid = (html.match(/instagram:\/\/media\?id=(\d+)/) || [])[1] || (html.match(/"media_id":"(\d+)"/) || [])[1];
  if (!mid) return null;
  const response = await tfetch(`https://www.instagram.com/api/v1/media/${mid}/info/`, 20000,
    { credentials: 'include', headers: { 'x-ig-app-id': IG_APP_ID } });
  if (!response.ok) return null;
  const item = (await response.json())?.items?.[0];
  for (const media of [item, ...(item?.carousel_media || [])]) {
    const best = media?.video_versions?.slice().sort((a, b) => (b.width || 0) - (a.width || 0))[0];
    if (best?.url) return best.url;
  }
  return null;
}
async function advance(job) {
  if (job.nextAttemptAt && Date.now() < job.nextAttemptAt) return;
  if (Date.now() - job.createdAt > MAX_JOB_MS) {
    // Do not leave a browser transfer alive after presenting a timeout.
    if (job.downloadId != null) await new Promise(resolve => chrome.downloads.cancel(job.downloadId, () => { void chrome.runtime.lastError; resolve(); }));
    await fail(job, 'O download excedeu uma hora. Tente um vídeo menor ou outra qualidade.'); return;
  }
  if (job.downloadId != null) { await inspectDownload(job); return; }
  if (job.delivery) { await startBrowserDownload(job, job.delivery.url, job.filename); return; }
  if (!job.igChecked && job.mode === 'video' && !job.adult && isInstagramUrl(job.url)) {
    await update(job, { state: 'preparing', phase: 'resolving' });
    const cdn = await resolveInstagram(job.url).catch(() => null);
    await update(job, { igChecked: true });
    if (cdn) {
      const name = `instagram-${new URL(job.url).pathname.split('/').filter(Boolean)[1] || job.id}.mp4`;
      await startBrowserDownload(job, cdn, name); return;
    }
  }
  const eng = await discoverEngine(job.enginePort || (await getCfg()).port || 47923);
  if (!eng) throw new Error('ENGINE_OFFLINE');
  if (!eng.compatible) { await fail(job, 'ENGINE_UPDATE_REQUIRED'); return; }
  if (!job.engineJobId || job.enginePort !== eng.port) {
    const created = await engineJson(eng, '/jobs', { method: 'POST', body: JSON.stringify({
      requestId: job.id, url: job.url, mode: job.mode, quality: job.quality, adult: job.adult }) });
    if (!created.id) throw new Error('O Motor respondeu sem identificar o download. Atualize o Motor.');
    await update(job, { engineJobId: created.id, enginePort: eng.port, state: 'preparing', phase: created.state === 'queued' ? 'queued' : 'preparing' });
  }
  let remote;
  try { remote = await engineJson(eng, `/jobs/${encodeURIComponent(job.engineJobId)}`); }
  catch (error) {
    if (error.status === 404 && (job.engineRestarts || 0) < 2) {
      await update(job, { engineJobId: null, engineRestarts: (job.engineRestarts || 0) + 1, phase: 'reconnecting' }); return;
    }
    throw error;
  }
  job.transportErrors = 0;
  if (remote.state === 'error') { await fail(job, remote.error || 'Não foi possível preparar este vídeo.'); return; }
  if (remote.state !== 'ready') {
    const phase = remote.state === 'queued' ? 'queued' : 'preparing';
    if (job.phase !== phase) await update(job, { state: 'preparing', phase });
    return;
  }
  if (!isMedia(remote.mime, remote.filename, remote.size)) { await fail(job, 'INVALID_MEDIA'); return; }
  const fileUrl = `http://127.0.0.1:${eng.port}/jobs/${encodeURIComponent(job.engineJobId)}/file?t=${encodeURIComponent(eng.token)}`;
  const check = await tfetch(fileUrl, 12000, { method: 'HEAD' });
  if (!check.ok || !isMedia(check.headers.get('content-type'), remote.filename, check.headers.get('content-length'))) {
    if (check.status === 401) throw new Error('SERVER_UNAUTHORIZED');
    await fail(job, 'INVALID_MEDIA'); return;
  }
  await update(job, { filename: remote.filename });
  await startBrowserDownload(job, fileUrl, remote.filename);
}
async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    await loadJobs();
    const running = jobs.filter(job => !terminal(job.state));
    // Two engine requests concurrently; saving files does not occupy a slot.
    const downloading = running.filter(j => j.downloadId != null);
    const preparing = running.filter(j => j.downloadId == null).slice(0, 2);
    await Promise.all([...downloading, ...preparing].map(async job => {
      try { await advance(job); }
      catch (error) {
        job.transportErrors = (job.transportErrors || 0) + 1;
        const permanentResponse = error.status >= 400 && error.status < 500 && ![401, 408, 429].includes(error.status);
        // Allow a restarting Windows service time to return, with a finite
        // recovery window. Invalid input/removed jobs fail without retries.
        if (job.transportErrors <= 6 && !permanentResponse && !/INVALID_MEDIA/.test(errorCode(error))) {
          await update(job, { phase: 'reconnecting', nextAttemptAt: Date.now() + Math.min(10000, 2500 * job.transportErrors) });
        } else await fail(job, error);
      }
    }));
  } finally {
    ticking = false;
    if (jobs?.some(j => !terminal(j.state))) wake(1500);
  }
}
chrome.downloads.onChanged.addListener(() => wake());
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === KEEPALIVE_ALARM) wake(); });
chrome.runtime.onInstalled.addListener(() => { ensureKeepalive(); wake(); });
chrome.runtime.onStartup.addListener(() => { ensureKeepalive(); wake(); });
ensureKeepalive();
wake();
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return;
  let operation;
  if (msg.type === 'darko-bridge-health') operation = Promise.resolve({ ok: true, version: chrome.runtime.getManifest().version });
  if (msg.type === 'darko-enqueue' || msg.type === 'darko-download') operation = enqueue(msg, sender).then(job => ({ ok: true, accepted: true, jobId: job.id, job: publicJob(job) }));
  if (msg.type === 'darko-jobs') operation = loadJobs().then(list => ({ ok: true, jobs: list.map(publicJob) }));
  if (msg.type === 'darko-job') operation = loadJobs().then(list => ({ ok: true, job: list.find(j => j.id === msg.jobId) ? publicJob(list.find(j => j.id === msg.jobId)) : null }));
  if (msg.type === 'darko-clear-jobs') operation = loadJobs().then(async () => { jobs = jobs.filter(j => !terminal(j.state)); await persist(); return { ok: true }; });
  if (msg.type === 'darko-ping-engine' || msg.type === 'darko-force-rediscover') operation = pingEngine(msg.type === 'darko-force-rediscover');
  if (msg.type === 'darko-ig-resolve') operation = resolveInstagram(msg.url).then(url => ({ ok: !!url, url }));
  if (operation) {
    operation.then(sendResponse).catch(error => sendResponse({ ok: false, error: humanError(error) }));
    return true;
  }
});
// Existing Auto Cortes streaming protocol is preserved below.
const FETCH_RAW_CHUNK = 8 * 1024 * 1024; // 8 MB crus -> ~10,7 MB base64
const FETCH_IDLE_MS = 90000; // 90 s sem bytes = conexão morta
const FETCH_ABSOLUTE_MS = 45 * 60 * 1000; // teto duro por pedido
const FETCH_ACK_MS = 120000; // ack do content script (aba ocupada gravando)
// O Motor roda o yt-dlp INTEIRO antes de escrever o 1º byte da resposta
// (server.cjs: `await processDownload(...)` e só então res.writeHead). Num
// podcast de 2 h isso passa de 90 s fácil — por isso o cabeçalho do Motor
// tem prazo próprio e a página recebe pulsos pra não achar que morreu.
const FETCH_ENGINE_HEADERS_MS = 40 * 60 * 1000;

/** Pedidos vivos: reqId -> estado (permite abortar de fora). */
const activeFetches = new Map();

function b64FromBytes(bytes) {
  let binary = '';
  const STEP = 0x8000;
  for (let i = 0; i < bytes.length; i += STEP) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + STEP));
  }
  return btoa(binary);
}

/** chrome.tabs.sendMessage em Promise — resolve no ACK do content script. */
function sendToTab(tabId, msg) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(arg);
    };
    const timer = setTimeout(
      () => done(reject, new Error('a aba não confirmou o recebimento')),
      FETCH_ACK_MS,
    );
    try {
      chrome.tabs.sendMessage(tabId, msg, () => {
        const err = chrome.runtime.lastError;
        if (!err) return done(resolve, undefined);
        const m = String(err.message || '');
        // "message port closed" = entregou mas ninguém respondeu (bridge
        // antigo). Não é motivo pra derrubar o download.
        if (/message port closed/i.test(m)) return done(resolve, undefined);
        done(reject, new Error(m || 'aba não respondeu'));
      });
    } catch (e) {
      done(reject, e instanceof Error ? e : new Error(String(e)));
    }
  });
}

/** Nome do arquivo pelo content-disposition; senão pelo caminho da URL. */
function filenameFromResponse(res, url, fallback) {
  const cd = res.headers.get('content-disposition') || '';
  let m = cd.match(/filename\*=UTF-8''([^;]+)/i);
  if (m) {
    try {
      return decodeURIComponent(m[1]).trim();
    } catch {
      /* segue pro filename simples */
    }
  }
  m = cd.match(/filename="([^"]+)"/i) || cd.match(/filename=([^;]+)/i);
  if (m) return m[1].trim();
  try {
    const p = new URL(url).pathname.split('/').filter(Boolean).pop();
    if (p && /\.[a-z0-9]{2,5}$/i.test(p)) return decodeURIComponent(p);
  } catch {
    /* ignora */
  }
  return fallback || 'video.mp4';
}

/** Extrai o ID do arquivo do Drive de uma URL/ID cru (mesma regra da lib). */
function driveFileIdFrom(input) {
  const s = String(input || '');
  if (/^[a-zA-Z0-9_-]{20,60}$/.test(s)) return s;
  const pats = [
    /\/file\/d\/([a-zA-Z0-9_-]{20,60})/,
    /[?&]id=([a-zA-Z0-9_-]{20,60})/,
    /\/d\/([a-zA-Z0-9_-]{20,60})/,
  ];
  for (const re of pats) {
    const m = s.match(re);
    if (m) return m[1];
  }
  return null;
}

/**
 * Baixa UMA url em stream e emite os chunks pra aba.
 * Retorna { done: true, size } | { err, confirm?, uuid? }.
 * Nunca lança — erro vira { err }.
 */
async function darkoFetchStream(ctx, url, opts) {
  const { tabId, reqId, state } = ctx;
  const controller = new AbortController();
  state.controller = controller;
  let idle = null;
  let pulse = null;
  const armIdle = (ms) => {
    clearTimeout(idle);
    idle = setTimeout(() => {
      state.idleAbort = true;
      try {
        controller.abort();
      } catch {
        /* ignora */
      }
    }, ms || FETCH_IDLE_MS);
  };
  const stopTimers = () => {
    clearTimeout(idle);
    if (pulse) clearInterval(pulse);
    pulse = null;
  };
  try {
    // Enquanto o Motor prepara o arquivo não chega byte nenhum: manda pulso
    // pra página não estourar o watchdog dela.
    if (opts.pulse) {
      pulse = setInterval(() => {
        sendToTab(tabId, {
          type: 'darko-fetch-progress',
          reqId,
          received: state.received,
          total: state.total,
          phase: 'motor',
        }).catch(() => {
          /* aba sumiu — o próprio fetch cai depois */
        });
      }, 5000);
    }
    armIdle(opts.headersTimeoutMs);
    const r = await fetch(url, {
      method: 'GET',
      credentials: opts.credentials || 'omit',
      redirect: 'follow',
      signal: controller.signal,
    });
    if (pulse) {
      clearInterval(pulse);
      pulse = null;
    }
    armIdle();
    if (!r.ok) {
      stopTimers();
      return { err: `HTTP ${r.status}`, status: r.status };
    }
    if (!r.body) {
      stopTimers();
      return { err: 'resposta sem corpo' };
    }
    const total = parseInt(r.headers.get('content-length') || '0', 10) || null;
    state.total = total;
    const mime =
      (r.headers.get('content-type') || '').split(';')[0].trim() ||
      'application/octet-stream';
    const filename = filenameFromResponse(r, url, opts.fallbackName);

    const reader = r.body.getReader();
    let pending = [];
    let pendingLen = 0;
    let sniffed = !opts.sniffHtml;
    let htmlMode = false;
    let htmlParts = [];
    let lastProgressAt = 0;

    const sendMeta = async () => {
      if (state.metaSent) return;
      state.metaSent = true;
      await sendToTab(tabId, {
        type: 'darko-fetch-meta',
        reqId,
        filename,
        size: total,
        mime,
      });
    };

    const flush = async (force) => {
      while (pendingLen >= FETCH_RAW_CHUNK || (force && pendingLen > 0)) {
        const take = Math.min(FETCH_RAW_CHUNK, pendingLen);
        const out = new Uint8Array(take);
        let off = 0;
        while (off < take) {
          const head = pending[0];
          const need = take - off;
          if (head.length <= need) {
            out.set(head, off);
            off += head.length;
            pending.shift();
          } else {
            out.set(head.subarray(0, need), off);
            pending[0] = head.subarray(need);
            off += need;
          }
        }
        pendingLen -= take;
        await sendToTab(tabId, {
          type: 'darko-fetch-chunk',
          reqId,
          idx: state.sentChunks,
          b64: b64FromBytes(out),
        });
        state.sentChunks++;
        armIdle(); // ack conta como sinal de vida
      }
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      armIdle();
      state.received += value.length;
      pending.push(value);
      pendingLen += value.length;

      if (!sniffed) {
        if (pendingLen < 3000) continue;
        const headBytes = new Uint8Array(3000);
        let o = 0;
        for (const p of pending) {
          const n = Math.min(p.length, 3000 - o);
          headBytes.set(p.subarray(0, n), o);
          o += n;
          if (o >= 3000) break;
        }
        sniffed = true;
        htmlMode = /<html|<!DOCTYPE/i.test(new TextDecoder().decode(headBytes));
        if (!htmlMode) await sendMeta();
      }
      if (htmlMode) {
        // página de confirm/erro é pequena — guarda inteira pra parsear
        htmlParts = htmlParts.concat(pending);
        pending = [];
        pendingLen = 0;
        continue;
      }
      await flush(false);
      const now = Date.now();
      if (now - lastProgressAt > 700) {
        lastProgressAt = now;
        await sendToTab(tabId, {
          type: 'darko-fetch-progress',
          reqId,
          received: state.received,
          total,
          phase: 'baixando',
        });
        armIdle();
      }
    }

    if (!sniffed) {
      // arquivo menor que 3000 bytes — sniffa o que veio
      const all = new Uint8Array(pendingLen);
      let o = 0;
      for (const p of pending) {
        all.set(p, o);
        o += p.length;
      }
      sniffed = true;
      if (/<html|<!DOCTYPE/i.test(new TextDecoder().decode(all))) {
        htmlMode = true;
        htmlParts = [all];
        pending = [];
        pendingLen = 0;
      }
    }

    if (htmlMode) {
      stopTimers();
      let len = 0;
      for (const p of htmlParts) len += p.length;
      const htmlAll = new Uint8Array(len);
      let o = 0;
      for (const p of htmlParts) {
        htmlAll.set(p, o);
        o += p.length;
      }
      const allText = new TextDecoder().decode(htmlAll);
      const confirmMatch = allText.match(/confirm=([0-9A-Za-z_-]+)/);
      const uuidMatch = allText.match(/uuid=([0-9a-f-]+)/);
      const formAction = allText.match(/action="([^"]+download[^"]*)"/);
      if (confirmMatch || uuidMatch || formAction) {
        return {
          err: 'needs_confirm',
          confirm: confirmMatch ? confirmMatch[1] : undefined,
          uuid: uuidMatch ? uuidMatch[1] : undefined,
        };
      }
      if (/sign in|signin|accounts\.google/i.test(allText.slice(0, 3000))) {
        return { err: 'login (arquivo privado OU você não está logado no Google)' };
      }
      return { err: 'o link devolveu uma página, não um arquivo (sem permissão?)' };
    }

    if (!state.metaSent) await sendMeta();
    await flush(true);
    stopTimers();
    await sendToTab(tabId, {
      type: 'darko-fetch-progress',
      reqId,
      received: state.received,
      total,
      phase: 'baixando',
    });
    return { done: true, size: state.received };
  } catch (e) {
    stopTimers();
    const aborted = e && e.name === 'AbortError';
    if (aborted && state.canceled) return { err: 'cancelado' };
    if (aborted && state.idleAbort) {
      state.idleAbort = false;
      return { err: 'inatividade 90s (a conexão parou de mandar bytes)' };
    }
    if (aborted) return { err: 'tempo esgotado' };
    return { err: 'falha de rede: ' + ((e && e.message) || e) };
  }
}

/** Motor local: pareia (token fresco) e faz stream do /get. */
async function darkoFetchEngine(ctx, msg) {
  const cfg = await getCfg();
  let eng = await discoverEngine(cfg.port || 47923);
  if (!eng) {
    return {
      err: 'O Motor não está aberto neste computador. Abra o Auto Edit Downloader pelo menu Iniciar e tente de novo.',
    };
  }
  const build = (token, port) =>
    `http://127.0.0.1:${port}/get?` +
    new URLSearchParams({
      t: token,
      url: msg.url,
      mode: msg.mode || 'video',
      quality: msg.quality || '1080',
    }).toString();
  const opts = {
    credentials: 'omit',
    sniffHtml: false,
    pulse: true,
    headersTimeoutMs: FETCH_ENGINE_HEADERS_MS,
    fallbackName: 'video.mp4',
  };
  let r = await darkoFetchStream(ctx, build(eng.token, eng.port), opts);
  // Token defasado (Motor reiniciou): re-pareia UMA vez — só se ainda não
  // saiu byte nenhum, senão misturaria dois downloads no mesmo reqId.
  if (!r.done && r.status === 401 && ctx.state.sentChunks === 0) {
    try {
      await chrome.storage.local.set({ token: '' });
    } catch {
      /* segue */
    }
    eng = await discoverEngine(cfg.port || 47923);
    if (eng) r = await darkoFetchStream(ctx, build(eng.token, eng.port), opts);
  }
  return r;
}

/**
 * Google Drive pela sessão logada. Cadeia de URLs portada do
 * extension/background.js `handleDownloadDrive` (extensão do HeyGen):
 * uc → uc+confirm/uuid → usercontent → usercontent+confirm → uc&confirm=t
 * → u/0/uc. Se uma estratégia JÁ emitiu chunks e caiu, NÃO tenta a próxima
 * (a página teria pedaços de dois downloads no mesmo reqId).
 */
async function darkoFetchDrive(ctx, msg) {
  const fileId = driveFileIdFrom(msg.url);
  if (!fileId) return { err: 'não achei o ID do arquivo nesse link do Drive' };
  const st = ctx.state;
  const errors = [];
  const opts = {
    credentials: 'include',
    sniffHtml: true,
    pulse: false,
    headersTimeoutMs: FETCH_IDLE_MS,
    fallbackName: 'drive.mp4',
  };
  const run = (u) => darkoFetchStream(ctx, u, opts);

  let final = await run(`https://drive.google.com/uc?export=download&id=${fileId}`);
  if (!final.done && final.err === 'needs_confirm' && st.sentChunks === 0 && (final.confirm || final.uuid)) {
    errors.push('uc: pede confirmação');
    const params = new URLSearchParams({ id: fileId, export: 'download' });
    if (final.confirm) params.set('confirm', final.confirm);
    if (final.uuid) params.set('uuid', final.uuid);
    final = await run(`https://drive.google.com/uc?${params}`);
    if (!final.done) errors.push(`uc+confirm: ${final.err}`);
  } else if (!final.done) {
    errors.push(`uc: ${final.err}`);
  }
  if (!final.done && st.sentChunks === 0) {
    final = await run(
      `https://drive.usercontent.google.com/download?id=${fileId}&export=download&authuser=0&confirm=t`,
    );
    if (!final.done && final.err === 'needs_confirm' && st.sentChunks === 0 && (final.confirm || final.uuid)) {
      const params = new URLSearchParams({ id: fileId, export: 'download', authuser: '0' });
      if (final.confirm) params.set('confirm', final.confirm);
      if (final.uuid) params.set('uuid', final.uuid);
      final = await run(`https://drive.usercontent.google.com/download?${params}`);
      if (!final.done) errors.push(`usercontent+confirm: ${final.err}`);
    } else if (!final.done) {
      errors.push(`usercontent: ${final.err}`);
    }
  }
  if (!final.done && st.sentChunks === 0) {
    final = await run(`https://drive.google.com/uc?export=download&id=${fileId}&confirm=t`);
    if (!final.done) errors.push(`uc+confirm=t: ${final.err}`);
  }
  if (!final.done && st.sentChunks === 0) {
    final = await run(`https://drive.google.com/u/0/uc?id=${fileId}&export=download&confirm=t`);
    if (!final.done) errors.push(`u/0/uc: ${final.err}`);
  }
  if (!final.done) {
    const parcial =
      st.sentChunks > 0
        ? `A conexão com o Drive caiu no meio do download (${st.sentChunks} pedaços recebidos). Tente de novo. `
        : 'Não consegui baixar do Drive. Confira se você está logado no Google e se tem acesso ao arquivo. ';
    return { err: parcial + (errors.length ? 'Detalhes: ' + errors.join(' | ') : '') };
  }
  return final;
}

async function handleDarkoFetch(msg, tabId) {
  const reqId = String(msg.reqId || '');
  const state = {
    sentChunks: 0,
    received: 0,
    total: null,
    metaSent: false,
    canceled: false,
    idleAbort: false,
    controller: null,
  };
  activeFetches.set(reqId, state);
  const ctx = { tabId, reqId, state };
  const absolute = setTimeout(() => {
    state.canceled = true;
    try {
      if (state.controller) state.controller.abort();
    } catch {
      /* ignora */
    }
  }, FETCH_ABSOLUTE_MS);
  try {
    const r =
      msg.kind === 'drive'
        ? await darkoFetchDrive(ctx, msg)
        : await darkoFetchEngine(ctx, msg);
    if (r && r.done) {
      await sendToTab(tabId, {
        type: 'darko-fetch-done',
        reqId,
        total: r.size,
        chunks: state.sentChunks,
      }).catch(() => {});
    } else {
      await sendToTab(tabId, {
        type: 'darko-fetch-error',
        reqId,
        error: String((r && r.err) || 'falhou'),
      }).catch(() => {});
    }
  } catch (e) {
    try {
      await sendToTab(tabId, {
        type: 'darko-fetch-error',
        reqId,
        error: String((e && e.message) || e),
      });
    } catch {
      /* aba foi embora */
    }
  } finally {
    clearTimeout(absolute);
    activeFetches.delete(reqId);
  }
}

// Listener SEPARADO do antigo de propósito: o MV3 entrega a mensagem pra
// todos os listeners e a porta fica aberta se QUALQUER um devolver true.
// Assim o fluxo velho (darko-download / darko-ping-engine / ...) não muda
// uma vírgula.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'darko-fetch') {
    const tabId = sender && sender.tab && sender.tab.id;
    if (!tabId) {
      sendResponse({ ok: false, error: 'sem aba de origem' });
      return true;
    }
    ensureKeepalive();
    // Responde JÁ (o pedido é longo; o resultado vai por tabs.sendMessage).
    sendResponse({ ok: true, started: true });
    handleDarkoFetch(msg, tabId);
    return true;
  }
  if (msg && msg.type === 'darko-fetch-abort') {
    const st = activeFetches.get(String(msg.reqId || ''));
    if (st) {
      st.canceled = true;
      try {
        if (st.controller) st.controller.abort();
      } catch {
        /* ignora */
      }
    }
    sendResponse({ ok: true, found: !!st });
    return true;
  }
});
