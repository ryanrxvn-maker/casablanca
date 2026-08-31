'use client';

/**
 * COFRE DO HISTÓRICO — a parte que torna o Histórico geral RECUPERÁVEL,
 * e não só visível.
 *
 * Desenho (pedido 31.08: "tudo que o usuário gera fica baixável por 7 dias,
 * sem virar depósito de lixo e sem pesar o app"):
 *
 * - IndexedDB PRÓPRIO ('autoedit-history-vault'), separado do zip-store dos
 *   disparos de propósito: a faxina LRU dos disparos (8 grupos/12h/800MB)
 *   nunca compete com o cofre, e vice-versa. Mesma receita de blindagem
 *   anti-hang do zip-store (timeout + onblocked + fechar db em toda saída).
 *
 * - CAPTURA AUTOMÁTICA: downloadBlob() (lib/audio-engine.ts) chama
 *   captureDownload() em fire-and-forget. Artefato pequeno (≤ VAULT_MAX_FILE)
 *   tem os bytes guardados; a referência é anexada ao evento do histórico
 *   (fusão com o logHistory da página — ver attachRefToRecent).
 *
 * - ANTI-LIXO: teto por arquivo + teto total com LRU + teto de quantidade +
 *   TTL de 7 dias + limpeza de órfãos (bytes cujo evento já saiu do
 *   histórico). Poda roda em requestIdleCallback — nunca no caminho quente.
 *
 * - ARQUIVO GRANDE DO HEYGEN: não guarda bytes — guarda a RECEITA (videoIds
 *   no FileRef via:'heygen'). Na hora de baixar, re-busca do HeyGen pela
 *   extensão (getVideosStatus + downloadVideoBytes), mesmo que o background
 *   do Pilot já tenha sido limpo. O HeyGen retém ~60 dias.
 */

import { attachRefToRecent, readHistory, type FileRef } from './history';

// ---------- Limites (anti-lixo) -------------------------------------------

/** Maior arquivo que o cofre aceita guardar (acima disso: só se houver receita). */
export const VAULT_MAX_FILE_BYTES = 64 * 1024 * 1024; // 64MB
/** Teto total do cofre — estourou, LRU derruba os mais antigos. */
export const VAULT_MAX_TOTAL_BYTES = 700 * 1024 * 1024; // 700MB
/** Teto de quantidade — proteção contra milhares de arquivinhos. */
export const VAULT_MAX_FILES = 400;
/** Mesma retenção do histórico: 7 dias. */
export const VAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// ---------- IndexedDB blindado (receita do zip-store) ---------------------

const DB_NAME = 'autoedit-history-vault';
const STORE = 'files';
const DB_OP_TIMEOUT_MS = 15_000;
const DB_WRITE_TIMEOUT_MS = 90_000;

type VaultRecord = {
  key: string;
  name: string;
  mime: string;
  /** Blob quando o navegador aceita (Chrome guarda por referência); senão bytes. */
  blob?: Blob;
  bytes?: Uint8Array;
  size: number;
  createdAt: number;
};

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        reject(new Error('vault: openDB timeout'));
      }
    }, DB_OP_TIMEOUT_MS);
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => {
      if (done) {
        try {
          req.result.close();
        } catch {}
        return;
      }
      done = true;
      clearTimeout(timer);
      resolve(req.result);
    };
    req.onerror = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(req.error ?? new Error('vault: openDB falhou'));
    };
    req.onblocked = () => {
      // Outra aba segurando versão antiga: não fica pendurado pra sempre —
      // o timeout acima resolve. (Mesma lição do zip-store.)
    };
  });
}

function runTx<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore, resolve: (v: T) => void, reject: (e: unknown) => void) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let done = false;
    const timeout = mode === 'readwrite' ? DB_WRITE_TIMEOUT_MS : DB_OP_TIMEOUT_MS;
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        try {
          db.close();
        } catch {}
        reject(new Error('vault: transação travou (timeout)'));
      }
    }, timeout);
    const finish = (ok: boolean, val: T | unknown) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        db.close();
      } catch {}
      if (ok) resolve(val as T);
      else reject(val);
    };
    try {
      const tx = db.transaction(STORE, mode);
      tx.onabort = () => finish(false, tx.error ?? new Error('vault: tx abortada'));
      fn(
        tx.objectStore(STORE),
        (v) => finish(true, v),
        (e) => finish(false, e),
      );
    } catch (e) {
      finish(false, e);
    }
  });
}

