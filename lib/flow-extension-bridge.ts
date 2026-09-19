'use client';

import {
  FLOW_DOWNLOAD_MAX_BYTES, flowProjectUrl, validateFlowDimensions, validateFlowSettings,
  type FlowAccount, type FlowAsset, type FlowInspection, type FlowProgress, type FlowQuote, type FlowSettings,
} from './pilot-flow';
export type { FlowAccount, FlowAsset, FlowInspection, FlowProgress, FlowQuote, FlowSettings } from './pilot-flow';

type Reply = { dataUrl?: string; mimeType?: string; width?: number; height?: number; chunked?: boolean; blob?: Blob };
type Pending = {
  resolve: (value: unknown) => void; reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>; ackTimeout: ReturnType<typeof setTimeout>;
  onProgress?: (progress: FlowProgress) => void;
  extensionId?: string;
  action: string;
  discoveryTimeout?: ReturnType<typeof setTimeout>;
  candidates: Map<string, string>;
  dispatch: (extensionId: string) => void;
  chunks: Map<number, Uint8Array>; total?: number; bytes: number;
};
const pending = new Map<string, Pending>();
let installed = false;
const MIN_FLOW_VERSION = '4.45.4';
function supportsFlow(version: string): boolean {
  const actual = version.split('.').map(Number);
  const required = MIN_FLOW_VERSION.split('.').map(Number);
  if (actual.some(value => !Number.isInteger(value) || value < 0)) return false;
  for (let index = 0; index < required.length; index++) {
    if ((actual[index] || 0) !== required[index]) return (actual[index] || 0) > required[index];
  }
  return true;
}

function decodeBase64(data: string): Uint8Array {
  const raw = atob(data);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}
function settle(id: string, error?: Error, value?: unknown) {
  const item = pending.get(id);
  if (!item) return;
  clearTimeout(item.timeout); clearTimeout(item.ackTimeout);
  if (item.discoveryTimeout) clearTimeout(item.discoveryTimeout);
  pending.delete(id);
  if (error) item.reject(error); else item.resolve(value);
}
function installListener() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const message = event.data;
    if (message?.source !== 'flow-extension' || typeof message.requestId !== 'string') return;
    const item = pending.get(message.requestId);
    if (!item) return;
    if (message.type === 'FLOW_PONG' && !item.extensionId) {
      if (typeof message.extensionId !== 'string' || !message.extensionId || message.extensionId.length > 128) return;
      const version = String(message.version || message.payload?.version || '0');
      item.candidates.set(message.extensionId, version);
      if (!item.discoveryTimeout) {
        item.discoveryTimeout = setTimeout(() => {
          if (!pending.has(message.requestId) || item.extensionId) return;
          // A instalação mais nova vence; só ela recebe o comando que pode gastar créditos.
          const candidates = [...item.candidates].sort(([idA, versionA], [idB, versionB]) => {
            const a = versionA.split('.').map(value => parseInt(value, 10) || 0);
            const b = versionB.split('.').map(value => parseInt(value, 10) || 0);
            for (let index = 0; index < Math.max(a.length, b.length); index++) {
              const difference = (b[index] || 0) - (a[index] || 0);
              if (difference) return difference;
            }
            return idA.localeCompare(idB);
          });
          if (candidates[0]) {
            if (!['status', 'cancel', 'open'].includes(item.action) && !supportsFlow(candidates[0][1])) {
              settle(message.requestId, new Error(`Atualize a Hey Auto para a versão ${MIN_FLOW_VERSION} ou superior para usar os inserts do Flow.`));
              return;
            }
            item.dispatch(candidates[0][0]);
          }
        }, 500);
      }
      return;
    }
    // Uma resposta sem identidade nunca confirma geração nem cancela o watchdog.
    if (!item.extensionId || message.extensionId !== item.extensionId) return;
    if (!['FLOW_ACK', 'FLOW_PROGRESS', 'FLOW_DOWNLOAD_CHUNK', 'FLOW_ERROR', 'FLOW_RESULT'].includes(message.type)) return;
    clearTimeout(item.ackTimeout);
    if (message.type === 'FLOW_ACK') return;
    if (message.type === 'FLOW_PROGRESS') {
      const data = message.payload || message;
      item.onProgress?.({ message: String(data.message || data.stage || 'Processando no Flow…'),
        stage: data.stage, percent: data.percent, requestId: message.requestId });
      return;
    }
    if (message.type === 'FLOW_DOWNLOAD_CHUNK') {
      const data = message.payload || message;
      try {
        if (item.action !== 'download') throw new Error('Resposta de download fora da operação esperada.');
        if (!Number.isInteger(data.index) || !Number.isInteger(data.total) || data.index < 0 ||
            data.index >= data.total || data.total > 1024 || data.total < 1 ||
            (item.total !== undefined && item.total !== data.total) || typeof data.data !== 'string' || data.data.length > 2 * 1024 * 1024) {
          throw new Error('O download do Flow chegou incompleto.');
        }
        if (item.chunks.has(data.index)) return;
        const bytes = decodeBase64(data.data);
        item.bytes += bytes.length;
        if (item.bytes > FLOW_DOWNLOAD_MAX_BYTES) throw new Error('O arquivo do Flow excede 256 MB.');
        item.total = data.total; item.chunks.set(data.index, bytes);
      } catch (error) { settle(message.requestId, error instanceof Error ? error : new Error('Download inválido.')); }
      return;
    }
    if (message.type === 'FLOW_ERROR') {
      settle(message.requestId, new Error(String(message.error || message.payload?.error || 'O Flow não concluiu a operação.')));
    } else if (message.type === 'FLOW_RESULT') {
      const result = message.payload ?? message.result ?? {};
      if (result.chunked) {
        if (!item.total || item.chunks.size !== item.total) {
          settle(message.requestId, new Error('Faltam partes do download do Flow. Tente baixar novamente.')); return;
        }
        result.blob = new Blob(Array.from({ length: item.total }, (_, i) => item.chunks.get(i)! as BlobPart), { type: result.mimeType });
      }
      settle(message.requestId, undefined, result);
    }
  });
}

