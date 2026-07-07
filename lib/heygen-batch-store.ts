/**
 * Espelho do heygen-auto no MESMO store persistido dos batches do
 * ClickUp Pilot (`darkolab:clickup-pilot:batches`).
 *
 * Por que: jobs disparados direto no heygen-auto nao tinham fila/lista
 * persistida nem Retomar/Pausar/Debug. Gravando-os aqui (mesma chave +
 * mesmo formato BatchTaskState), eles aparecem AUTOMATICAMENTE no
 * lipsync-history, /tools/background e no JobControlPanel — e o Retomar
 * reaproveita o motor que ja existe no ClickUp Pilot (resumeTaskBatch
 * trabalha SO com parts[].videoId + HeyGen, sem depender do ClickUp).
 *
 * taskId namespace: `heygenauto:<safeName>:<startedAt>` (nunca colide
 * com ids de task do ClickUp).
 *
 * upsert = merge nao-destrutivo: le o map inteiro, mexe so na entrada
 * desse taskId, regrava. Nunca apaga entradas de outros jobs.
 */

const BATCH_STATE_KEY = 'darkolab:clickup-pilot:batches';

export type SharedBatchPart = {
  label: string;
  videoId: string | null;
  videoStatus?: string;
  error?: string | null;
  renamedTo: string;
};

export type SharedBatchState = {
  taskId: string;
  taskName: string;
  baseAdId: string;
  phase: 'queued' | 'dispatching' | 'rendering' | 'downloading' | 'post' | 'done' | 'failed';
  parts: SharedBatchPart[];
  message?: string;
  startedAt: number;
  finishedAt?: number;
  /** Apenas NOMES — os bytes ficam no IndexedDB (zip-store) sob as
   *  chaves `batch:<taskId>:takes|montado|camo`. lipsync-history /
   *  background reconstroem o download de la ("↓ ... do disco"). */
  zipFilename?: string;
  montadoZipName?: string;
  camufladoZipName?: string;
};

function readAll(): Record<string, SharedBatchState> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(BATCH_STATE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, SharedBatchState>) : {};
  } catch {
    return {};
  }
}

function writeAll(map: Record<string, SharedBatchState>) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(BATCH_STATE_KEY, JSON.stringify(map));
  } catch {}
}

/** Lista todos os batches persistidos (opcionalmente filtrados por prefixo
 *  de taskId, ex 'heygenauto:' pra pegar SÓ os do Hey Auto). Usado pra
 *  reidratar o card da dispensa direta após reload (igual ClickUp Pilot). */
export function listSharedBatches(taskIdPrefix?: string): SharedBatchState[] {
  const all = Object.values(readAll());
  const filtered = taskIdPrefix ? all.filter((b) => b.taskId.startsWith(taskIdPrefix)) : all;
  return filtered.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
}

/** Cria/atualiza a entrada desse taskId (merge raso) sem tocar nas
 *  demais. Dispara 'storage' implicito pras telas que escutam. */
export function upsertSharedBatch(
  taskId: string,
  patch: Partial<SharedBatchState> & { taskId?: never },
) {
  const map = readAll();
  const prev = map[taskId];
  map[taskId] = {
    taskId,
    taskName: patch.taskName ?? prev?.taskName ?? taskId,
    baseAdId: patch.baseAdId ?? prev?.baseAdId ?? taskId,
    phase: patch.phase ?? prev?.phase ?? 'dispatching',
    parts: patch.parts ?? prev?.parts ?? [],
    message: patch.message ?? prev?.message,
    startedAt: prev?.startedAt ?? patch.startedAt ?? Date.now(),
    finishedAt: patch.finishedAt ?? prev?.finishedAt,
    zipFilename: patch.zipFilename ?? prev?.zipFilename,
    montadoZipName: patch.montadoZipName ?? prev?.montadoZipName,
    camufladoZipName: patch.camufladoZipName ?? prev?.camufladoZipName,
  };
  writeAll(map);
}

export function removeSharedBatch(taskId: string) {
  const map = readAll();
  if (map[taskId]) {
    delete map[taskId];
    writeAll(map);
  }
}

/* ============================================================================
 * ISOLAÇÃO POR DISPARO (cada disparo tem a SUA própria memória).
 *
 * Problema que isto resolve: o store de batches vive numa chave de
 * localStorage COMPARTILHADA por todas as abas (mesma origem). Se a
 * reidratação escolhesse "o batch mais recente de todos", uma aba reidrataria
 * o disparo de OUTRA aba (ou de um disparo anterior desta mesma aba) — os
 * disparos se misturavam.
 *
 * A âncora da isolação é o `sessionStorage`: ele é POR-ABA (cada aba tem o
 * seu), sobrevive a F5/reload, e NUNCA é compartilhado entre abas diferentes.
 * Guardamos ali o id do batch que ESTA aba é dona. Na reidratação, a aba só
 * restaura o batch DELA — jamais adota o disparo de outra aba/sessão.
 * ========================================================================== */

const ACTIVE_BATCH_KEY = 'heygenauto:activeBatchId';

/** Id do batch que ESTA aba (tab) é dona. Vive em sessionStorage (por-aba,
 *  sobrevive reload, isolado entre abas). null = esta aba ainda não disparou. */
export function getOwnedBatchId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage.getItem(ACTIVE_BATCH_KEY);
  } catch {
    return null;
  }
}

/** Marca (ou limpa) qual disparo esta aba é dona. Chamar no ATO do disparo
 *  (nasce a memória da aba) e no "remover" (limpa). */
export function setOwnedBatchId(taskId: string | null) {
  if (typeof window === 'undefined') return;
  try {
    if (taskId) window.sessionStorage.setItem(ACTIVE_BATCH_KEY, taskId);
    else window.sessionStorage.removeItem(ACTIVE_BATCH_KEY);
  } catch {}
}

/** Gera um id de disparo GARANTIDAMENTE único (nome + ms + nonce aleatório).
 *  Dois disparos do mesmo nome no MESMO milissegundo (ou nome vazio/'heygen')
 *  nunca colidem — cada um é uma memória independente. */
export function newBatchId(safeName: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `heygenauto:${safeName}:${Date.now()}:${rand}`;
}

/** Seleção de reidratação com ISOLAÇÃO ESTRITA: retorna SÓ o batch que esta
 *  aba é dona (ownedId). Nunca devolve o disparo de outra aba/sessão. Pura
 *  (testável sem DOM). ownedId null → null (aba fresca começa vazia). */
export function selectOwnBatch(
  batches: SharedBatchState[],
  ownedId: string | null,
): SharedBatchState | null {
  if (!ownedId) return null;
  return batches.find((b) => b.taskId === ownedId) ?? null;
}
