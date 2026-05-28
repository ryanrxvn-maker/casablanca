'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Toggle3DIcon — switch 3D animado COMPACTO e SEM TEXTO (só ícone + pill).
 *
 * Pequeno o bastante pra caber inline. Ao LIGAR dispara um burst animado
 * (anel que expande + flash do ícone). Bevel 3D, glow quando ON, thumb com
 * mola. Tooltip via aria-label/title (sem texto visível).
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
    lime: { bg: 'bg-lime', text: 'text-lime', ring: 'rgba(200,255,0,0.7)', glow: '0 0 12px rgba(200,255,0,0.55)' },
    cyan: { bg: 'bg-cyan-400', text: 'text-cyan-300', ring: 'rgba(34,211,238,0.7)', glow: '0 0 12px rgba(34,211,238,0.55)' },
    fuchsia: { bg: 'bg-fuchsia-400', text: 'text-fuchsia-300', ring: 'rgba(232,121,249,0.7)', glow: '0 0 12px rgba(232,121,249,0.55)' },
  }[variant];

  // Burst one-shot quando transiciona OFF -> ON
  const prev = useRef(on);
  const [burst, setBurst] = useState(0);
  useEffect(() => {
    if (on && !prev.current) setBurst((n) => n + 1);
    prev.current = on;
  }, [on]);

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
        'group relative flex select-none items-center gap-1.5 rounded-xl border bg-bg-soft/80 p-1.5 transition-all duration-300 ease-[cubic-bezier(.4,1.4,.6,1)] backdrop-blur-md ' +
        (on ? `border-current ${c.text}` : 'border-line hover:border-line-strong') +
        ' hover:scale-[1.06] active:scale-[0.92] active:duration-75 ' +
        (disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer')
      }
      style={{
        boxShadow: on ? c.glow : 'inset 0 1px 0 rgba(255,255,255,0.04), inset 0 -1px 0 rgba(0,0,0,0.4)',
        transformStyle: 'preserve-3d',
      }}
    >
      {/* Burst ring (replay a cada ON via key) */}
      {burst > 0 ? (
        <span
          key={burst}
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-xl"
          style={{ border: `2px solid ${c.ring}`, animation: 'tg3d-burst 600ms ease-out forwards' }}
        />
      ) : null}

      {icon ? (
        <span
          key={`icon-${burst}`}
          className={
            'flex h-5 w-5 shrink-0 items-center justify-center rounded-md transition-all duration-300 ' +
            (on ? `${c.text} bg-bg/60` : 'text-text-muted bg-bg/40')
          }
          style={{
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), inset 0 -1px 1px rgba(0,0,0,0.5)',
            animation: on && burst > 0 ? 'tg3d-flash 500ms ease-out' : undefined,
          }}
        >
          {icon}
        </span>
      ) : null}

      {/* Pill 3D compacto */}
      <span
        className={'relative h-5 w-9 shrink-0 rounded-full transition-all duration-300 ' + (on ? c.bg : 'bg-bg-soft')}
        style={{
          boxShadow: on
            ? 'inset 0 1px 2px rgba(0,0,0,0.3)'
            : 'inset 0 2px 4px rgba(0,0,0,0.5), inset 0 -1px 0 rgba(255,255,255,0.04)',
        }}
      >
        <span
          className={
            'absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all duration-[280ms] ease-[cubic-bezier(.5,1.6,.3,1)] ' +
            (on ? 'translate-x-[18px]' : 'translate-x-0.5')
          }
          style={{
            boxShadow: on
              ? '0 2px 5px rgba(0,0,0,0.4), inset 0 1px 1px rgba(255,255,255,0.6)'
              : '0 1px 3px rgba(0,0,0,0.5), inset 0 1px 1px rgba(255,255,255,0.5)',
          }}
        />
      </span>

      <style jsx>{`
        @keyframes tg3d-burst {
          0% { transform: scale(1); opacity: 0.9; }
          100% { transform: scale(1.7); opacity: 0; }
        }
        @keyframes tg3d-flash {
          0% { transform: scale(1); }
          40% { transform: scale(1.35) rotate(-8deg); }
          100% { transform: scale(1) rotate(0deg); }
        }
      `}</style>
    </button>
  );
}
