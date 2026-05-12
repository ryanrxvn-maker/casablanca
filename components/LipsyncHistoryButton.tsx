'use client';

import Link from 'next/link';

/**
 * Botao 3D pra DARKO LAB Lipsync History no top-bar.
 * Lista TODOS os lipsyncs gerados pelo DARKO LAB (batches + VA) — sem
 * limite de 60 dias como o HeyGen API; persiste localmente.
 */
export function LipsyncHistoryButton() {
  return (
    <Link
      href="/tools/lipsync-history"
      aria-label="Historico DARKO LAB"
      title="Lipsync History — todos os lipsyncs gerados pelo DARKO LAB"
      className="group relative inline-flex select-none items-center gap-2 rounded-full bg-gradient-to-r from-bg-soft/90 to-bg/80 px-3 py-1.5 ring-1 ring-line transition-all duration-300 hover:scale-[1.04] hover:ring-lime/60 active:scale-[0.96]"
      style={{
        boxShadow:
          '0 0 14px -6px rgba(200,255,0,0.32), 0 0 30px -12px rgba(200,255,0,0.22), inset 0 1px 0 rgba(255,255,255,0.05), inset 0 -1px 0 rgba(0,0,0,0.4)',
      }}
    >
      <span className="relative z-10 flex h-5 w-5 shrink-0 items-center justify-center text-text-muted group-hover:text-lime">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M3 9h18" />
          <path d="M9 3v18" />
        </svg>
      </span>
      <span className="relative z-10 hidden text-[11px] font-bold uppercase tracking-widest text-text-muted group-hover:text-lime md:inline">
        Lipsyncs
      </span>
    </Link>
  );
}
