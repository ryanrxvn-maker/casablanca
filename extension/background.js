/**
 * DARKO LAB Extension - Background Service Worker
 */

const activeJobs = new Map();
// Map<requestId, { bridgeTabId, timeoutId }> pra correlacionar push do
// content script (HG_TAB_AVATARS_RESULT) de volta com o requester original.
const pendingListJobs = new Map();
// Voice clone pendentes: { bridgeTabId, timeoutId }
const pendingCloneJobs = new Map();
const pendingPhotoAvatarJobs = new Map();
const HEYGEN_CREATE_URL = 'https://app.heygen.com/avatar';

async function fetchWithTimeout(url, opts, timeoutMs = 30000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

async function findOrCreateHeyGenTab() {
  const tabs = await chrome.tabs.query({
    url: ['https://app.heygen.com/*'],
  });
  // Prefere uma aba INATIVA (background). Nunca mexer numa aba que o user
  // esteja olhando — nesse caso cria uma nova aba inativa exclusiva pra
  // automacao, pra todo o trabalho rodar invisivel.
  const inactive = tabs.find((t) => t.active === false);
  if (inactive) {
    if (
      inactive.url &&
      (inactive.url.includes('/create-video') || inactive.url.includes('/404'))
    ) {
      await chrome.tabs.update(inactive.id, { url: HEYGEN_CREATE_URL });
    }
    return inactive;
  }
  // Se so existem abas ativas, NAO mexer nelas — cria uma fresh inativa
  return await chrome.tabs.create({
    url: HEYGEN_CREATE_URL,
    active: false,
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return;

  if (msg.type === 'HG_GENERATE') {
    const requestId = msg.requestId;
    handleGenerate(requestId, msg.payload, sender.tab?.id).catch((err) => {
      reportToPage(sender.tab?.id, requestId, 'HG_ERROR', {
        error: err?.message ?? String(err),
      });
    });
    sendResponse({ accepted: true });
    return true;
  }

  if (msg.type === 'HG_STUDIO_GENERATE') {
    // VA de avatar — fluxo HeyGen Studio cena-por-cena (Mirror voice).
    const requestId = msg.requestId;
    handleStudioGenerate(requestId, msg.payload, sender.tab?.id).catch((err) => {
      reportToPage(sender.tab?.id, requestId, 'HG_ERROR', {
        error: err?.message ?? String(err),
      });
    });
    sendResponse({ accepted: true });
    return true;
  }

  if (msg.type === 'HG_TEST_SESSION') {
    const requestId = msg.requestId;
    handleTestSession(requestId, sender.tab?.id).catch((err) => {
      reportToPage(sender.tab?.id, requestId, 'HG_TEST_RESULT', {
        ok: false,
        detail: err?.message ?? String(err),
      });
    });
    sendResponse({ accepted: true });
    return true;
  }

  if (msg.type === 'HG_API_FETCH') {
    const requestId = msg.requestId;
    handleApiFetch(requestId, msg.req, sender.tab?.id).catch((err) => {
      reportToPage(sender.tab?.id, requestId, 'HG_API_RESULT', {
        status: 0, ok: false, body: { message: err?.message ?? String(err) },
      });
    });
    sendResponse({ accepted: true });
    return true;
  }

  if (msg.type === 'HG_RELOAD_SELF') {
    // Pagina pede pra extensao se reinstalar (re-le manifest + scripts)
    // Util pra updates futuros: page detecta versao velha → page chama
    // HG_RELOAD_SELF → extensao se reinicia → user nao precisa abrir
    // chrome://extensions e clicar reload manualmente.
    try { sendResponse({ accepted: true }); } catch {}
    setTimeout(() => {
      try { chrome.runtime.reload(); } catch (e) {
        console.error('[DARKO LAB BG] reload self falhou:', e?.message);
      }
    }, 100);
    return;
  }

  if (msg.type === 'HG_FETCH_DOC') {
    // READ-ONLY: abre/reusa tab docs.google.com com a URL e le innerText
    // via /mobilebasic (renderiza HTML completo). Devolve texto bruto.
    const requestId = msg.requestId;
    const docUrl = msg.url;
    handleFetchDoc(requestId, docUrl, sender.tab?.id).catch((err) => {
      reportToPage(sender.tab?.id, requestId, 'HG_DOC_RESULT', {
        ok: false, error: err?.message ?? String(err),
      });
    });
    sendResponse({ accepted: true });
    return true;
  }

  if (msg.type === 'HG_INJECT_INTERCEPTOR') {
    const tabId = sender.tab?.id;
    // Responde IMEDIATO (sync) pra fechar o canal e nao gerar warning.
    try { sendResponse({ accepted: true }); } catch {}
    if (tabId) {
      injectInterceptorIntoMainWorld(tabId)
        .then((ok) => {
          console.log('[DARKO LAB BG] inject interceptor result tabId=', tabId, 'ok=', ok);
        })
        .catch((e) => {
          console.error('[DARKO LAB BG] !!! inject interceptor THREW:', e?.message ?? e);
        });
    }
    return; // sem return true (sync)
  }

  if (msg.type === 'HG_LIST_AVATARS') {
    const requestId = msg.requestId;
    handleListAvatars(requestId, sender.tab?.id).catch((err) => {
      reportToPage(sender.tab?.id, requestId, 'HG_AVATARS_RESULT', {
        ok: false,
        error: err?.message ?? String(err),
        avatars: [],
      });
    });
    sendResponse({ accepted: true });
    return true;
  }

  if (msg.type === 'HG_GET_CREDITS') {
    const requestId = msg.requestId;
    handleGetCredits(requestId, sender.tab?.id).catch((err) => {
      reportToPage(sender.tab?.id, requestId, 'HG_CREDITS_RESULT', {
        ok: false,
        error: err?.message ?? String(err),
      });
    });
    sendResponse({ accepted: true });
    return true;
  }

  if (msg.type === 'HG_CREATE_PHOTO_AVATAR') {
    sendResponse({ accepted: true });
    const requestId = msg.requestId;
    handleCreatePhotoAvatar(requestId, msg.payload, sender.tab?.id).catch((err) => {
      reportToPage(sender.tab?.id, requestId, 'HG_PHOTO_AVATAR_RESULT', {
        ok: false,
        error: err?.message ?? String(err),
      });
    });
    return false;
  }

  if (msg.type === 'HG_DRIVE_LIST_FOLDER') {
    // Lista arquivos dentro de uma pasta Drive via cookies (sem OAuth).
    // Usado pra auto-resolver fileId de filenames mencionados no doc.
    const requestId = msg.requestId;
    const folderId = msg.folderId;
    handleDriveListFolder(requestId, folderId, sender.tab?.id).catch((err) => {
      reportToPage(sender.tab?.id, requestId, 'HG_DRIVE_LIST_FOLDER_RESULT', {
        ok: false,
        error: err?.message ?? String(err),
        files: [],
      });
    });
    sendResponse({ accepted: true });
    return true;
  }

  if (msg.type === 'HG_DOWNLOAD_DRIVE') {
    // Download Drive file (mp4) via uc?export=download — usa cookies da sessao Google
    // do user pra acessar arquivos compartilhados/proprios. Retorna ArrayBuffer.
    const requestId = msg.requestId;
    const fileId = msg.fileId;
    handleDownloadDrive(requestId, fileId, sender.tab?.id).catch((err) => {
      reportToPage(sender.tab?.id, requestId, 'HG_DRIVE_DOWNLOAD_RESULT', {
        ok: false,
        error: err?.message ?? String(err),
      });
    });
    sendResponse({ accepted: true });
    return true;
  }

  if (msg.type === 'HG_CLONE_VOICE') {
    const requestId = msg.requestId;
    handleCloneVoice(requestId, msg.payload, sender.tab?.id).catch((err) => {
      reportToPage(sender.tab?.id, requestId, 'HG_CLONE_VOICE_RESULT', {
        ok: false,
        error: err?.message ?? String(err),
      });
    });
    sendResponse({ accepted: true });
    return true;
  }

  if (msg.type === 'HG_TAB_CLONE_VOICE_PROGRESS') {
    const job = pendingCloneJobs.get(msg.requestId);
    if (job) {
      reportToPage(job.bridgeTabId, msg.requestId, 'HG_CLONE_VOICE_PROGRESS', {
        stage: msg.stage,
        percent: msg.percent,
        message: msg.message,
      });
    }
    return false;
  }

  if (msg.type === 'HG_TAB_CLONE_VOICE_RESULT') {
    const job = pendingCloneJobs.get(msg.requestId);
    if (job) {
      clearTimeout(job.timeoutId);
      pendingCloneJobs.delete(msg.requestId);
      reportToPage(job.bridgeTabId, msg.requestId, 'HG_CLONE_VOICE_RESULT', {
        ok: !!msg.ok,
        voiceId: msg.voiceId,
        voiceName: msg.voiceName,
        error: msg.error ?? null,
      });
    }
    return false;
  }

  if (msg.type === 'HG_TAB_PHOTO_AVATAR_PROGRESS') {
    const job = pendingPhotoAvatarJobs.get(msg.requestId);
    if (job) {
      reportToPage(job.bridgeTabId, msg.requestId, 'HG_PHOTO_AVATAR_PROGRESS', {
        stage: msg.stage,
        percent: msg.percent,
        message: msg.message,
      });
    }
    return false;
  }

  if (msg.type === 'HG_TAB_PHOTO_AVATAR_RESULT') {
    const job = pendingPhotoAvatarJobs.get(msg.requestId);
    if (job) {
      clearTimeout(job.timeoutId);
      pendingPhotoAvatarJobs.delete(msg.requestId);
      reportToPage(job.bridgeTabId, msg.requestId, 'HG_PHOTO_AVATAR_RESULT', {
        ok: !!msg.ok,
        avatarId: msg.avatarId,
        groupId: msg.groupId,
        lookId: msg.lookId,
        error: msg.error ?? null,
      });
    }
    return false;
  }

  if (msg.type === 'HG_CANCEL') {
    const job = activeJobs.get(msg.requestId);
    if (job) {
      activeJobs.delete(msg.requestId);
      reportToPage(job.bridgeTabId, msg.requestId, 'HG_ERROR', {
        error: 'Cancelado pelo usuario.',
      });
    }
    return false;
  }

  if (msg.type === 'HG_TAB_PROGRESS') {
    const job = activeJobs.get(msg.requestId);
    if (job) {
      reportToPage(job.bridgeTabId, msg.requestId, 'HG_PROGRESS', {
        stage: msg.stage,
        percent: msg.percent,
      });
    }
    return false;
  }

  if (msg.type === 'HG_TAB_RESULT') {
    const job = activeJobs.get(msg.requestId);
    if (job) {
      activeJobs.delete(msg.requestId);
      reportToPage(job.bridgeTabId, msg.requestId, 'HG_RESULT', {
        videoUrl: msg.videoUrl,
      });
    }
    return false;
  }

  if (msg.type === 'HG_TAB_AVATARS_RESULT') {
    const job = pendingListJobs.get(msg.requestId);
    if (job) {
      clearTimeout(job.timeoutId);
      pendingListJobs.delete(msg.requestId);
      console.log('[DARKO LAB BG] <-- pushed AVATARS_RESULT reqId=', msg.requestId, 'avatars=', msg.avatars?.length, 'groups=', msg.groups?.length);
      reportToPage(job.bridgeTabId, msg.requestId, 'HG_AVATARS_RESULT', {
        ok: !!msg.ok,
        avatars: msg.avatars ?? [],
        groups: msg.groups ?? [],
        error: msg.error ?? null,
        apiSource: msg.apiSource ?? null,
      });
    } else {
      console.warn('[DARKO LAB BG] !! recebido HG_TAB_AVATARS_RESULT sem job pendente reqId=', msg.requestId);
    }
    return false;
  }

  if (msg.type === 'HG_TAB_ERROR') {
    const job = activeJobs.get(msg.requestId);
    if (job) {
      activeJobs.delete(msg.requestId);
      reportToPage(job.bridgeTabId, msg.requestId, 'HG_ERROR', {
        error: msg.error,
      });
    }
    return false;
  }

  // ===== CDP: cliques confiaveis (isTrusted=true) via Chrome DevTools =====
  // Necessario pra alguns botoes do create-v4 (Add audio, linha biblioteca,
  // pilula Use avatar voice) que so respondem a eventos confiaveis.
  if (msg.type === 'HG_CDP_CLICK') {
    const tabId = sender.tab?.id;
    if (!tabId) { sendResponse({ ok: false, error: 'no tabId' }); return false; }
    cdpTrustedClick(tabId, msg.x, msg.y)
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: e?.message || String(e) }));
    return true;
  }
  if (msg.type === 'HG_CDP_DETACH') {
    cdpDetach().finally(() => sendResponse({ ok: true }));
    return true;
  }
});

