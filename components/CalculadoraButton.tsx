'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * CalculadoraButton — ícone pequeno na cluster da TopBar.
 * Segue o mesmo padrão visual de PointsButton/BackgroundTasksButton:
 * .topbar-icon, 36×36, var(--ti-color) e var(--ti-glow) pra estado.
 *
 * Disponível pra todos os usuários (não tem gate por tier).
 */
export function CalculadoraButton() {
  const pathname = usePathname();
  const active = pathname.startsWith('/tools/calculadora');

  return (
    <Link
      href="/tools/calculadora"
      aria-label="Calculadora"
      title="Calculadora — preço por minuto"
      data-active={active ? 'true' : undefined}
      className="topbar-icon group"
      style={{
        ['--ti-color' as string]: active ? '#c084fc' : '#9c9ca6',
        ['--ti-glow' as string]: active ? 'rgba(167,139,250,0.55)' : 'transparent',
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
        <rect x="4" y="3" width="16" height="18" rx="2.5" />
        <path d="M7 7h10" />
        {/* Botõezinhos da calculadora — 6 dots em 2x3 */}
        <path d="M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01" strokeWidth="2.2" />
      </svg>
    </Link>
  );
}
