// Injeta um botão flutuante "Baixar" nas páginas de vídeo do YouTube,
// TikTok e Instagram. Clicou -> manda a URL atual pro motor (via
// background) -> baixa. Sem copiar link.
(function () {
  'use strict';
  if (window.__darkoDlInjected) return;
  window.__darkoDlInjected = true;

  const host = location.hostname;
  const ADULT_BASES = [
    'pornhub.com',
    'xvideos.com',
    'xhamster.com',
    'xhamster.desi',
    'xhamster2.com',
    'redtube.com',
    'redtube.com.br',
    'youporn.com',
    'xvideosputaria.com',
    'buceteiro.com',
  ];
  const isHost = (b) => host === b || host.endsWith('.' + b);
  const isAdultHost = ADULT_BASES.some(isHost);

  // Página "de conteúdo" genérica (blogs/mirrors): qualquer rota com
  // slug que não seja home/listagem óbvia.
  function looksLikePost(p) {
    if (p === '/' || p.length < 2) return false;
    if (
      /^\/(category|categories|tag|tags|page|search|login|signup|register|assine|sobre|contato|terms|privacy|dmca|2257|c|s|amp)\b/i.test(
        p,
      )
    )
      return false;
    return /[a-z0-9]/i.test(p.replace(/\//g, ''));
  }

  // Retorna { url, adult } se a página for de vídeo, ou null.
  function videoTarget() {
    const u = new URL(location.href);
    const p = u.pathname;

    if (/(^|\.)youtube\.com$/.test(host) || host === 'youtu.be') {
      if (host === 'youtu.be' && p.length > 1) return { url: location.href, adult: false };
      if (p === '/watch' && u.searchParams.get('v')) return { url: location.href, adult: false };
      if (/^\/(shorts|live)\/[\w-]+/.test(p)) return { url: location.href, adult: false };
      return null;
    }
    if (/(^|\.)tiktok\.com$/.test(host)) {
      if (/\/(video|photo)\/\d+/.test(p)) return { url: location.href, adult: false };
      return null;
    }
    if (/(^|\.)instagram\.com$/.test(host)) {
      if (/^\/(reel|reels|p|tv)\/[\w-]+/.test(p)) return { url: location.href, adult: false };
      return null;
    }
    if (/(^|\.)pinterest\.[a-z.]+$/.test(host) || host === 'pin.it') {
      if (host === 'pin.it' && p.length > 1) return { url: location.href, adult: false };
      if (/^\/pin\/[\w-]+/.test(p)) return { url: location.href, adult: false };
      return null;
    }
    if (isAdultHost) {
      // tubes com padrão claro de página de vídeo
      if (isHost('pornhub.com') && !/view_video\.php|\/embed\//.test(u.href)) return null;
      if (isHost('xvideos.com') && !/\/video[.\d]/.test(p) && !/\/prof-video-click/.test(p)) return null;
      if (isHost('xhamster.com') || isHost('xhamster.desi') || isHost('xhamster2.com')) {
        if (!/^\/videos\//.test(p)) return null;
      }
      if (isHost('redtube.com') || isHost('redtube.com.br')) {
        if (!/^\/\d{3,}/.test(p)) return null;
      }
      if (isHost('youporn.com') && !/^\/watch\/\d+/.test(p)) return null;
      // mirrors BR (xvideosputaria/buceteiro): qualquer post
      if (
        (isHost('xvideosputaria.com') || isHost('buceteiro.com')) &&
        !looksLikePost(p)
      )
        return null;
      return { url: location.href, adult: true };
    }
    return null;
  }


  let btn, toastEl, currentJobId, pollTimer, buttonStateTimer;
  const DOWNLOAD_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M5 17v4h14v-4"/></svg>';
  const CHECK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m5 12.5 4.2 4.2L19 7"/></svg>';
  const ERROR_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 7v6m0 4h.01"/></svg>';
  function ensureButton() {
    if (btn) return btn;
    btn = document.createElement('button');
    btn.id = 'darko-dl-btn'; btn.type = 'button'; btn.dataset.state = 'idle';
    btn.title = 'Baixar este vídeo com Auto Edit';
    btn.setAttribute('aria-label', 'Baixar este vídeo com Auto Edit');
    btn.innerHTML = `<span class="d-orbit" aria-hidden="true"></span><span class="d-core" aria-hidden="true"><span class="d-icon d-download">${DOWNLOAD_SVG}</span><span class="d-icon d-success">${CHECK_SVG}</span><span class="d-icon d-error">${ERROR_SVG}</span></span>`;
    btn.addEventListener('click', onClick);
    document.documentElement.appendChild(btn);
    return btn;
  }
  function setButton(state, label, pct = -1) {
    ensureButton();
    clearTimeout(buttonStateTimer);
    btn.dataset.state = state;
    btn.disabled = state === 'loading';
    btn.setAttribute('aria-busy', String(state === 'loading'));
    btn.setAttribute('aria-label', label + ' com Auto Edit');
    btn.title = label + ' · Auto Edit';
    btn.dataset.progress = pct >= 0 ? 'known' : 'unknown';
    btn.style.setProperty('--progress-angle', `${Math.max(0, pct) * 3.6}deg`);
    if (state === 'ok') {
      buttonStateTimer = setTimeout(() => {
        if (btn?.dataset.state === 'ok') setButton('idle', 'Baixar este vídeo');
      }, 5000);
    }
  }
  function toast(text, kind = '') {
    if (!toastEl) {
      toastEl = document.createElement('div'); toastEl.id = 'darko-dl-toast';
      toastEl.setAttribute('role', 'status'); toastEl.setAttribute('aria-live', 'polite');
      document.documentElement.appendChild(toastEl);
    }
    toastEl.textContent = text; toastEl.className = kind; toastEl.dataset.visible = 'true';
    clearTimeout(toastEl._timer);
    toastEl._timer = setTimeout(() => { toastEl.dataset.visible = 'false'; }, kind === 'err' ? 12000 : 5000);
  }
  function message(data) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('A extensão demorou para responder. Abra a extensão para conferir a fila.')), 12000);
      try { chrome.runtime.sendMessage(data, result => {
        clearTimeout(timer); const error = chrome.runtime.lastError;
        if (error) reject(new Error('A extensão foi atualizada. Recarregue esta página para continuar.'));
        else resolve(result);
      }); } catch { clearTimeout(timer); reject(new Error('Recarregue esta página para conectar a extensão atualizada.')); }
    });
  }
  const phaseLabels = { queued: 'Na fila', preparing: 'Baixando da fonte', resolving: 'Localizando', reconnecting: 'Reconectando', retrying: 'Tentando novamente', saving: 'Salvando' };
  function progress(job) {
    if (!job || (job.id !== currentJobId && job.jobId !== currentJobId)) return;
    if (job.state === 'complete') {
      clearInterval(pollTimer); currentJobId = null;
      setButton('ok', 'Arquivo salvo', 100);
      toast('Download concluído. O arquivo está na sua pasta de downloads.', 'ok');
    } else if (['error', 'canceled'].includes(job.state)) {
      clearInterval(pollTimer); currentJobId = null;
      setButton('err', 'Tentar novamente');
      toast(job.error || 'Não foi possível concluir este download.', 'err');
    } else {
      const label = job.pct >= 0 ? `Salvando · ${job.pct}%` : phaseLabels[job.phase] || 'Baixando da fonte';
      setButton('loading', label, job.pct);
    }
  }
  function follow(job) {
    currentJobId = job.id; progress(job); clearInterval(pollTimer);
    if (!currentJobId) return;
    pollTimer = setInterval(async () => {
      try { const response = await message({ type: 'darko-job', jobId: currentJobId }); if (response?.job) progress(response.job); }
      catch { /* Closing/restarting the worker does not lose the persistent job. */ }
    }, 2500);
  }
  try { chrome.runtime.onMessage.addListener(msg => { if (msg?.type === 'darko-dl-progress') progress(msg); }); } catch {}
  async function onClick() {
    const target = videoTarget(); if (!target || currentJobId) return;
    setButton('loading', 'Adicionando');
    try {
      const response = await message({ type: 'darko-enqueue', reqId: crypto.randomUUID(), url: target.url,
        mode: 'video', quality: '1080', adult: target.adult === true });
      if (!response?.ok) throw new Error(response?.error || 'Não foi possível adicionar este download.');
      follow(response.job);
      if (currentJobId) toast('Adicionado à fila. Você pode continuar navegando.');
    } catch (error) { setButton('err', 'Tentar novamente'); toast(error.message, 'err'); }
  }
  function normalizedUrl(input) {
    try { const url = new URL(input); if (url.hostname.endsWith('youtube.com') && url.searchParams.has('v')) return `https://www.youtube.com/watch?v=${url.searchParams.get('v')}`; url.hash = ''; return url.href; } catch { return input; }
  }
  async function refresh() {
    const target = videoTarget();
    if (!target) { if (btn) btn.style.display = 'none'; return; }
    ensureButton().style.display = 'flex';
    if (!currentJobId) {
      setButton('idle', 'Baixar este vídeo');
      try {
        const response = await message({ type: 'darko-jobs' });
        const existing = response?.jobs?.find(job => !['complete', 'error', 'canceled'].includes(job.state) && normalizedUrl(job.url) === normalizedUrl(target.url));
        if (existing) follow(existing);
      } catch { /* Only surface connection errors on an explicit click. */ }
    }
  }
  let last = location.href;
  setInterval(() => {
    if (location.href === last) return;
    const sameVideo = normalizedUrl(location.href) === normalizedUrl(last);
    last = location.href;
    // YouTube cleans playlist/radio tracking while a download is active.
    // Keep following that file when the actual video id has not changed.
    if (!sameVideo) { currentJobId = null; clearInterval(pollTimer); refresh(); }
  }, 1000);
  window.addEventListener('popstate', refresh);
  refresh();
})();
