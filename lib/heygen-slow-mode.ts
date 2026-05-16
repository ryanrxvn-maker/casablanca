/**
 * SLOW MODE (so HeyGen). Reduz ~50% a velocidade de disparo pro HeyGen
 * espacando os requests — ajuda a continuar gerando mesmo sob o limite
 * "diario" (que libera aos poucos sem esperar 24h).
 *
 * NAO afeta Magnific/auto-broll. Persistido em localStorage pra valer
 * tanto no ClickUp Pilot quanto direto no heygen-auto.
 */

export const SLOW_MODE_KEY = 'darkolab:heygen:slowMode';

/** Atraso (ms) por job, por worker, quando SLOW MODE ON. */
export const SLOW_DISPATCH_DELAY_MS = 7000;

export function getHeyGenSlowMode(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(SLOW_MODE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setHeyGenSlowMode(on: boolean) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(SLOW_MODE_KEY, on ? '1' : '0');
  } catch {}
}

/** Params de runHeyGenJobs conforme o modo. Normal = inalterado
 *  (parallel 3, sem delay). Slow = 2 workers + delay (≈ metade). */
export function heygenDispatchParams(slow: boolean): {
  parallel: number;
  dispatchDelayMs: number;
} {
  return slow
    ? { parallel: 2, dispatchDelayMs: SLOW_DISPATCH_DELAY_MS }
    : { parallel: 3, dispatchDelayMs: 0 };
}
