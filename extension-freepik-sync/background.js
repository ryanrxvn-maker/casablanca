/**
 * Auto Edit · Freepik Sync — Service Worker
 *
 * Roda em background. Lê cookies de magnific.com (via chrome.cookies API,
 * que NÃO sofre CORS) e POSTa pro backend Auto Edit que cifra + persiste.
 *
 * Discovery do endpoint:
 *   1) Origin registrado por content-script app-discover.js (preferido)
 *   2) Endpoint salvo manualmente pelo user no popup
 *   3) Lista hardcoded de fallback (dominio do app + localhost)
 *
 * Triggers de sync:
 *   - Install / update
 *   - Browser startup
 *   - chrome.cookies.onChanged em magnific.com
 *   - Alarm a cada 30min
 *   - Mensagem manual do popup
 *   - Registro novo de origin pelo content-script
 */

const ALARM_KEY = 'autoedit-resync';
const RESYNC_MIN = 30;
const STORAGE_KEYS = {
  endpoint: 'endpoint',          // URL manual (override)
  discoveredOrigin: 'discoveredOrigin', // origin pego pelo content-script
  lastSync: 'lastSync',
  lastStatus: 'lastStatus',
  lastError: 'lastError',
  plan: 'plan',
  userId: 'userId',
};

// Fallback se não tiver origin descoberto nem manual setado.
// IDEALMENTE não usado — o content script app-discover.js registra
// o origin assim que user abre qualquer página do Auto Edit.
const FALLBACK_ENDPOINTS = [
  'https://www.darkoautoedit.com',
  'https://darkoautoedit.com',
  'http://localhost:3000',
];

/* ───────────────────────── Cookie reader ───────────────────────── */

async function readMagnificCookies() {
  // URL-based filter captura EXATAMENTE os cookies que o browser
  // enviaria pra magnific.com — incluindo HttpOnly, Secure,
  // SameSite=Lax e cookies de subdominios (www, app, etc).
  // Domain-based filter pode perder cookies de www subdomain.
  const fromWww = await chrome.cookies.getAll({ url: 'https://www.magnific.com/' });
  const fromApex = await chrome.cookies.getAll({ url: 'https://magnific.com/' });
  // Merge (dedup por name+domain)
  const seen = new Set();
  const all = [];
  for (const c of [...fromWww, ...fromApex]) {
    const key = `${c.name}@${c.domain}`;
    if (seen.has(key)) continue;
    seen.add(key);
    all.push(c);
  }
  if (all.length === 0) {
    return { ok: false, reason: 'no-login' };
  }
  const cookieHeader = all.map((c) => `${c.name}=${c.value}`).join('; ');
  const xsrfRaw = all.find((c) => c.name === 'XSRF-TOKEN')?.value;
  if (!xsrfRaw) return { ok: false, reason: 'no-xsrf' };
  let xsrfToken;
  try { xsrfToken = decodeURIComponent(xsrfRaw); } catch { xsrfToken = xsrfRaw; }
  // Debug: total + sample dos cookies-chave (sem expor valor)
  console.log(
    '[autoedit-sync] cookies capturados:',
    all.length,
    all.map((c) => c.name).join(','),
  );
  return { ok: true, cookieHeader, xsrfToken, cookieCount: all.length };
}

/* ───────────────────────── Endpoint resolution ───────────────────────── */

async function resolveEndpoint() {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.endpoint,
    STORAGE_KEYS.discoveredOrigin,
  ]);
  // Prioridade 1: manual override
  if (stored[STORAGE_KEYS.endpoint]) return stored[STORAGE_KEYS.endpoint];
  // Prioridade 2: discovered via content-script
  if (stored[STORAGE_KEYS.discoveredOrigin]) return stored[STORAGE_KEYS.discoveredOrigin];
  // Prioridade 3: fallback list (probing)
  for (const ep of FALLBACK_ENDPOINTS) {
    try {
      const r = await fetch(`${ep}/api/auto-broll-v2/save-creds`, {
        method: 'GET',
        credentials: 'include',
      });
      if (r.status === 200 || r.status === 401) {
        // Cache como discovered pra próximos syncs
        await chrome.storage.local.set({ [STORAGE_KEYS.discoveredOrigin]: ep });
        return ep;
      }
    } catch { /* tenta próximo */ }
  }
  return null;
}