function request<T>(action: string, payload: unknown, onProgress?: (progress: FlowProgress) => void, timeoutMs = 90000, persistedRequestId?: string): Promise<T> {
  if (typeof window === 'undefined') return Promise.reject(new Error('Abra o Pilot no Chrome com a extensão Hey Auto.'));
  installListener();
  const requestId = persistedRequestId || `flow_${crypto.randomUUID()}`;
  if (!/^flow_[\w-]{1,150}$/.test(requestId)) return Promise.reject(new Error('Identificação do pedido Flow inválida.'));
  if (pending.has(requestId)) return Promise.reject(new Error('Este pedido Flow já está em andamento.'));
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => settle(requestId, new Error(action === 'generate'
      ? 'O Flow ainda não confirmou o resultado. Confira o projeto antes de gerar novamente para evitar gasto duplicado.'
      : 'O Flow demorou a responder. Confira se o projeto está aberto e conectado.')), timeoutMs);
    const missingExtension = () => settle(requestId, new Error('Atualize a extensão Hey Auto para a versão com Flow e recarregue o Pilot.'));
    const ackTimeout = setTimeout(missingExtension, 8000);
    const item: Pending = { resolve: value => resolve(value as T), reject, timeout, ackTimeout,
      action, onProgress, candidates: new Map(), chunks: new Map(), bytes: 0,
      dispatch: extensionId => {
        if (item.extensionId || !pending.has(requestId)) return;
        item.extensionId = extensionId;
        clearTimeout(item.ackTimeout);
        item.ackTimeout = setTimeout(missingExtension, 8000);
        try {
          window.postMessage({ source: 'pilot-flow', type: 'FLOW_REQUEST', requestId, extensionId, action, payload }, window.location.origin);
        } catch (error) { settle(requestId, error instanceof Error ? error : new Error('Não consegui enviar o comando para a extensão.')); }
      },
    };
    pending.set(requestId, item);
    onProgress?.({ requestId, message: 'Conectando ao Flow…', stage: 'connecting' });
    try {
      window.postMessage({ source: 'pilot-flow', type: 'FLOW_PING', requestId }, window.location.origin);
    } catch (error) { settle(requestId, error instanceof Error ? error : new Error('Não consegui encontrar a extensão do Flow.')); }
  });
}

