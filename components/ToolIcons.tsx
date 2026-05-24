'use client';

/**
 * ToolIcons v4 — ícones COLORIDOS com gradientes por categoria.
 *
 * Usa React.useId() (React 18+) pra gerar IDs estáveis e únicos em
 * SSR + CSR, sem hydration mismatch (motivo do Normalizador aparecer
 * sem ícone na versão anterior).
 */

import { useId } from 'react';

type IconProps = {
  size?: number;
  className?: string;
  strokeWidth?: number;
};

function baseProps(p: IconProps, fallbackStroke: string) {
  return {
    width: p.size ?? 22,
    height: p.size ?? 22,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: fallbackStroke,
    strokeWidth: p.strokeWidth ?? 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className: p.className,
    'aria-hidden': true,
  };
}

/* ------------------------------ BASE ------------------------------ */

/** Decupagem — corte fino, gradient verde/lime */
export function IconDecupagem(p: IconProps) {
  const raw = useId();
  const id = `g-${raw.replace(/:/g, '')}`;
  return (
    <svg {...baseProps(p, `url(#${id})`)}>
      <defs>
        <linearGradient id={id} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#a3e635" />
          <stop offset="100%" stopColor="#22c55e" />
        </linearGradient>
      </defs>
      <path d="M3 12h2M7 9v6M10 6v12M13 9v6M16 12h2M19 11v2" />
      <path d="M6 19l3-3M9 19l-3-3" opacity="0.7" />
    </svg>
  );
}

/** Camuflagem — escudo, gradient verde/teal */
export function IconCamuflagem(p: IconProps) {
  const raw = useId();
  const id = `g-${raw.replace(/:/g, '')}`;
  return (
    <svg {...baseProps(p, `url(#${id})`)}>
      <defs>
        <linearGradient id={id} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#2dd4bf" />
          <stop offset="100%" stopColor="#0ea5e9" />
        </linearGradient>
      </defs>
      <path d="M4 8c0 4 2 7 8 10 6-3 8-6 8-10V6l-8-3-8 3v2z" />
      <path d="M9 11l2 2 4-4" />
    </svg>
  );
}

/** Compressor — gradient roxo/azul */
export function IconCompressor(p: IconProps) {
  const raw = useId();
  const id = `g-${raw.replace(/:/g, '')}`;
  return (
    <svg {...baseProps(p, `url(#${id})`)}>
      <defs>
        <linearGradient id={id} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#818cf8" />
          <stop offset="100%" stopColor="#6366f1" />
        </linearGradient>
      </defs>
      <path d="M4 4l5 5M20 4l-5 5M4 20l5-5M20 20l-5-5" />
      <rect x="9" y="9" width="6" height="6" rx="1.5" />
    </svg>
  );
}

/** Downloader — gradient azul */
export function IconDownloader(p: IconProps) {
  const raw = useId();
  const id = `g-${raw.replace(/:/g, '')}`;
  return (
    <svg {...baseProps(p, `url(#${id})`)}>
      <defs>
        <linearGradient id={id} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#60a5fa" />
          <stop offset="100%" stopColor="#3b82f6" />
        </linearGradient>
      </defs>
      <rect x="3" y="3" width="18" height="13" rx="2.5" />
      <path d="M10 7.5l4 2.5-4 2.5z" fill={`url(#${id})`} />
      <path d="M12 16v5M9 18l3 3 3-3" />
    </svg>
  );
}

/** Audio Split — gradient ciano */
export function IconAudioSplit(p: IconProps) {
  const raw = useId();
  const id = `g-${raw.replace(/:/g, '')}`;
  return (
    <svg {...baseProps(p, `url(#${id})`)}>
      <defs>
        <linearGradient id={id} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#22d3ee" />
          <stop offset="100%" stopColor="#06b6d4" />
        </linearGradient>
      </defs>
      <path d="M3 12h1M5 10v4M7 8v8M9 6v12" />
      <path d="M12 3v18" strokeDasharray="2 2" opacity="0.6" />
      <path d="M15 6v12M17 8v8M19 10v4M21 12h-1" />
    </svg>
  );
}

/** Acelerador — gradient laranja/âmbar */
export function IconAcelerador(p: IconProps) {
  const raw = useId();
  const id = `g-${raw.replace(/:/g, '')}`;
  return (
    <svg {...baseProps(p, `url(#${id})`)}>
      <defs>
        <linearGradient id={id} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#fbbf24" />
          <stop offset="100%" stopColor="#f97316" />
        </linearGradient>
      </defs>
      <path d="M4 5l8 7-8 7V5z" fill={`url(#${id})`} />
      <path d="M12 5l8 7-8 7V5z" fill={`url(#${id})`} />
    </svg>
  );
}