// ============================ CDP HELPERS ============================
let cdpTab = null;
let cdpAttachInflight = null;

async function cdpAttach(tabId) {
  if (cdpTab === tabId) return;
  // detach previous if different
  if (cdpTab !== null) {
    try { await new Promise((r) => chrome.debugger.detach({ tabId: cdpTab }, () => r())); } catch {}
    cdpTab = null;
  }
  if (cdpAttachInflight) await cdpAttachInflight;
  cdpAttachInflight = new Promise((resolve, reject) => {
    chrome.debugger.attach({ tabId }, '1.3', () => {
      if (chrome.runtime.lastError) {
        const m = chrome.runtime.lastError.message || '';
        // se ja anexado (mesma sessao), ok
        if (/already attached/i.test(m)) { cdpTab = tabId; resolve(); }
        else reject(new Error(m));
      } else {
        cdpTab = tabId;
        resolve();
      }
    });
  });
  try { await cdpAttachInflight; }
  finally { cdpAttachInflight = null; }
  console.log('[DARKO LAB BG CDP] attached to tab', tabId);
}

function cdpSend(tabId, method, params) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params || {}, (res) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(res);
    });
  });
}

async function cdpTrustedClick(tabId, x, y) {
  await cdpAttach(tabId);
  // hover first (some sites depend on hover for visibility/enable)
  await cdpSend(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
  await new Promise((r) => setTimeout(r, 40));
  await cdpSend(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, buttons: 1 });
  await new Promise((r) => setTimeout(r, 50));
  await cdpSend(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, buttons: 0 });
}

async function cdpDetach() {
  if (cdpTab === null) return;
  const t = cdpTab; cdpTab = null;
  await new Promise((r) => chrome.debugger.detach({ tabId: t }, () => r()));
  console.log('[DARKO LAB BG CDP] detached from tab', t);
}

// Auto-detach se o debugger for desanexado pelo user/Chrome
try {
  chrome.debugger.onDetach.addListener((source, reason) => {
    if (source.tabId === cdpTab) {
      console.log('[DARKO LAB BG CDP] auto-detached, reason=', reason);
      cdpTab = null;
    }
  });
} catch {}

async function handleTestSession(requestId, bridgeTabId) {
  const tab = await findOrCreateHeyGenTab();
  await waitForTabReady(tab.id);
  try {
    const resp = await chrome.tabs.sendMessage(tab.id, {
      type: 'HG_TEST_SESSION',
      requestId,
    });
    reportToPage(bridgeTabId, requestId, 'HG_TEST_RESULT', {
      ok: !!resp?.ok,
      detail: resp?.detail ?? '',
    });
  } catch (e) {
    reportToPage(bridgeTabId, requestId, 'HG_TEST_RESULT', {
      ok: false,
      detail:
        'Aba HeyGen nao respondeu - recarregue chrome://extensions e tente de novo. (' +
        (e?.message ?? '') +
        ')',
    });
  }
}

async function handleListAvatars(requestId, bridgeTabId) {
  console.log('[DARKO LAB BG] >>> handleListAvatars START reqId=', requestId, 'bridgeTabId=', bridgeTabId);
  const tab = await findOrCreateHeyGenTab();
  console.log('[DARKO LAB BG] heygen tab=', tab.id, 'url=', tab.url);
  await waitForTabReady(tab.id);
  console.log('[DARKO LAB BG] heygen tab ready, sending HG_LIST_AVATARS to content script (push pattern)');

  // PUSH PATTERN: NAO fazemos await da resposta. Content script vai
  // empurrar HG_TAB_AVATARS_RESULT via runtime.sendMessage quando tiver
  // o resultado. Aqui a gente so 'envia' (fire-and-forget) e registra
  // um job pendente que sera resolvido pelo handler de HG_TAB_AVATARS_RESULT.
  // Isso evita o problema do SW do background hibernar durante o await
  // (que fechava o port com 'channel closed before a response').

  // Timeout de seguranca - se em 60s nao recebermos o push, falha.
  const timeoutId = setTimeout(() => {
    if (pendingListJobs.has(requestId)) {
      console.warn('[DARKO LAB BG] !!! pending list job timeout 60s reqId=', requestId);
      pendingListJobs.delete(requestId);
      reportToPage(bridgeTabId, requestId, 'HG_AVATARS_RESULT', {
        ok: false,
        avatars: [],
        groups: [],
        error: 'Timeout 60s aguardando resposta do content script HeyGen.',
      });
    }
  }, 60000);

  pendingListJobs.set(requestId, { bridgeTabId, timeoutId });

  try {
    // Fire-and-forget. O sendResponse imediato do content script
    // ({ accepted: true }) nao nos importa - o resultado real vem via push.
    chrome.tabs.sendMessage(tab.id, { type: 'HG_LIST_AVATARS', requestId })
      .then(() => {
        console.log('[DARKO LAB BG] HG_LIST_AVATARS dispatched OK, aguardando push HG_TAB_AVATARS_RESULT...');
      })
      .catch((e) => {
        // Erro ao DESPACHAR (raro - aba fechou antes da msg sair). Ignora
        // o channel-closed (esperado pq retornamos sync no content). So se
        // for algo realmente fatal vai cair aqui (No tab with id).
        const m = e?.message ?? String(e);
        if (m.includes('channel closed') || m.includes('listener indicated')) {
          // Esperado - sendResponse({accepted:true}) feito sync, canal fecha. OK.
          console.log('[DARKO LAB BG] dispatch ack channel-close (esperado), aguardando push...');
        } else {
          console.error('[DARKO LAB BG] !!! dispatch HG_LIST_AVATARS THREW:', m);
          if (pendingListJobs.has(requestId)) {
            clearTimeout(timeoutId);
            pendingListJobs.delete(requestId);
            reportToPage(bridgeTabId, requestId, 'HG_AVATARS_RESULT', {
              ok: false,
              avatars: [],
              groups: [],
              error: 'Aba HeyGen nao respondeu. Abra app.heygen.com e tente de novo. (' + m + ')',
            });
          }
        }
      });
  } catch (e) {
    console.error('[DARKO LAB BG] !!! handleListAvatars sync throw:', e?.message ?? e);
    if (pendingListJobs.has(requestId)) {
      clearTimeout(timeoutId);
      pendingListJobs.delete(requestId);
      reportToPage(bridgeTabId, requestId, 'HG_AVATARS_RESULT', {
        ok: false,
        avatars: [],
        groups: [],
        error: 'Erro inesperado: ' + (e?.message ?? String(e)),
      });
    }
  }
}

