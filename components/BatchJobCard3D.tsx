'use client';

import React, { useState } from 'react';

/**
 * BatchJobCard3D — card 3D ultra-pro pro painel de batch do ClickUp Pilot.
 *
 * Substitui a UI texto-pesada por:
 *  - Hover tilt 3D (perspective + rotateX/Y leve)
 *  - Botoes circulares icon-only com lift+glow no hover
 *  - Progress bar com gradient animado por fase
 *  - Copy 100% humana (sem termos tecnicos)
 *  - Phase pill que pulsa enquanto roda
 *
 * Mantem 100% das interacoes da versao antiga — drop-in replacement.
 */

export type BatchJob3DPhase =
  | 'queued'
  | 'dispatching'
  | 'rendering'
  | 'downloading'
  | 'post'
  | 'done'
  | 'failed';

export type BatchJob3DProps = {
  taskId: string;
  taskName: string;
  phase: BatchJob3DPhase;
  /** Pre-computed: parts total */
  partsTotal: number;
  /** Pre-computed: parts com videoId */
  partsDispatched: number;
  /** Pre-computed: parts com status completed */
  partsRendered: number;
  /** Mensagem livre (curta, fica embaixo da barra) */
  message?: string;
  /** Elapsed em ms desde o start (pra mostrar tempo decorrido) */
  elapsedMs: number;
  /** Tudo OK = mostra download buttons */
  allOk: boolean;
  /** parcial = phase=done mas algo faltou */
  isPartialDone: boolean;
  /** URLs prontas */
  takesUrl?: string;
  takesFilename?: string;
  montadoUrl?: string;
  montadoFilename?: string;
  camufladoUrl?: string;
  camufladoFilename?: string;
  /** Handlers */
  onRetomar: () => void;
  onPausar: () => void;
  onDebug: () => void;
  onRemove: () => void;
  /** Status flags pra disabled */
  isRunning: boolean;
  isQueued: boolean;
  /** Children: preview grid abaixo do card (renderizado fora pra nao limitar layout) */
  children?: React.ReactNode;
  /** Quando >0, mostra botao "Atualizar montagem" (parts foram re-geradas
   *  via EditPartModal e o ZIP montado/camuflado ficou desatualizado). */
  dirtyPartsCount?: number;
  /** Click no botao "Atualizar montagem" — re-roda runPostPipeline. */
  onRebuild?: () => void;
  /** Spinner quando rebuild ta rodando. */
  isRebuilding?: boolean;
  /** Doc URL (Google Docs) — mostra botao "abrir doc" se presente. */
  docUrl?: string;
  /** Fallback: ClickUp task URL — mostrado se docUrl ausente. */
  taskUrl?: string;
  /** Lazy fetch: chamado quando user clica no botao Docs E docUrl nao existe.
   *  Parent vai no ClickUp, pega custom field "DOC DA COPY", retorna a URL.
   *  Se retornar null = nao tem doc. */
  resolveDocUrl?: () => Promise<string | null>;
  /** Default minimizado (so header + buttons + progress). Default true. */
  defaultMinimized?: boolean;
};

// ───────────────────────── Botão 3D icon-only ─────────────────────────

type Btn3DColor = 'lime' | 'cyan' | 'fuchsia' | 'amber' | 'rose' | 'neutral';

type Btn3DProps = {
  icon: React.ReactNode;
  color: Btn3DColor;
  title: string;
  disabled?: boolean;
  onClick?: () => void;
  href?: string;
  download?: string;
  /** pulse loop quando true (ex: progresso em andamento) */
  pulse?: boolean;
};

