'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

const BATCH_STATE_KEY = 'darkolab:clickup-pilot:batches';

/**
 * Botao 3d pro background tasks no top-bar. Mostra badge com contagem
 * de tasks em processo. Le do mesmo localStorage do ClickUp Pilot.
 */
export function BackgroundTasksButton() {
  const [runningCount, setRunningCount] = useState(0);

  useEffect(() => {
    const compute = () => {
      try {
        const raw = localStorage.getItem(BATCH_STATE_KEY);
        if (!raw) {
          setRunningCount(0);
          return;
        }
        const map = JSON.parse(raw) as Record<string, { phase?: string }>;
        const running = Object.values(map).filter(
          (b) => b.phase && !['done', 'failed'].includes(b.phase),
        ).length;
        setRunningCount(running);
      } catch {
        setRunningCount(0);
      }
    };
    compute();
    const id = setInterval(compute, 2000);
    const onStorage = (e: StorageEvent) => {
      if (e.key === BATCH_STATE_KEY) compute();
    };
    window.addEventListener('storage', onStorage);
    return () => {
      clearInterval(id);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  return (
    <Link
      href="/tools/background"
      aria-label="Abrir Background Tasks"
      title="Background — fila de batches do ClickUp Pilot"
      className="group relative inline-flex select-none items-center gap-2 rounded-full bg-gradient-to-r from-bg-soft/90 to-bg/80 px-3 py-1.5 ring-1 ring-line transition-all duration-300 hover:scale-[1.04] hover:ring-fuchsia-400/60 active:scale-[0.96]"
      style={{
        boxShadow:
          '0 0 14px -6px rgba(217,70,239,0.3), 0 0 30px -12px rgba(217,70,239,0.2), inset 0 1px 0 rgba(255,255,255,0.05), inset 0 -1px 0 rgba(0,0,0,0.4)',
      }}
    >
      <span className="relative z-10 flex h-5 w-5 shrink-0 items-center justify-center text-text-muted group-hover:text-fuchsia-300">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
          <rect x="3" y="4" width="18" height="6" rx="1" />
          <rect x="3" y="14" width="18" height="6" rx="1" />
          <circle cx="7" cy="7" r="0.5" fill="currentColor" />
          <circle cx="7" cy="17" r="0.5" fill="currentColor" />
        </svg>
      </span>
      <span className="relative z-10 hidden text-[11px] font-bold uppercase tracking-widest text-text-muted group-hover:text-fuchsia-200 md:inline">
        Background
      </span>
      {runningCount > 0 ? (
        <span className="relative z-10 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-fuchsia-500/80 px-1.5 text-[10px] font-bold text-white shadow-[0_0_10px_-2px_rgba(217,70,239,0.6)]">
          {runningCount}
        </span>
      ) : null}
    </Link>
  );
}
