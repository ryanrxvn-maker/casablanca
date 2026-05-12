/**
 * Sistema de Pontos DARKO LAB.
 *
 * Regras (definidas pelo user 12/05/2026):
 *   - Metas mensais: 60pts→R$4k, 90pts→R$6k, 120pts→R$8k, 150pts→R$10k
 *   - NAO fraciona: tem que bater EXATAMENTE a meta pra ganhar
 *   - 1 meta por mes (a maior atingida ate dia 30/31)
 *   - Pontos zeram no fim do mes
 *   - User tem level historico (quantas metas atingiu nos meses)
 *
 * Medalhas (do user 12/05/2026):
 *   - Cada meta tem um nome FODA em ingles
 *   - Ultima (150pts/R$10k) = LEGEND
 *   - Cada uma tem design maior/mais foda que a anterior
 *   - Quando atinge, fica animada/acesa
 *   - Hover mostra descricao holografica + frase incentivo
 */

export type PointsTier = {
  /** Pontos minimos pra atingir essa tier (incluso) */
  minPoints: number;
  /** Premio em BRL */
  bonusBRL: number;
  /** Nome em ingles foda — last one is LEGEND */
  englishName: string;
  /** Slogan/frase pra hover */
  slogan: string;
  /** Cor primaria (CSS) — gradient nas medalhas */
  primaryColor: string;
  /** Cor secundaria (CSS) — pra glow/ring */
  secondaryColor: string;
  /** Codigo de tamanho 1-5: quanto maior, mais foda visualmente */
  sizeLevel: 1 | 2 | 3 | 4 | 5;
};

export const POINTS_TIERS: PointsTier[] = [
  {
    minPoints: 60,
    bonusBRL: 4000,
    englishName: 'ROOKIE',
    slogan: 'First blood. The empire starts here.',
    // Carbon fiber black: cinza escuro com brilho metalico
    primaryColor: '#27272A',     // zinc-800 (carbon dark)
    secondaryColor: '#52525B',   // zinc-600 (carbon highlight)
    sizeLevel: 1,
  },
  {
    minPoints: 90,
    bonusBRL: 6000,
    englishName: 'ELITE',
    slogan: 'Above the average. They notice you now.',
    // Silver ornate: prata polida
    primaryColor: '#E5E7EB',     // gray-200 (silver shine)
    secondaryColor: '#9CA3AF',   // gray-400 (silver shadow)
    sizeLevel: 2,
  },
  {
    minPoints: 120,
    bonusBRL: 8000,
    englishName: 'CHAMPION',
    slogan: 'You decide your own salary now. Keep going.',
    // Gold ornate: ouro polido com tons quentes
    primaryColor: '#FCD34D',     // amber-300 (gold bright)
    secondaryColor: '#B45309',   // amber-700 (gold deep)
    sizeLevel: 3,
  },
  {
    minPoints: 150,
    bonusBRL: 10000,
    englishName: 'LEGEND',
    slogan: 'Legends are not born — they are forged in monthly grind.',
    // Diamond pink/iridescent + wings (mais elaborado)
    primaryColor: '#FBCFE8',     // pink-200 (diamond pink)
    secondaryColor: '#F472B6',   // pink-400 (diamond glow)
    sizeLevel: 5,
  },
];

/** Retorna a meta atingida (maior tier <= pontos) ou null se nao bateu nada */
export function tierAchieved(points: number): PointsTier | null {
  let best: PointsTier | null = null;
  for (const t of POINTS_TIERS) {
    if (points >= t.minPoints) best = t;
  }
  return best;
}

/** Proxima meta a alcancar (menor tier > pontos) ou null se ja maxed */
export function nextTier(points: number): PointsTier | null {
  for (const t of POINTS_TIERS) {
    if (points < t.minPoints) return t;
  }
  return null;
}

/** Quantos pontos faltam pra proxima meta */
export function pointsToNext(points: number): number {
  const next = nextTier(points);
  if (!next) return 0;
  return next.minPoints - points;
}

/** Progresso visual da BARRA: 0..1 dentro da janela [tierAtual.min .. proximaTier.min].
 *  Se ja maxed (LEGEND), retorna 1.0 */
export function tierProgress(points: number): number {
  const cur = tierAchieved(points);
  const nx = nextTier(points);
  if (!nx) return 1.0;
  const base = cur?.minPoints ?? 0;
  const range = nx.minPoints - base;
  if (range <= 0) return 1.0;
  return Math.max(0, Math.min(1, (points - base) / range));
}

/** Formata BRL ex 4000 → "R$ 4.000" */
export function fmtBRL(value: number): string {
  return 'R$ ' + value.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

/* ============================== HISTORICO ==============================
 *
 * Cada mes fica salvo: pontos finais + tier atingido + bonus BRL.
 * Persistencia: localStorage (key 'darkolab:points:history').
 * Quando muda de mes, snapshot do mes anterior eh salvo automaticamente
 * pela page (via useEffect). Pontos atuais sao calculados dinamicamente
 * da ClickUp custom field 'PESO' das tasks do user no mes corrente.
 */

export type MonthHistory = {
  /** YYYY-MM */
  monthKey: string;
  /** Pontos finais do mes */
  finalPoints: number;
  /** Tier maximo atingido (null se < 60) */
  tier: PointsTier | null;
  /** Bonus BRL ganho (0 se nao bateu meta) */
  bonusBRL: number;
  /** Timestamp do snapshot */
  snapshotAt: number;
};

const HISTORY_KEY = 'darkolab:points:history';

export function loadHistory(): MonthHistory[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveHistory(history: MonthHistory[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

export function recordMonth(monthKey: string, finalPoints: number): MonthHistory {
  const tier = tierAchieved(finalPoints);
  return {
    monthKey,
    finalPoints,
    tier,
    bonusBRL: tier?.bonusBRL ?? 0,
    snapshotAt: Date.now(),
  };
}

/** Atual YYYY-MM */
export function currentMonthKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Filtra historico por range de meses (ate 10 anos = 120 meses) */
export function filterHistoryByMonths(history: MonthHistory[], monthsBack: number): MonthHistory[] {
  const now = new Date();
  now.setDate(1);
  const cutoff = new Date(now.getFullYear(), now.getMonth() - monthsBack + 1, 1);
  return history.filter((h) => {
    const [y, m] = h.monthKey.split('-').map(Number);
    const d = new Date(y, m - 1, 1);
    return d >= cutoff;
  });
}

/** Total faturado em N meses */
export function totalBRL(history: MonthHistory[]): number {
  return history.reduce((sum, h) => sum + h.bonusBRL, 0);
}

/** Quantos meses consecutivos batendo meta a partir do mes mais recente */
export function consecutiveStreak(history: MonthHistory[]): number {
  const sorted = [...history].sort((a, b) => b.monthKey.localeCompare(a.monthKey));
  let streak = 0;
  for (const h of sorted) {
    if (h.tier) streak++;
    else break;
  }
  return streak;
}
