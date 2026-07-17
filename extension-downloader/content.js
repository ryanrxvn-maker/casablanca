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
  // Marca que o download REALMENTE comecou: o background so emite
  // 'darko-dl-progress' depois de chamar chrome.downloads.download. Sem
  // isso nao afirmamos "iniciou" (era a mentira do toast otimista).
  let gotProgress = false;

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
        gotProgress = true;
        setProgress(100);
        setTimeout(clearProgress, 1200);
      } else if (m.state === 'interrupted') {
        clearProgress();
      } else {
        gotProgress = true; // download registrou de verdade
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

  // ── Instagram: baixa DENTRO da sessão logada ─────────────────────
  // Desde 2026 o Instagram não serve mais mídia pra acesso anônimo
  // (headless do motor e yt-dlp sem cookies recebem "empty media
  // response"). O caminho confiável é a própria aba logada do usuário:
  // media_id da página → API interna do IG (mesma sessão) →
  // video_versions (mp4 progressivo COM áudio) → baixa do CDN aqui
  // mesmo, com progresso no anel. Se qualquer passo falhar, cai no
  // fluxo antigo pelo motor — nada do que funciona muda.
  const IG_APP_ID = '936619743392459'; // app id oficial do web client

  function igShortcode() {
    const m = location.pathname.match(/\/(?:reel|reels|p|tv)\/([\w-]+)/);
    return m ? m[1] : null;
  }

  async function resolveInstagramMp4() {
    const tmo = (ms) =>
      typeof AbortSignal !== 'undefined' && AbortSignal.timeout
        ? AbortSignal.timeout(ms)
        : undefined;
    // HTML fresco do permalink (server-render logado) → media_id do post.
    // al:ios:url aponta SEMPRE pro post principal; "media_id" é fallback.
    const html = await fetch(location.href, {
      credentials: 'include',
      signal: tmo(20000),
    }).then((r) => r.text());
    const mid =
      (html.match(/instagram:\/\/media\?id=(\d+)/) || [])[1] ||
      (html.match(/"media_id":"(\d+)"/) || [])[1];
    if (!mid) return null;
    const r = await fetch(`${location.origin}/api/v1/media/${mid}/info/`, {
      credentials: 'include',
      headers: { 'x-ig-app-id': IG_APP_ID },
      signal: tmo(20000),
    });
    if (!r.ok) return null;
    const item = (((await r.json()) || {}).items || [])[0];
    const best = (it) =>
      it && it.video_versions && it.video_versions.length
        ? [...it.video_versions].sort(
            (a, b) => (b.width || 0) - (a.width || 0),
          )[0].url
        : null;
    let url = best(item);
    if (!url && item && item.carousel_media) {
      for (const cm of item.carousel_media) {
        url = best(cm);
        if (url) break;
      }
    }
    return url || null;
  }

  async function instagramDirectDownload() {
    try {
      const url = await resolveInstagramMp4();
      if (!url) return false;
      const resp = await fetch(url);
      if (!resp.ok || !resp.body) return false;
      const total = Number(resp.headers.get('content-length')) || 0;
      const reader = resp.body.getReader();
      const chunks = [];
      let recv = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        recv += value.byteLength;
        setProgress(
          total > 0 ? Math.min(99, Math.floor((recv / total) * 100)) : -1,
        );
      }
      if (recv < 80_000) return false; // lixo/erro — deixa o motor tentar
      const blob = new Blob(chunks, { type: 'video/mp4' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `instagram-${igShortcode() || Date.now()}.mp4`;
      document.documentElement.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
      setProgress(100);
      setTimeout(clearProgress, 1200);
      setBtn('ok');
      toast('Download iniciado!', 'ok');
      return true;
    } catch {
      return false;
    }
  }

  async function onClick() {
    const t = videoTarget();
    if (!t) {
      toast('Abra um vídeo para baixar.', 'err');
      return;
    }
    if (!t.adult && /(^|\.)instagram\.com$/.test(host)) {
      setBtn('loading');
      setProgress(-1);
      toast('Enviando…', '');
      if (await instagramDirectDownload()) return;
      clearProgress(); // falhou o caminho direto → segue pelo motor
    }
    setBtn('loading');
    setProgress(-1); // anel indeterminado ate chegar % real
    toast('Enviando…', '');
    gotProgress = false;
    let done = false;
    // Fallback de UI: o background so responde quando o download TERMINA
    // (pode levar minutos), entao damos feedback antes. Mas so afirmamos
    // "iniciou" se recebemos progresso REAL — se nada chegou, o motor
    // provavelmente esta fora e o texto e honesto (nao mente mais).
    const timeout = setTimeout(() => {
      if (done) return;
      done = true;
      if (gotProgress) {
        setBtn('ok');
        toast('Baixando… veja a barra de downloads.', 'ok');
      } else {
        setBtn('idle');
        toast(
          'Ainda processando… se não baixar, clique em ↻ na extensão.',
          '',
        );
      }
    }, 6000);
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
