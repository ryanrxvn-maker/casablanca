'use client';

import { createPortal } from 'react-dom';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  stockFrameConfigure,
  stockFrameDisconnect,
  stockFrameDownload,
  stockFrameList,
  stockFrameMediaUrls,
  stockFrameSmartSearch,
  stockFrameStatus,
} from '@/lib/stockframe-extension-bridge';
import {
  buildSmartStockTimeline,
  chooseSmartStockAssignments,
  chooseCampaignRecipeTheme,
  balanceMechanismPresence,
  localizeSmartSegments,
  inferStockFrameNiche,
  measureSmartStockCoverage,
  planSmartStockSegments,
  rankStockFrameVideos,
  rankStockFrameGenericFallback,
  smartStockMechanismQueries,
  selectedSmartCandidate,
  type SmartCoverage,
  type SmartPace,
  type SmartStockSegment,
  type StockFrameCopyPart,
} from '@/lib/stockframe-smart';
import { insertPadrao, type Insert } from '@/lib/pilot-inserts';
import { travarScrollDaPagina } from '@/lib/trava-scroll';
import { enrichStockFrameVideos, mergeStockFrameMediaUrls, mergeStockFrameNiches, type StockFrameAccount, type StockFrameFilters, type StockFrameNiche, type StockFramePage, type StockFrameVideo, type StockFrameSmartQuery } from '@/lib/stockframe';
import { translateStockFrameCopy } from '@/lib/stockframe-translate';
import s from './PilotStockFrame.module.css';

type InsertMedia = { key: string; nome: string; tipo: 'video' | 'imagem'; w: number; h: number; durSec?: number };
type Change = Insert[] | ((current: Insert[]) => Insert[]);
type StockPlacement = { anchor: string; from: number; to: number; smart?: boolean; score?: number; coverage?: SmartCoverage };

/** Ids dos takes StockFrame inseridos à mão (fora do plano Smart). */
function manualStockFrameIds(inserts: Insert[]): Set<string> {
  return new Set(inserts.filter((insert) => insert.source === 'stockframe' && !insert.stockFrame?.smart && insert.stockFrame?.videoId).map((insert) => insert.stockFrame!.videoId));
}

function stockFrameInsert(video: StockFrameVideo, media: InsertMedia, placement: StockPlacement): Insert {
  const trimFrom = Math.max(0, video.recommendedStartSec ?? 0);
  const trimTo = Math.min(video.durationSec || video.recommendedEndSec || 0, video.recommendedEndSec || 0);
  return {
    ...insertPadrao(`stockframe:${video.id}:${crypto.randomUUID()}`, placement.anchor, media),
    source: 'stockframe',
    ...(placement.smart && Number.isFinite(trimFrom) && Number.isFinite(trimTo) && trimTo > trimFrom + .25
      ? { recorteDe: trimFrom, recorteAte: trimTo }
      : {}),
    palavraDe: Math.max(0, Math.min(placement.from, placement.to)),
    palavraAte: Math.max(0, Math.max(placement.from, placement.to)),
    stockFrame: {
      videoId: video.id,
      code: video.code,
      title: video.title,
      previewUrl: video.posterUrl || video.previewUrl,
      smart: !!placement.smart,
      semanticScore: placement.score,
      coverage: placement.coverage,
    },
  };
}

function StockFrameMark({ compact = false }: { compact?: boolean }) {
  return <span className={`${s.logo} ${compact ? s.logoCompact : ''}`} aria-hidden="true">
    <span className={s.logoGlyph}><i/><b/></span>
    {!compact && <span className={s.logoText}><strong>STOCK<span>FRAME</span></strong><small>B-ROLL LIBRARY</small></span>}
  </span>;
}

