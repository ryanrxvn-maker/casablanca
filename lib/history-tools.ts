/**
 * REGISTRO DAS FERRAMENTAS DO HISTÓRICO — parte PURA.
 *
 * Sem React, sem `'use client'`, sem localStorage: só tipos e decisão. É o que
 * permite testar no node (lib/history-tools.test.ts) as três perguntas que o
 * histórico por ferramenta faz o tempo todo:
 *
 *   1. em que ferramenta esta rota está?      historyToolForPath()
 *   2. este registro é DESTA ferramenta?      canonicalTool() + filterHistory()
 *   3. este arquivo ainda dá pra baixar?      buildChains() + chainState()
 *
 * lib/history.ts (cliente) re-exporta tudo daqui, então nada que já importava
 * de '@/lib/history' precisou mudar.
 */

export type HistoryKind = 'done' | 'export' | 'dispatch' | 'download';

/**
 * Referência RECUPERÁVEL de arquivo — o que torna um registro do histórico
 * baixável de novo, e não só visível. Cada evento pode carregar N referências
 * (ex.: um disparo do Pilot tem Montado + Takes + resgate via HeyGen).
 *
 * - 'vault'  → bytes guardados no cofre do histórico (IndexedDB próprio,
 *              lib/history-vault.ts) — artefatos pequenos (prints, srt, áudio…).
 * - 'zip'    → aponta pra um artefato que JÁ vive no zip-store dos disparos
 *              (batch:<id>:montado etc.) — zero custo extra de espaço.
 * - 'heygen' → receita de resgate: os videoIds do disparo. O HeyGen retém os
 *              vídeos (~60 dias), então dá pra re-baixar os takes pelo id
 *              mesmo depois do navegador ter descartado os blobs locais.
 */
export type FileRef =
  | { via: 'vault'; key: string; name: string; size?: number; mime?: string; label?: string; taskId?: string }
  | { via: 'zip'; key: string; name: string; label?: string; taskId?: string }
  | {
      via: 'heygen';
      parts: { label: string; videoId: string }[];
      name: string;
      label?: string;
      taskId?: string;
    };

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
  /** referências de download — presença = o registro é recuperável */
  ref?: FileRef[];
  /** evento criado automaticamente pela captura de download (candidato a fusão) */
  auto?: boolean;
};

/** Retenção do histórico: 7 dias (mesma do cofre — lib/history-vault.ts). */
export const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

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
  { id: 'famous-hey', label: 'Famous Hey' },
  { id: 'ltx-video', label: 'Vídeo do zero' },
  { id: 'normalizador', label: 'Normalizador' },
  { id: 'remover-elementos', label: 'Removedor de Legenda' },
  { id: 'separador-audio', label: 'Separador de Áudio' },
  { id: 'voice-test', label: 'Isolar voz' },
];

/**
 * Ferramentas que o usuário enxerga como UMA só.
 *
 * - caixinha-pergunta → fakepass: rota própria, mesmo produto (o FakePrint já
 *   traz a caixinha entre os modelos de story); dois chips confundiam.
 * - lipsync-history → lipsync: a página de histórico de avatares é a MESMA
 *   ferramenta, vista por outro ângulo.
 * - 'Famous Hey' → famous-hey: registros antigos gravaram o NOME de exibição
 *   em vez do slug da rota. Sem este apelido, o histórico da ferramenta
 *   nasceria vazio pra quem já usou.
 */
const TOOL_ALIAS: Record<string, string> = {
  'caixinha-pergunta': 'fakepass',
  'lipsync-history': 'lipsync',
  'Famous Hey': 'famous-hey',
  'famous hey': 'famous-hey',
};

/** Id de exibição: dobra os apelidos na ferramenta dona (ver TOOL_ALIAS). */
export function canonicalTool(id: string): string {
  return TOOL_ALIAS[id] ?? TOOL_ALIAS[id?.toLowerCase?.() ?? ''] ?? id;
}

export function historyToolLabel(id: string): string {
  const c = canonicalTool(id);
  return HISTORY_TOOLS.find((t) => t.id === c)?.label ?? c;
}

