/**
 * Espera (`sleepUnthrottled`) que NÃO é estrangulada pelo Chrome em aba de
 * SEGUNDO PLANO — usada pelos loops de polling (HeyGen render) que precisam
 * continuar detectando o fim do render mesmo quando o user troca de aba.
 *
 * Problema: `setTimeout`/`setInterval` da JANELA sofrem "intensive throttling"
 * (caem pra ~1x/min após 5min com a aba oculta). Isso travava o poll do HeyGen
 * (card "RENDERIZANDO" eterno + contador congelado) e adiava a montagem.
 *
 * Fix: um Web Worker (`/public/poll-clock.worker.js`) faz o `setTimeout` — timers
 * DENTRO de worker não sofrem esse throttle agressivo (piso ~1x/s, ótimo pro
 * poll de ~8s). O worker avisa a main thread por mensagem (eventos não são
 * estrangulados como timers) e aí a Promise resolve.
 *
 * Fail-safe total: sem Worker (SSR / navegador sem suporte / erro de carga) cai
 * no `setTimeout` normal. E há um guard por espera: se o worker morrer no meio,
 * um setTimeout de reserva ainda resolve (só mais devagar) — nunca trava pra
 * sempre. Ver [[project_montagem_incompleta_gate]] / [[project_disparo_anti_incompleto]].
 */

let _worker: Worker | null = null;
let _failed = false;
let _seq = 0;
const _pending = new Map<number, () => void>();

function getWorker(): Worker | null {
  if (_failed) return null;
  if (typeof window === 'undefined' || typeof Worker === 'undefined') return null;
  if (_worker) return _worker;
  try {
    const w = new Worker('/poll-clock.worker.js');
    w.onmessage = (e: MessageEvent) => {
      const id = e.data as number;
      const res = _pending.get(id);
      if (res) res(); // o callback já faz _pending.delete + clearTimeout do guard
    };
    w.onerror = () => {
      // Worker quebrou: marca como indisponível; esperas futuras caem no setTimeout.
      _failed = true;
    };
    _worker = w;
    return w;
  } catch {
    _failed = true;
    return null;
  }
}

/**
 * Resolve depois de `ms` SEM ser estrangulado em background (via Web Worker).
 * Fallback pro setTimeout normal se não houver Worker disponível.
 */
export function sleepUnthrottled(ms: number): Promise<void> {
  const w = getWorker();
  if (!w) return new Promise((r) => setTimeout(r, ms));
  return new Promise((resolve) => {
    const id = ++_seq;
    // Guard de reserva: se o worker não responder (morreu), o setTimeout — mesmo
    // estrangulado — ainda resolve. Folga generosa pra não disparar à toa.
    const guard = window.setTimeout(() => {
      if (_pending.delete(id)) resolve();
    }, ms + 30_000);
    _pending.set(id, () => {
      _pending.delete(id);
      clearTimeout(guard);
      resolve();
    });
    w.postMessage({ id, ms });
  });
}
