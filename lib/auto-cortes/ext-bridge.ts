/**
 * AUTO CORTES — ponte com a extensão Downloader (v1.8.0+).
 *
 * A página NÃO consegue buscar os bytes sozinha:
 *   - Motor local (YouTube & cia): só libera CORS pra origens
 *     chrome-extension:// — o site não tem token, nem ACAO, nem
 *     Access-Control-Allow-Private-Network.
 *   - Google Drive: arquivo privado exige os COOKIES do usuário, e arquivo
 *     grande exige a cadeia de confirmação.
 * Quem consegue é o service worker da extensão (host_permissions). Então ele
 * baixa em stream e nos entrega o corpo em pedaços; aqui a gente remonta NA
 * ORDEM e repassa cada pedaço pro chamador (que grava no OPFS — zero heap).
 *
 * ┌ página ──────────┐   window.postMessage    ┌ bridge.js ┐  chrome.runtime  ┌ bg.js ┐
 * │ fetchViaExtension│ ──── DL_FETCH ────────► │  relay    │ ───────────────► │ fetch │
 * │                  │ ◄─── DL_FETCH_* ─────── │           │ ◄─────────────── │stream │
 * └──────────────────┘                         └───────────┘                  └───────┘
 *
 * ⚠ ARQUIVO SEM IMPORTS DE PROPÓSITO. O `npm test` compila cada lib pura
 * ISOLADA (`tsc arquivo.ts arquivo.test.ts`, sem o `paths` do tsconfig), e
 * importar `./types` puxaria junto todo o motor de tipografia
 * (types → typography/engine → fonts/presets) — que nem compila com o `--lib`
 * enxuto do teste. Por isso os tipos do protocolo estão ESPELHADOS aqui.
 * A compatibilidade estrutural com o contrato oficial é travada em
 * `ingest.ts` (importa os dois e passa um pelo outro): se `types.ts` mudar de
 * forma incompatível, o `tsc --noEmit` acusa lá.
 */

// ───────────────────────────────────────────────────────────────────────────
// Espelho do contrato (lib/auto-cortes/types.ts)
// ───────────────────────────────────────────────────────────────────────────

export type ExtFetchKind = 'engine' | 'drive';

export type ExtFetchRequest = {
  type: 'DL_FETCH';
  reqId: string;
  url: string;
  kind: ExtFetchKind;
  mode: 'video';
  quality: '1080';
};

/**
 * Eventos que a extensão manda de volta. `DL_FETCH_PROGRESS` é ADITIVO em
 * relação ao `ExtFetchEvent` de types.ts (avisado no relatório): o Motor roda
 * o yt-dlp INTEIRO antes de mandar o primeiro byte (podcast de 2 h leva
 * minutos), então sem um pulso de vida o watchdog de 90 s mataria um download
 * perfeitamente saudável.
 */
export type ExtFetchEvent =
  | { type: 'DL_FETCH_META'; reqId: string; filename: string; size: number | null; mime: string }
  | { type: 'DL_FETCH_CHUNK'; reqId: string; idx: number; buf: ArrayBuffer }
  | { type: 'DL_FETCH_PROGRESS'; reqId: string; received: number; total: number | null; phase: string }
  | { type: 'DL_FETCH_DONE'; reqId: string; total: number; chunks: number }
  | { type: 'DL_FETCH_ERROR'; reqId: string; error: string };

export type ExtPong = { version: string; engine: boolean; port: number | null };

// ───────────────────────────────────────────────────────────────────────────
// Relógio injetável (o teste roda sem esperar 90 s de verdade)
// ───────────────────────────────────────────────────────────────────────────

export type TimerHandle = unknown;