/** Pega saldo de creditos HeyGen via content-script (cookies sessao).
 *  Retorna { ok, plan_credit, unlimited_regular, plan_name, tier, ... }
 *  Usado pelo MotorConfigPicker pra mostrar saldo + warning se preview
 *  vai exceder saldo. */
async function handleGetCredits(requestId, bridgeTabId) {
  console.log('[DARKO LAB BG] >>> handleGetCredits reqId=', requestId);
  const tab = await findOrCreateHeyGenTab();
  await waitForTabReady(tab.id);
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'HG_GET_CREDITS' });
    reportToPage(bridgeTabId, requestId, 'HG_CREDITS_RESULT', res);
  } catch (e) {
    reportToPage(bridgeTabId, requestId, 'HG_CREDITS_RESULT', {
      ok: false,
      error: 'Aba HeyGen nao respondeu: ' + (e?.message ?? String(e)),
    });
  }
}

/** Lista arquivos dentro de uma pasta Drive sem precisar de OAuth.
 *  Usa o endpoint embeddedfolderview que retorna HTML com lista de items
 *  (precisa user logado — cookies vao automaticamente). Parseia HTML pra
 *  extrair { fileId, name, isFolder } de cada item.
 *
 *  Critico pro pipeline VA: o user normalmente referencia o arquivo do AD
 *  apenas pelo nome (ex 'AD10G1VN-PRPB06.mp4'), nao pela URL. A pasta
 *  CRIATIVOS no topo do doc tem o link real. Listamos essa pasta + match
 *  por filename. */
