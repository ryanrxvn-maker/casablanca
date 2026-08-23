/**
 * AUTO CORTES — persistência do projeto e dos artefatos (IndexedDB próprio).
 *
 * Banco `autoedit-auto-cortes` (v1), separado do `darkolab-zip-store` de
 * propósito: o Auto Cortes guarda MP4 de corte + miniatura por projeto e não
 * pode competir por faxina/quota com os disparos do Pilot.
 *
 *   projects  keyPath 'id'   → o registro `Project` inteiro (types.ts)
 *   blobs     keyPath 'key'  → { key, bytes, mime, size, createdAt, projectId }
 *                              + índice `by_project` (apaga o projeto sem ler bytes)
 *
 * Chaves de blob (fixas, o pipeline monta com estas funções):
 *   ac:<projectId>:clip:<clipId>    — MP4 final do corte
 *   ac:<projectId>:thumb:<clipId>   — JPEG da miniatura
 *
 * BLINDAGEM (mesma receita de lib/zip-store.ts, que nasceu de um bug real):
 * toda operação tem TIMEOUT e o `open` trata `onblocked`. Com várias abas do
 * app abertas, uma transação bloqueada por outra conexão pendurava o `await`
 * PRA SEMPRE (nem resolve nem rejeita — não caía no try/catch de ninguém).
 * Aqui qualquer bloqueio vira REJEIÇÃO em <= 15 s (90 s no write real, que
 * pode ser um MP4 de 100 MB atrás do write de outra aba) e o chamador segue.
 * Ver [[project_disparo_blindagem_2026_07]] / [[feedback_blindagem_fluxos]].
 *
 * Os bytes são guardados como `Blob` sempre que o navegador aceita: o Chrome
 * guarda Blob por REFERÊNCIA no IDB, então listar/podar não traz megabytes pro
 * heap. Se o put com Blob falhar (motor antigo), cai pra `Uint8Array`.
 */

import type { Project, ProjectPhase } from './types';
import { opfsDelete } from './opfs';

const DB_NAME = 'autoedit-auto-cortes';
const DB_VERSION = 1;
const STORE_PROJECTS = 'projects';
const STORE_BLOBS = 'blobs';
const INDEX_BY_PROJECT = 'by_project';

/** Teto por operação de IDB (open/leitura). Generoso pro real, curto pro hang. */
const DB_OP_TIMEOUT_MS = 15_000;
/** Write de MP4 grande serializa atrás do write de outra aba — teto bem maior. */
const DB_WRITE_TIMEOUT_MS = 90_000;

/** Poda padrão (ARQUITETURA §3.6): LRU 6 projetos / 7 dias / 1,5 GB. */
export const PRUNE_DEFAULTS = {
  maxProjects: 6,
  maxAgeMs: 7 * 24 * 60 * 60 * 1000,
  maxBytes: 1.5 * 1024 * 1024 * 1024,
} as const;

export type BlobRecord = {
  key: string;
  bytes: Uint8Array | Blob;
  mime: string;
  size: number;
  createdAt: number;
  projectId: string;
};

export type ProjectSummary = {
  id: string;
  /** nome da fonte (o que a UI mostra na lista de recentes) */
  name: string;
  updatedAt: number;
  createdAt: number;
  phase: ProjectPhase;
  /** nº de cortes encontrados */
  clips: number;
  /** quantos já renderizaram */
  ready: number;
};

// ───────────────────────────────────────────────────────────────────────────
// Chaves
// ───────────────────────────────────────────────────────────────────────────

export function clipBlobKey(projectId: string, clipId: string): string {
  return `ac:${projectId}:clip:${clipId}`;
}

export function thumbBlobKey(projectId: string, clipId: string): string {
  return `ac:${projectId}:thumb:${clipId}`;
}

// ───────────────────────────────────────────────────────────────────────────
// Abertura / transações (com timeout e onblocked)
// ───────────────────────────────────────────────────────────────────────────

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB indisponível (server-side ou navegador antigo)'));
      return;
    }
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(to);
      fn();
    };
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
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_BLOBS)) {
        const s = db.createObjectStore(STORE_BLOBS, { keyPath: 'key' });
        s.createIndex(INDEX_BY_PROJECT, 'projectId', { unique: false });
      }
    };
    req.onsuccess = () => finish(() => resolve(req.result));
    req.onerror = () => finish(() => reject(req.error || new Error('Falha abrindo IndexedDB')));
    // CRÍTICO: sem isto, um open segurado por OUTRA aba nunca resolve nem rejeita.
    req.onblocked = () => finish(() => reject(new Error('IndexedDB bloqueado por outra aba')));
  });
}