/* ───────────────────────── Sync ───────────────────────── */

async function sync(reason = 'manual') {
  console.log('[autoedit-sync] tick', reason);
  const endpoint = await resolveEndpoint();
  if (!endpoint) {
    await persistStatus(
      'no-darko',
      'Abra Auto Edit numa aba uma vez (qualquer página). A extensão detecta o domínio automaticamente.',
    );
    return { ok: false, reason: 'no-endpoint' };
  }

  // Confirma user logado no Auto Edit
  let darkoLogged = false;
  try {
    const r = await fetch(`${endpoint}/api/auto-broll-v2/save-creds`, {
      method: 'GET',
      credentials: 'include',
    });
    darkoLogged = r.status === 200;
  } catch { /* offline */ }
  if (!darkoLogged) {
    await persistStatus(
      'no-darko',
      `Faça login em ${new URL(endpoint).hostname} nesse navegador.`,
    );
    return { ok: false, reason: 'no-darko-login', endpoint };
  }

  // Lê cookies Magnific
  const ck = await readMagnificCookies();
  if (!ck.ok) {
    await persistStatus(
      ck.reason === 'no-login' ? 'no-login' : 'err',
      ck.reason === 'no-login'
        ? 'Faça login em magnific.com nesse navegador.'
        : 'Sessão Magnific inválida — relogue em magnific.com.',
    );
    return { ok: false, reason: ck.reason };
  }

  // VERIFY no browser (passa Cloudflare — backend Node nao passa TLS fingerprint).
  // Resultado: pegamos fpId + plan AQUI e mandamos pro backend ja validado.
  let verified;
  try {
    const vr = await fetch('https://www.magnific.com/app/api/auth/verify?lang=en_US', {
      credentials: 'include',
      headers: { accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      cache: 'no-store',
    });
    if (!vr.ok) {
      await persistStatus('err', `Magnific auth verify falhou: ${vr.status}. Relogue em magnific.com.`);
      return { ok: false, reason: 'verify-failed', status: vr.status };
    }
    const j = await vr.json();
    const u = j.userData;
    if (!u || (!u.fpId && !u.id)) {
      await persistStatus('err', 'Resposta verify sem userData. Relogue em magnific.com.');
      return { ok: false, reason: 'verify-no-userdata' };
    }
    const fpId = typeof u.fpId === 'string' ? parseInt(u.fpId, 10) : u.fpId;
    verified = {
      userId: fpId || u.id,
      plan: (u.hasRealFreepikPremium || u.freepikPremium) ? 'Premium+' : 'Free',
      email: u.email,
      walletId: u.walletId,
    };
    console.log('[autoedit-sync] verify OK:', { uid: verified.userId, plan: verified.plan });
  } catch (e) {
    await persistStatus('err', `Erro chamando verify: ${e.message || e}`);
    return { ok: false, reason: 'verify-error', error: String(e.message || e) };
  }

  // POST pro backend (com dados ja verificados — backend pula a validacao)
  try {
    const r = await fetch(`${endpoint}/api/auto-broll-v2/save-creds`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        cookie: ck.cookieHeader,
        xsrfToken: ck.xsrfToken,
        // Pre-verified data — backend confia (chamou /auth/verify no browser do user)
        preVerified: verified,
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      await persistStatus('err', j.error || `HTTP ${r.status}`);
      return { ok: false, reason: 'server-reject', status: r.status, body: j };
    }
    await chrome.storage.local.set({
      [STORAGE_KEYS.lastSync]: Date.now(),
      [STORAGE_KEYS.lastStatus]: 'ok',
      [STORAGE_KEYS.lastError]: null,
      [STORAGE_KEYS.plan]: j.plan || null,
      [STORAGE_KEYS.userId]: j.magnificUserId || null,
    });
    updateBadge('ok');
    return { ok: true, plan: j.plan, userId: j.magnificUserId, endpoint };
  } catch (e) {
    await persistStatus('err', String(e.message || e));
    return { ok: false, reason: 'network', error: String(e.message || e) };
  }
}

async function persistStatus(status, error) {
  await chrome.storage.local.set({
    [STORAGE_KEYS.lastStatus]: status,
    [STORAGE_KEYS.lastError]: error || null,
  });
  updateBadge(status);
}

function updateBadge(status) {
  let text = '';
  let color = '#a3e635';
  if (status === 'ok') { text = '✓'; color = '#a3e635'; }
  else if (status === 'no-login') { text = '!'; color = '#fbbf24'; }
  else if (status === 'no-darko') { text = '?'; color = '#fbbf24'; }
  else if (status === 'err') { text = '×'; color = '#ef4444'; }
  try {
    chrome.action.setBadgeText({ text });
    chrome.action.setBadgeBackgroundColor({ color });
  } catch {}
}

/* ───────────────────────── Triggers ───────────────────────── */

chrome.runtime.onInstalled.addListener(() => {
  console.log('[autoedit-sync] installed');
  chrome.alarms.create(ALARM_KEY, { periodInMinutes: RESYNC_MIN });
  sync('install');
});

chrome.runtime.onStartup.addListener(() => {
  console.log('[autoedit-sync] startup');
  sync('startup');
});

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARM_KEY) sync('alarm');
});