async function handleDriveListFolder(requestId, folderId, bridgeTabId) {
  if (!folderId || typeof folderId !== 'string') {
    reportToPage(bridgeTabId, requestId, 'HG_DRIVE_LIST_FOLDER_RESULT', { ok: false, error: 'folderId invalido', files: [] });
    return;
  }
  try {
    // Endpoint mais robusto: embeddedfolderview retorna HTML simples mesmo
    // sem OAuth, contanto que o user tenha acesso via session cookies.
    const url = `https://drive.google.com/embeddedfolderview?id=${folderId}#grid`;
    const r = await fetchWithTimeout(url, {
      method: 'GET',
      credentials: 'include',
    }, 30000);
    if (!r.ok) {
      reportToPage(bridgeTabId, requestId, 'HG_DRIVE_LIST_FOLDER_RESULT', {
        ok: false,
        error: `HTTP ${r.status}`,
        files: [],
      });
      return;
    }
    const html = await r.text();
    // Parser robusto. No embeddedfolderview cada item e:
    //   <div class="flip-entry ..." id="entry-<RESOURCE_ID>"> ...
    //     <div class="flip-entry-title">NOME</div> ...
    // O `id="entry-<ID>"` e a ANCORA confiavel (independe da ordem do <a>
    // do link vs o titulo, que variava e quebrava o parser antigo).
    const decode = (s) => s
      .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
      .replace(/&#39;/g, "'").replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
    const files = [];
    const seen = new Set();
    // Quais ids sao PASTA (aparecem como /folders/<id> no HTML).
    const folderIds = new Set();
    let fm;
    const fre = /\/folders\/([a-zA-Z0-9_-]{15,})/g;
    while ((fm = fre.exec(html)) !== null) folderIds.add(fm[1]);
    // Ancora no id do entry + o titulo logo a seguir.
    let m;
    const entryRe = /id="entry-([a-zA-Z0-9_-]{15,})"[\s\S]{0,2000}?class="flip-entry-title"[^>]*>([^<]+)</gi;
    while ((m = entryRe.exec(html)) !== null) {
      const id = m[1];
      const name = decode(m[2]);
      if (!seen.has(id) && name) {
        seen.add(id);
        files.push({ fileId: id, name, isFolder: folderIds.has(id) });
      }
    }
    // FALLBACK (parser antigo) caso a estrutura mude e o entry-id suma.
    if (files.length === 0) {
      const itemRe = /<a[^>]*href="[^"]*\/file\/d\/([a-zA-Z0-9_-]{15,})[^"]*"[^>]*>[\s\S]{0,600}?<div[^>]*class="flip-entry-title"[^>]*>([^<]+)<\/div>/gi;
      while ((m = itemRe.exec(html)) !== null) {
        if (!seen.has(m[1])) { seen.add(m[1]); files.push({ fileId: m[1], name: decode(m[2]), isFolder: false }); }
      }
      const folderRe = /<a[^>]*href="[^"]*\/folders\/([a-zA-Z0-9_-]{15,})[^"]*"[^>]*>[\s\S]{0,600}?<div[^>]*class="flip-entry-title"[^>]*>([^<]+)<\/div>/gi;
      while ((m = folderRe.exec(html)) !== null) {
        if (!seen.has(m[1])) { seen.add(m[1]); files.push({ fileId: m[1], name: decode(m[2]), isFolder: true }); }
      }
    }
    console.log(`[DARKO LAB BG] HG_DRIVE_LIST_FOLDER ${folderId}: ${files.length} items`);
    reportToPage(bridgeTabId, requestId, 'HG_DRIVE_LIST_FOLDER_RESULT', {
      ok: true,
      files,
    });
  } catch (e) {
    reportToPage(bridgeTabId, requestId, 'HG_DRIVE_LIST_FOLDER_RESULT', {
      ok: false,
      error: e?.message ?? String(e),
      files: [],
    });
  }
}

/** Download MP4 do Google Drive via cookies da sessao do user.
 *  Usa o endpoint uc?export=download que funciona com cookies (sem OAuth).
 *  Pra arquivos grandes (>100MB), Drive intercepta com pagina de confirmacao —
 *  o param confirm=t bypassa. Retorna ArrayBuffer pra page via base64 (CHUNKED). */
async function handleDownloadDrive(requestId, fileId, bridgeTabId) {
  if (!fileId || typeof fileId !== 'string') {
    reportToPage(bridgeTabId, requestId, 'HG_DRIVE_DOWNLOAD_RESULT', { ok: false, error: 'fileId invalido' });
    return;
  }
  console.log('[DARKO LAB BG v4.16.3] HG_DOWNLOAD_DRIVE start fileId=', fileId);
  const errors = [];

  // ===== STREAMING (v4.16.3) =====
  // ANTES: r.arrayBuffer() do MP4 inteiro -> binary string gigante via
  // String.fromCharCode em loop -> btoa de ~130MB -> chunks. Com 2-3 VAs
  // baixando EM PARALELO o service worker saturava por minutos, a page nao
  // recebia NADA (nem progresso) e estourava 'timeout 10min download Drive'
  // com o card parado em 'Baixando AD original...' (user 2026-06-10).
  // AGORA: le o body em STREAM, sniffa os primeiros bytes (HTML de confirm
  // vs MP4), e emite chunks base64 de 18MB CONFORME CHEGAM + progresso real
  // (HG_DRIVE_DOWNLOAD_PROGRESS). Memoria O(chunk), nao O(arquivo); o
  // timeout vira INATIVIDADE (90s sem bytes), nao tempo total.
  const RAW_CHUNK = 18 * 1024 * 1024; // -> 24MB base64 chars (limite msg 64MiB)
  let sentChunks = 0;

  const encodeB64 = (bytes) => {
    let binary = '';
    const STEP = 0x8000;
    for (let i = 0; i < bytes.length; i += STEP) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + STEP));
    }
    return btoa(binary);
  };

  // Tenta UMA url em modo stream.
  // Retorna { done: true, size }            -> chunks ja emitidos pra page
  //         { err, confirm?, uuid? }        -> nao era MP4 (HTML/erro/login)
  const tryStream = async (url) => {
    console.log('[DARKO LAB BG v4.16.3] fetch tentando', url.slice(0, 120));
    const controller = new AbortController();
    let inactivity = null;
    const armInactivity = () => {
      clearTimeout(inactivity);
      inactivity = setTimeout(() => controller.abort(), 90000);
    };
    try {
      armInactivity();
      const r = await fetch(url, {
        method: 'GET',
        credentials: 'include',
        redirect: 'follow',
        signal: controller.signal,
      });
      if (!r.ok) { clearTimeout(inactivity); return { err: `HTTP ${r.status}` }; }
      const total = parseInt(r.headers.get('content-length') || '0', 10) || null;
      const reader = r.body.getReader();
      let pending = [];        // Uint8Arrays aguardando virar chunk
      let pendingLen = 0;
      let sniffed = false;
      let htmlMode = false;
      const htmlParts = [];
      let received = 0;
      let lastProgressAt = 0;

      const flush = (force) => {
        while (pendingLen >= RAW_CHUNK || (force && pendingLen > 0)) {
          const take = Math.min(RAW_CHUNK, pendingLen);
          const out = new Uint8Array(take);
          let off = 0;
          while (off < take) {
            const head = pending[0];
            const need = take - off;
            if (head.length <= need) { out.set(head, off); off += head.length; pending.shift(); }
            else { out.set(head.subarray(0, need), off); pending[0] = head.subarray(need); off += need; }
          }
          pendingLen -= take;
          reportToPage(bridgeTabId, requestId, 'HG_DRIVE_DOWNLOAD_CHUNK', {
            chunkIdx: sentChunks, piece: encodeB64(out),
          });
          sentChunks++;
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        armInactivity();
        received += value.length;
        pending.push(value);
        pendingLen += value.length;

        if (!sniffed) {
          if (pendingLen < 3000) continue;
          const headBytes = new Uint8Array(3000);
          let o = 0;
          for (const p of pending) {
            const n = Math.min(p.length, 3000 - o);
            headBytes.set(p.subarray(0, n), o);
            o += n;
            if (o >= 3000) break;
          }
          sniffed = true;
          htmlMode = /<html|<!DOCTYPE/i.test(new TextDecoder().decode(headBytes));
        }
        if (htmlMode) {
          // pagina de confirm/erro e pequena — guarda inteira pra parsear
          htmlParts.push(...pending);
          pending = []; pendingLen = 0;
          continue;
        }
        flush(false);
        const now = Date.now();
        if (now - lastProgressAt > 700) {
          lastProgressAt = now;
          reportToPage(bridgeTabId, requestId, 'HG_DRIVE_DOWNLOAD_PROGRESS', { received, total });
        }
      }
      clearTimeout(inactivity);

      if (!sniffed) {
        // arquivo menor que 3000 bytes — sniffa o que tem
        const all = new Uint8Array(pendingLen);
        let o = 0; for (const p of pending) { all.set(p, o); o += p.length; }
        if (/<html|<!DOCTYPE/i.test(new TextDecoder().decode(all))) {
          htmlMode = true; htmlParts.push(all); pending = []; pendingLen = 0;
        }
      }

      if (htmlMode) {
        let len = 0; for (const p of htmlParts) len += p.length;
        const htmlAll = new Uint8Array(len);
        let o = 0; for (const p of htmlParts) { htmlAll.set(p, o); o += p.length; }
        const allText = new TextDecoder().decode(htmlAll);
        const confirmMatch = allText.match(/confirm=([0-9A-Za-z_-]+)/);
        const uuidMatch = allText.match(/uuid=([0-9a-f-]+)/);
        const formAction = allText.match(/action="([^"]+download[^"]*)"/);
        if (confirmMatch || uuidMatch || formAction) {
          return { err: 'needs_confirm', confirm: confirmMatch?.[1], uuid: uuidMatch?.[1] };
        }
        if (/sign in|signin|accounts\.google/i.test(allText.slice(0, 3000))) {
          return { err: 'redirect_login (file privado OU user nao logado)' };
        }
        return { err: 'HTML response (file deletado OU sem permissao)' };
      }

      flush(true);
      reportToPage(bridgeTabId, requestId, 'HG_DRIVE_DOWNLOAD_PROGRESS', { received, total });
      return { done: true, size: received };
    } catch (e) {
      clearTimeout(inactivity);
      const aborted = e?.name === 'AbortError';
      return { err: aborted ? 'inatividade 90s (conexao Drive estagnou)' : ('fetch_exception: ' + (e?.message || e)) };
    }
  };

  // Cadeia de estrategias (mesmas urls de antes). IMPORTANTE: se uma
  // estrategia ja EMITIU chunks e caiu no meio, NAO tenta a proxima —
  // a page tem chunks parciais dessa requestId e mistura corromperia o
  // arquivo. Falha limpo; a page faz retry com requestId novo.
  let final = await tryStream(`https://drive.google.com/uc?export=download&id=${fileId}`);
  if (!final.done && final.err === 'needs_confirm' && sentChunks === 0 && (final.confirm || final.uuid)) {
    errors.push('uc: needs confirm');
    const params = new URLSearchParams({ id: fileId, export: 'download' });
    if (final.confirm) params.set('confirm', final.confirm);
    if (final.uuid) params.set('uuid', final.uuid);
    final = await tryStream(`https://drive.google.com/uc?${params}`);
    if (!final.done) errors.push(`uc+confirm: ${final.err}`);
  } else if (!final.done) {
    errors.push(`uc: ${final.err}`);
  }
  if (!final.done && sentChunks === 0) {
    final = await tryStream(`https://drive.usercontent.google.com/download?id=${fileId}&export=download&authuser=0&confirm=t`);
    if (!final.done && final.err === 'needs_confirm' && sentChunks === 0 && (final.confirm || final.uuid)) {
      const params = new URLSearchParams({ id: fileId, export: 'download', authuser: '0' });
      if (final.confirm) params.set('confirm', final.confirm);
      if (final.uuid) params.set('uuid', final.uuid);
      final = await tryStream(`https://drive.usercontent.google.com/download?${params}`);
      if (!final.done) errors.push(`usercontent+confirm: ${final.err}`);
    } else if (!final.done) {
      errors.push(`usercontent: ${final.err}`);
    }
  }
  if (!final.done && sentChunks === 0) {
    final = await tryStream(`https://drive.google.com/uc?export=download&id=${fileId}&confirm=t`);
    if (!final.done) errors.push(`uc+confirm=t: ${final.err}`);
  }
  if (!final.done && sentChunks === 0) {
    final = await tryStream(`https://drive.google.com/u/0/uc?id=${fileId}&export=download&confirm=t`);
    if (!final.done) errors.push(`u/0/uc: ${final.err}`);
  }

  if (!final.done) {
    reportToPage(bridgeTabId, requestId, 'HG_DRIVE_DOWNLOAD_RESULT', {
      ok: false,
      error: (sentChunks > 0
        ? `Conexao com o Drive caiu no meio do download (${sentChunks} chunks recebidos). Tente de novo. `
        : 'Drive download falhou em todas estrategias. Verifique: (1) extension reloaded em chrome://extensions, (2) file existe + voce tem acesso, (3) voce esta logado no Google. ')
        + 'Detalhes: ' + errors.join(' | '),
    });
    return;
  }

  console.log(`[DARKO LAB BG v4.16.3] HG_DOWNLOAD_DRIVE OK fileId=${fileId} bytes=${final.size} chunks=${sentChunks}`);
  reportToPage(bridgeTabId, requestId, 'HG_DRIVE_DOWNLOAD_RESULT', {
    ok: true,
    chunks: sentChunks,
    size: final.size,
  });
}

async function handleCloneVoice(requestId, payload, bridgeTabId) {
  console.log('[DARKO LAB BG] >>> handleCloneVoice START reqId=', requestId, 'name=', payload?.displayName);
  const tab = await findOrCreateHeyGenTab();
  await waitForTabReady(tab.id);

  // Timeout 6min — clone pode demorar 30-120s
  const timeoutId = setTimeout(() => {
    if (pendingCloneJobs.has(requestId)) {
      console.warn('[DARKO LAB BG] !!! clone job timeout 6min reqId=', requestId);
      pendingCloneJobs.delete(requestId);
      reportToPage(bridgeTabId, requestId, 'HG_CLONE_VOICE_RESULT', {
        ok: false,
        error: 'Timeout 6min aguardando voice clone do HeyGen.',
      });
    }
  }, 360000);
  pendingCloneJobs.set(requestId, { bridgeTabId, timeoutId });

  try {
    chrome.tabs.sendMessage(tab.id, { type: 'HG_CLONE_VOICE', requestId, payload })
      .catch((e) => {
        const m = e?.message ?? String(e);
        if (m.includes('channel closed') || m.includes('listener indicated')) {
          // Esperado — content script retornou sync ack
        } else {
          console.error('[DARKO LAB BG] !!! dispatch HG_CLONE_VOICE THREW:', m);
          if (pendingCloneJobs.has(requestId)) {
            clearTimeout(timeoutId);
            pendingCloneJobs.delete(requestId);
            reportToPage(bridgeTabId, requestId, 'HG_CLONE_VOICE_RESULT', {
              ok: false,
              error: 'Aba HeyGen nao respondeu. Abre app.heygen.com e tenta de novo. (' + m + ')',
            });
          }
        }
      });
  } catch (e) {
    if (pendingCloneJobs.has(requestId)) {
      clearTimeout(timeoutId);
      pendingCloneJobs.delete(requestId);
      reportToPage(bridgeTabId, requestId, 'HG_CLONE_VOICE_RESULT', {
        ok: false,
        error: 'Erro inesperado: ' + (e?.message ?? String(e)),
      });
    }
  }
}

