/* Flow automation is isolated from all HeyGen state, tabs and CDP helpers. */
(() => {
  const STORE = 'autoedit.flow.jobs.v1';
  const TAB_STORE = 'autoedit.flow.tab.v1';
  const jobs = new Map();
  const debuggers = new Map();
  const downloads = new Map();
  const choosers = new Map();
  const generationEvidence = new Map();
  let busyOperation = null;
  let persistence = Promise.resolve();
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const deadline = (promise, ms, message) => {
    let timer;
    return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })]).finally(() => clearTimeout(timer));
  };
  const errorText = (error) => String(error?.message || error);
  const isFlow = (value) => { try { const url = new URL(value); return url.protocol === 'https:' && (url.hostname === 'flow.google.com' || (url.hostname === 'labs.google' && url.pathname.includes('/flow'))); } catch { return false; } };
  const isPilot = (value) => { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && (url.hostname === 'localhost' || url.hostname === 'darkoautoedit.com' || url.hostname.endsWith('.darkoautoedit.com')); } catch { return false; } };
  function emit(tabId, requestId, type, payload) {
    return chrome.tabs.sendMessage(tabId, { source: 'flow-background', type, requestId, ...(type === 'FLOW_ERROR' ? { error: payload.error, payload } : { payload }) }).catch(() => {});
  }
  async function save(job) {
    jobs.set(job.requestId, job);
    const write = async () => {
      const existing = (await chrome.storage.local.get(STORE))[STORE] || {};
      // Persist only metadata; never account credentials or uploaded reference bytes.
      existing[job.requestId] = { ...job, references: undefined };
      const entries = Object.entries(existing).sort((a, b) => b[1].updatedAt - a[1].updatedAt).slice(0, 100);
      await chrome.storage.local.set({ [STORE]: Object.fromEntries(entries) });
    };
    persistence = persistence.then(write, write);
    await persistence;
  }
  async function loadJob(id) { return jobs.get(id) || (await chrome.storage.local.get(STORE))[STORE]?.[id] || null; }
  async function update(job, state, stage, extra = {}) {
    Object.assign(job, extra, { state, stage, updatedAt: Date.now() });
    await save(job);
    await emit(job.bridgeTabId, job.requestId, 'FLOW_PROGRESS', { state, stage, ...extra });
  }
  function callbackCall(method, ...args) {
    return deadline(new Promise((resolve, reject) => method(...args, (value) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message)); else resolve(value);
    })), 12000, 'O Chrome não respondeu ao controle do Flow.');
  }
  async function attach(tabId) {
    if (debuggers.has(tabId)) return debuggers.get(tabId);
    const operation = callbackCall(chrome.debugger.attach.bind(chrome.debugger), { tabId }, '1.3');
    debuggers.set(tabId, operation);
    try { await operation; }
    catch (error) { debuggers.delete(tabId); throw new Error(`Não foi possível controlar a aba do Flow: ${errorText(error)}. Feche o DevTools dessa aba e tente novamente.`); }
  }
  async function cdp(tabId, method, params = {}) {
    await attach(tabId);
    return callbackCall(chrome.debugger.sendCommand.bind(chrome.debugger), { tabId }, method, params);
  }
  async function detach(tabId) {
    if (!debuggers.has(tabId)) return;
    debuggers.delete(tabId);
    await callbackCall(chrome.debugger.detach.bind(chrome.debugger), { tabId }).catch(() => {});
  }
  chrome.debugger.onDetach.addListener((source) => { debuggers.delete(source.tabId); });
  function requestContainsPrompt(postData, prompt) {
    if (typeof postData !== 'string' || !prompt) return false;
    const visit = (value, depth = 0) => {
      if (depth > 20) return false;
      if (typeof value === 'string') {
        if (value.includes(prompt)) return true;
        if (depth < 4 && /^[\s]*[\[{]/.test(value)) { try { return visit(JSON.parse(value), depth + 1); } catch {} }
        return false;
      }
      return Boolean(value && typeof value === 'object' && Object.values(value).some((child) => visit(child, depth + 1)));
    };
    try { return visit(JSON.parse(postData)); } catch { return postData.includes(prompt); }
  }
  function generationEndpoint(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || !(url.hostname === 'flow.google.com' || url.hostname === 'labs.google' || url.hostname.endsWith('.googleapis.com'))) return false;
      const endpoint = `${url.hostname}${url.pathname}`;
      if (/analytics|telemetry|logging|metrics|autosave|draft|suggest|feedback/i.test(endpoint)) return false;
      return /generat|predict|render/i.test(url.pathname);
    } catch { return false; }
  }
  chrome.debugger.onEvent.addListener((source, method, params) => {
    if ((method === 'Page.downloadWillBegin' || method === 'Browser.downloadWillBegin') && downloads.has(source.tabId)) downloads.get(source.tabId).resolve(params);
    if (method === 'Page.fileChooserOpened' && choosers.has(source.tabId)) choosers.get(source.tabId)(params);
    const evidence = generationEvidence.get(source.tabId);
    if (evidence && method === 'Network.requestWillBeSent' && params.request?.method === 'POST' && params.request.postData) {
      if (requestContainsPrompt(params.request.postData, evidence.prompt)) {
        const acceptedEndpoint = generationEndpoint(params.request.url);
        let endpoint = '';
        try { const url = new URL(params.request.url); endpoint = url.origin + url.pathname; } catch {}
        evidence.diagnostics.push({ endpoint, generationEndpoint: acceptedEndpoint, observedAt: Date.now() });
        if (acceptedEndpoint) {
          evidence.requests.add(params.requestId);
          evidence.sentAt = evidence.sentAt || Date.now();
        }
        const job = jobs.get(evidence.requestId);
        if (job) {
          job.submissionDiagnostics = { requestCount: evidence.requests.size, sentAt: evidence.sentAt || null, endpoints: evidence.diagnostics.slice(-8) };
          void save(job);
        }
      }
    }
    if (evidence && method === 'Network.responseReceived' && evidence.requests.has(params.requestId)) {
      const status = params.response?.status;
      evidence.httpStatus = status;
      if (status >= 400) evidence.error = `O Flow respondeu HTTP ${status} ao pedido de geração.`;
      const job = jobs.get(evidence.requestId);
      if (job) { job.submissionDiagnostics = { ...job.submissionDiagnostics, httpStatus: status }; void save(job); }
    }
    if (evidence && method === 'Network.loadingFailed' && evidence.requests.has(params.requestId)) {
      evidence.error = 'A conexão do pedido de geração com o Flow falhou. Confira o projeto antes de tentar novamente.';
    }
    if (evidence && method === 'Network.loadingFinished' && evidence.requests.has(params.requestId)) {
      // Read only responses to this exact prompt. Keep UUIDs, never tokens or
      // request headers. This binds generated cards to the submitted request.
      void cdp(source.tabId, 'Network.getResponseBody', { requestId: params.requestId }).then((response) => {
        if (response.base64Encoded) return;
        try { if (JSON.parse(response.body)?.error) evidence.error = 'O Flow recusou o pedido de geração. Confira o aviso no projeto.'; } catch {}
        for (const id of response.body.match(/[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}/gi) || []) evidence.ids.add(id.toLowerCase());
        const job = jobs.get(evidence.requestId);
        if (job) { job.evidenceIds = [...evidence.ids]; void save(job); }
      }).catch(() => {});
    }
  });
  async function dom(tabId, op, payload = {}) {
    const response = await deadline(chrome.tabs.sendMessage(tabId, { type: 'FLOW_DOM', op, payload }), op === 'blobDownloadStart' ? 90000 : op === 'dimensions' ? 25000 : 12000, `O Flow demorou para responder (${op}).`);
    if (!response?.ok) throw new Error(response?.error || 'O adaptador do Flow não respondeu. Recarregue a extensão e o Pilot.');
    return response.result;
  }
  async function observeSubmission(job, evidence) {
    if (evidence.domObserved) return;
    const observation = await dom(job.tabId, 'generationObservation', { prompt: evidence.prompt });
    if (observation.promptMatches > (job.baselinePromptMatches || 0)) {
      evidence.domObserved = true;
      job.submissionDiagnostics = { ...job.submissionDiagnostics, domPromptObservedAt: Date.now() };
      await save(job);
    }
  }
  async function waitForSubmission(job, evidence, timeout = 20000, observe = null) {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      if (evidence.error) throw new Error(evidence.error);
      if (jobs.get(job.requestId)?.cancelRequested) throw new Error('Acompanhamento cancelado durante a confirmação do envio. Confira o Flow antes de gerar novamente.');
      if (observe) await observe();
      if ((evidence.sentAt && evidence.requests.size > 0) || evidence.domObserved) return;
      await sleep(200);
    }
    const error = new Error('O Flow não confirmou o envio do pedido em 20 segundos. Confira o projeto antes de tentar novamente; o Pilot não repetiu o clique.');
    error.code = 'FLOW_SUBMISSION_UNCONFIRMED';
    throw error;
  }
  async function click(tabId, point) {
    await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
    await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    await sleep(160);
  }
  async function waitDom(tabId, op, payload = {}, accept = () => true, description = op, timeout = 10000) {
    const until = Date.now() + timeout;
    let lastError = '';
    while (Date.now() < until) {
      try {
        const value = await dom(tabId, op, payload);
        if (accept(value)) return value;
      } catch (error) { lastError = errorText(error); }
      await sleep(200);
    }
    throw new Error(`O Flow não confirmou ${description} em ${Math.round(timeout / 1000)} segundos.${lastError ? ' ' + lastError : ''}`);
  }
  async function clickButton(tabId, name) {
    await waitDom(tabId, 'button', { name }, () => true, `o botão ${name}`);
    return dom(tabId, 'activateButton', { name });
  }
  async function assertDownloadRoute(tabId, detailUrl) {
    const expected = new URL(detailUrl);
    const current = new URL((await chrome.tabs.get(tabId)).url);
    if (current.origin !== expected.origin || current.pathname.replace(/\/$/, '') !== expected.pathname.replace(/\/$/, '')) throw new Error('O Flow saiu do resultado selecionado antes do download. Nenhum outro arquivo será baixado.');
  }
  async function activateWithUserGesture(tabId, kind, name, requestId, detailUrl = null) {
    await waitDom(tabId, kind === 'upload' ? 'button' : 'menu', { name }, () => true, `o controle ${name}`);
    if (detailUrl) await assertDownloadRoute(tabId, detailUrl);
    const expectedLocation = detailUrl ? { origin: new URL(detailUrl).origin, pathname: new URL(detailUrl).pathname.replace(/\/$/, '') } : null;
    const token = crypto.randomUUID();
    await dom(tabId, 'prepareGestureActivation', { kind, name, requestId, token });
    const result = await cdp(tabId, 'Runtime.evaluate', {
      expression: `(() => {
        const expectedLocation = ${JSON.stringify(expectedLocation)};
        if (expectedLocation && (location.origin !== expectedLocation.origin || location.pathname.replace(/\\/$/, '') !== expectedLocation.pathname)) throw new Error('O Flow saiu do resultado selecionado antes do clique de download.');
        const target = document.querySelector('[data-pilot-flow-activation="' + ${JSON.stringify(token)} + '"]');
        if (!target || target.disabled || target.getAttribute('aria-disabled') === 'true') throw new Error('O controle do Flow mudou antes da ativação.');
        target.removeAttribute('data-pilot-flow-activation');
        target.click();
        return { activated: true };
      })()`,
      userGesture: true, returnByValue: true,
    });
    if (result.exceptionDetails || result.result?.value?.activated !== true) throw new Error('O Flow não confirmou a ativação do controle. O clique não será repetido.');
  }
  async function openSettings(tabId) {
    const state = await dom(tabId, 'uiState');
    if (state.settingsOpen) return;
    await clickButton(tabId, 'Gatilho de configurações');
    await waitDom(tabId, 'uiState', {}, (value) => value.settingsOpen, 'a abertura das configurações');
  }
  async function openModelMenu(tabId) {
    const state = await dom(tabId, 'uiState');
    if (state.modelMenuOpen) return;
    await clickButton(tabId, 'Selecionar família de modelos');
    await waitDom(tabId, 'uiState', {}, (value) => value.modelMenuOpen && value.models.length > 0, 'a abertura da lista de motores');
  }
  async function closeSettings(tabId) {
    const state = await dom(tabId, 'uiState');
    if (!state.settingsOpen) return;
    await clickButton(tabId, 'Gatilho de configurações');
    await waitDom(tabId, 'uiState', {}, (value) => !value.settingsOpen, 'o fechamento das configurações');
  }
  async function key(tabId, keyName, code, modifiers = 0) {
    await cdp(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', key: keyName, code, modifiers, windowsVirtualKeyCode: keyName === 'Backspace' ? 8 : keyName === 'Escape' ? 27 : keyName === 'a' ? 65 : undefined });
    await cdp(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code, modifiers });
  }
  async function waitReady(tabId, op = 'editor', timeout = 40000) {
    let refreshedAdapter = false;
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      const tab = await chrome.tabs.get(tabId);
      if (!isFlow(tab.url || tab.pendingUrl)) throw new Error('Entre na sua conta Google no Flow e abra um projeto antes de continuar.');
      if (tab.status === 'complete') {
        try {
          await chrome.scripting.executeScript({ target: { tabId }, files: ['flow-content.js'] });
          const adapter = await dom(tabId, 'ping');
          if (adapter.version !== chrome.runtime.getManifest().version) {
            if (!refreshedAdapter) { refreshedAdapter = true; await chrome.tabs.reload(tabId); }
            throw new Error('Atualizando o adaptador do Flow nesta aba…');
          }
          const value = await dom(tabId, op);
          if (op === 'downloadReady' && !value.ready) throw new Error('Carregando a mídia…');
          return;
        } catch { /* Angular is still mounting its editor. */ }
      }
      await sleep(500);
    }
    const error = new Error(op === 'downloadReady'
      ? 'O resultado apareceu no Flow, mas o arquivo ainda está sendo preparado. O Pilot continuará acompanhando automaticamente.'
      : `O projeto do Flow não abriu em ${Math.round(timeout / 1000)} segundos. Abra o Flow e confira se sua conta está conectada.`);
    error.code = op === 'downloadReady' ? 'FLOW_MEDIA_NOT_READY' : 'FLOW_PROJECT_NOT_READY';
    throw error;
  }
  async function tabFor(projectUrl) {
    if (projectUrl && !isFlow(projectUrl)) throw new Error('Use um endereço de projeto do Google Flow.');
    let target = projectUrl;
    if (!target) {
      const tabs = await chrome.tabs.query({ url: ['https://flow.google.com/*', 'https://labs.google/*'] });
      target = tabs.filter((tab) => isFlow(tab.url) && /\/project\//.test(tab.url)).sort((a, b) => Number(b.active) - Number(a.active))[0]?.url;
    }
    if (!target || !/\/project\//.test(new URL(target).pathname)) throw new Error('Abra um projeto no Flow para conectar esta conta ao Pilot.');
    const stored = (await chrome.storage.local.get(TAB_STORE))[TAB_STORE];
    let tab;
    if (stored) {
      try {
        const candidate = await chrome.tabs.get(stored);
        if (isFlow(candidate.url) && candidate.active === false) tab = candidate;
      } catch { /* The dedicated tab was closed. */ }
    }
    if (!tab) {
      tab = await chrome.tabs.create({ url: target, active: false });
      await chrome.storage.local.set({ [TAB_STORE]: tab.id });
    } else if (tab.url !== target || tab.discarded) {
      await chrome.tabs.update(tab.id, { url: target, active: false });
    }
    await waitReady(tab.id);
    return tab.id;
  }
  async function readAccount(tabId) {
    await closeSettings(tabId);
    // The header already exposes the signed-in identity even before its panel
    // opens. Keep it as a safe fallback for background project tabs, where
    // Flow may defer mounting the account overlay until the tab is foreground.
    const headerAccount = await dom(tabId, 'account');
    if (headerAccount?.email && Number.isFinite(headerAccount.credits)) return headerAccount;
    const state = await dom(tabId, 'uiState');
    try {
      if (!state.accountOpen) {
        await waitDom(tabId, 'accountButton', {}, () => true, 'o controle da conta');
        await dom(tabId, 'activateAccount');
      }
      await waitDom(tabId, 'uiState', {}, (value) => value.accountOpen, 'a abertura da conta Google');
      const account = await waitDom(tabId, 'account', {}, (value) => Boolean(value?.email), 'os dados da conta Google');
      await clickButton(tabId, 'Fechar painel da conta');
      await waitDom(tabId, 'uiState', {}, (value) => !value.accountOpen, 'o fechamento da conta Google');
      return account;
    } catch (error) {
      if (headerAccount?.email) return headerAccount;
      throw error;
    }
  }
  function validate(payload, generating = false) {
    if (!['image', 'video'].includes(payload.mode)) throw new Error('Escolha Imagem ou Vídeo.');
    if (!['16:9', '9:16'].includes(payload.aspectRatio)) throw new Error('Escolha o formato 16:9 ou 9:16.');
    if (!Number.isInteger(payload.count) || payload.count < 1 || payload.count > 4) throw new Error('A quantidade deve ser de 1 a 4 resultados.');
    if (typeof payload.model !== 'string' || !payload.model.trim()) throw new Error('Selecione um motor do Flow.');
    if (payload.mode === 'video' && ![4, 6, 8, 10].includes(payload.durationSeconds)) throw new Error('Escolha uma duração disponível no Flow.');
    if (payload.mode === 'video' && !['360p', '720p'].includes(payload.resolution)) throw new Error('Escolha a resolução de geração. O download será em 1080p.');
    const references = payload.references || [];
    if (!Array.isArray(references) || references.length > 4) throw new Error('Use até 4 imagens de referência.');
    if (payload.mode === 'video' && payload.videoMode && !['frames', 'ingredients'].includes(payload.videoMode)) throw new Error('Escolha Frames ou Elementos para as referências de vídeo.');
    if (payload.mode === 'video' && payload.videoMode !== 'ingredients' && references.length > 2) throw new Error('Frames aceita até 2 imagens: Início e Fim. Para mais referências, escolha Elementos.');
    for (const reference of references) {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(reference.mimeType) || !String(reference.dataUrl).startsWith(`data:${reference.mimeType};base64,`)) throw new Error('A referência precisa ser uma imagem PNG, JPG ou WebP válida.');
      if (reference.dataUrl.length > 14 * 1024 * 1024) throw new Error('Cada referência pode ter até 10 MB.');
    }
    if (generating) {
      if (payload.animateMediaId && !references.length) throw new Error('Baixe a imagem gerada e inclua-a como referência para animar.');
      if (typeof payload.prompt !== 'string' || !payload.prompt.trim() || payload.prompt.length > 12000) throw new Error('Escreva um prompt com até 12.000 caracteres.');
      if (!payload.expectedAccountEmail || !Number.isFinite(payload.maxCredits) || payload.maxCredits < 0) throw new Error('Atualize a conta e a previsão de créditos antes de gerar.');
    }
  }
  async function choose(tabId, name) {
    let control;
    for (let attempt = 0; attempt < 20; attempt++) {
      try { control = await dom(tabId, 'radio', { name }); break; } catch (error) { if (attempt === 19) throw error; await sleep(150); }
    }
    if (!control.selected) await dom(tabId, 'activateRadio', { name });
    for (let attempt = 0; attempt < 20; attempt++) {
      const checked = await dom(tabId, 'radio', { name }).catch(() => null);
      if (checked?.selected) return;
      await sleep(150);
    }
    throw new Error(`O Flow não confirmou a opção ${name}. Nenhum crédito foi gasto.`);
  }
  function verifyConfigured(controls, payload) {
    if (controls.model !== payload.model) throw new Error(`O Flow selecionou ${controls.model || 'um motor desconhecido'}, diferente de ${payload.model}. Nenhuma geração foi disparada.`);
    const required = [payload.mode === 'image' ? 'Imagem' : 'Vídeo', payload.aspectRatio, `x${payload.count}`];
    if (payload.mode === 'video') required.push(payload.videoMode === 'ingredients' ? 'Elementos' : 'Frames', payload.resolution, `${payload.durationSeconds}s`);
    if (!required.every((value) => controls.selected.includes(value))) throw new Error('O Flow alterou uma opção ao trocar o motor. Confira as opções disponíveis antes de gerar.');
    return controls;
  }
  async function configure(tabId, payload) {
    await openSettings(tabId);
    await choose(tabId, payload.mode === 'image' ? 'Imagem' : 'Vídeo');
    let controls = await dom(tabId, 'settings');
    if (controls.model !== payload.model) {
      await openModelMenu(tabId);
      await waitDom(tabId, 'model', { name: payload.model }, () => true, `o motor ${payload.model}`);
      await dom(tabId, 'activateModel', { name: payload.model });
      await waitDom(tabId, 'uiState', {}, (value) => !value.modelMenuOpen && value.settingsOpen, 'a seleção do motor');
    }
    if (payload.mode === 'video') await choose(tabId, payload.videoMode === 'ingredients' ? 'Elementos' : 'Frames');
    await choose(tabId, payload.aspectRatio);
    if (payload.mode === 'video') {
      await choose(tabId, payload.resolution);
      await choose(tabId, `${payload.durationSeconds}s`);
    }
    await choose(tabId, `x${payload.count}`);
    controls = verifyConfigured(await dom(tabId, 'settings'), payload);
    await closeSettings(tabId);
    return controls;
  }
  async function confirmConfiguration(tabId, payload) {
    await openSettings(tabId);
    try { return verifyConfigured(await dom(tabId, 'settings'), payload); }
    finally { await closeSettings(tabId); }
  }
  async function inspect(payload) {
    if (payload.mode !== undefined && !['image', 'video'].includes(payload.mode)) throw new Error('Escolha Imagem ou Vídeo para consultar o Flow.');
    if (payload.model !== undefined && (typeof payload.model !== 'string' || !payload.model.trim() || payload.model.length > 100)) throw new Error('Escolha um motor válido para consultar o Flow.');
    const tabId = await tabFor(payload.projectUrl);
    try {
      const account = await readAccount(tabId);
      await openSettings(tabId);
      if (payload.mode) await choose(tabId, payload.mode === 'image' ? 'Imagem' : 'Vídeo');
      await openModelMenu(tabId);
      const info = await waitDom(tabId, 'inspect', {}, (value) => value.models?.length > 0, 'a lista de motores disponíveis');
      if (payload.model) {
        if (!info.models.includes(payload.model)) throw new Error(`O motor ${payload.model} não está disponível neste modo do Flow. Escolha um dos motores apresentados pela conta.`);
        await dom(tabId, 'activateModel', { name: payload.model });
        await waitDom(tabId, 'uiState', {}, (value) => !value.modelMenuOpen && value.settingsOpen, 'a seleção do motor');
      }
      const controls = await waitDom(tabId, 'settings', {}, (value) =>
        Boolean(value.model && value.available?.length && (!payload.model || value.model === payload.model) &&
          (!payload.mode || value.selected?.includes(payload.mode === 'image' ? 'Imagem' : 'Vídeo'))), 'as opções disponíveis para esse motor');
      const mode = controls.selected.includes('Imagem') ? 'image' : controls.selected.includes('Vídeo') ? 'video' : null;
      if (!mode) throw new Error('O Flow não confirmou se o modo atual é imagem ou vídeo.');
      await closeSettings(tabId);
      return { account, projectUrl: info.projectUrl, mode, models: info.models, controls, quote: controls.credits };
    } finally { await detach(tabId); }
  }
  async function quote(payload) {
    validate(payload);
    const tabId = await tabFor(payload.projectUrl);
    try {
      const account = await readAccount(tabId);
      const controls = await configure(tabId, payload);
      return { account, credits: controls.credits, controls, projectUrl: (await chrome.tabs.get(tabId)).url };
    } finally { await detach(tabId); }
  }
  function uniqueReferenceName(requestId, index, mimeType, nonce = crypto.randomUUID()) {
    const id = String(requestId).replace(/[^a-zA-Z0-9_-]/g, '').slice(-48);
    const suffix = String(nonce).replace(/[^a-zA-Z0-9]/g, '').slice(0, 12);
    const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[mimeType];
    if (!extension) throw new Error('Formato de referência inválido.');
    return `pilot-flow-${id}-${index + 1}-${suffix}.${extension}`;
  }
  function sameReferenceIds(actual, expected) {
    const expectedSorted = [...expected].sort();
    return Array.isArray(actual) && actual.length === expectedSorted.length && [...actual].sort().every((id, index) => id === expectedSorted[index]);
  }
  function sameFrameIds(actual, expected) {
    return Array.isArray(actual) && actual.length === 2 && expected.length <= 2 && actual[0] === (expected[0] || null) && actual[1] === (expected[1] || null);
  }
  async function promptFingerprint(prompt) {
    const canonical = String(prompt || '').replace(/\r\n/g, '\n').trim();
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
    return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('');
  }
  async function verifyAssetCommand(tabId, asset, promptHash, referenceIds = [], referenceMode = 'ingredients') {
    try { await clickButton(tabId, 'Apagar comando'); }
    catch (error) {
      if ((await dom(tabId, 'prompt')) || (await dom(tabId, 'commandReferences')).count) throw error;
    }
    await waitDom(tabId, 'prompt', {}, (value) => value === '', 'a limpeza do prompt antes de conferir o resultado');
    await waitDom(tabId, 'commandReferences', {}, (value) => value.count === 0 && !value.busy, 'a limpeza das referências antes de conferir o resultado');
    await dom(tabId, 'reuseMediaCommand', { asset });
    const restoredPrompt = await waitDom(tabId, 'prompt', {}, (value) => Boolean(value), 'o comando do resultado selecionado', 15000);
    if (await promptFingerprint(restoredPrompt) !== promptHash) return false;
    const references = await waitDom(tabId, 'commandReferences', {}, (value) => !value.busy && value.count === referenceIds.length, 'as referências do resultado selecionado', 15000);
    return sameReferenceIds(references.ids, referenceIds) && (referenceMode !== 'frames' || sameFrameIds(references.frameIds, referenceIds));
  }
  async function injectReferenceFile(tabId, event, upload) {
    if (!event.backendNodeId) throw new Error('O Flow não forneceu um campo de upload acessível.');
    const node = await cdp(tabId, 'DOM.resolveNode', { backendNodeId: event.backendNodeId });
    try {
      const injected = await cdp(tabId, 'Runtime.callFunctionOn', {
        objectId: node.object.objectId,
        functionDeclaration: `function(reference) {
          const binary = atob(reference.dataUrl.split(',')[1]);
          const bytes = Uint8Array.from(binary, value => value.charCodeAt(0));
          const transfer = new DataTransfer();
          transfer.items.add(new File([bytes], reference.name, {type:reference.mimeType}));
          this.files = transfer.files;
          this.dispatchEvent(new Event('change', {bubbles:true}));
          return this.files.length;
        }`, arguments: [{ value: upload }], returnByValue: true,
      });
      if (injected.exceptionDetails || injected.result?.value !== 1) throw new Error('O Flow não recebeu o arquivo de referência.');
    } finally { await cdp(tabId, 'Runtime.releaseObject', { objectId: node.object.objectId }); }
  }
  async function uploadLibraryReference(tabId, reference, requestId, index) {
    const upload = { ...reference, name: uniqueReferenceName(requestId, index, reference.mimeType) };
    await clickButton(tabId, 'Menu para adicionar arquivos');
    let resolveChooser;
    const chosen = new Promise((resolve) => { resolveChooser = resolve; });
    choosers.set(tabId, resolveChooser);
    try {
      await cdp(tabId, 'Page.enable');
      await cdp(tabId, 'Page.setInterceptFileChooserDialog', { enabled: true });
      await activateWithUserGesture(tabId, 'libraryUpload', 'Enviar', `${requestId}:${index}`);
      await injectReferenceFile(tabId, await deadline(chosen, 12000, 'O seletor de upload da biblioteca do Flow não abriu.'), upload);
      return upload.name;
    } finally {
      choosers.delete(tabId);
      await cdp(tabId, 'Page.setInterceptFileChooserDialog', { enabled: false }).catch(() => {});
    }
  }
  async function placeFrameReference(tabId, index, source) {
    const before = await dom(tabId, 'commandReferences');
    if (![0, 1].includes(index) || before.busy || !Array.isArray(before.frameIds) || before.frameIds.length !== 2 || before.frameIds[index] || before.count !== before.frameIds.filter(Boolean).length || !sameReferenceIds(before.ids, before.frameIds.filter(Boolean))) throw new Error('O slot de frame não está vazio ou as referências anteriores não foram confirmadas. Nenhuma geração foi disparada.');
    await dom(tabId, 'openFrameSlot', { index });
    const imageId = source.imageId || (await waitDom(tabId, 'uploadedResource', { name: source.name }, (value) => Boolean(value.imageId), 'a referência enviada na biblioteca do Flow', 60000)).imageId;
    await waitDom(tabId, 'frameResource', { imageId }, (value) => value.imageId === imageId, 'a imagem exata do frame', 60000);
    await dom(tabId, 'selectFrameResource', { imageId });
    await confirmReferencePlacement(tabId, before, imageId, { frameIndex: index });
    return imageId;
  }
  async function confirmReferencePlacement(tabId, before, imageId, { frameIndex = null, name } = {}) {
    const expectedIds = [...before.ids, imageId];
    const expectedFrames = frameIndex === null ? null : [...before.frameIds];
    if (expectedFrames) expectedFrames[frameIndex] = imageId;
    const matches = (value, ids, frames) => Boolean(value && !value.busy && value.count === ids.length && sameReferenceIds(value.ids, ids) && (frames === null || sameFrameIds(value.frameIds, frames)));
    const inserted = (value) => matches(value, expectedIds, expectedFrames);
    const unchanged = (value) => matches(value, before.ids, frameIndex === null ? null : before.frameIds);
    // New Flow pickers insert immediately. Older pickers leave a preview and
    // require Include. Neither path may change an existing reference or slot.
    const selected = await waitDom(tabId, 'referencePlacementState', { imageId, name }, (value) =>
      inserted(value.references) || (value.imageId === imageId && value.previewMatches && unchanged(value.references)), 'a referência exata inserida ou sua prévia no Flow', 60000);
    if (!inserted(selected.references)) await clickButton(tabId, 'Incluir no comando');
    await waitDom(tabId, 'commandReferences', {}, inserted, frameIndex === null ? 'a identidade da referência no comando' : 'o frame na posição correta do comando', 60000);
  }
  async function uploadReference(tabId, reference, requestId, index) {
    const before = await dom(tabId, 'commandReferences');
    if (before.busy || !Array.isArray(before.ids) || before.count !== before.ids.length) throw new Error('As referências anteriores ainda não foram confirmadas. Nenhuma geração foi disparada.');
    const upload = { ...reference, name: uniqueReferenceName(requestId, index, reference.mimeType) };
    await clickButton(tabId, 'Adicionar elementos à caixa de comando');
    let resolveChooser;
    const chosen = new Promise((resolve) => { resolveChooser = resolve; });
    choosers.set(tabId, resolveChooser);
    try {
      await cdp(tabId, 'Page.enable');
      await cdp(tabId, 'Page.setInterceptFileChooserDialog', { enabled: true });
      await activateWithUserGesture(tabId, 'upload', 'Enviar mídia', `${requestId}:${index}`);
      const event = await deadline(chosen, 12000, 'O seletor de upload do Flow não abriu.');
      await injectReferenceFile(tabId, event, upload);
      const resource = await waitDom(tabId, 'uploadedResource', { name: upload.name }, (value) => Boolean(value.imageId), 'o arquivo enviado na lista do Flow', 60000);
      await dom(tabId, 'selectUploadedResource', { name: upload.name });
      await confirmReferencePlacement(tabId, before, resource.imageId, { name: upload.name });
      return resource.imageId;
    } finally {
      choosers.delete(tabId);
      await cdp(tabId, 'Page.setInterceptFileChooserDialog', { enabled: false }).catch(() => {});
    }
  }
  function videoDetailId(projectUrl, detailUrl) {
    const project = new URL(projectUrl), detail = new URL(detailUrl);
    const prefix = project.pathname.replace(/\/+$/, '') + '/edit/';
    const id = detail.pathname.startsWith(prefix) ? detail.pathname.slice(prefix.length).replace(/\/$/, '') : '';
    if (detail.origin !== project.origin || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id)) throw new Error('O Flow não confirmou o vídeo dentro do projeto deste pedido. O resultado não será associado a outra mídia.');
    return id.toLowerCase();
  }
  async function resolveVideoAsset(tabId, asset, projectUrl) {
    await click(tabId, await dom(tabId, 'mediaOpen', { asset }));
    await waitReady(tabId, 'downloadReady', 180000);
    const id = videoDetailId(projectUrl, (await chrome.tabs.get(tabId)).url);
    if (/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(asset.id) && asset.id.toLowerCase() !== id) throw new Error('O Flow abriu outro vídeo. O resultado deste pedido foi preservado na galeria.');
    const preview = await dom(tabId, 'detailPreview', { kind: 'video', assetId: id }).catch(() => null);
    if (videoDetailId(projectUrl, (await chrome.tabs.get(tabId)).url) !== id) throw new Error('O Flow mudou de vídeo durante a leitura da prévia.');
    // The gallery URL is a thumbnail. A canvas-only editor has no playable
    // source; keep the verified UUID and let the Pilot preview its 1080p file.
    const result = { ...asset, id, projectUrl, kind: 'video', previewPending: true };
    delete result.url;
    const posterUrl = preview?.posterUrl || asset.posterUrl || asset.url;
    if (posterUrl) result.posterUrl = posterUrl;
    if (preview?.kind === 'video' && preview.url) {
      result.url = preview.url;
      result.previewPending = false;
      if (preview.width) result.width = preview.width;
      if (preview.height) result.height = preview.height;
    }
    return result;
  }
  async function refreshResultAccount(tabId, previous) {
    try {
      const current = await readAccount(tabId);
      if (!current?.email || (previous?.email && current.email.toLowerCase() !== previous.email.toLowerCase())) throw new Error('A conta mudou após a geração.');
      return { ...current, credits: Number.isFinite(current.credits) ? current.credits : null };
    } catch { return previous ? { ...previous, credits: null } : null; }
  }
  async function generate(requestId, payload, bridgeTabId) {
    validate(payload, true);
    const prior = await loadJob(requestId);
    if (prior) {
      if (prior.state === 'completed') return { assets: prior.assets, projectUrl: prior.projectUrl, recovered: true };
      throw new Error('Esse pedido já foi recebido. Consulte seu status; ele não será gerado novamente para evitar cobrança duplicada.');
    }
    const stored = (await chrome.storage.local.get(STORE))[STORE] || {};
    const unresolved = Object.values(stored).find((job) => job.submitted && !['completed', 'acknowledged'].includes(job.state));
    if (unresolved) throw new Error(`Há um pedido anterior sem confirmação (${unresolved.requestId}). Atualize o status desse pedido antes de gerar novamente.`);
    let tabId = null;
    const job = { requestId, bridgeTabId, tabId, projectUrl: payload.projectUrl, state: 'preparing', createdAt: Date.now(), updatedAt: Date.now(), submitted: false };
    await save(job);
    try {
      tabId = await tabFor(payload.projectUrl);
      Object.assign(job, { tabId, projectUrl: (await chrome.tabs.get(tabId)).url });
      await update(job, 'preparing', 'Conferindo a conta e as opções no Flow…');
      const account = await readAccount(tabId);
      if (account.email.toLowerCase() !== payload.expectedAccountEmail.toLowerCase()) throw new Error('A conta do Flow mudou. Atualize o card da conta antes de gerar.');
      await configure(tabId, payload);
      // Clearing the entire command also removes references left by a previous run.
      try { await clickButton(tabId, 'Apagar comando'); }
      catch (error) {
        const existingPrompt = await dom(tabId, 'prompt');
        const existingReferences = await dom(tabId, 'commandReferences');
        if (existingPrompt || existingReferences.count) throw new Error('O Flow não limpou o comando anterior. Apague o prompt e as referências no Flow antes de tentar novamente.');
      }
      const editor = await dom(tabId, 'editor');
      await click(tabId, editor);
      await key(tabId, 'a', 'KeyA', 2);
      await key(tabId, 'Backspace', 'Backspace');
      const emptyReferences = await dom(tabId, 'commandReferences');
      if (emptyReferences.count !== 0 || emptyReferences.busy) throw new Error('Ainda há referências do comando anterior no Flow. Nenhuma geração foi disparada.');
      await cdp(tabId, 'Input.insertText', { text: payload.prompt.trim() });
      const written = await dom(tabId, 'prompt');
      if (written !== payload.prompt.trim()) throw new Error('O Flow não recebeu o prompt completo. Nenhuma geração foi disparada.');
      const uploadedReferenceIds = [];
      const referenceMode = payload.mode === 'video' && payload.videoMode !== 'ingredients' ? 'frames' : 'ingredients';
      if (payload.references?.length) {
        await update(job, 'preparing', `Enviando ${payload.references.length} referência(s)…`);
        for (let index = 0; index < payload.references.length; index++) {
          if (referenceMode === 'frames') {
            const source = index === 0 && payload.animateMediaId
              ? { imageId: payload.animateMediaId }
              : { name: await uploadLibraryReference(tabId, payload.references[index], requestId, index) };
            uploadedReferenceIds.push(await placeFrameReference(tabId, index, source));
          } else uploadedReferenceIds.push(await uploadReference(tabId, payload.references[index], requestId, index));
        }
      }
      const controls = await confirmConfiguration(tabId, payload);
      const accountBeforeSubmit = await readAccount(tabId);
      if (accountBeforeSubmit.email.toLowerCase() !== payload.expectedAccountEmail.toLowerCase()) throw new Error('A conta do Flow mudou durante o preparo. Atualize a conta e a previsão antes de gerar.');
      const finalReferences = await dom(tabId, 'commandReferences');
      if (finalReferences.count !== (payload.references || []).length || finalReferences.busy || !sameReferenceIds(finalReferences.ids, uploadedReferenceIds)) throw new Error('O Flow não confirmou exatamente as referências deste pedido. Nenhuma geração foi disparada.');
      if (referenceMode === 'frames' && !sameFrameIds(finalReferences.frameIds, uploadedReferenceIds)) throw new Error('Os frames Início e Fim mudaram de posição no Flow. Nenhuma geração foi disparada.');
      if ((await dom(tabId, 'prompt')) !== payload.prompt.trim()) throw new Error('O prompt mudou durante o preparo no Flow. Nenhuma geração foi disparada.');
      if (controls.credits === null || !Number.isFinite(controls.credits)) throw new Error('O Flow não exibiu uma previsão de créditos. A geração foi interrompida antes de gastar.');
      if (controls.credits > payload.maxCredits) throw new Error(`A previsão mudou para ${controls.credits} créditos. Atualize a previsão antes de gerar.`);
      if (accountBeforeSubmit.credits !== null && accountBeforeSubmit.credits < controls.credits) throw new Error('O saldo da conta Flow é insuficiente para esta geração.');
      await dom(tabId, 'galleryTop');
      await sleep(300);
      const baseline = await dom(tabId, 'media');
      if (baseline.busy) throw new Error('Este projeto já está gerando outra mídia. Aguarde a conclusão no Flow antes de enviar o insert.');
      const baselineObservation = await dom(tabId, 'generationObservation', { prompt: payload.prompt.trim() });
      const known = new Set(baseline.assets.map((asset) => asset.id));
      await cdp(tabId, 'Network.enable');
      const evidence = { prompt: payload.prompt.trim(), requestId, requests: new Set(), ids: new Set(), diagnostics: [], sentAt: null, httpStatus: null, error: null };
      generationEvidence.set(tabId, evidence);
      await waitDom(tabId, 'button', { name: 'Iniciar geração' }, () => true, 'o botão de geração');
      if (jobs.get(requestId)?.cancelRequested) throw new Error('Pedido cancelado antes do envio. Nenhuma geração foi disparada.');
      await update(job, 'submitting', 'Confirmando o envio do pedido ao Flow…', { submitted: true, expectedCount: payload.count, mode: payload.mode, baselineIds: [...known], baselinePromptMatches: baselineObservation.promptMatches, promptHash: await promptFingerprint(payload.prompt), referenceIds: uploadedReferenceIds, referenceMode, account, credits: controls.credits });
      if (jobs.get(requestId)?.cancelRequested) { job.submitted = false; throw new Error('Pedido cancelado antes do envio. Nenhuma geração foi disparada.'); }
      // Single irreversible submission. Never automatically click again after an uncertain result.
      await dom(tabId, 'submitGeneration', { requestId, prompt: payload.prompt.trim() });
      try {
        await waitForSubmission(job, evidence, 20000, () => observeSubmission(job, evidence));
        await update(job, 'generating', 'Pedido enviado ao Flow; aguardando resultado…');
      } catch (error) {
        if (error.code !== 'FLOW_SUBMISSION_UNCONFIRMED') throw error;
        await update(job, 'submitting', 'Aguardando a confirmação do Flow; o pedido não será reenviado.');
      }
      const limit = Date.now() + 20 * 60 * 1000;
      const collected = new Map();
      const checked = new Set();
      while (Date.now() < limit) {
        if (evidence.error) throw new Error(evidence.error);
        if (jobs.get(requestId)?.cancelRequested) throw new Error('Acompanhamento cancelado. A geração já enviada pode continuar no Flow; nenhum novo pedido será disparado.');
        if (job.state === 'submitting') {
          await observeSubmission(job, evidence);
          if (evidence.domObserved || evidence.sentAt) await update(job, 'generating', 'Pedido enviado ao Flow; aguardando resultado…');
        }
        const status = await dom(tabId, 'media');
        const newErrors = status.errors.filter((error) => !baseline.errors.includes(error));
        if (newErrors.length) throw new Error(`O Flow informou: ${newErrors.join(' ').slice(0, 600)}`);
        for (const asset of status.assets) {
          if (known.has(asset.id) || checked.has(asset.id) || asset.canReuseCommand === false || asset.kind !== payload.mode || !asset.width || !asset.height) continue;
          const networkConfirmed = evidence.ids.has(asset.id.toLowerCase());
          await update(job, 'generating', networkConfirmed ? 'Resultado confirmado; preparando a prévia…' : 'Conferindo o comando e as referências de cada resultado…');
          const matches = networkConfirmed || await verifyAssetCommand(tabId, asset, job.promptHash, job.referenceIds, job.referenceMode);
          checked.add(asset.id);
          if (matches) collected.set(asset.id, { ...asset, projectUrl: job.projectUrl });
        }
        if (collected.size > payload.count) throw new Error('O Flow recebeu outra geração neste projeto. Confira os resultados na galeria para evitar associar o insert errado.');
        if (collected.size === payload.count) {
          const assets = [];
          let mediaStillPreparing = false;
          for (const result of collected.values()) {
            if (result.kind === 'video') {
              try { assets.push(await resolveVideoAsset(tabId, result, job.projectUrl)); }
              catch (error) {
                if (error?.code !== 'FLOW_MEDIA_NOT_READY') throw error;
                mediaStillPreparing = true;
                await update(job, 'generating', 'O vídeo já apareceu. O Flow ainda está preparando a prévia; acompanhamento automático ativo.');
              }
              await chrome.tabs.update(tabId, { url: job.projectUrl, active: false });
              await waitReady(tabId);
              await dom(tabId, 'galleryTop');
              if (mediaStillPreparing) break;
            } else assets.push(result);
          }
          if (mediaStillPreparing) { await sleep(1200); continue; }
          // Each exact card restored this request's prompt and references.
          // Network bodies may be unavailable in current Flow; gallery novelty
          // alone still never authorizes associating a result.
          await update(job, 'completed', 'Resultados prontos para prévia e download.', { assets, evidenceIds: assets.map((asset) => asset.id.toLowerCase()), commandVerified: true, error: '' });
          // Save the paid result before optional account UI/network work.
          job.account = await refreshResultAccount(tabId, account);
          await save(job).catch(() => {});
          return { assets, projectUrl: job.projectUrl, account: job.account, credits: controls.credits };
        }
        await sleep(1200);
      }
      throw new Error('O Flow não concluiu em 20 minutos. O pedido foi preservado; consulte o projeto antes de tentar gerar novamente.');
    } catch (error) {
      await update(job, job.submitted ? 'needs_attention' : 'failed', errorText(error), { error: errorText(error) });
      throw error;
    } finally { if (tabId !== null) { generationEvidence.delete(tabId); await detach(tabId); } }
  }
  async function recoverJob(job, bridgeTabId, expectedPrompt) {
    if (!job || ['completed', 'acknowledged'].includes(job.state) || busyOperation) return job;
    if (!job.submitted) {
      if (job.state === 'preparing') return { ...job, state: 'failed', stage: 'A preparação foi interrompida antes do envio. Nenhuma geração foi disparada.' };
      return job;
    }
    // Older jobs did not retain a prompt hash. A caller may provide the saved
    // request prompt as a verification hint; it never authorizes a new submit.
    let recoveryHash = job.promptHash;
    if (!recoveryHash && typeof expectedPrompt === 'string' && expectedPrompt.trim() && expectedPrompt.length <= 10000) recoveryHash = await promptFingerprint(expectedPrompt);
    if (!job.evidenceIds?.length && !recoveryHash) return { ...job, state: 'needs_attention', stage: 'O pedido foi enviado, mas a confirmação do Google não ficou disponível. Confira os resultados no Flow antes de tentar gerar novamente.' };
    if (busyOperation) return job;
    const marker = `recovery:${job.requestId}`;
    busyOperation = marker;
    let tabId = null;
    try {
      tabId = await tabFor(job.projectUrl);
      await dom(tabId, 'galleryTop');
      await sleep(250);
      const account = await readAccount(tabId);
      if (job.account?.email && account.email.toLowerCase() !== job.account.email.toLowerCase()) return { ...job, state: 'needs_attention', stage: 'Conecte a conta original do pedido para recuperar os resultados.' };
      const visible = await dom(tabId, 'media');
      const confirmed = new Set((job.evidenceIds || []).map((id) => id.toLowerCase()));
      const candidates = visible.assets.filter((asset) => asset.canReuseCommand !== false && asset.kind === job.mode && !job.baselineIds?.includes(asset.id)).slice(0, 12);
      const assets = [];
      for (const asset of candidates) {
        const exactEvidence = confirmed.has(asset.id.toLowerCase());
        const commandMatches = exactEvidence || (recoveryHash ? await verifyAssetCommand(tabId, asset, recoveryHash, job.referenceIds || [], job.referenceMode || 'ingredients') : false);
        if (recoveryHash && !commandMatches) continue;
        if (asset.kind === 'image') {
          if (commandMatches || (!recoveryHash && confirmed.has(asset.id.toLowerCase()))) assets.push(asset);
          continue;
        }
        let result;
        try { result = await resolveVideoAsset(tabId, asset, job.projectUrl); }
        catch (error) {
          if (error?.code !== 'FLOW_MEDIA_NOT_READY') throw error;
          Object.assign(job, { state: 'generating', stage: 'O vídeo já apareceu. O Flow ainda está preparando a prévia; o Pilot verificará novamente automaticamente.', updatedAt: Date.now() });
          await save(job);
          return job;
        }
        if (commandMatches || (!recoveryHash && confirmed.has(result.id))) assets.push(result);
        await chrome.tabs.update(tabId, { url: job.projectUrl, active: false });
        await waitReady(tabId);
        await dom(tabId, 'galleryTop');
        if (assets.length === job.expectedCount) break;
      }
      if (assets.length === job.expectedCount) {
        Object.assign(job, { bridgeTabId, state: 'completed', stage: 'Resultados recuperados do Flow.', error: '', assets, promptHash: recoveryHash, evidenceIds: assets.map((asset) => asset.id.toLowerCase()), updatedAt: Date.now() });
        await save(job);
        job.account = await refreshResultAccount(tabId, job.account);
        await save(job).catch(() => {});
      } else Object.assign(job, { state: 'needs_attention', stage: visible.busy ? 'O Flow ainda está gerando. Atualize o status em instantes.' : 'Os resultados confirmados ainda não estão visíveis. Abra o projeto no Flow e atualize o status.' });
      return job;
    } catch (error) { return { ...job, state: 'needs_attention', stage: errorText(error) }; }
    finally { if (tabId !== null) await detach(tabId); if (busyOperation === marker) busyOperation = null; }
  }
  function toBase64(bytes) {
    let binary = '';
    for (let index = 0; index < bytes.length; index += 8192) binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
    return btoa(binary);
  }
  function mediaMime(bytes, kind) {
    const ascii = (start, end) => String.fromCharCode(...bytes.subarray(start, end));
    if (kind === 'video' && ascii(4, 8) === 'ftyp') return 'video/mp4';
    if (kind === 'video' && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'video/webm';
    if (kind === 'image' && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
    if (kind === 'image' && bytes[0] === 0x89 && ascii(1, 4) === 'PNG') return 'image/png';
    if (kind === 'image' && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
    throw new Error('O Flow devolveu um arquivo que não é uma mídia reconhecida.');
  }
  async function download(requestId, payload, bridgeTabId) {
    if (!payload.asset?.id || !['video', 'image'].includes(payload.asset.kind)) throw new Error('Selecione um resultado do Flow para baixar.');
    const tabId = await tabFor(payload.projectUrl || payload.asset.projectUrl);
    try {
      if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(payload.asset.id)) throw new Error('O resultado não possui um identificador de mídia válido do Flow.');
      const project = new URL((await chrome.tabs.get(tabId)).url);
      project.pathname = project.pathname.replace(/(\/project\/[^/]+).*$/, '$1') + '/edit/' + payload.asset.id;
      const detailUrl = project.href;
      await chrome.tabs.update(tabId, { url: detailUrl, active: false });
      await waitReady(tabId, 'downloadReady', 180000);
      // Escape closes Flow's video editor and navigates to the project. A
      // download must remain on this exact result through menu activation.
      await assertDownloadRoute(tabId, detailUrl);
      await cdp(tabId, 'Page.enable');
      await clickButton(tabId, 'Baixar mídia');
      let resolveDownload;
      const started = new Promise((resolve) => { resolveDownload = resolve; });
      let downloadStarted = false;
      downloads.set(tabId, { resolve: (event) => { downloadStarted = true; resolveDownload(event); } });
      const resolution = payload.asset.kind === 'video' ? '1080p' : '2K';
      await activateWithUserGesture(tabId, 'download', resolution, requestId, detailUrl);
      await waitDom(tabId, 'downloadSelectionState', {}, (value) => downloadStarted || !value.menuOpen, `a seleção do download ${resolution}`, 15000);
      await emit(bridgeTabId, requestId, 'FLOW_PROGRESS', { stage: `Preparando o download ${resolution} no Flow…` });
      const event = await deadline(started, 8 * 60 * 1000, 'O Flow não iniciou o download. O resultado foi preservado na galeria; tente baixar novamente.');
      const url = new URL(event.url);
      if (url.protocol === 'blob:') {
        try {
          const info = await dom(tabId, 'blobDownloadStart', { url: event.url, requestId, kind: payload.asset.kind });
          for (let index = 0; index < info.total; index++) {
            const chunk = await dom(tabId, 'blobDownloadChunk', { requestId, index });
            await emit(bridgeTabId, requestId, 'FLOW_DOWNLOAD_CHUNK', { ...chunk, index, total: info.total, mimeType: info.mimeType });
          }
          // The Pilot decodes the bytes and requires real 1080p before attachment.
          return { chunked: true, total: info.total, mimeType: info.mimeType, downloadResolution: payload.asset.kind === 'video' ? '1080p' : '2K' };
        } finally { await dom(tabId, 'blobDownloadClose', { requestId }).catch(() => {}); }
      }
      if (url.protocol !== 'https:' || !(['flow.google.com', 'labs.google', 'storage.googleapis.com'].includes(url.hostname) || url.hostname.endsWith('.googleusercontent.com') || url.hostname.endsWith('.googleapis.com'))) throw new Error('O Flow retornou um endereço de download inesperado.');
      const response = await deadline(fetch(url.href, { credentials: 'include' }), 60000, 'O download do Flow demorou para responder.');
      if (!response.ok) throw new Error(`O download do Flow falhou (${response.status}).`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const mimeType = mediaMime(bytes, payload.asset.kind);
      if (bytes.length > 80 * 1024 * 1024) throw new Error('O arquivo supera 80 MB. Ele foi baixado pelo Chrome; use o upload de inserts para importar esse arquivo.');
      const dataUrl = `data:${mimeType};base64,${toBase64(bytes)}`;
      // Chrome's message limit is 64MB. Large files are decoded and checked
      // by the Pilot after ordered chunk reassembly instead of retransmitted.
      const dimensions = bytes.length <= 16 * 1024 * 1024 ? await dom(tabId, 'dimensions', { dataUrl, kind: payload.asset.kind }) : {};
      if (payload.asset.kind === 'video' && dimensions.width && Math.min(dimensions.width, dimensions.height) < 1080) throw new Error(`O arquivo baixado tem ${dimensions.width}×${dimensions.height}. O Pilot exige o download 1080p do Flow e não usará uma versão menor.`);
      if (bytes.length <= 16 * 1024 * 1024) return { dataUrl, mimeType, ...dimensions, downloadResolution: payload.asset.kind === 'video' ? '1080p' : 'original' };
      const chunkSize = 512 * 1024;
      const total = Math.ceil(bytes.length / chunkSize);
      for (let index = 0; index < total; index++) {
        await emit(bridgeTabId, requestId, 'FLOW_DOWNLOAD_CHUNK', { index, total, data: toBase64(bytes.subarray(index * chunkSize, (index + 1) * chunkSize)), mimeType });
      }
      return { chunked: true, total, mimeType, ...dimensions, downloadResolution: payload.asset.kind === 'video' ? '1080p' : 'original' };
    } finally { downloads.delete(tabId); await detach(tabId); }
  }
  async function execute(message, bridgeTabId) {
    const { requestId, action, payload = {} } = message;
    if (action === 'inspect') return inspect(payload);
    if (action === 'quote') return quote(payload);
    if (action === 'generate') return generate(requestId, payload, bridgeTabId);
    if (action === 'download') return download(requestId, payload, bridgeTabId);
    if (action === 'open') {
      const url = payload.projectUrl || 'https://flow.google.com/';
      if (!isFlow(url)) throw new Error('O endereço precisa ser do Google Flow.');
      const tab = await chrome.tabs.create({ url, active: true });
      return { opened: true, tabId: tab.id, projectUrl: url };
    }
    throw new Error('Ação Flow desconhecida.');
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.type === 'FLOW_HEALTH') {
      if (sender.tab?.id && isPilot(sender.url || sender.tab.url)) respond({ ok: true, version: chrome.runtime.getManifest().version });
      return false;
    }
    if (message?.type !== 'FLOW_REQUEST') return;
    if (!sender.tab?.id || !isPilot(sender.url || sender.tab.url)) { respond({ accepted: false, error: 'Origem do pedido Flow não autorizada.' }); return false; }
    if (typeof message.requestId !== 'string' || message.requestId.length > 160) { respond({ accepted: false, error: 'Pedido Flow inválido.' }); return false; }
    respond({ accepted: true });
    const bridgeTabId = sender.tab.id;
    const run = async () => {
      try {
        let result;
        if (message.action === 'status') {
          const id = message.payload?.jobRequestId || message.payload?.requestId || message.requestId;
          let job = await loadJob(id);
          if (!job && busyOperation === id) job = { requestId: id, state: 'preparing', submitted: false, stage: 'Conectando ao Flow…' };
          result = { job: await recoverJob(job, bridgeTabId, message.payload?.expectedPrompt) };
        }
        else if (message.action === 'cancel') {
          const job = await loadJob(message.payload?.jobRequestId || message.payload?.requestId || message.requestId);
          if (job && message.payload?.acknowledgeUncertain === true) {
            if (busyOperation) throw new Error('A automação ainda está trabalhando. Cancele o acompanhamento e aguarde a interrupção antes de liberar um novo pedido.');
            Object.assign(job, { state: 'acknowledged', stage: 'O usuário conferiu o Flow e liberou um novo pedido.', acknowledgedAt: Date.now() });
          } else if (job) job.cancelRequested = true;
          if (job) await save(job);
          result = { cancelled: Boolean(job), submitted: Boolean(job?.submitted), acknowledged: job?.state === 'acknowledged' };
        } else result = await execute(message, bridgeTabId);
        await emit(bridgeTabId, message.requestId, 'FLOW_RESULT', result);
      } catch (error) { await emit(bridgeTabId, message.requestId, 'FLOW_ERROR', { error: errorText(error) }); }
    };
    if (['status', 'cancel'].includes(message.action)) void run();
    else if (busyOperation) {
      void emit(bridgeTabId, message.requestId, 'FLOW_ERROR', { error: 'O Flow está ocupado com outro pedido do Pilot. Aguarde a conclusão ou cancele o acompanhamento antes de continuar. Este pedido não entrou em uma fila e não será enviado mais tarde.' });
    } else {
      busyOperation = message.requestId;
      void run().finally(() => { if (busyOperation === message.requestId) busyOperation = null; });
    }
    return false;
  });
})();
