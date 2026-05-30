'use client';

import React from 'react';

/**
 * Selo de manutenção que fica SOBRE o card da ferramenta. Ao passar o mouse
 * em cima do ícone, abre um mini-card explicando o aviso.
 *
 * IMPORTANTE: deve ser renderizado FORA do card (que tem overflow-hidden),
 * senão o mini-card é cortado. No ToolsHub ele é irmão do card, num wrapper
 * relative.
 *
 *   mode='blocked' → cliente comum (sem acesso). Tom de aviso.
 *   mode='admin'   → conta admin (acessa pra testar). Tom informativo.
 */
function WrenchIcon({ size = 13 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M14.5 5.5a3.6 3.6 0 0 0-4.7 4.7L3.3 16.7a1.8 1.8 0 0 0 0 2.5l1.5 1.5a1.8 1.8 0 0 0 2.5 0l6.5-6.5a3.6 3.6 0 0 0 4.7-4.7l-2.2 2.2-2.3-.6-.6-2.3 2.1-2z" />
    </svg>
  );
}

export function MaintenanceBadge({
  mode = 'blocked',
  className = 'right-3 top-3',
}: {
  mode?: 'blocked' | 'admin';
  className?: string;
}) {
  return (
    <span className={'group/maint pointer-events-auto absolute z-30 ' + className}>
      {/* ── Ícone de aviso ── */}
      <span
        className="relative flex h-[26px] w-[26px] cursor-help items-center justify-center rounded-full border border-amber-400/55 bg-[#1b1409] text-amber-300 transition-transform duration-300 group-hover/maint:scale-110"
        style={{ boxShadow: '0 0 16px -3px rgba(251,191,36,0.65), inset 0 1px 0 rgba(255,255,255,0.08)' }}
      >
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400/25" />
        <span className="relative">
          <WrenchIcon />
        </span>
      </span>

      {/* ── Mini-card (hover) ── abre abaixo, alinhado à direita ── */}
      <span
        role="tooltip"
        className="pointer-events-none absolute right-0 top-full z-40 mt-2.5 w-[238px] origin-top-right translate-y-1 scale-95 opacity-0 transition-all duration-200 ease-out group-hover/maint:translate-y-0 group-hover/maint:scale-100 group-hover/maint:opacity-100"
      >
        {/* seta */}
        <span
          className="absolute right-[7px] -top-[5px] h-2.5 w-2.5 rotate-45 border-l border-t border-amber-400/30"
          style={{ background: '#0e0b06' }}
        />
        <span
          className="block overflow-hidden rounded-[15px] border border-amber-400/25"
          style={{
            background: 'linear-gradient(180deg, #14100a 0%, #0c0a06 100%)',
            boxShadow: '0 16px 44px -10px rgba(0,0,0,0.75), 0 0 0 1px rgba(251,191,36,0.04)',
            backdropFilter: 'blur(14px)',
          }}
        >
          <span
            className="block h-[3px] w-full"
            style={{ background: 'linear-gradient(90deg, transparent, rgba(251,191,36,0.95), transparent)' }}
          />
          <span className="block px-4 py-3.5">
            <span className="flex items-center gap-2">
              <span className="text-amber-300">
                <WrenchIcon size={14} />
              </span>
              <span
                className="text-[12.5px] font-bold tracking-tight text-amber-200"
                style={{ fontFamily: 'var(--font-tech)' }}
              >
                {mode === 'admin' ? 'Em manutenção · admin' : 'Em manutenção'}
              </span>
            </span>
            <span className="mt-2 block text-[12px] leading-relaxed text-text-muted">
              {mode === 'admin'
                ? 'Indisponível pros clientes agora. Você acessa porque é admin — use pra testar antes de liberar.'
                : 'Estamos dando um ajuste rápido nesta ferramenta. Ela volta já. 🛠️'}
            </span>
          </span>
        </span>
      </span>
    </span>
  );
}
