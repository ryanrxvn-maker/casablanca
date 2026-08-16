/**
 * Persistência da FILA de disparos do Hey Auto (multi-disparo).
 *
 * PROBLEMA que isto resolve: a fila era useState puro — F5, queda de rede com
 * reload, deploy invalidando chunk (auto-reload do chunk-guard) ou descarte da
 * aba perdiam a fila INTEIRA em silêncio. O beforeunload só avisava, não salvava.
 *
 * Modelo (o MESMO do heygen-batch-store, que já provou a isolação):
 *  - Os itens vivem numa chave de localStorage compartilhada por origem
 *    (`darkolab:heygenauto:queues`), como um mapa ownerId → { items, runMode }.
 *  - A POSSE é por-aba via sessionStorage (`heygenauto:queueOwnerId`): cada aba
 *    só re-hidrata a SUA fila — nunca adota a fila de outra aba.
 *  - NADA aqui toca a fila do ClickUp Pilot: chaves e namespaces são próprios
 *    do Hey Auto (o Pilot usa `darkolab:clickup-pilot:*`).
 *
 * Áudio (File) não serializa em JSON: os bytes vão pro IndexedDB
 * (darkolab-zip-store) sob `hgaq:<itemId>:audio:<idx>` JÁ no enfileirar
 * (persistir cedo); aqui fica só a referência (audioKey + nome + type).
 * `zipGroupId` agrupa essas chaves pelo itemId e a faxina LRU protege itens
 * ainda não entregues via listQueueAudioProtectIds() (fila de madrugada
 * sobrevive à janela de 12h).
 *
 * runMode persiste O QUE estava rodando quando a aba caiu:
 *  - 'queue'  = "Processar fila" em andamento → no reload, retoma o item
 *    interrompido e CONTINUA os pendentes.
 *  - 'single' = RETOMAR avulso → no reload, retoma só aquele item.
 *  - null     = nada rodando → só re-hidrata, sem auto-disparo.
 */

export type QueueRunMode = 'queue' | 'single' | null;

export type PersistedQueuePart = {
  label: string;
  text?: string;
  avatarId?: string | null;
  avatarName?: string | null;
  voiceId?: string | null;
  voiceMirror?: boolean;
  /** Apply Custom Motion desta cena — persistido junto do resto pra um F5 na
   *  fila não devolver o take parado. */
  motionPrompt?: string | null;
  /** Modo audio: bytes no IndexedDB (zip-store) sob esta chave. */
  audioKey?: string;
  audioName?: string;
  audioType?: string;
};

export type PersistedQueueItem = {
  id: string;
  adName: string;
  safeName: string;
  mode: 'copy' | 'audio';
  parts: PersistedQueuePart[];
  /** Motor é union da página ('III'|'IV'|'V') — string aqui pra não acoplar. */
  motor: string;
  decupagem: boolean;
  decupIntensity: number;
  source: 'manual' | 'doc';
  voiceName?: string | null;
  unmatched?: string[];
  status: 'pending' | 'running' | 'done' | 'failed';
  message?: string;
  progress?: number;
  phase?: string;
  batchId?: string;
  videoIds?: string[];
  partResults?: { label: string; videoId: string | null; error: string | null }[];
  zips?: { takes?: string; montado?: string; camo?: string };
  takePreviews?: { label: string; status: string; videoUrl: string | null; error?: string | null }[];
};

type QueueEntry = { items: PersistedQueueItem[]; runMode: QueueRunMode; updatedAt: number };
type QueueMap = Record<string, QueueEntry>;

const QUEUE_STORE_KEY = 'darkolab:heygenauto:queues';
const QUEUE_OWNER_KEY = 'heygenauto:queueOwnerId';
/** Sessões de fila além disso são lixo antigo (nada VIVO fica 7 dias parado). */
const MAX_ENTRY_AGE_MS = 7 * 24 * 3600_000;
/** Teto de sessões guardadas (12 abas simultâneas com fila não existe na prática). */
const MAX_ENTRIES = 12;

