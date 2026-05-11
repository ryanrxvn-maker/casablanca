'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { IconClickUpPilot } from './ToolIcons';

/**
 * Botao especial 3D animado pra ClickUp Pilot — fica no top-bar do lado
 * do dropdown do user (em vez de so na sidebar das ferramentas).
 *
 * Visual:
 * - Pill com gradient lime->cyan, glow profundo, bevel 3D
 * - Hover: scale + glow intensifica + sparkle pulsa
 * - Click: depth (scale down)
 * - Quando voce ja esta na pagina /tools/clickup-pilot: borda lime full + sticker "ATIVO"
 *
 * Tecnologia visual:
 * - Background gradient com radial glow
 * - Borda double-layer (outer ring + inner shadow)
 * - Icon flutua com animation
 */
export function ClickUpPilotButton() {
  const pathname = usePathname();
  const active = pathname?.startsWith('/tools/clickup-pilot') ?? false;

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

      {/* Sticker ATIVO */}
      {active ? (
        <span className="relative z-10 mono ml-1 rounded-full bg-lime/30 px-1.5 py-0.5 text-[8px] uppercase tracking-widest text-lime">
          ATIVO
        </span>
      ) : (
        <span
          aria-hidden
          className="relative z-10 mono hidden rounded-full bg-cyan-400/15 px-1.5 py-0.5 text-[8px] uppercase tracking-widest text-cyan-300 md:inline-block"
        >
          AUTO
        </span>
      )}

      {/* Sparkle decorativo no canto */}
      <span
        aria-hidden
        className="pointer-events-none absolute -right-0.5 -top-0.5 h-2 w-2 animate-pulse rounded-full bg-lime opacity-80"
        style={{
          boxShadow: '0 0 8px rgba(200,255,0,0.8)',
          animationDuration: '2.4s',
        }}
      />
    </Link>
  );
}
