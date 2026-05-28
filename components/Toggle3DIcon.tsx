'use client';

/**
 * Toggle3DIcon — switch 3D animado SEM TEXTO (só ícone + pill deslizante).
 *
 * Igual ao Toggle3D porém sem label/hint: serve pra botões compactos dentro
 * de modais onde o texto explicativo fica ao lado. Bevel 3D, glow quando ON,
 * thumb com mola, hover scale.
 */
export function Toggle3DIcon({
  on,
  onChange,
  ariaLabel,
  icon,
  disabled = false,
  variant = 'cyan',
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  ariaLabel: string;
  icon?: React.ReactNode;
  disabled?: boolean;
  variant?: 'lime' | 'cyan' | 'fuchsia';
}) {
  const c = {
    lime: { bg: 'bg-lime', text: 'text-lime', glow: '0 0 14px rgba(200,255,0,0.5)' },
    cyan: { bg: 'bg-cyan-400', text: 'text-cyan-300', glow: '0 0 14px rgba(34,211,238,0.5)' },
    fuchsia: { bg: 'bg-fuchsia-400', text: 'text-fuchsia-300', glow: '0 0 14px rgba(232,121,249,0.5)' },
  }[variant];

  return (
    <button
      type="button"
      role="switch"
      aria-pressed={on}
      aria-label={ariaLabel}
      title={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={
        'group relative flex select-none items-center gap-2 rounded-2xl border-2 bg-bg-soft/80 p-2 transition-all duration-300 ease-[cubic-bezier(.4,1.4,.6,1)] backdrop-blur-md ' +
        (on ? `border-current ${c.text}` : 'border-line hover:border-line-strong') +
        ' hover:scale-[1.04] active:scale-[0.95] active:duration-75 ' +
        (disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer')
      }
      style={{
        boxShadow: on ? c.glow : 'inset 0 1px 0 rgba(255,255,255,0.04), inset 0 -1px 0 rgba(0,0,0,0.4)',
        transformStyle: 'preserve-3d',
      }}
    >
      {icon ? (
        <span
          className={
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-all duration-300 ' +
            (on ? `${c.text} bg-bg/60` : 'text-text-muted bg-bg/40')
          }
          style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), inset 0 -1px 1px rgba(0,0,0,0.5)' }}
        >
          {icon}
        </span>
      ) : null}

      {/* Pill 3D */}
      <span
        className={'relative h-6 w-11 shrink-0 rounded-full transition-all duration-300 ' + (on ? c.bg : 'bg-bg-soft')}
        style={{
          boxShadow: on
            ? 'inset 0 1px 2px rgba(0,0,0,0.3)'
            : 'inset 0 2px 4px rgba(0,0,0,0.5), inset 0 -1px 0 rgba(255,255,255,0.04)',
        }}
      >
        <span
          className={
            'absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all duration-[280ms] ease-[cubic-bezier(.5,1.6,.3,1)] ' +
            (on ? 'translate-x-[22px]' : 'translate-x-0.5')
          }
          style={{
            boxShadow: on
              ? '0 2px 6px rgba(0,0,0,0.4), inset 0 1px 1px rgba(255,255,255,0.6)'
              : '0 1px 3px rgba(0,0,0,0.5), inset 0 1px 1px rgba(255,255,255,0.5)',
          }}
        />
      </span>
    </button>
  );
}
