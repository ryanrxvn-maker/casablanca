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
import { attachExecWatchdog, criarInstanciaFFmpeg, CANCELLED_ERROR } from './ffmpeg-worker';

type Slot = { ff: FFmpeg; busy: boolean };
type Waiter = { resolve: (ff: FFmpeg) => void; reject: (e: Error) => void };

// O núcleo é o MESMO das outras ferramentas (10.10): criarInstanciaFFmpeg usa
// a versão, o cache e o worker do singleton. Antes o pool baixava a 0.12.6 à
// parte (~30 MB a mais no primeiro uso, sem cache próprio).

export class FFmpegPool {
  private slots: Slot[] = [];
  private waiters: Waiter[] = [];

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
      const ff = await criarInstanciaFFmpeg();
      // MESMO watchdog por batimento do singleton (3min de silêncio mata a
      // instância; teto 25min como backstop). Sem isto, um hang do wasm num
      // job do Compressor ficava "running" pra sempre. O slot morto sai do
      // pool na hora — a próxima acquire cria instância limpa.
      attachExecWatchdog(ff, () => this.evict(ff));
      const slot: Slot = { ff, busy: true };
      this.slots.push(slot);
      return ff;
    }
    // 3) limite atingido — espera alguém liberar
    return new Promise<FFmpeg>((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  /** Remove um slot cuja instância morreu (watchdog). Se alguém esperava vaga,
   *  repõe criando instância nova — senão o waiter dormiria pra sempre. */
  private evict(ff: FFmpeg): void {
    const i = this.slots.findIndex((s) => s.ff === ff);
    if (i >= 0) this.slots.splice(i, 1);
    const waiter = this.waiters.shift();
    if (waiter) {
      // Se a instância nova não sobe, quem esperava recebe o erro — antes
      // voltava pra fila e ficava "rodando" pra sempre.
      void this.acquire().then(waiter.resolve).catch((e) => waiter.reject(e instanceof Error ? e : new Error(String(e))));
    }
  }

  release(ff: FFmpeg): void {
    const slot = this.slots.find((s) => s.ff === ff);
    if (!slot) return;
    slot.busy = false;
    const waiter = this.waiters.shift();
    if (waiter) {
      slot.busy = true;
      waiter.resolve(ff);
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
    // Quem esperava vaga RECEBE o cancelamento (10.10). Antes a lista era só
    // esvaziada: a promessa ficava pendurada pra sempre e o job do arquivo
    // grande seguia "rodando" eternamente depois do Cancelar.
    const esperando = this.waiters;
    this.waiters = [];
    for (const w of esperando) {
      try { w.reject(new Error(CANCELLED_ERROR)); } catch { /* ignora */ }
    }
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
 * Exportado: o Compressor usa como TETO real (5 fixos estouravam RAM
 * em máquina fraca — 5×30MB de heap + input+output no memfs).
 */
export function recommendedPoolSize(): number {
  return defaultPoolSize();
}

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