/** Normalizador — equalizer bars FILLED (sem stroke fino que some) */
export function IconNormalizador(p: IconProps) {
  const raw = useId();
  const id = `g-${raw.replace(/:/g, '')}`;
  const url = `url(#${id})`;
  return (
    <svg
      width={p.size ?? 22}
      height={p.size ?? 22}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className={p.className}
    >
      <defs>
        <linearGradient id={id} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#5eead4" />
          <stop offset="100%" stopColor="#14b8a6" />
        </linearGradient>
      </defs>
      {/* Barras EQ — filled rects, bem visíveis em qualquer tamanho */}
      <rect x="3"  y="9"  width="2.6" height="6"  rx="1" fill={url} opacity="0.55" />
      <rect x="7"  y="6"  width="2.6" height="12" rx="1" fill={url} />
      <rect x="11" y="3"  width="2.6" height="18" rx="1" fill={url} />
      <rect x="15" y="6"  width="2.6" height="12" rx="1" fill={url} />
      <rect x="19" y="9"  width="2.6" height="6"  rx="1" fill={url} opacity="0.55" />
    </svg>
  );
}

/** Take Splitter — gradient verde/teal */
export function IconTakeSplitter(p: IconProps) {
  const raw = useId();
  const id = `g-${raw.replace(/:/g, '')}`;
  return (
    <svg {...baseProps(p, `url(#${id})`)}>
      <defs>
        <linearGradient id={id} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#86efac" />
          <stop offset="100%" stopColor="#22c55e" />
        </linearGradient>
      </defs>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="M3 9h18M3 15h18" opacity="0.5" />
      <path d="M9 4v3M9 17v3" strokeDasharray="1 1.5" />
      <path d="M15 4v3M15 17v3" strokeDasharray="1 1.5" />
      <circle cx="12" cy="12" r="0.9" fill={`url(#${id})`} stroke="none" />
    </svg>
  );
}

/** Calculadora — gradient cinza/azul */
export function IconCalculadora(p: IconProps) {
  const raw = useId();
  const id = `g-${raw.replace(/:/g, '')}`;
  return (
    <svg {...baseProps(p, `url(#${id})`)}>
      <defs>
        <linearGradient id={id} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#94a3b8" />
          <stop offset="100%" stopColor="#64748b" />
        </linearGradient>
      </defs>
      <rect x="4" y="3" width="16" height="18" rx="2.5" />
      <path d="M7 7h10" />
      <path d="M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01" />
    </svg>
  );
}

/* ------------------------------ IA ------------------------------ */

/** Auto B-roll — gradient violeta/rosa */
export function IconAutoBroll(p: IconProps) {
  const raw = useId();
  const id = `g-${raw.replace(/:/g, '')}`;
  return (
    <svg {...baseProps(p, `url(#${id})`)}>
      <defs>
        <linearGradient id={id} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#f0abfc" />
          <stop offset="100%" stopColor="#a78bfa" />
        </linearGradient>
      </defs>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="M3 10h18M3 14h18" />
      <path d="M7 6v12M11 6v12M15 6v12" opacity="0.5" />
      <path d="M18 3l0.6 1.4 1.4 0.6-1.4 0.6L18 7l-0.6-1.4L16 5l1.4-0.6L18 3z" fill={`url(#${id})`} />
    </svg>
  );
}

/** Troca de Produto — gradient rosa */
export function IconTrocaProduto(p: IconProps) {
  const raw = useId();
  const id = `g-${raw.replace(/:/g, '')}`;
  return (
    <svg {...baseProps(p, `url(#${id})`)}>
      <defs>
        <linearGradient id={id} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#fda4af" />
          <stop offset="100%" stopColor="#ec4899" />
        </linearGradient>
      </defs>
      <path d="M4 12c0-4 3-7 8-7 5 0 8 3 8 7 0 4-3 7-8 7-1.2 0-2.4-.2-3.5-.5L4 20l1.2-3.2C4.4 15.4 4 13.7 4 12z" />
      <path d="M9 10l6 0M9 10l2-2M9 10l2 2" />
      <path d="M15 14l-6 0M15 14l-2-2M15 14l-2 2" />
    </svg>
  );
}

