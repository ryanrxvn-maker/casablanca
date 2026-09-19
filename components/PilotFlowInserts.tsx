'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { insertPadrao, type Insert } from '@/lib/pilot-inserts';
import { travarScrollDaPagina } from '@/lib/trava-scroll';
import {
  DEFAULT_FLOW_SETTINGS,
  FLOW_IMAGE_MODELS,
  FLOW_VIDEO_MODELS,
  FLOW_DOWNLOAD_MAX_BYTES,
  flowProjectUrl,
  type FlowAccount,
  type FlowAsset,
  type FlowInspection,
  type FlowQuote,
  type FlowSettings,
} from '@/lib/pilot-flow';
import { flowCancel, flowDownload, flowGenerate, flowInspect, flowOpen, flowQuote, flowStatus } from '@/lib/flow-extension-bridge';
import s from './PilotFlowInserts.module.css';

type Parte = { label: string; text: string };
type InsertMedia = { key: string; nome: string; tipo: 'video' | 'imagem'; w: number; h: number; durSec?: number };
type Range = { ancora: string; de: number; ate: number };
type StudioAsset = FlowAsset & { projectUrl?: string; accountEmail?: string };
type ActiveJob = { requestId: string; projectUrl: string; startedAt: number; accountEmail?: string; prompt?: string };
type Draft = { settings: FlowSettings; projectUrl: string; range: Range | null; assets: StudioAsset[]; account?: FlowAccount | null; activeJob?: ActiveJob | null; selectedModels?: Record<FlowSettings['mode'], string> };
type RecoveredJob = { state?: string; stage?: string; submitted?: boolean; assets?: StudioAsset[]; projectUrl?: string; account?: FlowAccount; error?: string };
type Busy = 'inspect' | 'quote' | 'generate' | 'download' | null;
type Session = {
  busy: Busy; progress: string; error: string; inspection: FlowInspection | null;
  quote: FlowQuote | null; quoteKey: string; assets: StudioAsset[]; projectUrl: string;
  activeJob?: ActiveJob | null; recoveryMessage?: string; recoveryState?: string; preparedSettings?: FlowSettings | null;
  account?: FlowAccount | null; mediaRevision?: number;
  montage?: { busy: boolean; error: string; notice: string };
};

// The running request belongs to the task, not to the dialog. Closing/reopening
// keeps progress and results and cannot dispatch the same task a second time.
const sessions = new Map<string, Session>();
const subscribers = new Map<string, Set<(session: Session) => void>>();
function sessionFor(key: string): Session {
  let value = sessions.get(key);
  if (!value) {
    value = { busy: null, progress: '', error: '', inspection: null, quote: null, quoteKey: '', assets: [], projectUrl: '' };
    sessions.set(key, value);
  }
  return value;
}
function updateSession(key: string, changes: Partial<Session>) {
  const next = { ...sessionFor(key), ...changes };
  sessions.set(key, next);
  subscribers.get(key)?.forEach((listener) => listener(next));
}

const DRAFT_DB = 'pilot-flow-studio-v1';
async function draftDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DRAFT_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Não foi possível abrir o armazenamento local.'));
    request.onblocked = () => reject(new Error('Outra aba bloqueou o armazenamento do Flow.'));
  });
}
async function readDraft(key: string): Promise<Draft | null> {
  const db = await draftDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('drafts', 'readonly').objectStore('drafts').get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}
