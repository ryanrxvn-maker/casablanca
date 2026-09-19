/* DOM adapter for the current Google Flow UI. No network/auth interception. */
(() => {
  const adapterVersion = chrome.runtime.getManifest().version;
  const previousAdapter = globalThis.__autoeditFlowAdapter;
  if (previousAdapter?.version === adapterVersion) return;
  if (previousAdapter?.listener) chrome.runtime.onMessage.removeListener(previousAdapter.listener);
  const normalize = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const visible = (element) => Boolean(element && element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden');
  const all = (selector, root = document) => [...root.querySelectorAll(selector)].filter(visible);
  const text = (element) => (element?.innerText || element?.textContent || '').replace(/\s+/g, ' ').trim();
  function label(element) {
    const explicit = element.getAttribute('aria-label');
    if (explicit?.trim()) return explicit;
    const copy = element.cloneNode(true);
    for (const decoration of copy.querySelectorAll('[aria-hidden="true"],mat-icon:not([aria-label]):not([aria-labelledby])')) decoration.remove();
    // Material icon ligatures (e.g. "upload") are not the button's name.
    // Keep real text authoritative; tooltip is only an empty-text fallback.
    return text(copy) || element.getAttribute('mattooltip') || '';
  }
  const blobDownloads = new Map();
  const submissionAttempts = new Set();
  const gestureAttempts = new Set();
  const galleryMediaIdentities = new Map();
  function base64(bytes) {
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
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
  function one(elements, description) {
    if (elements.length !== 1) throw new Error(elements.length ? `${description}: há mais de um controle. Feche menus extras no Flow e tente novamente.` : `${description} não foi encontrado na interface do Flow.`);
    return elements[0];
  }
  function point(element) {
    if (element.disabled || element.getAttribute('aria-disabled') === 'true') throw new Error(`O controle ${label(element)} está indisponível no Flow.`);
    element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }
  function button(needle) {
    return one(all('button,[role="button"]').filter((element) => normalize(label(element)) === normalize(needle)), needle);
  }
  function radio(needle) {
    return one(all('[role="radio"]').filter((element) => normalize(text(element.querySelector('.toggle-text') || element)) === normalize(needle)), needle);
  }
  function activate(element) {
    if (element.disabled || element.getAttribute('aria-disabled') === 'true') throw new Error(`O controle ${label(element)} está indisponível no Flow.`);
    element.click();
    return { activated: true };
  }
  function accountControl() {
    const details = all('button[aria-label="Detalhes da conta"]');
    if (details.length === 1) return details[0];
    const candidates = all('button,[role="button"]');
    const labelled = candidates.filter((element) => /conta.*google|google.*conta|google account|abrir.*conta|menu.*conta/i.test(label(element)));
    if (labelled.length === 1) return labelled[0];
    return one(candidates.filter((element) => element.querySelector('img') && /plus|pro|ultra|conta|account/i.test(label(element))), 'Conta Google');
  }
  function cleanModelName(value) {
    return String(value || '').trim().replace(/^🍌\s*/u, '');
  }
  function modelControl(name) {
    return one(all('[role="menuitem"]').filter((element) => normalize(cleanModelName(text(element.querySelector('.label') || element))) === normalize(cleanModelName(name))), `Motor ${name}`);
  }
  function modelOptions() {
    return all('[role="menuitem"]').map((element) => cleanModelName(text(element.querySelector('.label') || element)));
  }
  function uiState() {
    const modelButton = all('button[aria-label="Selecionar família de modelos"]')[0];
    const options = modelOptions();
    return {
      accountOpen: all('button[aria-label="Fechar painel da conta"]').length === 1,
      settingsOpen: Boolean(modelButton && all('[role="radio"]').length),
      modelMenuOpen: Boolean(modelButton && options.length && (modelButton.getAttribute('aria-expanded') === 'true' || options.some((value) => /Omni|Veo|Banana|Imagen/i.test(value)))),
      models: options,
    };
  }
  function accountAvatar(root) {
    const profile = root?.querySelector('img.gb_X');
    if (profile?.currentSrc || profile?.src) return profile.currentSrc || profile.src;
    const candidates = root ? [...root.querySelectorAll('img')].filter((element) => {
      const alt = element.getAttribute('alt') || '';
      if (/\bring\b|anel|assinatura|subscription|plan|google\s*(one|ai)/i.test(`${alt} ${element.className || ''}`)) return false;
      const bounds = element.getBoundingClientRect();
      return bounds.width >= 24 && bounds.height >= 24 && bounds.width <= 160 && Math.abs(bounds.width - bounds.height) <= 8;
    }) : [];
    const labelled = candidates.find((element) => Boolean(element.getAttribute('alt')?.trim()));
    const image = labelled || (candidates.length === 1 ? candidates[0] : null);
    return image?.currentSrc || image?.src || undefined;
  }
  function account() {
    const roots = all('[role="dialog"],[role="menu"],mat-menu-panel,.cdk-overlay-pane,flow-account-panel');
    const candidates = roots.filter((root) => /@[^\s]+\./.test(text(root)));
    const root = candidates.sort((a, b) => text(a).length - text(b).length)[0];
    if (!root) {
      const header = document.querySelector('a[role="button"][aria-label^="Conta do Google:"]');
      const value = header?.getAttribute('aria-label') || '';
      const email = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
      if (!email) return null;
      const name = value.replace(/^Conta do Google:\s*/, '').split(/\n|\(/)[0].trim();
      const creditsValue = document.querySelector('.credits-count')?.textContent?.match(/[\d.,]+/)?.[0];
      return { name, email, avatarUrl: accountAvatar(header), credits: creditsValue ? Number(creditsValue.replace(/[.,](?=\d{3}(?:\D|$))/g, '').replace(',', '.')) : null };
    }
    const lines = (root.innerText || '').split(/\n+/).map((s) => s.trim()).filter(Boolean);
    const email = text(root).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
    if (!email) return null;
    const emailIndex = lines.findIndex((line) => line.includes(email));
    const creditsText = text(root).match(/([\d.,]+)\s*cr[eé]ditos(?:\s+do\s+Google\s+Flow)?/i)?.[1];
    const credits = creditsText ? Number(creditsText.replace(/[.,](?=\d{3}(?:\D|$))/g, '').replace(',', '.')) : null;
    return { name: emailIndex > 0 ? lines[emailIndex - 1] : email.split('@')[0], email, avatarUrl: accountAvatar(root), credits: Number.isFinite(credits) ? credits : null };
  }
  function settings() {
    const radios = all('[role="radio"]');
    const radioName = (element) => text(element.querySelector('.toggle-text') || element);
    const disabledRadio = (element) => element.disabled || element.getAttribute('aria-disabled') === 'true';
    const selected = radios.filter((element) => element.getAttribute('aria-checked') === 'true').map(radioName);
    const available = [...new Set(radios.filter((element) => !disabledRadio(element)).map(radioName).filter(Boolean))];
    const disabled = [...new Set(radios.filter(disabledRadio).map(radioName).filter(Boolean))];
    const modelButton = all('button[aria-label="Selecionar família de modelos"]')[0];
    const model = cleanModelName(text(modelButton?.querySelector('.label') || modelButton).replace(/keyboard_arrow_down|arrow_drop_down|expand_more/g, '')) || null;
    const quoteText = all('a,span,p,div').filter((element) => /^\d[\d.,]* cr[eé]ditos$/i.test(text(element))).sort((a, b) => text(a).length - text(b).length)[0];
    const quote = quoteText ? Number(text(quoteText).replace(/[^\d.,]/g, '').replace(',', '.')) : null;
    return { selected, available, disabled, model, credits: Number.isFinite(quote) ? quote : null };
  }
  function media() {
    const seen = new Set();
    return all('video,img').flatMap((element) => {
      const tile = element.closest('flow-tile-container');
      const videoTile = element.closest('flow-video-tile');
      if (videoTile && element !== (videoTile.querySelector('img.thumbnail') || videoTile.querySelector('video'))) return [];
      const url = element.currentSrc || element.src;
      if (!url || url.startsWith('data:') || /avatar|profile|icon|logo/i.test(element.className || '')) return [];
      const isVideo = element.tagName === 'VIDEO' || Boolean(videoTile);
      const width = element.videoWidth || element.naturalWidth;
      const height = element.videoHeight || element.naturalHeight;
      const rect = element.getBoundingClientRect();
      if ((rect.width < 80 || rect.height < 70) && (width < 200 || height < 200)) return [];
      let card = tile || element.closest('[data-asset-id],app-media-card,[data-testid*="media-card"],.media-card');
      if (!card) {
        let parent = element.parentElement;
        for (let i = 0; parent && i < 6; i++, parent = parent.parentElement) {
          if (parent.querySelector('button') && parent.querySelectorAll('img,video').length <= 2) { card = parent; break; }
        }
      }
      let hash = 2166136261;
      for (const character of url) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
      const id = element.getAttribute('data-media-id') || card?.getAttribute('data-media-id') || card?.getAttribute('data-asset-id') || (videoTile ? `video_${(hash >>> 0).toString(16)}` : null);
      if (!id) return [];
      if (seen.has(id)) return [];
      seen.add(id);
      return [{ id, kind: isVideo ? 'video' : 'image', url, width, height, description: text(card).slice(0, 500), canReuseCommand: Boolean(card?.querySelector('button[aria-label="Reutilizar comando"]')) }];
    });
  }
  function locateMedia(asset) {
    const element = all('video,img').find((item) => item.getAttribute('data-media-id') === asset.id || [item.currentSrc, item.src].includes(asset.url));
    if (!element) throw new Error('O resultado não está mais na galeria visível do Flow. Abra o projeto e tente baixar novamente.');
    return element;
  }
  function reuseMediaCommand(asset) {
    const tile = locateMedia(asset).closest('flow-tile-container');
    if (!tile) throw new Error('O cartão exato da mídia não foi encontrado.');
    // The card hotbar is hidden until hover. The observed Angular button still
    // accepts semantic activation, so do not filter it by visual visibility.
    const control = one([...tile.querySelectorAll('button[aria-label="Reutilizar comando"]')], 'Reutilizar comando deste resultado');
    return activate(control);
  }
  function generationObservation(prompt) {
    const compact = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const expected = compact(prompt);
    if (!expected) return { promptMatches: 0 };
    const matches = all('flow-tile-container').filter((tile) => all('*', tile).some((element) => compact(element.innerText || element.textContent) === expected));
    return { promptMatches: matches.length };
  }
  function referenceImageId(source) {
    try { return new URL(source, location.href).pathname.match(/\/image\/([\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12})(?:\/|$)/i)?.[1]?.toLowerCase() || null; }
    catch { return null; }
  }
  function asbIdentity(source) {
    try {
      const url = new URL(source, location.href);
      if (url.protocol !== 'https:' || !(url.hostname === 'flow.google.com' || /^lh\d+\.googleusercontent\.com$/.test(url.hostname))) return null;
      // Flow uses the same ASB asset through its own host and Google's image
      // CDN. Rendering transformations follow '=' and are not asset identity.
      const token = url.pathname.match(/^\/asb\/([a-zA-Z0-9_-]+)(?:=[^/]*)?$/)?.[1];
      return token ? `asb:${token}` : null;
    } catch { return null; }
  }
  function rememberGalleryMediaIdentities() {
    for (const image of document.querySelectorAll('img[data-media-id]')) {
      const id = image.getAttribute('data-media-id')?.toLowerCase();
      const identity = asbIdentity(image.currentSrc || image.src);
      if (id && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id) && identity) galleryMediaIdentities.set(id, identity);
    }
  }
  function matchesFrameIdentity(imageId, source) {
    const directId = referenceImageId(source);
    if (directId) return directId === imageId;
    const identity = asbIdentity(source);
    return Boolean(identity && galleryMediaIdentities.get(imageId) === identity);
  }
  function referenceIdentity(source) {
    const directId = referenceImageId(source);
    if (directId) return directId;
    const identity = asbIdentity(source);
    if (!identity) return null;
    const ids = [...galleryMediaIdentities].filter(([, candidate]) => candidate === identity).map(([id]) => id);
    return ids.length === 1 ? ids[0] : null;
  }
  function uploadedResource(name) {
    rememberGalleryMediaIdentities();
    const option = one(all('[role="option"]').filter((element) => text(element.querySelector('.asset-title')) === name), `Referência ${name}`);
    const thumbnail = option.querySelector('img.asset-thumbnail-image');
    const imageId = referenceIdentity(thumbnail?.currentSrc || thumbnail?.src);
    if (!imageId) throw new Error('O Flow ainda não confirmou a imagem enviada.');
    return { option, imageId };
  }
  function resourceSelection(name) {
    const resource = uploadedResource(name);
    const preview = all('img').find((element) => element.getAttribute('alt') === `Prévia de ${name}`);
    const previewId = referenceIdentity(preview?.currentSrc || preview?.src);
    return { imageId: resource.imageId, previewMatches: Boolean(preview && previewId === resource.imageId) };
  }
  function frameResource(imageId) {
    rememberGalleryMediaIdentities();
    const option = one(all('[role="option"]').filter((element) => {
      const thumbnail = element.querySelector('img.asset-thumbnail-image');
      return matchesFrameIdentity(imageId, thumbnail?.currentSrc || thumbnail?.src);
    }), 'Imagem do frame selecionado');
    return { option, name: text(option.querySelector('.asset-title')), imageId };
  }
  function frameReferenceSelection(imageId) {
    const resource = frameResource(imageId);
    const preview = all('img').find((element) => element.getAttribute('alt') === `Prévia de ${resource.name}`);
    return { imageId, previewMatches: Boolean(preview && matchesFrameIdentity(imageId, preview.currentSrc || preview.src)) };
  }
  function referencePlacementState(imageId, name) {
    const references = commandReferences();
    // Immediate insertion closes the picker, so its option/preview no longer
    // exists. The worker can still verify the exact UUID in the composer.
    let selection = null;
    try { selection = name ? resourceSelection(name) : frameReferenceSelection(imageId); } catch {}
    return { imageId, references, previewMatches: Boolean(selection?.imageId === imageId && selection.previewMatches) };
  }
  function openFrameSlot(index) {
    if (![0, 1].includes(index)) throw new Error('Escolha o frame inicial ou final.');
    const slots = all('.base-prompt-box flow-ingredient-bar .frame-trigger');
    if (slots.length !== 2) throw new Error('Os slots Início e Fim não foram encontrados no Flow.');
    rememberGalleryMediaIdentities();
    return activate(one([...slots[index].querySelectorAll('button.empty-chip')], index === 0 ? 'Frame inicial vazio' : 'Frame final vazio'));
  }
  function commandReferences() {
    const editor = all('[contenteditable="true"].ProseMirror')[0];
    let root = editor?.parentElement;
    for (let i = 0; root && i < 8; i++, root = root.parentElement) {
      if (root.querySelector('button[aria-label="Iniciar geração"]')) {
        const box = root.getBoundingClientRect();
        if (box.height > 600 || box.width > 1400) throw new Error('Não foi possível isolar as referências dentro da caixa de comando do Flow.');
        const images = all('img', root).filter((element) => element.getBoundingClientRect().width >= 24 && !element.closest('[role="menu"],[role="dialog"],.cdk-overlay-pane'));
        const ids = images.map((element) => referenceImageId(element.currentSrc || element.src)).filter(Boolean);
        const busy = images.some((element) => element.closest('[aria-busy]')?.getAttribute('aria-busy') === 'true') || all('[role="progressbar"],mat-progress-spinner', root).length > 0;
        const frameSlots = all('flow-ingredient-bar .frame-trigger', root);
        const frameIds = frameSlots.length === 2 ? frameSlots.map((slot) => { const image = slot.querySelector('img.chip-image'); return referenceImageId(image?.currentSrc || image?.src); }) : null;
        return { count: images.length, ids, busy, frameIds };
      }
    }
    throw new Error('A caixa de referências do Flow não foi encontrada.');
  }
  function readPrompt() {
    const editor = one(all('[contenteditable="true"].ProseMirror,[contenteditable="true"][role="textbox"],textarea').filter((element) => !element.closest('[role="dialog"]')), 'Campo de prompt');
    return String(editor.value ?? editor.innerText ?? '').replace(/\r\n/g, '\n').trim();
  }
  function submitGeneration(requestId, prompt) {
    if (typeof requestId !== 'string' || !requestId || requestId.length > 160) throw new Error('Identificador de envio inválido.');
    if (submissionAttempts.has(requestId)) throw new Error('Este pedido já recebeu uma tentativa de envio. O clique não será repetido.');
    if (typeof prompt !== 'string' || !prompt.trim() || readPrompt() !== prompt.trim()) throw new Error('O prompt do Flow mudou antes do envio. Nenhuma nova tentativa foi feita.');
    const target = button('Iniciar geração');
    if (target.disabled || target.getAttribute('aria-disabled') === 'true') throw new Error('O botão de geração do Flow está indisponível.');
    submissionAttempts.add(requestId);
    // The Angular handler is addressed directly: background-tab coordinates
    // did not activate this control in the observed end-to-end test.
    activate(target);
    return { activated: true, requestId };
  }
  function downloadControl(name) {
    if (!['2K', '1080p'].includes(name)) throw new Error('Resolução de download não autorizada.');
    return one(all('[role="menuitem"]').filter((element) => normalize(text(element)).startsWith(normalize(name))), `Download ${name}`);
  }
  function prepareGestureActivation(kind, name, requestId, token) {
    if (typeof requestId !== 'string' || !requestId || requestId.length > 180 || !/^[a-zA-Z0-9_-]{1,80}$/.test(token)) throw new Error('Identificador de ativação inválido.');
    if (!(kind === 'upload' && name === 'Enviar mídia') && !(kind === 'libraryUpload' && name === 'Enviar') && !(kind === 'download' && ['2K', '1080p'].includes(name))) throw new Error('Controle de ativação não autorizado.');
    const key = `${kind}:${requestId}`;
    if (gestureAttempts.has(key)) throw new Error('Este controle já recebeu uma tentativa. O clique não será repetido.');
    const target = kind === 'upload' ? button(name) : kind === 'libraryUpload' ? one(all('[role="menuitem"]').filter((element) => normalize(text(element)) === normalize('Enviar')), 'Enviar arquivo à biblioteca') : downloadControl(name);
    if (target.disabled || target.getAttribute('aria-disabled') === 'true') throw new Error('O controle do Flow está indisponível.');
    gestureAttempts.add(key);
    target.setAttribute('data-pilot-flow-activation', token);
    return { prepared: true };
  }
  function detailPreview({ kind, assetId } = {}) {
    if (assetId) {
      const currentId = location.pathname.match(/\/edit\/([\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12})\/?$/i)?.[1]?.toLowerCase();
      if (currentId !== assetId.toLowerCase()) throw new Error('A prévia não pertence ao resultado selecionado.');
    }
    const videos = all('video').filter((element) => element.currentSrc || element.src);
    const video = videos.length === 1 ? videos[0] : null;
    if (kind === 'video') {
      const posters = all('img').filter((element) => element.getAttribute('alt') === 'Prévia do vídeo da cena');
      const poster = posters.length === 1 ? posters[0] : null;
      // Current Flow renders video on canvas. Its poster is never a video URL;
      // the exact result remains downloadable even without a DOM media source.
      return { kind: 'video', ...(video ? { url: video.currentSrc || video.src, width: video.videoWidth, height: video.videoHeight } : {}),
        ...(poster ? { posterUrl: poster.currentSrc || poster.src } : {}), previewPending: !video };
    }
    const image = all('img').sort((a, b) => b.naturalWidth * b.naturalHeight - a.naturalWidth * a.naturalHeight)[0];
    return video ? { url: video.currentSrc || video.src, kind: 'video', width: video.videoWidth, height: video.videoHeight } : image ? { url: image.currentSrc || image.src, kind: 'image', width: image.naturalWidth, height: image.naturalHeight } : null;
  }
  const handlers = {
    ping: () => ({ ok: true, version: adapterVersion }),
    uiState: () => uiState(),
    downloadReady: () => ({ ready: all('button[aria-label="Baixar mídia"]').length === 1 }),
    detailPreview: (payload) => detailPreview(payload),
    galleryTop: () => {
      const tile = document.querySelector('flow-tile-container');
      let parent = tile?.parentElement;
      for (let i = 0; parent && i < 12; i++, parent = parent.parentElement) {
        if (parent.scrollHeight > parent.clientHeight + 100) parent.scrollTop = 0;
      }
      window.scrollTo(0, 0);
      return { ok: true };
    },
    inspect: () => ({ projectUrl: location.href, account: account(), controls: settings(), assets: media(), models: modelOptions() }),
    account: () => account(),
    accountButton: () => point(accountControl()),
    activateAccount: () => activate(accountControl()),
    accountSwitch: () => point(one(all('a.switch-account-link'), 'Mudar de conta')),
    button: ({ name }) => point(button(name)),
    activateButton: ({ name }) => {
      if (name === 'Iniciar geração') throw new Error('A geração só pode ser enviada pelo fluxo de confirmação do Pilot.');
      return activate(button(name));
    },
    activateRadio: ({ name }) => activate(radio(name)),
    activateModel: ({ name }) => activate(modelControl(name)),
    submitGeneration: ({ requestId, prompt }) => submitGeneration(requestId, prompt),
    prepareGestureActivation: ({ kind, name, requestId, token }) => prepareGestureActivation(kind, name, requestId, token),
    downloadSelectionState: () => ({ menuOpen: all('[role="menuitem"]').some((element) => /^(1K|2K|4K|270p|720p|1080p)\b/i.test(text(element))) }),
    uploadedResource: ({ name }) => ({ imageId: uploadedResource(name).imageId }),
    selectUploadedResource: ({ name }) => activate(uploadedResource(name).option),
    resourceSelection: ({ name }) => resourceSelection(name),
    openFrameSlot: ({ index }) => openFrameSlot(index),
    frameResource: ({ imageId }) => ({ name: frameResource(imageId).name, imageId }),
    selectFrameResource: ({ imageId }) => activate(frameResource(imageId).option),
    frameReferenceSelection: ({ imageId }) => frameReferenceSelection(imageId),
    referencePlacementState: ({ imageId, name }) => referencePlacementState(imageId, name),
    commandReferences: () => commandReferences(),
    blobDownloadStart: async ({ url, requestId, kind }) => {
      if (!url.startsWith(`blob:${location.origin}/`)) throw new Error('O download temporário não pertence a esta aba do Flow.');
      const response = await fetch(url);
      if (!response.ok) throw new Error('O arquivo temporário do Flow expirou. Solicite o download novamente.');
      const blob = await response.blob();
      if (!blob.size || blob.size > 256 * 1024 * 1024) throw new Error('O arquivo do Flow está vazio ou supera 256 MB.');
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const mimeType = mediaMime(bytes, kind);
      blobDownloads.set(requestId, bytes);
      return { size: bytes.length, mimeType, total: Math.ceil(bytes.length / (512 * 1024)) };
    },
    blobDownloadChunk: ({ requestId, index }) => {
      const bytes = blobDownloads.get(requestId);
      if (!bytes || !Number.isInteger(index) || index < 0 || index * 512 * 1024 >= bytes.length) throw new Error('Parte de download inválida.');
      return { data: base64(bytes.subarray(index * 512 * 1024, (index + 1) * 512 * 1024)) };
    },
    blobDownloadClose: ({ requestId }) => { blobDownloads.delete(requestId); return { ok: true }; },
    radio: ({ name }) => { const element = radio(name); return { ...point(element), selected: element.getAttribute('aria-checked') === 'true' }; },
    model: ({ name }) => point(modelControl(name)),
    settings: () => settings(),
    editor: () => {
      const editor = one(all('[contenteditable="true"].ProseMirror,[contenteditable="true"][role="textbox"],textarea').filter((element) => !element.closest('[role="dialog"]')), 'Campo de prompt');
      editor.focus();
      return { ...point(editor), text: editor.value ?? editor.innerText ?? '' };
    },
    prompt: () => readPrompt(),
    upload: ({ references }) => {
      const inputs = [...document.querySelectorAll('input[type="file"]')].filter((input) => !input.disabled && (!input.accept || /image|png|jpg|jpeg|webp/i.test(input.accept)));
      const input = one(inputs, 'Upload de referências');
      const transfer = new DataTransfer();
      for (const reference of references) {
        const data = reference.dataUrl.split(',')[1];
        const binary = atob(data);
        const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
        transfer.items.add(new File([bytes], reference.name, { type: reference.mimeType }));
      }
      if (references.length > 1 && !input.multiple) throw new Error('O seletor do Flow aceita uma imagem por vez. Use o upload individual.');
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return { accepted: references.length };
    },
    media: () => ({ assets: media(), errors: all('[role="alert"],.error-message').map(text).filter(Boolean), busy: all('[role="progressbar"],mat-progress-spinner').length > 0 }),
    generationObservation: ({ prompt }) => generationObservation(prompt),
    reuseMediaCommand: ({ asset }) => reuseMediaCommand(asset),
    mediaHover: ({ asset }) => point(locateMedia(asset)),
    mediaOpen: ({ asset }) => point(locateMedia(asset)),
    mediaMenu: ({ asset }) => {
      const element = locateMedia(asset);
      let parent = element.parentElement;
      for (let i = 0; parent && i < 8; i++, parent = parent.parentElement) {
        const options = all('button,[role="button"]', parent).filter((candidate) => /more_vert|mais op[cç][oõ]es|more options|abrir menu|menu da m[ií]dia/i.test(label(candidate)));
        if (options.length === 1) return point(options[0]);
        if (options.length > 1) break;
      }
      throw new Error('Menu do resultado não encontrado. O arquivo gerado foi preservado no Flow.');
    },
    menu: ({ name }) => point(one(all('[role="menuitem"],button,[role="button"]').filter((element) => normalize(text(element)).startsWith(normalize(name)) || normalize(element.getAttribute('aria-label')) === normalize(name)), name)),
    dimensions: async ({ dataUrl, kind }) => new Promise((resolve, reject) => {
      const element = document.createElement(kind === 'video' ? 'video' : 'img');
      const timer = setTimeout(() => { element.removeAttribute('src'); reject(new Error('Não foi possível ler a resolução do arquivo baixado.')); }, 20000);
      element.preload = 'metadata';
      const ready = () => { clearTimeout(timer); resolve({ width: element.videoWidth || element.naturalWidth, height: element.videoHeight || element.naturalHeight }); element.removeAttribute('src'); };
      element.addEventListener(kind === 'video' ? 'loadedmetadata' : 'load', ready, { once: true });
      element.addEventListener('error', () => { clearTimeout(timer); reject(new Error('O Flow devolveu um arquivo de mídia inválido.')); }, { once: true });
      element.src = dataUrl;
    }),
  };
  const listener = (message, sender, respond) => {
    if (message?.type !== 'FLOW_DOM' || !handlers[message.op]) return;
    Promise.resolve().then(() => handlers[message.op](message.payload || {}))
      .then((result) => respond({ ok: true, result }), (error) => respond({ ok: false, error: String(error?.message || error) }));
    return true;
  };
  chrome.runtime.onMessage.addListener(listener);
  globalThis.__autoeditFlowAdapter = { version: adapterVersion, listener };
})();
