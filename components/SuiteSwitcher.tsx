'use client';

import { useRouter } from 'next/navigation';
import { IconSparkle, IconWrench } from './ToolIcons';

export type Suite = 'base' | 'ai';

/**
 * SuiteSwitcher — toggle animado entre Base Suite e AI Suite.
 *
 * Visual: pill de duas opcoes, com um "thumb" lime que desliza pro lado ativo.
 * Ao clicar numa opcao inativa, navega pra primeira ferramenta daquele suite.
 *
 * Props:
 * - active: suite atual detectado pelo layout via URL
 * - baseHref: href da primeira ferramenta Base (ex: /tools/decupagem)
 * - aiHref: href da primeira ferramenta AI (ex: /tools/auto-broll)
 */
export function SuiteSwitcher({
  active,
  baseHref,
  aiHref,
}: {
  /** `null` = nenhum suite ativo (ex: pagina especial fora de Base/AI como ClickUp Pilot) */
  active: Suite | null;
  baseHref: string;
  aiHref: string;
}) {
  const router = useRouter();

  function go(to: Suite) {
    if (to === active) return;
    router.push(to === 'base' ? baseHref : aiHref);
  }

  return (
    <div
      className="suite-switcher relative inline-flex items-center rounded-full border border-line-strong bg-bg-soft/70 p-1 shadow-depth-1 backdrop-blur-sm"
      role="tablist"
      aria-label="Alternar entre Base Suite e AI Suite"
    >
      {/* Thumb animado (destaque lime deslizante). Quando active=null,
       *  some completamente (opacity-0 + scale-0) — nenhuma das duas
       *  opcoes fica marcada. */}
      <span
        aria-hidden
        className={
          'suite-thumb absolute top-1 bottom-1 left-1 w-[calc(50%-4px)] rounded-full bg-lime shadow-[0_0_0_1px_rgba(200,255,0,0.3),0_0_28px_-4px_rgba(200,255,0,0.65)] transition-all duration-[420ms] ease-[cubic-bezier(.5,1.6,.3,1)] ' +
          (active === null
            ? 'scale-0 opacity-0'
            : active === 'ai'
            ? 'translate-x-full'
            : 'translate-x-0')
        }
      />

      <button
        type="button"
        role="tab"
        aria-selected={active === 'base'}
        onClick={() => go('base')}
        className={
          'relative z-10 flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-widest transition-colors duration-300 ' +
          (active === 'base'
            ? 'text-black'
            : 'text-text-muted hover:text-white')
        }
      >
        <IconWrench size={14} strokeWidth={2} />
        Base Suite
      </button>

      <button
        type="button"
        role="tab"
        aria-selected={active === 'ai'}
        onClick={() => go('ai')}
        className={
          'relative z-10 flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-widest transition-colors duration-300 ' +
          (active === 'ai' ? 'text-black' : 'text-text-muted hover:text-white')
        }
      >
        <IconSparkle size={14} strokeWidth={2} />
        AI Suite
      </button>
    </div>
  );
}