async function handleCreatePhotoAvatar(requestId, payload, bridgeTabId) {
  console.log('[DARKO LAB BG] >>> handleCreatePhotoAvatar reqId=', requestId);
  const tab = await findOrCreateHeyGenTab();
  await waitForTabReady(tab.id);
  const timeoutId = setTimeout(() => {
    if (pendingPhotoAvatarJobs.has(requestId)) {
      pendingPhotoAvatarJobs.delete(requestId);
      reportToPage(bridgeTabId, requestId, 'HG_PHOTO_AVATAR_RESULT', {
        ok: false,
        error: 'Timeout 5min aguardando photo avatar create.',
      });
    }
  }, 300000);
  pendingPhotoAvatarJobs.set(requestId, { bridgeTabId, timeoutId });
  try {
    chrome.tabs.sendMessage(tab.id, { type: 'HG_CREATE_PHOTO_AVATAR', requestId, payload })
      .catch((e) => {
        const m = e?.message ?? String(e);
        if (!m.includes('channel closed') && !m.includes('listener indicated')) {
          if (pendingPhotoAvatarJobs.has(requestId)) {
            clearTimeout(timeoutId);
            pendingPhotoAvatarJobs.delete(requestId);
            reportToPage(bridgeTabId, requestId, 'HG_PHOTO_AVATAR_RESULT', {
              ok: false,
              error: 'Aba HeyGen nao respondeu: ' + m,
            });
          }
        }
      });
  } catch (e) {
    if (pendingPhotoAvatarJobs.has(requestId)) {
      clearTimeout(timeoutId);
      pendingPhotoAvatarJobs.delete(requestId);
      reportToPage(bridgeTabId, requestId, 'HG_PHOTO_AVATAR_RESULT', {
        ok: false,
        error: 'Erro: ' + (e?.message ?? String(e)),
      });
    }
  }
}

async function handleGenerate(requestId, payload, bridgeTabId) {
  console.log('[DARKO LAB BG] handleGenerate START reqId=', requestId);
  const tab = await findOrCreateHeyGenTab();
  activeJobs.set(requestId, { tabId: tab.id, payload, bridgeTabId });

  reportToPage(bridgeTabId, requestId, 'HG_PROGRESS', {
    stage: 'Abrindo HeyGen...',
  });

  // CRITICO: SEMPRE navega pra /avatar fresh antes de cada dispatch.
  // Apos clicar Generate, HeyGen muda a UI (mostra processing, esconde
  // textarea, etc). Pra proximos trechos precisamos de UI limpa.
  // Navegamos via chrome.tabs.update (sobrevive reload do content script).
  reportToPage(bridgeTabId, requestId, 'HG_PROGRESS', {
    stage: 'Resetando HeyGen pra Quick Create limpa...',
  });
  console.log('[DARKO LAB BG] navegando pra /avatar pra UI limpa');
  await chrome.tabs.update(tab.id, { url: 'https://app.heygen.com/avatar' });
  await waitForTabComplete(tab.id, 30000);
  // Espera React montar a UI + Quick Create render
  await new Promise((r) => setTimeout(r, 3500));

  await waitForTabReady(tab.id);

  reportToPage(bridgeTabId, requestId, 'HG_PROGRESS', {
    stage: 'Comandando automacao na aba HeyGen...',
  });

  try {
    await chrome.tabs.sendMessage(tab.id, {
      type: 'HG_RUN_JOB',
      requestId,
      payload,
    });
    console.log('[DARKO LAB BG] HG_RUN_JOB despachado pra tab', tab.id);
  } catch (e) {
    activeJobs.delete(requestId);
    reportToPage(bridgeTabId, requestId, 'HG_ERROR', {
      error:
        'Aba HeyGen nao respondeu - recarregue a aba e tente de novo. (' +
        (e?.message ?? '') +
        ')',
    });
  }
}

/**
 * VA de avatar: navega pra My Avatars e comanda runStudioJob (Studio
 * cena-por-cena com Mirror voice). Mesmo padrao do handleGenerate, mas
 * roteia pro HG_RUN_STUDIO_JOB. Registra em activeJobs pra os HG_TAB_*
 * (progress/result/error) serem relayados pra page.
 */
async function handleStudioGenerate(requestId, payload, bridgeTabId) {
  console.log('[DARKO LAB BG] handleStudioGenerate START reqId=', requestId);
  const tab = await findOrCreateHeyGenTab();
  activeJobs.set(requestId, { tabId: tab.id, payload, bridgeTabId });

  // Entrada DETERMINISTICA no editor Studio cena-por-cena: URL direta
  // descoberta via teste real — equivale a My Avatars > look > "Use in
  // video" > "Build scene-by-scene", sem caça a menu/DOM.
  const lookId = payload && payload.avatarId;
  const groupId = payload && payload.groupId;
  let studioUrl;
  if (groupId && lookId) {
    studioUrl = 'https://app.heygen.com/create-v4/draft?avatarGroup=' +
      encodeURIComponent(groupId) + '&defaultLookId=' + encodeURIComponent(lookId) +
      '&fromCreateButton=true';
  } else if (lookId) {
    // sem groupId: ainda tenta com defaultLookId (HeyGen costuma resolver o grupo)
    studioUrl = 'https://app.heygen.com/create-v4/draft?defaultLookId=' +
      encodeURIComponent(lookId) + '&fromCreateButton=true';
  } else {
    activeJobs.delete(requestId);
    reportToPage(bridgeTabId, requestId, 'HG_ERROR', {
      error: 'VA Studio: payload sem avatarId/groupId — nao da pra abrir o editor.',
    });
    return;
  }
  reportToPage(bridgeTabId, requestId, 'HG_PROGRESS', { stage: 'Abrindo editor Studio do avatar...' });
  console.log('[DARKO LAB BG] navegando direto pro editor Studio create-v4');
  await chrome.tabs.update(tab.id, { url: studioUrl });
  await waitForTabComplete(tab.id, 40000);
  await new Promise((r) => setTimeout(r, 5000));
  await waitForTabReady(tab.id);

  reportToPage(bridgeTabId, requestId, 'HG_PROGRESS', { stage: 'Comandando Studio na aba HeyGen...' });
  try {
    await chrome.tabs.sendMessage(tab.id, {
      type: 'HG_RUN_STUDIO_JOB',
      requestId,
      payload,
    });
    console.log('[DARKO LAB BG] HG_RUN_STUDIO_JOB despachado pra tab', tab.id);
  } catch (e) {
    activeJobs.delete(requestId);
    reportToPage(bridgeTabId, requestId, 'HG_ERROR', {
      error: 'Aba HeyGen nao respondeu - recarregue a aba e tente de novo. (' + (e?.message ?? '') + ')',
    });
  }
}

/**
 * Aguarda tab.status === 'complete' (load finished). Retorna true se OK,
 * false se timeout.
 */
async function waitForTabComplete(tabId, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const t = await chrome.tabs.get(tabId);
      if (t.status === 'complete') return true;
    } catch {
      return false; // aba fechada
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

function reportToPage(bridgeTabId, requestId, type, payload) {
  if (!bridgeTabId) {
    console.warn('[DARKO LAB BG] !!! reportToPage called WITHOUT bridgeTabId. type=', type, 'reqId=', requestId);
    return;
  }
  console.log('[DARKO LAB BG] reportToPage -> tab', bridgeTabId, 'type=', type, 'reqId=', requestId);
  chrome.tabs
    .sendMessage(bridgeTabId, {
      source: 'darkolab-bg',
      type,
      requestId,
      payload,
    })
    .then(() => {
      console.log('[DARKO LAB BG] reportToPage delivered OK to tab', bridgeTabId, 'type=', type);
    })
    .catch((err) => {
      console.error('[DARKO LAB BG] !!! reportToPage FAILED to tab', bridgeTabId, 'type=', type, 'err=', err?.message ?? err);
    });
}

async function waitForTabReady(tabId) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === 'complete') break;
    } catch {
      throw new Error('Aba HeyGen foi fechada.');
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  await ensureContentScriptLoaded(tabId);
}

