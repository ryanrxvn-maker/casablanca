// Injeta um botão flutuante "Baixar" nas páginas de vídeo do YouTube,
// TikTok e Instagram. Clicou -> manda a URL atual pro motor (via
// background) -> baixa. Sem copiar link.
(function () {
  'use strict';
  if (window.__darkoDlInjected) return;
  window.__darkoDlInjected = true;

  const host = location.hostname;

  // Retorna a URL do vídeo atual, ou null se a página não for de vídeo.
  function videoUrl() {
    const u = new URL(location.href);
    const p = u.pathname;
    if (/(^|\.)youtube\.com$/.test(host) || host === 'youtu.be') {
      if (host === 'youtu.be' && p.length > 1) return location.href;
      if (p === '/watch' && u.searchParams.get('v')) return location.href;
      if (/^\/shorts\/[\w-]+/.test(p)) return location.href;
      if (/^\/live\/[\w-]+/.test(p)) return location.href;
      return null;
    }
    if (/(^|\.)tiktok\.com$/.test(host)) {
      if (/\/video\/\d+/.test(p)) return location.href;
      if (/\/photo\/\d+/.test(p)) return location.href;
      if (/^\/@[\w.-]+\/video\/\d+/.test(p)) return location.href;
      return null;
    }
    if (/(^|\.)instagram\.com$/.test(host)) {
      if (/^\/(reel|reels|p|tv)\/[\w-]+/.test(p)) return location.href;
      return null;
    }
    return null;
  }

  let btn, toastEl;

  function ensureButton() {
    if (btn) return btn;
    btn = document.createElement('button');
    btn.id = 'darko-dl-btn';
    btn.type = 'button';
    btn.innerHTML =
      '<span class="d-ic">⬇</span><span class="d-tx">Baixar</span>';
    btn.addEventListener('click', onClick);
    document.documentElement.appendChild(btn);
    return btn;
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
    const tx = btn.querySelector('.d-tx');
    const ic = btn.querySelector('.d-ic');
    if (state === 'loading') {
      tx.textContent = 'Baixando…';
      ic.textContent = '⏳';
      btn.disabled = true;
    } else if (state === 'ok') {
      tx.textContent = 'Pronto!';
      ic.textContent = '✅';
      btn.disabled = false;
      setTimeout(() => setBtn('idle'), 3000);
    } else if (state === 'err') {
      tx.textContent = 'Erro';
      ic.textContent = '⚠️';
      btn.disabled = false;
      setTimeout(() => setBtn('idle'), 3000);
    } else {
      tx.textContent = 'Baixar';
      ic.textContent = '⬇';
      btn.disabled = false;
    }
  }

  function onClick() {
    const url = videoUrl();
    if (!url) {
      toast('Abra um vídeo para baixar.', 'err');
      return;
    }
    setBtn('loading');
    toast('Enviando pro motor…', '');
    let done = false;
    const timeout = setTimeout(() => {
      if (done) return;
      done = true;
      setBtn('ok');
      toast('Download iniciado. Veja a barra de downloads.', 'ok');
    }, 4000);
    chrome.runtime.sendMessage(
      { type: 'darko-download', url, mode: 'video', quality: '1080' },
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
    const isVideo = !!videoUrl();
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
