'use client';

import React from 'react';

/**
 * PilotCardActions — botoes icon-only do card de analise do ClickUp Pilot.
 * Tooltips native (title=), sem barra preta.
 *
 * Visual (08.10): "botão-instrumento" (.pl-ibtn, app/pilot-skin.css). Todos
 * grafite com bisel; o ÍCONE carrega a cor da intenção e o anel/brilho só
 * acende no hover e quando o botão está LIGADO (`active`). A barra de doze
 * ações deixa de ser um arco-íris de bolas e vira um painel coerente em que o
 * ligado salta à vista. Mesma API de antes (color, active, pulse, size, href).
 */

export type PilotBtnColor = 'lime' | 'cyan' | 'amber' | 'fuchsia' | 'rose' | 'violet' | 'orange' | 'emerald' | 'neutral';

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
  /** Quando true, acende o anel na cor da intenção (toggle ON) */
  active?: boolean;
  href?: string;
  size?: number;
  pulse?: boolean;
}) {
  const sizeStyle: React.CSSProperties = { height: size, width: size };
  const inner = (
    <>
      {pulse && !disabled ? <span className="pl-ibtn__pulse" aria-hidden /> : null}
      <span className="relative flex items-center justify-center">{icon}</span>
    </>
  );

  if (href && !disabled) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="pl-ibtn group/pbtn"
        data-tone={color}
        data-on={active ? 'true' : undefined}
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
      data-tone={color}
      data-on={active ? 'true' : undefined}
      style={sizeStyle}
      className="pl-ibtn group/pbtn"
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
export const IconLegenda = ({ size = 16 }: { size?: number }) => (
  // Legenda: retangulo de video com a faixa de texto embaixo.
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M7 15h4M13 15h4M7 11h10" opacity="0.55" />
  </svg>
);
export const IconZoomDinamica = ({ size = 16 }: { size?: number }) => (
  // Zoom: cantos puxando pra dentro (push-in).
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3" />
    <path d="M9.5 9.5 12 12m0 0 2.5 2.5M12 12l2.5-2.5M12 12l-2.5 2.5" opacity="0.7" />
  </svg>
);
export const IconHeadline = ({ size = 16 }: { size?: number }) => (
  // Linhas de manchete: a de cima grossa, as de baixo finas.
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 7h16" strokeWidth="3" />
    <path d="M4 13h11M4 18h7" strokeWidth="2" opacity="0.75" />
  </svg>
);
export const IconInserts = ({ size = 16 }: { size?: number }) => (
  // Duas telas: a de tras e' o avatar, a da frente e' o b-roll entrando.
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="4" width="14" height="12" rx="2" />
    <path d="M22 8v10a2 2 0 0 1-2 2H8" opacity="0.5" />
    <path d="m7 9.5 4 2.5-4 2.5z" fill="currentColor" stroke="none" />
  </svg>
);
export const IconNivelar = ({ size = 16 }: { size?: number }) => (
  // Barras iguais sob uma regua: e' o que o normalizador faz — poe todo mundo
  // no MESMO patamar (nao e' "volume", e' NIVELAR).
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6h18" opacity="0.4" />
    <path d="M6 10v8M10 10v8M14 10v8M18 10v8" />
  </svg>
);
export const IconVelocidade = ({ size = 16 }: { size?: number }) => (
  // Mixer de velocidade: o velocímetro com a agulha passando do meio.
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4.2 17.5a9 9 0 1 1 15.6 0" />
    <path d="M12 13.2 16.4 8.6" />
    <circle cx="12" cy="13.6" r="1.6" fill="currentColor" stroke="none" />
    <path d="M7.2 9.4l.9.8M12 6.2v1.2" opacity="0.55" />
  </svg>
);
export const IconSonoplastia = ({ size = 16 }: { size?: number }) => (
  // SFX e trilha: a nota da trilha e a onda do efeito batendo ao lado.
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 17.5V5.5l8-2v11.2" />
    <circle cx="6.6" cy="17.6" r="2.4" fill="currentColor" stroke="none" />
    <circle cx="14.6" cy="15.4" r="2.4" fill="currentColor" stroke="none" />
    <path d="M20.5 8.2c.9.9.9 3.1 0 4M22.4 6.6c1.8 1.8 1.8 5.4 0 7.2" opacity="0.6" />
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

/** Download (seta pra baixo + base) */
export const IconDownload = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" />
  </svg>
);

/** Nuvem com seta pra baixo — download via extensao (arquivo grande) */
export const IconCloudDown = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.5 19a4.5 4.5 0 0 0 .5-9 6 6 0 0 0-11.6-1.5A4 4 0 0 0 6 19" />
    <path d="M12 12v6" /><path d="m9 15 3 3 3-3" />
  </svg>
);
