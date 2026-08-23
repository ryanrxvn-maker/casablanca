/**
 * GARANTIA — a ponte com a extensão nunca entrega arquivo furado.
 *
 * O que isto trava (as três formas de corromper um download em pedaços):
 *  (A) ORDEM: os pedaços chegam por chrome.tabs.sendMessage → window.postMessage
 *      e NÃO têm ordem garantida. Se a gente gravar na ordem de chegada, o MP4
 *      sai embaralhado e o ffmpeg reclama de container quebrado.
 *  (B) BURACO: mensagem perdida (a praga do downloadDriveFileViaExtension —
 *      "chunk N faltou"). Tem que falhar LIMPO, nunca gravar o arquivo com um
 *      pedaço faltando no meio.
 *  (C) SILÊNCIO: conexão que estagna. O watchdog de inatividade tem que
 *      disparar — e o teto absoluto também — sem esperar 90 s de verdade
 *      (relógio injetado).
 */
import { strictEqual, deepStrictEqual, ok as assertOk, rejects } from 'node:assert';
import {
  ChunkAssembler,
  InactivityWatchdog,
  ExtFetchError,
  versionAtLeast,
  type Clock,
  type TimerHandle,
} from './ext-bridge';

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) {
    passed++;
    console.log(`  ok   ${label}`);
  } else {
    failed++;
    console.error(`  FAIL ${label}`);
  }
}
async function test(label: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    ok(true, label);
  } catch (e) {
    ok(false, `${label} — ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Relógio de mentira: o tempo só anda quando o teste manda. */
class FakeClock implements Clock {
  private t = 0;
  private seq = 1;
  private timers = new Map<number, { at: number; fn: () => void }>();
  now(): number {
    return this.t;
  }
  setTimeout(fn: () => void, ms: number): TimerHandle {
    const h = this.seq++;
    this.timers.set(h, { at: this.t + ms, fn });
    return h;
  }
  clearTimeout(h: TimerHandle): void {
    this.timers.delete(h as number);
  }
  get pending(): number {
    return this.timers.size;
  }
  /** Avança o relógio disparando os timers na ordem correta. */
  advance(ms: number): void {
    const target = this.t + ms;
    for (;;) {
      let pickId = -1;
      let pickAt = Infinity;
      this.timers.forEach((v, k) => {
        if (v.at <= target && v.at < pickAt) {
          pickAt = v.at;
          pickId = k;
        }
      });
      if (pickId < 0) break;
      const item = this.timers.get(pickId)!;
      this.timers.delete(pickId);
      this.t = item.at;
      item.fn();
    }
    this.t = target;
  }
}

function buf(...bytes: number[]): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}
function first(b: ArrayBuffer): number {
  return new Uint8Array(b)[0];
}

async function main() {
  console.log('\nGARANTIA — ponte da extensão (Auto Cortes):');

  // ── (A) ORDEM ────────────────────────────────────────────────────
  await test('pedaços em ordem chegam em ordem no sink', async () => {
    const got: number[] = [];
    const a = new ChunkAssembler((b) => {
      got.push(first(b));
    });
    a.push(0, buf(10));
    a.push(1, buf(11));
    a.push(2, buf(12));
    await a.finish(3);
    deepStrictEqual(got, [10, 11, 12]);
    strictEqual(a.delivered, 3);
    strictEqual(a.bytes, 3);
  });

  await test('pedaços FORA de ordem são reordenados antes de gravar', async () => {
    const got: number[] = [];
    const a = new ChunkAssembler((b) => {
      got.push(first(b));
    });
    a.push(2, buf(12));
    a.push(0, buf(10));
    a.push(1, buf(11));
    await a.finish(3);
    deepStrictEqual(got, [10, 11, 12], 'gravou na ordem do idx, não na ordem de chegada');
  });

  await test('sink assíncrono continua serializado (uma gravação por vez)', async () => {
    const got: number[] = [];
    let inflight = 0;
    let maxInflight = 0;
    const a = new ChunkAssembler(async (b) => {
      inflight++;
      maxInflight = Math.max(maxInflight, inflight);
      await new Promise((r) => setTimeout(r, 1));
      got.push(first(b));
      inflight--;
    });
    a.push(1, buf(21));
    a.push(0, buf(20));
    a.push(3, buf(23));
    a.push(2, buf(22));
    await a.finish(4);
    deepStrictEqual(got, [20, 21, 22, 23]);
    strictEqual(maxInflight, 1, 'nunca duas gravações ao mesmo tempo');
  });

  await test('pedaço repetido é ignorado (não duplica bytes)', async () => {
    const got: number[] = [];
    const a = new ChunkAssembler((b) => {
      got.push(first(b));
    });
    a.push(0, buf(1));
    a.push(0, buf(99));
    a.push(1, buf(2));
    a.push(0, buf(98));
    await a.finish(2);
    deepStrictEqual(got, [1, 2]);
  });

  // ── (B) BURACO ───────────────────────────────────────────────────
  await test('buraco: adiantados demais sem o que falta = falha antes de gravar', async () => {
    const got: number[] = [];
    const a = new ChunkAssembler(
      (b) => {
        got.push(first(b));
      },
      { maxPending: 3 },
    );
    // o pedaço 0 se perdeu no caminho
    a.push(1, buf(1));
    a.push(2, buf(2));
    a.push(3, buf(3));
    a.push(4, buf(4));
    assertOk(a.failure instanceof ExtFetchError, 'marcou falha');
    strictEqual((a.failure as ExtFetchError).kind, 'buraco');
    deepStrictEqual(got, [], 'não gravou nada fora de ordem');
    await rejects(() => a.drained());
  });

  await test('buraco no fim: finish() acusa download incompleto', async () => {
    const a = new ChunkAssembler(() => {});
    a.push(0, buf(1));
    a.push(1, buf(2));
    await rejects(
      () => a.finish(3),
      (e: unknown) => e instanceof ExtFetchError && e.kind === 'buraco' && /incompleto/.test(e.message),
    );
  });

  await test('erro na gravação (OPFS cheio) vira falha de gravação', async () => {
    const a = new ChunkAssembler(() => {
      throw new Error('disco cheio');
    });
    a.push(0, buf(1));
    await rejects(
      () => a.drained(),
      (e: unknown) => e instanceof ExtFetchError && e.kind === 'gravacao' && /disco cheio/.test(e.message),
    );
  });

  await test('índice inválido não passa', async () => {
    const a = new ChunkAssembler(() => {});
    a.push(-1, buf(1));
    assertOk(a.failure instanceof ExtFetchError, 'índice negativo recusado');
  });

  // ── (C) SILÊNCIO (relógio injetado) ──────────────────────────────
  await test('90 s sem sinal de vida = inatividade', () => {
    const clock = new FakeClock();
    let idle = 0;
    let abs = 0;
    const w = new InactivityWatchdog(clock, {
      idleMs: 90_000,
      absoluteMs: 45 * 60_000,
      onIdle: () => idle++,
      onAbsolute: () => abs++,
    });
    w.start();
    clock.advance(89_999);
    strictEqual(idle, 0, 'antes de 90 s não dispara');
    clock.advance(2);
    strictEqual(idle, 1, 'disparou em 90 s');
    strictEqual(abs, 0);
    clock.advance(60 * 60_000);
    strictEqual(idle, 1, 'não dispara duas vezes');
    strictEqual(abs, 0, 'watchdog parado não solta o teto depois');
  });

  await test('sinal de vida a cada 5 s (pulso do Motor) segura o watchdog', () => {
    const clock = new FakeClock();
    let idle = 0;
    const w = new InactivityWatchdog(clock, {
      idleMs: 90_000,
      absoluteMs: 45 * 60_000,
      onIdle: () => idle++,
      onAbsolute: () => {},
    });
    w.start();
    for (let i = 0; i < 200; i++) {
      clock.advance(5_000); // 1000 s de download saudável
      w.poke();
    }
    strictEqual(idle, 0, 'download longo e vivo não é interrompido');
    clock.advance(90_001);
    strictEqual(idle, 1, 'quando para de verdade, dispara');
  });

  await test('teto absoluto de 45 min corta mesmo com sinal de vida', () => {
    const clock = new FakeClock();
    let idle = 0;
    let abs = 0;
    const w = new InactivityWatchdog(clock, {
      idleMs: 90_000,
      absoluteMs: 45 * 60_000,
      onIdle: () => idle++,
      onAbsolute: () => abs++,
    });
    w.start();
    for (let i = 0; i < 600; i++) {
      clock.advance(5_000); // 50 min de pulsos
      w.poke();
    }
    strictEqual(abs, 1, 'o teto absoluto disparou');
    strictEqual(idle, 0, 'e não foi por inatividade');
  });

  await test('stop() desarma tudo (sem timer órfão)', () => {
    const clock = new FakeClock();
    let fired = 0;
    const w = new InactivityWatchdog(clock, {
      idleMs: 1_000,
      absoluteMs: 2_000,
      onIdle: () => fired++,
      onAbsolute: () => fired++,
    });
    w.start();
    w.stop();
    strictEqual(clock.pending, 0, 'nenhum timer sobrou');
    clock.advance(10_000);
    strictEqual(fired, 0);
  });

  // ── versão mínima da extensão ────────────────────────────────────
  await test('versionAtLeast segue a regra do Downloader', () => {
    const min = [1, 8, 0];
    strictEqual(versionAtLeast('1.8.0', min), true);
    strictEqual(versionAtLeast('1.8.1', min), true);
    strictEqual(versionAtLeast('1.9.0', min), true);
    strictEqual(versionAtLeast('2.0.0', min), true);
    strictEqual(versionAtLeast('1.7.9', min), false);
    strictEqual(versionAtLeast('1.7.0', min), false, 'a 1.7.0 do Downloader não serve pro Auto Cortes');
    strictEqual(versionAtLeast(undefined, min), false);
    strictEqual(versionAtLeast('', min), false);
  });

  console.log(`\n${failed === 0 ? '✓' : '✗'} ext-bridge: ${passed} ok, ${failed} fail\n`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
