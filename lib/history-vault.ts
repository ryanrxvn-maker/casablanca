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

import { durabilityStatus } from './durable-records';
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
/**
 * Store SÓ de metadados (key/name/size/createdAt). Existe porque listar o
 * cofre com openCursor no store de bytes MATERIALIZA cada arquivo — é o
 * padrão que fez o boot do zip-store levar 70s em prod (223 blobs/1,58GB).
 * Com o meta separado, a listagem lê registros de ~100 bytes.
 */
const META = 'meta';
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
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(META)) {
        db.createObjectStore(META, { keyPath: 'key' });
        // Migração v1 -> v2: reconstrói o meta do que já está guardado.
        try {
          const tx = req.transaction;
          if (tx) {
            const files = tx.objectStore(STORE);
            const meta = tx.objectStore(META);
            const cur = files.openCursor();
            cur.onsuccess = (e: Event) => {
              const c = (e.target as IDBRequest).result as IDBCursorWithValue | null;
              if (!c) return;
              const v = c.value as VaultRecord;
              meta.put({ key: v.key, name: v.name, mime: v.mime, size: v.size, createdAt: v.createdAt });
              c.continue();
            };
          }
        } catch {}
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
  storeName: string = STORE,
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
      const tx = db.transaction(storeName, mode);
      tx.onabort = () => finish(false, tx.error ?? new Error('vault: tx abortada'));
      fn(
        tx.objectStore(storeName),
        (v) => finish(true, v),
        (e) => finish(false, e),
      );
    } catch (e) {
      finish(false, e);
    }
  });
}

/** Transação readwrite abrangendo bytes + meta (mantém os dois em sincronia). */
function runTxBoth(
  db: IDBDatabase,
  fn: (files: IDBObjectStore, meta: IDBObjectStore) => void,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        try {
          db.close();
        } catch {}
        reject(new Error('vault: transação travou (timeout)'));
      }
    }, DB_WRITE_TIMEOUT_MS);
    const finish = (err?: unknown) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        db.close();
      } catch {}
      if (err) reject(err);
      else resolve();
    };
    try {
      const tx = db.transaction([STORE, META], 'readwrite');
      tx.oncomplete = () => finish();
      tx.onerror = () => finish(tx.error ?? new Error('vault: tx falhou'));
      tx.onabort = () => finish(tx.error ?? new Error('vault: tx abortada'));
      fn(tx.objectStore(STORE), tx.objectStore(META));
    } catch (e) {
      finish(e);
    }
  });
}

