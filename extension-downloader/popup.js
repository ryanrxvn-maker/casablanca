'use strict';
const $ = id => document.getElementById(id);
const { terminal, normalizeUrl, humanError, newerVersion } = DownloaderUtils;
const state = { mode: 'video', quality: '1080', adult: false };
const VERSION = chrome.runtime.getManifest().version;
let refreshing = false;
let pendingAdd = false;
let latestJobs = [];
let minimumEngineVersion = null;
$('version').textContent = `Extensão ${VERSION}`;
function message(data, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('A extensão demorou para responder. Feche e reabra esta janela.')), timeoutMs);
    try { chrome.runtime.sendMessage(data, response => {
      clearTimeout(timeout);
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message)); else resolve(response);
    }); } catch (error) { clearTimeout(timeout); reject(error); }
  });
}
function inputError(value) { $('inputError').textContent = value || ''; $('inputError').classList.toggle('hidden', !value); }
async function refresh(force = false) {
  if (refreshing) return;
  refreshing = true;
  $('hardRefresh').classList.add('spin');
  try {
    const response = await message({ type: force ? 'darko-force-rediscover' : 'darko-ping-engine' });
    const compatible = !!response?.connected && !!response?.engineCompatible &&
      !!response?.engineVersion && (!minimumEngineVersion || !newerVersion(minimumEngineVersion, response.engineVersion));
    $('engineDot').className = 'dot' + (compatible ? ' on' : '');
    $('engineLabel').textContent = compatible ? 'Conectado' : response?.connected ? 'Atualizar Motor' : 'Sem Motor';
    $('noEngine').classList.toggle('hidden', compatible);
    $('engineTitle').textContent = response?.connected ? 'Seu Motor precisa de uma atualização' : 'Abra o Motor para conectar';
    $('engineHelp').textContent = response?.connected
      ? 'A nova versão prepara e verifica os arquivos antes de salvar. Atualize uma vez para continuar.'
      : 'Abra Auto Edit Downloader no menu Iniciar. A conexão será refeita automaticamente.';
    $('engineSetup').textContent = response?.connected ? 'Atualizar Motor ↗' : 'Instalar ou abrir Motor ↗';
  } catch {
    $('engineLabel').textContent = 'Reconectar';
    $('engineDot').className = 'dot';
    $('noEngine').classList.remove('hidden');
  } finally { refreshing = false; $('hardRefresh').classList.remove('spin'); }
}
$('hardRefresh').addEventListener('click', () => refresh(true));
function updateOptions() {
  for (const [id, key] of [['modes', 'mode'], ['quals', 'quality']]) {
    for (const button of $(id).querySelectorAll('button')) {
      const selected = button.dataset.v === state[key];
      button.classList.toggle('on', selected); button.setAttribute('aria-pressed', String(selected));
      if (id === 'quals') button.disabled = state.mode !== 'video';
    }
  }
  $('audioHint').classList.toggle('hidden', state.mode === 'video');
  $('adultBtn').classList.toggle('on', state.adult);
  $('adultBtn').setAttribute('aria-pressed', String(state.adult));
}
for (const [id, key] of [['modes', 'mode'], ['quals', 'quality']]) {
  $(id).addEventListener('click', event => {
    const button = event.target.closest('button'); if (!button || button.disabled) return;
    state[key] = button.dataset.v; updateOptions(); chrome.storage.local.set({ downloaderPreferences: state });
  });
}
$('adultBtn').addEventListener('click', () => { state.adult = !state.adult; updateOptions(); chrome.storage.local.set({ downloaderPreferences: state }); });
function countLinks() {
  const count = $('urls').value.trim().split(/\s+/).filter(Boolean).length;
  $('linkCount').textContent = count ? `${count} ${count === 1 ? 'link' : 'links'}` : '01 — Links';
  $('goLabel').textContent = count > 1 ? `Baixar ${count} arquivos` : 'Baixar arquivo';
}
let draftTimer;
$('urls').addEventListener('input', () => {
  inputError(''); countLinks(); clearTimeout(draftTimer);
  draftTimer = setTimeout(() => chrome.storage.local.set({ downloaderDraft: $('urls').value }), 200);
});
const phases = { queued: 'Na fila', resolving: 'Localizando vídeo', preparing: 'Baixando da fonte', reconnecting: 'Reconectando', retrying: 'Tentando novamente', saving: 'Salvando arquivo', complete: 'Salvo', error: 'Não concluído' };
function element(tag, className, text) { const node = document.createElement(tag); node.className = className; if (text) node.textContent = text; return node; }
function renderJobs(list) {
  latestJobs = list;
  $('jobs').replaceChildren();
  $('jobCount').textContent = String(list.length);
  $('emptyState').classList.toggle('hidden', list.length > 0);
  $('clearJobs').classList.toggle('hidden', !list.some(job => terminal(job.state)));
  for (const job of list.slice().reverse()) {
    const row = element('article', `job ${job.state}`);
    const head = element('div', 'job-head');
    let host = ''; try { host = new URL(job.url).hostname.replace(/^www\./, ''); } catch {}
    head.append(element('span', 'job-title', job.filename || host || 'Vídeo'));
    const label = job.state === 'canceled' ? 'Cancelado' : job.pct >= 0 && job.state === 'downloading' ? `${job.pct}% · salvando` : phases[job.phase] || 'Na fila';
    head.append(element('span', 'job-state', label));
    row.append(head, element('div', 'job-url', job.url));
    if (!terminal(job.state)) {
      const bar = element('div', `progress${job.pct >= 0 ? ' known' : ''}`);
      bar.style.setProperty('--progress', `${job.pct}%`); bar.append(element('i', '')); row.append(bar);
    }
    if (job.error) row.append(element('p', 'job-detail', humanError(job.error)));
    if (['error', 'canceled'].includes(job.state)) {
      const actions = element('div', 'job-actions');
      const retry = element('button', '', 'Tentar novamente'); retry.type = 'button';
      retry.addEventListener('click', async () => {
        retry.disabled = true;
        try { const result = await message({ type: 'darko-enqueue', ...job, reqId: crypto.randomUUID() }); if (!result?.ok) throw new Error(result?.error); await refreshJobs(); }
        catch (error) { inputError(humanError(error)); } finally { retry.disabled = false; }
      });
      actions.append(retry); row.append(actions);
    }
    if (job.state === 'complete' && Number.isInteger(job.downloadId)) {
      const actions = element('div', 'job-actions');
      const show = element('button', '', 'Mostrar na pasta'); show.type = 'button';
      show.addEventListener('click', () => chrome.downloads.show(job.downloadId)); actions.append(show); row.append(actions);
    }
    $('jobs').append(row);
  }
}
async function refreshJobs() { try { const response = await message({ type: 'darko-jobs' }); if (response?.jobs) renderJobs(response.jobs); } catch {} }
$('clearJobs').addEventListener('click', async () => { await message({ type: 'darko-clear-jobs' }); await refreshJobs(); });
$('go').addEventListener('click', async () => {
  if (pendingAdd) return;
  inputError('');
  const lines = $('urls').value.trim().split(/\s+/).filter(Boolean);
  if (!lines.length) { inputError('Cole pelo menos um link para baixar.'); $('urls').focus(); return; }
  let urls;
  try { urls = [...new Set(lines.map(normalizeUrl))]; } catch { inputError('Um dos links não é válido. Use o endereço completo, começando com https://.'); return; }
  if (urls.length > 30) { inputError('Adicione até 30 links de cada vez.'); return; }
  pendingAdd = true; $('go').disabled = true; $('goLabel').textContent = 'Adicionando à fila…';
  try {
    for (const url of urls) {
      const response = await message({ type: 'darko-enqueue', url, ...state, reqId: crypto.randomUUID() });
      if (!response?.ok) throw new Error(response?.error || 'Não foi possível adicionar o link.');
    }
    $('urls').value = ''; await chrome.storage.local.set({ downloaderDraft: '' }); await refreshJobs();
  } catch (error) { inputError(humanError(error)); }
  finally { pendingAdd = false; $('go').disabled = false; countLinks(); }
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.downloadJobsV2) renderJobs(changes.downloadJobsV2.newValue || []);
});
(async () => {
  const saved = await chrome.storage.local.get(['downloaderPreferences', 'downloaderDraft']);
  if (saved.downloaderPreferences) Object.assign(state, saved.downloaderPreferences);
  $('urls').value = saved.downloaderDraft || ''; updateOptions(); countLinks();
  await Promise.all([refresh(), refreshJobs()]);
})();
setInterval(refresh, 10000);
fetch('https://www.darkoautoedit.com/api/downloader-extension/version', { cache: 'no-store', signal: AbortSignal.timeout(8000) })
  .then(response => response.ok ? response.json() : null).then(release => {
    if (!release) return;
    minimumEngineVersion = release.minimumEngineVersion || release.engineVersion || null;
    if (newerVersion(release.version || release.latestVersion, VERSION)) $('updateBox').classList.remove('hidden');
    void refresh();
  }).catch(() => {});