async function ensureContentScriptLoaded(tabId) {
  try {
    const resp = await Promise.race([
      chrome.tabs.sendMessage(tabId, { type: 'HG_PING' }),
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error('PING timeout')), 1500),
      ),
    ]);
    if (resp?.ok) return true;
  } catch (e) {
    /* nada - vai injetar */
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['heygen-content.js'],
    });
    await new Promise((r) => setTimeout(r, 1000));

    try {
      const resp = await Promise.race([
        chrome.tabs.sendMessage(tabId, { type: 'HG_PING' }),
        new Promise((_, rej) =>
          setTimeout(() => rej(new Error('PING timeout pos-inject')), 2000),
        ),
      ]);
      if (resp?.ok) return true;
    } catch (e) {
      throw new Error(
        'Content script injetado mas nao respondeu. Recarregue a aba app.heygen.com manualmente (F5).',
      );
    }
  } catch (e) {
    throw new Error(
      'Falha ao injetar content script: ' +
        (e?.message ?? e) +
        '. Recarregue a aba app.heygen.com manualmente.',
    );
  }
  return false;
}

/**
 * Injeta o interceptor de fetch+XHR diretamente no MAIN WORLD da aba HeyGen
 * via chrome.scripting.executeScript. Bypass do CSP do HeyGen e nao depende
 * de arquivo inject.js no disco.
 */
async function handleApiFetch(requestId, req, bridgeTabId) {
  console.log('[DARKO LAB BG] HG_API_FETCH', req.method, req.url?.slice(0, 80));
  const tab = await findOrCreateHeyGenTab();
  await waitForTabReady(tab.id);
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'HG_API_FETCH', req });
    reportToPage(bridgeTabId, requestId, 'HG_API_RESULT', {
      status: res?.status ?? 0,
      ok: !!res?.ok,
      body: res?.body ?? null,
    });
  } catch (e) {
    reportToPage(bridgeTabId, requestId, 'HG_API_RESULT', {
      status: 0, ok: false, body: { message: 'Aba HeyGen nao respondeu: ' + (e?.message ?? '') },
    });
  }
}

async function injectInterceptorIntoMainWorld(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => {
        if (window.__darkolab_intercept_loaded__) return;
        window.__darkolab_intercept_loaded__ = true;
        // Dedup de captura: se 2 POST identicas (mesma URL) em <3s,
        // emite VIDEO_GENERATED so 1x. Protege contra dispatch duplo do
        // React/automacao.
        const recentEmits = new Map(); // url -> ts
        function shouldEmit(url, ts) {
          const last = recentEmits.get(url);
          if (last && ts - last < 3000) return false;
          recentEmits.set(url, ts);
          // Limpa entradas velhas (>60s)
          for (const [k, v] of recentEmits) {
            if (ts - v > 60000) recentEmits.delete(k);
          }
          return true;
        }
        // Captura QUALQUER POST a heygen.com (mais amplo). Excluimos
        // endpoints conhecidos de NAO-generate pra reduzir spam: tracking,
        // metrics, log, analytics, recommendation, search, voices.list,
        // avatar_group.private.list etc.
        const HG_RE = /heygen\.(com|ai)/i;
        // SKIP so endpoints OBVIAMENTE nao-generate. Removido: status,
        // preview, asset (alguns generates passam por esses padroes).
        const SKIP_RE = /(\/v\d+\/(tracking|telemetry|analytics|metrics|log|notification|recommendation|search|voice\.list|avatar_group\.private|avatar_look\.private|user\.info|favorite))/i;
        function emit(payload) {
          try {
            window.postMessage({ source: 'darkolab-injected', type: 'VIDEO_GENERATED', ts: Date.now(), ...payload }, '*');
          } catch (e) {}
        }
        function tryExtractId(j) {
          if (!j || typeof j !== 'object') return null;
          return (
            j?.data?.video_id ?? j?.data?.id ?? j?.data?.uuid ??
            j?.video_id ?? j?.id ?? j?.uuid ??
            j?.data?.task_id ?? j?.task_id ??
            null
          );
        }
        // === CAPTURA DO PAYLOAD NATIVO (Espelhamento de Voz) ===
        // O submit nativo do HeyGen (request 200/xhr do vendor-*.js) carrega
        // o shape EXATO do voice mirror. Capturamos o REQUEST BODY completo
        // pra parar de chutar nome de campo no createVideo (causa do 400 ->
        // voz original errada no VA). Disponivel em window.__darkolab_lastSubmitBody
        // + emitido como SUBMIT_BODY_CAPTURED pro content script persistir.
        const SUBMIT_RE = /shortcut\/submit|\/submit\b|generate|\/create/i;
        function bodyToString(b) {
          try {
            if (b == null) return '';
            if (typeof b === 'string') return b;
            if (b instanceof URLSearchParams) return b.toString();
            if (typeof FormData !== 'undefined' && b instanceof FormData) {
              const o = {}; b.forEach((v, k) => { o[k] = typeof v === 'string' ? v : '[blob]'; });
              return JSON.stringify(o);
            }
            if (typeof b === 'object') { try { return JSON.stringify(b); } catch (e) { return ''; } }
            return '';
          } catch (e) { return ''; }
        }
        function captureSubmitBody(url, method, bodyStr, via) {
          try {
            if (!bodyStr) return;
            const hasMirror = /mirror|voice_id|voice_setting|espelh/i.test(bodyStr);
            const rec = { url: String(url).slice(0, 200), method, via, body: bodyStr, ts: Date.now(), hasMirror };
            window.__darkolab_lastSubmitBody = rec;
            window.__darkolab_submitBodies = (window.__darkolab_submitBodies || []).slice(-9);
            window.__darkolab_submitBodies.push(rec);
            console.log(
              '%c[DARKO LAB inject] 🎯 SUBMIT BODY capturado (' + via + ')' + (hasMirror ? ' — TEM voice mirror!' : ''),
              'color:#00e5ff;font-weight:bold', '\nurl:', rec.url, '\nbody:', bodyStr,
            );
            try { console.log('[DARKO LAB inject] 🎯 SUBMIT BODY (pretty):\n' + JSON.stringify(JSON.parse(bodyStr), null, 2)); } catch (e) {}
            emit({ type: 'SUBMIT_BODY_CAPTURED', submitUrl: rec.url, submitBody: bodyStr, via: via, hasMirror: hasMirror });
          } catch (e) {}
        }
        const origFetch = window.fetch;
        window.fetch = function (input, init) {
          const url = typeof input === 'string' ? input : input?.url || '';
          const method = ((init && init.method) || (typeof input === 'object' && input?.method) || 'GET').toUpperCase();
          const isHG = HG_RE.test(url) && !SKIP_RE.test(url);
          const isInteresting = method === 'POST' && isHG;
          // Captura body do submit nativo (Espelhamento de Voz) ANTES do envio
          if (method === 'POST' && SUBMIT_RE.test(url) && init && init.body != null) {
            captureSubmitBody(url, method, bodyToString(init.body), 'fetch');
          }
          const p = origFetch.apply(this, arguments);
          if (isInteresting) {
            // Loga inicio pra debug (mostra TODAS POSTs HeyGen relevantes)
            console.log('[DARKO LAB inject] POST capturado:', url);
            p.then(async (res) => {
              try {
                if (!res) return;
                const clone = res.clone();
                const text = await clone.text().catch(() => '');
                console.log('[DARKO LAB inject] POST resp', url, 'status', res.status, 'body 200ch:', text.slice(0, 200));
                if (res.status >= 400) return;
                let j = null;
                try { j = JSON.parse(text); } catch { return; }
                const id = tryExtractId(j);
                if (id) {
                  if (!shouldEmit(url, Date.now())) {
                    console.log('[DARKO LAB inject] DUP video_id capturado em <3s, IGNORADO:', id, 'via', url);
                    return;
                  }
                  console.log('[DARKO LAB inject] fetch capturou video_id', id, 'via', url);
                  emit({ video_id: id, url, source_method: 'fetch' });
                }
              } catch (e) {}
            }).catch(() => {});
          }
          return p;
        };
        const OrigXHR = window.XMLHttpRequest;
        function PatchedXHR() {
          const xhr = new OrigXHR();
          let _url = '';
          let _method = '';
          const origOpen = xhr.open;
          xhr.open = function (method, url) {
            _method = String(method || '').toUpperCase();
            _url = String(url || '');
            return origOpen.apply(this, arguments);
          };
          // Captura body do submit nativo via XHR (a request 200/xhr do
          // Espelhamento de Voz vem por aqui — vendor-*.js).
          const origSend = xhr.send;
          xhr.send = function (body) {
            try {
              if (_method === 'POST' && SUBMIT_RE.test(_url) && body != null) {
                captureSubmitBody(_url, _method, bodyToString(body), 'xhr');
              }
            } catch (e) {}
            return origSend.apply(this, arguments);
          };
          xhr.addEventListener('load', function () {
            try {
              if (_method !== 'POST' || !HG_RE.test(_url) || SKIP_RE.test(_url)) return;
              if (this.status >= 400) return;
              const text = this.responseText;
              if (!text) return;
              let j = null;
              try { j = JSON.parse(text); } catch { return; }
              const id = tryExtractId(j);
              if (id) {
                if (!shouldEmit(_url, Date.now())) {
                  console.log('[DARKO LAB inject] DUP video_id (XHR) em <3s, IGNORADO:', id);
                  return;
                }
                console.log('[DARKO LAB inject] XHR capturou video_id', id, 'via', _url);
                emit({ video_id: id, url: _url, source_method: 'xhr' });
              }
            } catch (e) {}
          });
          return xhr;
        }
        PatchedXHR.prototype = OrigXHR.prototype;
        for (const k in OrigXHR) {
          try { PatchedXHR[k] = OrigXHR[k]; } catch (e) {}
        }
        window.XMLHttpRequest = PatchedXHR;
        console.log('[DARKO LAB inject] fetch+XHR patched (via executeScript MAIN world)');
      },
    });
    return true;
  } catch (e) {
    console.error('[DARKO LAB BG] !!! injectInterceptorIntoMainWorld erro:', e?.message ?? e);
    return false;
  }
}

