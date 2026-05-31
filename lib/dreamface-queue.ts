/**
 * lib/dreamface-queue.ts — limitador de concorrência serial pro DreamFace.
 *
 * POR QUÊ: a conta DreamFace é UMA só (1 cookie). Se 10 usuários do
 * AutoEdit dispararem lipsync ao mesmo tempo, a gente NÃO quer 10
 * gerações simultâneas saindo pelo mesmo cookie — isso parece bot e
 * arrisca bloqueio. Esse limitador processa os jobs em ritmo humano
 * (poucos em paralelo, com jitter), igual a um "power user" usando a
 * conta. Combinado com o IP fixo (proxy) e headers idênticos ao browser,
 * o tráfego fica indistinguível de uso normal.
 *
 * NOTA (Vercel): o limitador é por-instância. O bloqueio de verdade é
 * evitado pelo IP único (DREAMFACE_PROXY_URL) + server-to-server (o IP
 * do usuário final nunca chega no DreamFace). A serialização aqui é a
 * camada de "ritmo". Pra serialização forte cross-instância, dá pra
 * plugar um lock no Supabase depois — a interface não muda.
 */

const MAX = (() => {
  const n = Number(process.env.DREAMFACE_CONCURRENCY);
  return Number.isFinite(n) && n >= 1 && n <= 5 ? Math.floor(n) : 2;
})();

// Espaçamento mínimo entre INÍCIOS de jobs (ms) — evita rajada.
const MIN_GAP_MS = (() => {
  const n = Number(process.env.DREAMFACE_MIN_GAP_MS);
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

/**
 * Roda `fn` respeitando o limite de concorrência + gap mínimo entre
 * inícios (com jitter). Garante ritmo humano por instância.
 */
export async function runOnDreamFaceQueue<T>(fn: () => Promise<T>): Promise<T> {
  await acquire();
  try {
    // Espaça os inícios (anti-rajada) com um pouco de jitter.
    const now = Date.now();
    const wait = lastStart + MIN_GAP_MS - now;
    if (wait > 0) await sleep(wait + Math.floor(Math.random() * 300));
    lastStart = Date.now();
    return await fn();
  } finally {
    release();
  }
}

/** Snapshot do estado da fila (pra debug/health). */
export function queueStats(): { active: number; waiting: number; max: number } {
  return { active, waiting: waiters.length, max: MAX };
}
