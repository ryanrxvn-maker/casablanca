/**
 * Persistencia de ZIPs gerados (Lipsync History) em IndexedDB.
 *
 * Blob URLs nao sobrevivem reload (browser revoga). Pra que o user
 * possa baixar ZIPs gerados em sessoes anteriores, persistimos os
 * bytes do ZIP em IndexedDB e reconstruimos a Blob URL on-demand.
 *
 * Limite tipico IndexedDB: alguns GB (depende do browser).
 * Quota check via navigator.storage.estimate() pra avisar se cheia.
 *
 * BLINDAGEM DE HANG (2026-07-01): toda operação tem TIMEOUT e o open trata
 * `onblocked`. Sem isso, com VÁRIOS tabs abertos do app, uma transação/open
 * bloqueado por outra conexão pendurava o `await saveZip`/`saveBlob` PRA SEMPRE
 * (nem resolve nem rejeita — não caía no try/catch do caller) → a task ficava
 * presa "MONTANDO / done 1/1" por horas no passo de salvar, e só reload destravava.
 * Agora qualquer bloqueio vira REJEIÇÃO em <=15s → o caller (que já tem catch)
 * segue e conclui. Ver [[project_disparo_blindagem_2026_07]].
 */

const DB_NAME = 'darkolab-zip-store';
const DB_VERSION = 1;
const STORE = 'zips';
const DB_OP_TIMEOUT_MS = 15_000; // teto por operação de IDB (open/tx). Generoso pra write real, curto pra hang.
// Write de ENTREGA grande (montado/camo/va zip pode ter 50-150 MB) serializa
// atrás do write de outra aba → 15s NÃO basta e o save estourava o timeout,
// falhando em silêncio (task PRONTO sem arquivo no IDB → botão morto no F5).
// Um teto bem maior pro write real, ainda curto o bastante pra não pendurar
// pra sempre. Ver [[project_disparo_raiz_montado_1kb]] / [[feedback_blindagem_fluxos]].
const DB_WRITE_TIMEOUT_MS = 90_000;

type ZipRecord = {
  key: string;          // chave unica (ex 'batch:<taskId>:takes' / ':montado' / ':camo' / 'va:<taskId>:zip')
  filename: string;
  bytes: Uint8Array;
  size: number;
  createdAt: number;
};

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB indisponivel (server-side ou navegador antigo)'));
      return;
    }
    let settled = false;
    const finish = (fn: () => void) => { if (settled) return; settled = true; clearTimeout(to); fn(); };
    // TIMEOUT: se o open ficar pendurado (bloqueado por outra aba sem disparar evento),
    // rejeita — em vez de pendurar o caller pra sempre.
    const to = setTimeout(
      () => finish(() => reject(new Error('IndexedDB open timeout (possível bloqueio por outra aba)'))),
      DB_OP_TIMEOUT_MS,
    );
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (e) {
      finish(() => reject(e instanceof Error ? e : new Error('Falha abrindo IndexedDB')));
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => finish(() => resolve(req.result));
    req.onerror = () => finish(() => reject(req.error || new Error('Falha abrindo IndexedDB')));
    // CRÍTICO: onblocked (faltava). Dispara quando OUTRA aba segura a conexão e impede
    // este open — sem tratar, o open pendurava sem nunca resolver/rejeitar.
    req.onblocked = () => finish(() => reject(new Error('IndexedDB bloqueado por outra aba')));
  });
}

/** Roda uma transação de IDB com TIMEOUT — um tx que nunca completa (bloqueado por outra
 *  conexão) rejeita em vez de pendurar o caller pra sempre. Fecha o db em qualquer saída. */
function runTx<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  body: (store: IDBObjectStore, resolve: (v: T) => void, reject: (e: unknown) => void) => void,
  timeoutMs: number = DB_OP_TIMEOUT_MS,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(to);
      try { db.close(); } catch { /* ignora */ }
      fn();
    };
    const to = setTimeout(
      () => finish(() => reject(new Error('IndexedDB transação timeout (possível bloqueio por outra aba)'))),
      timeoutMs,
    );
    let tx: IDBTransaction;
    try {
      tx = db.transaction(STORE, mode);
    } catch (e) {
      finish(() => reject(e instanceof Error ? e : new Error('Falha abrindo transação IDB')));
      return;
    }
    tx.onerror = () => finish(() => reject(tx.error));
    tx.onabort = () => finish(() => reject(tx.error || new Error('IDB transação abortada')));
    body(
      tx.objectStore(STORE),
      (v) => finish(() => resolve(v)),
      (e) => finish(() => reject(e)),
    );
  });
}

/** Piso de bytes pra um ZIP de entrega ser considerado real. Um zip do JSZip
 *  VAZIO tem ~22 bytes; um montado só com _ERRO.txt/_DIAGNOSTICO.txt tem ~1KB.
 *  Um zip com ≥1 MP4 real é SEMPRE muito maior. Persistir um zip abaixo disso
 *  sobrescreveria o artefato BOM anterior sob a mesma chave (auto-cura
 *  destrutiva). Guard aditivo: recusa gravar → o IDB preserva o que já tinha. */
