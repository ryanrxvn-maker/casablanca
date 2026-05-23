'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

export type RailItem = {
  href: string;
  label: string;
  icon: ReactNode;
  /** só aparece/abre pra conta admin */
  adminOnly?: boolean;
};

/**
 * ToolRail v2 — sidebar flutuante com motion 3D.
 *
 * Mudancas:
 *  - Indicador ativo: barra lateral animada (em vez de scale + dot) → mais "macOS"
 *  - Tooltip: micro-card com sombra + animacao spring
 *  - Cor ativa: violet (reduzir presenca lime)
 *  - Mobile: scroll horizontal mais elegante, com snap
 */
export function ToolRail({ items }: { items: RailItem[] }) {
  const pathname = usePathname();
  const [mountKey, setMountKey] = useState(0);
  useEffect(() => {
    setMountKey((k) => k + 1);
  }, [items.length, items.map((i) => i.href).join('|')]);

  return (
    <>
      {/* Desktop: rail vertical flutuante */}
      <aside
        key={mountKey}
        aria-label="Ferramentas"
        className="pointer-events-none fixed left-4 top-1/2 z-20 hidden -translate-y-1/2 md:block"
      >
        <ul
          className="pointer-events-auto flex flex-col gap-1.5 rounded-[20px] border border-line bg-bg-soft/85 p-2 shadow-depth-3 backdrop-blur-xl"
          style={{
            boxShadow:
              '0 1px 0 rgba(255,255,255,0.06) inset, 0 26px 56px -24px rgba(0,0,0,0.95), 0 0 32px -12px rgba(167,139,250,0.16)',
          }}
        >
          {items.map((it, i) => {
            const active =
              pathname === it.href || pathname.startsWith(it.href + '/');
            return (
              <li
                key={it.href}
                className="rail-item-in relative"
                style={{ animationDelay: `${i * 55}ms` }}
              >
                {/* Indicador lateral ativo (barra esquerda) */}
                {active ? (
                  <span
                    aria-hidden
                    className="absolute -left-2 top-1/2 h-6 w-1 -translate-y-1/2 rounded-full"
                    style={{
                      background:
                        'linear-gradient(180deg, #a78bfa 0%, #6d4ee8 100%)',
                      boxShadow: '0 0 12px rgba(167,139,250,0.7)',
                    }}
                  />
                ) : null}
                <Link
                  href={it.href}
                  aria-label={it.label}
                  className={
                    'group relative flex h-11 w-11 items-center justify-center rounded-[12px] border transition-all duration-300 ' +
                    (active
                      ? 'border-violet/55 bg-violet/10 text-violet'
                      : 'border-line-strong bg-bg/60 text-text-muted hover:-translate-y-[1px] hover:scale-[1.05] hover:border-violet/45 hover:text-white')
                  }
                  style={
                    active
                      ? {
                          boxShadow:
                            '0 0 24px -6px rgba(167,139,250,0.5), inset 0 1px 0 rgba(255,255,255,0.06)',
                        }
                      : undefined
                  }
                >
                  {it.icon}
                  {/* Tooltip lateral */}
                  <span
                    aria-hidden
                    className="pointer-events-none absolute left-[calc(100%+12px)] whitespace-nowrap rounded-[10px] border border-line bg-bg-soft px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-text opacity-0 shadow-depth-2 transition-all duration-250 group-hover:translate-x-0 group-hover:opacity-100 -translate-x-2"
                    style={{ fontFamily: 'var(--font-tech)' }}
                  >
                    {it.label}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </aside>

      {/* Mobile: horizontal bar com snap */}
      <nav
        key={`m-${mountKey}`}
        aria-label="Ferramentas (mobile)"
        className="md:hidden"
      >
        <ul className="flex gap-2 overflow-x-auto border-b border-line bg-bg-soft/60 px-3 py-2.5 backdrop-blur-md">
          {items.map((it, i) => {
            const active =
              pathname === it.href || pathname.startsWith(it.href + '/');
            return (
              <li
                key={it.href}
                className="rail-item-in shrink-0"
                style={{ animationDelay: `${i * 42}ms` }}
              >
                <Link
                  href={it.href}
                  className={
                    'flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] transition ' +
                    (active
                      ? 'border-violet/55 bg-violet/10 text-violet'
                      : 'border-line-strong bg-bg/60 text-text-muted hover:text-white')
                  }
                  style={{ fontFamily: 'var(--font-tech)' }}
                >
                  <span className="inline-flex h-4 w-4 items-center justify-center">
                    {it.icon}
                  </span>
                  {it.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
