'use client';

import React, { useEffect, useState } from 'react';
import { toFriendlyMessage } from '@/lib/friendly-error';

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
  /** Takes ainda RENDERIZANDO no HeyGen (plataforma lenta). Não é falha e não
   *  re-dispara nada — o watcher fecha sozinho. Ver [[heygen-health]]. */
  | 'waiting-heygen'
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
  /** Trava o download do MP4 final: a entrega NÃO está 100% (falta parte/
   *  texto, render incompleto, etc). Garante que o user nunca baixe uma
   *  versão zoada — tem que clicar Retomar pra completar primeiro. */
  downloadBlocked?: boolean;
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
  /** Download custom (opcional): quando presente, o botao de download chama
   *  ISSO em vez do fluxo baseado em montadoUrl/camufladoUrl. Usado pelo Hey
   *  Auto (dispensa direta), que dispara o pipeline+download on-click em vez
   *  de ter um blob URL pronto. O ClickUp Pilot nao passa — segue por URL. */
  onDownload?: () => void;
  /** GARANTIA DE ENTREGA (fix 2026-07-03): as URLs blob (montadoUrl/camufladoUrl)
   *  são EFÊMERAS — o persist as descarta e o reload precisa re-hidratá-las do
   *  IndexedDB. Se essa re-hidratação falha/timeouta (IDB travado por outra aba),
   *  a task fica PRONTA (montadoFilename sobrevive) mas SEM URL → o botão de
   *  download SUMIA (bug AD44GL: card verde, zero botão de baixar). Este loader
   *  lê os ZIPs direto do IDB por taskId SOB DEMANDA no clique — a entrega NUNCA
   *  depende de a URL viva ter sobrevivido. Retorna as fontes (montado + camo)
   *  já com URLs frescas; [] só se o disco estiver realmente vazio. O parent
   *  passa isto sempre que a task tem entrega (nome persistido ou URL viva). */
  loadDeliverables?: () => Promise<Array<{ url: string; name?: string; revoke?: boolean }>>;
  /** Status flags pra disabled */
  isRunning: boolean;
  isQueued: boolean;
  /** Quando a task em 'queued' tem um driver próprio de recuperação (ex TROCA, que
   *  NÃO é dirigida pelo promoter): libera Retomar/Debug mesmo em 'queued' pra ela
   *  nunca ficar sem botão útil se o loop serial morrer. Default false → NORMAL/VA
   *  (dirigidas pelo promoter) seguem com Retomar/Debug travados em 'queued'. */
  queuedRecoverable?: boolean;
  /** Children: preview grid abaixo do card (renderizado fora pra nao limitar layout) */
  children?: React.ReactNode;
  /** Painel que abre DENTRO do card, ACIMA dos previews — hoje é o de
   *  reiniciar o disparo (reorganizar avatar/voz/texto antes de gerar de
   *  novo). Diferente de `children`, aparece mesmo com o card minimizado: o
   *  user clicou pra editar ESTA task, então não pode depender de lembrar de
   *  expandir. Enquanto ele existe, o card abre sozinho. */
  /** SELOS do que foi aplicado neste vídeo (31.08): decupagem, legenda, zoom.
   *  Ícone puro, sem texto — o `title` conta a história no hover. */
  selos?: Array<{ tipo: 'normalizador' | 'decupagem' | 'legenda' | 'zoom' | 'insert' | 'headline'; title: string }>;
  topPanel?: React.ReactNode;
  /** Quando >0, mostra botao "Atualizar montagem" (parts foram re-geradas
   *  via EditPartModal e o ZIP montado/camuflado ficou desatualizado). */
  dirtyPartsCount?: number;
  /** Takes AINDA renderizando. Enquanto >0 o card NAO pode dizer "Pronto":
   *  Silas, 23.08 — *"nao deveria jamais mostrar pronto se tem algo carregando
   *  ainda"*. O selo vira ambar com a contagem e o download trava. */
  takesPendentes?: number;
  /** Takes cujo AVATAR/VOZ/MOTOR no plano ja' nao e' o que gerou o video.
   *  Trocar o look no plano nao re-gera nada — sem este aviso o card ficava
   *  verde sobre um AD inteiro com o avatar velho (AD06, 23.08). */
  takesForaDoPlano?: number;
  /** Ultima barreira antes de entregar o arquivo: devolve uma mensagem quando o
   *  montado no disco NAO corresponde aos takes de agora, ou null quando bate.
   *
   *  Os avisos do card dependem do state, e o state pode se perder (aba nova,
   *  storage limpo) enquanto o arquivo continua no disco. Esta checagem le a
   *  assinatura gravada AO LADO do arquivo — se o montado e' velho, o download
   *  nao acontece. Silas, 23.08: *"mostrando pronto ali mas se eu clico em
   *  download baixa versao antiga. ISSO JAMAIS DEVE ACONTECER"*. */
  conferirEntrega?: () => Promise<string | null>;
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
  /** Pasta do Drive (output). Quando presente, mostra um botao "abrir pasta"
   *  no lugar do botao de Docs (usado pela TROCA DE ÁUDIO, que nao tem doc). */
  folderUrl?: string;
  /** Default minimizado (so header + buttons + progress). Default true. */
  defaultMinimized?: boolean;
  /** Acoes extras renderizadas na barra de botoes do header (ex: VA mostra
   *  "baixar AD original"). Drop-in — fica antes do toggle expand. */
  extraActions?: React.ReactNode;
  /** CANAL(is) de distribuicao (KWAI/META/YT/TIKTOK...) — chips coloridos ao
   *  lado do nome da task, pra bater de olho quem e YouTube/Meta/Kwai na fila. */
  channels?: Array<{ label: string; color: string }>;
};

