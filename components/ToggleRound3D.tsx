'use client';

/**
 * ToggleRound3D — botao 3D REDONDO ON/OFF, so com icone (sem texto).
 *
 * Usado pro Smart Mode VA (icone wireless). Visual: bola 3D com bevel +
 * glow quando ON, apagado quando OFF. Animacao de pulso radial nas waves
 * do icone quando ON.
 */
export function ToggleRound3D({
  on,
  onChange,
  icon,
  title,
  disabled = false,
  variant = 'lime',
  size = 'md',
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  icon: React.ReactNode;
  title?: string;
  disabled?: boolean;
  variant?: 'lime' | 'cyan' | 'fuchsia';
  size?: 'sm' | 'md' | 'lg';
}) {
  const colors = {
    lime: {
      border: 'border-lime',
      text: 'text-lime',
      glow: 'shadow-[0_0_24px_-2px_rgba(200,232,124,0.7),0_0_50px_-12px_rgba(200,232,124,0.5)]',
      hover: 'hover:shadow-[0_0_32px_0px_rgba(200,232,124,0.9),0_0_70px_-12px_rgba(200,232,124,0.6)]',
      bg: 'bg-lime/10',
    },
    cyan: {
      border: 'border-cyan-400',
      text: 'text-cyan-300',
      glow: 'shadow-[0_0_24px_-2px_rgba(34,211,238,0.7)]',
      hover: 'hover:shadow-[0_0_32px_0px_rgba(34,211,238,0.9)]',
      bg: 'bg-cyan-400/10',
    },
    fuchsia: {
      border: 'border-fuchsia-400',
      text: 'text-fuchsia-300',
      glow: 'shadow-[0_0_24px_-2px_rgba(232,121,249,0.7)]',
      hover: 'hover:shadow-[0_0_32px_0px_rgba(232,121,249,0.9)]',
      bg: 'bg-fuchsia-400/10',
    },
  }[variant];

  const sizeClass = {
    sm: 'h-9 w-9',
    md: 'h-11 w-11',
    lg: 'h-14 w-14',
  }[size];

  const iconSize = {
    sm: 'h-4 w-4',
    md: 'h-5 w-5',
    lg: 'h-7 w-7',
  }[size];

  return (
    <button
      type="button"
      role="switch"
      aria-pressed={on}
      title={title}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={
        'group relative flex shrink-0 select-none items-center justify-center rounded-full border-2 ' +
        sizeClass + ' transition-all duration-300 ease-[cubic-bezier(.4,1.4,.6,1)] ' +
        (on
          ? `${colors.border} ${colors.bg} ${colors.glow} ${colors.hover}`
          : 'border-line-strong bg-bg-soft/70 hover:border-line') +
        ' hover:scale-[1.06] active:scale-[0.94] active:duration-75 ' +
        (disabled ? ' cursor-not-allowed opacity-40' : ' cursor-pointer')
      }
      style={{
        boxShadow: on
          ? undefined
          : 'inset 0 2px 3px rgba(0,0,0,0.4), inset 0 -1px 0 rgba(255,255,255,0.05)',
      }}
    >
      {/* Pulse ring quando ON */}
      {on ? (
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute inset-0 rounded-full border-2 ${colors.border}`}
          style={{ animation: 'darko-pulse 1.6s ease-in-out infinite' }}
        />
      ) : null}

      {/* Icon */}
      <span
        className={
          'flex items-center justify-center transition-all duration-300 ' +
          iconSize + ' ' +
          (on ? colors.text : 'text-text-muted/60')
        }
        style={{
          filter: on ? 'drop-shadow(0 0 8px currentColor)' : undefined,
        }}
      >
        {icon}
      </span>

      <style jsx>{`
        @keyframes darko-pulse {
          0%, 100% { opacity: 0.7; transform: scale(1); }
          50% { opacity: 0.2; transform: scale(1.15); }
        }
      `}</style>
    </button>
  );
}

/**
 * Icone Tesoura — usado no toggle de decupagem por task (ClickUp Pilot).
 */
export function ScissorsIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <line x1="20" y1="4" x2="8.12" y2="15.88" />
      <line x1="14.47" y1="14.48" x2="20" y2="20" />
      <line x1="8.12" y1="8.12" x2="12" y2="12" />
    </svg>
  );
}

/**
 * Icone Wireless (curvas radiando) — usado no Smart Mode VA toggle.
 */
export function WirelessIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {/* Onda externa */}
      <path d="M2 8.5C5 5.5 8.5 4 12 4C15.5 4 19 5.5 22 8.5" />
      {/* Onda media */}
      <path d="M5 12C7 10 9.5 9 12 9C14.5 9 17 10 19 12" />
      {/* Onda interna */}
      <path d="M8.5 15.5C9.5 14.5 10.7 14 12 14C13.3 14 14.5 14.5 15.5 15.5" />
      {/* Ponto central */}
      <circle cx="12" cy="19" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}
