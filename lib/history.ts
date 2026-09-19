'use client';
import { createRecordWriter, readDurableRecords, deleteDurableRecords } from './durable-records';
import { RETENTION_MS, type DownloaderSource, type FileRef, type HistoryEvent, type HistoryKind } from './history-tools';
import { faseAtiva, podeVirarCard, preencherCanaisAusentes } from './history-acoes';

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
  DownloaderSource,
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
  id?: string;
  externalId?: string;
  tool: string;
  title: string;
  kind?: HistoryKind;
  meta?: string;
  ref?: FileRef[];
  channels?: Array<{ label: string; color: string }>;
  source?: DownloaderSource;
}) {
  if (typeof window === 'undefined') return;
  try {
    const events = safeRead();
    const now = Date.now();
    const dup = events.find(
      (e) =>
        (ev.externalId && e.externalId === ev.externalId) ||
        (e.tool === ev.tool &&
          e.title === ev.title &&
          e.kind === (ev.kind ?? 'done') &&
          now - e.t < 1500),
    );
    if (dup) {
      // Evento idêntico recém-gravado: anexa refs/canal que chegaram no
      // segundo fire (StrictMode não perde download nem metadado).
      if ((ev.ref?.length && !dup.ref?.length) || (ev.channels?.length && !dup.channels?.length) || (ev.source && !dup.source)) {
        if (ev.ref?.length && !dup.ref?.length) dup.ref = ev.ref;
        if (ev.channels?.length && !dup.channels?.length) dup.channels = ev.channels;
        if (ev.source && !dup.source) dup.source = ev.source;
        safeWrite(prune(events));
        window.dispatchEvent(new CustomEvent('autoedit:history'));
      }
      return;
    }
    const novo: HistoryEvent = {
      id: ev.id?.slice(0, 160) || `${now.toString(36)}${Math.random().toString(36).slice(2, 7)}`,
      t: now,
      tool: ev.tool,
      title: ev.title.slice(0, 160),
      kind: ev.kind ?? 'done',
      meta: ev.meta ? ev.meta.slice(0, 120) : undefined,
      ref: ev.ref?.length ? ev.ref : undefined,
      channels: ev.channels?.length ? ev.channels : undefined,
      externalId: ev.externalId?.slice(0, 180),
      source: ev.source,
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

export type DownloaderHistoryJob = {
  id: string;
  url: string;
  state: string;
  filename?: string | null;
  mode?: string;
  quality?: string;
  thumbnailUrl?: string | null;
  sourceTitle?: string | null;
  platform?: string | null;
  updatedAt?: number;
  createdAt?: number;
};

function safeHttpUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 4096) return undefined;
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Importa os jobs concluídos da extensão para o histórico da conta.
 *
 * A extensão é a fonte de verdade para página, popup e botão flutuante. O id
 * estável impede duplicatas, e registros genéricos criados por versões antigas
 * são reparados no lugar quando o horário corresponde ao mesmo download.
 */
export async function syncDownloaderHistoryJobs(jobs: DownloaderHistoryJob[]): Promise<number> {
  if (typeof window === 'undefined' || !Array.isArray(jobs)) return 0;
  const writer = createRecordWriter('history');
  const events = Object.values(writer.hydrate<HistoryEvent>());
  let changed = 0;
  for (const job of jobs) {
    const url = safeHttpUrl(job?.url);
    const filename = typeof job?.filename === 'string' ? job.filename.trim().slice(0, 240) : '';
    if (!job?.id || job.state !== 'complete' || !url || !filename) continue;
    const externalId = `downloader:${job.id}`;
    const when = Number(job.updatedAt || job.createdAt) || Date.now();
    const source: DownloaderSource = {
      kind: 'downloader',
      url,
      filename,
      mode: ['video', 'audio-mp3', 'audio-wav'].includes(String(job.mode))
        ? job.mode as DownloaderSource['mode']
        : 'video',
      quality: ['1080', '720', '480', 'best'].includes(String(job.quality))
        ? job.quality as DownloaderSource['quality']
        : '1080',
      thumbnailUrl: safeHttpUrl(job.thumbnailUrl),
      sourceTitle: typeof job.sourceTitle === 'string' ? job.sourceTitle.trim().slice(0, 240) || undefined : undefined,
      platform: typeof job.platform === 'string' ? job.platform.trim().slice(0, 40) || undefined : undefined,
    };
    let event = events.find((candidate) => candidate.externalId === externalId);
    if (!event) {
      // Migra a linha genérica que a página antiga gravava ao mesmo tempo que
      // o job, evitando deixar "YouTube baixado pelo Motor" + nome real.
      event = events.find((candidate) =>
        candidate.tool === 'downloader' &&
        !candidate.externalId &&
        !candidate.source &&
        Math.abs(candidate.t - when) < 3 * 60_000 &&
        /(?:baixado pelo motor|instagram baixado|youtube baixado|pinterest baixado|tiktok baixado)/i.test(candidate.title));
    }
    if (event) {
      const same = event.title === filename && event.externalId === externalId &&
        event.source?.url === source.url && event.source?.filename === source.filename &&
        event.source?.thumbnailUrl === source.thumbnailUrl;
      if (!same) {
        event.title = filename;
        event.kind = 'download';
        event.externalId = externalId;
        event.source = source;
        event.meta = source.platform || event.meta;
        changed += 1;
      }
      continue;
    }
    events.push({
      id: `dl-${String(job.id).replace(/[^a-z0-9_-]/gi, '').slice(0, 120)}`,
      t: when,
      tool: 'downloader',
      title: filename,
      kind: 'download',
      meta: source.platform,
      externalId,
      source,
    });
    changed += 1;
  }
  if (!changed) return 0;
  const alive = prune(events);
  await writer.save(Object.fromEntries(alive.map((event) => [event.id, event])));
  window.dispatchEvent(new CustomEvent('autoedit:history'));
  return changed;
}

/**
 * Persiste o canal recuperado em eventos legados e sincroniza com a conta.
 * A atualização é aditiva: eventos que já conhecem o canal nunca são
 * sobrescritos por uma consulta posterior.
 */
export async function backfillHistoryChannels(
  canaisPorTask: Record<string, Array<{ label: string; color: string }>>,
): Promise<number> {
  if (typeof window === 'undefined' || Object.keys(canaisPorTask).length === 0) return 0;
  const writer = createRecordWriter('history');
  const atuais = Object.values(writer.hydrate<HistoryEvent>());
  const { events, alterados } = preencherCanaisAusentes(atuais, canaisPorTask);
  if (!alterados) return 0;
  await writer.save(Object.fromEntries(events.map((evento) => [evento.id, evento])));
  window.dispatchEvent(new CustomEvent('autoedit:history'));
  return alterados;
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
    if (!podeVirarCard(taskId)) return { existe: false, rodando: false };
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
