'use client';

import Link from 'next/link';

/**
 * HistoryButton — atalho do Histórico geral no top-bar.
 */
export function HistoryButton() {
  return (
    <Link
      href="/tools/historico"
      aria-label="Histórico geral"
      title="Histórico geral"
      className="topbar-icon group"
      style={{
        ['--ti-color' as string]: '#9c9ca6',
        ['--ti-glow' as string]: 'transparent',
      }}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        width="17"
        height="17"
      >
        <path d="M3 12a9 9 0 1 0 3-6.7" />
        <path d="M3 4v4h4" />
        <path d="M12 8v4l3 2" />
      </svg>
    </Link>
  );
}
