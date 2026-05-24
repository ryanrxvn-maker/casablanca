/**
 * DARKO LAB · Freepik Sync — Service Worker
 *
 * Roda em background. Lê cookies de magnific.com (via chrome.cookies API,
 * que NÃO sofre CORS) e POSTa pro backend DARKO LAB que cifra + persiste.
 *
 * Triggers de sync:
 *   - Install / update
 *   - Browser startup
 *   - chrome.cookies.onChanged em magnific.com (login, logout, refresh)
 *   - Alarm a cada 30min (defesa contra cookie rotation que perdemos)
 *   - Mensagem manual do popup
 */

const ALARM_KEY = 'darko-freepik-resync';
const RESYNC_MIN = 30;
const STORAGE_KEYS = {
  endpoint: 'endpoint',      // URL base do DARKO LAB (configurável no popup)
  lastSync: 'lastSync',      // timestamp do último sync ok
  lastStatus: 'lastStatus',  // 'ok' | 'err' | 'no-login' | 'no-darko'
  lastError: 'lastError',    // mensagem do último erro
  plan: 'plan',              // plano Magnific detectado
  userId: 'userId',          // user_id Magnific
};

const DEFAULT_ENDPOINTS = [
  // Tenta na ordem. Primeiro que responder com 200/401 é o ativo.
  'https://www.darkolab.com',
  'https://darkolab.com',
  // localhost só pra dev:
  'http://localhost:3000',
];

/* ───────────────────────── Cookie reader ───────────────────────── */

async function readMagnificCookies() {
  // chrome.cookies API roda em background — bypassa SameSite/CORS
  const all = await chrome.cookies.getAll({ domain: 'magnific.com' });
  if (!all || all.length === 0) {
    return { ok: false, reason: 'no-login', cookies: [] };
  }
  // Monta header `Cookie:` no formato `k1=v1; k2=v2;`
  const cookieHeader = all.map((c) => `${c.name}=${c.value}`).join('; ');
  const xsrfRaw = all.find((c) => c.name === 'XSRF-TOKEN')?.value;
  if (!xsrfRaw) {
    return { ok: false, reason: 'no-xsrf', cookies: all };
  }
  let xsrfToken;
  try {
    xsrfToken = decodeURIComponent(xsrfRaw);
  } catch {
    xsrfToken = xsrfRaw;
  }
  return { ok: true, cookieHeader, xsrfToken };
}

/* ───────────────────────── Endpoint discovery ───────────────────────── */

async function resolveEndpoint() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.endpoint);
  if (stored[STORAGE_KEYS.endpoint]) return stored[STORAGE_KEYS.endpoint];
  // Auto-discovery: testa qual responde
  for (const ep of DEFAULT_ENDPOINTS) {
    try {
      const r = await fetch(`${ep}/api/auto-broll-v2/save-creds`, {
        method: 'GET',
        credentials: 'include',
      });
      // 401 (não logado DARKO) OU 200 (logado) → endpoint vivo
      if (r.status === 200 || r.status === 401) {
        await chrome.storage.local.set({ [STORAGE_KEYS.endpoint]: ep });
        return ep;
      }
    } catch {
      /* tenta próximo */
    }
  }
  return null;
}

/* ───────────────────────── Sync ───────────────────────── */

async function sync(reason = 'manual') {
  console.log('[freepik-sync] tick', reason);
  const endpoint = await resolveEndpoint();
  if (!endpoint) {
    await persistStatus('err', 'Não encontrei DARKO LAB online. Abra darkolab.com.');
    return { ok: false, reason: 'no-darko' };
  }

  // Confirma user logado no DARKO LAB (precisamos do session cookie pra POST)
  let darkoLogged = false;
  try {
    const r = await fetch(`${endpoint}/api/auto-broll-v2/save-creds`, {
      method: 'GET',
      credentials: 'include',
    });
    darkoLogged = r.status === 200;
  } catch {
    /* offline */
  }
  if (!darkoLogged) {
    await persistStatus('no-darko', 'Faça login em DARKO LAB nesse navegador.');
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

  // POST pro backend
  try {
    const r = await fetch(`${endpoint}/api/auto-broll-v2/save-creds`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        cookie: ck.cookieHeader,
        xsrfToken: ck.xsrfToken,
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

// Install / update
chrome.runtime.onInstalled.addListener(() => {
  console.log('[freepik-sync] installed');
  chrome.alarms.create(ALARM_KEY, { periodInMinutes: RESYNC_MIN });
  sync('install');
});

// Browser startup
chrome.runtime.onStartup.addListener(() => {
  console.log('[freepik-sync] startup');
  sync('startup');
});

// Alarm periódico
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARM_KEY) sync('alarm');
});

// Cookie change em magnific.com
chrome.cookies.onChanged.addListener((info) => {
  const d = info.cookie?.domain || '';
  if (!/magnific\.com$/i.test(d)) return;
  // Debounce: aglutina mudanças rápidas
  clearTimeout(globalThis.__darkoSyncDebounce);
  globalThis.__darkoSyncDebounce = setTimeout(() => sync('cookie-change'), 1500);
});

// Mensagem do popup
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'sync-now') {
    sync('manual').then((r) => sendResponse(r));
    return true; // async response
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
  return false;
});