export type Clock = {
  now(): number;
  setTimeout(fn: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
};

export const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

// ───────────────────────────────────────────────────────────────────────────
// Limites
// ───────────────────────────────────────────────────────────────────────────

/** 90 s sem NENHUMA notícia da extensão = morreu. */
export const EXT_IDLE_MS = 90_000;
/** Teto duro por tentativa. */
export const EXT_ABSOLUTE_MS = 45 * 60 * 1000;
/** Quantos pedaços fora de ordem seguramos antes de declarar buraco. */
export const EXT_MAX_PENDING_CHUNKS = 12;

export type ExtFetchErrorKind =
  | 'sem-extensao'
  | 'inatividade'
  | 'teto'
  | 'cancelado'
  | 'buraco'
  | 'remoto'
  | 'gravacao';

export class ExtFetchError extends Error {
  readonly kind: ExtFetchErrorKind;
  /** quantos pedaços JÁ foram entregues ao chamador quando o erro estourou */
  readonly delivered: number;
  constructor(message: string, kind: ExtFetchErrorKind, delivered = 0) {
    super(message);
    this.name = 'ExtFetchError';
    this.kind = kind;
    this.delivered = delivered;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// PURO — remontagem em ordem (testado em ext-bridge.test.ts)
// ───────────────────────────────────────────────────────────────────────────

export type ChunkSink = (buf: ArrayBuffer, idx: number) => void | Promise<void>;

/**
 * Recebe pedaços em QUALQUER ordem e entrega ao sink SEMPRE em ordem, um de
 * cada vez (o sink é assíncrono — grava no OPFS). Guarda no máximo
 * `maxPending` pedaços adiantados: passar disso significa que o pedaço que
 * falta se perdeu no caminho (buraco) e não adianta esperar — falha limpo em
 * vez de gravar um arquivo furado.
 */
export class ChunkAssembler {
  private readonly sink: ChunkSink;
  private readonly maxPending: number;
  private readonly pending = new Map<number, ArrayBuffer>();
  private queue: Promise<void> = Promise.resolve();
  private nextIdx = 0;
  private bytesOut = 0;
  private err: Error | null = null;

  constructor(sink: ChunkSink, opts: { maxPending?: number } = {}) {
    this.sink = sink;
    this.maxPending = opts.maxPending ?? EXT_MAX_PENDING_CHUNKS;
  }

  /** Quantos pedaços já foram entregues ao sink (= próximo idx esperado). */
  get delivered(): number {
    return this.nextIdx;
  }

  /** Bytes já entregues ao sink. */
  get bytes(): number {
    return this.bytesOut;
  }

  /** Pedaços adiantados segurados na memória. */
  get buffered(): number {
    return this.pending.size;
  }

  get failure(): Error | null {
    return this.err;
  }

  /** Enfileira um pedaço. Duplicata e pedaço já entregue são ignorados. */
  push(idx: number, buf: ArrayBuffer): void {
    if (this.err) return;
    if (!Number.isInteger(idx) || idx < 0) {
      this.err = new ExtFetchError(`pedaço com índice inválido (${String(idx)})`, 'buraco', this.nextIdx);
      return;
    }
    if (idx < this.nextIdx || this.pending.has(idx)) return; // duplicata
    this.pending.set(idx, buf);
    if (this.pending.size > this.maxPending) {
      this.err = new ExtFetchError(
        `faltou o pedaço ${this.nextIdx} (já chegaram ${this.pending.size} depois dele)`,
        'buraco',
        this.nextIdx,
      );
      this.pending.clear();
      return;
    }
    this.queue = this.queue.then(() => this.drain());
  }

  private async drain(): Promise<void> {
    if (this.err) return;
    for (;;) {
      const buf = this.pending.get(this.nextIdx);
      if (buf === undefined) return;
      this.pending.delete(this.nextIdx);
      try {
        await this.sink(buf, this.nextIdx);
      } catch (e) {
        this.err = new ExtFetchError(
          `não consegui gravar o pedaço ${this.nextIdx}: ${errText(e)}`,
          'gravacao',
          this.nextIdx,
        );
        return;
      }
      this.nextIdx++;
      this.bytesOut += buf.byteLength;
    }
  }

  /** Espera a fila esvaziar (inclusive o que entrou durante a espera). */
  async drained(): Promise<void> {
    let prev: Promise<void>;
    do {
      prev = this.queue;
      await prev;
    } while (prev !== this.queue);
    if (this.err) throw this.err;
  }

  /** Fecha: drena e confere que os `expected` pedaços chegaram todos. */
  async finish(expected: number): Promise<void> {
    await this.drained();
    if (this.nextIdx !== expected) {
      throw new ExtFetchError(
        `o download veio incompleto (${this.nextIdx} de ${expected} pedaços)`,
        'buraco',
        this.nextIdx,
      );
    }
  }
}

/**
 * Cão de guarda de duas pontas: silêncio prolongado (`idleMs` sem nenhum
 * `poke`) e teto absoluto (`absoluteMs` desde o `start`). Relógio injetável
 * pra o teste não esperar 90 s de verdade.
 */
export class InactivityWatchdog {
  private readonly clock: Clock;
  private readonly idleMs: number;
  private readonly absoluteMs: number;
  private readonly onIdle: () => void;
  private readonly onAbsolute: () => void;
  private idleHandle: TimerHandle = null;
  private absHandle: TimerHandle = null;
  private stopped = false;

  constructor(
    clock: Clock,
    opts: { idleMs: number; absoluteMs: number; onIdle: () => void; onAbsolute: () => void },
  ) {
    this.clock = clock;
    this.idleMs = opts.idleMs;
    this.absoluteMs = opts.absoluteMs;
    this.onIdle = opts.onIdle;
    this.onAbsolute = opts.onAbsolute;
  }

  start(): void {
    if (this.stopped) return;
    this.absHandle = this.clock.setTimeout(() => {
      if (this.stopped) return;
      this.stop();
      this.onAbsolute();
    }, this.absoluteMs);
    this.poke();
  }

  /** "Chegou sinal de vida" — reinicia a contagem de silêncio. */
  poke(): void {
    if (this.stopped) return;
    if (this.idleHandle !== null) this.clock.clearTimeout(this.idleHandle);
    this.idleHandle = this.clock.setTimeout(() => {
      if (this.stopped) return;
      this.stop();
      this.onIdle();
    }, this.idleMs);
  }

  stop(): void {
    this.stopped = true;
    if (this.idleHandle !== null) this.clock.clearTimeout(this.idleHandle);
    if (this.absHandle !== null) this.clock.clearTimeout(this.absHandle);
    this.idleHandle = null;
    this.absHandle = null;
  }
}

/** `versionAtLeast('1.8.0', [1,8,0])` — mesma regra do Downloader. */
export function versionAtLeast(v: string | undefined | null, min: readonly number[]): boolean {
  if (!v) return false;
  const parts = String(v)
    .split('.')
    .map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < min.length; i++) {
    const cur = parts[i] || 0;
    if (cur < min[i]) return false;
    if (cur > min[i]) return true;
  }
  return true;
}

function errText(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e ?? 'erro');
}

// ───────────────────────────────────────────────────────────────────────────
// Navegador — handshake e download
// ───────────────────────────────────────────────────────────────────────────

/**
 * Pergunta pra extensão se ela está viva (`DL_PING` → `DL_PONG`). Mesmo
 * protocolo do Downloader — o bridge também anuncia sozinho a cada 3 s, então
 * o burst curto de pings pega qualquer estado de inicialização.
 * Devolve `null` se ninguém respondeu no prazo.
 */
export function pingExtension(timeoutMs = 2500): Promise<ExtPong | null> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') {
      resolve(null);
      return;
    }
    let done = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const finish = (r: ExtPong | null) => {
      if (done) return;
      done = true;
      window.removeEventListener('message', onMsg);
      timers.forEach((t) => clearTimeout(t));
      resolve(r);
    };
    function onMsg(ev: MessageEvent) {
      const d = ev.data as { source?: string; type?: string; version?: string; engine?: boolean; port?: number } | null;
      if (!d || d.source !== 'darko-dl-ext' || d.type !== 'DL_PONG') return;
      finish({
        version: String(d.version || ''),
        engine: d.engine === true,
        port: typeof d.port === 'number' ? d.port : null,
      });
    }
    window.addEventListener('message', onMsg);
    const ping = () => {
      try {
        window.postMessage({ source: 'darko-dl', type: 'DL_PING' }, '*');
      } catch {
        /* ignora */
      }
    };
    [0, 80, 250, 600, 1200].forEach((d) => {
      if (d < timeoutMs) timers.push(setTimeout(ping, d));
    });
    timers.push(setTimeout(() => finish(null), timeoutMs));
  });
}

