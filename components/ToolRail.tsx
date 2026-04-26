'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

export type RailItem = {
  href: string;
  label: string;
  icon: ReactNode;
};

/**
 * ToolRail — sidebar vertical flutuante com icones de ferramentas.
 *
 * - Posicionado fixo na lateral esquerda da tela
 * - Cada icone entra deslizando da esquerda com stagger (delay incremental)
 * - Icone ativo ganha destaque lime + glow
 * - Hover mostra tooltip com o nome da ferramenta
 * - Em telas pequenas (< 768px) colapsa pra barra horizontal no topo
 */
export function ToolRail({ items }: { items: RailItem[] }) {
  const pathname = usePathname();
  // Remount key — faz a entrada animar sempre que o set de items mudar
  // (ex: alternancia Base Suite <-> AI Suite).
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
        <ul className="pointer-events-auto flex flex-col gap-2 rounded-[18px] border border-line bg-bg-soft/80 p-2 shadow-depth-3 backdrop-blur-md">
          {items.map((it, i) => {
            const active =
              pathname === it.href || pathname.startsWith(it.href + '/');
            return (
              <li
                key={it.href}
                className="rail-item-in"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <Link
                  href={it.href}
                  aria-label={it.label}
                  className={
                    'group relative flex h-11 w-11 items-center justify-center rounded-[12px] border transition-all duration-300 ' +
                    (active
                      ? 'border-lime/70 bg-lime/10 text-lime shadow-[0_0_24px_-6px_rgba(200,255,0,0.6)] scale-[1.06]'
                      : 'border-line-strong bg-bg/60 text-text-muted hover:-translate-y-[1px] hover:scale-[1.04] hover:border-lime/60 hover:text-white')
                  }
                >
                  {it.icon}
                  {/* Dot pulsante ativo — visivel so no item selecionado */}
                  {active ? (
                    <span
                      aria-hidden
                      className="absolute -right-0.5 -top-0.5 h-2 w-2 animate-pulse-soft rounded-full bg-lime shadow-[0_0_8px_rgba(200,255,0,0.9)]"
                    />
                  ) : null}
                  {/* Tooltip lateral */}
                  <span
                    aria-hidden
                    className="pointer-events-none absolute left-[calc(100%+10px)] whitespace-nowrap rounded-[8px] border border-line bg-bg-soft px-2 py-1 text-[11px] uppercase tracking-widest text-text opacity-0 shadow-depth-2 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100 -translate-x-1"
                  >
                    {it.label}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </aside>

      {/* Mobile: horizontal bar */}
      <nav
        key={`m-${mountKey}`}
        aria-label="Ferramentas (mobile)"
        className="md:hidden"
      >
        <ul className="flex gap-2 overflow-x-auto border-b border-line bg-bg-soft/60 px-3 py-2">
          {items.map((it, i) => {
            const active =
              pathname === it.href || pathname.startsWith(it.href + '/');
            return (
              <li
                key={it.href}
                className="rail-item-in shrink-0"
                style={{ animationDelay: `${i * 45}ms` }}
              >
                <Link
                  href={it.href}
                  className={
                    'flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] uppercase tracking-widest transition ' +
                    (active
                      ? 'border-lime/70 bg-lime/10 text-lime'
                      : 'border-line-strong bg-bg/60 text-text-muted hover:text-white')
                  }
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
