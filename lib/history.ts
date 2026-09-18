'use client';
import { createRecordWriter, readDurableRecords, deleteDurableRecords } from './durable-records';
import { RETENTION_MS, type FileRef, type HistoryEvent, type HistoryKind } from './history-tools';
import { faseAtiva } from './history-acoes';

/**
 * Histórico geral na conta, separado do background, com retenção de 7 dias.
 *
 * Desenho:
 * - Registro por evento no servidor; localStorage guarda a fila de sincronização.
 * - logHistory() é fire-and-forget e NUNCA lança: instrumentação não pode
 *   quebrar ferramenta. Falhas de salvamento aparecem no indicador global.
 * - Um CustomEvent 'autoedit:history' avisa a página do histórico pra
 *   atualizar ao vivo se estiver aberta.
 */

export type {
  FileRef,
  HistoryEvent,
  HistoryKind,
} from './history-tools';
export {
  HISTORY_TOOLS,
  buildChains,
  canonicalTool,
  chainState,
  countByTool,
  eventMatchesQuery,
  filterHistory,
  historyToolForPath,
  historyToolLabel,
  type Chain,
  type ChainState,
} from './history-tools';

function safeRead(): HistoryEvent[] { return Object.values(readDurableRecords<HistoryEvent>('history')); }

function safeWrite(events: HistoryEvent[]) {
  const writer = createRecordWriter('history');
  writer.hydrate();
  void writer.save(Object.fromEntries(events.map(e => [e.id, e]))).catch(() => {});
}

function prune(events: HistoryEvent[]): HistoryEvent[] {
  const cutoff = Date.now() - RETENTION_MS;
  const alive = events.filter((e) => e.t >= cutoff);
  alive.sort((a, b) => b.t - a.t);
  return alive;
}

/**
 * Registra um evento. Fire-and-forget: nunca lança, nunca bloqueia.
 * Dedup leve: ignora se o evento idêntico foi gravado há <1.5s (protege
 * contra double-fire de efeitos em StrictMode/re-render).
 */
export function logHistory(ev: {
  tool: string;
  title: string;
  kind?: HistoryKind;
  meta?: string;
  ref?: FileRef[];
}) {
  if (typeof window === 'undefined') return;
  try {
    const events = safeRead();
    const now = Date.now();
    const dup = events.find(
      (e) =>
        e.tool === ev.tool &&
        e.title === ev.title &&
        e.kind === (ev.kind ?? 'done') &&
        now - e.t < 1500,
    );
    if (dup) {
      // Evento idêntico recém-gravado: se o novo traz refs e o antigo não,
      // aproveita pra anexar (double-fire de StrictMode não perde download).
      if (ev.ref?.length && !dup.ref?.length) {
        dup.ref = ev.ref;
        safeWrite(prune(events));
        window.dispatchEvent(new CustomEvent('autoedit:history'));
      }
      return;
    }
    const novo: HistoryEvent = {
      id: `${now.toString(36)}${Math.random().toString(36).slice(2, 7)}`,
      t: now,
      tool: ev.tool,
      title: ev.title.slice(0, 160),
      kind: ev.kind ?? 'done',
      meta: ev.meta ? ev.meta.slice(0, 120) : undefined,
      ref: ev.ref?.length ? ev.ref : undefined,
    };
    // FUSÃO (captura → evento da página): se a captura automática de download
    // criou eventos provisórios pra essa ferramenta há poucos segundos e a
    // página agora registra o evento "de verdade" (título melhor), os
    // provisórios são absorvidos: as refs migram (cofre na frente — retenção
    // maior que o zip-store) e eles somem — nada de registro duplicado.
    {
      const autos = events.filter(
        (e) => e.auto && e.tool === ev.tool && now - e.t < ATTACH_WINDOW_MS && e.ref?.length,
      );
      if (autos.length > 0) {
        const doCofre: FileRef[] = [];
        for (const a of autos) for (const r of a.ref ?? []) doCofre.push(r);
        // Cofre primeiro; refs de mesmo nome viram cadeia de fallback na UI.
        novo.ref = [...doCofre, ...(novo.ref ?? [])];
        for (const a of autos) {
          const i = events.indexOf(a);
          if (i >= 0) events.splice(i, 1);
        }
      }
    }
    events.unshift(novo);
    safeWrite(prune(events));
    window.dispatchEvent(new CustomEvent('autoedit:history'));
  } catch {
    /* nunca propaga */
  }
}

