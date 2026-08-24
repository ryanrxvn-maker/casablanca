/**
 * AUTO CORTES — arquivo grande no OPFS (Origin Private File System).
 *
 * Por que não guardar o vídeo em memória: o caso NORMAL aqui é podcast de
 * 2-3 h / 2-4 GB. Juntar isso num Blob de partes coloca tudo no heap do
 * navegador e a aba morre ("Allocation failed"). O OPFS grava em DISCO em
 * stream e no final devolve um `File` disk-backed — o mesmo tipo que o
 * WORKERFS do ffmpeg-wasm monta sem carregar nada no heap (receita já
 * provada no Compressor).
 *
 * Sem OPFS (navegador antigo / modo restrito) tem plano B: acumula as partes
 * em memória e AVISA quando passa de 1,5 GB. Não trava o cliente — mas ele
 * fica sabendo por que o navegador pode engasgar.
 *
 * Layout: /auto-cortes/<projectId>/<arquivo>
 */

const ROOT_DIR = 'auto-cortes';

/** Acima disso o plano B (memória) é risco real de derrubar a aba. */
export const MEM_FALLBACK_WARN_BYTES = 1.5 * 1024 * 1024 * 1024;

export type OpfsWriteOptions = {
  /** MIME do arquivo final (o OPFS devolve type vazio e o <video> não toca). */
  mime?: string;
  /** Avisos em PT-BR pra UI (ex.: memória sem OPFS). */
  onWarn?: (message: string) => void;
};

export type OpfsWriteStream = {
  write(chunk: ArrayBuffer | Uint8Array | Blob): Promise<void>;
  /** Fecha e devolve o arquivo pronto. */
  close(): Promise<File>;
  /** Desiste e apaga o que já foi escrito. */
  abort(): Promise<void>;
  readonly bytesWritten: number;
  /** true = está no plano B (memória), não em disco. */
  readonly inMemory: boolean;
};

// ───────────────────────────────────────────────────────────────────────────
// Plano B (sem OPFS)
// ───────────────────────────────────────────────────────────────────────────

type MemEntry = { parts: BlobPart[]; bytes: number; mime: string };
const memStore = new Map<string, MemEntry>();

// ───────────────────────────────────────────────────────────────────────────
// Utilidades
// ───────────────────────────────────────────────────────────────────────────

export function opfsAvailable(): boolean {
  try {
    return (
      typeof navigator !== 'undefined' &&
      !!navigator.storage &&
      typeof navigator.storage.getDirectory === 'function'
    );
  } catch {
    return false;
  }
}

/** Caminho padrão da pasta de um projeto. */
export function opfsProjectDir(projectId: string): string {
  return `/${ROOT_DIR}/${sanitizeSegment(projectId)}`;
}

/** Caminho padrão do arquivo-fonte de um projeto. */
export function opfsSourcePath(projectId: string, ext = 'mp4'): string {
  return `${opfsProjectDir(projectId)}/source.${sanitizeSegment(ext) || 'mp4'}`;
}

