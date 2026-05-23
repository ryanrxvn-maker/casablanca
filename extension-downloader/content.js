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

  let btn, toastEl;

  // SVG do ícone de download (seta pra baixo) — gradient violet
  const DOWNLOAD_SVG = `
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="dl-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#e9d5ff"/>
          <stop offset="50%" stop-color="#c084fc"/>
          <stop offset="100%" stop-color="#a78bfa"/>
        </linearGradient>
        <filter id="dl-glow">
          <feGaussianBlur stdDeviation="1.2"/>
        </filter>
      </defs>
      <path d="M12 3v13" stroke="url(#dl-grad)" stroke-width="2.4" stroke-linecap="round"/>
      <path d="M6 12l6 6 6-6" stroke="url(#dl-grad)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M4 21h16" stroke="url(#dl-grad)" stroke-width="2.4" stroke-linecap="round"/>
    </svg>
  `;

  function ensureButton() {
    if (btn) return btn;
    btn = document.createElement('button');
    btn.id = 'darko-dl-btn';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Baixar');
    btn.title = 'Baixar com Auto Edit';
    btn.dataset.state = 'idle';

    // Halo de fundo (glow pulsante)
    const halo = document.createElement('span');
    halo.className = 'd-halo';

    // Anel rotativo (idle)
    const ring = document.createElement('span');
    ring.className = 'd-ring';

    // Núcleo do botão (com ícone SVG dentro)
    const core = document.createElement('span');
    core.className = 'd-core';
    core.innerHTML = DOWNLOAD_SVG;

    // Anel de progresso (download em andamento)
    const prog = document.createElement('span');
    prog.className = 'd-prog';
    prog.style.setProperty('--p', '0');

    // Label percentual
    const pct = document.createElement('span');
    pct.className = 'd-pct';

    btn.appendChild(halo);
    btn.appendChild(ring);
    btn.appendChild(core);
    btn.appendChild(prog);
    btn.appendChild(pct);
    btn.addEventListener('click', onClick);
    document.documentElement.appendChild(btn);
    return btn;
  }

  function setProgress(p) {
    if (!btn) return;
    const prog = btn.querySelector('.d-prog');
    const lbl = btn.querySelector('.d-pct');
    if (!prog || !lbl) return;
    if (p < 0) {
      // tamanho desconhecido — anel indeterminado, sem %
      btn.dataset.prog = 'indet';
      lbl.textContent = '';
      prog.style.setProperty('--p', '0');
      return;
    }
    btn.dataset.prog = 'on';
    prog.style.setProperty('--p', String(p));
    lbl.textContent = p >= 100 ? '' : p + '%';
  }
  function clearProgress() {
    if (!btn) return;
    btn.dataset.prog = '';
    const lbl = btn.querySelector('.d-pct');
    if (lbl) lbl.textContent = '';
  }

  // Recebe progresso REAL do background (chrome.downloads): anel + %
  // mostram que o download disparou e quanto falta ate subir na barra.
  try {
    chrome.runtime.onMessage.addListener((m) => {
      if (!m || m.type !== 'darko-dl-progress') return;
      const pct = typeof m.pct === 'number' ? m.pct : -1;
      if (m.state === 'complete') {
        setProgress(100);
        setTimeout(clearProgress, 1200);
      } else if (m.state === 'interrupted') {
        clearProgress();
      } else {
        setProgress(pct);
      }
    });
  } catch {
    /* contexto invalido */
  }

  function toast(msg, kind) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.id = 'darko-dl-toast';
      document.documentElement.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.className = kind || '';
    toastEl.style.opacity = '1';
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(() => {
      toastEl.style.opacity = '0';
    }, 5000);
  }

  function setBtn(state) {
    if (!btn) return;
    btn.dataset.state = state;
    if (state === 'loading') {
      btn.title = 'Baixando…';
      btn.disabled = true;
    } else if (state === 'ok') {
      btn.title = 'Pronto!';
      btn.disabled = false;
      setTimeout(() => setBtn('idle'), 2600);
    } else if (state === 'err') {
      btn.title = 'Erro';
      btn.disabled = false;
      setTimeout(() => setBtn('idle'), 3000);
    } else {
      btn.title = 'Baixar';
      btn.disabled = false;
    }
  }

  function onClick() {
    const t = videoTarget();
    if (!t) {
      toast('Abra um vídeo para baixar.', 'err');
      return;
    }
    setBtn('loading');
    setProgress(-1); // anel indeterminado ate chegar % real
    toast('Enviando…', '');
    let done = false;
    const timeout = setTimeout(() => {
      if (done) return;
      done = true;
      setBtn('ok');
      toast('Download iniciado. Veja a barra de downloads.', 'ok');
    }, 4000);
    chrome.runtime.sendMessage(
      {
        type: 'darko-download',
        url: t.url,
        mode: 'video',
        quality: '1080',
        adult: t.adult === true,
      },
      (resp) => {
        if (done) return;
        done = true;
        clearTimeout(timeout);
        if (chrome.runtime.lastError) {
          setBtn('err');
          toast('Extensão não respondeu. Recarregue a página.', 'err');
          return;
        }
        if (resp && resp.ok) {
          setBtn('ok');
          toast('Download iniciado!', 'ok');
        } else {
          setBtn('err');
          toast((resp && resp.error) || 'Falha no download.', 'err');
        }
      },
    );
  }

  function refresh() {
    const isVideo = !!videoTarget();
    if (isVideo) {
      ensureButton().style.display = 'flex';
    } else if (btn) {
      btn.style.display = 'none';
    }
  }

  // SPA: YouTube/TikTok/Instagram trocam URL sem reload.
  const fire = () => setTimeout(refresh, 300);
  for (const m of ['pushState', 'replaceState']) {
    const orig = history[m];
    history[m] = function () {
      const r = orig.apply(this, arguments);
      window.dispatchEvent(new Event('darko-locchange'));
      return r;
    };
  }
  window.addEventListener('darko-locchange', fire);
  window.addEventListener('popstate', fire);
  let last = location.href;
  setInterval(() => {
    if (location.href !== last) {
      last = location.href;
      refresh();
    }
  }, 1000);

  refresh();
})();