const MIN_ZIP_BYTES = 1024;

/** Escrita de IDB com RETRY + reabertura do DB (fix 2026-07-03). Um bloqueio de
 *  outra aba faz openDB/runTx rejeitar em 15s; sem retry isso virava PERDA TOTAL
 *  de persistência do run (AD47GL terminou com ZERO chaves no IDB). O bloqueio é
 *  quase sempre TRANSITÓRIO (a outra aba solta a conexão), então re-tentar com
 *  gap curto recupera. Cada tentativa reabre o DB (a conexão anterior já fechou).
 *  Lança só se TODAS falharem — aí o caller sabe de verdade que não persistiu. */
async function writeWithRetry(rec: ZipRecord, tries = 5): Promise<void> {
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const db = await openDB();
      await runTx<void>(db, 'readwrite', (store, resolve, reject) => {
        const tx = store.transaction;
        store.put(rec);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }, DB_WRITE_TIMEOUT_MS);
      return;
    } catch (e) {
      lastErr = e;
      // Backoff crescente, tetado em 4s — o bloqueio por outra aba é transitório
      // (a outra tx completa e libera). 5 tentativas × (write 90s + gap) dá uma
      // janela ampla o bastante pra sobreviver a uma aba escrevendo um zip enorme.
      if (attempt < tries) await new Promise((r) => setTimeout(r, Math.min(1500 * attempt, 4000)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('IDB write falhou após retries');
}

export async function saveZip(key: string, blob: Blob, filename: string): Promise<void> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  // GUARD: zip suspeito de vazio NÃO sobrescreve o bom anterior. Lança pro caller
  // saber (o caller trata: mantém o artefato + sinaliza no card).
  if (bytes.length < MIN_ZIP_BYTES) {
    throw new Error(`zip '${key}' suspeito de vazio (${bytes.length}B) — não persisto pra não apagar o bom anterior`);
  }
  const rec: ZipRecord = { key, filename, bytes, size: bytes.length, createdAt: Date.now() };
  await writeWithRetry(rec);
}

export async function loadZip(key: string): Promise<{ blobUrl: string; filename: string; size: number } | null> {
  const db = await openDB();
  return runTx<{ blobUrl: string; filename: string; size: number } | null>(db, 'readonly', (store, resolve, reject) => {
    const req = store.get(key);
    req.onsuccess = () => {
      const rec = req.result as ZipRecord | undefined;
      if (!rec) return resolve(null);
      const blob = new Blob([rec.bytes as BlobPart], { type: 'application/zip' });
      resolve({ blobUrl: URL.createObjectURL(blob), filename: rec.filename, size: rec.size });
    };
    req.onerror = () => reject(req.error);
  });
}

export async function listZipKeys(): Promise<Array<{ key: string; filename: string; size: number; createdAt: number }>> {
  const db = await openDB();
  return runTx<Array<{ key: string; filename: string; size: number; createdAt: number }>>(db, 'readonly', (store, resolve, reject) => {
    const out: Array<{ key: string; filename: string; size: number; createdAt: number }> = [];
    const cur = store.openCursor();
    cur.onsuccess = (e: Event) => {
      const c = (e.target as IDBRequest).result as IDBCursorWithValue | null;
      if (c) {
        const v = c.value as ZipRecord;
        out.push({ key: v.key, filename: v.filename, size: v.size, createdAt: v.createdAt });
        c.continue();
      } else {
        resolve(out.sort((a, b) => b.createdAt - a.createdAt));
      }
    };
    cur.onerror = () => reject(cur.error);
  });
}

export async function deleteZip(key: string): Promise<void> {
  const db = await openDB();
  return runTx<void>(db, 'readwrite', (store, resolve, reject) => {
    const tx = store.transaction;
    store.delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getStorageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
  const e = await navigator.storage.estimate();
  return { usage: e.usage || 0, quota: e.quota || 0 };
}

/* ============================================================
 * BLOB STORE — persiste blobs MP4 individuais (não só ZIPs).
 * Usado pelo Pilot pra que RETOMAR consiga remontar SEM precisar
 * re-baixar do HeyGen (URLs expiram + sobrecarrega).
 * ============================================================ */

export async function saveBlob(key: string, blob: Blob, mime = 'video/mp4'): Promise<void> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  // Sem guard de tamanho aqui (áudio white/clipe derivado pode ser pequeno e
  // legítimo), mas COM retry+reabertura: bloqueio transitório de outra aba não
  // vira mais perda silenciosa da parte baixada (fix 2026-07-03).
  const rec: ZipRecord = { key, filename: key.replace(/[^a-z0-9._-]/gi, '_') + '.bin', bytes, size: bytes.length, createdAt: Date.now() };
  await writeWithRetry(rec);
}

export async function loadBlob(key: string, mime = 'video/mp4'): Promise<Blob | null> {
  const db = await openDB();
  return runTx<Blob | null>(db, 'readonly', (store, resolve, reject) => {
    const req = store.get(key);
    req.onsuccess = () => {
      const rec = req.result as ZipRecord | undefined;
      if (!rec) return resolve(null);
      resolve(new Blob([rec.bytes as BlobPart], { type: mime }));
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * FAXINA AUTOMÁTICA (LRU por disparo) — evita o store crescer sem teto.
 *
 * MOTIVO (medido em prod 2026-07-09): o IndexedDB acumulava montado+takes+partes
 * de TODO disparo e nada purgava. No Chrome (banco por-origem, nunca some sozinho)
 * chegou a 223 blobs / 1,58 GB → o BOOT da página levava 70s. Firefox mascarava
 * (banco separado por origem). Ver [[project_disco_c_limpeza]].
 *
 * Best-effort e idempotente: lê só metadados (key/size/createdAt, sem reter
 * bytes), decide via `planZipEviction` (puro/testado) e apaga só o que é VELHO,
 * concluído e além da janela — NUNCA o disparo ativo (`protect`), o recente
 * (< minAgeMs) nem os `keepGroups` mais novos. Qualquer erro é engolido pra
 * nunca atrapalhar o boot/entrega. Ver lib/zip-store-prune.ts.
 */
export async function pruneZipStore(opts: {
  protect?: Iterable<string>;
  keepGroups?: number;
  minAgeMs?: number;
  maxBytes?: number;
} = {}): Promise<{ evicted: number; freedBytes: number; keptGroups: number } | null> {
  try {
    const { planZipEviction } = await import('./zip-store-prune');
    // Áudios de itens de FILA do Hey Auto ainda não entregues são protegidos
    // AQUI (não só no protect do caller): a faxina também roda no boot do
    // Pilot/Auto B-roll, que não conhecem a fila — sem isto uma fila pendente
    // de madrugada (>12h) perdia os áudios pra faxina de outra ferramenta.
    const { listQueueAudioProtectIds } = await import('./heygen-queue-store');
    const protect = new Set<string>(opts.protect ? Array.from(opts.protect) : []);
    for (const id of listQueueAudioProtectIds()) protect.add(id);
    // listZipKeys lê via cursor SEM reter bytes (só key/size/createdAt) — pico de
    // memória é ~1 registro por vez, não o store inteiro.
    const metas = await listZipKeys();
    if (metas.length === 0) return { evicted: 0, freedBytes: 0, keptGroups: 0 };
    const plan = planZipEviction(
      metas.map((m) => ({ key: m.key, size: m.size, createdAt: m.createdAt })),
      { ...opts, protect },
    );
    if (plan.evictKeys.length === 0) {
      return { evicted: 0, freedBytes: 0, keptGroups: plan.stats.keptGroups };
    }
    const evictSet = new Set(plan.evictKeys);
    const db = await openDB();
    await runTx<void>(db, 'readwrite', (store, resolve, reject) => {
      const tx = store.transaction;
      const cur = store.openKeyCursor();
      cur.onsuccess = (e: Event) => {
        const c = (e.target as IDBRequest).result as IDBCursor | null;
        if (c) {
          if (evictSet.has(c.primaryKey as string)) store.delete(c.primaryKey);
          c.continue();
        }
      };
      cur.onerror = () => reject(cur.error);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }, DB_WRITE_TIMEOUT_MS);
    return { evicted: plan.evictKeys.length, freedBytes: plan.stats.freedBytes, keptGroups: plan.stats.keptGroups };
  } catch (e) {
    console.warn('[zip-store prune] faxina falhou (ignorado):', e);
    return null;
  }
}

/**
 * Limpa todos os blobs de um taskId (cleanup após batch completar).
 *
 * ⚠ `preservar` existe porque nem tudo sob `pilot:<taskId>:` é RESULTADO. O
 * frame do modo imagem (`:img:<i>`) é INSUMO — é ele que a cena anima. A purga
 * por geração apagava o frame junto com os takes velhos e, logo em seguida, o
 * disparo não achava a imagem e a cena morria "sem imagem" (medido 16/08 no
 * AD43: os três frames sumiam entre o clique e o submit). Take velho tem que
 * sumir mesmo; o frame, não.
 */
export async function deletePrefix(
  prefix: string,
  opts: { preservar?: RegExp } = {},
): Promise<number> {
  const db = await openDB();
  return runTx<number>(db, 'readwrite', (store, resolve, reject) => {
    let count = 0;
    const cur = store.openCursor();
    cur.onsuccess = (e: Event) => {
      const c = (e.target as IDBRequest).result as IDBCursorWithValue | null;
      if (c) {
        const v = c.value as ZipRecord;
        const guardar = opts.preservar?.test(v.key) ?? false;
        if (v.key.startsWith(prefix) && !guardar) { c.delete(); count++; }
        c.continue();
      } else {
        resolve(count);
      }
    };
    cur.onerror = () => reject(cur.error);
  });
}

/** O que a purga por GERAÇÃO nunca pode levar: insumo do disparo, não
 *  resultado dele. Hoje: o frame do modo imagem (`:img:`) e o ÁUDIO upado por
 *  avatar (`:roleaudio:`) — os dois são matéria-prima que o RETOMAR/REINICIAR
 *  precisa reusar; take velho continua sendo purgado normalmente. */
export const INSUMO_DO_DISPARO = /:img:|:roleaudio:/;