const PALETTE: Record<Btn3DColor, { ring: string; bg: string; text: string; glow: string; hoverGlow: string }> = {
  lime: {
    ring: 'border-lime/55',
    bg: 'from-lime/25 via-lime/10 to-lime/[0.02]',
    text: 'text-lime',
    glow: 'shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_3px_10px_-3px_rgba(190,242,100,0.45)]',
    hoverGlow: 'hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_12px_26px_-6px_rgba(190,242,100,0.7)]',
  },
  cyan: {
    ring: 'border-cyan-400/55',
    bg: 'from-cyan-400/25 via-cyan-400/10 to-cyan-400/[0.02]',
    text: 'text-cyan-200',
    glow: 'shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_3px_10px_-3px_rgba(34,211,238,0.45)]',
    hoverGlow: 'hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_12px_26px_-6px_rgba(34,211,238,0.7)]',
  },
  fuchsia: {
    ring: 'border-fuchsia-400/55',
    bg: 'from-fuchsia-400/25 via-fuchsia-400/10 to-fuchsia-400/[0.02]',
    text: 'text-fuchsia-200',
    glow: 'shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_3px_10px_-3px_rgba(217,70,239,0.45)]',
    hoverGlow: 'hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_12px_26px_-6px_rgba(217,70,239,0.7)]',
  },
  amber: {
    ring: 'border-amber-400/55',
    bg: 'from-amber-400/25 via-amber-400/10 to-amber-400/[0.02]',
    text: 'text-amber-200',
    glow: 'shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_3px_10px_-3px_rgba(251,191,36,0.45)]',
    hoverGlow: 'hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_12px_26px_-6px_rgba(251,191,36,0.7)]',
  },
  rose: {
    ring: 'border-rose-400/55',
    bg: 'from-rose-400/25 via-rose-400/10 to-rose-400/[0.02]',
    text: 'text-rose-200',
    glow: 'shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_3px_10px_-3px_rgba(244,63,94,0.45)]',
    hoverGlow: 'hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_12px_26px_-6px_rgba(244,63,94,0.7)]',
  },
  neutral: {
    ring: 'border-white/12',
    bg: 'from-white/10 via-white/[0.04] to-transparent',
    text: 'text-text-muted',
    glow: 'shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]',
    hoverGlow: 'hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_8px_20px_-6px_rgba(255,255,255,0.18)]',
  },
};

export function Btn3D({ icon, color, title, disabled, onClick, href, download, pulse }: Btn3DProps) {
  const p = PALETTE[color];
  const base =
    'group/btn3d relative inline-flex h-9 w-9 items-center justify-center rounded-full border bg-gradient-to-b will-change-transform transition-[transform,box-shadow,opacity] duration-200 ease-out';
  const enabled = `${p.ring} ${p.bg} ${p.text} ${p.glow} ${p.hoverGlow} hover:-translate-y-0.5 hover:scale-[1.08] active:translate-y-0 active:scale-95`;
  const dis = 'border-white/8 bg-white/[0.03] text-white/30 opacity-60 cursor-not-allowed shadow-none';

  const ariaTitle = title;

  const inner = (
    <>
      {/* Highlight gradient top */}
      <span
        className="pointer-events-none absolute inset-x-0 top-0 h-1/2 rounded-t-full bg-gradient-to-b from-white/15 to-transparent"
        aria-hidden
      />
      {pulse && !disabled ? (
        <span className="pointer-events-none absolute inset-0 rounded-full ring-2 ring-current/40 animate-ping opacity-30" aria-hidden />
      ) : null}
      <span className="relative flex items-center justify-center">{icon}</span>
      {/* Sem tooltip custom — usamos native title (delay padrao do browser, sem
       *  barra preta intrusiva embaixo do botao). aria-label cobre a11y. */}
    </>
  );

  if (href && !disabled) {
    return (
      <a
        href={href}
        download={download}
        className={`${base} ${enabled}`}
        title={ariaTitle}
        aria-label={ariaTitle}
      >
        {inner}
      </a>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={ariaTitle}
      aria-label={ariaTitle}
      className={`${base} ${disabled ? dis : enabled}`}
    >
      {inner}
    </button>
  );
}

// ───────────────────────── Icons (inline SVG, sem dependencia) ─────────────────────────

const IconDownload = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></svg>
);
const IconReel = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="6" width="14" height="12" rx="1.5" /><path d="m21 8-4 3v2l4 3z" /></svg>
);
const IconStack = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3 9 5-9 5-9-5z" /><path d="m3 13 9 5 9-5" /><path d="m3 18 9 5 9-5" /></svg>
);
const IconShield = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 4 6v5c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V6z" /></svg>
);
const IconRefresh = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 1-15.4 6.4L3 16" /><path d="M3 12a9 9 0 0 1 15.4-6.4L21 8" /><path d="M21 3v5h-5" /><path d="M3 21v-5h5" /></svg>
);
const IconPause = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
);
const IconBug = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="8" y="6" width="8" height="14" rx="4" /><path d="M9 12H3M21 12h-6M9 8.5l-3-3M18 5.5l-3 3M9 15.5l-3 3M18 18.5l-3-3" /></svg>
);
const IconX = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m6 6 12 12M18 6 6 18" /></svg>
);
const IconCheck = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 13 4 4L19 7" /></svg>
);
const IconAlert = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.73 3h16.9a2 2 0 0 0 1.73-3L13.7 3.86a2 2 0 0 0-3.4 0Z" /></svg>
);
const IconClock = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
);
const IconDoc = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6" />
    <path d="M9 13h6M9 17h6M9 9h2" />
  </svg>
);