async function putRecord(rec: VaultRecord): Promise<void> {
  const db = await openDB();
  return runTx<void>(db, 'readwrite', (store, resolve, reject) => {
    const tx = store.transaction;
    store.put(rec);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function vaultLoad(key: string): Promise<Blob | null> {
  try {
    const db = await openDB();
    return await runTx<Blob | null>(db, 'readonly', (store, resolve, reject) => {
      const req = store.get(key);
      req.onsuccess = () => {
        const rec = req.result as VaultRecord | undefined;
        if (!rec) return resolve(null);
        if (rec.blob instanceof Blob) return resolve(rec.blob);
        if (rec.bytes) return resolve(new Blob([rec.bytes as BlobPart], { type: rec.mime }));
        resolve(null);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function vaultDelete(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const db = await openDB();
  return runTx<void>(db, 'readwrite', (store, resolve, reject) => {
    const tx = store.transaction;
    for (const k of keys) store.delete(k);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export type VaultMeta = { key: string; name: string; size: number; createdAt: number };

/** Só metadados (cursor sem materializar blob) — barato mesmo com centenas. */
export async function vaultList(): Promise<VaultMeta[]> {
  try {
    const db = await openDB();
    return await runTx<VaultMeta[]>(db, 'readonly', (store, resolve, reject) => {
      const out: VaultMeta[] = [];
      const cur = store.openCursor();
      cur.onsuccess = (e: Event) => {
        const c = (e.target as IDBRequest).result as IDBCursorWithValue | null;
        if (c) {
          const v = c.value as VaultRecord;
          out.push({ key: v.key, name: v.name, size: v.size, createdAt: v.createdAt });
          c.continue();
        } else {
          resolve(out);
        }
      };
      cur.onerror = () => reject(cur.error);
    });
  } catch {
    return [];
  }
}

export async function vaultStats(): Promise<{ files: number; bytes: number }> {
  const list = await vaultList();
  return { files: list.length, bytes: list.reduce((n, r) => n + (r.size || 0), 0) };
}

export async function clearVault(): Promise<void> {
  try {
    const db = await openDB();
    await runTx<void>(db, 'readwrite', (store, resolve, reject) => {
      const tx = store.transaction;
      store.clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* best-effort */
  }
}

// ---------- Poda (TTL + órfãos + LRU) -------------------------------------

let pruneAgendada = false;

/** Agenda a poda pra quando o navegador estiver ocioso — nunca no caminho quente. */
export function scheduleVaultPrune(): void {
  if (typeof window === 'undefined' || pruneAgendada) return;
  pruneAgendada = true;
  const run = () => {
    pruneAgendada = false;
    void pruneVault();
  };
  if ('requestIdleCallback' in window) {
    (window as unknown as { requestIdleCallback: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback(run, { timeout: 10_000 });
  } else {
    setTimeout(run, 3_000);
  }
}

/**
 * Poda o cofre: (1) TTL 7 dias; (2) órfãos — bytes cujo evento já saiu do
 * histórico; (3) LRU por teto total/quantidade. Nunca lança.
 */
export async function pruneVault(): Promise<void> {
  try {
    const list = await vaultList();
    if (list.length === 0) return;
    const agora = Date.now();
    const emUso = new Set<string>();
    for (const ev of readHistory()) {
      for (const r of ev.ref ?? []) {
        if (r.via === 'vault') emUso.add(r.key);
      }
    }
    const remover = new Set<string>();
    for (const rec of list) {
      if (agora - rec.createdAt > VAULT_TTL_MS) remover.add(rec.key);
      else if (!emUso.has(rec.key)) remover.add(rec.key);
    }
    // LRU: entre os sobreviventes, derruba os mais antigos até caber.
    const vivos = list
      .filter((r) => !remover.has(r.key))
      .sort((a, b) => b.createdAt - a.createdAt);
    let bytes = 0;
    let count = 0;
    for (const rec of vivos) {
      bytes += rec.size || 0;
      count += 1;
      if (bytes > VAULT_MAX_TOTAL_BYTES || count > VAULT_MAX_FILES) remover.add(rec.key);
    }
    if (remover.size > 0) await vaultDelete([...remover]);
  } catch {
    /* poda nunca derruba ferramenta */
  }
}

// ---------- Captura automática de download --------------------------------

function toolFromPathname(): string {
  try {
    const m = /\/tools\/([a-z0-9-]+)/i.exec(window.location.pathname);
    return m ? m[1] : 'downloader';
  } catch {
    return 'downloader';
  }
}

function novaChave(): string {
  return `hv:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Captura um download que acabou de ser disparado e o torna recuperável pelo
 * Histórico geral. Fire-and-forget: nunca lança, nunca atrasa o download em si.
 *
 * Política:
 * - vazio/minúsculo (<100B) → ignora (lixo);
 * - até VAULT_MAX_FILE_BYTES → guarda os bytes no cofre + anexa ref ao evento
 *   recente da ferramenta (ou cria um provisório que a página absorve);
 * - acima do teto → não guarda (as ferramentas de artefato grande do HeyGen
 *   anexam a própria receita via:'heygen'/'zip' no logHistory delas).
 */
export function captureDownload(blob: Blob, filename: string, toolHint?: string): void {
  if (typeof window === 'undefined') return;
  try {
    if (!blob || blob.size < 100) return;
    if (blob.size > VAULT_MAX_FILE_BYTES) return;
    const tool = toolHint || toolFromPathname();
    const key = novaChave();
    void (async () => {
      try {
        const mime = blob.type || 'application/octet-stream';
        let rec: VaultRecord = {
          key,
          name: filename,
          mime,
          blob,
          size: blob.size,
          createdAt: Date.now(),
        };
        try {
          await putRecord(rec);
        } catch {
          // Alguns ambientes recusam Blob no IDB — fallback pra bytes.
          rec = {
            key,
            name: filename,
            mime,
            bytes: new Uint8Array(await blob.arrayBuffer()),
            size: blob.size,
            createdAt: Date.now(),
          };
          await putRecord(rec);
        }
        const r = attachRefToRecent({
          tool,
          ref: { via: 'vault', key, name: filename, size: blob.size, mime },
          fallbackTitle: `${filename} baixado`,
        });
        if (r === 'skipped') {
          // Double-click do mesmo download — descarta os bytes duplicados.
          await vaultDelete([key]);
          return;
        }
        scheduleVaultPrune();
      } catch {
        /* captura nunca derruba download */
      }
    })();
  } catch {
    /* nunca propaga */
  }
}

// ---------- Recuperação (a cadeia que faz o "Baixar" sempre achar) --------

export type RecoverResult =
  | { ok: true }
  | { ok: false; reason: string; sugerirHeygen?: boolean };

async function baixarBlob(blob: Blob, filename: string): Promise<void> {
  const { downloadBlob } = await import('./audio-engine');
  await downloadBlob(blob, filename, { capture: false });
}

function sanitizeName(s: string): string {
  return s.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim() || 'take';
}

/**
 * Resolve UMA referência e dispara o download.
 * - vault  → bytes do cofre;
 * - zip    → zip-store dos disparos (batch:<id>:…);
 * - heygen → re-busca cada take pelo videoId via extensão e entrega
 *            (1 take = mp4 solto; vários = zip STORE), com relatório do que
 *            o HeyGen não devolveu.
 */
export async function recoverRef(
  ref: FileRef,
  onProgress?: (msg: string) => void,
): Promise<RecoverResult> {
  try {
    if (ref.via === 'vault') {
      const blob = await vaultLoad(ref.key);
      if (!blob) {
        return {
          ok: false,
          reason:
            'Esse arquivo já saiu do cofre do navegador (7 dias, ou limpeza de espaço). Gere de novo na ferramenta.',
        };
      }
      await baixarBlob(blob, ref.name);
      return { ok: true };
    }

    if (ref.via === 'zip') {
      const { loadBlob } = await import('./zip-store');
      const blob = await loadBlob(ref.key, 'application/zip');
      if (!blob) {
        return {
          ok: false,
          reason:
            'Esse pacote já saiu do cache do navegador (limpeza automática de espaço).',
          sugerirHeygen: true,
        };
      }
      await baixarBlob(blob, ref.name);
      return { ok: true };
    }

    // via === 'heygen' — resgate pelos videoIds
    const parts = ref.parts.filter((p) => p?.videoId);
    if (parts.length === 0) {
      return { ok: false, reason: 'Esse disparo não guardou os IDs dos vídeos — não dá pra resgatar.' };
    }
    onProgress?.('Consultando o HeyGen…');
    const { getVideosStatus, downloadVideoBytes } = await import('./heygen-api-direct');
    let status: Awaited<ReturnType<typeof getVideosStatus>>;
    try {
      status = await getVideosStatus(parts.map((p) => p.videoId));
    } catch (e) {
      return {
        ok: false,
        reason: `Não consegui falar com o HeyGen (${(e as Error)?.message || 'sem detalhe'}). Confere se a extensão está instalada e se tem uma aba logada em app.heygen.com.`,
      };
    }
    const entries: { name: string; data: Uint8Array }[] = [];
    const faltaram: string[] = [];
    let i = 0;
    for (const p of parts) {
      i += 1;
      const st = status[p.videoId];
      const url = st?.videoUrl;
      if (!url) {
        faltaram.push(`${p.label} (${st?.status || 'não encontrado'})`);
        continue;
      }
      onProgress?.(`Baixando take ${i}/${parts.length} — ${p.label}…`);
      try {
        const bytes = await downloadVideoBytes(url);
        entries.push({
          name: `${String(i).padStart(2, '0')} - ${sanitizeName(p.label)}.mp4`,
          data: bytes,
        });
      } catch {
        faltaram.push(`${p.label} (download falhou)`);
      }
    }
    if (entries.length === 0) {
      return {
        ok: false,
        reason:
          'O HeyGen não devolveu nenhum take desse disparo — os vídeos podem ter sido apagados lá (retenção ~60 dias) ou a extensão não está conectada.',
      };
    }
    if (faltaram.length > 0) {
      entries.push({
        name: '_FALTARAM.txt',
        data: new TextEncoder().encode(
          `Takes que o HeyGen nao devolveu neste resgate:\n${faltaram.map((f) => `- ${f}`).join('\n')}\n`,
        ),
      });
    }
    onProgress?.('Empacotando…');
    if (entries.length === 1 && faltaram.length === 0) {
      await baixarBlob(new Blob([entries[0].data as BlobPart], { type: 'video/mp4' }), entries[0].name);
    } else {
      const { buildZip } = await import('./zip-builder');
      const zip = await buildZip(entries);
      await baixarBlob(zip, ref.name);
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: (e as Error)?.message || 'Falha inesperada no resgate.' };
  }
}
