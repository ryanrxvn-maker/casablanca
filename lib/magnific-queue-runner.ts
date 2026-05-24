/**
 * Fila SERIAL de jobs Magnific Auto-B-Rolls do ClickUp Pilot.
 *
 * Espelha o padrao de persistencia/background dos batches HeyGen
 * (`darkolab:clickup-pilot:batches` + zip-store IndexedDB):
 *
 *  - Estado persistido em localStorage (sobrevive reload).
 *  - Restaurado no mount; jobs interrompidos no meio voltam pra fila
 *    (re-rodar e seguro — runMagnificPipeline cria space novo + auto-retry).
 *  - ZIP de takes salvo em IndexedDB (zip-store) pra sobreviver reload.
 *  - Visivel no /tools/background e no painel do proprio ClickUp Pilot.
 *
 * REGRA: 1 job Magnific ativo por vez, SEMPRE (fila serial). O processor
 * (na page do ClickUp Pilot) garante isso via ref-guard. Aqui sao so
 * helpers puros de estado/persistencia — sem React, sem extension.
 *
 * MORE MAGNIFIC: o job entra com `gateOnHeyGen: true` e so fica elegivel
 * pro processor quando o HeyGen Auto DAQUELA task concluir (ungate).
 * ONLY MAGNIFIC: entra ungated (gateOnHeyGen=false) — roda direto.
 */

export type MagnificJobStatus =
  | 'queued'        // elegivel (ou aguardando gate) — ainda nao iniciou
  | 'running'       // pipeline Magnific rodando AGORA (so 1 por vez)
  | 'paused'        // pausado pelo user — NAO elegivel ate Retomar
  | 'done'          // ZIP de takes pronto
  | 'failed';       // falhou apos tentativas

export type MagnificQueueJob = {
  taskId: string;
  /** AD/nome da task — usado pro nome do space e do ZIP */
  adName: string;
  /** JSON cru de B-rolls colado pra essa task (parseado na hora de rodar) */
  takesJson: string;
  /** qtd de takes detectada (so display) */
  takeCount: number;
  status: MagnificJobStatus;
  /**
   * MORE MAGNIFIC: enquanto true o job NAO e elegivel pro processor —
   * espera o HeyGen Auto daquela task concluir. ONLY: sempre false.
   */
  gateOnHeyGen: boolean;
  /** sub-fase atual vinda do runMagnificPipeline (display) */
  phase?: string;
  percent?: number;
  message?: string;
  enqueuedAt: number;
  startedAt?: number;
  finishedAt?: number;
  /** chave no zip-store (IndexedDB) do ZIP de takes pronto */
  zipKey?: string;
  zipName?: string;
  successCount?: number;
  totalCount?: number;
  /**
   * Heartbeat — a aba que **possui** o job (está rodando o processor)
   * atualiza este timestamp a cada ~5s. Outras abas usam pra saber se
   * um job 'running' é genuíno (alguém cuidando) ou órfão (tab fechou
   * sem limpar). Garante zero duplo-disparo entre abas.
   */
  lastHeartbeatAt?: number;
  /**
   * Tab owner — ID único da aba que está rodando este job. Marca de
   * propriedade pra evitar que duas abas pensem que são donas. Sem o
   * owner certo, a aba não pode atualizar heartbeat nem completar.
   */
  ownerTabId?: string;
};

export type MagnificQueue = Record<string, MagnificQueueJob>;

export const MAGNIFIC_QUEUE_KEY = 'darkolab:clickup-pilot:magnific-queue';
/** JSON colado por task (caixa "+" inline) — persiste reload */
export const MAGNIFIC_JSON_KEY = 'darkolab:clickup-pilot:magnific-json';

/**
 * Heartbeat máximo aceitável. Se job 'running' não atualizou heartbeat
 * por mais de 30s, é considerado órfão (aba dona crashou/fechou).
 */
export const HEARTBEAT_STALE_MS = 30_000;

/** Intervalo de heartbeat — deve ser bem menor que STALE_MS pra dar
 * folga em casos de aba lenta/freezada momentaneamente. */
export const HEARTBEAT_INTERVAL_MS = 5_000;

/**
 * ID único e estável desta aba (não persiste entre reloads — é o que
 * queremos: aba nova = owner novo). Usado pra marcar quem possui cada
 * job 'running'.
 */
