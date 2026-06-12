/**
 * Alinha o TEXTO EDITADO pelo user (um campo por papel) de volta aos
 * WORDS com timestamp do transcript original → recupera QUAIS trechos do
 * áudio cada avatar fala. Revisão humana vira a verdade do roteamento.
 *
 * Como (2026-06-11, pedido do user): cada 👁 é um textarea editável. O user
 * recorta/cola/digita pra mover frases entre avatares. No disparo:
 *  1. Para CADA papel, alinha o texto do seu textarea contra a sequência de
 *     words original (LCS robusto a typo/insercao/delecao).
 *  2. Cada word do original é reivindicada pelo papel com o MAIOR run
 *     contíguo casado (claim mais forte vence em conflito).
 *  3. Words não reivindicadas (user apagou de todos) herdam o vizinho.
 *  4. Words viram SEGMENTOS (merge consecutivo + corte no meio do gap) →
 *     impossível vazar palavra. O disparo lip-synca cada segmento com o
 *     avatar do papel que o reivindicou.
 */

export type AlignWord = { text: string; startMs: number; endMs: number };

function norm(s: string): string {
  return (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Tokeniza um texto livre em tokens normalizados (não-vazios). */
function tokenize(s: string): string[] {
  return (s || '')
    .split(/\s+/)
    .map(norm)
    .filter((t) => t.length > 0);
}

/** LCS entre os tokens do papel e os words originais. Retorna, por word
 *  original casada, o COMPRIMENTO do run contíguo a que pertence (força do
 *  claim). Words não casadas ficam 0. */
function lcsClaim(roleTokens: string[], wordTokens: string[]): number[] {
  const m = roleTokens.length, n = wordTokens.length;
  const claim = new Array<number>(n).fill(0);
  if (m === 0 || n === 0) return claim;
  // DP LCS (m+1 x n+1) — m,n ~ algumas centenas, ok
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = roleTokens[i - 1] === wordTokens[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  // backtrack → quais word-idx (j) casaram
  const matched: boolean[] = new Array(n).fill(false);
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (roleTokens[i - 1] === wordTokens[j - 1]) { matched[j - 1] = true; i--; j--; }
    else if (dp[i - 1][j] >= dp[i][j - 1]) i--;
    else j--;
  }
  // comprimento do run contíguo de matched=true por posição
  let k = 0;
  while (k < n) {
    if (!matched[k]) { k++; continue; }
    let e = k;
    while (e < n && matched[e]) e++;
    const len = e - k;
    for (let p = k; p < e; p++) claim[p] = len;
    k = e;
  }
  return claim;
}

export type AlignResult = {
  /** rank do papel por word (0..k-1) */
  wordRanks: number[];
  /** segmentos finais: start/end em SEGUNDOS + rank */
  segments: Array<{ start: number; end: number; rank: number }>;
  /** quantas words ficaram órfãs (herdaram vizinho) — diagnóstico */
  orphans: number;
};

/**
 * @param words  words do transcript original (ordem cronológica, ms)
 * @param roleTexts  texto editado de CADA papel (índice = rank)
 * @param totalDurSec  duração do AD (pra estender bordas)
 */
export function alignEditedToWords(
  words: AlignWord[],
  roleTexts: string[],
  totalDurSec: number,
): AlignResult {
  const W = words.map((w) => norm(w.text));
  const n = W.length;
  if (n === 0) return { wordRanks: [], segments: [], orphans: 0 };

  // claim de cada papel
  const claims = roleTexts.map((t) => lcsClaim(tokenize(t), W));

  // por word: papel com maior run; empate → menor rank (principal)
  const wordRanks = new Array<number>(n).fill(-1);
  for (let i = 0; i < n; i++) {
    let bestRank = -1, bestLen = 0;
    for (let r = 0; r < claims.length; r++) {
      if (claims[r][i] > bestLen) { bestLen = claims[r][i]; bestRank = r; }
    }
    wordRanks[i] = bestRank; // -1 = órfã
  }
  // órfãs herdam o vizinho anterior (continuidade); início herda o próximo
  let orphans = 0;
  for (let i = 0; i < n; i++) {
    if (wordRanks[i] === -1) {
      orphans++;
      wordRanks[i] = i > 0 ? wordRanks[i - 1] : 0;
    }
  }
  for (let i = 0; i < n; i++) if (wordRanks[i] < 0) wordRanks[i] = 0;

  // segmentos: merge consecutivo + corte no meio do gap
  const segs: Array<{ start: number; end: number; rank: number }> = [];
  for (let i = 0; i < n; i++) {
    const rank = wordRanks[i];
    const startS = words[i].startMs / 1000;
    const endS = words[i].endMs / 1000;
    const last = segs[segs.length - 1];
    if (last && last.rank === rank) {
      last.end = Math.max(last.end, endS);
    } else if (last) {
      const mid = (last.end + startS) / 2;
      last.end = mid;
      segs.push({ start: mid, end: endS, rank });
    } else {
      segs.push({ start: 0, end: endS, rank });
    }
  }
  if (segs.length) segs[segs.length - 1].end = Math.max(segs[segs.length - 1].end, totalDurSec);
  return { wordRanks, segments: segs, orphans };
}