chrome.cookies.onChanged.addListener((info) => {
  const d = info.cookie?.domain || '';
  if (!/magnific\.com$/i.test(d)) return;
  clearTimeout(globalThis.__autoeditSyncDebounce);
  globalThis.__autoeditSyncDebounce = setTimeout(() => sync('cookie-change'), 1500);
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'sync-now') {
    sync('manual').then((r) => sendResponse(r));
    return true;
  }
  if (msg?.type === 'get-status') {
    chrome.storage.local
      .get([
        STORAGE_KEYS.lastSync,
        STORAGE_KEYS.lastStatus,
        STORAGE_KEYS.lastError,
        STORAGE_KEYS.plan,
        STORAGE_KEYS.userId,
        STORAGE_KEYS.endpoint,
        STORAGE_KEYS.discoveredOrigin,
      ])
      .then((s) => sendResponse(s));
    return true;
  }
  if (msg?.type === 'set-endpoint') {
    chrome.storage.local
      .set({ [STORAGE_KEYS.endpoint]: String(msg.endpoint || '').replace(/\/+$/, '') })
      .then(() => sync('endpoint-changed'))
      .then((r) => sendResponse(r));
    return true;
  }
  /* ──────────── MAGNIFIC PROXY ──────────── */
  // Page (via content script) pede pra extensao fazer fetch em magnific.com.
  //
  // CRÍTICO: usamos chrome.scripting.executeScript pra rodar o fetch DENTRO
  // de uma aba magnific.com aberta. Mesma origem, cookies + session + CSRF
  // exatos que o user usa. Bypassa todos os problemas de cookie partitioning
  // do service worker + 419 CSRF mismatch.
  if (msg?.type === 'magnific-fetch') {
    (async () => {
      try {
        // ───── Acha uma aba magnific.com VIVA (auto-cura) ─────
        // Aba descartada/congelada (Chrome Memory Saver — comum quando a aba
        // fica horas em background) OU em host fora do permitido faz o
        // executeScript estourar "Cannot access contents of the page. Extension
        // manifest must request permission to access the respective host".
        // Então: prioriza aba não-descartada; reativa a descartada; e se o
        // executeScript ainda falhar, cria uma aba FRESCA em www.magnific.com.
        const __waitComplete = (tabId, ms) =>
          new Promise((resolve) => {
            let done = false;
            const finish = () => {
              if (done) return;
              done = true;
              try { chrome.tabs.onUpdated.removeListener(listener); } catch {}
              resolve();
            };
            const listener = (tid, info) => {
              if (tid === tabId && info.status === 'complete') finish();
            };
            chrome.tabs.onUpdated.addListener(listener);
            // Se já estiver completa e viva, resolve na hora.
            chrome.tabs.get(tabId).then((t) => {
              if (t && t.status === 'complete' && !t.discarded) finish();
            }).catch(() => {});
            setTimeout(finish, ms || 15000);
          });

        const __wantedMagnific = ['https://www.magnific.com/*', 'https://magnific.com/*'];
        let __cands = await chrome.tabs.query({ url: __wantedMagnific });
        // não-descartada primeiro; entre essas, 'complete' primeiro.
        __cands.sort((a, b) => {
          const ad = a.discarded ? 1 : 0, bd = b.discarded ? 1 : 0;
          if (ad !== bd) return ad - bd;
          const ac = a.status === 'complete' ? 0 : 1, bc = b.status === 'complete' ? 0 : 1;
          return ac - bc;
        });
        let tab = __cands[0];
        // Aba descartada/congelada → reativa (reload) e espera carregar.
        if (tab && tab.discarded) {
          try { await chrome.tabs.reload(tab.id); } catch {}
          await __waitComplete(tab.id, 20000);
          try { tab = (await chrome.tabs.get(tab.id)) || tab; } catch {}
        }
        if (!tab) {
          // Nenhuma aba magnific aberta → cria em background.
          tab = await chrome.tabs.create({ url: 'https://www.magnific.com/', active: false });
          await __waitComplete(tab.id, 20000);
        }

        // ───── Fetch no contexto da página (cookies/CSRF perfeitos) ─────
        const __magnificFetchFunc = async (path, init) => {
          try {
            const url = path.startsWith('http')
              ? path
              : `${location.origin}${path.startsWith('/') ? '' : '/'}${path}`;
            const headers = {
              accept: 'application/json',
              'X-Requested-With': 'XMLHttpRequest',
              ...(init.headers || {}),
            };
            // XSRF do document.cookie (mesma que axios da page usa)
            try {
              const m = document.cookie.match(/XSRF-TOKEN=([^;]+)/);
              if (m && !headers['X-XSRF-TOKEN'] && !headers['x-xsrf-token']) {
                headers['X-XSRF-TOKEN'] = decodeURIComponent(m[1]);
              }
            } catch {}
            const opts = {
              method: init.method || 'GET',
              headers,
              credentials: 'include',
              cache: 'no-store',
            };
            if (init.body !== undefined) {
              if (typeof init.body === 'string') {
                opts.body = init.body;
              } else {
                headers['content-type'] = headers['content-type'] || 'application/json';
                opts.body = JSON.stringify(init.body);
              }
            }
            const r = await fetch(url, opts);
            const text = await r.text();
            const respHeaders = {};
            r.headers.forEach((v, k) => {
              respHeaders[k] = v;
            });
            return {
              __ok: true,
              ok: r.ok,
              status: r.status,
              statusText: r.statusText,
              headers: respHeaders,
              body: text,
              url: r.url,
            };
          } catch (e) {
            return { __ok: false, error: String(e?.message || e) };
          }
        };
        const __runOn = (tabId) =>
          chrome.scripting.executeScript({
            target: { tabId },
            world: 'MAIN', // page context
            args: [msg.path || '/', msg.init || {}],
            func: __magnificFetchFunc,
          });

        let results;
        try {
          results = await __runOn(tab.id);
        } catch (eExec) {
          // Aba morreu no meio OU host fora do permitido (ex.: aba em
          // magnific.com sem www e manifest desatualizado). Cria uma aba FRESCA
          // em www.magnific.com (host garantido) e tenta UMA vez mais.
          console.warn('[freepik-sync] executeScript falhou, recriando aba magnific limpa:', eExec?.message || eExec);
          const fresh = await chrome.tabs.create({ url: 'https://www.magnific.com/', active: false });
          await __waitComplete(fresh.id, 20000);
          results = await __runOn(fresh.id);
        }
        const result = results?.[0]?.result;
        if (!result || result.__ok === false) {
          sendResponse({
            ok: false,
            error: result?.error || 'Erro desconhecido no chrome.scripting',
          });
          return;
        }
        sendResponse({
          ok: result.ok,
          status: result.status,
          statusText: result.statusText,
          headers: result.headers,
          body: result.body,
          url: result.url,
        });
      } catch (e) {
        sendResponse({
          ok: false,
          error: 'magnific-fetch falhou: ' + String(e?.message || e),
        });
      }
    })();
    return true; // async
  }

  if (msg?.type === 'register-app-origin') {
    const o = String(msg.origin || '').replace(/\/+$/, '');
    if (!o) { sendResponse({ ok: false }); return true; }
    chrome.storage.local.get(STORAGE_KEYS.discoveredOrigin).then((cur) => {
      if (cur[STORAGE_KEYS.discoveredOrigin] === o) {
        sendResponse({ ok: true, unchanged: true });
        return;
      }
      chrome.storage.local
        .set({ [STORAGE_KEYS.discoveredOrigin]: o })
        .then(() => sync('app-origin-discovered'))
        .then((r) => sendResponse({ ok: true, discovered: o, syncResult: r }));
    });
    return true;
  }
  return false;
});
