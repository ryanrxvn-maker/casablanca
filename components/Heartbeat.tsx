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
const FIRST_TOUCH_KEY = 'ae_first_touch';

function extractTool(pathname: string | null): string | null {
  if (!pathname) return null;
  const m = pathname.match(/^\/tools\/([^\/]+)/);
  return m?.[1] ?? null;
}

type FirstTouch = {
  traffic_source: string;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
};

/** Captura origem da 1a visita (referrer + UTM) e persiste no localStorage.
 *  Reenviado a cada ping, mas o servidor só grava uma vez (first-touch). */
function getFirstTouch(): FirstTouch | null {
  if (typeof window === 'undefined') return null;
  try {
    const cached = localStorage.getItem(FIRST_TOUCH_KEY);
    if (cached) return JSON.parse(cached) as FirstTouch;
    const params = new URLSearchParams(window.location.search);
    let source = 'direct';
    const ref = document.referrer;
    if (ref) {
      try {
        const host = new URL(ref).hostname.replace(/^www\./, '');
        if (host && host !== window.location.hostname) source = host;
      } catch {
        /* referrer inválido → direct */
      }
    }
    const ft: FirstTouch = {
      traffic_source: params.get('utm_source') || source,
      utm_source: params.get('utm_source'),
      utm_medium: params.get('utm_medium'),
      utm_campaign: params.get('utm_campaign'),
    };
    localStorage.setItem(FIRST_TOUCH_KEY, JSON.stringify(ft));
    return ft;
  } catch {
    return null;
  }
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
        body: JSON.stringify({ tool, source: getFirstTouch() }),
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