export type ExtFetchProgress = {
  receivedBytes: number;
  totalBytes: number | null;
  /** 'motor' = o Motor ainda está preparando o arquivo (sem bytes ainda). */
  phase: 'motor' | 'baixando';
};

export type ExtFetchMeta = { filename: string; size: number | null; mime: string };

export type FetchViaExtensionOptions = {
  onProgress?: (p: ExtFetchProgress) => void;
  /**
   * Chega ANTES do primeiro pedaço (nome/tamanho/tipo do arquivo). É por aqui
   * que quem grava descobre a extensão certa do arquivo antes de abrir o
   * stream no OPFS.
   */
  onMeta?: (m: ExtFetchMeta) => void;
  /** Recebe cada pedaço EM ORDEM. Pode ser assíncrono (grava no OPFS). */
  onChunk: ChunkSink;
  signal?: AbortSignal;
  /**
   * Chamado ANTES de uma nova tentativa do zero (o retry rebobina o download
   * inteiro). Quem grava precisa jogar fora o que já escreveu — sem isso o
   * arquivo sairia com o começo duplicado.
   */
  onRestart?: () => void | Promise<void>;
  /** Injeção pra teste. */
  clock?: Clock;
  idleMs?: number;
  absoluteMs?: number;
};

export type ExtFetchResult = {
  filename: string;
  mime: string;
  /** tamanho declarado pelo servidor (pode ser null) */
  declaredBytes: number | null;
  /** bytes realmente entregues */
  bytes: number;
  chunks: number;
};