/** Contraste de texto pra chip de canal (mesma regra do board no pilot). */
function chipTextColor(hex: string): string {
  const h = (hex || '').replace('#', '');
  if (h.length < 6) return '#fff';
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? '#1a1a1a' : '#fff';
}

// ───────────────────────── Botão 3D icon-only ─────────────────────────

type Btn3DColor = 'lime' | 'cyan' | 'fuchsia' | 'violet' | 'amber' | 'rose' | 'neutral';

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
  // ROXO do site (#a78bfa) — é o estado "painel de reinício aberto" deste card.
  violet: {
    ring: 'border-violet-400/60',
    bg: 'from-violet-400/28 via-violet-400/12 to-violet-400/[0.03]',
    text: 'text-violet-100',
    glow: 'shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_3px_10px_-3px_rgba(167,139,250,0.5)]',
    hoverGlow: 'hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_12px_26px_-6px_rgba(167,139,250,0.75)]',
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
const IconFolder = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
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
  'waiting-heygen': { label: 'Aguardando HeyGen', icon: <IconClock size={12} />, tone: 'warn', barFrom: 'from-amber-400', barTo: 'to-amber-200' },
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

const IconHourglass = ({ size = 13 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 2h12M6 22h12" />
    <path d="M7 2c0 6 5 6 5 10s-5 4-5 10" />
    <path d="M17 2c0 6-5 6-5 10s5 4 5 10" />
  </svg>
);

type MsgBanner = { kind: 'quota' | 'wait' | 'fail'; title: string; hint?: string };

/** Mensagem ESPECIAL com visual próprio (banner no card): limite diário do
 *  HeyGen (âmbar, ⏳) e falha (rosa). SEMPRE curta e sem termo técnico — user
 *  pediu (13/07): "mensagem resumida e clara, sem nada técnico, design bonito".
 *  O erro cru continua no console/estado pra diagnóstico; aqui vai só o que o
 *  user precisa saber e fazer. Mensagens já escritas à mão em PT passam
 *  intactas; texto cru/técnico é traduzido pelo toFriendlyMessage. */
function classifyBanner(raw: string | undefined, phase: BatchJob3DPhase): MsgBanner | null {
  const t = (raw || '').trim();
  const lower = t.toLowerCase();
  // LIMITE DIÁRIO — banner âmbar em qualquer fase (failed, done-incompleto…).
  if (/limite di[aá]rio|cota esgotada|cota di[aá]ria|maximum daily|daily limit|daily quota|usage has exceeded|exceeded the maximum/.test(lower)) {
    return {
      kind: 'quota',
      title: 'Limite diário do HeyGen atingido',
      hint: 'Renova em até 24h — depois clica em Retomar (⟳) que eu continuo sozinho. Não é erro do app.',
    };
  }
  // ESPERANDO O HEYGEN — âmbar, nunca vermelho. O take está VIVO renderizando
  // lá; re-disparar duplicaria gasto de cota, então o sistema só espera. Ver
  // [[heygen-health]].
  if (phase === 'waiting-heygen') {
    return {
      kind: 'wait',
      title: 'O HeyGen ainda está renderizando esses takes',
      hint: 'Não é falha e não re-gerei nada (economiza cota). Eu re-checo sozinho e fecho a montagem assim que ficarem prontos.',
    };
  }
  if (phase !== 'failed') return null;
  if (!t) return { kind: 'fail', title: 'Não deu pra concluir agora.', hint: 'Clica em Retomar (⟳) que eu tento de novo.' };
  // Texto com cara de erro CRU (inglês/código/status) → traduz. Frase humana
  // escrita à mão (ex: "Recarregou a página — clique Retomar") → mantém.
  const technical = /createvideo|tts_pending|processjob|jsoncall|status[ =]\d|status=\w+|\bapi \d|https?:|\bfetch\b|exception|[a-z]error\b|\bundefined\b|falharam:|your video|please try again/i.test(t);
  if (!technical) {
    return { kind: 'fail', title: t.length > 170 ? t.slice(0, 166).trim() + '…' : t };
  }
  return {
    kind: 'fail',
    title: toFriendlyMessage(t, 'Não deu pra concluir agora.'),
    hint: 'Clica em Retomar (⟳) — o que já ficou pronto está salvo.',
  };
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
    downloadBlocked,
    takesUrl,
    takesFilename,
    montadoUrl,
    montadoFilename,
    camufladoUrl,
    camufladoFilename,
    loadDeliverables,
    onRetomar,
    onPausar,
    onDebug,
    onRemove,
    onDownload,
    isRunning,
    isQueued,
    queuedRecoverable = false,
    children,
    dirtyPartsCount = 0,
    takesPendentes = 0,
    takesForaDoPlano = 0,
    conferirEntrega,
    onRebuild,
    isRebuilding = false,
    docUrl,
    taskUrl,
    resolveDocUrl,
    folderUrl,
    defaultMinimized = true,
    extraActions,
    channels,
    selos,
    topPanel,
  } = props;

  const [tilt, setTilt] = useState<{ x: number; y: number } | null>(null);
  const [expanded, setExpanded] = useState(!defaultMinimized);
  const [resolvingDoc, setResolvingDoc] = useState(false);

  // Painel aberto (ex: reiniciar disparo) => card ABRE sozinho. Sem isto, quem
  // clicasse em "editar antes de reiniciar" num card minimizado veria só o
  // painel espremido, sem os takes que ele quer conferir do lado.
  const temTopPanel = !!topPanel;
  useEffect(() => {
    if (temTopPanel) setExpanded(true);
  }, [temTopPanel]);

  const phaseInfo = PHASE_MAP[phase];
  // Override pra parcial. Distingue:
  //  - downloadBlocked → FALTA conteúdo (parte/texto): tem que Retomar, download travado.
  //  - isPartialDone só (sem block) → montado completo mas um pós-processo
  //    opcional (decupagem/camuflagem) falhou: é entregável, download liberado.
  //  - montagemVelha → os takes mudaram DEPOIS de montar. O arquivo montado
  //    existe, mas e' o de ANTES da correcao. Dizer "Pronto" aqui engana: quem
  //    olha o card baixa e leva o video sem as correcoes. (Silas, 23.08.)
  const montagemVelha = dirtyPartsCount > 0 && phase === 'done';
  //  - renderizando → tem take em pé (pending/processing) num card que se diz
  //    'done'. Acontece quando um take e' re-gerado depois do fim do run: o
  //    batch ja' esta 'done' e o take volta pra fila. Dizer "Pronto" aqui e' a
  //    mesma mentira da montagem velha, com o agravante de o video nem existir.
  const renderizando = takesPendentes > 0 && phase === 'done';
  //  - foraDoPlano → o plano do AD mudou (avatar/voz/motor) e o take nao foi
  //    re-gerado com ele. E' a mentira mais silenciosa das tres: nada no fluxo
  //    normal acusa, e o video sai com o avatar antigo parecendo certo.
  const foraDoPlano = takesForaDoPlano > 0 && phase === 'done';
  const showAsWarn = isPartialDone || montagemVelha || renderizando || foraDoPlano;
  const effectiveLabel = downloadBlocked
    ? 'Incompleto — clica Retomar'
    : renderizando
      ? `Renderizando ${takesPendentes} take${takesPendentes === 1 ? '' : 's'} — ainda não`
      : foraDoPlano
        ? `Plano mudou — ${takesForaDoPlano} take${takesForaDoPlano === 1 ? '' : 's'} precisa re-gerar`
      : montagemVelha
        ? `Montagem desatualizada — ${dirtyPartsCount} take${dirtyPartsCount === 1 ? '' : 's'} mudou`
        : isPartialDone
          ? 'Pronto · pós-processo parcial'
          : phaseInfo.label;
  const ringColor =
    showAsWarn ? 'border-amber-400/35'
    : phase === 'done' ? 'border-lime/35'
    : phase === 'failed' ? 'border-rose-400/35'
    // Esperar o HeyGen é aviso âmbar, nunca o vermelho de falha.
    : phase === 'waiting-heygen' ? 'border-amber-400/35'
    : isRunning ? 'border-fuchsia-400/30'
    : 'border-white/8';
  const bgGradient =
    showAsWarn ? 'from-amber-400/[0.07] via-amber-400/[0.02] to-transparent'
    : phase === 'done' ? 'from-lime/[0.07] via-lime/[0.02] to-transparent'
    : phase === 'failed' ? 'from-rose-500/[0.07] via-rose-500/[0.02] to-transparent'
    : phase === 'waiting-heygen' ? 'from-amber-400/[0.07] via-amber-400/[0.02] to-transparent'
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
  // Banner especial (limite diário / falha): curto, sem termo técnico, sempre
  // visível (mesmo com o card recolhido) — substitui o texto miúdo nesses casos.
  const banner = classifyBanner(message, phase);
  const showProgress = phase !== 'done' && phase !== 'failed';

  return (
    <li className="list-none" id={`batch-card-${props.taskId}`}>
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
              <h3
                className="truncate text-[13px] font-semibold text-white"
                style={{ fontFamily: 'var(--font-tech)', letterSpacing: '-0.015em' }}
              >
                {taskName}
              </h3>
              {channels && channels.length > 0 ? (
                <span className="flex shrink-0 flex-wrap items-center gap-1">
                  {channels.map((ch, i) => (
                    <span
                      key={`${ch.label}-${i}`}
                      className="mono inline-flex items-center rounded-full px-1.5 py-0.5 text-[8.5px] font-bold uppercase tracking-wider"
                      style={{ backgroundColor: ch.color, color: chipTextColor(ch.color) }}
                      title={`Canal: ${ch.label}`}
                    >
                      {ch.label}
                    </span>
                  ))}
                </span>
              ) : null}
              {selos && selos.length > 0 ? (
                <span className="flex shrink-0 items-center gap-1">
                  {selos.map((sl) => (
                    <span key={sl.tipo} className={`selo-aplicado is-${sl.tipo}`} title={sl.title}>
                      {sl.tipo === 'normalizador' ? (
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" />
                          <line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" />
                          <line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" />
                          <line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" />
                        </svg>
                      ) : sl.tipo === 'decupagem' ? (
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" />
                          <line x1="20" y1="4" x2="8.12" y2="15.88" />
                          <line x1="14.47" y1="14.48" x2="20" y2="20" />
                          <line x1="8.12" y1="8.12" x2="12" y2="12" />
                        </svg>
                      ) : sl.tipo === 'legenda' ? (
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <rect x="3" y="5" width="18" height="14" rx="2" />
                          <path d="M7 14h4M14 14h3" />
                        </svg>
                      ) : sl.tipo === 'zoom' ? (
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d="M3 8V5.5A1.5 1.5 0 0 1 4.5 4H8M16 4h3.5A1.5 1.5 0 0 1 21 5.5V8M21 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H4.5A1.5 1.5 0 0 1 3 18.5V16" />
                          <circle cx="12" cy="12" r="2.6" />
                        </svg>
                      ) : sl.tipo === 'insert' ? (
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <rect x="2" y="5" width="13" height="11" rx="2" />
                          <path d="M22 9v9a2 2 0 0 1-2 2H8" opacity="0.55" />
                        </svg>
                      ) : (
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d="M4 7h16" strokeWidth="3.4" />
                          <path d="M4 13h11M4 18h7" strokeWidth="2.2" opacity="0.75" />
                        </svg>
                      )}
                    </span>
                  ))}
                </span>
              ) : null}
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
                // TROCA DE ÁUDIO: sem doc — botao leva pra PASTA de output no Drive.
                if (folderUrl) {
                  const fClass = 'group/btn3d relative inline-flex h-9 w-9 items-center justify-center rounded-full border border-cyan-400/45 bg-gradient-to-b from-cyan-400/18 via-cyan-400/8 to-transparent text-cyan-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_3px_10px_-3px_rgba(34,211,238,0.4)] hover:-translate-y-0.5 hover:scale-[1.08] hover:border-cyan-400/70 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_12px_24px_-6px_rgba(34,211,238,0.6)] active:translate-y-0 active:scale-95 transition-[transform,box-shadow]';
                  return (
                    <a
                      href={folderUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={fClass}
                      title="Abrir a pasta do criativo no Drive (onde fica o AD original e o output)"
                      aria-label="Abrir pasta no Drive"
                    >
                      <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 rounded-t-full bg-gradient-to-b from-white/25 to-transparent" aria-hidden />
                      <span className="relative"><IconFolder size={18} /></span>
                    </a>
                  );
                }
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
              {(montadoUrl || camufladoUrl || onDownload || loadDeliverables) ? (() => {
                // DOWNLOAD = so o(s) MP4 final(is). Entrega o montado/decupado e,
                // se houver, o camuflado — SEMPRE como .mp4 solto. Nunca o
                // takes.zip, nunca .zip. Fontes que ja sao .mp4 (TROCA) baixam
                // direto; fontes .zip (lipsync/VA) tem os .mp4 extraidos de dentro.
                const sources = [
                  montadoUrl ? { url: montadoUrl, name: montadoFilename } : null,
                  camufladoUrl ? { url: camufladoUrl, name: camufladoFilename } : null,
                ].filter(Boolean) as Array<{ url: string; name?: string; revoke?: boolean }>;

                const triggerDownload = (url: string, name: string) => {
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = name;
                  a.rel = 'noopener';
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                };

                const handleDownloadAll = async () => {
                  // ⛔ CONFERE ANTES DE ENTREGAR. Se o arquivo no disco nao e' o
                  // dos takes de agora, nao baixa — avisa e manda atualizar.
                  if (conferirEntrega) {
                    try {
                      const problema = await conferirEntrega();
                      if (problema) { alert(problema); return; }
                    } catch (e) { console.warn('[card] conferirEntrega falhou:', e); }
                  }
                  // GARANTIA (fix 2026-07-03): se as URLs vivas sumiram (persist/
                  // reload descartou e a re-hidratacao do IDB falhou), busca as
                  // fontes DIRETO do IndexedDB por taskId agora. Sem isto, uma task
                  // PRONTA com o blob salvo no disco ficava com botao mudo/ausente.
                  let effSources = sources;
                  if (effSources.length === 0 && loadDeliverables) {
                    try {
                      const lazy = await loadDeliverables();
                      effSources = (lazy || []).filter((s) => s && s.url);
                    } catch (e) {
                      console.warn('[card] loadDeliverables falhou:', e);
                    }
                    if (effSources.length === 0) {
                      // Disco realmente vazio (raro/destrutivo) — nunca silencioso:
                      // avisa e manda regerar. Melhor mensagem clara que botao morto.
                      alert('O vídeo pronto não está mais no cache do navegador (pode ter sido limpo). Clique em Retomar pra regerar a entrega.');
                      return;
                    }
                  }
                  // 1) Junta TODOS os MP4 finais: .mp4 solto (TROCA) entra direto;
                  //    .zip (lipsync/VA) tem os .mp4 extraidos de dentro. Pode dar
                  //    1 (single avatar) ou N (VA com 2+ avatares, montado+camuflado).
                  const out: Array<{ blob?: Blob; url: string; name: string; revoke?: boolean }> = [];
                  for (const src of effSources) {
                    const fname = src.name || 'video.mp4';
                    if (/\.mp4$/i.test(fname)) {
                      // Ja e MP4 direto (ex: TROCA) — baixa como esta.
                      out.push({ url: src.url, name: fname });
                      continue;
                    }
                    // .zip (lipsync/VA): extrai os .mp4 de dentro.
                    try {
                      const blob = await fetch(src.url).then((r) => r.blob());
                      const JSZip = (await import('jszip')).default;
                      const zip = await JSZip.loadAsync(blob);
                      const entries = Object.values(zip.files).filter(
                        (f: any) => !f.dir && /\.mp4$/i.test(f.name),
                      );
                      if (entries.length === 0) {
                        // Sem MP4 dentro (pipeline falhou / so diagnostico) —
                        // cai pro zip mesmo pra nao deixar o botao mudo.
                        out.push({ url: src.url, name: fname });
                        continue;
                      }
                      for (const e of entries as any[]) {
                        const b = await e.async('blob');
                        const mp4 = new Blob([b], { type: 'video/mp4' });
                        const base = (e.name.split('/').pop() || e.name) as string;
                        out.push({ blob: mp4, url: URL.createObjectURL(mp4), name: base, revoke: true });
                      }
                    } catch {
                      // Nao era zip valido (ou fetch falhou) — baixa o que tem.
                      out.push({ url: src.url, name: fname });
                    }
                  }
                  if (out.length === 0) return;

                  // 2) UM arquivo → baixa solto (.mp4), rapido e sem zip.
                  if (out.length === 1) {
                    const m = out[0];
                    triggerDownload(m.url, m.name);
                    if (m.revoke) setTimeout(() => { try { URL.revokeObjectURL(m.url); } catch {} }, 60_000);
                    return;
                  }

                  // 3) DOIS OU MAIS (ex: VA com 2 avatares) → o Chrome BLOQUEIA
                  //    downloads multiplos automaticos: so o 1o passava e o resto
                  //    sumia (bug "so baixou 1 avatar"). Entrega GARANTIDA = UM zip
                  //    so, com os MP4 limpos dentro. Um clique, TODOS os videos.
                  try {
                    const JSZip = (await import('jszip')).default;
                    const bundle = new JSZip();
                    const used = new Set<string>();
                    for (const m of out) {
                      const blob: Blob = m.blob ? m.blob : await fetch(m.url).then((r) => r.blob());
                      let name = m.name;
                      let i = 2;
                      while (used.has(name)) name = m.name.replace(/\.mp4$/i, `_${i++}.mp4`);
                      used.add(name);
                      bundle.file(name, blob);
                    }
                    // STORE (sem compressao): MP4 ja e comprimido — so empacota, rapido.
                    const zipBlob = await bundle.generateAsync({ type: 'blob', compression: 'STORE' });
                    const base = (montadoFilename || 'videos').replace(/\.(zip|mp4)$/i, '');
                    const zipName = `${base}_${out.length}_videos.zip`;
                    const zurl = URL.createObjectURL(zipBlob);
                    triggerDownload(zurl, zipName);
                    setTimeout(() => { try { URL.revokeObjectURL(zurl); } catch {} }, 60_000);
                  } finally {
                    // Limpa os Object URLs temporarios das extracoes.
                    for (const m of out) if (m.revoke) setTimeout(() => { try { URL.revokeObjectURL(m.url); } catch {} }, 60_000);
                  }
                };

                // TRAVA o download quando a entrega NÃO está 100% (falta
                // parte/texto, render incompleto). O user pediu: só baixar o
                // vídeo de fato pronto, nunca uma versão zoada. Tem que clicar
                // Retomar pra completar antes. (troca não passa downloadBlocked.)
                // MONTAGEM VELHA trava igual: o arquivo existe, mas e' o de
                // ANTES da correcao dos takes. Baixar ali entrega o video sem
                // as correcoes — o pior tipo de erro, porque parece certo.
                const travado = downloadBlocked || montagemVelha || renderizando || foraDoPlano;
                const tooltip = downloadBlocked
                  ? '⚠ Incompleto — clique Retomar pra completar (não baixa versão zoada)'
                  : renderizando
                    ? `⚠ ${takesPendentes} take${takesPendentes === 1 ? '' : 's'} ainda renderizando — espere terminar e atualize a montagem`
                  : foraDoPlano
                    ? `⚠ ${takesForaDoPlano} take${takesForaDoPlano === 1 ? '' : 's'} com avatar/voz/motor diferente do plano — re-gere antes de baixar`
                    : montagemVelha
                      ? '⚠ Montagem desatualizada — clique "Atualizar montagem" antes, senão baixa a versão de ANTES das correções'
                      : 'Baixar MP4';
                return (
                  <Btn3D
                    icon={<IconDownload size={16} />}
                    color={travado ? 'neutral' : 'lime'}
                    title={tooltip}
                    disabled={travado}
                    onClick={travado ? undefined : (onDownload ? onDownload : () => void handleDownloadAll())}
                  />
                );
              })() : null}
              <Btn3D
                icon={<IconRefresh size={16} />}
                color="cyan"
                title="Retomar"
                onClick={onRetomar}
                disabled={isRunning || (isQueued && !queuedRecoverable)}
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
                color={temTopPanel ? 'violet' : 'fuchsia'}
                title="Reiniciar disparo — pergunta se você quer editar antes"
                onClick={onDebug}
                disabled={isQueued && !queuedRecoverable}
                pulse={temTopPanel}
              />
              {!isRunning ? (
                <Btn3D icon={<IconX size={14} />} color="neutral" title="Remover" onClick={onRemove} />
              ) : null}
              {/* Acoes extras (ex: VA "baixar AD original") */}
              {extraActions}
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

          {/* BANNER especial (limite diário / falha) — sempre visível, curto,
           *  sem termo técnico, com hierarquia visual própria. */}
          {banner ? (
            <div
              className={`mt-2.5 flex items-start gap-2.5 rounded-[12px] border px-3 py-2.5 ${
                banner.kind !== 'fail'
                  ? 'border-amber-400/40 bg-gradient-to-br from-amber-400/[0.14] via-amber-400/[0.05] to-transparent shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]'
                  : 'border-rose-400/35 bg-gradient-to-br from-rose-500/[0.12] via-rose-500/[0.04] to-transparent shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]'
              }`}
            >
              <span
                className={`mt-[1px] flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                  banner.kind !== 'fail' ? 'bg-amber-400/15 text-amber-300' : 'bg-rose-400/15 text-rose-300'
                }`}
              >
                {banner.kind !== 'fail' ? <IconHourglass size={13} /> : <IconAlert size={13} />}
              </span>
              <div className="min-w-0">
                <div className={`text-[11.5px] font-semibold leading-snug ${banner.kind !== 'fail' ? 'text-amber-100' : 'text-rose-100'}`}>
                  {banner.title}
                </div>
                {banner.hint ? (
                  <div className="mt-0.5 text-[10.5px] leading-snug text-text-muted">{banner.hint}</div>
                ) : null}
              </div>
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
          ) : expanded && friendlyMsg && !banner ? (
            <div className="mono mt-1.5 text-[10px] text-text-muted">{friendlyMsg}</div>
          ) : null}

          {/* PAINEL DO CARD (reiniciar disparo) — SEMPRE visível quando existe,
           *  e sempre ACIMA dos previews: o user pediu que a reorganização do
           *  disparo abra em cima dos cards de take, na própria task, e não lá
           *  embaixo junto da fila. */}
          {topPanel ? <div className="mt-3">{topPanel}</div> : null}

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
      className={`label-tech relative inline-flex items-center gap-1 rounded-full border px-2.5 py-[3px] text-[9.5px] font-semibold uppercase tracking-[0.08em] ${toneClasses[tone]} shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]`}
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
      <span className="field-label text-[10.5px] text-text-muted">{label}</span>
    </span>
  );
}
