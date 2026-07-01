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
      DB_OP_TIMEOUT_MS,
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

export async function saveZip(key: string, blob: Blob, filename: string): Promise<void> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const rec: ZipRecord = { key, filename, bytes, size: bytes.length, createdAt: Date.now() };
  const db = await openDB();
  return runTx<void>(db, 'readwrite', (store, resolve, reject) => {
    const tx = store.transaction;
    store.put(rec);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
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
  const rec: ZipRecord = { key, filename: key.replace(/[^a-z0-9._-]/gi, '_') + '.bin', bytes, size: bytes.length, createdAt: Date.now() };
  const db = await openDB();
  return runTx<void>(db, 'readwrite', (store, resolve, reject) => {
    const tx = store.transaction;
    store.put(rec);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
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

/** Limpa todos os blobs de um taskId (cleanup após batch completar). */
export async function deletePrefix(prefix: string): Promise<number> {
  const db = await openDB();
  return runTx<number>(db, 'readwrite', (store, resolve, reject) => {
    let count = 0;
    const cur = store.openCursor();
    cur.onsuccess = (e: Event) => {
      const c = (e.target as IDBRequest).result as IDBCursorWithValue | null;
      if (c) {
        const v = c.value as ZipRecord;
        if (v.key.startsWith(prefix)) { c.delete(); count++; }
        c.continue();
      } else {
        resolve(count);
      }
    };
    cur.onerror = () => reject(cur.error);
  });
}
