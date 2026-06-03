/**
 * lib/vmake-queue.ts — limitador de concorrência serial pro vmake.
 *
 * A conta vmake é UMA só (1 Access-Token). Se vários admins dispararem
 * remoção ao mesmo tempo, não queremos N gerações simultâneas saindo pelo
 * mesmo token — parece bot e arrisca bloqueio. Esse limitador processa em
 * ritmo humano (poucos em paralelo, com gap + jitter). Combinado com IP
 * fixo (VMAKE_PROXY_URL) e headers idênticos ao browser, fica como uso normal.
 */

const MAX = (() => {
  const n = Number(process.env.VMAKE_CONCURRENCY);
  return Number.isFinite(n) && n >= 1 && n <= 4 ? Math.floor(n) : 2;
})();

const MIN_GAP_MS = (() => {
  const n = Number(process.env.VMAKE_MIN_GAP_MS);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 800;
})();

let active = 0;
let lastStart = 0;
const waiters: Array<() => void> = [];

function acquire(): Promise<void> {
  if (active < MAX) {
    active++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => waiters.push(resolve));
}

function release(): void {
  active--;
  const next = waiters.shift();
  if (next) {
    active++;
    next();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function runOnVmakeQueue<T>(fn: () => Promise<T>): Promise<T> {
  await acquire();
  try {
    const now = Date.now();
    const wait = lastStart + MIN_GAP_MS - now;
    if (wait > 0) await sleep(wait + Math.floor(Math.random() * 300));
    lastStart = Date.now();
    return await fn();
  } finally {
    release();
  }
}

export function vmakeQueueStats(): { active: number; waiting: number; max: number } {
  return { active, waiting: waiters.length, max: MAX };
}