/** Copy → SRT — gradient violeta */
export function IconCopySRT(p: IconProps) {
  const raw = useId();
  const id = `g-${raw.replace(/:/g, '')}`;
  return (
    <svg {...baseProps(p, `url(#${id})`)}>
      <defs>
        <linearGradient id={id} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#c4b5fd" />
          <stop offset="100%" stopColor="#8b5cf6" />
        </linearGradient>
      </defs>
      <rect x="4" y="3" width="12" height="18" rx="2" />
      <path d="M7 7h6M7 10h6M7 13h4" opacity="0.7" />
      <circle cx="18" cy="17" r="3.5" />
      <path d="M18 15v2l1.4 1" />
    </svg>
  );
}

/** Decupagem com Copy — gradient violeta/rosa */
export function IconDecupageCopy(p: IconProps) {
  const raw = useId();
  const id = `g-${raw.replace(/:/g, '')}`;
  return (
    <svg {...baseProps(p, `url(#${id})`)}>
      <defs>
        <linearGradient id={id} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#e879f9" />
          <stop offset="100%" stopColor="#a78bfa" />
        </linearGradient>
      </defs>
      <rect x="3" y="4" width="7" height="16" rx="1.5" />
      <path d="M5 8h3M5 11h3M5 14h3" opacity="0.7" />
      <path d="M11 12h2" />
      <path d="M12 10l1.5 2-1.5 2" />
      <rect x="14" y="6" width="7" height="12" rx="1.5" />
      <path d="M14 9h7M14 15h7" opacity="0.5" />
      <path d="M19.5 3l0.4 0.9 0.9 0.4-0.9 0.4-0.4 0.9-0.4-0.9-0.9-0.4 0.9-0.4 0.4-0.9z" fill={`url(#${id})`} stroke="none" />
    </svg>
  );
}

/** Remover Legenda — gradient rosa/violeta */
export function IconRemoverElementos(p: IconProps) {
  const raw = useId();
  const id = `g-${raw.replace(/:/g, '')}`;
  return (
    <svg {...baseProps(p, `url(#${id})`)}>
      <defs>
        <linearGradient id={id} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#f472b6" />
          <stop offset="100%" stopColor="#8b5cf6" />
        </linearGradient>
      </defs>
      <path d="M5 19l9-9" />
      <path d="M14 10l1.5-1.5a2 2 0 012.8 2.8L16.8 12.8" />
      <path d="M3 21h6" opacity="0.5" />
      <path d="M18 4l0.5 1.2 1.2 0.5-1.2 0.5L18 7.4l-0.5-1.2L16.3 5.7l1.2-0.5L18 4z" fill={`url(#${id})`} stroke="none" />
      <path d="M21 9l0.3 0.7 0.7 0.3-0.7 0.3L21 11l-0.3-0.7L20 10l0.7-0.3L21 9z" fill={`url(#${id})`} stroke="none" opacity="0.6" />
    </svg>
  );
}

/** HeyGen Auto — gradient ciano */
export function IconHeyGenAuto(p: IconProps) {
  const raw = useId();
  const id = `g-${raw.replace(/:/g, '')}`;
  return (
    <svg {...baseProps(p, `url(#${id})`)}>
      <defs>
        <linearGradient id={id} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#67e8f9" />
          <stop offset="100%" stopColor="#3b82f6" />
        </linearGradient>
      </defs>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 19v-1a4 4 0 014-4h4a4 4 0 014 4v1" />
      <path d="M16 8c1.5 1 1.5 5 0 6" opacity="0.7" />
      <path d="M18.5 6.5c2.5 1.7 2.5 7.3 0 9" opacity="0.5" />
      <path d="M20.5 3l0.4 1 1 0.4-1 0.4-0.4 1-0.4-1L19 4.4l1-0.4 0.5-1z" fill={`url(#${id})`} stroke="none" />
    </svg>
  );
}

/** LTX-Video — mantido pro caso de admin querer acessar direto. */
export function IconLtxVideo(p: IconProps) {
  const raw = useId();
  const id = `g-${raw.replace(/:/g, '')}`;
  return (
    <svg {...baseProps(p, `url(#${id})`)}>
      <defs>
        <linearGradient id={id} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#fbbf24" />
          <stop offset="100%" stopColor="#ec4899" />
        </linearGradient>
      </defs>
      <rect x="3" y="6" width="18" height="13" rx="2.5" />
      <path d="M3 9h18" />
      <path d="M7 6l-1.5 3M12 6l-1.5 3M17 6l-1.5 3" opacity="0.6" />
      <path d="M11 12.5l3 1.8-3 1.8z" fill={`url(#${id})`} stroke="none" />
    </svg>
  );
}

/* ------------------------------ Util ------------------------------ */

