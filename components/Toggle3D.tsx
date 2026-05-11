'use client';

/**
 * Toggle3D — botao 3D animado ON/OFF.
 *
 * Visual: pill com "thumb" deslizante. Quando OFF fica meio apagado (cinza
 * + sombra interna sutil). Quando ON fica aceso (lime, glow, sombra externa).
 * Hover scale + glow pulse. Click feedback (press depth).
 *
 * Acessibilidade: button[aria-pressed], suporta keyboard (Space/Enter via
 * comportamento default de button).
 */
export function Toggle3D({
  on,
  onChange,
  label,
  hint,
  icon,
  disabled = false,
  variant = 'lime',
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hint?: string;
  icon?: React.ReactNode;
  disabled?: boolean;
  variant?: 'lime' | 'cyan' | 'fuchsia';
}) {
  const colorClasses = {
    lime: {
      border: 'border-lime',
      bg: 'bg-lime',
      glow: 'shadow-[0_0_24px_-4px_rgba(200,255,0,0.6),0_0_60px_-12px_rgba(200,255,0,0.4)]',
      glowHover: 'hover:shadow-[0_0_32px_-2px_rgba(200,255,0,0.8),0_0_80px_-12px_rgba(200,255,0,0.5)]',
      text: 'text-lime',
      ring: 'ring-lime/40',
    },
    cyan: {
      border: 'border-cyan-400',
      bg: 'bg-cyan-400',
      glow: 'shadow-[0_0_24px_-4px_rgba(34,211,238,0.6),0_0_60px_-12px_rgba(34,211,238,0.4)]',
      glowHover: 'hover:shadow-[0_0_32px_-2px_rgba(34,211,238,0.8),0_0_80px_-12px_rgba(34,211,238,0.5)]',
      text: 'text-cyan-300',
      ring: 'ring-cyan-400/40',
    },
    fuchsia: {
      border: 'border-fuchsia-400',
      bg: 'bg-fuchsia-400',
      glow: 'shadow-[0_0_24px_-4px_rgba(232,121,249,0.6),0_0_60px_-12px_rgba(232,121,249,0.4)]',
      glowHover: 'hover:shadow-[0_0_32px_-2px_rgba(232,121,249,0.8),0_0_80px_-12px_rgba(232,121,249,0.5)]',
      text: 'text-fuchsia-300',
      ring: 'ring-fuchsia-400/40',
    },
  }[variant];

  return (
    <button
      type="button"
      role="switch"
      aria-pressed={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={
        'group relative flex select-none items-center gap-3 rounded-2xl border-2 bg-bg-soft/80 px-3.5 py-2.5 text-left transition-all duration-300 ease-[cubic-bezier(.4,1.4,.6,1)] backdrop-blur-md ' +
        // Border + glow shifts on/off
        (on ? `${colorClasses.border} ${colorClasses.glow} ${colorClasses.glowHover}` : 'border-line hover:border-line-strong') +
        ' hover:scale-[1.02] active:scale-[0.97] active:duration-75 ' +
        (disabled ? ' cursor-not-allowed opacity-40' : ' cursor-pointer')
      }
      style={{
        // Subtle 3D bevel via inset shadow
        boxShadow: on
          ? undefined
          : 'inset 0 1px 0 rgba(255,255,255,0.04), inset 0 -1px 0 rgba(0,0,0,0.4)',
        transformStyle: 'preserve-3d',
      }}
    >
      {/* Icon (apagado quando OFF, aceso quando ON) */}
      {icon ? (
        <span
          className={
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-all duration-300 ' +
            (on ? `${colorClasses.text} bg-bg/60` : 'text-text-muted bg-bg/40')
          }
          style={{
            // Mini 3D bevel no icone
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), inset 0 -1px 1px rgba(0,0,0,0.5)',
          }}
        >
          {icon}
        </span>
      ) : null}

      {/* Label + hint */}
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className={'mono text-[11px] font-bold uppercase tracking-widest transition-colors ' + (on ? colorClasses.text : 'text-text-muted')}>
          {label}
          <span className={'ml-1.5 ' + (on ? 'text-white' : 'text-text-muted')}>
            {on ? 'ON' : 'OFF'}
          </span>
        </span>
        {hint ? (
          <span className="mono mt-0.5 text-[9px] uppercase tracking-widest text-text-muted">
            {hint}
          </span>
        ) : null}
      </span>

      {/* Switch 3D — pill com thumb deslizante e bevel */}
      <span
        className={
          'relative h-6 w-11 shrink-0 rounded-full transition-all duration-300 ' +
          (on ? colorClasses.bg : 'bg-bg-soft')
        }
        style={{
          boxShadow: on
            ? `inset 0 1px 2px rgba(0,0,0,0.3), 0 0 12px rgba(200,255,0,0.4)`
            : 'inset 0 2px 4px rgba(0,0,0,0.5), inset 0 -1px 0 rgba(255,255,255,0.04)',
        }}
      >
        <span
          className={
            'absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all duration-[280ms] ease-[cubic-bezier(.5,1.6,.3,1)] ' +
            (on ? 'translate-x-[22px]' : 'translate-x-0.5')
          }
          style={{
            // 3D ball: top highlight + bottom shadow
            boxShadow: on
              ? '0 2px 6px rgba(0,0,0,0.4), inset 0 1px 1px rgba(255,255,255,0.6), inset 0 -1px 1px rgba(0,0,0,0.15)'
              : '0 1px 3px rgba(0,0,0,0.5), inset 0 1px 1px rgba(255,255,255,0.5), inset 0 -1px 1px rgba(0,0,0,0.2)',
          }}
        />
      </span>
    </button>
  );
}