/** Icone Google Docs — folha de papel azul com text lines.
 *  Estilo recognizable do Google Docs (azul Google + branco). */
const IconGDocs = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
    {/* Corpo do doc (azul Google #1a73e8) */}
    <path
      d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
      fill="#1a73e8"
    />
    {/* Dobra do canto (azul mais claro) */}
    <path d="M14 2v6h6L14 2z" fill="#a1c2fa" />
    {/* Linhas de texto (branco) */}
    <path
      d="M8 12h8M8 15h8M8 18h5"
      stroke="white"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
  </svg>
);
const IconChevron = ({ size = 14, open }: { size?: number; open?: boolean }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
    style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 200ms ease-out' }}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);
const IconRebuild = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    {/* Hammer-like icon — re-montar */}
    <path d="m15 12-8 8a2.83 2.83 0 1 1-4-4l8-8" />
    <path d="m17.5 6.5 4 4-2 2-4-4z" />
    <path d="m13.5 10.5 4 4" />
  </svg>
);

// ───────────────────────── Phase mapping (human copy + cores) ─────────────────────────

const PHASE_MAP: Record<BatchJob3DPhase, { label: string; icon: React.ReactNode; tone: 'idle' | 'progress' | 'success' | 'error' | 'warn'; barFrom: string; barTo: string }> = {
  queued: { label: 'Na fila', icon: <IconClock size={12} />, tone: 'idle', barFrom: 'from-white/20', barTo: 'to-white/40' },
  dispatching: { label: 'Enviando', icon: <IconClock size={12} />, tone: 'progress', barFrom: 'from-fuchsia-400', barTo: 'to-fuchsia-300' },
  rendering: { label: 'Renderizando', icon: <IconClock size={12} />, tone: 'progress', barFrom: 'from-cyan-400', barTo: 'to-cyan-200' },
  downloading: { label: 'Baixando', icon: <IconDownload size={12} />, tone: 'progress', barFrom: 'from-cyan-300', barTo: 'to-lime' },
  post: { label: 'Montando', icon: <IconStack size={12} />, tone: 'progress', barFrom: 'from-lime/80', barTo: 'to-lime' },
  done: { label: 'Pronto', icon: <IconCheck size={12} />, tone: 'success', barFrom: 'from-lime/80', barTo: 'to-lime' },
  failed: { label: 'Falhou', icon: <IconAlert size={12} />, tone: 'error', barFrom: 'from-rose-400', barTo: 'to-rose-300' },
};

// ───────────────────────── Helpers ─────────────────────────

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  if (m === 0) return `${s}s`;
  return `${m}m${String(s % 60).padStart(2, '0')}s`;
}

/**
 * Filtra mensagens tecnicas em algo humano. Se a mensagem tiver gírias
 * tecnicas, troca por uma frase amigavel baseada na fase.
 */
function humanizeMessage(raw: string | undefined, phase: BatchJob3DPhase): string | null {
  if (!raw) return null;
  const t = raw.trim();
  if (!t) return null;
  const lower = t.toLowerCase();
  // Lista de "lixos tecnicos" que viram null (mostramos so a frase de fase)
  const techNoise = [
    'tts +', 'upload +', 'submit', 'pollvideos', 'fetchplaintext',
    'jsoncall', 'jsdom', 'curl', 'xsrf', 'tlsv', 'cdp', 'webdriver',
    'cloudflare', 'turnstile', 'magnific_cap', 'extension', 'bridge',
    '_NAO_', 'hidratando', 'hidratacao', 'idb', 'indexeddb',
  ];
  if (techNoise.some((n) => lower.includes(n.toLowerCase()))) {
    return PHASE_MAP[phase].label;
  }
  // Frases curtas (<= 80 chars) passam direto
  if (t.length <= 80) return t;
  // Frases longas: corta + ellipsis
  return t.slice(0, 76).trim() + '…';
}

