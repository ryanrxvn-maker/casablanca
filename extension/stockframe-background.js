/**
 * StockFrame API module.
 *
 * The personal API key never crosses into the Auto Edit page. It lives in
 * chrome.storage.local and is sent only to biblioteca.stockframe.space.
 */
(function () {
  const API = 'https://biblioteca.stockframe.space/api/v1';
  const KEY_STORE = 'autoedit.stockframe.api-key.v1';
  const DOWNLOAD_OPS_STORE = 'autoedit.stockframe.download-ops.v1';
  const allowedActions = new Set(['status', 'configure', 'disconnect', 'list', 'smartSearch', 'mediaUrls', 'download']);
  const catalogCache = new Map();
  const calls = [];
  const downloads = [];
  const downloadOperations = new Map();
  let operationsLoaded;
  let operationsSave = Promise.resolve();
  const MAX_DOWNLOAD_BYTES = 256 * 1024 * 1024;
  const RATE_WINDOW_MS = 60_000;
  const REQUEST_LIMIT = 56;
  const DOWNLOAD_LIMIT = 18;
  const WAIT_TICK_MS = 5_000;
  const MAX_RETRY_WAIT_MS = 5 * 60_000;
  let apiBlockedUntil = 0;

  function allowedSender(sender) {
    try {
      const url = new URL(sender?.tab?.url || sender?.url || '');
      return url.protocol === 'https:' && (url.hostname === 'darkoautoedit.com' || url.hostname === 'www.darkoautoedit.com' || url.hostname.endsWith('.darkoautoedit.com')) ||
        url.protocol === 'http:' && url.hostname === 'localhost';
    } catch { return false; }
  }

  function emit(tabId, requestId, type, payload) {
    if (!tabId) return Promise.resolve();
    return chrome.tabs.sendMessage(tabId, {
      source: 'stockframe-background', type, requestId,
      ...(type === 'SF_ERROR' ? { error: payload?.error || String(payload) } : { payload }),
    }).catch(() => {});
  }

  async function key() {
    const stored = await chrome.storage.local.get(KEY_STORE);
    return typeof stored[KEY_STORE] === 'string' ? stored[KEY_STORE] : '';
  }

  function availableIn(list, limit) {
    const now = Date.now();
    while (list.length && now - list[0] >= RATE_WINDOW_MS) list.shift();
    return list.length >= limit ? RATE_WINDOW_MS - (now - list[0]) : 0;
  }

  async function waitWithProgress(waitMs, context) {
    const until = Date.now() + waitMs;
    while (Date.now() < until) {
      const remaining = until - Date.now();
      // A Chrome API message every five seconds also keeps the MV3 worker alive.
      await emit(context?.tabId, context?.requestId, 'SF_PROGRESS', {
        message: `Aguardando a próxima janela do StockFrame (${Math.ceil(remaining / 1000)}s)…`, percent: 4,
      });
      await new Promise((resolve) => setTimeout(resolve, Math.min(remaining, WAIT_TICK_MS)));
    }
  }

  async function reserveApiSlot(isDownload, context) {
    for (;;) {
      const waitMs = Math.max(availableIn(calls, REQUEST_LIMIT),
        isDownload ? availableIn(downloads, DOWNLOAD_LIMIT) : 0, apiBlockedUntil - Date.now());
      if (waitMs <= 0) {
        // No await between checking and reserving: concurrent requests cannot
        // take the same slot, and a download reserves both limits together.
        const now = Date.now();
        calls.push(now);
        if (isDownload) downloads.push(now);
        return;
      }
      await waitWithProgress(waitMs, context);
    }
  }

  function retryAfterMs(value) {
    const input = String(value || '').trim();
    if (/^\d+(?:\.\d+)?$/.test(input)) return Math.max(1_000, Math.ceil(Number(input) * 1_000));
    const date = Date.parse(input);
    return Number.isFinite(date) ? Math.max(1_000, date - Date.now()) : RATE_WINDOW_MS;
  }

  async function timedFetch(url, options, consume, context) {
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => { timedOut = true; controller.abort(); };
    let timeout = setTimeout(abort, 25_000);
    const heartbeat = setInterval(() => {
      emit(context?.tabId, context?.requestId, 'SF_PROGRESS', { message: 'Recebendo dados do StockFrame…', percent: 4 });
    }, WAIT_TICK_MS);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeout);
      timeout = setTimeout(abort, 120_000);
      return await consume(response);
    } catch (error) {
      if (timedOut) throw new Error('A conexão com o StockFrame demorou demais. Confira a conexão e sua cota antes de tentar novamente.');
      // A network failure may happen after the provider debited a download.
      // Never automatically repeat an ambiguous request.
      throw error;
    } finally {
      clearTimeout(timeout);
      clearInterval(heartbeat);
    }
  }

  function apiError(status, payload, retryAfter) {
    const code = String(payload?.error || payload?.code || payload?.message || '').toLowerCase();
    if (status === 401 || code.includes('invalid_api_key')) return new Error('Chave StockFrame inválida ou expirada. Gere uma nova em Meu perfil e API.');
    if (status === 402 || status === 403 || code.includes('subscription') || code.includes('plan')) return new Error('Esta conta não tem um plano StockFrame ativo com acesso a este conteúdo.');
    if (status === 404) return new Error('O take não existe mais ou não pertence ao catálogo desta conta.');
    if (code.includes('download') && (code.includes('limit') || code.includes('quota'))) return new Error('A cota diária de downloads desta conta StockFrame terminou.');
    if (status === 429) return new Error(`O StockFrame limitou as requisições. Aguarde ${Math.ceil(retryAfterMs(retryAfter) / 1000)}s e tente novamente.`);
    return new Error(String(payload?.message || payload?.error || `StockFrame respondeu HTTP ${status}.`).slice(0, 360));
  }

  async function apiFetch(path, options = {}, consume = (response) => response.json()) {
    const apiKey = options.apiKey || await key();
    if (!apiKey) throw new Error('Conecte a chave de uma conta StockFrame paga antes de continuar.');
    for (let attempt = 0; ; attempt++) {
      await reserveApiSlot(options.isDownload === true, options.context);
      let retry = false;
      const result = await timedFetch(`${API}${path}`, {
        method: options.body === undefined ? 'GET' : 'POST', cache: 'no-store', redirect: 'follow',
        headers: { Authorization: `Bearer ${apiKey}`, Accept: options.accept || 'application/json',
          ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}) },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      }, async (response) => {
        if (response.ok) return consume(response);
        let payload = {};
        try {
          const body = await response.text();
          try { payload = JSON.parse(body); } catch { payload = { message: body.slice(0, 360) }; }
        } catch {}
        const retryAfter = response.headers.get('retry-after');
        const code = String(payload?.error || payload?.code || payload?.message || '').toLowerCase();
        const quotaExhausted = code.includes('download') && (code.includes('limit') || code.includes('quota'));
        if (response.status === 429 && !quotaExhausted) {
          const waitMs = retryAfterMs(retryAfter);
          // Only an explicit rejection (429) is safe to retry. Bound retries
          // and never shorten a valid Retry-After supplied by the provider.
          if (Number.isFinite(waitMs)) apiBlockedUntil = Math.max(apiBlockedUntil, Date.now() + waitMs);
          if (attempt < 2 && waitMs <= MAX_RETRY_WAIT_MS) { retry = true; return null; }
        }
        throw apiError(response.status, payload, retryAfter);
      }, options.context);
      if (!retry) return result;
    }
  }

  async function me(apiKey, context) {
    const payload = await apiFetch('/me', { apiKey, context });
    if (!payload || typeof payload !== 'object') throw new Error('O StockFrame não devolveu os dados da conta.');
    assertPaidAccount(payload);
    return payload;
  }

  function assertPaidAccount(payload) {
    const source = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
    const subscription = source?.subscription && typeof source.subscription === 'object' ? source.subscription : {};
    const explicitActive = source?.has_active_plan ?? source?.hasActivePlan ?? source?.subscription_active ?? source?.subscriptionActive ?? subscription?.active;
    const plan = String(source?.plan || source?.pack || subscription?.plan || subscription?.status || '').toLowerCase();
    const limitRaw = source?.downloads_limit ?? source?.downloadsLimit ?? source?.daily_limit ?? source?.dailyLimit ?? source?.downloads?.limit ?? source?.quota?.limit;
    const limit = limitRaw === undefined || limitRaw === null ? null : Number(limitRaw);
    if (explicitActive === false || ['free', 'inactive', 'expired', 'cancelled', 'canceled'].includes(plan) || (Number.isFinite(limit) && limit <= 0)) {
      throw new Error('Esta integração exige uma conta StockFrame paga e ativa. Assine ou reative o plano antes de conectar.');
    }
  }

  function filtersQuery(value) {
    const source = value && typeof value === 'object' ? value : {};
    const query = new URLSearchParams();
    const page = Number(source.page || 1);
    const perPage = Number(source.perPage || 24);
    query.set('page', String(Number.isInteger(page) && page > 0 ? Math.min(page, 9999) : 1));
    query.set('per_page', String(Number.isInteger(perPage) && perPage > 0 ? Math.min(perPage, 48) : 24));
    if (typeof source.search === 'string' && source.search.trim()) query.set('search', source.search.trim().slice(0, 180));
    if (typeof source.nicheId === 'string' && /^[\w-]{1,180}$/.test(source.nicheId)) query.set('niche_id', source.nicheId);
    if (typeof source.subcategoryId === 'string' && /^[\w-]{1,180}$/.test(source.subcategoryId)) query.set('subcategory_id', source.subcategoryId);
    if (source.aspectRatio === '9:16' || source.aspectRatio === '16:9') query.set('aspect_ratio', source.aspectRatio);
    if (typeof source.audio === 'boolean') query.set('audio', source.audio ? 'true' : 'false');
    if (source.origin === 'organic' || source.origin === 'ai') query.set('origin', source.origin);
    if (source.favorites === true) query.set('favorites', 'true');
    if (['downloads', 'recent', 'relevance'].includes(source.sort)) query.set('sort', source.sort);
    return query.toString();
  }

  async function list(filters, context) {
    const query = filtersQuery(filters);
    const cached = catalogCache.get(query);
    if (cached && Date.now() - cached.at < 25_000) return cached.data;
    const data = await apiFetch(`/videos?${query}`, { context });
    catalogCache.set(query, { at: Date.now(), data });
    if (catalogCache.size > 40) catalogCache.delete(catalogCache.keys().next().value);
    return data;
  }

  async function loadDownloadOperations() {
    if (!operationsLoaded) operationsLoaded = chrome.storage.local.get(DOWNLOAD_OPS_STORE).then((stored) => {
      const rows = stored[DOWNLOAD_OPS_STORE];
      if (!rows || typeof rows !== 'object') return;
      for (const [scope, operation] of Object.entries(rows)) {
        if (!operation || typeof operation.id !== 'string' || typeof operation.at !== 'number') continue;
        if (Date.now() - operation.at < 24 * 60 * 60_000 && !downloadOperations.has(scope)) downloadOperations.set(scope, operation);
      }
    });
    await operationsLoaded;
  }

  async function saveDownloadOperations() {
    operationsSave = operationsSave.then(() => chrome.storage.local.set({ [DOWNLOAD_OPS_STORE]: Object.fromEntries(downloadOperations) }));
    await operationsSave;
  }

  async function smartSearch(payload, context) {
    const queries = Array.isArray(payload?.queries) ? payload.queries : [];
    if (!queries.length || queries.length > 16) throw new Error('Envie entre 1 e 16 trechos para o Smart Stocks.');
    const safeQueries = queries.map((query) => {
      if (!/^[\w-]{1,180}$/.test(String(query?.id || ''))) throw new Error('Identificador de trecho inválido.');
      const text = String(query?.text || '').trim();
      if (!text || text.length > 2000) throw new Error('Texto de trecho inválido.');
      const string = (value, limit) => typeof value === 'string' ? value.slice(0, limit) : undefined;
      const ids = (value) => Array.isArray(value) ? value.filter((id) => typeof id === 'string' && /^[\w-]{1,180}$/.test(id)).slice(0, 100) : [];
      return {
        id: query.id, text,
        context_before: string(query.context_before, 1000), context_after: string(query.context_after, 1000),
        full_copy_summary: string(query.full_copy_summary, 1000),
        desired_duration: Math.max(2, Math.min(20, Number(query.desired_duration) || 6)),
        niche_id: string(query.niche_id, 180) || null,
        subcategory_id: string(query.subcategory_id, 180) || null,
        aspect_ratio: ['9:16', '16:9'].includes(query.aspect_ratio) ? query.aspect_ratio : undefined,
        origin: ['organic', 'ai'].includes(query.origin) ? query.origin : undefined,
        exclude_video_ids: ids(query.exclude_video_ids),
        exclude_duplicate_groups: ids(query.exclude_duplicate_groups),
      };
    });
    return apiFetch('/videos/smart-search', { body: { queries: safeQueries, results_per_query: 20 }, context });
  }

  async function mediaUrls(videoIds, context) {
    const ids = [...new Set(Array.isArray(videoIds) ? videoIds : [])]
      .filter((id) => typeof id === 'string' && /^[\w-]{1,180}$/.test(id)).slice(0, 100);
    if (!ids.length) return { videos: [] };
    return apiFetch('/videos/media-urls', { body: { video_ids: ids }, context });
  }

  function contentDispositionFilename(value) {
    if (!value) return '';
    const encoded = /filename\*=UTF-8''([^;]+)/i.exec(value)?.[1];
    if (encoded) { try { return decodeURIComponent(encoded); } catch {} }
    return /filename="?([^";]+)"?/i.exec(value)?.[1] || '';
  }

  async function readVideo(response) {
    const contentType = (response.headers.get('content-type') || 'video/mp4').split(';')[0].trim().toLowerCase();
    if (!(contentType.startsWith('video/') || contentType === 'application/octet-stream')) {
      throw new Error(`O download devolveu ${contentType}, não um vídeo.`);
    }
    const lengthHeader = response.headers.get('content-length');
    const length = lengthHeader === null ? null : Number(lengthHeader);
    if (length !== null && Number.isFinite(length) && (length <= 0 || length > MAX_DOWNLOAD_BYTES)) {
      throw new Error('O arquivo do StockFrame está vazio ou excede 256 MB.');
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_DOWNLOAD_BYTES) throw new Error('O arquivo do StockFrame está vazio ou excede 256 MB.');
    return { bytes, mimeType: contentType === 'application/octet-stream' ? 'video/mp4' : contentType,
      filename: contentDispositionFilename(response.headers.get('content-disposition')) };
  }

  async function downloadableResponse(videoId, taskId, context) {
    const apiKey = await key();
    if (!apiKey) throw new Error('Conecte a chave de uma conta StockFrame paga antes de continuar.');
    const keyHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(apiKey));
    const accountScope = Array.from(new Uint8Array(keyHash).slice(0, 16), (byte) => byte.toString(16).padStart(2, '0')).join('');
    await loadDownloadOperations();
    for (const [scope, operation] of downloadOperations) {
      if (Date.now() - operation.at >= 24 * 60 * 60_000) downloadOperations.delete(scope);
    }
    const operationScope = JSON.stringify([accountScope, taskId, videoId]);
    const operation = downloadOperations.get(operationScope);
    const idempotencyKey = operation && Date.now() - operation.at < 24 * 60 * 60_000
      ? operation.id : crypto.randomUUID();
    downloadOperations.set(operationScope, { id: idempotencyKey, at: operation?.at || Date.now() });
    // Persist before making a quota-consuming call: an MV3 worker restart or
    // a broken transfer must not silently create a second operation.
    await saveDownloadOperations();
    const result = await apiFetch(`/videos/${encodeURIComponent(videoId)}/download`, {
      apiKey, accept: 'video/*,application/octet-stream,application/json', isDownload: true, context, idempotencyKey,
    }, async (response) => {
      if (!(response.headers.get('content-type') || '').toLowerCase().includes('application/json')) return readVideo(response);
      const payload = await response.json();
      return { remote: payload?.download_url || payload?.downloadUrl || payload?.url || payload?.data?.url };
    });
    if (result?.bytes) return result;
    if (typeof result?.remote !== 'string') throw new Error('O endpoint de download não devolveu o arquivo do take.');
    const url = new URL(result.remote);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('O StockFrame devolveu um endereço de download inválido.');
    const downloaded = await timedFetch(url.toString(), { method: 'GET', cache: 'no-store', redirect: 'follow' }, async (response) => {
      if (!response.ok) throw apiError(response.status, {}, response.headers.get('retry-after'));
      return readVideo(response);
    }, context);
    return downloaded;
  }

  function base64(bytes) {
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary);
  }

  async function download(tabId, requestId, videoId, taskId = 'pilot') {
    if (typeof videoId !== 'string' || !/^[\w-]{1,180}$/.test(videoId)) throw new Error('Identificador de take inválido.');
    if (typeof taskId !== 'string' || !taskId.trim() || taskId.length > 500) throw new Error('Identificador de projeto inválido.');
    await emit(tabId, requestId, 'SF_PROGRESS', { message: 'Preparando o take no StockFrame…', percent: 4 });
    const { bytes, mimeType, filename } = await downloadableResponse(videoId, taskId, { tabId, requestId });
    const chunkSize = 512 * 1024;
    const total = Math.ceil(bytes.length / chunkSize);
    for (let index = 0; index < total; index++) {
      const chunk = bytes.subarray(index * chunkSize, Math.min(bytes.length, (index + 1) * chunkSize));
      await emit(tabId, requestId, 'SF_DOWNLOAD_CHUNK', { index, data: base64(chunk) });
      if (index % 4 === 0 || index === total - 1) {
        await emit(tabId, requestId, 'SF_PROGRESS', { message: 'Transferindo o take para a montagem…', percent: Math.round(((index + 1) / total) * 94) + 5 });
      }
    }
    return {
      totalChunks: total,
      mimeType,
      filename,
      bytes: bytes.length,
    };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== 'SF_REQUEST' || !allowedActions.has(message.action) || !allowedSender(sender)) return false;
    const tabId = sender.tab?.id;
    const requestId = message.requestId;
    if (typeof requestId !== 'string' || !/^sf_[\w-]{1,180}$/.test(requestId)) return false;
    sendResponse({ accepted: true });
    const context = { tabId, requestId };
    emit(tabId, requestId, 'SF_ACK', {}).then(async () => {
      if (message.action === 'configure') {
        const apiKey = String(message.payload?.apiKey || '').trim();
        if (apiKey.length < 12 || apiKey.length > 1024) throw new Error('Chave StockFrame inválida.');
        const account = await me(apiKey, context);
        await chrome.storage.local.set({ [KEY_STORE]: apiKey });
        catalogCache.clear();
        downloadOperations.clear();
        await chrome.storage.local.remove(DOWNLOAD_OPS_STORE);
        return { configured: true, account };
      }
      if (message.action === 'disconnect') {
        await chrome.storage.local.remove(KEY_STORE);
        catalogCache.clear();
        downloadOperations.clear();
        await chrome.storage.local.remove(DOWNLOAD_OPS_STORE);
        return { configured: false };
      }
      if (message.action === 'status') {
        const apiKey = await key();
        if (!apiKey) return { configured: false, version: chrome.runtime.getManifest().version };
        try {
          return { configured: true, account: await me(apiKey, context), version: chrome.runtime.getManifest().version };
        } catch (error) {
          return { configured: false, error: error?.message || String(error), version: chrome.runtime.getManifest().version };
        }
      }
      if (message.action === 'list') return { data: await list(message.payload?.filters, context) };
      if (message.action === 'smartSearch') return { data: await smartSearch(message.payload, context) };
      if (message.action === 'mediaUrls') return { data: await mediaUrls(message.payload?.videoIds, context) };
      if (message.action === 'download') return await download(tabId, requestId, message.payload?.videoId, message.payload?.taskId || 'pilot');
      throw new Error('Operação StockFrame desconhecida.');
    }).then((result) => emit(tabId, requestId, 'SF_RESULT', result))
      .catch((error) => emit(tabId, requestId, 'SF_ERROR', { error: error?.message || String(error) }));
    return true;
  });

  console.log('[AutoEdit StockFrame] API module online');
})();
