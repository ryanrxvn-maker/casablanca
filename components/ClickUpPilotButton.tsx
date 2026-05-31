'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

const BATCH_STATE_KEY = 'darkolab:clickup-pilot:batches';

function readActiveBatchCount(): number {
  if (typeof window === 'undefined') return 0;
  try {
    const raw = localStorage.getItem(BATCH_STATE_KEY);
    if (!raw) return 0;
    const states = JSON.parse(raw) as Record<string, { phase?: string }>;
    let n = 0;
    for (const s of Object.values(states)) {
      if (s.phase && s.phase !== 'done' && s.phase !== 'failed') n++;
    }
    return n;
  } catch {
    return 0;
  }
}

/**
 * ClickUpPilotButton v4 — ícone-only no top-bar.
 * Acende em lime quando há tarefa ativa.
 */
export function ClickUpPilotButton() {
  const [activeBatches, setActiveBatches] = useState(0);

  useEffect(() => {
    let alive = true;
    function check() {
      if (!alive) return;
      setActiveBatches(readActiveBatchCount());
    }
    check();
    const id = setInterval(check, 3000);
    function onStorage(e: StorageEvent) {
      if (e.key === BATCH_STATE_KEY) check();
    }
    window.addEventListener('storage', onStorage);
    return () => {
      alive = false;
      clearInterval(id);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const active = activeBatches > 0;

  return (
    <Link
      href="/tools/clickup-pilot"
      aria-label="ClickUp Pilot"
      title={active ? `ClickUp Pilot · ${activeBatches} ativo${activeBatches === 1 ? '' : 's'}` : 'ClickUp Pilot'}
      className="topbar-icon group"
      style={{
        ['--ti-color' as string]: active ? '#c2cf86' : '#9c9ca6',
        ['--ti-glow' as string]: active ? 'rgba(200,232,124,0.55)' : 'transparent',
      }}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="17" height="17">
        {/* Foguete piloto */}
        <path d="M4.5 16.5l3 3 1-3 3-3 5-8a4 4 0 014 4l-8 5-3 3-3 1z" />
        <circle cx="14" cy="10" r="1.5" fill="currentColor" />
      </svg>
      {active ? (
        <span className="topbar-icon-badge" style={{ background: '#c2cf86', color: '#0a0a0a' }}>
          {activeBatches > 9 ? '9+' : activeBatches}
        </span>
      ) : null}
    </Link>
  );
}