// ───────────────────────── Componente principal ─────────────────────────

export function BatchJobCard3D(props: BatchJob3DProps) {
  const {
    taskName,
    phase,
    partsTotal,
    partsDispatched,
    partsRendered,
    message,
    elapsedMs,
    allOk,
    isPartialDone,
    takesUrl,
    takesFilename,
    montadoUrl,
    montadoFilename,
    camufladoUrl,
    camufladoFilename,
    onRetomar,
    onPausar,
    onDebug,
    onRemove,
    isRunning,
    isQueued,
    children,
    dirtyPartsCount = 0,
    onRebuild,
    isRebuilding = false,
    docUrl,
    taskUrl,
    resolveDocUrl,
    defaultMinimized = true,
  } = props;

  const [tilt, setTilt] = useState<{ x: number; y: number } | null>(null);
  const [expanded, setExpanded] = useState(!defaultMinimized);
  const [resolvingDoc, setResolvingDoc] = useState(false);

  const phaseInfo = PHASE_MAP[phase];
  // Override pra parcial
  const showAsWarn = isPartialDone;
  const effectiveLabel = showAsWarn ? 'Incompleto — clica Retomar' : phaseInfo.label;
  const ringColor =
    showAsWarn ? 'border-amber-400/35'
    : phase === 'done' ? 'border-lime/35'
    : phase === 'failed' ? 'border-rose-400/35'
    : isRunning ? 'border-fuchsia-400/30'
    : 'border-white/8';
  const bgGradient =
    showAsWarn ? 'from-amber-400/[0.07] via-amber-400/[0.02] to-transparent'
    : phase === 'done' ? 'from-lime/[0.07] via-lime/[0.02] to-transparent'
    : phase === 'failed' ? 'from-rose-500/[0.07] via-rose-500/[0.02] to-transparent'
    : isRunning ? 'from-fuchsia-500/[0.07] via-fuchsia-500/[0.02] to-transparent'
    : 'from-white/[0.04] to-transparent';

  // Progress bar — 30% dispatch, 60% render, 10% download/post
  const dispatchPct = partsTotal > 0 ? partsDispatched / partsTotal : 0;
  const renderPct = partsDispatched > 0 ? partsRendered / partsDispatched : 0;
  const tail = phase === 'done' ? 1 : phase === 'downloading' || phase === 'post' ? 0.5 : 0;
  const totalPct = phase === 'done' ? 100 : Math.round(dispatchPct * 30 + renderPct * 60 + tail * 10);
  const barPct = Math.min(100, Math.max(3, totalPct));

  function onMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    // Range pequeno (~1.5deg) — sutil, nao desorienta
    setTilt({ x: (py - 0.5) * -1.5, y: (px - 0.5) * 1.5 });
  }
  function onMouseLeave() {
    setTilt(null);
  }

  const transform = tilt
    ? `perspective(1200px) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg) translateZ(0)`
    : 'perspective(1200px) rotateX(0) rotateY(0) translateZ(0)';

  const friendlyMsg = humanizeMessage(message, phase);
  const showProgress = phase !== 'done' && phase !== 'failed';

  return (
    <li className="list-none">
      <div
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
        style={{ transform, transition: tilt ? 'transform 60ms ease-out' : 'transform 240ms ease-out' }}
        className={`relative overflow-hidden rounded-[16px] border ${ringColor} bg-gradient-to-br ${bgGradient} bg-bg-soft/40 p-3.5 backdrop-blur-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_8px_28px_-12px_rgba(0,0,0,0.5)]`}
      >
        {/* Specular highlight (top-left) */}
        <span
          className="pointer-events-none absolute -inset-px rounded-[16px] bg-gradient-to-br from-white/[0.07] via-transparent to-transparent opacity-80"
          aria-hidden
        />
        {/* Conteúdo */}
        <div className="relative">
          {/* Header — nome + fase pill + elapsed + botoes 3D */}
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex min-w-0 flex-1 items-center gap-2.5">
              <PhasePill label={effectiveLabel} tone={showAsWarn ? 'warn' : phaseInfo.tone} icon={phaseInfo.icon} pulsing={isRunning} />
              <h3 className="mono truncate text-[12px] font-semibold text-white">{taskName}</h3>
              <span className="mono inline-flex items-center gap-1 text-[10px] text-text-muted">
                <IconClock size={10} />
                {formatElapsed(elapsedMs)}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {/* BOTAO GOOGLE DOCS — vai direto pro Google Doc da copy.
               *  Fluxo:
               *  1. Se docUrl ja conhecido → anchor abre nova aba (instant).
               *  2. Se nao → button onClick chama resolveDocUrl (lazy fetch
               *     pelo parent: getTask → custom field "DOC DA COPY") +
               *     window.open. Spinner durante fetch.
               *  3. Se resolveDocUrl ausente E sem docUrl → desabilita
               *     (impossivel resolver sem fetcher).
               *  Sempre visivel. Icone = Google Docs (azul + branco). */}
              {(() => {
                const tooltip = docUrl
                  ? 'Abrir doc da copy (Google Docs)'
                  : resolvingDoc
                  ? 'Buscando link do doc…'
                  : 'Buscar e abrir doc da copy';
                const canResolve = !!docUrl || !!resolveDocUrl;
                if (!canResolve) return null;
                const baseClass = 'group/btn3d relative inline-flex h-9 w-9 items-center justify-center rounded-full border border-cyan-400/45 bg-gradient-to-b from-cyan-400/18 via-cyan-400/8 to-transparent shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_3px_10px_-3px_rgba(34,211,238,0.4)] hover:-translate-y-0.5 hover:scale-[1.08] hover:border-cyan-400/70 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_12px_24px_-6px_rgba(34,211,238,0.6)] active:translate-y-0 active:scale-95 transition-[transform,box-shadow] disabled:opacity-50 disabled:cursor-wait disabled:hover:translate-y-0 disabled:hover:scale-100';
                if (docUrl) {
                  // Caso comum: docUrl conhecido → anchor (zero delay).
                  return (
                    <a
                      href={docUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={baseClass}
                      title={tooltip}
                      aria-label={tooltip}
                    >
                      <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 rounded-t-full bg-gradient-to-b from-white/25 to-transparent" aria-hidden />
                      <span className="relative"><IconGDocs size={18} /></span>
                    </a>
                  );
                }
                // Caso fallback: docUrl missing → lazy fetch on click.
                const handleClick = async () => {
                  if (resolvingDoc || !resolveDocUrl) return;
                  setResolvingDoc(true);
                  try {
                    const url = await resolveDocUrl();
                    if (url) {
                      window.open(url, '_blank', 'noopener,noreferrer');
                    } else {
                      // Sem doc capturavel — fallback final pro ClickUp
                      const fallback = taskUrl || `https://app.clickup.com/t/${props.taskId}`;
                      window.open(fallback, '_blank', 'noopener,noreferrer');
                    }
                  } catch (e) {
                    console.warn('[batch card] resolveDocUrl falhou:', e);
                    const fallback = taskUrl || `https://app.clickup.com/t/${props.taskId}`;
                    window.open(fallback, '_blank', 'noopener,noreferrer');
                  } finally {
                    setResolvingDoc(false);
                  }
                };
                return (
                  <button
                    type="button"
                    onClick={handleClick}
                    disabled={resolvingDoc}
                    className={baseClass}
                    title={tooltip}
                    aria-label={tooltip}
                  >
                    <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 rounded-t-full bg-gradient-to-b from-white/25 to-transparent" aria-hidden />
                    <span className="relative">
                      {resolvingDoc ? (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" className="animate-spin text-cyan-200" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 12a9 9 0 0 1-15.4 6.4L3 16" />
                          <path d="M3 12a9 9 0 0 1 15.4-6.4L21 8" />
                          <path d="M21 3v5h-5" /><path d="M3 21v-5h5" />
                        </svg>
                      ) : (
                        <IconGDocs size={18} />
                      )}
                    </span>
                  </button>
                );
              })()}
              {/* DOWNLOAD UNICO — baixa tudo o que existe (takes + montados +
               *  camuflados se houver) num clique so. Browser enfileira os
               *  downloads automaticamente. Pequeno delay entre cada disparo
               *  evita bloqueio do Chrome (multiple downloads warning). */}
              {/* ATUALIZAR MONTAGEM — aparece quando algum take foi re-gerado
               *  via EditPartModal e os ZIPs estao desatualizados. Click roda
               *  runPostPipeline com os blobs novos. */}
              {dirtyPartsCount > 0 && onRebuild && phase === 'done' ? (
                <Btn3D
                  icon={isRebuilding ? (
                    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="animate-spin" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 12a9 9 0 0 1-15.4 6.4L3 16" />
                      <path d="M3 12a9 9 0 0 1 15.4-6.4L21 8" />
                      <path d="M21 3v5h-5" /><path d="M3 21v-5h5" />
                    </svg>
                  ) : <IconRebuild size={16} />}
                  color="amber"
                  title={isRebuilding
                    ? 'Re-montando…'
                    : `Atualizar montagem (${dirtyPartsCount} parte${dirtyPartsCount === 1 ? '' : 's'} mudou)`}
                  onClick={onRebuild}
                  disabled={isRebuilding}
                  pulse={!isRebuilding}
                />
              ) : null}
              {(takesUrl || montadoUrl || camufladoUrl) ? (() => {
                const downloads = [
                  takesUrl ? { url: takesUrl, name: takesFilename } : null,
                  montadoUrl ? { url: montadoUrl, name: montadoFilename } : null,
                  camufladoUrl ? { url: camufladoUrl, name: camufladoFilename } : null,
                ].filter(Boolean) as Array<{ url: string; name?: string }>;
                const total = downloads.length;
                const handleDownloadAll = () => {
                  downloads.forEach((d, i) => {
                    setTimeout(() => {
                      const a = document.createElement('a');
                      a.href = d.url;
                      if (d.name) a.download = d.name;
                      a.rel = 'noopener';
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                    }, i * 220); // 220ms entre disparos = Chrome aceita sem prompt
                  });
                };
                const tooltip = isPartialDone
                  ? `Baixar tudo (parcial · ${total} arquivo${total === 1 ? '' : 's'})`
                  : total === 1
                    ? 'Baixar'
                    : `Baixar tudo (${total} arquivos)`;
                return (
                  <Btn3D
                    icon={<IconDownload size={16} />}
                    color="lime"
                    title={tooltip}
                    onClick={handleDownloadAll}
                  />
                );
              })() : null}
              <Btn3D
                icon={<IconRefresh size={16} />}
                color="cyan"
                title="Retomar"
                onClick={onRetomar}
                disabled={isRunning || isQueued}
              />
              <Btn3D
                icon={<IconPause size={14} />}
                color="amber"
                title="Pausar"
                onClick={onPausar}
                disabled={!isRunning}
                pulse={isRunning}
              />
              <Btn3D
                icon={<IconBug size={16} />}
                color="fuchsia"
                title="Reiniciar do zero"
                onClick={onDebug}
                disabled={isQueued}
              />
              {!isRunning ? (
                <Btn3D icon={<IconX size={14} />} color="neutral" title="Remover" onClick={onRemove} />
              ) : null}
              {/* TOGGLE EXPAND/COLLAPSE — chevron com contraste forte (visivel
               *  tanto em dark quanto light mode). Usa fuchsia como cor
               *  primaria pra integrar com o tema do painel + garantir que
               *  o icone fica sempre legivel. */}
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="group/btn3d relative inline-flex h-9 w-9 items-center justify-center rounded-full border border-fuchsia-400/45 bg-gradient-to-b from-fuchsia-400/20 via-fuchsia-400/8 to-transparent text-fuchsia-200 dark:text-fuchsia-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_3px_10px_-3px_rgba(217,70,239,0.35)] hover:-translate-y-0.5 hover:scale-[1.08] hover:border-fuchsia-400/65 hover:text-white hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_12px_24px_-6px_rgba(217,70,239,0.6)] active:translate-y-0 active:scale-95 transition-[transform,box-shadow]"
                style={{ color: 'currentColor' }}
                title={expanded ? 'Recolher' : 'Expandir takes'}
                aria-label={expanded ? 'Recolher' : 'Expandir'}
                aria-expanded={expanded}
              >
                <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 rounded-t-full bg-gradient-to-b from-white/25 to-transparent" aria-hidden />
                <span className="relative text-fuchsia-700 dark:text-fuchsia-100"><IconChevron size={14} open={expanded} /></span>
              </button>
            </div>
          </div>

          {/* Stats line — humanizada. So aparece quando expandido. */}
          {expanded ? (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-text-muted">
              <StatPill value={partsTotal} label="cortes" />
              <StatPill value={partsDispatched} label="enviados" highlight={phase === 'dispatching'} />
              <StatPill value={partsRendered} label="prontos" highlight={phase === 'rendering'} accent={partsRendered === partsTotal ? 'lime' : undefined} />
            </div>
          ) : null}

          {/* Progress bar 3D animada — SEMPRE visivel se rodando (mesmo minimizado).
           *  User pediu: "se ta minimizada e gerando entao voce ver apenas a
           *  barrinha de carregamento animada carregando o processo". */}
          {showProgress ? (
            <div className="mt-2.5">
              <div className="relative h-[6px] w-full overflow-hidden rounded-full bg-white/[0.05] shadow-[inset_0_1px_2px_rgba(0,0,0,0.5)]">
                <div
                  className={`absolute inset-y-0 left-0 rounded-full bg-gradient-to-r ${phaseInfo.barFrom} ${phaseInfo.barTo} transition-[width] duration-500 ease-out`}
                  style={{ width: `${barPct}%` }}
                >
                  {/* Shimmer */}
                  <span className="absolute inset-0 overflow-hidden rounded-full">
                    <span className="absolute inset-y-0 -left-1/2 h-full w-1/2 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-[shimmer_2.4s_ease-in-out_infinite]" />
                  </span>
                </div>
              </div>
              {expanded ? (
                <div className="mt-1 flex items-center justify-between text-[9px] text-text-muted/80">
                  <span>{friendlyMsg || phaseInfo.label}</span>
                  <span className="mono">{barPct}%</span>
                </div>
              ) : null}
            </div>
          ) : expanded && friendlyMsg ? (
            <div className="mono mt-1.5 text-[10px] text-text-muted">{friendlyMsg}</div>
          ) : null}

          {/* Preview takes — so renderiza children se expandido */}
          {expanded && children ? <div className="mt-3">{children}</div> : null}
        </div>
      </div>

      {/* Keyframes injetados localmente (Tailwind nao tem shimmer pronto) */}
      <style jsx>{`
        @keyframes shimmer {
          0% { transform: translateX(0); }
          100% { transform: translateX(400%); }
        }
      `}</style>
    </li>
  );
}