/**
 * Baixa `req.url` pela extensão. Um retry automático DO ZERO quando o
 * problema foi inatividade (conexão estagnou) — nunca quando já houve entrega
 * parcial sem `onRestart` (retomar do meio corromperia o arquivo).
 */
export async function fetchViaExtension(
  req: Omit<ExtFetchRequest, 'type' | 'reqId'> & { reqId?: string },
  opts: FetchViaExtensionOptions,
): Promise<ExtFetchResult> {
  if (typeof window === 'undefined') {
    throw new ExtFetchError('Isso só roda no navegador.', 'sem-extensao');
  }
  const maxAttempts = 2;
  let last: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const reqId =
      attempt === 1 && req.reqId
        ? req.reqId
        : `ac-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}-${attempt}`;
    try {
      return await fetchOnce({ type: 'DL_FETCH', ...req, reqId }, opts);
    } catch (e) {
      last = e;
      const isIdle = e instanceof ExtFetchError && e.kind === 'inatividade';
      if (!isIdle || attempt >= maxAttempts) throw e;
      const delivered = (e as ExtFetchError).delivered;
      if (delivered > 0 && !opts.onRestart) {
        throw new ExtFetchError(
          'O download travou no meio e não dá pra retomar de onde parou. Tente de novo.',
          'inatividade',
          delivered,
        );
      }
      if (opts.onRestart) await opts.onRestart();
    }
  }
  throw last instanceof Error ? last : new ExtFetchError('O download falhou.', 'remoto');
}

