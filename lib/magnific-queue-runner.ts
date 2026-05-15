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
};

export type MagnificQueue = Record<string, MagnificQueueJob>;

export const MAGNIFIC_QUEUE_KEY = 'darkolab:clickup-pilot:magnific-queue';
/** JSON colado por task (caixa "+" inline) — persiste reload */
export const MAGNIFIC_JSON_KEY = 'darkolab:clickup-pilot:magnific-json';

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

/** Restaura a fila no mount: jobs que estavam 'running' (page fechou no
 *  meio) voltam pra 'queued' — re-rodar e seguro (space novo + auto-retry
 *  interno do runMagnificPipeline). */
export function restoreMagnificQueue(): MagnificQueue {
  const q = loadMagnificQueue();
  let changed = false;
  for (const id of Object.keys(q)) {
    if (q[id].status === 'running') {
      q[id] = {
        ...q[id],
        status: 'queued',
        message: 'Reiniciado apos reload da pagina — volta pra fila.',
        startedAt: undefined,
      };
      changed = true;
    }
  }
  if (changed) saveMagnificQueue(q);
  return q;
}

/** Proximo job elegivel pro processor: 'queued' + NAO gated. Ordem FIFO
 *  por enqueuedAt. Retorna null se nada elegivel (fila vazia ou tudo
 *  aguardando HeyGen). Garante serial junto com o ref-guard do processor. */
export function pickNextMagnificJob(q: MagnificQueue): MagnificQueueJob | null {
  // Se ja tem 1 rodando, processor nao pega outro (defesa extra alem do ref).
  if (Object.values(q).some((j) => j.status === 'running')) return null;
  const elegiveis = Object.values(q)
    .filter((j) => j.status === 'queued' && !j.gateOnHeyGen)
    .sort((a, b) => a.enqueuedAt - b.enqueuedAt);
  return elegiveis[0] || null;
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