function sanitizeSegment(s: string): string {
  return String(s || '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

/** '/auto-cortes/p1/source.mp4' → ['auto-cortes','p1','source.mp4'] */
function splitPath(path: string): string[] {
  return String(path || '')
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);
}

function normKey(path: string): string {
  return '/' + splitPath(path).join('/');
}

async function walkDir(
  segments: string[],
  create: boolean,
): Promise<FileSystemDirectoryHandle | null> {
  let dir = await navigator.storage.getDirectory();
  for (const seg of segments) {
    try {
      dir = await dir.getDirectoryHandle(seg, { create });
    } catch {
      return null;
    }
  }
  return dir;
}

// ───────────────────────────────────────────────────────────────────────────
// API
// ───────────────────────────────────────────────────────────────────────────

/**
 * Abre um arquivo pra escrita em stream. Cada `write` vai direto pro disco;
 * `close()` devolve o `File` (disk-backed — não passa pelo heap).
 */
export async function opfsWriteStream(
  path: string,
  opts: OpfsWriteOptions = {},
): Promise<OpfsWriteStream> {
  const segs = splitPath(path);
  if (segs.length === 0) throw new Error('Caminho vazio no armazenamento local.');
  const name = segs[segs.length - 1];
  const dirSegs = segs.slice(0, -1);
  const key = normKey(path);
  const mime = opts.mime || '';

  if (opfsAvailable()) {
    try {
      const dir = await walkDir(dirSegs, true);
      if (!dir) throw new Error('não consegui criar a pasta');
      const handle = await dir.getFileHandle(name, { create: true });
      const writable = await handle.createWritable({ keepExistingData: false });
      let bytes = 0;
      let closed = false;
      return {
        get bytesWritten() {
          return bytes;
        },
        inMemory: false,
        async write(chunk) {
          if (closed) throw new Error('o arquivo já foi fechado.');
          await writable.write(chunk as BufferSource | Blob);
          bytes += chunkSize(chunk);
        },
        async close() {
          if (!closed) {
            closed = true;
            await writable.close();
          }
          const f = await handle.getFile();
          return mime && !f.type ? new File([f], name, { type: mime }) : f;
        },
        async abort() {
          if (closed) return;
          closed = true;
          try {
            await writable.abort();
          } catch {
            /* já fechado */
          }
          try {
            await dir.removeEntry(name);
          } catch {
            /* nem chegou a existir */
          }
        },
      };
    } catch {
      // cai no plano B (cota, modo restrito, storage bloqueado por outra aba)
    }
  }

  // ── plano B: memória ──
  const entry: MemEntry = { parts: [], bytes: 0, mime };
  memStore.set(key, entry);
  let warned = false;
  let closedMem = false;
  opts.onWarn?.(
    'Este navegador não tem armazenamento em disco pro app (OPFS). Vou segurar o vídeo na memória — arquivo muito grande pode ficar pesado.',
  );
  return {
    get bytesWritten() {
      return entry.bytes;
    },
    inMemory: true,
    async write(chunk) {
      if (closedMem) throw new Error('o arquivo já foi fechado.');
      entry.parts.push(chunk instanceof Blob ? chunk : toBlobPart(chunk));
      entry.bytes += chunkSize(chunk);
      if (!warned && entry.bytes > MEM_FALLBACK_WARN_BYTES) {
        warned = true;
        const gb = (entry.bytes / 1024 / 1024 / 1024).toFixed(1);
        opts.onWarn?.(
          `Já são ${gb} GB na memória (sem armazenamento em disco neste navegador). Feche outras abas — ou use um arquivo menor pra não travar.`,
        );
      }
    },
    async close() {
      closedMem = true;
      return new File(entry.parts, name, mime ? { type: mime } : undefined);
    },
    async abort() {
      closedMem = true;
      memStore.delete(key);
    },
  };
}

function toBlobPart(chunk: ArrayBuffer | Uint8Array): BlobPart {
  // O Blob já copia os bytes pro store dele — não precisa clonar aqui. O cast
  // existe só por causa da tipagem nova do TS 5.9 (Uint8Array<ArrayBufferLike>
  // não casa com ArrayBufferView<ArrayBuffer>), não por diferença em runtime.
  return chunk as unknown as BlobPart;
}

function chunkSize(chunk: ArrayBuffer | Uint8Array | Blob): number {
  if (chunk instanceof Blob) return chunk.size;
  if (chunk instanceof Uint8Array) return chunk.byteLength;
  return chunk.byteLength;
}

/** Lê um arquivo já gravado. `null` se não existe. */
export async function opfsGetFile(path: string, mime?: string): Promise<File | null> {
  const segs = splitPath(path);
  if (segs.length === 0) return null;
  const name = segs[segs.length - 1];
  if (opfsAvailable()) {
    try {
      const dir = await walkDir(segs.slice(0, -1), false);
      if (dir) {
        const handle = await dir.getFileHandle(name, { create: false });
        const f = await handle.getFile();
        return mime && !f.type ? new File([f], name, { type: mime }) : f;
      }
    } catch {
      /* não existe em disco — tenta a memória */
    }
  }
  const mem = memStore.get(normKey(path));
  if (!mem) return null;
  return new File(mem.parts, name, mem.mime ? { type: mem.mime } : undefined);
}

/** Apaga um arquivo OU uma pasta inteira (caminho sem extensão / com '/'). */
export async function opfsDelete(path: string): Promise<void> {
  const segs = splitPath(path);
  if (segs.length === 0) return;
  const name = segs[segs.length - 1];
  if (opfsAvailable()) {
    try {
      const dir = await walkDir(segs.slice(0, -1), false);
      if (dir) await dir.removeEntry(name, { recursive: true });
    } catch {
      /* já não existe */
    }
  }
  const key = normKey(path);
  memStore.delete(key);
  const prefix = key.endsWith('/') ? key : key + '/';
  Array.from(memStore.keys()).forEach((k) => {
    if (k.startsWith(prefix)) memStore.delete(k);
  });
}

export type OpfsUsage = {
  /** bytes usados pela origem (todos os stores, não só o nosso) */
  usageBytes: number;
  /** cota total, quando o navegador informa */
  quotaBytes: number | null;
  /** bytes segurados no plano B (memória) */
  memoryBytes: number;
  /** true = estamos sem OPFS */
  fallback: boolean;
};

export async function opfsUsage(): Promise<OpfsUsage> {
  let memoryBytes = 0;
  memStore.forEach((v) => {
    memoryBytes += v.bytes;
  });
  const fallback = !opfsAvailable();
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      return {
        usageBytes: est.usage || 0,
        quotaBytes: typeof est.quota === 'number' ? est.quota : null,
        memoryBytes,
        fallback,
      };
    }
  } catch {
    /* sem estimativa */
  }
  return { usageBytes: memoryBytes, quotaBytes: null, memoryBytes, fallback };
}