async function putRecord(rec: VaultRecord): Promise<void> {
  const db = await openDB();
  return runTxBoth(db, (files, meta) => {
    files.put(rec);
    meta.put({ key: rec.key, name: rec.name, mime: rec.mime, size: rec.size, createdAt: rec.createdAt });
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
  return runTxBoth(db, (files, meta) => {
    for (const k of keys) {
      files.delete(k);
      meta.delete(k);
    }
  });
}

export type VaultMeta = { key: string; name: string; size: number; createdAt: number };

/**
 * Lista o cofre lendo APENAS o store de metadados — nenhum byte de arquivo
 * sai do disco. É o que mantém a página do histórico leve com o cofre cheio.
 */
export async function vaultList(): Promise<VaultMeta[]> {
  try {
    const db = await openDB();
    return await runTx<VaultMeta[]>(db, 'readonly', (store, resolve, reject) => {
      const out: VaultMeta[] = [];
      const cur = store.openCursor();
      cur.onsuccess = (e: Event) => {
        const c = (e.target as IDBRequest).result as IDBCursorWithValue | null;
        if (c) {
          const v = c.value as VaultMeta;
          out.push({ key: v.key, name: v.name, size: v.size, createdAt: v.createdAt });
          c.continue();
        } else {
          resolve(out);
        }
      };
      cur.onerror = () => reject(cur.error);
    }, META);
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
    await runTxBoth(db, (files, meta) => {
      files.clear();
      meta.clear();
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
 * Janela em que um arquivo recém-guardado NUNCA é tratado como órfão.
 *
 * A referência do evento é gravada de forma assíncrona (durable-records grava
 * sob lock e sincroniza com a conta). Entre guardar os bytes e a referência
 * aparecer no histórico existe um intervalo — e uma poda que caísse bem nele
 * apagaria o arquivo que o usuário acabou de gerar.
 */
const CARENCIA_ORFAO_MS = 10 * 60 * 1000;

/**
 * Poda o cofre: (1) TTL 7 dias; (2) órfãos — bytes cujo evento já saiu do
 * histórico; (3) LRU por teto total/quantidade. Nunca lança.
 *
 * TRAVA DE SEGURANÇA: a varredura de órfãos só roda com o histórico REALMENTE
 * carregado. Os registros vivem na conta (durable-records) e, antes de chegar
 * — ou quando a rede falha — a leitura devolve lista VAZIA. Sem esta trava,
 * um dia de rede ruim faria a poda concluir que todo arquivo é órfão e limpar
 * o cofre inteiro do cliente. TTL e LRU seguem valendo nesse caso.
 */
export async function pruneVault(): Promise<void> {
  try {
    const list = await vaultList();
    if (list.length === 0) return;
    const agora = Date.now();
    const eventos = readHistory();
    const emUso = new Set<string>();
    for (const ev of eventos) {
      for (const r of ev.ref ?? []) {
        if (r.via === 'vault') emUso.add(r.key);
      }
    }
    let historicoConfiavel = eventos.length > 0;
    try {
      historicoConfiavel = historicoConfiavel && durabilityStatus().ready;
    } catch {
      historicoConfiavel = false;
    }
    const remover = new Set<string>();
    for (const rec of list) {
      if (agora - rec.createdAt > VAULT_TTL_MS) remover.add(rec.key);
      else if (
        historicoConfiavel &&
        !emUso.has(rec.key) &&
        agora - rec.createdAt > CARENCIA_ORFAO_MS
      ) {
        remover.add(rec.key);
      }
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

/** Fração da quota do navegador que o app se permite ocupar no total. */
const QUOTA_TETO = 0.85;

/** Cabe mais `bytes` sem chegar perto do teto de armazenamento do navegador? */
async function cabeNoNavegador(bytes: number): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return true;
    const e = await navigator.storage.estimate();
    const quota = e.quota || 0;
    const usage = e.usage || 0;
    if (quota <= 0) return true;
    return usage + bytes < quota * QUOTA_TETO;
  } catch {
    return true;
  }
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
  guardarNoCofre(blob, filename, toolHint, `${filename} baixado`);
}

/**
 * Guarda no cofre um artefato que a ferramenta ACABOU de produzir, mesmo que o
 * usuario ainda nao tenha clicado em baixar, e anexa a referencia ao registro
 * que a pagina acabou de gravar (logHistory vem ANTES desta chamada).
 *
 * Existe porque nem toda ferramenta entrega por downloadBlob: algumas mostram
 * o resultado num <video> e deixam o download por conta de um link. Sem isto,
 * o historico mostrava "video gerado" sem botao nenhum — registro que nao
 * entrega arquivo nao serve pra nada.
 */
export function captureArtifact(blob: Blob, filename: string, toolHint?: string): void {
  guardarNoCofre(blob, filename, toolHint, `${filename} gerado`);
}

function guardarNoCofre(
  blob: Blob,
  filename: string,
  toolHint: string | undefined,
  fallbackTitle: string,
): void {
  if (typeof window === 'undefined') return;
  try {
    if (!blob || blob.size < 100) return;
    if (blob.size > VAULT_MAX_FILE_BYTES) return;
    const tool = toolHint || toolFromPathname();
    const key = novaChave();
    void (async () => {
      try {
        // GUARDA DE QUOTA: o cofre é uma comodidade, nunca um problema. Se o
        // navegador já está perto do teto dele (disco cheio / muito cache),
        // poda primeiro e, se ainda assim não couber, DESISTE em silêncio —
        // guardar histórico jamais pode fazer o app estourar armazenamento.
        if (!(await cabeNoNavegador(blob.size))) {
          await pruneVault();
          if (!(await cabeNoNavegador(blob.size))) return;
        }
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
          fallbackTitle,
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

/**
 * Entrega o artefato do jeito que o dono espera RECEBER.
 *
 * A entrega do Pilot é guardada como .zip porque pode levar um vídeo por hook
 * mais os diagnósticos. Quando tem UM vídeo só dentro (o caso comum: avatar
 * único, sem variação de gancho), baixar o zip obriga a descompactar pra achar
 * um mp4 — foi exatamente a reclamação no AD42. Aqui o índice do zip é lido
 * (uns KB no fim do arquivo) e, havendo um único vídeo, ele sai limpo.
 *
 * Com VÁRIOS vídeos o zip continua sendo a entrega: são N arquivos, e
 * empacotado é como eles se mantêm juntos.
 */
async function entregarArtefato(blob: Blob, nomeSugerido: string): Promise<void> {
  const pareceZip = /\.zip$/i.test(nomeSugerido) || /zip/i.test(blob.type || '');
  if (!pareceZip) {
    await baixarBlob(blob, nomeSugerido);
    return;
  }
  try {
    const { lerEntradasDoZip, videosDoZip, abrirEntrada } = await import('./zip-entries');
    const entradas = await lerEntradasDoZip(blob);
    const videos = entradas ? videosDoZip(entradas) : [];
    if (videos.length === 1) {
      const v = videos[0];
      const mp4 = new Blob([await new Response(await abrirEntrada(blob, v)).arrayBuffer()], {
        type: 'video/mp4',
      });
      const nome = v.nome.split('/').pop() || nomeSugerido.replace(/\.zip$/i, '.mp4');
      await baixarBlob(mp4, nome);
      return;
    }
  } catch {
    /* zip ilegível ou compressão exótica: entrega o pacote como está */
  }
  await baixarBlob(blob, nomeSugerido);
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
      await entregarArtefato(blob, ref.name);
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
      onProgress?.('Preparando o arquivo…');
      await entregarArtefato(blob, ref.name);
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
