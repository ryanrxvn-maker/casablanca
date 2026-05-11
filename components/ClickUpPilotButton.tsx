'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { IconClickUpPilot } from './ToolIcons';

const BATCH_STATE_KEY = 'darkolab:clickup-pilot:batches';

/** Le batchStates do localStorage e retorna true se ha pelo menos UMA task
 *  rodando em background (phase != done && != failed). Usado pra acender o
 *  badge "ATIVO" no botao do top-bar. */
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
 * Botao especial 3D animado pra ClickUp Pilot — fica no top-bar do lado
 * do dropdown do user (em vez de so na sidebar das ferramentas).
 *
 * O badge "ATIVO" aparece SO quando ha task rodando em background no Pilot
 * (phase pos != done/failed). Acessar a pagina nao acende o badge — ele
 * indica processamento ativo, nao localizacao do user.
 */
export function ClickUpPilotButton() {
  const [activeBatches, setActiveBatches] = useState(0);

  useEffect(() => {
    let alive = true;
    function check() {
      if (!alive) return;
      setActiveBatches(readActiveBatchCount());
    }
    // Initial + poll a cada 3s (cheap, localStorage read e instantaneo)
    check();
    const id = setInterval(check, 3000);
    // Tambem escuta storage event pra atualizar instantaneamente entre tabs
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
      aria-label="Abrir ClickUp Pilot"
      className={
        'group relative inline-flex select-none items-center gap-2 rounded-full px-4 py-1.5 transition-all duration-300 ease-[cubic-bezier(.4,1.4,.6,1)] hover:scale-[1.04] active:scale-[0.96] active:duration-75 ' +
        (active
          ? 'bg-gradient-to-r from-lime/30 to-cyan-400/20 ring-2 ring-lime'
          : 'bg-gradient-to-r from-bg-soft/90 to-bg/80 ring-1 ring-line hover:ring-lime/70')
      }
      style={{
        boxShadow: active
          ? '0 0 20px -2px rgba(200,255,0,0.6), 0 0 40px -8px rgba(34,211,238,0.4), inset 0 1px 0 rgba(255,255,255,0.08), inset 0 -1px 0 rgba(0,0,0,0.5)'
          : '0 0 14px -6px rgba(200,255,0,0.3), 0 0 30px -12px rgba(34,211,238,0.2), inset 0 1px 0 rgba(255,255,255,0.05), inset 0 -1px 0 rgba(0,0,0,0.4)',
      }}
    >
      {/* Animated radial glow background — pulsa subtil em hover */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-full opacity-0 transition-opacity duration-500 group-hover:opacity-100"
        style={{
          background: 'radial-gradient(circle at 30% 50%, rgba(200,255,0,0.18), transparent 60%), radial-gradient(circle at 70% 50%, rgba(34,211,238,0.15), transparent 65%)',
        }}
      />

      {/* Icone com float animation sutil */}
      <span
        className={
          'relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-all duration-300 ' +
          (active ? 'text-lime' : 'text-text-muted group-hover:text-lime')
        }
        style={{
          transform: active ? 'translateY(-1px)' : undefined,
          filter: active ? 'drop-shadow(0 0 4px rgba(200,255,0,0.6))' : undefined,
        }}
      >
        <IconClickUpPilot size={16} strokeWidth={1.8} />
      </span>

      {/* Label */}
      <span
        className={
          'relative z-10 hidden text-[11px] font-bold uppercase tracking-widest transition-colors md:inline ' +
          (active ? 'text-lime' : 'text-text-muted group-hover:text-white')
        }
      >
        ClickUp Pilot
      </span>

      {/* Sticker ATIVO so quando ha batch rodando */}
      {active ? (
        <span
          className="relative z-10 mono ml-1 rounded-full bg-lime/30 px-1.5 py-0.5 text-[8px] uppercase tracking-widest text-lime"
          title={`${activeBatches} task${activeBatches === 1 ? '' : 's'} rodando em background`}
        >
          {activeBatches > 1 ? `${activeBatches} ATIVOS` : 'ATIVO'}
        </span>
      ) : null}

      {/* Sparkle decorativo no canto — sempre presente mas mais brilhante quando ativo */}
      <span
        aria-hidden
        className={
          'pointer-events-none absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-lime ' +
          (active ? 'animate-pulse opacity-80' : 'opacity-40')
        }
        style={{
          boxShadow: active ? '0 0 8px rgba(200,255,0,0.8)' : '0 0 4px rgba(200,255,0,0.4)',
          animationDuration: '2.4s',
        }}
      />
    </Link>
  );
}
