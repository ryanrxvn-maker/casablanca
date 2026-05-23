'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

const BATCH_STATE_KEY = 'darkolab:clickup-pilot:batches';

/**
 * BackgroundTasksButton v4 — ícone-only com badge numérico.
 * Mostra quantas tarefas estão rodando.
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

  const active = runningCount > 0;

  return (
    <Link
      href="/tools/background"
      aria-label="Tarefas em segundo plano"
      title={active ? `${runningCount} em andamento` : 'Tarefas em segundo plano'}
      className="topbar-icon group"
      style={{
        ['--ti-color' as string]: active ? '#d946ef' : '#9c9ca6',
        ['--ti-glow' as string]: active ? 'rgba(217,70,239,0.5)' : 'transparent',
      }}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="17" height="17">
        <rect x="3" y="4" width="18" height="6" rx="1.5" />
        <rect x="3" y="14" width="18" height="6" rx="1.5" />
        <circle cx="7" cy="7" r="0.6" fill="currentColor" />
        <circle cx="7" cy="17" r="0.6" fill="currentColor" />
      </svg>
      {active ? (
        <span className="topbar-icon-badge" style={{ background: '#d946ef' }}>
          {runningCount > 9 ? '9+' : runningCount}
        </span>
      ) : null}
    </Link>
  );
}
