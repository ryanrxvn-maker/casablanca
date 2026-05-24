/**
 * Popup UI — mostra status, dispara sync manual, deixa configurar endpoint.
 */

const $ = (id) => document.getElementById(id);

const STATUS_MESSAGES = {
  ok: { title: '✓ Conectado', cls: 'ok', dot: 'ok' },
  'no-login': {
    title: '⚠ Faça login em magnific.com',
    cls: 'warn',
    dot: 'warn',
  },
  'no-darko': {
    title: '⚠ Auto Edit não detectado',
    cls: 'warn',
    dot: 'warn',
  },
  err: { title: '✗ Erro de sincronização', cls: 'err', dot: 'err' },
};

async function send(type, extra = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, ...extra }, (r) => resolve(r));
  });
}

function fmtTime(ts) {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'agora';
  if (diff < 3_600_000) return Math.round(diff / 60_000) + ' min atrás';
  if (diff < 86_400_000) return Math.round(diff / 3_600_000) + 'h atrás';
  return new Date(ts).toLocaleString('pt-BR');
}

function hostnameOf(url) {
  try { return new URL(url).hostname; } catch { return url; }
}

async function refresh() {
  const s = await send('get-status');
  const status = s?.lastStatus || 'no-login';
  const meta = STATUS_MESSAGES[status] || STATUS_MESSAGES.err;
  const ep = s?.endpoint || s?.discoveredOrigin;
  const sub = s?.lastError ||
    (status === 'ok'
      ? `Sincronizado com ${hostnameOf(ep) || 'Auto Edit'}. Pode disparar B-rolls.`
      : 'Veja o passo a passo abaixo.');

  $('statusTitle').textContent = meta.title;
  $('statusSub').textContent = sub;
  $('status').className = 'status ' + meta.cls;
  $('dot').className = 'dot ' + meta.dot;

  if (status === 'ok') {
    $('meta').hidden = false;
    $('metaPlan').textContent = s?.plan || '—';
    $('metaUid').textContent = s?.userId || '—';
    $('metaLast').textContent = fmtTime(s?.lastSync);
    $('metaEp').textContent = hostnameOf(ep) || '—';
  } else {
    $('meta').hidden = true;
  }
  if (s?.endpoint) $('endpoint').value = s.endpoint;
  else if (s?.discoveredOrigin) $('endpoint').placeholder = s.discoveredOrigin;
}

$('btnSync').addEventListener('click', async () => {
  $('btnSync').disabled = true;
  $('btnSync').textContent = 'Sincronizando…';
  await send('sync-now');
  await refresh();
  $('btnSync').disabled = false;
  $('btnSync').textContent = 'Re-sincronizar agora';
});

$('btnOpenMagnific').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://www.magnific.com' });
});

$('btnOpenDarko').addEventListener('click', async () => {
  const s = await send('get-status');
  const base = s?.endpoint || s?.discoveredOrigin || 'https://casablanca.vercel.app';
  chrome.tabs.create({ url: base + '/configuracoes/magnific' });
});

$('btnSaveEndpoint').addEventListener('click', async () => {
  const ep = $('endpoint').value.trim();
  if (!ep) return;
  $('btnSaveEndpoint').disabled = true;
  $('btnSaveEndpoint').textContent = 'Salvando…';
  await send('set-endpoint', { endpoint: ep });
  await refresh();
  $('btnSaveEndpoint').disabled = false;
  $('btnSaveEndpoint').textContent = 'Salvar endpoint';
});

refresh();
// Auto-refresh a cada 2s enquanto popup aberto
setInterval(refresh, 2000);
