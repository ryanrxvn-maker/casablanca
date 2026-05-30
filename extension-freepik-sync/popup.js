/** Popup UI — status enxuto + 2 atalhos. Nada de config/diagnóstico. */

const $ = (id) => document.getElementById(id);

const STATUS_MESSAGES = {
  ok: { title: '✓ Conectado', sub: 'Sincronizado.', cls: 'ok', dot: 'ok' },
  'no-login': {
    title: '⚠ Faça login em magnific.com',
    sub: '',
    cls: 'warn',
    dot: 'warn',
  },
  'no-darko': {
    title: '⚠ Auto Edit não detectado',
    sub: 'Abra o Auto Edit numa aba.',
    cls: 'warn',
    dot: 'warn',
  },
  err: { title: '✗ Erro de sincronização', sub: 'Tente de novo.', cls: 'err', dot: 'err' },
};

async function send(type, extra = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, ...extra }, (r) => resolve(r));
  });
}

async function refresh() {
  const s = await send('get-status');
  const status = s?.lastStatus || 'no-login';
  const meta = STATUS_MESSAGES[status] || STATUS_MESSAGES.err;
  $('statusTitle').textContent = meta.title;
  $('statusSub').textContent =
    status === 'err' && s?.lastError ? s.lastError : meta.sub;
  $('status').className = 'status ' + meta.cls;
  $('dot').className = 'dot ' + meta.dot;
}

$('btnOpenMagnific').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://www.magnific.com' });
});

$('btnOpenDarko').addEventListener('click', async () => {
  const s = await send('get-status');
  const base =
    s?.endpoint || s?.discoveredOrigin || 'https://www.darkoautoedit.com';
  chrome.tabs.create({ url: base + '/configuracoes/magnific' });
});

refresh();
// Auto-refresh enquanto o popup está aberto.
setInterval(refresh, 2000);
