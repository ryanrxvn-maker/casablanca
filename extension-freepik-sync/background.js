/**
 * Auto Edit · Freepik Sync — Service Worker
 *
 * Roda em background. Lê cookies de magnific.com (via chrome.cookies API,
 * que NÃO sofre CORS) e POSTa pro backend Auto Edit que cifra + persiste.
 *
 * Discovery do endpoint:
 *   1) Origin registrado por content-script app-discover.js (preferido)
 *   2) Endpoint salvo manualmente pelo user no popup
 *   3) Lista hardcoded de fallback (Vercel default + localhost)
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
  'https://casablanca-ashen.vercel.app',
  'https://casablanca.vercel.app',
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
  // Browser context = passa Cloudflare TLS fingerprint + cookies session full.
  if (msg?.type === 'magnific-fetch') {
    (async () => {
      try {
        const init = msg.init || {};
        const path = msg.path || '/';
        const url = path.startsWith('http')
          ? path
          : `https://www.magnific.com${path.startsWith('/') ? '' : '/'}${path}`;
        // Pega XSRF mais atual dos cookies pra header automatico
        let xsrf = null;
        try {
          const ck = await chrome.cookies.get({
            url: 'https://www.magnific.com/',
            name: 'XSRF-TOKEN',
          });
          if (ck?.value) xsrf = decodeURIComponent(ck.value);
        } catch {}
        const headers = {
          accept: 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          ...(init.headers || {}),
        };
        if (xsrf && !headers['X-XSRF-TOKEN'] && !headers['x-xsrf-token']) {
          headers['X-XSRF-TOKEN'] = xsrf;
        }
        const fetchInit = {
          method: init.method || 'GET',
          headers,
          credentials: 'include',
        };
        if (init.body !== undefined) {
          if (typeof init.body === 'string') {
            fetchInit.body = init.body;
          } else {
            headers['content-type'] = headers['content-type'] || 'application/json';
            fetchInit.body = JSON.stringify(init.body);
          }
        }
        const r = await fetch(url, fetchInit);
        const ct = r.headers.get('content-type') || '';
        let body;
        let bodyType;
        if (ct.includes('application/json')) {
          body = await r.text(); // text pra serializar
          bodyType = 'json-text';
        } else {
          body = await r.text();
          bodyType = 'text';
        }
        sendResponse({
          ok: r.ok,
          status: r.status,
          statusText: r.statusText,
          headers: Object.fromEntries(r.headers.entries()),
          body,
          bodyType,
          url: r.url,
        });
      } catch (e) {
        sendResponse({
          ok: false,
          error: String(e?.message || e),
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
