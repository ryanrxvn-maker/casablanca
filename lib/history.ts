'use client';

/**
 * Histórico geral — registro local de tudo que o usuário produziu, em todas
 * as ferramentas, com retenção de 7 dias (pedido: mínimo 5).
 *
 * Desenho:
 * - localStorage (chave versionada) — sobrevive a F5 e fechamento; nada sobe
 *   pra servidor (privacidade: nomes de arquivo ficam na máquina do usuário).
 * - logHistory() é fire-and-forget e NUNCA lança: instrumentação não pode
 *   quebrar ferramenta. Poda por idade e por teto a cada escrita.
 * - Um CustomEvent 'autoedit:history' avisa a página do histórico pra
 *   atualizar ao vivo se estiver aberta.
 */

export type HistoryKind = 'done' | 'export' | 'dispatch' | 'download';

export type HistoryEvent = {
  id: string;
  /** epoch ms */
  t: number;
  /** slug da ferramenta (mesmo id das rotas: 'decupagem', 'heygen-auto'...) */
  tool: string;
  /** frase curta do que aconteceu — ex.: "ad-hook-03.mp4 decupado" */
  title: string;
  kind: HistoryKind;
  /** detalhe opcional — ex.: "31% menor · 0:42" */
  meta?: string;
};

const KEY = 'autoedit:history:v1';
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_EVENTS = 1200;

/** Nomes exibidos por ferramenta (e ordem dos filtros). */
export const HISTORY_TOOLS: { id: string; label: string }[] = [
  { id: 'clickup-pilot', label: 'ClickUp Pilot' },
  { id: 'heygen-auto', label: 'Hey Auto' },
  { id: 'auto-broll', label: 'Auto B-roll' },
  { id: 'lipsync', label: 'Lipsync' },
  { id: 'decupagem', label: 'Decupagem' },
  { id: 'decupagem-copy', label: 'Decupagem Inteligente' },
  { id: 'copy-srt', label: 'Gerador de SRT' },
  { id: 'tipografia', label: 'Legendas Automáticas' },
  { id: 'auto-cortes', label: 'Auto Cortes' },
  { id: 'camuflagem', label: 'Camuflagem' },
  { id: 'compressor', label: 'Compressor' },
  { id: 'acelerador', label: 'Mixer de Velocidade' },
  { id: 'audio-split', label: 'Dividir áudios' },
  { id: 'downloader', label: 'Downloader' },
  { id: 'fakepass', label: 'FakePrint' },
  { id: 'caixinha-pergunta', label: 'Caixinha de Pergunta' },
  { id: 'ltx-video', label: 'Vídeo do zero' },
  { id: 'normalizador', label: 'Normalizador' },
  { id: 'separador-audio', label: 'Separador de Áudio' },
  { id: 'voice-test', label: 'Isolar voz' },
];

export function historyToolLabel(id: string): string {
  return HISTORY_TOOLS.find((t) => t.id === id)?.label ?? id;
}

function safeRead(): HistoryEvent[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (e) =>
        e &&
        typeof e.t === 'number' &&
        typeof e.tool === 'string' &&
        typeof e.title === 'string',
    );
  } catch {
    return [];
  }
}

function safeWrite(events: HistoryEvent[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(events));
  } catch {
    // Quota cheia: derruba a metade mais velha e tenta uma única vez.
    try {
      localStorage.setItem(
        KEY,
        JSON.stringify(events.slice(0, Math.floor(events.length / 2))),
      );
    } catch {
      /* desiste em silêncio — histórico nunca derruba ferramenta */
    }
  }
}

function prune(events: HistoryEvent[]): HistoryEvent[] {
  const cutoff = Date.now() - RETENTION_MS;
  const alive = events.filter((e) => e.t >= cutoff);
  alive.sort((a, b) => b.t - a.t);
  return alive.slice(0, MAX_EVENTS);
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
    if (dup) return;
    events.unshift({
      id: `${now.toString(36)}${Math.random().toString(36).slice(2, 7)}`,
      t: now,
      tool: ev.tool,
      title: ev.title.slice(0, 160),
      kind: ev.kind ?? 'done',
      meta: ev.meta ? ev.meta.slice(0, 120) : undefined,
    });
    safeWrite(prune(events));
    window.dispatchEvent(new CustomEvent('autoedit:history'));
  } catch {
    /* nunca propaga */
  }
}

/** Lê o histórico já podado (mais novo primeiro). */
export function readHistory(): HistoryEvent[] {
  if (typeof window === 'undefined') return [];
  return prune(safeRead());
}

/** Apaga tudo. */
export function clearHistory() {
  try {
    localStorage.removeItem(KEY);
    window.dispatchEvent(new CustomEvent('autoedit:history'));
  } catch {
    /* noop */
  }
}
