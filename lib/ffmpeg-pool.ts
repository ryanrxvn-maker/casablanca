/**
 * FFmpeg Pool — pool de instâncias do FFmpeg.wasm pra paralelismo REAL.
 *
 * Cada `new FFmpeg()` cria um Web Worker independente. Múltiplas
 * instâncias = jobs rodando em paralelo. O custo é memória (~30MB por
 * instância) e tempo de carregamento inicial.
 *
 * Uso típico (Compressor):
 *   const pool = getFFmpegPool(5);
 *   const ff = await pool.acquire();
 *   try { ... usa ff ... } finally { pool.release(ff); }
 *
 * O pool reusa instâncias (não termina entre jobs). Pra liberar memória
 * use `getFFmpegPool().destroy()` quando o lote acaba.
 */

import type { FFmpeg } from '@ffmpeg/ffmpeg';

type Slot = { ff: FFmpeg; busy: boolean };

// Alinhado com lib/ffmpeg-worker.ts CORE_VERSION — mantenha em sync.
const CORE_VERSION = '0.12.6';
const CDNS = [
  `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/umd`,
  `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VERSION}/dist/umd`,
];

/** Cache dos blob URLs do core (compartilhado entre todas as instâncias). */
let cachedCore: { coreURL: string; wasmURL: string } | null = null;

async function fetchAsBlobURL(url: string, mime: string): Promise<string> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  const buf = await r.arrayBuffer();
  return URL.createObjectURL(new Blob([buf], { type: mime }));
}

async function loadCoreURLs(): Promise<{ coreURL: string; wasmURL: string }> {
  if (cachedCore) return cachedCore;
  let lastErr: unknown = null;
  for (const baseURL of CDNS) {
    try {
      const [coreURL, wasmURL] = await Promise.all([
        fetchAsBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        fetchAsBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
      ]);
      cachedCore = { coreURL, wasmURL };
      return cachedCore;
    } catch (e) {
      lastErr = e;
      // eslint-disable-next-line no-console
      console.warn(`[ffmpeg-pool] CDN falhou ${baseURL}:`, e);
    }
  }
  throw new Error(
    'FFmpeg core CDN failed: ' +
      (lastErr instanceof Error ? lastErr.message : String(lastErr)),
  );
}

export class FFmpegPool {
  private slots: Slot[] = [];
  private waiters: ((ff: FFmpeg) => void)[] = [];

  constructor(public readonly maxSize: number = 3) {
    if (maxSize < 1) this.maxSize = 1;
    if (maxSize > 8) this.maxSize = 8;
  }

  /** Stats simples — útil pra mostrar "X rodando, Y na fila" na UI. */
  stats(): { active: number; idle: number; waiting: number; max: number } {
    const active = this.slots.filter((s) => s.busy).length;
    const idle = this.slots.length - active;
    return {
      active,
      idle,
      waiting: this.waiters.length,
      max: this.maxSize,
    };
  }

  async acquire(): Promise<FFmpeg> {
    // 1) slot livre existente
    const free = this.slots.find((s) => !s.busy);
    if (free) {
      free.busy = true;
      return free.ff;
    }
    // 2) cria nova instância (até o limite)
    if (this.slots.length < this.maxSize) {
      const { FFmpeg } = await import('@ffmpeg/ffmpeg');
      const { coreURL, wasmURL } = await loadCoreURLs();
      const ff = new FFmpeg();
      await ff.load({ coreURL, wasmURL });
      const slot: Slot = { ff, busy: true };
      this.slots.push(slot);
      return ff;
    }
    // 3) limite atingido — espera alguém liberar
    return new Promise<FFmpeg>((resolve) => this.waiters.push(resolve));
  }

  release(ff: FFmpeg): void {
    const slot = this.slots.find((s) => s.ff === ff);
    if (!slot) return;
    slot.busy = false;
    const waiter = this.waiters.shift();
    if (waiter) {
      slot.busy = true;
      waiter(ff);
    }
  }

  /** Mata todas as instâncias (libera memória). */
  destroy(): void {
    for (const s of this.slots) {
      try {
        s.ff.terminate();
      } catch {
        /* ignora */
      }
    }
    this.slots = [];
    this.waiters = [];
  }
}

let defaultPool: FFmpegPool | null = null;

/**
 * Pool padrão singleton. Default 3 instâncias paralelas — bom balance
 * entre throughput e RAM (3×30MB ≈ 90MB). Pode subir pra 5 em desktop
 * com folga, mas mobile fica com pouco RAM.
 */
export function getFFmpegPool(maxSize?: number): FFmpegPool {
  if (!defaultPool) {
    defaultPool = new FFmpegPool(maxSize ?? defaultPoolSize());
  } else if (maxSize !== undefined && maxSize !== defaultPool.maxSize) {
    // Se o caller pediu tamanho diferente, destrói e cria novo
    defaultPool.destroy();
    defaultPool = new FFmpegPool(maxSize);
  }
  return defaultPool;
}

/**
 * Decide tamanho default baseado em pistas do ambiente. Mobile/RAM
 * baixa → 2. Desktop com 8+ cores → 5. Default → 3.
 */
function defaultPoolSize(): number {
  if (typeof navigator === 'undefined') return 3;
  // @ts-expect-error — deviceMemory é Chrome-only mas é o sinal mais
  // confiável de RAM disponível.
  const mem: number | undefined = navigator.deviceMemory;
  const cores = navigator.hardwareConcurrency || 4;
  if (mem && mem <= 4) return 2;
  if (cores >= 8) return 5;
  return 3;
}

/** Destrói o pool padrão (útil ao sair da página de compressor). */
export function destroyFFmpegPool(): void {
  if (defaultPool) {
    defaultPool.destroy();
    defaultPool = null;
  }
}