function fetchOnce(req: ExtFetchRequest, opts: FetchViaExtensionOptions): Promise<ExtFetchResult> {
  return new Promise<ExtFetchResult>((resolve, reject) => {
    const clock = opts.clock ?? realClock;
    let settled = false;
    let filename = 'video.mp4';
    let mime = 'video/mp4';
    let declaredBytes: number | null = null;
    let receivedBytes = 0;

    const assembler = new ChunkAssembler((buf, idx) => opts.onChunk(buf, idx));

    const watchdog = new InactivityWatchdog(clock, {
      idleMs: opts.idleMs ?? EXT_IDLE_MS,
      absoluteMs: opts.absoluteMs ?? EXT_ABSOLUTE_MS,
      onIdle: () =>
        fail(
          new ExtFetchError(
            'A extensão ficou 90 segundos sem mandar nada. Confira se o Motor está aberto e tente de novo.',
            'inatividade',
            assembler.delivered,
          ),
        ),
      onAbsolute: () =>
        fail(
          new ExtFetchError(
            'O download passou de 45 minutos e foi interrompido por segurança.',
            'teto',
            assembler.delivered,
          ),
        ),
    });

    const cleanup = () => {
      window.removeEventListener('message', onMsg);
      watchdog.stop();
      if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
    };
    const fail = (e: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      abortRemote(req.reqId);
      reject(e);
    };
    const succeed = (r: ExtFetchResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(r);
    };
    function onAbort() {
      fail(new ExtFetchError('Cancelado por você.', 'cancelado', assembler.delivered));
    }

    function report(phase: 'motor' | 'baixando') {
      opts.onProgress?.({ receivedBytes, totalBytes: declaredBytes, phase });
    }

    function onMsg(ev: MessageEvent) {
      const d = ev.data as (Partial<ExtFetchEvent> & { source?: string; reqId?: string }) | null;
      if (!d || d.source !== 'darko-dl-ext' || d.reqId !== req.reqId) return;
      switch (d.type) {
        case 'DL_FETCH_META': {
          watchdog.poke();
          const m = d as Extract<ExtFetchEvent, { type: 'DL_FETCH_META' }>;
          if (m.filename) filename = m.filename;
          if (m.mime) mime = m.mime;
          declaredBytes = typeof m.size === 'number' && m.size > 0 ? m.size : null;
          opts.onMeta?.({ filename, size: declaredBytes, mime });
          report('baixando');
          return;
        }
        case 'DL_FETCH_PROGRESS': {
          watchdog.poke();
          const p = d as Extract<ExtFetchEvent, { type: 'DL_FETCH_PROGRESS' }>;
          if (typeof p.received === 'number' && p.received > receivedBytes) receivedBytes = p.received;
          if (typeof p.total === 'number' && p.total > 0) declaredBytes = p.total;
          report(p.phase === 'motor' ? 'motor' : 'baixando');
          return;
        }
        case 'DL_FETCH_CHUNK': {
          watchdog.poke();
          const c = d as Extract<ExtFetchEvent, { type: 'DL_FETCH_CHUNK' }>;
          if (!(c.buf instanceof ArrayBuffer)) {
            fail(new ExtFetchError('A extensão mandou um pedaço inválido.', 'remoto', assembler.delivered));
            return;
          }
          assembler.push(c.idx, c.buf);
          const f = assembler.failure;
          if (f) {
            fail(f);
            return;
          }
          if (assembler.bytes > receivedBytes) receivedBytes = assembler.bytes;
          report('baixando');
          return;
        }
        case 'DL_FETCH_DONE': {
          const done = d as Extract<ExtFetchEvent, { type: 'DL_FETCH_DONE' }>;
          watchdog.stop(); // gravar o resto no OPFS pode demorar; não é silêncio
          assembler
            .finish(Number(done.chunks) || 0)
            .then(() => {
              succeed({
                filename,
                mime,
                declaredBytes,
                bytes: assembler.bytes,
                chunks: assembler.delivered,
              });
            })
            .catch((e) => fail(e instanceof Error ? e : new ExtFetchError(errText(e), 'buraco')));
          return;
        }
        case 'DL_FETCH_ERROR': {
          const err = d as Extract<ExtFetchEvent, { type: 'DL_FETCH_ERROR' }>;
          const raw = String(err.error || 'falhou');
          const kind: ExtFetchErrorKind = /inatividade|estagnou|parou de mandar/i.test(raw)
            ? 'inatividade'
            : 'remoto';
          fail(new ExtFetchError(raw, kind, assembler.delivered));
          return;
        }
        default:
          return;
      }
    }

    if (opts.signal) {
      if (opts.signal.aborted) {
        reject(new ExtFetchError('Cancelado por você.', 'cancelado', 0));
        return;
      }
      opts.signal.addEventListener('abort', onAbort);
    }

    window.addEventListener('message', onMsg);
    watchdog.start();
    try {
      window.postMessage({ source: 'darko-dl', ...req }, '*');
    } catch (e) {
      fail(new ExtFetchError(`Não consegui falar com a extensão: ${errText(e)}`, 'sem-extensao'));
    }
  });
}

function abortRemote(reqId: string): void {
  try {
    window.postMessage({ source: 'darko-dl', type: 'DL_FETCH_ABORT', reqId }, '*');
  } catch {
    /* ignora */
  }
}
