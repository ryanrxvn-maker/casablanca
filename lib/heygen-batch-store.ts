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