// ───────────────────────── Pill helpers ─────────────────────────

function PhasePill({
  label,
  tone,
  icon,
  pulsing,
}: {
  label: string;
  tone: 'idle' | 'progress' | 'success' | 'error' | 'warn';
  icon: React.ReactNode;
  pulsing?: boolean;
}) {
  const toneClasses: Record<typeof tone, string> = {
    idle: 'border-white/15 bg-white/[0.05] text-text-muted',
    progress: 'border-fuchsia-400/40 bg-fuchsia-400/15 text-fuchsia-100',
    success: 'border-lime/45 bg-lime/15 text-lime',
    error: 'border-rose-400/45 bg-rose-400/15 text-rose-200',
    warn: 'border-amber-400/45 bg-amber-400/15 text-amber-100',
  };
  return (
    <span
      className={`mono relative inline-flex items-center gap-1 rounded-full border px-2 py-[3px] text-[9.5px] font-semibold uppercase tracking-widest ${toneClasses[tone]} shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]`}
    >
      {pulsing && tone === 'progress' ? (
        <span className="absolute inset-0 rounded-full border border-current/30 animate-ping opacity-40" aria-hidden />
      ) : null}
      <span className="relative flex items-center gap-1">
        {icon}
        {label}
      </span>
    </span>
  );
}

function StatPill({
  value,
  label,
  highlight,
  accent,
}: {
  value: number;
  label: string;
  highlight?: boolean;
  accent?: 'lime' | 'cyan' | 'fuchsia';
}) {
  const accentMap = {
    lime: 'text-lime',
    cyan: 'text-cyan-200',
    fuchsia: 'text-fuchsia-200',
  } as const;
  return (
    <span className={`mono inline-flex items-baseline gap-1 ${highlight ? 'text-white' : ''}`}>
      <strong className={`text-[12px] font-semibold ${accent ? accentMap[accent] : 'text-white/90'}`}>{value}</strong>
      <span className="text-[9.5px] uppercase tracking-widest text-text-muted">{label}</span>
    </span>
  );
}