/**
 * READ-ONLY: abre tab em /mobilebasic do Google Doc, espera carregar,
 * le innerText e retorna. Nunca escreve, edita ou comenta no doc.
 */
// Tabela de entidades HTML — PT-BR + ASCII basicas + tipografia. Google
// Docs HTML export usa entities (&ccedil;, &atilde;, &aacute;, etc) em vez
// de UTF-8 direto, principalmente em headers de paragrafo e em links
// (anchor text "Viva Saud&aacute;vel..." em chips Drive). Por isso a
// decode tem que rodar TANTO no body text QUANTO no linkText — senao o
// matching pra resolver fileId pelo nome falha (user reportou 29/05/2026
// AD30 com "Saudável" → driveLink text "Saud&aacute;vel" nao casava).
const HTML_ENTITIES_MAP = {
  'nbsp': ' ', 'amp': '&', 'lt': '<', 'gt': '>', 'quot': '"', 'apos': "'",
  // Latim acentuado minusculas
  'aacute': 'á', 'eacute': 'é', 'iacute': 'í', 'oacute': 'ó', 'uacute': 'ú',
  'agrave': 'à', 'egrave': 'è', 'igrave': 'ì', 'ograve': 'ò', 'ugrave': 'ù',
  'acirc':  'â', 'ecirc':  'ê', 'icirc':  'î', 'ocirc':  'ô', 'ucirc':  'û',
  'atilde': 'ã', 'ntilde': 'ñ', 'otilde': 'õ',
  'auml':   'ä', 'euml':   'ë', 'iuml':   'ï', 'ouml':   'ö', 'uuml':   'ü',
  'aring':  'å', 'aelig':  'æ', 'ccedil': 'ç', 'oslash': 'ø', 'szlig':  'ß',
  'yacute': 'ý', 'yuml':   'ÿ',
  // Latim acentuado maiusculas
  'Aacute': 'Á', 'Eacute': 'É', 'Iacute': 'Í', 'Oacute': 'Ó', 'Uacute': 'Ú',
  'Agrave': 'À', 'Egrave': 'È', 'Igrave': 'Ì', 'Ograve': 'Ò', 'Ugrave': 'Ù',
  'Acirc':  'Â', 'Ecirc':  'Ê', 'Icirc':  'Î', 'Ocirc':  'Ô', 'Ucirc':  'Û',
  'Atilde': 'Ã', 'Ntilde': 'Ñ', 'Otilde': 'Õ',
  'Auml':   'Ä', 'Euml':   'Ë', 'Iuml':   'Ï', 'Ouml':   'Ö', 'Uuml':   'Ü',
  'Aring':  'Å', 'AElig':  'Æ', 'Ccedil': 'Ç', 'Oslash': 'Ø',
  'Yacute': 'Ý',
  // Pontuacao tipografica comum (pode aparecer em filenames com en-dash)
  'lsquo': '‘', 'rsquo': '’', 'ldquo': '“', 'rdquo': '”',
  'sbquo': '‚', 'bdquo': '„',
  'ndash': '–', 'mdash': '—',
  'hellip': '…', 'middot': '·',
  'laquo': '«', 'raquo': '»',
  'copy': '©', 'reg': '®', 'trade': '™',
  'deg':  '°', 'plusmn': '±',
  // Espacos especiais
  'ensp': ' ', 'emsp': ' ', 'thinsp': ' ',
};

function decodeHtmlEntities(s) {
  if (!s) return s;
  return s
    .replace(/&([a-zA-Z]+);/g, (raw, name) => (HTML_ENTITIES_MAP[name] !== undefined ? HTML_ENTITIES_MAP[name] : raw))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

/** Parse HTML exportado do Google Docs em background SW.
 *  SW nao tem DOMParser, entao fazemos regex puro:
 *   - Strip tags pra texto
 *   - Extrai links {text, fileId} de `<a href="...drive..."> texto </a>`
 *  Preserva quebras de linha (P + BR) e listas. */
function parseGoogleDocsHtml(html) {
  if (!html) return { text: '', driveLinks: [] };

  // === DRIVE LINKS ===
  // Pega <a href="<url>" ...>texto</a> com captura de IDs Drive de TODOS formatos:
  //   /file/d/<ID>/...           (arquivo)
  //   /drive/folders/<ID>        (pasta)
  //   /folderview?id=<ID>        (pasta variacao)
  //   /open?id=<ID>              (qualquer item)
  //   /document/d/<ID>/...       (doc)
  //   docs.google.com/spreadsheets/d/<ID>/...  (sheet)
  //   /presentation/d/<ID>/...   (slides)
  const driveLinks = [];
  const seen = new Set();
  const linkRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = linkRe.exec(html)) !== null) {
    const href = m[1];
    // Google Docs envolve URL real em redirect: https://www.google.com/url?q=<real>&...
    let realUrl = href;
    const redirMatch = href.match(/[?&]q=([^&]+)/);
    if (redirMatch) {
      try { realUrl = decodeURIComponent(redirMatch[1]); } catch {}
    }
    // Tenta varios patterns em ordem de prioridade
    const patterns = [
      /\/file\/d\/([a-zA-Z0-9_-]{15,})/,           // arquivo Drive
      /\/drive\/folders\/([a-zA-Z0-9_-]{15,})/,    // pasta Drive
      /\/folderview\?id=([a-zA-Z0-9_-]{15,})/,     // pasta variacao
      /\/document\/d\/([a-zA-Z0-9_-]{15,})/,       // doc
      /\/spreadsheets\/d\/([a-zA-Z0-9_-]{15,})/,   // sheet
      /\/presentation\/d\/([a-zA-Z0-9_-]{15,})/,   // slides
      /[?&]id=([a-zA-Z0-9_-]{15,})/,                // generico
    ];
    let fileId = null;
    let isFolder = false;
    for (const re of patterns) {
      const fileMatch = realUrl.match(re);
      if (fileMatch) {
        fileId = fileMatch[1];
        isFolder = /folder/i.test(realUrl);
        break;
      }
    }
    if (!fileId) continue;
    // Strip HTML do texto do link + DECODE entities (PT-BR full).
    // CRITICAL: tem que decodar entities aqui senao linkText fica
    // "Viva Saud&aacute;vel..." e o normalizeForMatch (page.tsx) nao
    // bate com username "Viva Saudável" do briefing → "sem link Drive".
    let linkText = decodeHtmlEntities(m[2].replace(/<[^>]+>/g, '')).trim();
    // FALLBACK pra chips com inner-text vazio (so <img alt="filename"/>):
    // tenta o alt do primeiro <img> dentro do <a>. Cobre smart-chips do
    // Google que renderizam o file embed so como thumbnail clicavel.
    if (!linkText) {
      const altMatch = m[2].match(/<img[^>]+alt=["']([^"']+)["']/i);
      if (altMatch) linkText = decodeHtmlEntities(altMatch[1]).trim();
    }
    const key = `${fileId}::${linkText}`;
    if (seen.has(key)) continue;
    seen.add(key);
    driveLinks.push({ text: linkText, fileId, isFolder });
  }

  // === TEXTO ===
  // Insere quebras antes de blocos
  let text = html
    .replace(/<\/(p|div|li|h[1-6]|br)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n');
  // Remove style/script
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '');
  // Strip todas tags
  text = text.replace(/<[^>]+>/g, '');
  // Decode HTML entities — tabela completa pra PT-BR + ASCII basicas.
  // Google Docs HTML export usa entities (&ccedil;, &atilde;, etc) em vez
  // de UTF-8 direto, especialmente em headers de paragrafo.
  const NAMED_ENTITIES = {
    'nbsp': ' ', 'amp': '&', 'lt': '<', 'gt': '>', 'quot': '"', 'apos': "'",
    // Latim acentuado minusculas
    'aacute': 'á', 'eacute': 'é', 'iacute': 'í', 'oacute': 'ó', 'uacute': 'ú',
    'agrave': 'à', 'egrave': 'è', 'igrave': 'ì', 'ograve': 'ò', 'ugrave': 'ù',
    'acirc':  'â', 'ecirc':  'ê', 'icirc':  'î', 'ocirc':  'ô', 'ucirc':  'û',
    'atilde': 'ã', 'ntilde': 'ñ', 'otilde': 'õ',
    'auml':   'ä', 'euml':   'ë', 'iuml':   'ï', 'ouml':   'ö', 'uuml':   'ü',
    'aring':  'å', 'aelig':  'æ', 'ccedil': 'ç', 'oslash': 'ø', 'szlig': 'ß',
    'yacute': 'ý', 'yuml':   'ÿ',
    // Latim acentuado maiusculas
    'Aacute': 'Á', 'Eacute': 'É', 'Iacute': 'Í', 'Oacute': 'Ó', 'Uacute': 'Ú',
    'Agrave': 'À', 'Egrave': 'È', 'Igrave': 'Ì', 'Ograve': 'Ò', 'Ugrave': 'Ù',
    'Acirc':  'Â', 'Ecirc':  'Ê', 'Icirc':  'Î', 'Ocirc':  'Ô', 'Ucirc':  'Û',
    'Atilde': 'Ã', 'Ntilde': 'Ñ', 'Otilde': 'Õ',
    'Auml':   'Ä', 'Euml':   'Ë', 'Iuml':   'Ï', 'Ouml':   'Ö', 'Uuml':   'Ü',
    'Aring':  'Å', 'AElig':  'Æ', 'Ccedil': 'Ç', 'Oslash': 'Ø',
    'Yacute': 'Ý',
    // Pontuacao tipografica comum
    'lsquo': '‘', 'rsquo': '’', 'ldquo': '“', 'rdquo': '”',
    'sbquo': '‚', 'bdquo': '„',
    'ndash': '–', 'mdash': '—',
    'hellip': '…', 'middot': '·',
    'laquo': '«', 'raquo': '»',
    'copy': '©', 'reg': '®', 'trade': '™',
    'deg':  '°', 'plusmn': '±',
    // Espacos especiais
    'ensp': ' ', 'emsp': ' ', 'thinsp': ' ', 'zwnj': '‌', 'zwj': '‍',
  };
  text = text
    .replace(/&([a-zA-Z]+);/g, (raw, name) => NAMED_ENTITIES[name] ?? raw)
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  // Collapse newlines triplas+
  text = text.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').trim();

  return { text, driveLinks };
}

