/**
 * NOTIFICAÇÃO DE "CONCLUÍDO" (09.10) — parte PURA (sem React, sem window).
 *
 * Toda ferramenta grava no histórico quando termina um processo (logHistory,
 * em lib/history.ts). Cada evento NOVO vira um cartão pequeno no canto da
 * tela — mesmo desenho do aviso do admin — com o ícone da ferramenta, o que
 * terminou e um atalho pro histórico. A captura automática de download (a
 * própria pessoa clicou em baixar) NÃO notifica: seria ruído.
 *
 * Testado em lib/done-toasts.test.ts.
 */

import { canonicalTool, historyToolLabel, type HistoryKind } from './history-tools';

export type DoneTone = 'sucesso' | 'falha';

export type DoneToast = {
  id: string;
  tool: string;
  toolLabel: string;
  title: string;
  meta?: string;
  kind: HistoryKind;
  tone: DoneTone;
  /** "concluído", "exportado", "baixado", "disparado", "falhou" */
  status: string;
  /** quando terminou (ms) */
  at: number;
};

/** No máximo 3 empilhados: o mais novo em cima, o mais velho sai. */
export const DONE_MAX = 3;
/** Some sozinho depois disso (pausa com o mouse em cima e com a aba oculta). */
export const DONE_MS = 8000;

/** Nome que aparece na notificação quando o do histórico agrupa a ferramenta em outra. */
const LABEL_EXATO: Record<string, string> = {
  'caixinha-pergunta': 'Caixinha de Pergunta',
};

const FALHA = /\b(falh\w*|erro|cancelad\w*)\b|não deu|nao deu/i;

const STATUS: Record<HistoryKind, string> = {
  done: 'concluído',
  export: 'exportado',
  download: 'baixado',
  dispatch: 'disparado',
};

const KINDS = new Set<HistoryKind>(['done', 'export', 'download', 'dispatch']);

type EventLike = { id?: unknown; tool?: unknown; title?: unknown; kind?: unknown; meta?: unknown; t?: unknown };

/** Evento do histórico → cartão. Lixo (sem id/ferramenta/título) → null. */
export function toastFromEvent(ev: EventLike | null | undefined): DoneToast | null {
  if (!ev || typeof ev !== 'object') return null;
  const id = typeof ev.id === 'string' ? ev.id.slice(0, 160) : '';
  const tool = typeof ev.tool === 'string' ? ev.tool.slice(0, 60) : '';
  const title = typeof ev.title === 'string' ? ev.title.trim().slice(0, 160) : '';
  if (!id || !tool || !title) return null;
  const kind: HistoryKind = KINDS.has(ev.kind as HistoryKind) ? (ev.kind as HistoryKind) : 'done';
  // nome de arquivo não conta ("erro-final.mp4 comprimido" deu certo)
  const falhou = FALHA.test(title.replace(/\S+\.[a-z0-9]{2,5}\b/gi, ' '));
  const meta = typeof ev.meta === 'string' && ev.meta.trim() ? ev.meta.trim().slice(0, 120) : undefined;
  return {
    id,
    tool,
    toolLabel: LABEL_EXATO[tool] ?? historyToolLabel(canonicalTool(tool)),
    title,
    meta,
    kind,
    tone: falhou ? 'falha' : 'sucesso',
    status: falhou ? 'falhou' : STATUS[kind],
    at: typeof ev.t === 'number' && Number.isFinite(ev.t) ? ev.t : Date.now(),
  };
}

/** Mais novo em cima, sem repetir id, no máximo DONE_MAX. */
export function pushToast(list: DoneToast[], t: DoneToast): DoneToast[] {
  if (list.some((x) => x.id === t.id)) return list;
  return [t, ...list].slice(0, DONE_MAX);
}

/** "agora" no primeiro minuto; depois "há N min" / "há N h" (quando a aba estava oculta). */
export function quandoTerminou(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return 'agora';
  const m = Math.floor(s / 60);
  if (m < 60) return `há ${m} min`;
  return `há ${Math.floor(m / 60)} h`;
}

/** Mensagem entre abas: só aceita o formato que nós mesmos mandamos. */
export function isDoneToast(v: unknown): v is DoneToast {
  if (!v || typeof v !== 'object') return false;
  const t = v as Record<string, unknown>;
  return (
    typeof t.id === 'string' &&
    typeof t.tool === 'string' &&
    typeof t.toolLabel === 'string' &&
    typeof t.title === 'string' &&
    typeof t.status === 'string' &&
    (t.tone === 'sucesso' || t.tone === 'falha') &&
    KINDS.has(t.kind as HistoryKind) &&
    typeof t.at === 'number'
  );
}