/** Sparkle — usado pra acentos AI */
export function IconSparkle(p: IconProps) {
  const raw = useId();
  const id = `g-${raw.replace(/:/g, '')}`;
  return (
    <svg {...baseProps(p, `url(#${id})`)}>
      <defs>
        <linearGradient id={id} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#f0abfc" />
          <stop offset="100%" stopColor="#a78bfa" />
        </linearGradient>
      </defs>
      <path d="M12 3l1.5 5L18 9.5l-4.5 1.5L12 16l-1.5-5L6 9.5l4.5-1.5L12 3z" fill={`url(#${id})`} stroke="none" />
    </svg>
  );
}

/** Wrench (Base) */
export function IconWrench(p: IconProps) {
  const raw = useId();
  const id = `g-${raw.replace(/:/g, '')}`;
  return (
    <svg {...baseProps(p, `url(#${id})`)}>
      <defs>
        <linearGradient id={id} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#c8ff00" />
          <stop offset="100%" stopColor="#67e8f9" />
        </linearGradient>
      </defs>
      <path d="M14.7 6.3a4 4 0 00-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 005.4-5.4l-2.7 2.7-2.6-2.6 2.7-2.7z" />
    </svg>
  );
}

/* ─────────────────────── Step icons ────────────────────────────── */
/**
 * Ícones simbólicos que SUBSTITUEM o número de cada passo das
 * ferramentas. Cada um remete à AÇÃO daquele passo (subir arquivo,
 * ajustar config, executar, baixar, etc).
 *
 * Todos compartilham um wrapper compacto (24×24 viewBox) e usam
 * stroke branco — herdam cor do contexto pelo `currentColor`. O
 * gradiente fica por conta do badge do ToolStep (já tem hue próprio).
 */
function stepBase(p: IconProps) {
  return {
    width: p.size ?? 18,
    height: p.size ?? 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: p.strokeWidth ?? 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className: p.className,
    'aria-hidden': true,
  };
}

/** Upload — subir arquivo (passo de input) */
export function IconStepUpload(p: IconProps) {
  return (
    <svg {...stepBase(p)}>
      <path d="M12 16V4" />
      <path d="M6 10l6-6 6 6" />
      <path d="M4 20h16" />
    </svg>
  );
}

/** Link — colar URL */
export function IconStepLink(p: IconProps) {
  return (
    <svg {...stepBase(p)}>
      <path d="M10 14a4 4 0 015.66 0l3-3a4 4 0 00-5.66-5.66l-1.5 1.5" />
      <path d="M14 10a4 4 0 01-5.66 0l-3 3a4 4 0 005.66 5.66l1.5-1.5" />
    </svg>
  );
}

/** Plug/Extensão — instalar ou conectar */
export function IconStepPlug(p: IconProps) {
  return (
    <svg {...stepBase(p)}>
      <path d="M9 2v6M15 2v6" />
      <path d="M6 8h12v3a6 6 0 01-12 0V8z" />
      <path d="M12 17v5" />
    </svg>
  );
}

/** Sliders — ajustes/configuração */
export function IconStepSliders(p: IconProps) {
  return (
    <svg {...stepBase(p)}>
      <path d="M4 6h12M4 18h7" />
      <path d="M4 12h16" />
      <circle cx="18" cy="6" r="2.2" />
      <circle cx="13" cy="18" r="2.2" />
      <circle cx="10" cy="12" r="2.2" />
    </svg>
  );
}