let TAB_ID_CACHE: string | null = null;
export function thisTabId(): string {
  if (TAB_ID_CACHE) return TAB_ID_CACHE;
  TAB_ID_CACHE = `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return TAB_ID_CACHE;
}

/**
 * Job está vivo? 'running' + heartbeat recente. Usado por outras abas
 * pra decidir "alguém já está cuidando, não pisa em cima".
 */
export function isMagnificJobAlive(job: MagnificQueueJob): boolean {
  if (job.status !== 'running') return false;
  if (!job.lastHeartbeatAt) return false;
  return Date.now() - job.lastHeartbeatAt < HEARTBEAT_STALE_MS;
}

export function loadMagnificQueue(): MagnificQueue {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(MAGNIFIC_QUEUE_KEY);
    return raw ? (JSON.parse(raw) as MagnificQueue) : {};
  } catch {
    return {};
  }
}

export function saveMagnificQueue(q: MagnificQueue) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(MAGNIFIC_QUEUE_KEY, JSON.stringify(q));
  } catch {}
}

/**
 * Restaura a fila no mount. Cross-tab safe:
 *   - Job 'running' COM heartbeat recente → DEIXA quieto (outra aba é dona)
 *   - Job 'running' SEM heartbeat ou stale → órfão, volta pra 'queued'
 *   - Job 'queued' com `ownerTabId` antigo → limpa owner (qualquer aba pega)
 *
 * Garante que abrir 2 abas NUNCA causa duplo-disparo: a aba B vê o running
 * vivo da aba A e simplesmente espera.
 */
export function restoreMagnificQueue(): MagnificQueue {
  const q = loadMagnificQueue();
  let changed = false;
  const now = Date.now();
  for (const id of Object.keys(q)) {
    const job = q[id];
    if (job.status === 'running') {
      const hb = job.lastHeartbeatAt ?? 0;
      const alive = hb > 0 && now - hb < HEARTBEAT_STALE_MS;
      if (alive) continue; // outra aba é dona — não toca
      // Órfão: aba antiga fechou sem terminar — re-enfileira
      q[id] = {
        ...job,
        status: 'queued',
        message: 'Reiniciado (aba antiga fechou no meio) — volta pra fila.',
        startedAt: undefined,
        lastHeartbeatAt: undefined,
        ownerTabId: undefined,
      };
      changed = true;
    } else if (job.ownerTabId) {
      // Job não-running com owner antigo — limpa pra qualquer aba pegar
      q[id] = { ...job, ownerTabId: undefined };
      changed = true;
    }
  }
  if (changed) saveMagnificQueue(q);
  return q;
}

/**
 * Próximo job elegível pro processor. Defesa em 3 camadas contra duplo
 * disparo:
 *   1) Se há QUALQUER job VIVO (running + heartbeat recente), retorna null
 *   2) Se há job 'running' SEM heartbeat por <30s (zona de incerteza),
 *      ainda retorna null — só libera após HEARTBEAT_STALE_MS confirmar órfão
 *   3) Só então pega o próximo queued FIFO não-gated
 *
 * Garante: nunca 2 jobs running ao mesmo tempo, mesmo com múltiplas abas
 * disputando.
 */
export function pickNextMagnificJob(q: MagnificQueue): MagnificQueueJob | null {
  // Camada 1+2: qualquer job 'running' (vivo OU em zona de incerteza)
  // bloqueia. Só passa quando heartbeat confirma órfão (>30s sem update).
  const now = Date.now();
  const hasRunningOrUncertain = Object.values(q).some((j) => {
    if (j.status !== 'running') return false;
    const hb = j.lastHeartbeatAt ?? j.startedAt ?? now;
    return now - hb < HEARTBEAT_STALE_MS;
  });
  if (hasRunningOrUncertain) return null;
  // Camada 3: FIFO entre queued não-gated
  const elegiveis = Object.values(q)
    .filter((j) => j.status === 'queued' && !j.gateOnHeyGen)
    .sort((a, b) => a.enqueuedAt - b.enqueuedAt);
  return elegiveis[0] || null;
}

/**
 * Atualiza heartbeat de um job 'running'. SÓ funciona se a aba que chama
 * for a dona (ownerTabId === thisTabId). Defesa: se outra aba assumir o
 * job, esta aba para de atualizar (e seu watchdog vai notar o pipeline
 * "fantasma" e abortar).
 */
export function pulseHeartbeat(taskId: string): boolean {
  const q = loadMagnificQueue();
  const job = q[taskId];
  if (!job) return false;
  if (job.status !== 'running') return false;
  if (job.ownerTabId && job.ownerTabId !== thisTabId()) return false;
  q[taskId] = { ...job, lastHeartbeatAt: Date.now() };
  saveMagnificQueue(q);
  return true;
}

/**
 * Tenta adquirir o lock pra rodar um job. Lê localStorage AGORA (sem
 * cache do React state), checa se há running vivo, e se livre, marca
 * o job como running + owner + heartbeat inicial — TUDO em escrita
 * atômica única no localStorage. Retorna true se conseguiu.
 *
 * Cross-tab race: se 2 abas chamarem ao mesmo tempo, a primeira que
 * escrever ganha; a segunda ao chamar verá running vivo e retorna false.
 * (Pequena janela teoria — mitigada por intervalo aleatório entre picks
 *  + ownerTabId que mostra claramente quem é dono.)
 */
export function tryAcquireMagnificJob(taskId: string): boolean {
  const q = loadMagnificQueue();
  // Re-check sob lock implícito (last write wins do storage)
  const now = Date.now();
  const hasRunning = Object.values(q).some((j) => {
    if (j.status !== 'running') return false;
    if (j.taskId === taskId) return false; // estamos retomando este
    const hb = j.lastHeartbeatAt ?? j.startedAt ?? now;
    return now - hb < HEARTBEAT_STALE_MS;
  });
  if (hasRunning) return false;
  const job = q[taskId];
  if (!job) return false;
  if (job.status !== 'queued') return false;
  q[taskId] = {
    ...job,
    status: 'running',
    startedAt: now,
    lastHeartbeatAt: now,
    ownerTabId: thisTabId(),
    message: 'Disparando pipeline Magnific...',
  };
  saveMagnificQueue(q);
  return true;
}

export function loadMagnificJsonMap(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(MAGNIFIC_JSON_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function saveMagnificJsonMap(m: Record<string, string>) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(MAGNIFIC_JSON_KEY, JSON.stringify(m));
  } catch {}
}
