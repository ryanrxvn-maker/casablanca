'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Heartbeat — fire-and-forget POST /api/user/heartbeat a cada 25s.
 *
 * Marca o user como online + salva IP + ferramenta atual no Postgres.
 * Admin usa esses dados pra ver quem ta usando o app em tempo real.
 *
 * Tool slug e extraido do pathname /tools/<slug>. Quando muda de
 * ferramenta, dispara um heartbeat imediato sincronizando o slug.
 */

const PING_INTERVAL_MS = 25_000;

function extractTool(pathname: string | null): string | null {
  if (!pathname) return null;
  const m = pathname.match(/^\/tools\/([^\/]+)/);
  return m?.[1] ?? null;
}

export function Heartbeat() {
  const pathname = usePathname();
  const tool = extractTool(pathname);

  useEffect(() => {
    let cancelled = false;

    function ping() {
      if (cancelled) return;
      fetch('/api/user/heartbeat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tool }),
        keepalive: true,
      }).catch(() => {});
    }

    ping();
    const id = setInterval(ping, PING_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [tool]);

  return null;
}
