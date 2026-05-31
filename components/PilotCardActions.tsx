'use client';

import React from 'react';

/**
 * PilotCardActions — botoes 3D icon-only pra o card de analise do
 * ClickUp Pilot. Familia visual coerente com BatchJobCard3D + tooltips
 * native (title=) sem barra preta.
 *
 * Cada botao tem:
 *  - Highlight gradient no topo (luz)
 *  - Lift+scale no hover
 *  - Active push no click
 *  - Color tinted por intent (lime, cyan, amber, fuchsia, rose, violet, neutral)
 */

export type PilotBtnColor = 'lime' | 'cyan' | 'amber' | 'fuchsia' | 'rose' | 'violet' | 'neutral';

const PALETTE: Record<PilotBtnColor, { ring: string; bg: string; text: string; glow: string }> = {
  lime: {
    ring: 'border-lime/55',
    bg: 'from-lime/22 via-lime/10 to-lime/[0.02]',
    text: 'text-lime',
    glow: 'shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_3px_10px_-3px_rgba(190,242,100,0.4)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_12px_26px_-6px_rgba(190,242,100,0.65)]',
  },
  cyan: {
    ring: 'border-cyan-400/55',
    bg: 'from-cyan-400/22 via-cyan-400/10 to-cyan-400/[0.02]',
    text: 'text-cyan-200 dark:text-cyan-200',
    glow: 'shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_3px_10px_-3px_rgba(34,211,238,0.4)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_12px_26px_-6px_rgba(34,211,238,0.65)]',
  },
  amber: {
    ring: 'border-amber-400/60',
    bg: 'from-amber-400/22 via-amber-400/10 to-amber-400/[0.02]',
    text: 'text-amber-700',
    glow: 'shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_3px_10px_-3px_rgba(251,191,36,0.4)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_12px_26px_-6px_rgba(251,191,36,0.65)]',
  },
  fuchsia: {
    ring: 'border-fuchsia-400/55',
    bg: 'from-fuchsia-400/22 via-fuchsia-400/10 to-fuchsia-400/[0.02]',
    text: 'text-fuchsia-200',
    glow: 'shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_3px_10px_-3px_rgba(217,70,239,0.4)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_12px_26px_-6px_rgba(217,70,239,0.65)]',
  },
  rose: {
    ring: 'border-rose-400/55',
    bg: 'from-rose-400/20 via-rose-400/8 to-rose-400/[0.02]',
    text: 'text-rose-300',
    glow: 'shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_3px_10px_-3px_rgba(244,63,94,0.35)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.26),0_12px_26px_-6px_rgba(244,63,94,0.6)]',
  },
  violet: {
    ring: 'border-violet-400/55',
    bg: 'from-violet-400/22 via-violet-400/10 to-violet-400/[0.02]',
    text: 'text-violet-300',
    glow: 'shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_3px_10px_-3px_rgba(167,139,250,0.4)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_12px_26px_-6px_rgba(167,139,250,0.65)]',
  },
  neutral: {
    ring: 'border-white/12',
    bg: 'from-white/10 via-white/[0.04] to-transparent',
    text: 'text-text-muted',
    glow: 'shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_8px_20px_-6px_rgba(255,255,255,0.18)]',
  },
};

export function PilotBtn3D({
  icon,
  color,
  title,
  onClick,
  disabled,
  active,
  href,
  size = 36,
  pulse,
}: {
  icon: React.ReactNode;
  color: PilotBtnColor;
  title: string;
  onClick?: () => void;
  disabled?: boolean;
  /** Quando true, mostra outline forte (toggle ON state) */
  active?: boolean;
  href?: string;
  size?: number;
  pulse?: boolean;
}) {
  const p = PALETTE[color];
  const base =
    'group/pbtn relative inline-flex items-center justify-center rounded-full border bg-gradient-to-b will-change-transform transition-[transform,box-shadow,border-color] duration-200 ease-out';
  const enabled = `${p.ring} ${p.bg} ${p.text} ${p.glow} hover:-translate-y-0.5 hover:scale-[1.08] active:translate-y-0 active:scale-95`;
  const dis = 'border-white/8 bg-white/[0.03] text-white/30 opacity-60 cursor-not-allowed shadow-none';
  const activeRing = active ? 'ring-2 ring-current/40 ring-offset-2 ring-offset-transparent' : '';
  const sizeStyle: React.CSSProperties = { height: size, width: size };

  const inner = (
    <>
      <span
        className="pointer-events-none absolute inset-x-0 top-0 h-1/2 rounded-t-full bg-gradient-to-b from-white/15 to-transparent"
        aria-hidden
      />
      {pulse && !disabled ? (
        <span className="pointer-events-none absolute inset-0 rounded-full ring-2 ring-current/40 animate-ping opacity-30" aria-hidden />
      ) : null}
      <span className="relative flex items-center justify-center">{icon}</span>
    </>
  );

  if (href && !disabled) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={`${base} ${enabled} ${activeRing}`}
        style={sizeStyle}
        title={title}
        aria-label={title}
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
      title={title}
      aria-label={title}
      aria-pressed={active}
      style={sizeStyle}
      className={`${base} ${disabled ? dis : enabled} ${activeRing}`}
    >
      {inner}
    </button>
  );
}

// ───────────────────────── Icons inline ─────────────────────────

export const IconScissors = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" />
    <line x1="20" y1="4" x2="8.12" y2="15.88" /><line x1="14.47" y1="14.48" x2="20" y2="20" />
    <line x1="8.12" y1="8.12" x2="12" y2="12" />
  </svg>
);
export const IconCamuflagem = ({ size = 16 }: { size?: number }) => (
  // Sound wave / cloak waves icon (visual: "veil over audio")
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 12h2M6 12h1M10 12h1M14 12h1M18 12h2M22 12h-2" opacity="0.35" />
    <path d="M4 9c2-3 6-3 8 0s6 3 8 0" />
    <path d="M4 15c2 3 6 3 8 0s6-3 8 0" />
  </svg>
);
export const IconMotor = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M12 1v6M12 17v6M4.22 4.22l4.24 4.24M15.54 15.54l4.24 4.24M1 12h6M17 12h6M4.22 19.78l4.24-4.24M15.54 8.46l4.24-4.24" />
  </svg>
);
export const IconDoc = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" fill="#1a73e8" />
    <path d="M14 2v6h6L14 2z" fill="#a1c2fa" />
    <path d="M8 12h8M8 15h8M8 18h5" stroke="white" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);
export const IconPlay = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <path d="M8 5v14l11-7z" />
  </svg>
);
export const IconX = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="m6 6 12 12M18 6 6 18" />
  </svg>
);
export const IconUpload = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
);

/** Icone Auto B-roll — sparkle/wand stylized: 4 estrelas e linhas */
export const IconBroll = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m12 3-1.5 4-4 1.5 4 1.5L12 14l1.5-4 4-1.5-4-1.5z" />
    <path d="M20 16v4M18 18h4M5 18v3M3.5 19.5h3" />
  </svg>
);