function readAllQueues(): QueueMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(QUEUE_STORE_KEY);
    return raw ? (JSON.parse(raw) as QueueMap) : {};
  } catch {
    return {};
  }
}

function writeAllQueues(map: QueueMap) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(QUEUE_STORE_KEY, JSON.stringify(map));
  } catch {
    // Quota estourada: mantém SÓ a entrada mais recente (a que acabou de ser
    // escrita é sempre a mais recente) e tenta de novo — perder sessões velhas
    // é melhor que perder a fila VIVA em silêncio.
    try {
      const entries = Object.entries(map).sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0));
      const slim: QueueMap = {};
      if (entries[0]) slim[entries[0][0]] = entries[0][1];
      window.localStorage.setItem(QUEUE_STORE_KEY, JSON.stringify(slim));
    } catch {}
  }
}

/** Remove sessões velhas (idade > 7d) e além do teto — NUNCA a `keepId`. */
function pruneStaleEntries(map: QueueMap, keepId: string, now = Date.now()) {
  for (const [id, e] of Object.entries(map)) {
    if (id === keepId) continue;
    if (now - (e.updatedAt || 0) > MAX_ENTRY_AGE_MS) delete map[id];
  }
  const rest = Object.entries(map)
    .filter(([id]) => id !== keepId)
    .sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0));
  for (let i = MAX_ENTRIES - 1; i < rest.length; i++) delete map[rest[i][0]];
}

/** Id da fila que ESTA aba é dona (sessionStorage: por-aba, sobrevive F5,
 *  nunca compartilhado entre abas). null = esta aba ainda não enfileirou. */
export function getQueueOwnerId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage.getItem(QUEUE_OWNER_KEY);
  } catch {
    return null;
  }
}