/** Janela de fusão entre a captura automática do download e o logHistory da página. */
const ATTACH_WINDOW_MS = 12_000;

/**
 * Anexa uma referência de download ao evento mais recente da ferramenta que
 * ainda não tem uma (fusão evento da página → captura). Se não existir evento
 * recente, cria um provisório (auto) — que o próximo logHistory da página
 * absorve, se vier. Usado pela captura automática em lib/history-vault.ts.
 * Fire-and-forget: nunca lança.
 */
export function attachRefToRecent(opts: {
  tool: string;
  ref: FileRef;
  fallbackTitle: string;
}): 'attached' | 'created' | 'skipped' {
  if (typeof window === 'undefined') return 'skipped';
  try {
    const events = safeRead();
    const now = Date.now();
    // Double-click no mesmo download? Não duplica registro nem bytes — o
    // caller usa o 'skipped' pra descartar os bytes que acabou de guardar.
    const jaTem = events.find(
      (e) =>
        e.tool === opts.tool &&
        now - e.t < ATTACH_WINDOW_MS &&
        e.ref?.some((r) => r.name === opts.ref.name),
    );
    if (jaTem) return 'skipped';
    // Só anexa a evento de RESULTADO (done/export/download) — um 'dispatch'
    // recente não pode herdar o arquivo de outro fluxo por coincidência de tempo.
    const alvo = events.find(
      (e) =>
        e.tool === opts.tool &&
        now - e.t < ATTACH_WINDOW_MS &&
        !e.ref?.length &&
        e.kind !== 'dispatch',
    );
    let resultado: 'attached' | 'created';
    if (alvo) {
      alvo.ref = [opts.ref];
      resultado = 'attached';
    } else {
      events.unshift({
        id: `${now.toString(36)}${Math.random().toString(36).slice(2, 7)}`,
        t: now,
        tool: opts.tool,
        title: opts.fallbackTitle.slice(0, 160),
        kind: 'download',
        ref: [opts.ref],
        auto: true,
      });
      resultado = 'created';
    }
    safeWrite(prune(events));
    window.dispatchEvent(new CustomEvent('autoedit:history'));
    return resultado;
  } catch {
    return 'skipped';
  }
}

/** Lê o histórico já podado (mais novo primeiro). */
export function readHistory(): HistoryEvent[] {
  if (typeof window === 'undefined') return [];
  return prune(safeRead());
}

/**
 * Apaga UM registro (botão Remover do histórico). Os bytes que ele apontava
 * são limpos por quem chama — o histórico não decide sozinho apagar arquivo.
 */
export async function removeHistoryEvent(id: string): Promise<void> {
  await deleteDurableRecords('history', [id]);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('autoedit:history'));
  }
}

/**
 * Esse disparo ainda está na fila da ferramenta? É o que decide se REMONTAR e
 * DEBUG podem agir: sem o registro de background, não há o que retomar, e o
 * botão precisa dizer isso em vez de fingir que funciona.
 */
export function disparoNaFila(taskId: string): { existe: boolean; rodando: boolean } {
  try {
    const rec = readDurableRecords<{ phase?: string }>('background')[taskId];
    if (!rec) return { existe: false, rodando: false };
    return { existe: true, rodando: faseAtiva(rec.phase) };
  } catch {
    return { existe: false, rodando: false };
  }
}

/** Apaga tudo. */
export async function clearHistory() {
  await deleteDurableRecords('history', safeRead().map(e => e.id));
}
