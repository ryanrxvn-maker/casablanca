'use client';

import Link from 'next/link';

/**
 * Botão pra Histórico HeyGen no top-bar — acesso rápido à lista de vídeos
 * que o user gerou (60 dias de retenção pela API HeyGen).
 */
export function HeyGenHistoryButton() {
  return (
    <Link
      href="/tools/heygen-history"
      aria-label="Abrir Histórico HeyGen"
      title="Histórico de vídeos HeyGen (60 dias de retenção)"
      className="group relative inline-flex select-none items-center gap-2 rounded-full bg-gradient-to-r from-bg-soft/90 to-bg/80 px-3 py-1.5 ring-1 ring-line transition-all duration-300 hover:scale-[1.04] hover:ring-cyan-400/60 active:scale-[0.96]"
      style={{
        boxShadow:
          '0 0 14px -6px rgba(34,211,238,0.3), 0 0 30px -12px rgba(34,211,238,0.2), inset 0 1px 0 rgba(255,255,255,0.05), inset 0 -1px 0 rgba(0,0,0,0.4)',
      }}
    >
      <span className="relative z-10 flex h-5 w-5 shrink-0 items-center justify-center text-text-muted group-hover:text-cyan-300">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
          <path d="M12 8v4l3 2" />
          <circle cx="12" cy="12" r="10" />
        </svg>
      </span>
      <span className="relative z-10 hidden text-[11px] font-bold uppercase tracking-widest text-text-muted group-hover:text-cyan-200 md:inline">
        Histórico HG
      </span>
    </Link>
  );
}
