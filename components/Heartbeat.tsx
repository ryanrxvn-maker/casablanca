'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { getDeviceId, getMachineFingerprint } from '@/lib/access-device';

/**
 * Heartbeat — fire-and-forget POST /api/user/heartbeat a cada 25s.
 *
 * Marca o user como online + salva IP + ferramenta atual no Postgres.
 * Admin usa esses dados pra ver quem ta usando o app em tempo real.
 *
 * Tool slug e extraido do pathname /tools/<slug>. Quando muda de
 * ferramenta, dispara um heartbeat imediato sincronizando o slug.
 *
 * Histórico de acesso (migration 037): cada ping leva o id do APARELHO
 * (o mesmo em todas as abas do navegador) e se está em USO ATIVO — aba
 * visível e alguém mexendo nos últimos 45 s. É isso que o banco usa pra
 * detectar acesso simultâneo sem confundir aba esquecida ou troca de aparelho.
 */

const PING_INTERVAL_MS = 25_000;
const FIRST_TOUCH_KEY = 'ae_first_touch';

/** Janela do "uso ativo". O SQL (037) conta com ela: a corrida de um aparelho
 *  morre no máximo 45 s depois do último toque. Mudou aqui, revise lá. */
const INPUT_WINDOW_MS = 45_000;
/** Ping extra (voltou pra aba, voltou a mexer) nunca mais que 1 a cada 5 s. */
const EXTRA_PING_GAP_MS = 5_000;

/* Último toque nesta aba. Os ouvintes são únicos por aba (o Heartbeat monta
   em 3 layouts) e só gravam um número: nenhum custo de estilo ou layout. */
let lastInputAt = 0;
let inputListenersOn = false;
let onWake: (() => void) | null = null;

function markInput() {
  const now = Date.now();
  const wasIdle = now - lastInputAt > INPUT_WINDOW_MS;
  lastInputAt = now;
  if (wasIdle && onWake) onWake();
}

function ensureInputListeners() {
  if (inputListenersOn || typeof window === 'undefined') return;
  inputListenersOn = true;
  const opts: AddEventListenerOptions = { passive: true, capture: true };
  for (const ev of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll']) {
    window.addEventListener(ev, markInput, opts);
  }
}

function isEngaged(): boolean {
  return (
    typeof document !== 'undefined' &&
    document.visibilityState === 'visible' &&
    Date.now() - lastInputAt <= INPUT_WINDOW_MS
  );
}

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
    let lastPingAt = 0;
    ensureInputListeners();

    function ping() {
      if (cancelled) return;
      lastPingAt = Date.now();
      fetch('/api/user/heartbeat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tool,
          source: getFirstTouch(),
          device: getDeviceId(),
          fp: getMachineFingerprint(),
          engaged: isEngaged(),
          touch: typeof navigator !== 'undefined' ? navigator.maxTouchPoints || 0 : 0,
        }),
        keepalive: true,
      }).catch(() => {});
    }

    // Voltou pra aba ou voltou a mexer depois de parado: avisa já, sem
    // esperar o próximo ciclo de 25 s.
    function pingSoon() {
      if (Date.now() - lastPingAt >= EXTRA_PING_GAP_MS) ping();
    }
    function onVisibility() {
      if (document.visibilityState === 'visible') pingSoon();
    }

    onWake = pingSoon;
    document.addEventListener('visibilitychange', onVisibility);
    ping();
    const id = setInterval(ping, PING_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
      if (onWake === pingSoon) onWake = null;
    };
  }, [tool]);

  return null;
}