async function saveDraft(key: string, draft: Draft) {
  const db = await draftDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('drafts', 'readwrite');
      tx.objectStore('drafts').put(draft, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('O navegador interrompeu o salvamento.'));
    });
  } finally { db.close(); }
}
function flowMediaKey(asset: StudioAsset): string {
  const project = flowProjectUrl(asset.projectUrl);
  if (!project || !asset.accountEmail || !asset.id) throw new Error('A mídia ainda não tem conta e projeto de origem confirmados.');
  return JSON.stringify([asset.accountEmail.toLowerCase(), project, asset.kind, asset.id]);
}
async function flowMediaStore<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    let db: IDBDatabase | undefined;
    let settled = false;
    const finish = (error?: unknown, value?: T) => {
      if (settled) return;
      settled = true; clearTimeout(timer); db?.close();
      if (error) reject(error); else resolve(value as T);
    };
    const timer = setTimeout(() => finish(new Error('O navegador demorou a salvar ou recuperar a prévia do Flow.')), 90000);
    let request: IDBOpenDBRequest;
    try { request = indexedDB.open('pilot-flow-media-v1', 1); }
    catch (error) { finish(error); return; }
    request.onupgradeneeded = () => request.result.createObjectStore('media');
    request.onerror = () => finish(request.error || new Error('Não foi possível abrir o armazenamento de prévias.'));
    request.onblocked = () => finish(new Error('Outra aba bloqueou o armazenamento da prévia do Flow.'));
    request.onsuccess = () => {
      db = request.result;
      if (settled) { db.close(); return; }
      try {
        const tx = db.transaction('media', mode);
        const result = operation(tx.objectStore('media'));
        tx.oncomplete = () => finish(undefined, result.result);
        tx.onerror = () => finish(tx.error || new Error('Não foi possível salvar a prévia do Flow.'));
        tx.onabort = () => finish(tx.error || new Error('O navegador interrompeu o armazenamento da prévia.'));
      } catch (error) { finish(error); }
    };
  });
}
async function readFlowMedia(asset: StudioAsset): Promise<File | null> {
  const stored = await flowMediaStore<{ file?: File; size?: number } | undefined>('readonly', (store) => store.get(flowMediaKey(asset)));
  const file = stored?.file;
  if (!file) return null;
  // A partial/corrupt local record is never imported; download it again instead.
  if (!(file instanceof File) || !file.size || file.size !== stored.size || file.size > FLOW_DOWNLOAD_MAX_BYTES || !file.type.startsWith(asset.kind === 'video' ? 'video/' : 'image/')) return null;
  return file;
}
async function saveFlowMedia(asset: StudioAsset, file: File): Promise<void> {
  await flowMediaStore('readwrite', (store) => store.put({ file, size: file.size }, flowMediaKey(asset)));
}
async function flowMediaFile(asset: StudioAsset, origin: string, onProgress: (event: { message: string }) => void): Promise<File> {
  const cached = await readFlowMedia(asset);
  if (cached) return cached;
  // flowDownload validates the real decoded dimensions before returning bytes.
  const downloaded = await flowDownload(asset, origin, onProgress);
  await saveFlowMedia(asset, downloaded);
  const stored = await readFlowMedia(asset);
  if (!stored || stored.size !== downloaded.size || stored.type !== downloaded.type) throw new Error('A prévia do Flow não foi salva por completo. Tente novamente.');
  return stored;
}
function fileDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`Não foi possível ler ${file.name}.`));
    reader.readAsDataURL(file);
  });
}
function errorText(error: unknown): string { return error instanceof Error ? error.message : 'Não foi possível concluir. Tente novamente.'; }
const controlLabel = (value: string) => value.replace(/\s+/g, '').replace(/×/g, 'x').toLowerCase();
function availableControls(inspection: FlowInspection | null, settings: FlowSettings) {
  const matches = inspection?.mode === settings.mode && inspection.controls?.model === settings.model && Array.isArray(inspection.controls.available);
  const available = matches ? inspection!.controls!.available!.map(controlLabel) : null;
  const filter = <T extends string | number,>(values: readonly T[], label: (value: T) => string = String): T[] => values.filter((value) => !available || available.includes(controlLabel(label(value))));
  return {
    matches,
    durations: filter([4, 6, 8, 10] as const, (value) => `${value}s`),
    resolutions: filter(['360p', '720p'] as const),
    aspects: filter(['9:16', '16:9'] as const),
    counts: filter([1, 2, 3, 4] as const, (value) => `x${value}`),
    videoModes: filter(['frames', 'ingredients'] as const, (value) => value === 'frames' ? 'Frames' : 'Elementos'),
  };
}
function settingsForInspection(current: FlowSettings, inspection: FlowInspection): FlowSettings {
  const controls = availableControls(inspection, current);
  if (!controls.matches) return current;
  const selected = (inspection.controls?.selected || []).map(controlLabel);
  const valid = <T extends string | number,>(value: T, options: readonly T[], label: (value: T) => string = String) => options.includes(value) ? value : options.find((option) => selected.includes(controlLabel(label(option)))) ?? options[0] ?? value;
  return {
    ...current,
    aspectRatio: valid(current.aspectRatio, controls.aspects),
    count: valid(current.count, controls.counts, (value) => `x${value}`),
    ...(current.mode === 'video' ? {
      durationSeconds: valid(current.durationSeconds, controls.durations, (value) => `${value}s`),
      resolution: valid(current.resolution, controls.resolutions),
      // An animation must retain its first frame. Unsupported engines require
      // an explicit new choice instead of silently switching to ingredients.
      videoMode: current.animateMediaId ? 'frames' : valid(current.videoMode, controls.videoModes, (value) => value === 'frames' ? 'Frames' : 'Elementos'),
    } : {}),
  };
}
function assetUrl(asset: FlowAsset): string | undefined {
  if (asset.previewPending) return undefined;
  return mediaUrl(asset.url);
}
function mediaUrl(value?: string): string | undefined {
  if (!value) return undefined;
  try { const url = new URL(value); return url.protocol === 'https:' || url.protocol === 'blob:' ? value : undefined; }
  catch { return undefined; }
}
function FlowMark({ size = 22 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4.4 15.3 9.1 5.4c.5-1.1 2-1.1 2.5 0l2 4.2m-3.2 8.1 4.8-10.1c.5-1.1 2-1.1 2.5 0l3 6.5c.4.9-.2 1.9-1.2 1.9H5.6c-1 0-1.6-1-1.2-1.9Z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/><path d="M7.4 20h9.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" opacity=".55"/></svg>;
}
function Icon({ name }: { name: 'close' | 'arrow' | 'image' | 'video' | 'upload' | 'check' | 'refresh' | 'external' | 'trash' | 'spark' }) {
  const paths: Record<typeof name, ReactNode> = {
    close: <path d="m6 6 12 12M18 6 6 18" />,
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
    image: <><rect x="3" y="3" width="18" height="18" rx="3"/><path d="m3 16 5-5 5 5 3-3 5 5"/><circle cx="15.5" cy="8" r="1.5"/></>,
    video: <><rect x="3" y="4" width="18" height="16" rx="3"/><path d="m10 8 6 4-6 4V8Z"/></>,
    upload: <><path d="M12 16V3m-5 5 5-5 5 5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/></>,
    check: <path d="m5 12 4 4L19 6" />,
    refresh: <><path d="M20 7a9 9 0 1 0 .5 9M20 3v5h-5"/></>,
    external: <><path d="M14 3h7v7m0-7L10 14M10 3H6a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3h12a3 3 0 0 0 3-3v-4"/></>,
    trash: <><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/></>,
    spark: <><path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4L12 3Z"/></>,
  };
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export function PilotFlowButton({ enabled, count, onClick }: { enabled: boolean; count: number; onClick: () => void }) {
  return <button type="button" className={`${s.trigger} ${enabled ? s.triggerActive : ''}`} onClick={(event) => { event.stopPropagation(); onClick(); }} aria-label={`Inserts do Flow${enabled ? ', ligado' : ', desligado'}${count ? `, ${count} inserts` : ''}`} aria-haspopup="dialog" title={`Inserts do Flow · ${enabled ? 'Ligado' : 'Desligado'}`} data-flow-trigger="true" data-enabled={enabled}>
    <span className={s.triggerOrbit} aria-hidden="true"/><FlowMark size={20}/>{count > 0 && <span className={s.triggerCount}>{count}</span>}
  </button>;
}

export function PilotFlowInsertsModal({ taskId, partes, inserts, enabled, onEnabledChange, onFechar, onMudar, onSubirMidia, onEditarInserts, onAtualizarMontagem, atualizandoMontagem = false }: {
  taskId: string; partes: Parte[]; inserts: Insert[]; enabled: boolean;
  onEnabledChange: (value: boolean) => void; onFechar: () => void; onMudar: (value: Insert[] | ((current: Insert[]) => Insert[])) => void;
  onSubirMidia: (file: File, ancora: string) => Promise<InsertMedia | null>; onEditarInserts: () => void;
  onAtualizarMontagem?: () => Promise<boolean>; atualizandoMontagem?: boolean;
}) {
  const uid = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onFechar);
  closeRef.current = onFechar;
  const [mounted, setMounted] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [settings, setSettings] = useState<FlowSettings>(() => ({ ...DEFAULT_FLOW_SETTINGS, references: [] }));
  const [projectUrl, setProjectUrl] = useState(sessionFor(taskId).projectUrl);
  const [session, setSession] = useState<Session>(() => sessionFor(taskId));
  const [range, setRange] = useState<Range | null>(null);
  const [anchor, setAnchor] = useState(partes.find((part) => part.text.trim())?.label || '');
  const [rangeStart, setRangeStart] = useState<number | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [storageError, setStorageError] = useState('');
  const [referenceBusy, setReferenceBusy] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [localPreview, setLocalPreview] = useState<{ key: string; url: string | null; state: 'loading' | 'missing' | 'ready' | 'error' } | null>(null);
  const previewAttempts = useRef(new Set<string>());
  const [notice, setNotice] = useState('');
  const montageInputs = JSON.stringify({ enabled, inserts });
  const previousMontageInputs = useRef(montageInputs);
  const preferredModels = useRef<Record<FlowSettings['mode'], string>>({ image: FLOW_IMAGE_MODELS[0], video: FLOW_VIDEO_MODELS[0] });
  const inspectionAttempt = useRef('');
  const fileInput = useRef<HTMLInputElement>(null);
  const draftRef = useRef<Draft>({ settings, projectUrl, range, assets: session.assets, account: session.account || session.quote?.account || session.inspection?.account || null });
  draftRef.current = { settings: session.preparedSettings || settings, projectUrl, range, assets: session.assets, account: session.account || session.quote?.account || session.inspection?.account || null, activeJob: session.activeJob, selectedModels: preferredModels.current };
  const copyParts = useMemo(() => partes.filter((part) => part.text.trim()), [partes]);
  const part = copyParts.find((item) => item.label === anchor) || copyParts[0];
  const words = useMemo(() => (part?.text || '').split(/\s+/).filter(Boolean), [part?.text]);
  const modelOptions: readonly string[] = session.inspection?.mode === settings.mode && session.inspection.models?.length ? session.inspection.models : settings.mode === 'video' ? FLOW_VIDEO_MODELS : FLOW_IMAGE_MODELS;
  const capabilities = availableControls(session.inspection, settings);
  const account = session.quote?.account || session.account || session.inspection?.account;
  const usesFrames = settings.mode === 'video' && settings.videoMode === 'frames';
  const referenceLimit = usesFrames ? 2 : 4;
  const referencesOverLimit = settings.references.length > referenceLimit;
  const capabilitiesPending = !!account?.email && !capabilities.matches;
  const animationUnsupported = settings.mode === 'video' && !!settings.animateMediaId && capabilities.matches && !capabilities.videoModes.includes('frames');
  const capabilitiesUnsupported = capabilities.matches && (!capabilities.aspects.length || !capabilities.counts.length || (settings.mode === 'video' && (!capabilities.durations.length || !capabilities.resolutions.length || !capabilities.videoModes.length))) || animationUnsupported;
  const fingerprint = useMemo(() => JSON.stringify({ settings, projectUrl }), [settings, projectUrl]);
  const quoteValid = !!session.quote && session.quoteKey === fingerprint && typeof session.quote.credits === 'number' && Number.isFinite(session.quote.credits) && !!session.quote.account?.email;
  const insufficient = quoteValid && typeof account?.credits === 'number' && account.credits < (session.quote?.credits || 0);
  const busy = !!session.busy;
  const montageBusy = atualizandoMontagem || !!session.montage?.busy;
  const unresolved = !!session.activeJob;
  const chosenAsset = session.assets.find((asset) => asset.id === selected) || session.assets[session.assets.length - 1];
  const chosenMediaKey = useMemo(() => { try { return chosenAsset ? flowMediaKey(chosenAsset) : ''; } catch { return ''; } }, [chosenAsset?.id, chosenAsset?.kind, chosenAsset?.projectUrl, chosenAsset?.accountEmail]);
  const previewUrl = localPreview?.key === chosenMediaKey && localPreview.url ? localPreview.url : chosenAsset ? assetUrl(chosenAsset) : undefined;
  const selectedRange = range && range.ancora === part?.label && range.ate < words.length && range.de >= 0 ? range : null;

  useEffect(() => {
    setMounted(true);
    const listeners = subscribers.get(taskId) || new Set();
    listeners.add(setSession);
    subscribers.set(taskId, listeners);
    setSession(sessionFor(taskId));
    return () => { listeners.delete(setSession); if (!listeners.size) subscribers.delete(taskId); };
  }, [taskId]);
  useEffect(() => travarScrollDaPagina(), []);
  useEffect(() => {
    if (previousMontageInputs.current === montageInputs) return;
    previousMontageInputs.current = montageInputs;
    const montage = sessionFor(taskId).montage;
    if (montage?.notice) updateSession(taskId, { montage: { ...montage, notice: '' } });
  }, [montageInputs, taskId]);
  useEffect(() => {
    let alive = true;
    setLoaded(false);
    readDraft(taskId).then((draft) => {
      if (!alive || !draft) return;
      if (draft.settings && Array.isArray(draft.settings.references)) {
        if (draft.selectedModels) preferredModels.current = { ...preferredModels.current, ...draft.selectedModels };
        preferredModels.current[draft.settings.mode] = draft.settings.model;
        const restored = { ...DEFAULT_FLOW_SETTINGS, ...draft.settings, references: draft.settings.references.slice(0, 4) };
        setSettings(sessionFor(taskId).inspection ? settingsForInspection(restored, sessionFor(taskId).inspection!) : restored);
      }
      setProjectUrl(sessionFor(taskId).projectUrl || draft.projectUrl || '');
      if (draft.range) { setRange(draft.range); setAnchor(draft.range.ancora); }
      if (!sessionFor(taskId).assets.length && Array.isArray(draft.assets)) updateSession(taskId, { assets: draft.assets });
      if (!sessionFor(taskId).account?.email && draft.account?.email) updateSession(taskId, { account: draft.account });
      if (draft.activeJob?.requestId && !sessionFor(taskId).busy) {
        // Recover the saved request; refreshing never submits a new generation.
        // Legacy drafts predate prompt snapshots; capture their saved text once
        // during hydration, before the user can edit the next creation.
        const active = { ...draft.activeJob, prompt: draft.activeJob.prompt ?? draft.settings?.prompt };
        updateSession(taskId, { activeJob: active, recoveryMessage: 'Conferindo o pedido que estava em andamento…' });
        void recoverActiveJob(active, draft);
      }
    }).catch(() => { if (alive) setStorageError('O rascunho não pôde ser recuperado. Verifique o armazenamento deste navegador.'); }).finally(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, [taskId]);
  useEffect(() => {
    if (!loaded) return;
    let alive = true;
    const timer = setTimeout(() => {
      saveDraft(taskId, draftRef.current).then(() => { if (alive) setStorageError(''); }).catch(() => { if (alive) setStorageError('Sem espaço para salvar o rascunho. As referências podem se perder ao recarregar.'); });
    }, 300);
    return () => { alive = false; clearTimeout(timer); };
  }, [loaded, taskId, settings, projectUrl, range, session.assets, session.account, session.quote?.account, session.inspection?.account, session.activeJob]);
  useEffect(() => () => { if (loaded) void saveDraft(taskId, draftRef.current).catch(() => {}); }, [loaded, taskId]);
  useEffect(() => {
    if (!session.preparedSettings) return;
    setSettings(session.preparedSettings);
    preferredModels.current[session.preparedSettings.mode] = session.preparedSettings.model;
    updateSession(taskId, { preparedSettings: null });
    setNotice('Imagem pronta como primeiro frame. Descreva o movimento e consulte os créditos.');
  }, [session.preparedSettings, taskId]);
  useEffect(() => {
    if (!loaded || busy || unresolved || !account?.email) return;
    const key = `${account.email}:${projectUrl}:${settings.mode}:${settings.model}`;
    if (capabilities.matches || inspectionAttempt.current === key) return;
    inspectionAttempt.current = key;
    void inspect();
  }, [loaded, busy, unresolved, account?.email, projectUrl, settings.mode, settings.model, capabilities.matches]);
  useEffect(() => {
    if (!chosenAsset || !chosenMediaKey) { setLocalPreview(null); return; }
    let alive = true;
    let objectUrl: string | undefined;
    setLocalPreview({ key: chosenMediaKey, url: null, state: 'loading' });
    readFlowMedia(chosenAsset).then((file) => {
      if (!alive) return;
      if (!file) { setLocalPreview({ key: chosenMediaKey, url: null, state: 'missing' }); return; }
      objectUrl = URL.createObjectURL(file);
      setLocalPreview({ key: chosenMediaKey, url: objectUrl, state: 'ready' });
      setPreviewError(null);
    }).catch((error) => {
      if (!alive) return;
      setLocalPreview({ key: chosenMediaKey, url: null, state: 'error' });
      updateSession(taskId, { error: errorText(error) });
    });
    return () => { alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [chosenMediaKey, session.mediaRevision, taskId]);
  useEffect(() => {
    if (!loaded || busy || unresolved || !chosenAsset || !chosenMediaKey || previewAttempts.current.has(chosenMediaKey)) return;
    if (localPreview?.key !== chosenMediaKey || localPreview.state !== 'missing') return;
    if (chosenAsset.kind !== 'video' || (!chosenAsset.previewPending && assetUrl(chosenAsset))) return;
    void preparePreview(chosenAsset);
  }, [loaded, busy, unresolved, chosenMediaKey, chosenAsset?.previewPending, localPreview]);
  useEffect(() => {
    if (!mounted) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const node = dialog.current;
    node?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeRef.current(); }
      if (event.key !== 'Tab' || !node) return;
      const focusable = Array.from(node.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]')).filter((el) => el.getClientRects().length > 0);
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (!first) { event.preventDefault(); node.focus(); }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === node)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === node)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('keydown', onKey, true); if (previous?.isConnected) previous.focus(); };
  }, [mounted]);

  const change = useCallback((value: Partial<FlowSettings>) => {
    setSettings((previous) => {
      const next = { ...previous, ...value };
      preferredModels.current[next.mode] = next.model;
      return next;
    });
    setNotice('');
    updateSession(taskId, { quote: null, quoteKey: '', error: '' });
  }, [taskId]);
  async function recoverActiveJob(active = sessionFor(taskId).activeJob, restoredDraft?: Draft) {
    if (!active || sessionFor(taskId).busy === 'generate' || sessionFor(taskId).busy === 'download') return;
    updateSession(taskId, { busy: 'inspect', progress: 'Recuperando o pedido já enviado ao Flow…', error: '' });
    try {
      const response = await flowStatus(active.requestId, { expectedPrompt: active.prompt }) as { job?: RecoveredJob | null };
      if (!response || !Object.prototype.hasOwnProperty.call(response, 'job')) throw new Error('A extensão não confirmou o estado do pedido anterior. Confira o projeto no Flow.');
      const job = response.job;
      if (!job) {
        updateSession(taskId, { recoveryState: 'unknown', recoveryMessage: 'Esta instalação da extensão não reconhece o pedido anterior. Ele pode ter sido enviado por outra instalação. Confira o projeto no Flow antes de liberar um novo pedido.', error: '' });
        return;
      }
      const previous = sessionFor(taskId);
      const completed = job?.state === 'completed' && Array.isArray(job.assets);
      const notSubmitted = (job.state === 'failed' && !job.submitted) || job.state === 'acknowledged';
      if (completed || notSubmitted) {
        const returned = completed ? job.assets!.map((asset) => ({ ...asset, projectUrl: asset.projectUrl || job.projectUrl || active.projectUrl, accountEmail: asset.accountEmail || job.account?.email || active.accountEmail })) : [];
        const assets = [...previous.assets.filter((asset) => !returned.some((item) => item.id === asset.id)), ...returned];
        const actualProject = job?.projectUrl || active.projectUrl;
        const previousAccount = previous.account || previous.inspection?.account;
        const refreshedAccount = job.account || (previousAccount ? { ...previousAccount, credits: null } : null);
        // Clear the lock only after the result itself is safely persisted.
        await saveDraft(taskId, { ...(restoredDraft || draftRef.current), assets, account: refreshedAccount, projectUrl: actualProject, activeJob: null });
        updateSession(taskId, { activeJob: null, assets, account: refreshedAccount, projectUrl: actualProject, quote: null, quoteKey: '', recoveryMessage: '', recoveryState: undefined, error: job?.error || '' });
        setProjectUrl(actualProject);
        setNotice(completed ? 'Pedido recuperado. Suas criações estão prontas para conferir.' : 'Nenhuma geração pendente. Consulte os créditos para continuar.');
      } else {
        updateSession(taskId, { recoveryState: job.state, recoveryMessage: job.stage || job.error || 'A geração ainda não foi concluída. Confira o projeto e atualize o status.', error: '' });
      }
    } catch (error) {
      updateSession(taskId, { error: errorText(error), recoveryMessage: 'O pedido anterior ainda precisa ser conferido. A geração de um novo pedido está pausada.' });
    } finally { updateSession(taskId, { busy: null, progress: '' }); }
  }
  async function acknowledgePreviousJob() {
    const current = sessionFor(taskId);
    if (!current.activeJob || current.busy || !['needs_attention', 'unknown'].includes(current.recoveryState || '')) return;
    updateSession(taskId, { busy: 'inspect', progress: 'Registrando sua conferência do pedido anterior…', error: '' });
    try {
      if (current.recoveryState === 'unknown') {
        const status = await flowStatus(current.activeJob.requestId, { expectedPrompt: current.activeJob.prompt }) as { job?: RecoveredJob | null };
        if (!status || !Object.prototype.hasOwnProperty.call(status, 'job') || status.job) throw new Error('O estado deste pedido mudou. Atualize o status antes de liberar.');
        // A new extension installation cannot acknowledge the old one's job.
        // Only this explicit user click, after checking Flow, releases the local lock.
      } else {
        const response = await flowCancel(current.activeJob.requestId, { acknowledgeUncertain: true }) as { acknowledged?: boolean };
        if (!response.acknowledged) throw new Error('O Flow ainda não liberou este pedido. Atualize o status e confira o projeto.');
      }
      await saveDraft(taskId, { ...draftRef.current, activeJob: null });
      updateSession(taskId, { activeJob: null, recoveryState: undefined, recoveryMessage: '', quote: null, quoteKey: '' });
      setNotice('Conferência registrada. Consulte os créditos antes de enviar um novo pedido.');
    } catch (error) { updateSession(taskId, { error: errorText(error) }); }
    finally { updateSession(taskId, { busy: null, progress: '' }); }
  }
  const openFlow = async (asset?: StudioAsset) => {
    updateSession(taskId, { error: '', quote: null, quoteKey: '' });
    try { await flowOpen(asset ? flowProjectUrl(asset.projectUrl) : projectUrl || undefined); }
    catch (error) { updateSession(taskId, { error: errorText(error) }); }
  };
  async function inspect() {
    if (sessionFor(taskId).busy) return;
    const requested = settings;
    updateSession(taskId, { busy: 'inspect', error: '', progress: 'Conferindo a conta e as opções deste motor…', quote: null, quoteKey: '' });
    try {
      const inspection = await flowInspect(projectUrl || undefined, { mode: requested.mode, model: requested.model });
      const adjusted = settingsForInspection(requested, inspection);
      preferredModels.current[adjusted.mode] = adjusted.model;
      setSettings((current) => current.mode === requested.mode && current.model === requested.model ? settingsForInspection(current, inspection) : current);
      if (JSON.stringify(adjusted) !== JSON.stringify(requested)) setNotice('As opções foram ajustadas às combinações disponíveis neste motor. Consulte os créditos antes de gerar.');
      updateSession(taskId, { inspection, account: inspection.account, projectUrl: inspection.projectUrl || projectUrl });
      inspectionAttempt.current = `${inspection.account.email}:${inspection.projectUrl || projectUrl}:${adjusted.mode}:${adjusted.model}`;
      setProjectUrl(inspection.projectUrl || projectUrl);
    } catch (error) { updateSession(taskId, { error: errorText(error) }); }
    finally { updateSession(taskId, { busy: null, progress: '' }); }
  }
  async function quote() {
    if (sessionFor(taskId).busy || sessionFor(taskId).activeJob || capabilitiesPending || capabilitiesUnsupported || referencesOverLimit || !settings.prompt.trim()) return;
    const requested = settings;
    updateSession(taskId, { busy: 'quote', error: '', progress: 'Conferindo a conta e as opções deste motor…', quote: null, quoteKey: '' });
    try {
      // A first quote also connects the account. Inspect while the same request
      // remains busy so the capabilities effect cannot erase the new quote.
      const inspection = await flowInspect(projectUrl || undefined, { mode: requested.mode, model: requested.model });
      const adjusted = settingsForInspection(requested, inspection);
      const controls = availableControls(inspection, adjusted);
      if (!controls.matches || !controls.aspects.includes(adjusted.aspectRatio) || !controls.counts.includes(adjusted.count) ||
          (adjusted.mode === 'video' && (!controls.durations.includes(adjusted.durationSeconds) || !controls.resolutions.includes(adjusted.resolution) || !controls.videoModes.includes(adjusted.videoMode)))) {
        throw new Error('Este motor não disponibilizou uma combinação compatível. Escolha outro motor ou atualize as opções do Flow.');
      }
      if (adjusted.mode === 'video' && adjusted.videoMode === 'frames' && adjusted.references.length > 2) {
        throw new Error('Frames aceita até 2 imagens: primeiro e último frame. Use Ingredientes para mais referências.');
      }
      const inspectedProject = inspection.projectUrl || projectUrl;
      preferredModels.current[adjusted.mode] = adjusted.model;
      setSettings(adjusted);
      setProjectUrl(inspectedProject);
      updateSession(taskId, { inspection, projectUrl: inspectedProject, progress: 'Lendo o custo desta configuração no Flow…' });
      const quoted = await flowQuote(adjusted, inspectedProject || undefined);
      if (!quoted.account?.email || quoted.account.email.toLowerCase() !== inspection.account.email.toLowerCase()) {
        throw new Error('A conta do Flow mudou durante a consulta. Confira a conta e consulte os créditos novamente.');
      }
      const actualProject = quoted.projectUrl || inspectedProject;
      inspectionAttempt.current = `${quoted.account.email}:${actualProject}:${adjusted.mode}:${adjusted.model}`;
      setProjectUrl(actualProject);
      updateSession(taskId, { inspection: { ...inspection, account: quoted.account, projectUrl: actualProject }, account: quoted.account, quote: quoted, quoteKey: JSON.stringify({ settings: adjusted, projectUrl: actualProject }), projectUrl: actualProject });
      if (JSON.stringify(adjusted) !== JSON.stringify(requested)) setNotice('As opções foram ajustadas às combinações disponíveis neste motor. O custo exibido já considera esses ajustes.');
      if (quoted.credits == null) updateSession(taskId, { error: 'O Flow não informou o custo. Atualize a cotação antes de gerar.' });
    } catch (error) { updateSession(taskId, { error: errorText(error) }); }
    finally { updateSession(taskId, { busy: null, progress: '' }); }
  }
  async function generate() {
    if (sessionFor(taskId).busy || sessionFor(taskId).activeJob || referencesOverLimit || !quoteValid || insufficient || !session.quote || session.quote.credits == null) return;
    const capturedSettings = settings;
    const activeJob = { requestId: `flow_${crypto.randomUUID()}`, projectUrl, startedAt: Date.now(), accountEmail: session.quote.account.email, prompt: capturedSettings.prompt };
    updateSession(taskId, { busy: 'generate', activeJob, recoveryMessage: '', error: '', progress: 'Salvando seu pedido antes de gerar…' });
    try {
      await saveDraft(taskId, { ...draftRef.current, settings: capturedSettings, activeJob });
      const result = await flowGenerate(capturedSettings, {
        requestId: activeJob.requestId,
        projectUrl,
        expectedAccountEmail: session.quote.account.email,
        maxCredits: session.quote.credits,
        onProgress: (event) => updateSession(taskId, { progress: event.message }),
      });
      const previous = sessionFor(taskId).assets;
      const scoped = result.assets.map((asset) => ({ ...asset, projectUrl: result.projectUrl || activeJob.projectUrl, accountEmail: activeJob.accountEmail }));
      const assets = [...previous.filter((asset) => !scoped.some((newAsset) => newAsset.id === asset.id)), ...scoped];
      const resultAccount = result.account || { ...session.quote.account, credits: null };
      updateSession(taskId, { assets, account: resultAccount, projectUrl: result.projectUrl || projectUrl, quote: null, quoteKey: '' });
      setProjectUrl(result.projectUrl || projectUrl);
      setSelected(result.assets[0]?.id || null);
      // Persist even when the dialog was closed while Flow was generating.
      await saveDraft(taskId, { ...draftRef.current, assets, account: resultAccount, projectUrl: result.projectUrl || projectUrl, activeJob: null });
      updateSession(taskId, { activeJob: null, recoveryMessage: '' });
      if (!result.assets.length) updateSession(taskId, { error: 'O Flow terminou sem devolver uma mídia. Abra o projeto para conferir.' });
    } catch (error) { updateSession(taskId, { error: errorText(error), quote: null, quoteKey: '', recoveryMessage: 'Confira o pedido anterior antes de gerar novamente. Atualizar o status não gasta créditos.' }); }
    finally { updateSession(taskId, { busy: null, progress: '' }); }
  }
  async function addReferences(files: FileList | null) {
    if (!files?.length) return;
    setReferenceBusy(true);
    updateSession(taskId, { error: '' });
    try {
      const picked = Array.from(files);
      if (settings.references.length + picked.length > referenceLimit) throw new Error(usesFrames ? 'Frames aceita até 2 imagens: primeiro o início, depois o fim.' : 'Use até 4 imagens de referência por criação.');
      for (const file of picked) {
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error(`${file.name}: envie uma imagem JPG, PNG ou WebP.`);
        if (file.size > 10 * 1024 * 1024) throw new Error(`${file.name}: o limite é 10 MB por referência.`);
      }
      const references = await Promise.all(picked.map(async (file) => ({ name: file.name, mimeType: file.type, dataUrl: await fileDataUrl(file) })));
      // Appending a final frame keeps the generated image bound to the first slot.
      change({ references: [...settings.references, ...references] });
    } catch (error) { updateSession(taskId, { error: errorText(error) }); }
    finally { setReferenceBusy(false); if (fileInput.current) fileInput.current.value = ''; }
  }
  async function attach() {
    if (!chosenAsset || !selectedRange || rangeStart != null || sessionFor(taskId).busy || sessionFor(taskId).montage?.busy || atualizandoMontagem) return;
    const asset = chosenAsset;
    const placement = selectedRange;
    updateSession(taskId, { busy: 'download', error: '', progress: asset.kind === 'video' ? 'Baixando o vídeo em 1080p no Flow…' : 'Baixando a imagem em 2K no Flow…' });
    try {
      const file = await assetFile(asset);
      const media = await onSubirMidia(file, placement.ancora);
      if (!media) throw new Error('A mídia não foi salva. O insert ainda não foi adicionado.');
      const insert = { ...insertPadrao(`flow-${crypto.randomUUID()}`, placement.ancora, media), source: 'flow' as const, palavraDe: placement.de, palavraAte: placement.ate };
      onMudar((current) => [...current.filter((item) => item.id !== insert.id), insert]);
      onEnabledChange(true);
      setNotice(`Insert adicionado em ${placement.ancora}. A montagem usará o trecho marcado.`);
    } catch (error) { updateSession(taskId, { error: errorText(error) }); }
    finally { updateSession(taskId, { busy: null, progress: '' }); }
  }
  async function verifiedAssetProject(asset: StudioAsset): Promise<string> {
    const origin = flowProjectUrl(asset.projectUrl);
    if (!origin || !asset.accountEmail) throw new Error('Não foi possível confirmar o projeto e a conta de origem desta mídia. Confira o resultado no Flow antes de importar.');
    const inspection = await flowInspect(origin);
    if (inspection.account.email.toLowerCase() !== asset.accountEmail.toLowerCase()) {
      throw new Error(`Esta criação pertence à conta ${asset.accountEmail}. Ative essa conta no Flow antes de baixar ou animar.`);
    }
    updateSession(taskId, { account: inspection.account });
    return origin;
  }
  async function assetFile(asset: StudioAsset): Promise<File> {
    const origin = await verifiedAssetProject(asset);
    const file = await flowMediaFile(asset, origin, (event) => updateSession(taskId, { progress: event.message }));
    updateSession(taskId, { mediaRevision: (sessionFor(taskId).mediaRevision || 0) + 1 });
    return file;
  }
  async function preparePreview(asset = chosenAsset) {
    if (!asset || sessionFor(taskId).busy) return;
    try { previewAttempts.current.add(flowMediaKey(asset)); } catch { /* report missing provenance through assetFile */ }
    updateSession(taskId, { busy: 'download', error: '', progress: asset.kind === 'video' ? 'Preparando sua prévia em 1080p…' : 'Preparando sua imagem em 2K…' });
    try { await assetFile(asset); }
    catch (error) { updateSession(taskId, { error: errorText(error) }); }
    finally { updateSession(taskId, { busy: null, progress: '' }); }
  }
  async function animate() {
    if (!chosenAsset || chosenAsset.kind !== 'image' || sessionFor(taskId).busy) return;
    const asset = chosenAsset;
    updateSession(taskId, { busy: 'download', error: '', progress: 'Preparando sua imagem como primeiro frame…' });
    try {
      const file = await assetFile(asset);
      if (file.size > 10 * 1024 * 1024) throw new Error('A imagem baixada ultrapassa o limite de 10 MB para referências. Use uma versão menor para animar.');
      const reference = { name: file.name, mimeType: file.type, dataUrl: await fileDataUrl(file) };
      const prepared: FlowSettings = { ...draftRef.current.settings, mode: 'video', model: preferredModels.current.video, videoMode: 'frames', animateMediaId: asset.id, references: [reference] };
      await saveDraft(taskId, { ...draftRef.current, settings: prepared });
      updateSession(taskId, { preparedSettings: prepared, quote: null, quoteKey: '' });
    } catch (error) { updateSession(taskId, { error: errorText(error) }); }
    finally { updateSession(taskId, { busy: null, progress: '' }); }
  }
  function chooseWord(index: number) {
    if (rangeStart == null) { setRangeStart(index); setRange(null); }
    else { setRange({ ancora: part.label, de: Math.min(rangeStart, index), ate: Math.max(rangeStart, index) }); setRangeStart(null); }
  }
  async function atualizarMontagem() {
    const current = sessionFor(taskId);
    if (!onAtualizarMontagem || current.busy || current.montage?.busy || atualizandoMontagem) return;
    updateSession(taskId, { montage: { busy: true, error: '', notice: '' } });
    try {
      const updated = await onAtualizarMontagem();
      updateSession(taskId, { montage: { busy: true, error: updated ? '' : 'A montagem não foi atualizada. Confira o estado da task e tente novamente.', notice: updated ? 'Montagem atualizada com os inserts atuais. O download já usa esta versão.' : '' } });
    } catch (error) {
      updateSession(taskId, { montage: { busy: true, error: errorText(error), notice: '' } });
    } finally {
      const montage = sessionFor(taskId).montage;
      updateSession(taskId, { montage: { busy: false, error: montage?.error || '', notice: montage?.notice || '' } });
    }
  }

  if (!mounted) return null;
  return createPortal(<div className={s.layer} data-flow-modal="true">
    <div className={s.backdrop} aria-hidden="true" onClick={onFechar}/>
    <div ref={dialog} className={`${s.dialog} ${enabled ? s.dialogEnabled : ''}`} role="dialog" aria-modal="true" aria-labelledby={`${uid}-title`} aria-describedby={`${uid}-description`} tabIndex={-1}>
      <header className={s.header}>
        <div className={s.brandTile}><FlowMark size={27}/></div>
        <div className={s.heading}><div className={s.eyebrow}>PILOT <span>/</span> CREATIVE STUDIO</div><h2 id={`${uid}-title`}>Inserts do <span>Flow</span></h2><p id={`${uid}-description`}>Da sua ideia ao ponto exato da copy.</p></div>
        <div className={s.headerActions}><button type="button" className={`${s.switch} ${enabled ? s.switchOn : ''}`} role="switch" aria-checked={enabled} disabled={montageBusy} onClick={() => onEnabledChange(!enabled)}><span className={s.switchTrack}><i/></span>{enabled ? 'Ligado' : 'Desligado'}</button><button type="button" className={s.iconButton} onClick={onFechar} aria-label="Fechar inserts do Flow"><Icon name="close"/></button></div>
      </header>
      <div className={s.workspace}>
        <section className={s.creator} aria-label="Configurar criação">
          <div className={s.sectionHeading}><span className={s.step}>01</span><h3>Crie a cena</h3><span className={s.smallLabel}>GOOGLE FLOW</span></div>
          <div className={s.modeSwitch} role="group" aria-label="Tipo de criação">
            <button type="button" aria-pressed={settings.mode === 'video'} className={settings.mode === 'video' ? s.modeSelected : ''} disabled={busy || !loaded} onClick={() => change({ mode: 'video', model: preferredModels.current.video })}><Icon name="video"/>Vídeo</button>
            <button type="button" aria-pressed={settings.mode === 'image'} className={settings.mode === 'image' ? s.modeSelected : ''} disabled={busy || !loaded} onClick={() => change({ mode: 'image', model: preferredModels.current.image, animateMediaId: undefined })}><Icon name="image"/>Imagem</button>
          </div>
          <div className={s.promptBox}><label htmlFor={`${uid}-prompt`}>Sua direção criativa <span>{settings.prompt.length.toLocaleString('pt-BR')} / 5.000</span></label><textarea id={`${uid}-prompt`} value={settings.prompt} disabled={busy || !loaded} onChange={(event) => change({ prompt: event.target.value })} maxLength={5000} placeholder={settings.animateMediaId ? 'Descreva o movimento da câmera, a ação e a luz…' : 'Descreva a cena, o enquadramento, a luz e o que acontece…'} rows={4}/><div className={s.promptHint}><Icon name="spark"/><span>{settings.animateMediaId ? 'Animando uma imagem criada neste projeto' : 'Escreva a cena que vai acompanhar a sua fala'}</span>{settings.animateMediaId && <button type="button" disabled={busy} className={s.textButton} onClick={() => change({ animateMediaId: undefined, references: settings.references.slice(1) })}>Remover frame</button>}</div></div>
          <div className={s.referenceHeader}><label htmlFor={`${uid}-refs`}>{usesFrames ? 'Frames · início e fim' : 'Referências visuais'}</label><span>{settings.references.length}/{referenceLimit} imagens</span></div>
          <div className={s.references}>
            {settings.references.map((reference, index) => <div className={s.reference} key={`${index}-${reference.name}`}><img src={reference.dataUrl} alt={`${usesFrames && index < 2 ? index === 0 ? 'Frame inicial' : 'Frame final' : `Referência ${index + 1}`}: ${reference.name}`}/><span>{usesFrames ? index === 0 ? 'INÍCIO' : index === 1 ? 'FIM' : 'EXTRA' : String(index + 1).padStart(2, '0')}</span><button type="button" disabled={busy || referenceBusy} onClick={() => change({ references: settings.references.filter((_, item) => item !== index), ...(index === 0 ? { animateMediaId: undefined } : {}) })} aria-label={`Remover referência ${index + 1}`}><Icon name="close"/></button></div>)}
            {settings.references.length < referenceLimit && <button type="button" className={s.addReference} disabled={busy || referenceBusy || !loaded} onClick={() => fileInput.current?.click()}><Icon name="upload"/><span>{referenceBusy ? 'Lendo…' : usesFrames ? settings.references.length ? 'Adicionar fim' : 'Adicionar início' : 'Adicionar'}<small>JPG, PNG, WEBP · 10 MB</small></span></button>}
            <input ref={fileInput} id={`${uid}-refs`} type="file" accept="image/png,image/jpeg,image/webp" multiple className={s.hidden} onChange={(event) => void addReferences(event.target.files)}/>
          </div>
          {referencesOverLimit && <p className={s.inlineError}>Frames aceita apenas início e fim. Remova as referências extras ou selecione Ingredientes.</p>}
          <div className={s.settingsGrid}>
            <label className={s.field}>Motor<select value={settings.model} disabled={busy || !loaded} onChange={(event) => change({ model: event.target.value })}>{modelOptions.map((model) => <option key={model} value={model}>{model}</option>)}</select></label>
            <div className={s.field}><span>Formato</span><div className={s.segments} role="group" aria-label="Formato">{capabilities.aspects.map((ratio) => <button type="button" key={ratio} disabled={busy || !loaded} aria-pressed={settings.aspectRatio === ratio} className={settings.aspectRatio === ratio ? s.segmentSelected : ''} onClick={() => change({ aspectRatio: ratio })}><i className={ratio === '9:16' ? s.portrait : s.landscape}/>{ratio}</button>)}</div></div>
            {settings.mode === 'video' && <><div className={s.field}><span>Duração</span><div className={s.segments} role="group" aria-label="Duração do vídeo">{capabilities.durations.map((duration) => <button type="button" key={duration} disabled={busy || !loaded} aria-pressed={settings.durationSeconds === duration} className={settings.durationSeconds === duration ? s.segmentSelected : ''} onClick={() => change({ durationSeconds: duration })}>{duration}s</button>)}</div></div><div className={s.field}><span>Resolução de geração</span><div className={s.segments} role="group" aria-label="Resolução de geração">{capabilities.resolutions.map((resolution) => <button type="button" key={resolution} disabled={busy || !loaded} aria-pressed={settings.resolution === resolution} className={settings.resolution === resolution ? s.segmentSelected : ''} onClick={() => change({ resolution })}>{resolution}</button>)}</div></div></>}
            <div className={s.field}><span>Variações</span><div className={s.segments} role="group" aria-label="Quantidade de variações">{capabilities.counts.map((count) => <button type="button" key={count} disabled={busy || !loaded} aria-pressed={settings.count === count} className={settings.count === count ? s.segmentSelected : ''} onClick={() => change({ count })}>×{count}</button>)}</div></div>
            {settings.mode === 'video' ? <label className={s.field}>Entrada de imagem<select value={settings.videoMode} disabled={busy || !loaded || !!settings.animateMediaId} onChange={(event) => change({ videoMode: event.target.value as FlowSettings['videoMode'] })}>{animationUnsupported && <option value="frames" disabled>Frames</option>}{capabilities.videoModes.map((mode) => <option key={mode} value={mode}>{mode === 'frames' ? 'Frames' : 'Ingredientes'}</option>)}</select></label> : <div className={`${s.field} ${s.nativeInfo}`}><Icon name="image"/><span>Imagem em 2K<small>Pronta para animar no Flow</small></span></div>}
          </div>
          {capabilitiesUnsupported && <p className={s.inlineError}>{animationUnsupported ? 'Este motor não aceita esta imagem como primeiro frame. Escolha um motor com Frames para continuar a animação.' : 'Este motor não disponibilizou uma combinação compatível. Escolha outro motor ou atualize as opções do Flow.'}</p>}
          <div className={s.exportNote}><span className={s.exportBadge}>{settings.mode === 'video' ? '1080p' : '2K'}</span><span>{settings.mode === 'video' ? 'Download aprimorado no Flow antes de entrar na montagem.' : 'Download em 2K no Flow para a montagem ou animação.'}</span></div>
          <details className={s.projectDetails}><summary>Projeto do Flow <Icon name="external"/></summary><label htmlFor={`${uid}-project`}>Link do projeto <span>opcional</span></label><input id={`${uid}-project`} type="url" value={projectUrl} disabled={busy || !loaded} onChange={(event) => { setProjectUrl(event.target.value); updateSession(taskId, { inspection: null, account: null, quote: null, quoteKey: '' }); }} placeholder="https://flow.google.com/project/…"/><p>Vazio: usa o projeto aberto no navegador.</p></details>
        </section>
        <section className={s.previewColumn} aria-label="Prévia e conta do Flow">
          <div className={s.accountCard}><div className={s.accountIdentity}>{account?.avatarUrl ? <img src={account.avatarUrl} alt="" referrerPolicy="no-referrer"/> : <div className={s.accountAvatar}>G</div>}<div><span className={s.smallLabel}>CONTA DO FLOW</span><strong>{account?.name || 'Conecte sua conta'}</strong><span title={account?.email}>{account?.email || 'Confira qual conta vai gerar'}</span></div><span className={`${s.statusDot} ${account?.email ? s.statusConnected : ''}`} title={account?.email ? 'Conta conferida' : 'Conta ainda não conferida'}/></div><div className={s.accountFooter}><span><b>{account?.credits == null ? '—' : account.credits.toLocaleString('pt-BR')}</b> créditos disponíveis</span><button type="button" disabled={busy} onClick={() => void (account ? openFlow() : inspect())}>{account ? 'Mudar conta' : 'Conectar'}<Icon name="external"/></button></div></div>
          <div className={s.sectionHeading}><span className={s.step}>02</span><h3>Sua criação</h3><button type="button" className={s.textButton} disabled={busy} onClick={() => void inspect()}><Icon name="refresh"/>Atualizar conta</button></div>
          <div className={s.previewShell}><div className={`${s.preview} ${settings.aspectRatio === '16:9' ? s.previewWide : ''}`}>
            {chosenAsset && (previewError === chosenAsset.id || !previewUrl) ? <div className={s.pendingPreview}>
              {mediaUrl(chosenAsset.posterUrl) && <img className={s.previewPoster} src={mediaUrl(chosenAsset.posterUrl)} alt=""/>}
              <div className={s.emptyPreview}><Icon name={chosenAsset.kind === 'video' ? 'video' : 'image'}/><h4>{previewError === chosenAsset.id ? 'Vamos recuperar a prévia.' : chosenAsset.kind === 'video' ? 'Seu vídeo está pronto.' : 'Sua imagem está pronta.'}</h4><p>{chosenAsset.kind === 'video' ? 'Prepare o arquivo em 1080p para assistir aqui.' : 'Recupere a imagem em 2K para conferir aqui.'}<br/>Ele também ficará salvo para a montagem.</p><button type="button" className={s.previewPrepare} disabled={busy || !loaded} onClick={() => void preparePreview(chosenAsset)}><Icon name="video"/>{chosenAsset.kind === 'video' ? 'Preparar prévia 1080p' : 'Recuperar imagem 2K'}</button><button type="button" className={s.textButton} disabled={busy} onClick={() => void openFlow(chosenAsset)}>Conferir no Flow <Icon name="external"/></button></div>
            </div> : chosenAsset && previewUrl ? chosenAsset.kind === 'video' ? <video key={chosenAsset.id} src={previewUrl} poster={mediaUrl(chosenAsset.posterUrl)} controls playsInline muted preload="metadata" aria-label="Prévia do vídeo criado no Flow" onLoadedMetadata={(event) => { const { videoWidth: width, videoHeight: height } = event.currentTarget; if (width && height && (chosenAsset.width !== width || chosenAsset.height !== height)) updateSession(taskId, { assets: sessionFor(taskId).assets.map((asset) => asset.id === chosenAsset.id ? { ...asset, width, height } : asset) }); }} onError={() => setPreviewError(chosenAsset.id)}/> : <img src={previewUrl} alt="Imagem criada no Flow" onError={() => setPreviewError(chosenAsset.id)}/> : <div className={s.emptyPreview}><div className={s.emptyMark}><FlowMark size={54}/></div><span className={s.eyebrow}>UM NOVO TAKE COMEÇA AQUI</span><h4>Dê forma à sua ideia.</h4><p>Escreva o prompt, confira os créditos<br/>e gere sua primeira criação.</p><div className={s.previewCorners} aria-hidden="true"><i/><i/><i/><i/></div></div>}
            {busy && <div className={s.progressOverlay} role="status"><span className={s.spinner}/><strong>{session.progress || 'Processando…'}</strong><span>{session.busy === 'generate' ? 'Você pode fechar esta janela e voltar nesta sessão.' : 'Aguarde a confirmação do Flow.'}</span></div>}
          </div><div className={s.previewMeta}><span>{chosenAsset ? chosenAsset.kind === 'video' ? 'VÍDEO GERADO' : 'IMAGEM GERADA' : 'PREVIEW'}</span><span>{chosenAsset?.width && chosenAsset?.height ? `${chosenAsset.width} × ${chosenAsset.height}` : settings.aspectRatio} <i/> {chosenAsset?.kind === 'image' || (!chosenAsset && settings.mode === 'image') ? 'Imagem' : `${settings.durationSeconds}s`}</span></div></div>
          {session.assets.length > 0 && <div className={s.results} role="group" aria-label="Criações do Flow">{session.assets.map((asset, index) => <button type="button" key={asset.id} disabled={busy} onClick={() => setSelected(asset.id)} className={chosenAsset?.id === asset.id ? s.resultSelected : ''} aria-label={`Selecionar ${asset.kind === 'video' ? 'vídeo' : 'imagem'} ${index + 1}`} aria-pressed={chosenAsset?.id === asset.id}>{asset.kind === 'image' && assetUrl(asset) ? <img src={assetUrl(asset)} alt=""/> : <Icon name="video"/>}<span>{String(index + 1).padStart(2, '0')}</span>{chosenAsset?.id === asset.id && <i><Icon name="check"/></i>}</button>)}</div>}
          {chosenAsset?.kind === 'image' && <button type="button" className={s.animateButton} disabled={busy} onClick={animate}><Icon name="video"/><span>Animar esta imagem<small>Use a criação como primeiro frame</small></span><Icon name="arrow"/></button>}
          {unresolved && !busy && <div className={s.recoveryCard} role="status"><strong>Um pedido precisa ser conferido</strong><p>{session.recoveryMessage || 'Recupere o resultado do pedido anterior antes de gerar novamente.'}</p><div><button type="button" className={s.textButton} onClick={() => void recoverActiveJob()}><Icon name="refresh"/>Atualizar status</button><button type="button" className={s.textButton} onClick={() => void openFlow()}>Conferir no Flow<Icon name="external"/></button></div><small>Atualizar o status não dispara outra geração.</small>{['needs_attention', 'unknown'].includes(session.recoveryState || '') && <><p>Confira o projeto antes de liberar: o pedido anterior pode ter sido gerado.</p><button type="button" className={s.textButton} onClick={() => void acknowledgePreviousJob()}>Conferi no Flow · liberar novo pedido</button></>}</div>}
          <div className={s.creditCard}><div><span className={s.smallLabel}>CUSTO DESTA CRIAÇÃO</span><strong>{quoteValid ? session.quote?.credits?.toLocaleString('pt-BR') : '—'} <small>créditos</small></strong><p>{quoteValid ? `${settings.count} ${settings.count === 1 ? 'variação' : 'variações'} · valor conferido no Flow` : 'Consulte o valor real antes de gerar.'}</p></div><button type="button" className={s.quoteButton} disabled={busy || unresolved || capabilitiesPending || capabilitiesUnsupported || referencesOverLimit || referenceBusy || !loaded || !settings.prompt.trim()} onClick={() => void quote()}><Icon name="refresh"/>{session.busy === 'quote' ? 'Consultando…' : quoteValid ? 'Atualizar' : 'Consultar'}</button></div>
          {insufficient && <p className={s.inlineError} role="alert">Esta conta não tem créditos suficientes para a configuração escolhida.</p>}
          <button type="button" className={s.generateButton} disabled={busy || unresolved || capabilitiesPending || capabilitiesUnsupported || referencesOverLimit || referenceBusy || !quoteValid || insufficient || !loaded} onClick={() => void generate()}><Icon name="spark"/><span>{session.busy === 'generate' ? 'Gerando no Flow…' : `Gerar ${settings.count > 1 ? `${settings.count} ${settings.mode === 'video' ? 'vídeos' : 'imagens'}` : settings.mode === 'video' ? 'vídeo' : 'imagem'} no Flow`}</span><i><Icon name="arrow"/></i></button>
        </section>
        <section className={s.placement} aria-label="Escolher trecho da copy">
          <div className={s.sectionHeading}><span className={s.step}>03</span><h3>O lugar certo na copy</h3><span className={s.smallLabel}>INÍCIO → FIM</span></div>
          {copyParts.length ? <><div className={s.parts} role="group" aria-label="Parte da copy">{copyParts.map((item) => <button type="button" key={item.label} aria-pressed={part.label === item.label} className={part.label === item.label ? s.partSelected : ''} onClick={() => { setAnchor(item.label); setRangeStart(null); }}>{item.label}</button>)}</div><div className={s.copy} aria-label={`Palavras de ${part.label}`}>{words.map((word, index) => <button type="button" key={index} onClick={() => chooseWord(index)} aria-pressed={!!selectedRange && index >= selectedRange.de && index <= selectedRange.ate} aria-label={`${word}, palavra ${index + 1}${rangeStart == null ? ', marcar início' : ', marcar fim'}`} className={`${selectedRange && index >= selectedRange.de && index <= selectedRange.ate ? s.wordSelected : ''} ${rangeStart === index ? s.wordStart : ''}`}>{word}</button>)}</div><div className={s.rangeFooter}><p aria-live="polite">{rangeStart != null ? <>Início em <b>“{words[rangeStart]}”</b>. Clique na última palavra.</> : selectedRange ? <>De <b>“{words[selectedRange.de]}”</b> até <b>“{words[selectedRange.ate]}”</b> · {selectedRange.ate - selectedRange.de + 1} palavras</> : 'Clique na primeira palavra e depois na última.'}</p><button type="button" className={s.textButton} onClick={() => { setRange({ ancora: part.label, de: 0, ate: words.length - 1 }); setRangeStart(null); }}>Parte inteira</button></div></> : <div className={s.emptyCopy}>A copy desta task ainda não está disponível. Analise a task para escolher onde o insert entra.</div>}
          <div className={s.attachRow}><p><Icon name="video"/>{chosenAsset ? chosenAsset.kind === 'video' ? 'O vídeo será baixado em 1080p e salvo na montagem.' : 'A imagem será baixada em 2K e salva na montagem.' : 'Sua criação aparecerá aqui quando estiver pronta.'}</p><button type="button" className={s.attachButton} disabled={!chosenAsset || !selectedRange || rangeStart != null || busy || referenceBusy || montageBusy} onClick={() => void attach()}><span>{session.busy === 'download' ? 'Preparando insert…' : 'Usar neste trecho'}</span><Icon name="arrow"/></button></div>
        </section>
      </div>
      {(session.error || storageError || notice) && <div className={`${s.feedback} ${session.error || storageError ? s.feedbackError : s.feedbackSuccess}`} role={session.error || storageError ? 'alert' : 'status'}><Icon name={session.error || storageError ? 'external' : 'check'}/><span>{session.error || storageError || notice}</span>{session.error && <a className={s.textButton} href="https://flow.google.com/" target="_blank" rel="noopener noreferrer">Abrir Flow <Icon name="external"/></a>}</div>}
      {(session.montage?.error || session.montage?.notice) && <div className={`${s.feedback} ${session.montage.error ? s.feedbackError : s.feedbackSuccess}`} role={session.montage.error ? 'alert' : 'status'}><Icon name={session.montage.error ? 'external' : 'check'}/><span>{session.montage.error || session.montage.notice}</span></div>}
      <footer className={s.footer}><div className={s.savedSummary}><span className={s.savedCount}>{inserts.length}</span><div><strong>{inserts.length === 1 ? 'insert na montagem' : 'inserts na montagem'}</strong><span>{enabled ? 'Flow ligado nesta versão' : 'Ative o Flow para incluir estes inserts'}</span></div></div><div className={s.footerActions}>{inserts.length > 0 && <button type="button" className={s.secondaryButton} onClick={onEditarInserts} disabled={busy || montageBusy}>Editar inserts e enquadramento</button>}{onAtualizarMontagem && <button type="button" className={s.rebuildButton} disabled={busy || referenceBusy || montageBusy} aria-busy={montageBusy} onClick={() => void atualizarMontagem()} title="Refaz a montagem com os takes já gerados e os inserts atuais.">{montageBusy ? <span className={s.spinner} aria-hidden="true"/> : <Icon name="refresh"/>}{montageBusy ? 'Atualizando montagem…' : 'Atualizar montagem'}</button>}<button type="button" className={s.doneButton} onClick={onFechar}>Concluir<Icon name="check"/></button></div></footer>
    </div>
  </div>, document.body);
}