export function flowInspect(projectUrl?: string, preferences?: { mode: FlowSettings['mode']; model?: string }): Promise<FlowInspection> {
  if (preferences && !['image', 'video'].includes(preferences.mode)) throw new Error('Escolha Imagem ou Vídeo para consultar os motores.');
  if (preferences?.model !== undefined && (typeof preferences.model !== 'string' || !preferences.model.trim())) throw new Error('Selecione um motor do Flow.');
  return request('inspect', { projectUrl: flowProjectUrl(projectUrl), ...(preferences ? { mode: preferences.mode, model: preferences.model } : {}) });
}
export function flowQuote(settings: FlowSettings, projectUrl?: string): Promise<FlowQuote> {
  validateFlowSettings(settings, false);
  return request('quote', { ...settings, projectUrl: flowProjectUrl(projectUrl) });
}
export function flowGenerate(settings: FlowSettings, options: {
  projectUrl: string; expectedAccountEmail: string; maxCredits: number; onProgress?: (progress: FlowProgress) => void;
  /** Persisted by the UI before the extension can submit a paid generation. */
  requestId?: string;
}): Promise<{ assets: FlowAsset[]; projectUrl: string; account?: FlowAccount }> {
  validateFlowSettings(settings);
  if (!options.expectedAccountEmail?.includes('@')) throw new Error('Conecte e confira a conta do Flow antes de gerar.');
  if (!Number.isFinite(options.maxCredits) || options.maxCredits < 0) throw new Error('Confira os créditos no Flow antes de gerar.');
  const projectUrl = flowProjectUrl(options.projectUrl);
  if (!projectUrl) throw new Error('Conecte um projeto do Flow antes de gerar.');
  return request('generate', { ...settings, projectUrl,
    expectedAccountEmail: options.expectedAccountEmail, maxCredits: options.maxCredits }, options.onProgress, 25 * 60 * 1000, options.requestId);
}
export function flowOpen(projectUrl?: string): Promise<{ projectUrl: string }> {
  return request('open', { projectUrl: flowProjectUrl(projectUrl) });
}
export function flowCancel(requestId: string, options?: { acknowledgeUncertain?: boolean }): Promise<unknown> {
  return request('cancel', { requestId, ...(options?.acknowledgeUncertain ? { acknowledgeUncertain: true } : {}) });
}
export function flowStatus(requestId: string, options?: { expectedPrompt?: string }): Promise<unknown> {
  const expectedPrompt = options?.expectedPrompt;
  if (expectedPrompt !== undefined && (typeof expectedPrompt !== 'string' || !expectedPrompt.trim() || expectedPrompt.length > 12000)) {
    throw new Error('O comando original do pedido é inválido para recuperação.');
  }
  return request('status', { requestId, ...(expectedPrompt !== undefined ? { expectedPrompt: expectedPrompt.trim() } : {}) });
}

async function dimensions(blob: Blob, kind: FlowAsset['kind']): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise((resolve, reject) => {
      const media = document.createElement(kind === 'video' ? 'video' : 'img');
      const timer = setTimeout(() => done(new Error('Não foi possível abrir a mídia baixada do Flow.')), 25000);
      const done = (error?: Error) => {
        clearTimeout(timer); media.onload = null; media.onloadedmetadata = null; media.onerror = null;
        if (media instanceof HTMLVideoElement) { media.removeAttribute('src'); media.load(); }
        if (error) reject(error);
      };
      const ready = () => {
        const width = media instanceof HTMLVideoElement ? media.videoWidth : media.naturalWidth;
        const height = media instanceof HTMLVideoElement ? media.videoHeight : media.naturalHeight;
        try { validateFlowDimensions(kind, width, height); resolve({ width, height }); done(); }
        catch (error) { done(error instanceof Error ? error : new Error('Dimensões inválidas.')); }
      };
      media.onload = ready; media.onloadedmetadata = ready;
      media.onerror = () => done(new Error('O arquivo retornado pelo Flow não é uma mídia reproduzível.'));
      if (media instanceof HTMLVideoElement) media.preload = 'metadata';
      media.src = url;
    });
  } finally { URL.revokeObjectURL(url); }
}

/** Only returns after decoding the real downloaded bytes, never a thumbnail. */
export async function flowDownload(asset: FlowAsset, projectUrl?: string, onProgress?: (progress: FlowProgress) => void): Promise<File> {
  const result = await request<Reply>('download', { asset, projectUrl: flowProjectUrl(projectUrl), resolution: '1080p' }, onProgress, 12 * 60 * 1000);
  let blob = result.blob;
  if (!blob && typeof result.dataUrl === 'string') {
    const match = /^data:((?:video|image)\/[\w.+-]+);base64,([\s\S]+)$/.exec(result.dataUrl);
    if (!match || match[2].length * .75 > FLOW_DOWNLOAD_MAX_BYTES) throw new Error('O Flow devolveu um arquivo inválido.');
    blob = new Blob([decodeBase64(match[2]) as BlobPart], { type: match[1] });
  }
  if (!blob?.size || blob.size > FLOW_DOWNLOAD_MAX_BYTES || !blob.type.startsWith(asset.kind === 'video' ? 'video/' : 'image/')) throw new Error('O Flow não devolveu os bytes válidos da mídia.');
  const size = await dimensions(blob, asset.kind);
  const ext = asset.kind === 'video' ? (blob.type.includes('webm') ? 'webm' : 'mp4') : blob.type.includes('jpeg') ? 'jpg' : blob.type.includes('webp') ? 'webp' : 'png';
  return new File([blob], `Flow-${asset.id.replace(/[^\w-]/g, '').slice(0,80)}-${size.width}x${size.height}.${ext}`, { type: blob.type });
}
