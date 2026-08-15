/**
 * Correção da legenda PELA COPY — a copy colada é a verdade sobre O QUE foi
 * dito; a transcrição é a verdade sobre QUANDO. Este módulo alinha as duas
 * palavra a palavra (programação dinâmica, estilo Needleman-Wunsch) e:
 *
 *   • palavra casada    → o TEXTO vira o da copy (grafia + pontuação . , ! ?)
 *   • palavra só na copy→ é ANEXADA à palavra vizinha (o bloco ganha a
 *                          palavra que o ASR comeu, sem mexer em índice/tempo)
 *   • palavra só no ASR → fica como está (não inventamos remoção)
 *
 * A SEPARAÇÃO DE BLOCOS E OS TEMPOS NUNCA MUDAM — nem a contagem de palavras
 * de cada bloco (por isso destaques e estilos por palavra continuam válidos).
 */

import type { Block } from './engine';

/** normaliza pra COMPARAR (minúsculas, sem acento, sem pontuação) */
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/** tokens da copy MANTENDO a pontuação de exibição ("cirurgia," fica junto) */
function copyTokens(copyText: string): string[] {
  return copyText
    .replace(/["""''«»()\[\]]/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && norm(t).length > 0);
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array<number>(n + 1);
  let cur = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

/** similaridade 0..1 entre palavras normalizadas */
function sim(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const d = levenshtein(a, b);
  return 1 - d / Math.max(a.length, b.length);
}

export type CopyFixResult = {
  blocks: Block[];
  /** palavras cujo texto mudou */
  corrected: number;
  /** palavras da copy que o ASR tinha comido e foram anexadas */
  added: number;
  /** fração [0..1] das palavras do ASR casadas com a copy */
  coverage: number;
};

/**
 * Alinha e corrige. Lança se a copy for curta demais pra confiar.
 */
export function correctBlocksByCopy(blocks: Block[], copyText: string): CopyFixResult {
  const copy = copyTokens(copyText);
  if (copy.length < 8) {
    throw new Error('A copy colada é curta demais pra corrigir com segurança.');
  }
  // achata as palavras do ASR preservando o endereço (bloco, índice)
  const flat: Array<{ b: number; w: number; text: string }> = [];
  blocks.forEach((blk, bi) =>
    blk.words.forEach((wd, wi) => flat.push({ b: bi, w: wi, text: wd.text })),
  );
  if (flat.length === 0) {
    throw new Error('Não há legenda gerada pra corrigir.');
  }

  const A = flat.map((f) => norm(f.text)); // ASR
  const B = copy.map((c) => norm(c)); // copy
  const n = A.length;
  const m = B.length;

  // DP de alinhamento global (gap = -0.6; match forte = +2; parecido = +1.2×sim)
  const GAP = -0.6;
  const score = (i: number, j: number) => {
    const s = sim(A[i], B[j]);
    if (s >= 0.999) return 2;
    if (s >= 0.55) return 0.4 + 1.2 * s;
    return -1.1;
  };
  // matrizes (n+1)×(m+1) achatadas
  const W = m + 1;
  const dp = new Float64Array((n + 1) * W);
  const bt = new Uint8Array((n + 1) * W); // 1=diag 2=cima(gap copy) 3=esq(gap asr)
  for (let i = 1; i <= n; i++) {
    dp[i * W] = i * GAP;
    bt[i * W] = 2;
  }
  for (let j = 1; j <= m; j++) {
    dp[j] = j * GAP;
    bt[j] = 3;
  }
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const d = dp[(i - 1) * W + (j - 1)] + score(i - 1, j - 1);
      const up = dp[(i - 1) * W + j] + GAP;
      const lf = dp[i * W + (j - 1)] + GAP;
      let best = d;
      let dir = 1;
      if (up > best) {
        best = up;
        dir = 2;
      }
      if (lf > best) {
        best = lf;
        dir = 3;
      }
      dp[i * W + j] = best;
      bt[i * W + j] = dir;
    }
  }

  // traceback → pra cada palavra do ASR: copyIdx casado (ou -1) + inserções
  const matchOf = new Array<number>(n).fill(-1);
  // copy words sem par: anexar na palavra ASR mais próxima (a ANTERIOR alinhada)
  const insertAfter = new Map<number, string[]>(); // asrIdx → tokens da copy
  {
    let i = n;
    let j = m;
    const pendingIns: string[] = [];
    while (i > 0 || j > 0) {
      const dir = i > 0 && j > 0 ? bt[i * W + j] : i > 0 ? 2 : 3;
      if (dir === 1) {
        i--;
        j--;
        // só considera CASADO se parecido o bastante (senão é troca real)
        if (sim(A[i], B[j]) >= 0.55) matchOf[i] = j;
        if (pendingIns.length) {
          insertAfter.set(i, [...pendingIns.reverse()]);
          pendingIns.length = 0;
        }
      } else if (dir === 2) {
        i--;
        if (pendingIns.length) {
          insertAfter.set(i, [...pendingIns.reverse()]);
          pendingIns.length = 0;
        }
      } else {
        j--;
        pendingIns.push(copy[j]);
      }
    }
    if (pendingIns.length) insertAfter.set(0, [...pendingIns.reverse()]);
  }

  const matched = matchOf.filter((x) => x >= 0).length;
  const coverage = matched / n;
  if (coverage < 0.5) {
    throw new Error(
      `A copy colada não parece ser deste vídeo (só ${Math.round(coverage * 100)}% das palavras casaram).`,
    );
  }

  // aplica: texto da copy no lugar, inserções anexadas na vizinha
  let corrected = 0;
  let added = 0;
  let k = 0;
  const out = blocks.map((blk) => ({
    ...blk,
    words: blk.words.map((wd) => {
      const idx = k++;
      let text = wd.text;
      const mj = matchOf[idx];
      if (mj >= 0 && copy[mj] !== text) {
        text = copy[mj];
        corrected++;
      }
      const ins = insertAfter.get(idx);
      if (ins && ins.length) {
        text = `${text} ${ins.join(' ')}`;
        added += ins.length;
      }
      return text === wd.text ? wd : { ...wd, text };
    }),
  }));

  return { blocks: out, corrected, added, coverage };
}