type TxStores = Record<string, IDBObjectStore>;

/** Transação com TIMEOUT — fecha o db em qualquer saída. */
function runTx<T>(
  db: IDBDatabase,
  stores: string[],
  mode: IDBTransactionMode,
  body: (s: TxStores, resolve: (v: T) => void, reject: (e: unknown) => void, tx: IDBTransaction) => void,
  timeoutMs: number = DB_OP_TIMEOUT_MS,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(to);
      try {
        db.close();
      } catch {
        /* ignora */
      }
      fn();
    };
    const to = setTimeout(
      () => finish(() => reject(new Error('IndexedDB transação timeout (possível bloqueio por outra aba)'))),
      timeoutMs,
    );
    let tx: IDBTransaction;
    try {
      tx = db.transaction(stores, mode);
    } catch (e) {
      finish(() => reject(e instanceof Error ? e : new Error('Falha abrindo transação IDB')));
      return;
    }
    tx.onerror = () => finish(() => reject(tx.error));
    tx.onabort = () => finish(() => reject(tx.error || new Error('IDB transação abortada')));
    const map: TxStores = {};
    for (const name of stores) map[name] = tx.objectStore(name);
    body(
      map,
      (v) => finish(() => resolve(v)),
      (e) => finish(() => reject(e)),
      tx,
    );
  });
}

/**
 * Escrita com RETRY + reabertura. Bloqueio de outra aba é quase sempre
 * TRANSITÓRIO; sem retry uma janela de 15 s virava perda total do que o run
 * produziu (foi o que aconteceu no Pilot em 03/07).
 */
