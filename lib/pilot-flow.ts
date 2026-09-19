/** Shared contract for the isolated Flow module in Hey Auto. No assumed pricing. */
export type FlowAccount = { name: string; email: string; avatarUrl?: string; credits: number | null };
export type FlowReference = { name: string; mimeType: string; dataUrl: string };
export type FlowSettings = {
  mode: 'image' | 'video';
  prompt: string;
  model: string;
  aspectRatio: '9:16' | '16:9';
  resolution: '360p' | '720p';
  videoMode: 'frames' | 'ingredients';
  durationSeconds: 4 | 6 | 8 | 10;
  count: 1 | 2 | 3 | 4;
  references: FlowReference[];
  animateMediaId?: string;
};
export type FlowAsset = {
  id: string;
  kind: 'image' | 'video';
  /** A playable/downloadable media URL, never the Flow editor route. */
  url?: string;
  posterUrl?: string;
  /** Canvas-only Flow previews need the real 1080p file before playback. */
  previewPending?: boolean;
  width?: number;
  height?: number;
  downloadResolution?: string;
};
export type FlowInspection = {
  account: FlowAccount;
  projectUrl: string;
  mode?: FlowSettings['mode'];
  models?: string[];
  controls?: { available?: string[]; selected?: string[]; model?: string | null; credits?: number | null };
  quote?: number | null;
};
export type FlowQuote = { credits: number | null; account: FlowAccount; projectUrl: string };
export type FlowProgress = { message: string; requestId?: string; stage?: string; percent?: number };
export const FLOW_VIDEO_MODELS = ['Omni 1.1 Flash', 'Veo 3.1 - Lite', 'Veo 3.1 - Fast', 'Veo 3.1 - Quality'] as const;
export const FLOW_IMAGE_MODELS = ['Nano Banana Pro', 'Nano Banana 2', 'Nano Banana 2 Lite'] as const;
export const DEFAULT_FLOW_SETTINGS: FlowSettings = {
  mode: 'video', prompt: '', model: FLOW_VIDEO_MODELS[0], aspectRatio: '9:16',
  resolution: '720p', videoMode: 'ingredients', durationSeconds: 8, count: 1, references: [],
};
export const FLOW_REFERENCE_MAX_BYTES = 10 * 1024 * 1024;
export const FLOW_DOWNLOAD_MAX_BYTES = 256 * 1024 * 1024;

export function flowProjectUrl(value?: string): string | undefined {
  if (!value?.trim()) return undefined;
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.port || url.username || url.password ||
      !((url.hostname === 'flow.google.com' && /^\/project\/[a-zA-Z0-9-]+\/?$/.test(url.pathname)) ||
        (url.hostname === 'labs.google' && /\/tools\/flow\/project\/[a-zA-Z0-9-]+\/?$/.test(url.pathname)))) {
    throw new Error('Use o endereço de um projeto do Google Flow.');
  }
  url.hash = ''; url.search = '';
  return url.toString();
}

export function validateFlowSettings(settings: FlowSettings, requirePrompt = true): void {
  if (!settings || !['image', 'video'].includes(settings.mode)) throw new Error('Escolha imagem ou vídeo.');
  if (requirePrompt && !settings.prompt?.trim()) throw new Error('Escreva o prompt do insert.');
  if (typeof settings.prompt !== 'string' || settings.prompt.length > 12000) throw new Error('O prompt deve ter até 12.000 caracteres.');
  if (!settings.model?.trim() || settings.model.length > 100) throw new Error('Escolha um motor do Flow.');
  if (!['9:16', '16:9'].includes(settings.aspectRatio)) throw new Error('Escolha 9:16 ou 16:9.');
  if (!['360p', '720p'].includes(settings.resolution)) throw new Error('Resolução de geração inválida.');
  if (!['frames', 'ingredients'].includes(settings.videoMode)) throw new Error('Modo de referência inválido.');
  if (![4, 6, 8, 10].includes(settings.durationSeconds)) throw new Error('Duração inválida.');
  if (![1, 2, 3, 4].includes(settings.count)) throw new Error('Gere de 1 a 4 resultados por vez.');
  if (!Array.isArray(settings.references) || settings.references.length > 4) throw new Error('Use no máximo 4 imagens de referência.');
  if (settings.mode === 'video' && settings.videoMode === 'frames' && settings.references.length > 2) {
    throw new Error('Frames aceita até 2 imagens: primeiro e último frame. Use Ingredientes para mais referências.');
  }
  for (const reference of settings.references) {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(reference.mimeType) ||
        !reference.dataUrl?.startsWith(`data:${reference.mimeType};base64,`)) {
      throw new Error('As referências devem ser imagens PNG, JPG ou WebP.');
    }
    const data = reference.dataUrl.split(',')[1];
    if (!data || !/^[A-Za-z0-9+/]*={0,2}$/.test(data) || data.length * .75 > FLOW_REFERENCE_MAX_BYTES) {
      throw new Error('Cada referência deve ter até 10 MB.');
    }
  }
  if (settings.animateMediaId && !/^[\w-]{1,160}$/.test(settings.animateMediaId)) throw new Error('Imagem de origem inválida.');
}

/** Quote invalidation includes references and prompt, not just the visible model. */
export function flowSettingsFingerprint(settings: FlowSettings, projectUrl = ''): string {
  const input = JSON.stringify([projectUrl, settings.mode, settings.model, settings.aspectRatio,
    settings.resolution, settings.videoMode, settings.durationSeconds, settings.count,
    settings.prompt, settings.animateMediaId || '', settings.references]);
  // Only an invalidation key, never an authentication/security signature.
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) hash = Math.imul(hash ^ input.charCodeAt(i), 16777619);
  return `${input.length}:${(hash >>> 0).toString(16)}`;
}

export function validateFlowDimensions(kind: FlowAsset['kind'], width: number, height: number): void {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('Não foi possível conferir as dimensões do arquivo baixado.');
  }
  if (kind === 'video' && Math.min(width, height) < 1080) {
    throw new Error(`O Flow devolveu ${width} × ${height}. O insert só entra após baixar a versão 1080p aprimorada.`);
  }
}