/** Fetcha Google Doc SEM ABRIR TAB usando export?format=html.
 *  Funciona desde que o user esteja logado (cookies da sessao Google
 *  vao automaticamente via host_permissions da extension).
 *  Mais rapido + invisivel + paralelizavel. */
async function handleFetchDoc(requestId, docUrl, bridgeTabId) {
  try {
    if (!docUrl || typeof docUrl !== 'string') {
      reportToPage(bridgeTabId, requestId, 'HG_DOC_RESULT', { ok: false, error: 'docUrl invalida' });
      return;
    }
    const m = docUrl.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
    if (!m) {
      reportToPage(bridgeTabId, requestId, 'HG_DOC_RESULT', { ok: false, error: 'URL nao parece Google Doc valido' });
      return;
    }
    const docId = m[1];

    // === ESTRATEGIA 1: export?format=html (sem abrir tab) ===
    // 2 tentativas de 12s cada (em vez de 1 de 30s): timeout curto + retry
    // resolve glitch transitorio de rede/Google MUITO mais rapido, e mantem
    // o pior caso total (12+12+20+1.5 ≈ 45s) DENTRO da janela pos-ACK da
    // page (90s) — antes o pior caso (30+30+1.5 ≈ 61s) estourava o timeout
    // de 30s da page e virava "Timeout 30s — extensao nao respondeu" mesmo
    // com o doc sendo lido com sucesso logo depois.
    const exportUrl = `https://docs.google.com/document/d/${docId}/export?format=html`;
    console.log('[DARKO LAB BG] HG_FETCH_DOC docId=', docId, 'via export (invisible)');
    let html = null;
    let exportErr = null;
    for (let attempt = 1; attempt <= 2 && !html; attempt++) {
      try {
        const r = await fetchWithTimeout(exportUrl, {
          method: 'GET',
          credentials: 'include',
          redirect: 'follow',
        }, 12000);
        if (r.ok) {
          html = await r.text();
          const head = html.slice(0, 5000);
          // Detecta paginas de erro do Google (200 OK mas conteudo invalido)
          if (/<title>Sign in|accounts\.google\.com|google-account-redirect/i.test(head)) {
            html = null;
            exportErr = 'doc_privado_login_necessario';
          } else if (/o arquivo que voc[eê] solicitou n[aã]o existe|the file you requested does not exist|<title>Erro/i.test(head)) {
            html = null;
            exportErr = 'doc_nao_existe_ou_sem_permissao';
          } else if (/voc[eê] precisa de permiss[aã]o|you need (permission|access)|request access/i.test(head)) {
            html = null;
            exportErr = 'doc_sem_permissao_de_acesso';
          }
        } else {
          exportErr = `HTTP ${r.status}`;
        }
      } catch (e) {
        exportErr = (e?.message || String(e));
      }
      // Erros definitivos (permissao/inexistente) nao melhoram com retry
      if (!html && /^doc_/.test(exportErr || '') && exportErr !== 'doc_privado_login_necessario') break;
      if (!html && attempt < 2) {
        console.warn('[DARKO LAB BG] export tentativa', attempt, 'falhou (', exportErr, ') — retry');
        await new Promise((r) => setTimeout(r, 800));
      }
    }

    if (html) {
      const parsed = parseGoogleDocsHtml(html);
      console.log('[DARKO LAB BG] HG_FETCH_DOC via export OK textLen=', parsed.text.length, 'links=', parsed.driveLinks.length);
      reportToPage(bridgeTabId, requestId, 'HG_DOC_RESULT', {
        ok: true,
        text: parsed.text,
        length: parsed.text.length,
        driveLinks: parsed.driveLinks,
        source: 'export_html',
      });
      return;
    }

    // Erros que NAO se beneficiam de fallback tab (doc nao existe ou sem
    // permissao — fallback ia abrir tab visivel e timeoutar). Retorna direto.
    if (exportErr === 'doc_nao_existe_ou_sem_permissao' || exportErr === 'doc_sem_permissao_de_acesso') {
      reportToPage(bridgeTabId, requestId, 'HG_DOC_RESULT', {
        ok: false,
        error: exportErr === 'doc_nao_existe_ou_sem_permissao'
          ? 'Doc nao existe ou voce nao tem permissao (URL pode estar errado no ClickUp)'
          : 'Doc privado — peca permissao de acesso pro owner no Google Docs',
      });
      return;
    }

    // === ESTRATEGIA 2 (FALLBACK): tab mobilebasic ===
    // So se export falhar por motivo recuperavel (ex login_necessario).
    console.warn('[DARKO LAB BG] export falhou (', exportErr, '), fallback tab method');
    const mobileUrl = `https://docs.google.com/document/d/${docId}/mobilebasic`;
    const tab = await chrome.tabs.create({ url: mobileUrl, active: false });
    const newTabId = tab.id;

    // try/finally: se o load timeoutar ou o executeScript falhar, a aba
    // era LEAKED (ficava aberta pra sempre) e o listener onUpdated tambem.
    let result;
    let loadListener = null;
    try {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timeout 20s carregando doc (fallback)')), 20000);
        loadListener = (changedTabId, changeInfo) => {
          if (changedTabId === newTabId && changeInfo.status === 'complete') {
            clearTimeout(timeout);
            resolve();
          }
        };
        chrome.tabs.onUpdated.addListener(loadListener);
      });
      await new Promise(r => setTimeout(r, 1500));

      [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: newTabId },
        func: () => {
          const links = Array.from(document.querySelectorAll('a'))
            .map((a) => {
              const text = (a.textContent || '').trim();
              const href = a.href || '';
              const m = href.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
              if (!m) return null;
              return { text, fileId: m[1] };
            })
            .filter(Boolean);
          return {
            text: document.body.innerText,
            isLogin: /accounts\.google\.com/.test(location.href),
            driveLinks: links,
          };
        },
      });
    } finally {
      if (loadListener) { try { chrome.tabs.onUpdated.removeListener(loadListener); } catch {} }
      try { await chrome.tabs.remove(newTabId); } catch {}
    }

    if (result?.isLogin) {
      reportToPage(bridgeTabId, requestId, 'HG_DOC_RESULT', { ok: false, error: 'Doc privado e nao logado no Google.' });
      return;
    }
    reportToPage(bridgeTabId, requestId, 'HG_DOC_RESULT', {
      ok: true,
      text: result?.text || '',
      length: (result?.text || '').length,
      driveLinks: result?.driveLinks || [],
      source: 'tab_fallback',
    });
  } catch (e) {
    reportToPage(bridgeTabId, requestId, 'HG_DOC_RESULT', { ok: false, error: e?.message ?? String(e) });
  }
}

chrome.tabs.onRemoved.addListener((tabId) => {
  for (const [requestId, job] of activeJobs.entries()) {
    if (job.tabId === tabId) {
      activeJobs.delete(requestId);
      reportToPage(job.bridgeTabId, requestId, 'HG_ERROR', {
        error:
          'Aba HeyGen foi fechada antes da geracao terminar. Reabra app.heygen.com e tente de novo.',
      });
    }
  }
});

console.log('[DARKO LAB Background] service worker iniciado');