/**
 * Rotas de /tools que NÃO são ferramenta de produzir arquivo — não ganham
 * botão de histórico próprio: a página do histórico geral, o console interno
 * de tarefas, os pontos e a calculadora (que não gera entrega nenhuma).
 */
const ROTAS_SEM_HISTORICO = new Set(['historico', 'background', 'points', 'calculadora']);

/**
 * Ferramenta (canônica) de uma rota do app, ou null quando a rota não é uma
 * ferramenta com histórico. Aceita a rota com ou sem barra final e ignora
 * sub-rotas (`/tools/fakepass/qualquer-coisa` continua sendo fakepass).
 */
export function historyToolForPath(pathname: string | null | undefined): string | null {
  if (!pathname) return null;
  const m = /^\/tools\/([a-z0-9-]+)/i.exec(pathname);
  if (!m) return null;
  const slug = m[1].toLowerCase();
  if (ROTAS_SEM_HISTORICO.has(slug)) return null;
  const canon = canonicalTool(slug);
  // Só ferramentas conhecidas ganham botão — rota nova sem registro aqui não
  // mostra um histórico que nunca vai encher.
  return HISTORY_TOOLS.some((t) => t.id === canon) ? canon : null;
}

/** Cadeia de download: refs de MESMO nome viram um botão só (fallback em ordem). */
export type Chain = { name: string; label: string; refs: FileRef[] };

export function buildChains(refs: FileRef[] | undefined): Chain[] {
  const out: Chain[] = [];
  for (const r of refs ?? []) {
    if (!r?.name) continue;
    const existing = out.find((c) => c.name === r.name);
    if (existing) existing.refs.push(r);
    else out.push({ name: r.name, label: r.label || r.name, refs: [r] });
  }
  return out;
}

/**
 * Estado honesto de uma cadeia:
 * - 'local'  → os bytes estão neste navegador (cofre ou zip-store): baixa na hora;
 * - 'remote' → não tem bytes, mas tem receita de resgate no HeyGen;
 * - 'gone'   → expirou de vez; o botão fica desabilitado dizendo isso.
 */
export type ChainState = 'local' | 'remote' | 'gone';

export function chainState(
  chain: Chain,
  disponivel: { vaultKeys: Set<string>; zipKeys: Set<string> },
): ChainState {
  for (const r of chain.refs) {
    if (r.via === 'vault' && disponivel.vaultKeys.has(r.key)) return 'local';
    if (r.via === 'zip' && disponivel.zipKeys.has(r.key)) return 'local';
  }
  if (chain.refs.some((r) => r.via === 'heygen')) return 'remote';
  return 'gone';
}

/** Este evento casa com a busca livre? (título, detalhe, arquivo ou ferramenta) */
export function eventMatchesQuery(ev: HistoryEvent, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    ev.title.toLowerCase().includes(q) ||
    (ev.meta ?? '').toLowerCase().includes(q) ||
    (ev.ref ?? []).some((r) => r.name.toLowerCase().includes(q)) ||
    historyToolLabel(ev.tool).toLowerCase().includes(q)
  );
}

/**
 * Filtro único do histórico — usado pela página geral E pelo painel de cada
 * ferramenta, pra os dois nunca divergirem no que consideram "desta
 * ferramenta". `tool: 'all'` (ou vazio) não filtra por ferramenta.
 */
export function filterHistory(
  events: HistoryEvent[],
  opts?: { tool?: string; query?: string; soRecuperaveis?: boolean },
): HistoryEvent[] {
  const tool = opts?.tool && opts.tool !== 'all' ? canonicalTool(opts.tool) : null;
  const query = opts?.query ?? '';
  return events.filter((e) => {
    if (tool && canonicalTool(e.tool) !== tool) return false;
    if (opts?.soRecuperaveis && !(e.ref?.length ?? 0)) return false;
    return eventMatchesQuery(e, query);
  });
}

/** Quantos registros existem por ferramenta (chips de filtro / badge do FAB). */
export function countByTool(events: HistoryEvent[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of events) {
    const c = canonicalTool(e.tool);
    m.set(c, (m.get(c) ?? 0) + 1);
  }
  return m;
}