/** Garante a posse da fila desta aba (cria se não existir). */
export function ensureQueueOwnerId(): string {
  const existing = getQueueOwnerId();
  if (existing) return existing;
  const id = `hgaqowner:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  try {
    window.sessionStorage.setItem(QUEUE_OWNER_KEY, id);
  } catch {}
  return id;
}

/** Persiste os itens da fila desta aba. items vazio = remove a entrada.
 *  Preserva o runMode existente (use setPersistedRunMode pra mudá-lo). */
export function savePersistedQueue(ownerId: string, items: PersistedQueueItem[]) {
  if (!ownerId) return;
  const map = readAllQueues();
  if (items.length === 0) {
    if (!map[ownerId]) return;
    delete map[ownerId];
    writeAllQueues(map);
    return;
  }
  map[ownerId] = { items, runMode: map[ownerId]?.runMode ?? null, updatedAt: Date.now() };
  pruneStaleEntries(map, ownerId);
  writeAllQueues(map);
}

/** Marca O QUE está rodando agora (pra decidir a auto-retomada no reload).
 *  Gravado nas transições (início/fim de processQueue/resumeQueueItem) — se a
 *  aba cair no MEIO, o modo fica gravado e o reload sabe continuar. */
export function setPersistedRunMode(ownerId: string | null, mode: QueueRunMode) {
  if (!ownerId) return;
  const map = readAllQueues();
  const entry = map[ownerId];
  if (!entry) return;
  entry.runMode = mode;
  entry.updatedAt = Date.now();
  writeAllQueues(map);
}

/** Fila persistida desta aba (null = nunca persistiu / já foi limpa). */
export function loadPersistedQueue(ownerId: string): { items: PersistedQueueItem[]; runMode: QueueRunMode } | null {
  if (!ownerId) return null;
  const entry = readAllQueues()[ownerId];
  if (!entry || !Array.isArray(entry.items)) return null;
  return { items: entry.items, runMode: entry.runMode ?? null };
}

/** Chave do áudio de uma parte no IndexedDB (zip-store). Determinística:
 *  deriva de itemId+idx, então metadados e bytes nunca dessincronizam. */
export function queueAudioKey(itemId: string, partIdx: number): string {
  return `hgaq:${itemId}:audio:${partIdx}`;
}

/** ItemIds (TODAS as sessões/abas) com áudio persistido e ainda não entregues —
 *  a faxina LRU do zip-store protege esses grupos (`zipGroupId` de
 *  `hgaq:<itemId>:audio:<n>` = itemId). Sem isto, uma fila pendente de
 *  madrugada (>12h) perdia os áudios pra faxina de outra aba/ferramenta. */
export function listQueueAudioProtectIds(): string[] {
  const ids: string[] = [];
  for (const entry of Object.values(readAllQueues())) {
    for (const item of entry.items || []) {
      if (item.status === 'done') continue;
      if ((item.parts || []).some((p) => p.audioKey)) ids.push(item.id);
    }
  }
  return ids;
}

/* ============================================================================
 * RE-HIDRATAÇÃO (lógica pura, testável sem DOM)
 * ========================================================================== */

/** Recupera videoIds do espelho compartilhado (heygen-batch-store) quando o
 *  reload comeu o onUpdate da página: o mirror recebe cada videoId AO VIVO
 *  (onResult), mas o item da fila só grava videoIds no FIM do dispatch.
 *  Só recupera quando TODAS as partes têm videoId — dispatch parcial NÃO vira
 *  retomada (retomar pula o dispatch e entregaria vídeo furado; o plano marca
 *  como failed com mensagem honesta, sem re-disparo automático). */
export function recoverFromMirror(
  item: PersistedQueueItem,
  mirrorParts: Array<{ label: string; videoId: string | null; error?: string | null }> | null | undefined,
): PersistedQueueItem {
  if (item.status !== 'running') return item;
  if (item.videoIds && item.videoIds.length > 0) return item;
  if (!mirrorParts || mirrorParts.length === 0) return item;
  if (!mirrorParts.every((p) => p.videoId)) return item;
  return {
    ...item,
    videoIds: mirrorParts.map((p) => p.videoId!),
    partResults: mirrorParts.map((p) => ({ label: p.label, videoId: p.videoId ?? null, error: p.error ?? null })),
  };
}

export type QueueRehydrationPlan = {
  items: PersistedQueueItem[];
  /** Itens que estavam rodando COM videoIds → retomar (re-poll+download, SEM
   *  re-disparar). Zero risco de submit duplicado no HeyGen. */
  autoResumeIds: string[];
  /** true = "Processar fila" estava em andamento → depois das retomadas,
   *  continuar os pendentes (fila de madrugada termina sozinha). */
  continueQueue: boolean;
};

/** Classifica os itens persistidos pro estado pós-reload. REGRA DURA
 *  anti-duplicação: item interrompido no MEIO do dispatch (sem videoIds
 *  completos) NUNCA re-dispara sozinho — vira 'failed' com mensagem honesta e
 *  o user decide (Rodar). Interrompido DEPOIS do dispatch retoma sem custo. */
export function planQueueRehydration(
  items: PersistedQueueItem[],
  runMode: QueueRunMode,
): QueueRehydrationPlan {
  const autoResumeIds: string[] = [];
  const out: PersistedQueueItem[] = items.map((it) => {
    if (it.status !== 'running') return it;
    if (it.videoIds && it.videoIds.length > 0) {
      autoResumeIds.push(it.id);
      return {
        ...it,
        status: 'pending' as const,
        phase: undefined,
        message: '⏸ Interrompido pelo reload — retomo de onde parou (sem re-disparar) assim que a extensão conectar, ou clique Retomar.',
      };
    }
    return {
      ...it,
      status: 'failed' as const,
      phase: undefined,
      progress: undefined,
      message: '⚠ O reload interrompeu este AD no MEIO do disparo — pra não disparar em dobro no HeyGen, não re-disparo sozinho. Clique Rodar pra disparar de novo.',
    };
  });
  const continueQueue = runMode === 'queue' && out.some((it) => it.status === 'pending');
  return { items: out, autoResumeIds, continueQueue };
}