/** Gear — configuração geral */
export function IconStepGear(p: IconProps) {
  return (
    <svg {...stepBase(p)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.9 2.9l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 01-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1A2 2 0 113.1 16.9l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H1a2 2 0 010-4h.1A1.7 1.7 0 002.6 9a1.7 1.7 0 00-.3-1.8l-.1-.1A2 2 0 015.1 4.2l.1.1a1.7 1.7 0 001.8.3H7a1.7 1.7 0 001-1.5V3a2 2 0 014 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 012.9 2.9l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H23a2 2 0 010 4h-.1a1.7 1.7 0 00-1.5 1z" />
    </svg>
  );
}

/** Wand — IA / mágica / processar */
export function IconStepWand(p: IconProps) {
  return (
    <svg {...stepBase(p)}>
      <path d="M15 4v3M19 4v3M17 2v2M17 7v2" />
      <path d="M4 20l11-11 3 3-11 11H4v-3z" />
    </svg>
  );
}

/** Play — executar / iniciar */
export function IconStepPlay(p: IconProps) {
  return (
    <svg {...stepBase(p)}>
      <path d="M7 4l13 8-13 8V4z" fill="currentColor" />
    </svg>
  );
}

/** Download — baixar resultado */
export function IconStepDownload(p: IconProps) {
  return (
    <svg {...stepBase(p)}>
      <path d="M12 4v12" />
      <path d="M6 10l6 6 6-6" />
      <path d="M4 20h16" />
    </svg>
  );
}

/** Text/Document — texto / copy */
export function IconStepText(p: IconProps) {
  return (
    <svg {...stepBase(p)}>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </svg>
  );
}

/** Folder/Files — arquivos */
export function IconStepFiles(p: IconProps) {
  return (
    <svg {...stepBase(p)}>
      <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
    </svg>
  );
}

/** Money — preço / valor */
export function IconStepMoney(p: IconProps) {
  return (
    <svg {...stepBase(p)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M15 9a3 3 0 00-3-2 2.5 2.5 0 000 5 2.5 2.5 0 010 5 3 3 0 01-3-2" />
      <path d="M12 6v1M12 17v1" />
    </svg>
  );
}

/** Clock — minutagem / duração */
export function IconStepClock(p: IconProps) {
  return (
    <svg {...stepBase(p)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

/** Tag — desconto / etiqueta */
export function IconStepTag(p: IconProps) {
  return (
    <svg {...stepBase(p)}>
      <path d="M20 12l-8 8-9-9V3h8l9 9z" />
      <circle cx="7.5" cy="7.5" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Mic — áudio / voz */
export function IconStepMic(p: IconProps) {
  return (
    <svg {...stepBase(p)}>
      <rect x="9" y="2" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0014 0" />
      <path d="M12 18v3M9 21h6" />
    </svg>
  );
}

/** Speed — velocidade */
export function IconStepSpeed(p: IconProps) {
  return (
    <svg {...stepBase(p)}>
      <path d="M5 7l7 5-7 5V7z" fill="currentColor" />
      <path d="M12 7l7 5-7 5V7z" fill="currentColor" />
    </svg>
  );
}

/** Format/Layers — formato de saída */
export function IconStepFormat(p: IconProps) {
  return (
    <svg {...stepBase(p)}>
      <path d="M12 3l9 5-9 5-9-5 9-5z" />
      <path d="M3 13l9 5 9-5" />
    </svg>
  );
}

/** Target/Shield — alvo / segurança */
export function IconStepTarget(p: IconProps) {
  return (
    <svg {...stepBase(p)}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Pipeline / Workflow — fluxo de etapas */
export function IconStepPipeline(p: IconProps) {
  return (
    <svg {...stepBase(p)}>
      <circle cx="5" cy="6" r="2.2" />
      <circle cx="19" cy="6" r="2.2" />
      <circle cx="5" cy="18" r="2.2" />
      <circle cx="19" cy="18" r="2.2" />
      <path d="M7 6h10M7 18h10M5 8v8M19 8v8" />
    </svg>
  );
}

/** Scissors / Cut — corte */
export function IconStepScissors(p: IconProps) {
  return (
    <svg {...stepBase(p)}>
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M8.5 8.5L20 20" />
      <path d="M8.5 15.5L20 4" />
    </svg>
  );
}

/** Sparkle — IA / verificação */
export function IconStepSparkle(p: IconProps) {
  return (
    <svg {...stepBase(p)}>
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Tag/Name — etiquetar / nomear */
export function IconStepLabel(p: IconProps) {
  return (
    <svg {...stepBase(p)}>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="M3 10h18" />
    </svg>
  );
}

/** Product Swap — troca de produto */
export function IconStepSwap(p: IconProps) {
  return (
    <svg {...stepBase(p)}>
      <path d="M4 8h13l-3-3M20 16H7l3 3" />
    </svg>
  );
}

/** Search — pesquisa */
export function IconSearch(p: IconProps) {
  return (
    <svg {...stepBase(p)}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  );
}

/** ClickUp Pilot */
export function IconClickUpPilot(p: IconProps) {
  const raw = useId();
  const id = `g-${raw.replace(/:/g, '')}`;
  return (
    <svg {...baseProps(p, `url(#${id})`)}>
      <defs>
        <linearGradient id={id} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#a78bfa" />
          <stop offset="100%" stopColor="#ec4899" />
        </linearGradient>
      </defs>
      <rect x="3" y="4" width="10" height="16" rx="2" />
      <path d="M5.5 8h5M5.5 12h5M5.5 16h3" opacity="0.7" />
      <path d="M16 6l5 5-3 1-1 3-5-5 4-4z" fill={`url(#${id})`} />
      <path d="M14 12l-2 2" opacity="0.5" strokeDasharray="1.5 1.5" />
      <path d="M21.5 17l0.4 1 1 0.4-1 0.4-0.4 1-0.4-1L20 18.4l1-0.4 0.5-1z" fill={`url(#${id})`} stroke="none" />
    </svg>
  );
}
