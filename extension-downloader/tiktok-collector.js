/**
 * DARKO Coletar — painel flutuante no TikTok pra montar lotes de URLs
 * por NICHO (Memória / E.D) clicando "Capturar visíveis" enquanto o
 * usuário rola a busca normalmente. Depois "Baixar coletados" manda
 * tudo pro motor, que extrai MP3 e organiza em pasta por nicho.
 * NÃO automatiza scrape — é a coleta interativa do que o user já vê.
 */
(function () {
  'use strict';
  if (window.__darkoTtCol) return;
  window.__darkoTtCol = true;

  const LS = 'darko-collector-buckets';
  const LSNICHE = 'darko-collector-niche';
  let buckets = (() => {
    try {
      return JSON.parse(localStorage.getItem(LS) || '{}');
    } catch {
      return {};
    }
  })();
  if (!buckets || typeof buckets !== 'object') buckets = {};
  let niche = localStorage.getItem(LSNICHE) || 'memoria';
  const NICHES = [
    { key: 'memoria', label: 'Memória' },
    { key: 'ed', label: 'E.D' },
  ];

  function save() {
    try {
      localStorage.setItem(LS, JSON.stringify(buckets));
      localStorage.setItem(LSNICHE, niche);
    } catch {
      /* noop */
    }
  }

  function vidId(u) {
    const m = u.match(/\/video\/(\d{6,})/);
    return m ? m[1] : null;
  }
  function ensureNiche(k) {
    if (!buckets[k]) buckets[k] = {};
  }
  function countAll() {
    return Object.values(buckets).reduce(
      (a, m) => a + Object.keys(m || {}).length,
      0,
    );
  }

  // === scan: URLs de /video/ visíveis na página agora
  function scanVisible() {
    const urls = new Set();
    document.querySelectorAll('a[href*="/video/"]').forEach((a) => {
      const href = a.href.split('?')[0].split('#')[0];
      if (/\/video\/\d{6,}/.test(href)) urls.add(href);
    });
    return [...urls];
  }

  // === UI ===
  const panel = document.createElement('div');
  panel.id = 'darko-tt-col';
  panel.innerHTML = `
    <style>
      #darko-tt-col{
        position:fixed;top:14px;right:14px;z-index:2147483647;
        width:280px;background:#0b0d0c;color:#e8eae9;border:1px solid #2a2f2b;
        border-radius:10px;font:13px/1.35 -apple-system,Segoe UI,Roboto,sans-serif;
        box-shadow:0 8px 28px rgba(0,0,0,.55);user-select:none;
      }
      #darko-tt-col.min .dc-body{display:none}
      #darko-tt-col .dc-hdr{
        display:flex;align-items:center;justify-content:space-between;
        padding:8px 10px;border-bottom:1px solid #1d211e;cursor:move;
        background:linear-gradient(180deg,#161a16,#0b0d0c)
      }
      #darko-tt-col .dc-brand{font-weight:600;letter-spacing:.5px;font-size:12px}
      #darko-tt-col .dc-brand b{color:#c8ff00}
      #darko-tt-col .dc-hdr button{
        background:none;border:0;color:#8a8f8b;font:600 14px/1 monospace;
        cursor:pointer;padding:0 4px
      }
      #darko-tt-col .dc-body{padding:10px;display:flex;flex-direction:column;gap:9px}
      #darko-tt-col label{display:flex;align-items:center;gap:6px;font-size:11px;
        text-transform:uppercase;letter-spacing:1px;color:#8a8f8b}
      #darko-tt-col select{
        flex:1;background:#121512;border:1px solid #2a2f2b;color:#e8eae9;
        padding:5px 7px;border-radius:6px;font-size:12px
      }
      #darko-tt-col button.act{
        background:#c8ff00;color:#0b0d0c;border:0;border-radius:7px;
        padding:8px;font-weight:700;cursor:pointer
      }
      #darko-tt-col button.act:disabled{opacity:.5;cursor:not-allowed}
      #darko-tt-col button.gho{
        background:#121512;color:#e8eae9;border:1px solid #2a2f2b;
        border-radius:7px;padding:6px;font-size:11px;cursor:pointer
      }
      #darko-tt-col .row{display:flex;gap:6px}
      #darko-tt-col .row>*{flex:1}
      #darko-tt-col .counts{
        display:flex;justify-content:space-between;font:11px ui-monospace,monospace;
        color:#c8ff00;background:#10130f;padding:6px 8px;border-radius:6px;
        border:1px solid #1d2818
      }
      #darko-tt-col .log{
        max-height:120px;overflow-y:auto;font:10px/1.5 ui-monospace,monospace;
        color:#8a8f8b;background:#0a0c0a;border:1px solid #1d211e;
        border-radius:6px;padding:6px;
      }
      #darko-tt-col .log .ok{color:#c8ff00}
      #darko-tt-col .log .sk{color:#aaaaaa}
      #darko-tt-col .log .er{color:#ff7676}
      #darko-tt-col .log .pr{color:#9ad8ff}
    </style>
    <div class="dc-hdr">
      <span class="dc-brand">DARKO <b>Coletar</b></span>
      <div>
        <button class="dc-min" title="minimizar">_</button>
      </div>
    </div>
    <div class="dc-body">
      <label>Nicho
        <select class="dc-niche"></select>
      </label>
      <button class="act dc-cap">Capturar visíveis (<span class="dc-vc">0</span>)</button>
      <div class="counts">
        <span>memória: <b class="dc-cm">0</b></span>
        <span>e.d: <b class="dc-ce">0</b></span>
      </div>
      <div class="row">
        <button class="gho dc-clear">Limpar nicho</button>
        <button class="gho dc-clearall">Limpar todos</button>
      </div>
      <button class="act dc-send">Baixar coletados</button>
      <div class="log dc-log">pronto.</div>
    </div>
  `;
  document.documentElement.appendChild(panel);
  const $ = (s) => panel.querySelector(s);

  // populate niche select
  const sel = $('.dc-niche');
  NICHES.forEach((n) => {
    const o = document.createElement('option');
    o.value = n.key;
    o.textContent = n.label;
    if (n.key === niche) o.selected = true;
    sel.appendChild(o);
  });
  sel.addEventListener('change', () => {
    niche = sel.value;
    save();
    updateCounts();
  });

  // minimize toggle
  $('.dc-min').addEventListener('click', () => {
    panel.classList.toggle('min');
  });

  // drag
  let dr = null;
  $('.dc-hdr').addEventListener('mousedown', (e) => {
    if (e.target.tagName === 'BUTTON') return;
    const r = panel.getBoundingClientRect();
    dr = { x: e.clientX - r.left, y: e.clientY - r.top };
  });
  addEventListener('mousemove', (e) => {
    if (!dr) return;
    panel.style.right = 'auto';
    panel.style.left = e.clientX - dr.x + 'px';
    panel.style.top = e.clientY - dr.y + 'px';
  });
  addEventListener('mouseup', () => (dr = null));

  function updateCounts() {
    $('.dc-cm').textContent = Object.keys(buckets.memoria || {}).length;
    $('.dc-ce').textContent = Object.keys(buckets.ed || {}).length;
  }
  function updateVisible() {
    const list = scanVisible();
    const nicheMap = buckets[niche] || {};
    const novos = list.filter((u) => {
      const id = vidId(u);
      return id && !nicheMap[id];
    });
    $('.dc-vc').textContent = novos.length;
    return novos;
  }
  updateCounts();
  updateVisible();
  setInterval(updateVisible, 1500);

  function log(msg, cls) {
    const el = $('.dc-log');
    const line = document.createElement('div');
    if (cls) line.className = cls;
    line.textContent = msg;
    el.appendChild(line);
    el.scrollTop = el.scrollHeight;
    while (el.childNodes.length > 200) el.removeChild(el.firstChild);
  }

  $('.dc-cap').addEventListener('click', () => {
    const novos = updateVisible();
    if (!novos.length) {
      log('nada novo visível.', 'sk');
      return;
    }
    ensureNiche(niche);
    let added = 0;
    for (const u of novos) {
      const id = vidId(u);
      if (!id) continue;
      buckets[niche][id] = { url: u, capturedAt: Date.now() };
      added++;
    }
    save();
    updateCounts();
    updateVisible();
    log(`+${added} URL(s) coletadas em "${niche}"`, 'ok');
  });

  $('.dc-clear').addEventListener('click', () => {
    if (!confirm(`Limpar URLs coletadas de "${niche}"?`)) return;
    buckets[niche] = {};
    save();
    updateCounts();
    updateVisible();
    log(`nicho "${niche}" limpo.`, 'sk');
  });
  $('.dc-clearall').addEventListener('click', () => {
    if (!confirm('Limpar TODAS as URLs coletadas?')) return;
    buckets = {};
    save();
    updateCounts();
    updateVisible();
    log('tudo limpo.', 'sk');
  });

  // === enviar pro motor (via bg.js) ===
  function send(nKey, urls) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(
          { type: 'darko-bulk-audio', niche: nKey, urls },
          (resp) => {
            if (chrome.runtime.lastError) {
              resolve({
                ok: false,
                error: chrome.runtime.lastError.message,
              });
            } else resolve(resp || { ok: false, error: 'sem resposta' });
          },
        );
      } catch (e) {
        resolve({ ok: false, error: String(e && e.message) });
      }
    });
  }

  // progresso vindo do bg
  try {
    chrome.runtime.onMessage.addListener((m) => {
      if (!m || m.type !== 'darko-bulk-progress') return;
      if (m.kind === 'item') {
        const tag = m.status === 'ok' ? 'ok' : m.status === 'skipped' ? 'sk' : 'er';
        const detail =
          m.status === 'ok'
            ? m.name
            : m.status === 'skipped'
              ? 'já tinha'
              : (m.error || '').slice(0, 60);
        log(
          `[${m.niche}] ${m.i}/${m.total} ${m.status}: ${detail}`,
          tag,
        );
      } else if (m.kind === 'start') {
        log(`▶ iniciando ${m.niche}: ${m.total} URLs`, 'pr');
      } else if (m.kind === 'done') {
        log(
          `✔ ${m.niche}: ${m.saved} salvos, ${m.skipped} pulos, ${m.failed} erros (→ ${m.dir})`,
          'ok',
        );
        // remove do bucket as URLs que ficaram OK ou pulou (já estão lá)
        // mantém só as que falharam pro user reprocessar depois
      }
    });
  } catch {
    /* contexto invalido */
  }

  $('.dc-send').addEventListener('click', async () => {
    const all = Object.entries(buckets).filter(
      ([k, m]) => m && Object.keys(m).length,
    );
    if (!all.length) {
      log('nada coletado.', 'sk');
      return;
    }
    $('.dc-send').disabled = true;
    for (const [nKey, m] of all) {
      const urls = Object.values(m).map((x) => x.url);
      // manda em lotes de 25 (mensagens menores; resposta da onMessage final
      // confirma; o progresso vem via 'darko-bulk-progress')
      const CH = 25;
      for (let i = 0; i < urls.length; i += CH) {
        const chunk = urls.slice(i, i + CH);
        log(
          `enviando ${chunk.length} pro motor (${nKey}, lote ${1 + i / CH})…`,
          'pr',
        );
        const r = await send(nKey, chunk);
        if (!r.ok) {
          log(`erro: ${r.error}`, 'er');
          break;
        }
      }
    }
    $('.dc-send').disabled = false;
  });

  log('coletor pronto. Faça as buscas e clique Capturar.', 'pr');
})();
