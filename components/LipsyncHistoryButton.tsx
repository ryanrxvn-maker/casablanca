'use client';

import Link from 'next/link';

/**
 * LipsyncHistoryButton v4 — ícone-only no top-bar.
 */
export function LipsyncHistoryButton() {
  return (
    <Link
      href="/tools/lipsync-history"
      aria-label="Histórico de avatares"
      title="Histórico de avatares"
      className="topbar-icon group"
      style={{
        ['--ti-color' as string]: '#9c9ca6',
        ['--ti-glow' as string]: 'transparent',
      }}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="17" height="17">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
    </Link>
  );
}
