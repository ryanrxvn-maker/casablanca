'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

/**
 * ThemeManager — garante que o MODO CLARO só vale DENTRO da conta (app).
 *
 * Landing e páginas públicas (/, /termos, /politica, /recursos, /login...)
 * ficam SEMPRE escuras. /planos só fica claro se aberto via upgrade
 * (?upgrade) de dentro da conta. O padrão é sempre dark.
 *
 * Roda em toda troca de rota (inclusive navegação SPA) e adiciona/remove
 * o data-theme conforme a rota + a preferência salva. O script anti-flash
 * no layout cobre o primeiro paint.
 */
const APP_PREFIXES = ['/tools', '/configuracoes', '/admin'];

function isAccountPath(pathname: string, search: string): boolean {
  if (APP_PREFIXES.some((p) => pathname === p || pathname.startsWith(p))) {
    return true;
  }
  // /planos só conta como "conta" quando veio do upgrade.
  if (pathname.startsWith('/planos') && search.indexOf('upgrade') > -1) {
    return true;
  }
  return false;
}

export function ThemeManager() {
  const pathname = usePathname();

  useEffect(() => {
    const search = typeof window !== 'undefined' ? window.location.search : '';
    let prefLight = false;
    try {
      prefLight = localStorage.getItem('theme') === 'light';
    } catch {}

    const el = document.documentElement;
    if (prefLight && isAccountPath(pathname, search)) {
      el.setAttribute('data-theme', 'light');
    } else {
      el.removeAttribute('data-theme');
    }
  }, [pathname]);

  return null;
}
