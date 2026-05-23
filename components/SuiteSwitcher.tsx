'use client';

import { useRouter } from 'next/navigation';
import { IconSparkle, IconWrench } from './ToolIcons';

export type Suite = 'base' | 'ai';

/**
 * SuiteSwitcher v2 — toggle Base / AI com thumb deslizante.
 *
 * O thumb usa cor diferente pra cada lado pra criar narrativa:
 *  - Base   → tom neutro (cinza claro)
 *  - AI     → tom violet (premium / inteligencia)
 * Isso reduz a dominancia do lime sem perder o destaque do ativo.
 */
export function SuiteSwitcher({
  active,
  baseHref,
  aiHref,
}: {
  active: Suite | null;
  baseHref: string;
  aiHref: string;
}) {
  const router = useRouter();

  function go(to: Suite) {
    if (to === active) return;
    router.push(to === 'base' ? baseHref : aiHref);
  }

  const isAi = active === 'ai';
  const isBase = active === 'base';

  return (
    <div
      className="suite-switcher relative inline-flex items-center rounded-full border border-line-strong bg-bg-soft/70 p-1 shadow-depth-1 backdrop-blur-md"
      role="tablist"
      aria-label="Alternar entre Base e AI"
    >
      <span
        aria-hidden
        className={
          'absolute top-1 bottom-1 left-1 w-[calc(50%-4px)] rounded-full transition-all duration-[480ms] ease-[cubic-bezier(.5,1.6,.3,1)] ' +
          (active === null
            ? 'scale-0 opacity-0'
            : isAi
              ? 'translate-x-full'
              : 'translate-x-0')
        }
        style={{
          background: isAi
            ? 'linear-gradient(135deg, #a78bfa, #6d4ee8)'
            : isBase
              ? 'linear-gradient(135deg, #e5e5ea, #c5c5d0)'
              : 'transparent',
          boxShadow: isAi
            ? '0 0 0 1px rgba(167,139,250,0.4), 0 0 28px -4px rgba(167,139,250,0.7)'
            : isBase
              ? '0 0 0 1px rgba(255,255,255,0.18), 0 8px 18px -6px rgba(0,0,0,0.5)'
              : 'none',
        }}
      />

      <button
        type="button"
        role="tab"
        aria-selected={isBase}
        onClick={() => go('base')}
        className={
          'relative z-10 flex items-center gap-2 rounded-full px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] transition-colors duration-300 ' +
          (isBase ? 'text-black' : 'text-text-muted hover:text-white')
        }
        style={{ fontFamily: 'var(--font-tech)' }}
      >
        <IconWrench size={13} strokeWidth={2} />
        Base
      </button>

      <button
        type="button"
        role="tab"
        aria-selected={isAi}
        onClick={() => go('ai')}
        className={
          'relative z-10 flex items-center gap-2 rounded-full px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] transition-colors duration-300 ' +
          (isAi ? 'text-white' : 'text-text-muted hover:text-white')
        }
        style={{ fontFamily: 'var(--font-tech)' }}
      >
        <IconSparkle size={13} strokeWidth={2} />
        AI
      </button>
    </div>
  );
}