async function writeWithRetry<T>(run: () => Promise<T>, tries = 4): Promise<T> {
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      return await run();
    } catch (e) {
      lastErr = e;
      if (attempt < tries) {
        await new Promise((r) => setTimeout(r, Math.min(1200 * attempt, 4000)));
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('IDB write falhou após as tentativas');
}

// ───────────────────────────────────────────────────────────────────────────
// Projetos
// ───────────────────────────────────────────────────────────────────────────

export async function saveProject(project: Project): Promise<void> {
  if (!project?.id) throw new Error('projeto sem id — não persisto');
  // `updatedAt` é a régua do LRU: quem grava, toca.
  const rec: Project = { ...project, updatedAt: Date.now() };
  await writeWithRetry(async () => {
    const db = await openDB();
    return runTx<void>(
      db,
      [STORE_PROJECTS],
      'readwrite',
      (s, resolve, reject, tx) => {
        s[STORE_PROJECTS].put(rec);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      },
      DB_WRITE_TIMEOUT_MS,
    );
  });
}

export async function loadProject(id: string): Promise<Project | null> {
  const db = await openDB();
  return runTx<Project | null>(db, [STORE_PROJECTS], 'readonly', (s, resolve, reject) => {
    const req = s[STORE_PROJECTS].get(id);
    req.onsuccess = () => resolve((req.result as Project | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

/** Resumo dos projetos (mais recente primeiro) pra lista de "continuar de onde parou". */
export async function listProjects(): Promise<ProjectSummary[]> {
  const db = await openDB();
  return runTx<ProjectSummary[]>(db, [STORE_PROJECTS], 'readonly', (s, resolve, reject) => {
    const out: ProjectSummary[] = [];
    const cur = s[STORE_PROJECTS].openCursor();
    cur.onsuccess = (e: Event) => {
      const c = (e.target as IDBRequest).result as IDBCursorWithValue | null;
      if (c) {
        const p = c.value as Project;
        out.push({
          id: p.id,
          name: p.source?.name || 'Sem nome',
          updatedAt: p.updatedAt || 0,
          createdAt: p.createdAt || 0,
          phase: p.phase,
          clips: Array.isArray(p.clips) ? p.clips.length : 0,
          ready: Array.isArray(p.clips) ? p.clips.filter((c2) => c2.renderStatus === 'pronto').length : 0,
        });
        c.continue();
      } else {
        resolve(out.sort((a, b) => b.updatedAt - a.updatedAt));
      }
    };
    cur.onerror = () => reject(cur.error);
  });
}

/**
 * Apaga o projeto INTEIRO: registro + todos os blobs dele + o arquivo-fonte no
 * OPFS (quando veio de link). Best-effort no OPFS: falhar lá não pode impedir
 * a limpeza do IDB.
 */
export async function deleteProject(id: string): Promise<void> {
  let opfsPath: string | null = null;
  try {
    const p = await loadProject(id);
    opfsPath = p?.source?.opfsPath ?? null;
  } catch {
    /* se nem deu pra ler, segue e limpa o que der */
  }

  await writeWithRetry(async () => {
    const db = await openDB();
    return runTx<void>(
      db,
      [STORE_PROJECTS, STORE_BLOBS],
      'readwrite',
      (s, resolve, reject, tx) => {
        s[STORE_PROJECTS].delete(id);
        const idx = s[STORE_BLOBS].index(INDEX_BY_PROJECT);
        // openKeyCursor: não materializa os bytes de nenhum MP4.
        const cur = idx.openKeyCursor(IDBKeyRange.only(id));
        cur.onsuccess = (e: Event) => {
          const c = (e.target as IDBRequest).result as IDBCursor | null;
          if (c) {
            s[STORE_BLOBS].delete(c.primaryKey);
            c.continue();
          }
        };
        cur.onerror = () => reject(cur.error);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      },
      DB_WRITE_TIMEOUT_MS,
    );
  });

  if (opfsPath) {
    try {
      await opfsDelete(opfsPath);
    } catch {
      /* arquivo de origem já pode ter sumido */
    }
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Blobs (MP4 dos cortes + miniaturas)
// ───────────────────────────────────────────────────────────────────────────

export async function saveBlob(key: string, blob: Blob, projectId: string): Promise<void> {
  if (!key) throw new Error('blob sem chave — não persisto');
  const mime = blob.type || 'application/octet-stream';
  const size = blob.size;
  const put = (bytes: Uint8Array | Blob) =>
    writeWithRetry(async () => {
      const db = await openDB();
      return runTx<void>(
        db,
        [STORE_BLOBS],
        'readwrite',
        (s, resolve, reject, tx) => {
          const rec: BlobRecord = { key, bytes, mime, size, createdAt: Date.now(), projectId };
          s[STORE_BLOBS].put(rec);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        },
        DB_WRITE_TIMEOUT_MS,
      );
    });

  try {
    // Caminho bom: Blob vai por REFERÊNCIA (não passa pelo heap).
    await put(blob);
  } catch (e) {
    console.warn('[auto-cortes store] guardando como bytes (Blob recusado pelo IDB):', e);
    await put(new Uint8Array(await blob.arrayBuffer()));
  }
}

export async function loadBlob(key: string): Promise<Blob | null> {
  if (!key) return null;
  const db = await openDB();
  return runTx<Blob | null>(db, [STORE_BLOBS], 'readonly', (s, resolve, reject) => {
    const req = s[STORE_BLOBS].get(key);
    req.onsuccess = () => {
      const rec = req.result as BlobRecord | undefined;
      if (!rec) return resolve(null);
      if (rec.bytes instanceof Blob) return resolve(rec.bytes);
      resolve(new Blob([rec.bytes as BlobPart], { type: rec.mime || 'application/octet-stream' }));
    };
    req.onerror = () => reject(req.error);
  });
}

export async function deleteBlob(key: string): Promise<void> {
  if (!key) return;
  const db = await openDB();
  return runTx<void>(
    db,
    [STORE_BLOBS],
    'readwrite',
    (s, resolve, reject, tx) => {
      s[STORE_BLOBS].delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    },
    DB_WRITE_TIMEOUT_MS,
  );
}

/** Metadados dos blobs (sem bytes) — base da poda por tamanho. */
async function listBlobMeta(): Promise<Array<{ key: string; projectId: string; size: number }>> {
  const db = await openDB();
  return runTx<Array<{ key: string; projectId: string; size: number }>>(
    db,
    [STORE_BLOBS],
    'readonly',
    (s, resolve, reject) => {
      const out: Array<{ key: string; projectId: string; size: number }> = [];
      const cur = s[STORE_BLOBS].openCursor();
      cur.onsuccess = (e: Event) => {
        const c = (e.target as IDBRequest).result as IDBCursorWithValue | null;
        if (c) {
          const v = c.value as BlobRecord;
          // Só os 3 campos: o `bytes` (Blob por referência) sai de escopo aqui.
          out.push({ key: v.key, projectId: v.projectId || '', size: Number(v.size) || 0 });
          c.continue();
        } else {
          resolve(out);
        }
      };
      cur.onerror = () => reject(cur.error);
    },
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Poda (LRU)
// ───────────────────────────────────────────────────────────────────────────

export type PruneOptions = {
  maxProjects?: number;
  maxAgeMs?: number;
  maxBytes?: number;
  /** projeto que NUNCA sai (o que está aberto agora). */
  keep?: string;
};

export type PruneResult = { removed: string[]; freedBytes: number; kept: number };

/**
 * Decisão PURA da poda (o IDB só executa) — LRU por `updatedAt`, com o `keep`
 * imune. A ordem das regras importa: idade e teto de projetos derrubam sozinhos;
 * o teto de bytes só entra depois, e sempre pelo mais VELHO.
 */
export function planProjectEviction(
  projects: Array<{ id: string; updatedAt: number; bytes: number }>,
  opts: PruneOptions & { now?: number } = {},
): { evict: string[]; freedBytes: number } {
  const maxProjects = opts.maxProjects ?? PRUNE_DEFAULTS.maxProjects;
  const maxAgeMs = opts.maxAgeMs ?? PRUNE_DEFAULTS.maxAgeMs;
  const maxBytes = opts.maxBytes ?? PRUNE_DEFAULTS.maxBytes;
  const now = opts.now ?? Date.now();
  const keep = opts.keep;

  // mais NOVO primeiro
  const ord = [...projects].sort((a, b) => b.updatedAt - a.updatedAt);
  const evict = new Set<string>();

  ord.forEach((p, i) => {
    if (p.id === keep) return;
    if (maxAgeMs > 0 && now - p.updatedAt > maxAgeMs) evict.add(p.id);
    // o índice conta o `keep` (ele ocupa vaga de verdade)
    if (i >= maxProjects) evict.add(p.id);
  });

  let total = ord.reduce((sum, p) => sum + (evict.has(p.id) ? 0 : p.bytes), 0);
  for (let i = ord.length - 1; i >= 0 && total > maxBytes; i--) {
    const p = ord[i];
    if (p.id === keep || evict.has(p.id)) continue;
    evict.add(p.id);
    total -= p.bytes;
  }

  const list = ord.filter((p) => evict.has(p.id));
  return { evict: list.map((p) => p.id), freedBytes: list.reduce((s, p) => s + p.bytes, 0) };
}

/**
 * Faxina best-effort: nunca lança (é chamada no boot do pipeline e não pode
 * atrapalhar o trabalho do cliente). Apaga o projeto INTEIRO — registro, blobs
 * e OPFS — pra nunca sobrar corte sem projeto nem fonte órfã ocupando disco.
 */
export async function pruneProjects(opts: PruneOptions = {}): Promise<PruneResult | null> {
  try {
    const [summaries, blobs] = await Promise.all([listProjects(), listBlobMeta()]);
    if (summaries.length === 0) return { removed: [], freedBytes: 0, kept: 0 };

    const bytesByProject = new Map<string, number>();
    for (const b of blobs) {
      bytesByProject.set(b.projectId, (bytesByProject.get(b.projectId) ?? 0) + b.size);
    }
    const plan = planProjectEviction(
      summaries.map((p) => ({ id: p.id, updatedAt: p.updatedAt, bytes: bytesByProject.get(p.id) ?? 0 })),
      opts,
    );
    for (const id of plan.evict) {
      try {
        await deleteProject(id);
      } catch (e) {
        console.warn('[auto-cortes store] não consegui apagar o projeto', id, e);
      }
    }
    return {
      removed: plan.evict,
      freedBytes: plan.freedBytes,
      kept: summaries.length - plan.evict.length,
    };
  } catch (e) {
    console.warn('[auto-cortes store] faxina falhou (ignorado):', e);
    return null;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Quota
// ───────────────────────────────────────────────────────────────────────────

export type StorageEstimate = { usage: number; quota: number; freeBytes: number };

/** Quanto o navegador ainda deixa gravar. `null` quando ele não informa. */
export async function storageEstimate(): Promise<StorageEstimate | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
  try {
    const e = await navigator.storage.estimate();
    const usage = e.usage || 0;
    const quota = e.quota || 0;
    return { usage, quota, freeBytes: Math.max(0, quota - usage) };
  } catch {
    return null;
  }
}