function Icon({ name, size = 18 }: { name: 'close' | 'search' | 'key' | 'spark' | 'download' | 'check' | 'tune' | 'back' | 'play' | 'wand' | 'refresh' | 'edit' | 'shield' | 'folder' | 'grid'; size?: number }) {
  const paths = {
    close: <path d="m6 6 12 12M18 6 6 18"/>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    key: <><circle cx="8" cy="15" r="4"/><path d="m11 12 8-8m-3 3 2 2m-5 1 2 2"/></>,
    spark: <><path d="m12 3 2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2L12 3Z"/><path d="m19 3 .7 2.3L22 6l-2.3.7L19 9l-.7-2.3L16 6l2.3-.7L19 3Z"/></>,
    download: <><path d="M12 3v12m-5-5 5 5 5-5"/><path d="M4 18v2h16v-2"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    tune: <><path d="M4 7h9m4 0h3M4 17h3m4 0h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></>,
    back: <path d="m15 18-6-6 6-6"/>,
    play: <path d="m9 6 9 6-9 6Z"/>,
    wand: <><path d="m4 20 11-11"/><path d="m14 4 1-2 1 2 2 1-2 1-1 2-1-2-2-1 2-1Z"/><path d="m19 12 .7-1.7.8 1.7 1.5.7-1.5.8-.8 1.5-.7-1.5-1.5-.8Z"/></>,
    refresh: <><path d="M20 7a9 9 0 1 0 .5 9"/><path d="M20 3v5h-5"/></>,
    edit: <><path d="m4 20 4-.8L19 8l-3-3L4.8 16Z"/><path d="m14 7 3 3"/></>,
    shield: <><path d="M12 3 5 6v5c0 4.5 2.8 8 7 10 4.2-2 7-5.5 7-10V6Z"/><path d="m9 12 2 2 4-5"/></>,
    folder: <><path d="M3 6.5h6l2 2h10v9.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M3 10h18"/></>,
    grid: <><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function formatDuration(seconds: number) {
  if (!(seconds > 0)) return '--:--';
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;
}

function LazyVideo({ video, active = false, focused = false, suspended = false, onMediaError }: { video: StockFrameVideo; active?: boolean; focused?: boolean; suspended?: boolean; onMediaError?: (id: string) => void }) {
  const root = useRef<HTMLDivElement>(null);
  const player = useRef<HTMLVideoElement>(null);
  const [visible, setVisible] = useState(active);
  const [hovering, setHovering] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);
  const [decodedAspect, setDecodedAspect] = useState<number | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (active) { setVisible(true); return; }
    const node = root.current;
    if (!node || !('IntersectionObserver' in window)) { setVisible(true); return; }
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: '240px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [active]);
  useEffect(() => {
    setVideoReady(false); setVideoFailed(false); setPlaybackBlocked(false); setDecodedAspect(null);
  }, [video.id, video.previewUrl]);
  useEffect(() => { setPosterFailed(false); }, [video.id, video.posterUrl]);
  const playVideo = !suspended && (active || hovering || focused);
  useEffect(() => { if (!visible) setVideoReady(false); }, [visible]);
  useEffect(() => {
    const node = player.current;
    if (!node || !playVideo) return;
    let current = true;
    node.play().catch((error: DOMException) => {
      if (current && error?.name !== 'AbortError') setPlaybackBlocked(true);
    });
    return () => { current = false; node.pause(); };
  }, [playVideo, visible, video.previewUrl, attempt]);
  const metadataAspect = video.width > 0 && video.height > 0 ? video.width / video.height : video.aspectRatio === '9:16' ? 9 / 16 : 16 / 9;
  const mediaAspect = decodedAspect || metadataAspect;
  const mediaState = suspended ? 'suspended' : !video.previewUrl ? 'unavailable' : videoFailed ? 'error' : playbackBlocked ? 'paused' : !videoReady ? 'loading' : 'ready';
  // A preview can supply a still frame when a thumbnail is missing or broken.
  // Only visible cards load that fallback; healthy cards remain image-only until hover.
  const usePreviewAsPoster = !video.posterUrl || posterFailed;
  const showVideo = visible && (playVideo || usePreviewAsPoster) && !!video.previewUrl && !videoFailed;
  useEffect(() => {
    const node = player.current;
    if (!showVideo || !usePreviewAsPoster || playVideo || !node) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Playing a muted fraction is more reliable than seeking a signed preview:
    // some storage hosts do not support byte-range seeking on short previews.
    void node.play().then(() => {
      timer = setTimeout(() => {
        if (cancelled) return;
        node.pause();
        setVideoReady(true);
      }, 700);
    }).catch(() => { if (!cancelled) setVideoReady(true); });
    return () => { cancelled = true; if (timer) clearTimeout(timer); node.pause(); };
  }, [showVideo, usePreviewAsPoster, playVideo, video.previewUrl, attempt]);
  return <div ref={root} className={`${s.media} ${active ? s.mediaActive : ''}`} data-preview-active={active ? 'true' : undefined} data-media-state={active ? mediaState : undefined}
    style={active ? { aspectRatio: mediaAspect, maxWidth: `min(100%, calc(min(54dvh, 560px) * ${mediaAspect}))` } : undefined}
    onMouseEnter={() => setHovering(true)} onMouseLeave={() => setHovering(false)}>
    {visible && video.posterUrl && !posterFailed ? <img src={video.posterUrl} alt="" loading="lazy" onError={() => { setPosterFailed(true); onMediaError?.(video.id); }}/> : null}
    {showVideo ? <video key={`${video.id}:${video.previewUrl}:${attempt}`} ref={player} src={video.previewUrl} poster={posterFailed ? undefined : video.posterUrl} muted loop playsInline controls={active} preload={active || usePreviewAsPoster ? 'auto' : 'metadata'} data-ready={videoReady ? 'true' : 'false'}
      aria-label={active ? `Prévia de ${video.title}` : undefined}
      onLoadedMetadata={(event) => {
        const node = event.currentTarget;
        if (node.videoWidth > 0 && node.videoHeight > 0) setDecodedAspect(node.videoWidth / node.videoHeight);
      }}
      onLoadedData={() => { if (playVideo || !usePreviewAsPoster) setVideoReady(true); }}
      onCanPlay={() => { if (playVideo || !usePreviewAsPoster) setVideoReady(true); }}
      onPlaying={() => setPlaybackBlocked(false)}
      onError={() => { setVideoFailed(true); onMediaError?.(video.id); }}/> : null}
    {active && !suspended && mediaState !== 'ready' ? <div className={s.mediaStatus} role="status" aria-live="polite">
      {mediaState === 'loading' ? <><span className={s.miniLoader} aria-hidden="true"/><strong>Carregando prévia…</strong><span>A imagem é a miniatura deste take.</span></> :
        mediaState === 'unavailable' ? <><strong>Prévia indisponível</strong><span>O StockFrame não enviou uma prévia em vídeo para este take.</span></> :
          mediaState === 'error' ? <><strong>Não foi possível reproduzir</strong><span>A prévia falhou ao carregar.</span><button type="button" onClick={() => { setVideoFailed(false); setVideoReady(false); setPlaybackBlocked(false); setAttempt((value) => value + 1); }}>Tentar novamente</button></> :
            <><strong>Prévia pausada</strong><button type="button" onClick={() => { void player.current?.play().then(() => setPlaybackBlocked(false)).catch(() => setPlaybackBlocked(true)); }}><Icon name="play" size={15}/>Reproduzir prévia</button></>}
    </div> : null}
    {!active && usePreviewAsPoster && (!video.previewUrl || videoFailed) ? <span className={s.mediaFallback}><Icon name="play" size={28}/></span> : null}
    <span className={s.duration}>{formatDuration(video.durationSec)}</span>
    <span className={s.ratio}>{video.aspectRatio === 'unknown' ? 'vídeo' : video.aspectRatio}</span>
  </div>;
}

function TakeCard({ video, selected, onOpen, onMediaError, action, compact = false }: {
  video: StockFrameVideo; selected?: boolean; onOpen: () => void; onMediaError?: (id: string) => void; action?: { label: string; onClick: () => void; disabled?: boolean }; compact?: boolean;
}) {
  const [previewFocused, setPreviewFocused] = useState(false);
  return <article className={`${s.takeCard} ${selected ? s.takeSelected : ''} ${compact ? s.takeCompact : ''}`}>
    <button type="button" className={s.takePreview} onClick={onOpen} onFocus={() => setPreviewFocused(true)} onBlur={() => setPreviewFocused(false)} aria-label={`Ver ${video.title}`}><LazyVideo video={video} focused={previewFocused} suspended={selected} onMediaError={onMediaError}/></button>
    <div className={s.takeBody}>
      <div className={s.takeMeta}>
        <span className={video.origin === 'ai' ? s.ai : s.organic}>{video.origin === 'ai' ? 'I.A' : video.origin === 'organic' ? 'ORGÂNICO' : 'STOCK'}</span>
        {video.code && <code>#{video.code}</code>}
      </div>
      <button type="button" className={s.takeTitle} onClick={onOpen}>{video.title}</button>
      {!compact && <p>{video.description || video.tags.slice(0, 4).join(' · ') || video.subcategoryName || 'Take StockFrame'}</p>}
      <div className={s.takeFooter}>
        <span>{video.downloads ? `${video.downloads} downloads` : video.nicheName || 'StockFrame'}</span>
        {action && <button type="button" className={s.cardAction} onClick={action.onClick} disabled={action.disabled}><Icon name={selected ? 'check' : 'download'} size={15}/>{action.label}</button>}
      </div>
    </div>
  </article>;
}

function CopyRange({ parts, anchor, from, to, onAnchor, onRange }: {
  parts: StockFrameCopyPart[]; anchor: string; from: number; to: number;
  onAnchor: (anchor: string) => void; onRange: (from: number, to: number) => void;
}) {
  const part = parts.find((item) => item.label === anchor) || parts[0];
  const words = part?.text.match(/\S+/g) || [];
  return <section className={s.copyPicker} aria-label="Trecho da copy">
    <div className={s.copyTabs}>{parts.map((item) => <button type="button" key={item.label} className={item.label === part?.label ? s.copyTabActive : ''} onClick={() => onAnchor(item.label)}>{item.label}</button>)}</div>
    <div className={s.words}>{words.map((word, index) => {
      const chosen = index >= Math.min(from, to) && index <= Math.max(from, to);
      return <button type="button" key={`${index}:${word}`} className={chosen ? s.wordActive : ''} onClick={() => {
        if (from !== to || index === from) onRange(index, index);
        else onRange(Math.min(from, index), Math.max(from, index));
      }}>{word}</button>;
    })}</div>
    <p><span>{Math.min(from, to) + 1}–{Math.max(from, to) + 1}</span> · clique numa palavra para iniciar; clique noutra para fechar o trecho.</p>
  </section>;
}

function CoverageIcon({ level }: { level: SmartCoverage }) {
  const count = level === 30 ? 3 : level === 60 ? 6 : 10;
  return <span className={s.coverageIcon}>{Array.from({ length: 10 }, (_, index) => <i key={index} data-on={index < count}/>)}</span>;
}

function PaceIcon({ pace }: { pace: SmartPace }) {
  return <span className={s.paceIcon} data-pace={pace}>{Array.from({ length: pace === 'fast' ? 5 : pace === 'long' ? 2 : 4 }, (_, index) => <i key={index}/>)}</span>;
}

export function PilotStockFrameButton({ enabled, count, onClick }: { enabled: boolean; count: number; onClick: () => void }) {
  return <button type="button" className={`${s.trigger} ${enabled ? s.triggerActive : ''}`} onClick={(event) => { event.stopPropagation(); onClick(); }} aria-label={`StockFrame${enabled ? ', ligado' : ', desligado'}${count ? `, ${count} takes` : ''}`} aria-haspopup="dialog" title={`StockFrame · ${enabled ? 'Ligado' : 'Desligado'}`} data-stockframe-trigger="true">
    <span className={s.triggerGlow}/><StockFrameMark compact/>{count > 0 && <span className={s.triggerCount}>{count}</span>}
  </button>;
}

const EMPTY_PAGE: StockFramePage = { videos: [], niches: [], page: 1, perPage: 24, total: 0, totalPages: 1 };

export function PilotStockFrameModal({ taskId, parts, inserts, enabled, onEnabledChange, onClose, onChange, onImportMedia, onEditInserts, onUpdateMontage, updatingMontage = false }: {
  taskId: string; parts: StockFrameCopyPart[]; inserts: Insert[]; enabled: boolean;
  onEnabledChange: (value: boolean) => void; onClose: () => void; onChange: (value: Change) => void;
  onImportMedia: (file: File, anchor: string) => Promise<InsertMedia | null>; onEditInserts: () => void;
  onUpdateMontage?: () => Promise<boolean>; updatingMontage?: boolean;
}) {
  const uid = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [mode, setMode] = useState<'manual' | 'smart'>('manual');
  const [account, setAccount] = useState<StockFrameAccount | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [reloadingExtension, setReloadingExtension] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [page, setPage] = useState<StockFramePage>(EMPTY_PAGE);
  const [niches, setNiches] = useState<StockFrameNiche[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchDraft, setSearchDraft] = useState('');
  const [filters, setFilters] = useState<StockFrameFilters>({ page: 1, perPage: 24, sort: 'relevance' });
  const [selected, setSelected] = useState<StockFrameVideo | null>(null);
  const [anchor, setAnchor] = useState(parts[0]?.label || 'BODY 1');
  const [wordFrom, setWordFrom] = useState(0);
  const [wordTo, setWordTo] = useState(Math.min(8, Math.max(0, (parts[0]?.text.match(/\S+/g)?.length || 1) - 1)));
  const [busyTake, setBusyTake] = useState('');
  const [coverage, setCoverage] = useState<SmartCoverage>(60);
  const [pace, setPace] = useState<SmartPace>('adaptive');
  const [smart, setSmart] = useState<SmartStockSegment[]>([]);
  const [smartBusy, setSmartBusy] = useState(false);
  const [smartProgress, setSmartProgress] = useState('');
  const [activeSegment, setActiveSegment] = useState('');
  const [smartEditTarget, setSmartEditTarget] = useState<{ anchor: string; from: number; to: number; segmentId?: string } | null>(null);
  const [plannedContext, setPlannedContext] = useState('');
  const importedMedia = useRef(new Map<string, InsertMedia>());
  const downloadedFiles = useRef(new Map<string, File>());
  const operationLocked = useRef(false);
  const mediaRefreshAttempts = useRef(new Map<string, number>());
  const mediaRepairAttempts = useRef(new Map<string, number>());
  // Catalog browsing while replacing a take must never erase a reviewed plan.
  // Only changes to the copy or Smart settings invalidate its word coverage.
  const planContext = JSON.stringify({ parts, coverage, pace });
  const planIsCurrent = plannedContext === planContext;

  useEffect(() => {
    if (!plannedContext || planIsCurrent) return;
    setSmart([]);
    setActiveSegment('');
    setSmartEditTarget(null);
    setPlannedContext('');
    setNotice('A copy ou as opções mudaram. Analise novamente para revisar o plano atualizado.');
  }, [planIsCurrent, plannedContext]);

  useEffect(() => { setMounted(true); return travarScrollDaPagina(); }, []);
  useEffect(() => {
    if (!mounted) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeStockFrame(); return; }
      if (event.key !== 'Tab' || !dialog.current) return;
      const focusable = [...dialog.current.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex="0"]')].filter((node) => node.getClientRects().length);
      if (!focusable.length) return;
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keydown, true);
    return () => { document.removeEventListener('keydown', keydown, true); previous?.focus(); };
  }, [mounted, onClose, enabled, inserts, smart]);

  function closeStockFrame() {
    // Smart selections live only in this dialog until applied. Closing an
    // unapplied plan must not leave the task ON with no persisted stock take.
    if (enabled && !inserts.some((insert) => insert.source === 'stockframe')) onEnabledChange(false);
    onClose();
  }

  const refreshStatus = useCallback(async () => {
    setError('');
    try {
      const status = await stockFrameStatus();
      setConfigured(status.configured);
      const nextAccount = status.account || null;
      setAccount(nextAccount);
      if (nextAccount?.niches?.length) setNiches((current) => mergeStockFrameNiches(current, nextAccount.niches));
      if (!status.configured && status.error) setError(status.error);
    } catch (reason) {
      setConfigured(false);
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, []);
  useEffect(() => { if (enabled) void refreshStatus(); }, [enabled, refreshStatus]);

  useEffect(() => {
    const timer = setTimeout(() => setFilters((current) => current.search === searchDraft.trim() ? current : { ...current, search: searchDraft.trim(), page: 1 }), 320);
    return () => clearTimeout(timer);
  }, [searchDraft]);

  useEffect(() => {
    if (!enabled || !configured) return;
    let live = true;
    setLoading(true);
    setError('');
    stockFrameList(filters).then(async (result) => {
      if (!live) return;
      const videos = enrichStockFrameVideos(result.videos, mergeStockFrameNiches(account?.niches || [], result.niches));
      setPage({ ...result, videos });
      setNiches((current) => mergeStockFrameNiches(current, result.niches));
      if (account?.capabilities.mediaUrls) {
        const refreshed = await renewMedia(videos);
        if (live && refreshed !== videos) setPage((current) => ({ ...current, videos: refreshed }));
      }
    }).catch((reason) => { if (live) setError(reason instanceof Error ? reason.message : String(reason)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [enabled, configured, filters, account?.capabilities.mediaUrls]);

  async function renewMedia(videos: StockFrameVideo[], force = false): Promise<StockFrameVideo[]> {
    if (!account?.capabilities.mediaUrls || !videos.length) return videos;
    const now = Date.now();
    const targets = videos.filter((video) => {
      const expired = video.mediaExpiresAt && Date.parse(video.mediaExpiresAt) < now + 5 * 60_000;
      const absent = !video.posterUrl || !video.previewUrl;
      return (force || expired || absent) && now - (mediaRefreshAttempts.current.get(video.id) || 0) > 60_000;
    }).slice(0, 100);
    if (!targets.length) return videos;
    targets.forEach((video) => mediaRefreshAttempts.current.set(video.id, now));
    try { return mergeStockFrameMediaUrls(videos, await stockFrameMediaUrls(targets.map((video) => video.id))); }
    catch { return videos; }
  }

  async function repairMedia(id: string) {
    if (!account?.capabilities.mediaUrls) return;
    // Broken source assets may receive a fresh signed URL for the same unusable
    // file. Bound automatic retries so one card cannot continuously re-sign it.
    const attempts = mediaRepairAttempts.current.get(id) || 0;
    if (attempts >= 2) return;
    mediaRepairAttempts.current.set(id, attempts + 1);
    mediaRefreshAttempts.current.delete(id);
    const all = [...page.videos, ...smart.flatMap((segment) => segment.candidates.map((candidate) => candidate.video)), ...(selected ? [selected] : [])];
    const target = all.find((video) => video.id === id);
    if (!target) return;
    const refreshed = await renewMedia([target], true);
    const updated = refreshed[0];
    if (!updated || (updated.previewUrl === target.previewUrl && updated.posterUrl === target.posterUrl)) return;
    setPage((current) => ({ ...current, videos: current.videos.map((video) => video.id === id ? { ...video, ...updated } : video) }));
    setSmart((current) => current.map((segment) => ({ ...segment, candidates: segment.candidates.map((candidate) => candidate.video.id === id ? { ...candidate, video: { ...candidate.video, ...updated } } : candidate) })));
    setSelected((current) => current?.id === id ? { ...current, ...updated } : current);
  }

  async function connect() {
    if (connecting) return;
    setConnecting(true); setError('');
    try {
      const status = await stockFrameConfigure(apiKey);
      importedMedia.current.clear(); downloadedFiles.current.clear();
      const nextAccount = status.account || null;
      setConfigured(true); setAccount(nextAccount); setApiKey('');
      if (nextAccount?.niches?.length) setNiches((current) => mergeStockFrameNiches(current, nextAccount.niches));
      setNotice('Conta StockFrame validada. O catálogo respeita o seu plano e a sua cota.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setConnecting(false); }
  }

  async function disconnect() {
    setConnecting(true); setError('');
    try { await stockFrameDisconnect(); importedMedia.current.clear(); downloadedFiles.current.clear(); setSmart([]); setPlannedContext(''); setConfigured(false); setAccount(null); setPage(EMPTY_PAGE); setNiches([]); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setConnecting(false); }
  }

  function reloadHeyAuto() {
    if (reloadingExtension) return;
    setReloadingExtension(true);
    setError('');
    setNotice('Recarregando a extensão Hey Auto e reconectando o Pilot…');
    window.postMessage({ source: 'darkolab', type: 'HG_RELOAD_EXT' }, '*');
    window.setTimeout(() => window.location.reload(), 1100);
  }

  async function prepareMedia(video: StockFrameVideo, anchor: string, onProgress: (message: string, percent?: number) => void): Promise<InsertMedia> {
    const reused = importedMedia.current.get(video.id);
    if (reused) return reused;
    let file = downloadedFiles.current.get(video.id);
    if (!file) {
      file = await stockFrameDownload(video, onProgress, taskId);
      // A cota foi consumida assim que o arquivo chegou, mesmo se a importação
      // local falhar. Repetir a tentativa reutiliza os bytes já recebidos.
      downloadedFiles.current.set(video.id, file);
      setAccount((current) => current && current.downloadsToday !== null ? { ...current, downloadsToday: current.downloadsToday + video.downloadCost } : current);
    }
    const media = await onImportMedia(file, anchor);
    if (!media) throw new Error(`O take ${video.title} foi baixado, mas o Pilot não conseguiu prepará-lo.`);
    importedMedia.current.set(video.id, media);
    downloadedFiles.current.delete(video.id);
    return media;
  }

  const importVideo = async (video: StockFrameVideo, placement: StockPlacement) => {
    if (!enabled || operationLocked.current) return false;
    operationLocked.current = true;
    setBusyTake(video.id); setError(''); setNotice('');
    try {
      const media = await prepareMedia(video, placement.anchor, (message, percent) => setNotice(`${message}${Number.isFinite(percent) ? ` ${percent}%` : ''}`));
      const insert = stockFrameInsert(video, media, placement);
      onChange((current) => [...current, insert]);
      onEnabledChange(true);
      setNotice(`${video.title} entrou no trecho selecionado.`);
      return true;
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); return false; }
    finally { setBusyTake(''); operationLocked.current = false; }
  };

  async function runSmart() {
    if (!enabled || operationLocked.current) return;
    operationLocked.current = true;
    setSmartBusy(true); setError(''); setNotice(''); setSmart([]);
    try {
      const skeleton = planSmartStockSegments(parts, { coverage, pace });
      if (!skeleton.length) throw new Error('A copy não tem palavras suficientes para planejar os inserts.');
      const translation = await translateStockFrameCopy(skeleton, setSmartProgress);
      const localized = translation.translated ? localizeSmartSegments(skeleton, translation.texts, translation.contexts) : skeleton;
      // Infer from the *entire* original copy first. A partial 60% plan may
      // omit the one sentence naming ED/diabetes/etc.; inferring solely from
      // translated selected snippets can incorrectly search another pack.
      const inferredNiche = filters.nicheId ? niches.find((niche) => niche.id === filters.nicheId)
        : inferStockFrameNiche(parts, niches)
          || (translation.translated ? inferStockFrameNiche([{ label: 'COPY', text: translation.texts.join(' ') }], niches) : undefined);
      const nicheId = inferredNiche?.id || filters.nicheId;
      const campaignText = (translation.translated ? `${translation.texts.join(' ')} ${parts.map((part) => part.text).join(' ')}` : parts.map((part) => part.text).join(' ')).slice(0, 15_000);
      const segments = balanceMechanismPresence(localized).map((segment) => ({ ...segment, campaignText, campaignNicheId: nicheId }));
      const bySegment = new Map<string, StockFrameVideo[]>();
      if (account?.capabilities.smartSearch) {
        for (let index = 0; index < segments.length; index += 12) {
          const batch = segments.slice(index, index + 12);
          const queries: StockFrameSmartQuery[] = batch.map((segment, offset) => ({
            id: segment.id,
            text: segment.semanticText || segment.text,
            context_before: segments[index + offset - 1]?.anchor === segment.anchor ? segments[index + offset - 1].semanticText || segments[index + offset - 1].text : '',
            context_after: segments[index + offset + 1]?.anchor === segment.anchor ? segments[index + offset + 1].semanticText || segments[index + offset + 1].text : '',
            full_copy_summary: campaignText.slice(0, 1000),
            desired_duration: segment.targetSeconds,
            niche_id: nicheId || null,
            subcategory_id: filters.subcategoryId || null,
            aspect_ratio: filters.aspectRatio || '9:16',
            origin: filters.origin,
          }));
          const results = await stockFrameSmartSearch(queries);
          for (const segment of batch) bySegment.set(segment.id, results.get(segment.id) || []);
          setSmartProgress(`Busca contextual no StockFrame… ${Math.min(segments.length, index + batch.length)}/${segments.length}`);
        }
      } else {
        for (let index = 0; index < segments.length; index += 3) {
          const batch = segments.slice(index, index + 3);
          const results = await Promise.all(batch.map(async (segment) => stockFrameList({
            page: 1, perPage: 48, search: segment.query || segment.text.slice(0, 120),
            nicheId, aspectRatio: filters.aspectRatio, origin: filters.origin, sort: 'relevance',
          })));
          batch.forEach((segment, offset) => bySegment.set(segment.id, results[offset].videos));
          setSmartProgress(`Comparando takes do catálogo… ${Math.min(segments.length, index + batch.length)}/${segments.length}`);
        }
      }
      // The health niche and the recipe pack are different libraries. Search
      // named mechanisms globally, then let the ingredient/anatomy gates decide.
      // Queries are deduplicated, bounded and never download originals.
      const mechanismVideos: StockFrameVideo[] = [];
      const storyText = segments.map((segment) => segment.semanticText || segment.text).join(' ').toLowerCase();
      const sceneQueries: string[] = [];
      if (/\b(?:energia|vigor|jovem|disposi[cç][aã]o)\b/.test(storyText)) sceneQueries.push('homem ativo', 'homem sorrindo');
      if (/\b(?:testosterona|circula[cç][aã]o|fluxo sangu[ií]neo)\b/.test(storyText)) sceneQueries.push('fluxo sanguineo', 'sistema reprodutor masculino');
      if (/\b(?:mulher(?:es)?|casal|marido|esposa|relacionamento|satisfazer)\b/.test(storyText)) sceneQueries.push('casal conversando', 'homem preocupado');
      if (/\b(?:disfuncao eretil|erecao|desempenho sexual|erectile|erekcja|ereccion)\b/.test(campaignText.toLowerCase())
        && /\b(?:casal|intimidade|desejo|esposa|parceira|relacionamento|couple|intimacy|desire|partner|wife|pareja|intimidad|partnerk)\b/.test(storyText)) {
        sceneQueries.push('casal sensual', 'casal intimidade');
      }
      if (/\b(?:especialista|urologista|m[eé]dic[ao])\b/.test(storyText)) sceneQueries.push('urologista explicando');
      if (/\b(?:durar|aguentar|resistir)\b.{0,45}\b(?:mais|tempo|minutos|horas)\b/.test(storyText)) sceneQueries.push('casal sorrindo');
      const globalQueries = [...new Set([...smartStockMechanismQueries(segments), ...sceneQueries])].slice(0, 12);
      for (let index = 0; index < globalQueries.length; index += 3) {
        setSmartProgress('Buscando cenas congruentes em toda a biblioteca…');
        const results = await Promise.all(globalQueries.slice(index, index + 3).map(search => stockFrameList({
          page: 1, perPage: 48, search, aspectRatio: filters.aspectRatio, origin: filters.origin, sort: 'relevance',
        })));
        mechanismVideos.push(...results.flatMap(result => result.videos));
      }
      for (const [id, videos] of bySegment) bySegment.set(id, enrichStockFrameVideos(videos, niches));
      const globalPool = new Map<string, StockFrameVideo>(enrichStockFrameVideos([...page.videos, ...mechanismVideos, ...[...bySegment.values()].flat()], niches)
        .map((video) => [video.id, { ...video, finalScore: undefined, matchReason: undefined, matchedConcepts: [], conflictingConcepts: [] }]));
      const rankSegments = (current: typeof segments, onlyMissing = false) => current.map((segment) => {
        if (onlyMissing && segment.candidates.length) return segment;
        const pool = new Map(globalPool);
        for (const video of bySegment.get(segment.id) || []) pool.set(video.id, video);
        return { ...segment, candidates: rankStockFrameVideos(segment, [...pool.values()], 12, coverage === 100) };
      });
      let completed = rankSegments(segments);
      if (completed.some((segment) => !segment.candidates.length)) {
        let maxPages = 10;
        for (let pageNo = 1; pageNo <= maxPages; pageNo++) {
          setSmartProgress(`Ampliando o catálogo para cobrir os trechos escolhidos… página ${pageNo}/${maxPages}`);
          const more = await stockFrameList({ page: pageNo, perPage: 48, nicheId, aspectRatio: filters.aspectRatio, origin: filters.origin, sort: 'relevance' });
          maxPages = Math.min(10, more.totalPages || 1);
          for (const video of enrichStockFrameVideos(more.videos, niches)) globalPool.set(video.id, { ...video, finalScore: undefined, matchReason: undefined, matchedConcepts: [], conflictingConcepts: [] });
          completed = rankSegments(completed, true);
          if (completed.every((segment) => segment.candidates.length)) break;
        }
      }
      // O nicho médico não costuma catalogar cenas neutras de relacionamento,
      // dinheiro ou consulta. Se ainda houver lacuna no plano, buscar
      // essas cenas na biblioteca inteira antes do fallback final, sem baixar.
      if (completed.some((segment) => !segment.candidates.length)) {
        const missingText = completed.filter(segment => !segment.candidates.length)
          .map(segment => (segment.semanticText || segment.text).toLowerCase()).join(' ');
        const broadQueries = new Set<string>();
        if (/dinheiro|grana|preço|preco|pagar|pagamento/.test(missingText)) {
          broadQueries.add('dinheiro'); broadQueries.add('casal discutindo dinheiro');
        }
        if (/casal|mulher|marido|esposa|relacionamento|companheir/.test(missingText)) {
          broadQueries.add('casal conversando'); broadQueries.add('casal preocupado');
        }
        if (/medic|especialista|urologista|consulta/.test(missingText)) broadQueries.add('medico conversando');
        if (/clic|bot[aã]o|assist|ver v[ií]deo|saiba mais/.test(missingText)) {
          // A busca da API pode tratar duas palavras como AND. A biblioteca
          // real tem "CASAL IDOSO USANDO CELULAR", mas não necessariamente
          // "celular clicando". O ranking local valida a cena depois.
          broadQueries.add('celular'); broadQueries.add('celular clicando');
        }
        broadQueries.add('casal conversando'); broadQueries.add('homem preocupado');
        const searches = [...broadQueries].slice(0, 8);
        for (let index = 0; index < searches.length; index += 3) {
          setSmartProgress('Procurando alternativas visuais neutras para as lacunas…');
          const results = await Promise.all(searches.slice(index, index + 3).map(search => stockFrameList({
            page: 1, perPage: 48, search, aspectRatio: filters.aspectRatio, origin: filters.origin, sort: 'relevance',
          })));
          for (const video of enrichStockFrameVideos(results.flatMap(result => result.videos), niches)) {
            globalPool.set(video.id, { ...video, finalScore: undefined, matchReason: undefined, matchedConcepts: [], conflictingConcepts: [] });
          }
        }
        completed = rankSegments(completed, true);
      }
      const recipeTheme = chooseCampaignRecipeTheme(completed);
      if (recipeTheme.length) completed = completed.map((segment) => ({
        ...segment,
        campaignIngredients: recipeTheme,
        candidates: rankStockFrameVideos({ ...segment, campaignIngredients: recipeTheme },
          [...new Map([...globalPool, ...(bySegment.get(segment.id) || []).map((video): [string, StockFrameVideo] => [video.id, video])]).values()], 12, coverage === 100),
      }));
      // Generic scenes are a LAST resort for every requested coverage level,
      // never competitors against an exact match. A 60% plan cannot silently
      // become 20% just because only the recipe shots matched the first query.
      // All ingredient, anatomy and visual-safety gates stay active.
      completed = completed.map(segment => segment.candidates.length ? segment : {
        ...segment, candidates: rankStockFrameGenericFallback(segment, [...globalPool.values()], 12),
      });
      // Takes StockFrame inseridos à mão continuam na montagem ao aplicar o
      // plano: o Smart não pode escolhê-los de novo nem oferecê-los como
      // alternativa (a montagem repetiria o mesmo take).
      const manualIds = manualStockFrameIds(inserts);
      if (manualIds.size) completed = completed.map((segment) => ({ ...segment, candidates: segment.candidates.filter((candidate) => !manualIds.has(candidate.video.id)) }));
      // planSmartStockSegments already selected precisely the requested word
      // budget for 30/60. Fill each of those slots whenever a safe candidate
      // exists; the strict coverage check before download remains unchanged.
      let chosen = chooseSmartStockAssignments(completed, true);
      if (account?.capabilities.mediaUrls) {
        const previewVideos = [...new Map(chosen.flatMap((segment) => segment.candidates.slice(0, 4).map((candidate) => [candidate.video.id, candidate.video]))).values()];
        const refreshed = await renewMedia(previewVideos);
        const media = new Map(refreshed.map((video) => [video.id, video]));
        chosen = chosen.map((segment) => ({ ...segment, candidates: segment.candidates.map((candidate) => ({ ...candidate, video: media.get(candidate.video.id) || candidate.video })) }));
      }
      setPlannedContext(planContext);
      setSmart(chosen);
      const first = chosen.find((segment) => segment.selectedVideoId);
      if (first) setActiveSegment(first.id);
      const missing = chosen.filter((segment) => !segment.selectedVideoId).length;
      const generic = chosen.filter(segment => selectedSmartCandidate(segment)?.genericFallback).length;
      const languageNote = translation.translated ? `Copy ${translation.language.toUpperCase()} interpretada no dispositivo. ` : translation.note ? `${translation.note} ` : '';
      setNotice(languageNote + (missing ? `${chosen.length - missing} trechos receberam take; ${missing} ficaram sem alternativa segura no catálogo acessível. Nenhum download foi consumido.` : `${chosen.length} trechos prontos para revisão. Nenhum download foi consumido ainda.`) + (generic ? ` ${generic} alternativa(s) genérica(s), usadas somente após a busca específica.` : ''));
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setSmartBusy(false); setSmartProgress(''); operationLocked.current = false; }
  }

  async function applySmart() {
    if (!enabled || operationLocked.current) return;
    if (!planIsCurrent) { setError('A copy ou as opções mudaram. Analise novamente antes de aplicar.'); return; }
    const planned = smart.map((segment) => ({ segment, candidate: selectedSmartCandidate(segment) })).filter((item) => !!item.candidate);
    if (!planned.length) { setError('Escolha pelo menos um take no plano inteligente.'); return; }
    const measured = measureSmartStockCoverage(parts, planned.map(({ segment }) => segment));
    if (coverage === 100 && !measured.complete) {
      setError('A cobertura 100% precisa preencher todas as palavras da copy, sem lacunas nem sobreposição. Revise os limites editados antes de aplicar.'); return;
    }
    if (coverage === 100 && inserts.some((insert) => !insert.stockFrame?.smart)) {
      setError('Há inserts manuais ou do Flow nesta montagem. Para garantir 100% StockFrame sem alterar esses inserts, remova-os no editor ou use a cobertura de 60%/30%. Nada foi substituído.'); return;
    }
    if (coverage !== 100) {
      const expected = Math.round(measured.totalWords * coverage / 100);
      const tolerance = Math.max(1, Math.ceil(measured.totalWords * .03));
      if (measured.overlaps || Math.abs(measured.coveredWords - expected) > tolerance) {
        setError(`A cobertura atual é ${measured.percent}% e está fora da faixa de ${coverage}% após a edição dos trechos. Ajuste os limites ou analise novamente.`); return;
      }
    }
    let freshAccount = account;
    try { freshAccount = (await stockFrameStatus()).account || account; if (freshAccount) setAccount(freshAccount); }
    catch (reason) { setError(`Não foi possível conferir a cota StockFrame antes de baixar: ${reason instanceof Error ? reason.message : String(reason)}`); return; }
    const remaining = freshAccount?.downloadsRemaining ?? (freshAccount?.downloadsLimit !== null && freshAccount?.downloadsLimit !== undefined && freshAccount.downloadsToday !== null
      ? freshAccount.downloadsLimit - freshAccount.downloadsToday : null);
    const newVideos = [...new Map(planned.map((item) => item.candidate!.video).filter((video) => !importedMedia.current.has(video.id) && !downloadedFiles.current.has(video.id)).map((video) => [video.id, video])).values()];
    const newDownloads = newVideos.reduce((sum, video) => sum + video.downloadCost, 0);
    if (remaining !== null && remaining !== undefined && remaining < newDownloads) {
      setError(`O plano precisa de ${newDownloads} downloads da cota, mas esta conta StockFrame tem ${Math.max(0, remaining)} disponíveis hoje.`); return;
    }
    operationLocked.current = true;
    setSmartBusy(true); setError('');
    const prepared: Insert[] = [];
    try {
      // Prepara tudo antes de tocar no plano vigente. Se qualquer download ou
      // importacao falhar, o usuario continua com a montagem anterior inteira.
      for (let index = 0; index < planned.length; index++) {
        const item = planned[index];
        const video = item.candidate!.video;
        setBusyTake(video.id);
        setSmartProgress(`Baixando ${index + 1}/${planned.length}: ${video.title}`);
        const media = await prepareMedia(video, item.segment.anchor, (message, percent) => {
          setSmartProgress(`${message}${Number.isFinite(percent) ? ` ${percent}%` : ''}`);
        });
        prepared.push(stockFrameInsert(video, media, {
          anchor: item.segment.anchor,
          from: item.segment.wordFrom,
          to: item.segment.wordTo,
          smart: true,
          score: item.candidate!.score,
          coverage,
        }));
      }
      // Substitui somente o plano Smart anterior; escolhas manuais permanecem.
      onChange((current) => [...current.filter((insert) => !insert.stockFrame?.smart), ...prepared]);
      onEnabledChange(true);
      setNotice(`${prepared.length} takes do Smart Stocks foram preparados para a montagem.`);
    } catch (reason) {
      setError(`${reason instanceof Error ? reason.message : String(reason)} O plano anterior foi mantido sem alterações. Os takes já preparados serão reutilizados ao tentar novamente nesta janela.`);
    } finally { setBusyTake(''); setSmartBusy(false); setSmartProgress(''); operationLocked.current = false; }
  }

  function adjustActiveRange(edge: 'from' | 'to', delta: number) {
    if (!activeSmart) return;
    const part = parts.find((item) => item.label === activeSmart.anchor);
    const words = part?.text.match(/\S+/g) || [];
    if (!words.length) return;
    setSmart((current) => current.map((segment) => {
      if (segment.id !== activeSmart.id) return segment;
      const nextFrom = edge === 'from'
        ? Math.max(0, Math.min(segment.wordTo, segment.wordFrom + delta))
        : segment.wordFrom;
      const nextTo = edge === 'to'
        ? Math.min(words.length - 1, Math.max(segment.wordFrom, segment.wordTo + delta))
        : segment.wordTo;
      const length = nextTo - nextFrom + 1;
      return {
        ...segment,
        wordFrom: nextFrom,
        wordTo: nextTo,
        text: words.slice(nextFrom, nextTo + 1).join(' '),
        targetSeconds: Math.round(Math.max(2.5, Math.min(10, length / 2.35)) * 10) / 10,
      };
    }));
  }

  function editTimelineBlock(block: ReturnType<typeof buildSmartStockTimeline>[number]) {
    setActiveSegment(block.segmentId || block.id);
    setSmartEditTarget({ anchor: block.anchor, from: block.wordFrom, to: block.wordTo, segmentId: block.segmentId });
    setAnchor(block.anchor);
    setWordFrom(block.wordFrom);
    setWordTo(block.wordTo);
    setSelected(null);
    setMode('manual');
  }

  function chooseForPlan(video: StockFrameVideo) {
    if (!enabled || !smartEditTarget) return;
    if (manualStockFrameIds(inserts).has(video.id)) {
      setError('Este take já está na montagem (inserido manualmente). Selecione um take diferente para manter a montagem variada.');
      return;
    }
    if (smart.some((segment) => segment.selectedVideoId === video.id && segment.id !== smartEditTarget.segmentId)) {
      setError('Este take já está escolhido em outro trecho. Selecione um take diferente para manter a montagem variada.');
      return;
    }
    const { anchor: targetAnchor, from, to, segmentId } = smartEditTarget;
    const part = parts.find((item) => item.label === targetAnchor);
    const words = part?.text.match(/\S+/g) || [];
    const text = words.slice(from, to + 1).join(' ');
    if (!text) return;
    const manualCandidate = { video, score: 0, reasons: ['Escolhido manualmente na biblioteca'] };
    const newId = `manual:${crypto.randomUUID()}`;
    setSmart((current) => segmentId ? current.map((segment) => segment.id === segmentId
      ? { ...segment, selectedVideoId: video.id,
        candidates: segment.candidates.some((candidate) => candidate.video.id === video.id) ? segment.candidates : [manualCandidate, ...segment.candidates] }
      : segment) : [...current, { id: newId, anchor: targetAnchor, wordFrom: from, wordTo: to, text,
        query: text, concepts: [], visualScore: 0, targetSeconds: Math.round(Math.max(2.5, Math.min(10, (to - from + 1) / 2.35)) * 10) / 10,
        candidates: [manualCandidate], selectedVideoId: video.id }]);
    setActiveSegment(segmentId || newId);
    setSmartEditTarget(null);
    setSelected(null);
    setMode('smart');
    setError('');
    setNotice(`${video.title} escolhido para ${targetAnchor}. O download só acontece ao aplicar na montagem.`);
  }

  const timeline = useMemo(() => buildSmartStockTimeline(parts, smart), [parts, smart]);
  const activeBlock = timeline.find((block) => block.id === activeSegment || block.segmentId === activeSegment) || timeline[0];
  const activeSmart = smart.find((segment) => segment.id === activeBlock?.segmentId);
  const activeCandidate = activeSmart ? selectedSmartCandidate(activeSmart) : undefined;
  // "Já na montagem" = o plano Smart atual + os takes StockFrame inseridos à
  // mão, que continuam na montagem quando o plano é aplicado. Nenhum deles
  // pode reaparecer como alternativa ou ser escolhido de novo.
  const inMontage = manualStockFrameIds(inserts);
  const chosenElsewhere = new Set([...smart.filter((segment) => segment.id !== activeSmart?.id && segment.selectedVideoId).map((segment) => segment.selectedVideoId), ...inMontage]);
  const alternatives = activeSmart?.candidates.filter((candidate) => candidate.video.id !== activeSmart.selectedVideoId && !chosenElsewhere.has(candidate.video.id)) || [];
  const availableVideos = useMemo(() => page.videos.filter((video) => {
    if (filters.aspectRatio && video.aspectRatio !== 'unknown' && video.aspectRatio !== filters.aspectRatio) return false;
    if (filters.audio !== undefined && video.hasAudio !== null && video.hasAudio !== filters.audio) return false;
    if (filters.origin && video.origin !== 'unknown' && video.origin !== filters.origin) return false;
    if (filters.favorites && !video.favorite) return false;
    return true;
  }), [page.videos, filters.aspectRatio, filters.audio, filters.origin, filters.favorites]);

  if (!mounted) return null;
  return createPortal(<div className={s.backdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeStockFrame(); }}>
    <div ref={dialog} className={s.dialog} role="dialog" aria-modal="true" aria-labelledby={`${uid}-title`} tabIndex={-1}>
      <header className={s.header}>
        <StockFrameMark/>
        <div className={s.headerCenter}>
          <button type="button" disabled={!enabled} className={mode === 'manual' ? s.modeActive : ''} onClick={() => setMode('manual')}><Icon name="search"/>Biblioteca</button>
          <button type="button" disabled={!enabled} className={mode === 'smart' ? s.modeActive : ''} onClick={() => { setSmartEditTarget(null); setMode('smart'); }}><Icon name="spark"/>Smart Stocks</button>
        </div>
        <div className={s.headerActions}>
          {account && <span className={s.quota}><small>downloads hoje</small><b>{account.downloadsToday ?? '—'}<i>/</i>{account.downloadsLimit ?? '—'}</b></span>}
          <label className={`${s.masterToggle} ${enabled ? s.masterToggleOn : ''}`} title="Ativar takes StockFrame na montagem"><input type="checkbox" checked={enabled} onChange={(event) => { onEnabledChange(event.target.checked); if (!event.target.checked) { setSelected(null); setSmartEditTarget(null); } }} aria-label="Ativar StockFrame"/><span/><em>{enabled ? 'ON' : 'OFF'}</em></label>
          <button type="button" className={s.iconButton} onClick={closeStockFrame} aria-label="Fechar"><Icon name="close" size={21}/></button>
        </div>
      </header>

      {!enabled ? <main className={s.lockedState}><span className={s.lockedIcon}><Icon name="spark" size={32}/></span><h1 id={`${uid}-title`}>StockFrame desligado</h1><p>Ative o botão ON no canto superior para acessar a biblioteca e o Smart Stocks. Nenhuma busca, prévia ou download é iniciado enquanto estiver OFF.</p></main> : configured === null ? <div className={s.centerState}><span className={s.loader}/><h2>Conectando ao StockFrame</h2><p>Validando a extensão e a conta deste navegador.</p></div> : !configured ? <main className={s.setup}>
        <div className={s.setupAmbient}/>
        <section className={s.setupCard}>
          <span className={s.setupIcon}><Icon name="key" size={26}/></span>
          <small>STOCKFRAME NO PILOT</small>
          <h1 id={`${uid}-title`}>Conecte sua conta StockFrame</h1>
          <p>Esta integração exige uma conta paga no StockFrame. A chave apenas lista e baixa os vídeos que o seu plano já libera; ela não concede acesso extra e cada download entra na sua cota normal.</p>
          <label><span>Chave pessoal da API</span><div className={s.keyField}><Icon name="shield"/><input type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void connect(); }} placeholder="Cole a chave gerada em Meu perfil e API"/><button type="button" onClick={() => void connect()} disabled={connecting || apiKey.trim().length < 12}>{connecting ? <span className={s.miniLoader}/> : <Icon name="key"/>}Conectar</button></div></label>
          <div className={s.setupSteps}><span><b>1</b>Abra Meu perfil e API</span><span><b>2</b>Gere sua chave pessoal</span><span><b>3</b>Cole acima e valide</span></div>
          {error && <div className={s.error}>{error}</div>}
          {/extens[aã]o Hey Auto/i.test(error) && <div className={s.setupActions}><a className={s.setupRecovery} href="/api/extension/download" download><Icon name="download"/>Baixar atualização</a><button type="button" className={s.setupRecovery} onClick={reloadHeyAuto} disabled={reloadingExtension}><Icon name="refresh"/>{reloadingExtension ? 'Recarregando…' : 'Recarregar Hey Auto'}</button><small>Substitua os arquivos na pasta da extensão pelo .zip atualizado. Depois, recarregue a Hey Auto. Aguarde gerações em andamento terminarem antes de atualizar.</small></div>}
          {notice && <div className={s.notice}>{notice}</div>}
        </section>
      </main> : <>
        <div className={s.accountBar}>
          <div><span className={s.accountAvatar}>{(account?.name || account?.email || 'S').slice(0, 1).toUpperCase()}</span><p><b>{account?.name || 'Conta StockFrame'}</b><small>{account?.email || 'Conta validada pela API'}</small></p></div>
          <p><Icon name="shield" size={15}/>Catálogo e cota vinculados ao plano do usuário</p>
          <button type="button" onClick={() => void disconnect()} disabled={connecting}>Trocar conta</button>
        </div>

        {mode === 'manual' ? <main className={s.workspace}>
          <aside className={s.sidebar}>
            <div className={s.sideTitle}><small>BIBLIOTECA</small><b>{page.total.toLocaleString('pt-BR')} takes disponíveis</b></div>
            <button type="button" className={!filters.nicheId ? s.sideActive : ''} onClick={() => setFilters((current) => ({ ...current, nicheId: undefined, subcategoryId: undefined, page: 1 }))}><span className={s.sideLabel}><Icon name="grid" size={16}/>Todos os vídeos</span><span className={s.sideCount}>{page.total || ''}</span></button>
            {niches.map((niche) => <div key={niche.id} className={s.sideGroup}><button type="button" className={filters.nicheId === niche.id && !filters.subcategoryId ? s.sideActive : ''} onClick={() => setFilters((current) => ({ ...current, nicheId: niche.id, subcategoryId: undefined, page: 1 }))}><span className={s.sideLabel}><Icon name="folder" size={16}/>{niche.name}</span><span className={s.sideCount}>{niche.count || ''}</span></button>{filters.nicheId === niche.id && niche.subcategories?.length ? <div className={s.sideChildren}>{niche.subcategories.map((subcategory) => <button type="button" key={subcategory.id} className={filters.subcategoryId === subcategory.id ? s.sideActive : ''} onClick={() => setFilters((current) => ({ ...current, nicheId: niche.id, subcategoryId: subcategory.id, page: 1 }))}><span className={s.sideLabel}><Icon name="folder" size={13}/>{subcategory.name}</span><span className={s.sideCount}>{subcategory.count || ''}</span></button>)}</div> : null}</div>)}
          </aside>
          <section className={s.library}>
            <div className={s.libraryTop}>
              <div><small>STOCK FRAME / BIBLIOTECA</small><h1 id={`${uid}-title`}>{niches.find((item) => item.id === filters.nicheId)?.name || 'Todos os takes'}</h1></div>
              <div className={s.search}><Icon name="search"/><input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="Buscar cenas, sintomas, ações, pessoas…"/><button type="button" onClick={() => setFilters((current) => ({ ...current, search: searchDraft.trim(), page: 1 }))}>Buscar</button></div>
            </div>
            <div className={s.filters}>
              <div>{([undefined, '9:16', '16:9'] as const).map((value) => <button type="button" key={value || 'all'} className={filters.aspectRatio === value ? s.filterActive : ''} onClick={() => setFilters((current) => ({ ...current, aspectRatio: value, page: 1 }))}>{value || 'Tudo'}</button>)}<button type="button" className={filters.audio === true ? s.filterActive : ''} onClick={() => setFilters((current) => ({ ...current, audio: current.audio === true ? undefined : true, page: 1 }))}>Audio</button></div>
              <div><button type="button" className={!filters.favorites && filters.sort === 'relevance' ? s.filterActive : ''} onClick={() => setFilters((current) => ({ ...current, favorites: undefined, sort: 'relevance', page: 1 }))}>Todos</button><button type="button" className={filters.favorites ? s.filterActive : ''} onClick={() => setFilters((current) => ({ ...current, favorites: !current.favorites, page: 1 }))}>Favoritos</button><button type="button" className={filters.sort === 'downloads' ? s.filterActive : ''} onClick={() => setFilters((current) => ({ ...current, sort: 'downloads', favorites: undefined, page: 1 }))}>Mais baixados</button><button type="button" className={filters.sort === 'recent' ? s.filterActive : ''} onClick={() => setFilters((current) => ({ ...current, sort: 'recent', favorites: undefined, page: 1 }))}>Recentes</button></div>
              <div>{([undefined, 'organic', 'ai'] as const).map((value) => <button type="button" key={value || 'all'} className={filters.origin === value ? s.filterActive : ''} onClick={() => setFilters((current) => ({ ...current, origin: value, page: 1 }))}>{value === 'organic' ? 'Orgânico' : value === 'ai' ? 'I.A' : 'Origem'}</button>)}</div>
            </div>
            {smartEditTarget ? <div className={s.editBanner}><span><b>{smartEditTarget.segmentId ? 'TROCAR TAKE' : 'ADICIONAR B-ROLL'}</b><small>{smartEditTarget.anchor} · palavras {smartEditTarget.from + 1}–{smartEditTarget.to + 1} · escolha um take abaixo, sem download</small></span><button type="button" onClick={() => { setSmartEditTarget(null); setMode('smart'); }}>Voltar ao plano</button></div> : <CopyRange parts={parts} anchor={anchor} from={wordFrom} to={wordTo} onAnchor={(value) => { setAnchor(value); setWordFrom(0); setWordTo(Math.min(8, Math.max(0, (parts.find((item) => item.label === value)?.text.match(/\S+/g)?.length || 1) - 1))); }} onRange={(from, to) => { setWordFrom(from); setWordTo(to); }}/>}
            {loading ? <div className={s.grid}>{Array.from({ length: 10 }, (_, index) => <div className={s.skeleton} key={index}/>)}</div> : availableVideos.length ? <div className={s.grid}>{availableVideos.map((video) => <TakeCard key={video.id} video={video} selected={selected?.id === video.id} onOpen={() => setSelected(video)} onMediaError={(id) => void repairMedia(id)} action={smartEditTarget ? { label: chosenElsewhere.has(video.id) ? 'Já no plano' : 'Usar no plano', disabled: chosenElsewhere.has(video.id), onClick: () => chooseForPlan(video) } : { label: busyTake === video.id ? 'Baixando…' : 'Inserir', disabled: !!busyTake, onClick: () => void importVideo(video, { anchor, from: wordFrom, to: wordTo }) }}/>)}</div> : <div className={s.empty}><Icon name="search" size={27}/><h3>Nenhum take neste filtro</h3><p>Altere a busca ou remova um filtro para ampliar o catálogo.</p></div>}
            <nav className={s.pagination} aria-label="Páginas"><button type="button" disabled={page.page <= 1 || loading} onClick={() => setFilters((current) => ({ ...current, page: Math.max(1, (current.page || 1) - 1) }))}><Icon name="back"/>Anterior</button><span>{page.page} <i>/</i> {page.totalPages}</span><button type="button" disabled={page.page >= page.totalPages || loading} onClick={() => setFilters((current) => ({ ...current, page: Math.min(page.totalPages, (current.page || 1) + 1) }))}>Próxima <Icon name="back"/></button></nav>
          </section>
        </main> : <main className={s.smartWorkspace}>
          <section className={s.smartControl}>
            <div className={s.smartHero}><button type="button" className={s.smartOrb} onClick={() => void runSmart()} disabled={smartBusy} aria-label="Executar Smart Stocks" title="Executar Smart Stocks"><span/><Icon name="spark" size={31}/></button><div><small>INTELIGÊNCIA LOCAL · SEM CUSTO</small><h1 id={`${uid}-title`}>Smart Stocks</h1><p>Interpreta a copy, escolhe onde o b-roll melhora a narrativa e cruza cada trecho com título, descrição, tags, nicho, duração e incompatibilidades de contexto.</p></div></div>
            <div className={s.smartSettings}>
              <fieldset disabled={smartBusy || !!busyTake}><legend>Cobertura · {coverage}%</legend><div>{([30, 60, 100] as SmartCoverage[]).map((value) => <button type="button" key={value} className={coverage === value ? s.smartChoice : ''} onClick={() => setCoverage(value)} aria-label={`${value}% de cobertura`} title={`${value}% de cobertura`}><CoverageIcon level={value}/></button>)}</div></fieldset>
              <fieldset disabled={smartBusy || !!busyTake}><legend>Ritmo · {pace === 'fast' ? 'Cortes rápidos' : pace === 'long' ? 'Takes mais longos' : 'Divisão inteligente'}</legend><div>{([['fast', 'Cortes rápidos'], ['long', 'Takes mais longos'], ['adaptive', 'Divisão inteligente']] as [SmartPace, string][]).map(([value, label]) => <button type="button" key={value} className={pace === value ? s.smartChoice : ''} onClick={() => setPace(value)} aria-label={label} title={label}><PaceIcon pace={value}/></button>)}</div></fieldset>
            </div>
            <button type="button" className={s.runSmart} onClick={() => void runSmart()} disabled={smartBusy}><Icon name="wand"/>{smartBusy ? smartProgress || 'Analisando…' : 'Analisar copy e montar plano'}</button>
            <div className={s.smartProof}><span><Icon name="check"/>Sem custo de IA</span><span><Icon name="check"/>Sem download durante análise</span><span><Icon name="check"/>Revisão antes de aplicar</span></div>
          </section>
          <section className={s.plan}>
            <header><div><small>PLANO DE B-ROLL</small><h2>{smart.length ? `${smart.filter((item) => item.selectedVideoId).length} takes · ${measureSmartStockCoverage(parts, smart).percent}% da copy` : 'Aguardando análise'}</h2></div>{smart.length ? <button type="button" onClick={() => void applySmart()} disabled={smartBusy || !planIsCurrent}><Icon name="download"/>{smartBusy ? 'Preparando…' : 'Aplicar na montagem'}</button> : null}</header>
            {!smart.length ? <div className={s.planEmpty}><span><Icon name="spark" size={35}/></span><h3>A copy vira uma timeline revisável</h3><p>O sistema marca os melhores trechos, apresenta o take escolhido e mantém alternativas para você trocar antes de consumir downloads.</p></div> : <div className={s.planBody}>
              <div className={s.timeline} aria-label="Dinâmica completa da copy">{timeline.map((block, index) => {
                const segment = block.segmentId ? smart.find((item) => item.id === block.segmentId) : undefined;
                const candidate = segment && selectedSmartCandidate(segment);
                return <div key={block.id} className={`${s.timelineRow} ${block.kind === 'avatar' ? s.avatarRow : ''} ${activeBlock?.id === block.id ? s.segmentActive : ''}`}>
                  <button type="button" className={s.segmentMain} data-video-id={candidate?.video.id} onClick={() => setActiveSegment(block.segmentId || block.id)} aria-label={`${block.anchor}, ${block.kind === 'avatar' ? 'avatar sem b-roll' : candidate?.video.title || 'b-roll'}, palavras ${block.wordFrom + 1} a ${block.wordTo + 1}`}>
                    <span>{String(index + 1).padStart(2, '0')}</span><div><small>{block.anchor} · ~{block.targetSeconds.toFixed(1)}s · {block.kind === 'avatar' ? 'AVATAR' : 'STOCKFRAME'}</small><p>{block.text}</p><b>{candidate ? candidate.video.title : 'Avatar · sem b-roll'}</b></div>{candidate?.video.posterUrl ? <img src={candidate.video.posterUrl} alt=""/> : <i><Icon name={block.kind === 'avatar' ? 'play' : 'spark'}/></i>}
                  </button>
                  <button type="button" className={s.rowAction} onClick={() => editTimelineBlock(block)}><Icon name="edit" size={14}/>{block.kind === 'avatar' ? 'Adicionar take' : 'Trocar take'}</button>
                </div>;
              })}</div>
              <div className={s.segmentDetail}>{activeSmart ? <>
                {activeSmart.semanticText && activeSmart.semanticText !== activeSmart.text && <details className={s.reasons}><summary>Interpretação usada na busca</summary><p>{activeSmart.semanticText}</p></details>}
                <div className={s.detailCopy}><small>{activeSmart.anchor} · PALAVRAS {activeSmart.wordFrom + 1}–{activeSmart.wordTo + 1} · ~{activeSmart.targetSeconds.toFixed(1)}s</small><p>“{activeSmart.text}”</p><div className={s.rangeEdit}><span>Início</span><button type="button" onClick={() => adjustActiveRange('from', -1)} aria-label="Adiantar início">−</button><button type="button" onClick={() => adjustActiveRange('from', 1)} aria-label="Atrasar início">+</button><i/><span>Fim</span><button type="button" onClick={() => adjustActiveRange('to', -1)} aria-label="Adiantar fim">−</button><button type="button" onClick={() => adjustActiveRange('to', 1)} aria-label="Atrasar fim">+</button></div></div>
                {activeCandidate ? <><LazyVideo video={activeCandidate.video} active suspended={!!selected} onMediaError={(id) => void repairMedia(id)}/><div className={s.detailTitle}><div><span>{activeCandidate.video.origin === 'ai' ? 'I.A' : 'ORGÂNICO'}</span><h3>{activeCandidate.video.title}</h3></div><b>{activeCandidate.score.toFixed(1)}<small>match</small></b></div><p className={s.reasons}>{activeCandidate.reasons.join(' · ')}</p></> : <div className={s.noMatch}><Icon name="shield" size={26}/><h3>Sem correspondência segura</h3><p>O Smart Stocks preferiu deixar este trecho sem b-roll a escolher algo fora de contexto.</p></div>}
                <div className={s.detailActions}><button type="button" onClick={() => editTimelineBlock(activeBlock)}><Icon name="refresh" size={16}/>Buscar outro take</button><button type="button" onClick={() => { setSmart((current) => current.map((segment) => segment.id === activeSmart.id ? { ...segment, selectedVideoId: undefined } : segment)); setActiveSegment(`avatar:${parts.findIndex((part) => part.label === activeSmart.anchor)}:${activeSmart.wordFrom}-${activeSmart.wordTo}`); }}><Icon name="close" size={16}/>Deixar com avatar</button></div>
                {alternatives.length > 0 && <div className={s.alternatives}><small>ALTERNATIVAS · FORA DO PLANO ATUAL</small><div>{alternatives.map((candidate) => <button type="button" key={candidate.video.id} data-video-id={candidate.video.id} onClick={() => setSmart((current) => current.map((segment) => segment.id === activeSmart.id ? { ...segment, selectedVideoId: candidate.video.id } : segment))}>{candidate.video.posterUrl ? <img src={candidate.video.posterUrl} alt=""/> : <Icon name="play"/>}<span>{candidate.video.title}</span><b>{candidate.score.toFixed(0)}</b></button>)}</div></div>}
              </> : activeBlock ? <div className={s.avatarDetail}><span className={s.avatarBadge}>AVATAR · SEM B-ROLL</span><h3>{activeBlock.anchor} · palavras {activeBlock.wordFrom + 1}–{activeBlock.wordTo + 1}</h3><p>“{activeBlock.text}”</p><small>O avatar permanece visível neste trecho. Você pode cobri-lo com um take da biblioteca e revisar a cobertura antes de aplicar.</small><button type="button" onClick={() => editTimelineBlock(activeBlock)}><Icon name="spark" size={17}/>Adicionar b-roll aqui</button></div> : null}</div>
            </div>}
          </section>
        </main>}

        <footer className={s.footer}>
          <div>{error ? <span className={s.error}>{error}</span> : notice ? <span className={s.notice}>{notice}</span> : <span><Icon name="shield" size={15}/>A chave fica somente na extensão. Downloads respeitam o plano StockFrame.</span>}</div>
          <div><button type="button" className={s.secondary} onClick={onEditInserts} disabled={!inserts.length}><Icon name="edit"/>Ajustar {inserts.length || ''} takes</button>{onUpdateMontage && <button type="button" className={s.secondary} onClick={() => void onUpdateMontage()} disabled={updatingMontage}><Icon name="refresh"/>{updatingMontage ? 'Atualizando…' : 'Atualizar montagem'}</button>}<button type="button" className={s.done} onClick={closeStockFrame}><Icon name="check"/>Concluir</button></div>
        </footer>
      </>}

      {selected && configured && enabled ? <aside className={s.previewDrawer} aria-label="Preview do take"><button type="button" className={s.drawerClose} onClick={() => setSelected(null)} aria-label="Fechar preview"><Icon name="close"/></button><LazyVideo video={selected} active onMediaError={(id) => void repairMedia(id)}/><div className={s.drawerBody}><div className={s.drawerTitle}><div><small>{selected.code ? `#${selected.code}` : selected.nicheName || 'STOCKFRAME'}</small><h2>{selected.title}</h2></div><span>{formatDuration(selected.durationSec)}</span></div><p>{selected.description || 'Take disponível no catálogo da sua conta StockFrame.'}</p><div className={s.tagList}>{selected.tags.slice(0, 14).map((tag) => <span key={tag}>{tag}</span>)}</div><dl><div><dt>Formato</dt><dd>{selected.aspectRatio}</dd></div><div><dt>Origem</dt><dd>{selected.origin === 'ai' ? 'I.A' : selected.origin === 'organic' ? 'Orgânico' : 'StockFrame'}</dd></div><div><dt>Resolução</dt><dd>{selected.width && selected.height ? `${selected.width} × ${selected.height}` : 'Automática'}</dd></div></dl>{mode === 'manual' && <button type="button" className={s.drawerAction} disabled={!!busyTake || !!smartEditTarget && chosenElsewhere.has(selected.id)} onClick={() => smartEditTarget ? chooseForPlan(selected) : void importVideo(selected, { anchor, from: wordFrom, to: wordTo })}><Icon name={smartEditTarget ? 'check' : 'download'}/>{smartEditTarget ? chosenElsewhere.has(selected.id) ? 'Já usado em outro trecho' : 'Usar neste trecho sem baixar' : busyTake === selected.id ? 'Baixando e preparando…' : 'Inserir no trecho selecionado'}</button>}</div></aside> : null}
    </div>
  </div>, document.body);
}
