/**
 * Decupagem por Copy — matcher PURO (sem rede, sem browser).
 *
 * Extraido de app/api/decupagem-copy/match/route.ts pra ser testavel
 * isoladamente. A route so faz transcricao + chama matchCopyWindowed.
 *
 * REGRAS CRITICAS (testadas em lib/decupagem-matcher.test.ts):
 *   1. JAMAIS retorna take incompleto (frase cortada mid-fala).
 *   2. Se o expert fala a MESMA frase 10x, sobrevive APENAS 1 take
 *      (o de maior qualidade). Nunca duplica.
 *   3. Ordem da copy preservada cronologicamente.
 *   4. Margem pra nao cortar letra inicial/final.
 *   5. Frases distintas da copy NUNCA sao fundidas por engano.
 */

// Margem pra cobrir erro de timestamp do Whisper sem invadir take adjacente.
export const MARGIN_MS = 120;
export const TOP_K_PER_PHRASE = 6;
export const MIN_SCORE_TO_KEEP = 0.45;
// TOL no DP — 0 = nao permite nenhum overlap entre takes escolhidas.
export const DP_TOL_MS = 0;

export type Word = {
  text: string;
  start: number;
  end: number;
  confidence?: number;
};

export type Candidate = {
  startIdx: number;
  endIdx: number;
  startMs: number;
  endMs: number;
  text: string;
  score: number;
  recall: number;
  precision: number;
  lcsRatio: number;
};

export type Cut = {
  startMs: number;
  endMs: number;
  copyPhrase: string;
  transcriptText: string;
  score: number;
  recall: number;
  precision: number;
};

const FILLERS = new Set([
  'uh', 'ah', 'eh', 'oh', 'hum', 'tipo', 'entao', 'sabe', 'aham', 'ne',
  'pois', 'aaa', 'eee', 'uuu', 'ahh', 'ehh',
]);

// =================== Tokenizacao + utils ================================

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Stemmer leve pra portugues. Reduz conjugacoes/plurais a uma forma
 * comum. Conservador — so corta sufixos quando a palavra tem >=5 chars.
 */
export function stem(word: string): string {
  if (word.length < 5) return word;
  let s = word;

  const verbSuffixes = [
    'andose', 'endose', 'indose', 'arseme', 'erseme', 'irseme',
    'aramos', 'eramos', 'iramos', 'assemos', 'essemos', 'issemos',
    'aremos', 'eremos', 'iremos', 'avamos', 'iamos',
    'aram', 'eram', 'iram', 'ando', 'endo', 'indo',
    'asse', 'esse', 'isse', 'aria', 'eria', 'iria',
    'amos', 'emos', 'imos', 'avam', 'iam',
    'ado', 'ido', 'ada', 'ida', 'ava', 'ia',
    'ar', 'er', 'ir', 'ou', 'ei', 'ai',
  ];
  for (const suf of verbSuffixes) {
    if (s.length - suf.length >= 3 && s.endsWith(suf)) {
      s = s.slice(0, -suf.length);
      break;
    }
  }

  if (s.length > 4) {
    if (s.endsWith('oes') || s.endsWith('aes') || s.endsWith('ais')) {
      s = s.slice(0, -3) + (s.endsWith('oes') ? 'ao' : 'al');
    } else if (s.endsWith('es') && s.length > 4) {
      s = s.slice(0, -2);
    } else if (s.endsWith('s') && s.length > 4) {
      s = s.slice(0, -1);
    }
  }

  if (s.length > 4 && /[ao]$/.test(s)) {
    s = s.slice(0, -1);
  }

  return s;
}

export function tokenize(text: string): string[] {
  return normalize(text).split(' ').filter((w) => w.length > 0);
}

export function stemTokens(text: string): string[] {
  return tokenize(text).map(stem);
}

function getWindowRatios(targetLen: number): { min: number; max: number } {
  if (targetLen <= 4) return { min: 0.5, max: 2.0 };
  if (targetLen <= 8) return { min: 0.6, max: 1.6 };
  if (targetLen <= 15) return { min: 0.7, max: 1.4 };
  if (targetLen <= 25) return { min: 0.8, max: 1.3 };
  return { min: 0.85, max: 1.2 };
}

export function splitIntoPhrases(copy: string): string[] {
  return copy
    .split(/[.!?\n]+|…/)
    .map((p) => p.trim())
    .filter((p) => p.length > 2);
}

// =================== Window matching ====================================

export function lcsLength(a: string[], b: string[]): number {
  const n = a.length;
  const m = b.length;
  if (n === 0 || m === 0) return 0;
  const dp: number[] = new Array(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    let prev = 0;
    for (let j = 1; j <= m; j++) {
      const tmp = dp[j];
      if (a[i - 1] === b[j - 1]) {
        dp[j] = prev + 1;
      } else {
        dp[j] = Math.max(dp[j], dp[j - 1]);
      }
      prev = tmp;
    }
  }
  return dp[m];
}

/**
 * Top-K windows no transcript que melhor casam com targetStems.
 * Janela com size entre ratios.min e ratios.max do target em palavras —
 * takes incompletas (poucas palavras) caem fora da janela valida e sao
 * automaticamente rejeitadas.
 */
export function findTopWindows(
  targetStems: string[],
  words: Word[],
  transcriptStems: string[],
  topK: number,
): Candidate[] {
  const targetLen = targetStems.length;
  const targetSet = new Set(targetStems);
  const ratios = getWindowRatios(targetLen);
  const minSize = Math.max(2, Math.floor(targetLen * ratios.min));
  const maxSize = Math.ceil(targetLen * ratios.max);

  const candidates: Candidate[] = [];

  for (let start = 0; start < transcriptStems.length; start++) {
    const lookAhead = transcriptStems.slice(start, start + 5);
    const overlap = lookAhead.filter((t) => targetSet.has(t)).length;
    if (overlap < 1) continue;

    for (let size = minSize; size <= maxSize; size++) {
      if (start + size > transcriptStems.length) break;
      const window = transcriptStems.slice(start, start + size);
      const wordSlice = words.slice(start, start + size);

      const windowSet = new Set(window);
      let intersect = 0;
      for (const t of targetSet) if (windowSet.has(t)) intersect++;
      const recall = intersect / targetLen;
      const precision = intersect / size;

      if (recall < 0.55) continue;

      const lcs = lcsLength(targetStems, window);
      const lcsRatio = lcs / Math.max(targetLen, size);

      const fillers = window.filter((t) => FILLERS.has(t)).length;
      const noFillers = 1 - fillers / size;

      const durs = wordSlice.map((w) => w.end - w.start);
      const meanDur = durs.reduce((a, b) => a + b, 0) / durs.length || 1;
      const variance =
        durs.reduce((a, b) => a + (b - meanDur) ** 2, 0) / durs.length;
      const cv = Math.sqrt(variance) / meanDur;
      const cadence = Math.max(0, Math.min(1, 1 - cv));

      const hasConf = wordSlice.some((w) => typeof w.confidence === 'number');
      let confidence = 0.7;
      if (hasConf) {
        const cs = wordSlice.map((w) => w.confidence ?? 0.7);
        confidence = cs.reduce((a, b) => a + b, 0) / cs.length;
      } else {
        confidence = cadence;
      }

      const score =
        lcsRatio * 0.45 +
        recall * 0.25 +
        precision * 0.1 +
        confidence * 0.1 +
        noFillers * 0.05 +
        cadence * 0.05;

      if (score < MIN_SCORE_TO_KEEP) continue;

      candidates.push({
        startIdx: start,
        endIdx: start + size - 1,
        startMs: wordSlice[0].start,
        endMs: wordSlice[wordSlice.length - 1].end,
        text: wordSlice.map((w) => w.text).join(' '),
        score,
        recall,
        precision,
        lcsRatio,
      });
    }
  }

  // Tiebreak: empate (<2%) -> take MAIS TARDIA (expert refaz ate acertar,
  // ultima costuma ser a boa; a primeira costuma ter hesitacao).
  candidates.sort((a, b) => {
    if (Math.abs(a.score - b.score) < 0.02) return b.startMs - a.startMs;
    return b.score - a.score;
  });

  const dedup: Candidate[] = [];
  for (const c of candidates) {
    const overlapsWithBetter = dedup.some((d) => {
      const overlapStart = Math.max(c.startIdx, d.startIdx);
      const overlapEnd = Math.min(c.endIdx, d.endIdx);
      const ov = Math.max(0, overlapEnd - overlapStart + 1);
      const cLen = c.endIdx - c.startIdx + 1;
      return ov / cLen > 0.5;
    });
    if (!overlapsWithBetter) dedup.push(c);
    if (dedup.length >= topK) break;
  }

  return dedup;
}

// =================== DP cronologico com skip permitido =================

export function dpAssignWithSkip(
  candidatesPerPhrase: Candidate[][],
): Array<Candidate | null> {
  const N = candidatesPerPhrase.length;
  if (N === 0) return [];

  const SKIP_PENALTY = 0.5;
  const TOL = DP_TOL_MS;

  type PrevRef = { phraseIdx: number; candIdx: number };
  const dp: number[][] = [];
  const prev: (PrevRef | null)[][] = [];

  for (let i = 0; i < N; i++) {
    const cands = candidatesPerPhrase[i];
    dp.push(new Array(cands.length + 1).fill(-Infinity));
    prev.push(new Array<PrevRef | null>(cands.length + 1).fill(null));
  }

  for (let j = 0; j < candidatesPerPhrase[0].length; j++) {
    dp[0][j] = candidatesPerPhrase[0][j].score;
  }
  dp[0][candidatesPerPhrase[0].length] = -SKIP_PENALTY;

  for (let i = 1; i < N; i++) {
    const cur = candidatesPerPhrase[i];

    for (let j = 0; j <= cur.length; j++) {
      let bestScore = -Infinity;
      let bestPrev: PrevRef | null = null;

      for (
        let prevPhraseIdx = i - 1;
        prevPhraseIdx >= Math.max(0, i - 5);
        prevPhraseIdx--
      ) {
        const prevCands = candidatesPerPhrase[prevPhraseIdx];
        for (let k = 0; k <= prevCands.length; k++) {
          if (dp[prevPhraseIdx][k] === -Infinity) continue;

          if (k < prevCands.length && j < cur.length) {
            if (prevCands[k].endMs > cur[j].startMs + TOL) continue;
          }

          const skipsBetween = i - 1 - prevPhraseIdx;
          const skipPenalty = skipsBetween * SKIP_PENALTY;

          const currentScore =
            j < cur.length ? cur[j].score : -SKIP_PENALTY;
          const totalScore =
            dp[prevPhraseIdx][k] + currentScore - skipPenalty;

          if (totalScore > bestScore) {
            bestScore = totalScore;
            bestPrev = { phraseIdx: prevPhraseIdx, candIdx: k };
          }
        }
      }

      if (bestPrev) {
        dp[i][j] = bestScore;
        prev[i][j] = bestPrev;
      }
    }
  }

  let bestEnd = -Infinity;
  let bestEndJ = -1;
  for (let j = 0; j <= candidatesPerPhrase[N - 1].length; j++) {
    if (dp[N - 1][j] > bestEnd) {
      bestEnd = dp[N - 1][j];
      bestEndJ = j;
    }
  }

  const result: Array<Candidate | null> = new Array(N).fill(null);
  if (bestEndJ < 0) return result;

  let curPhrase = N - 1;
  let curCand = bestEndJ;
  while (curPhrase >= 0) {
    const cands = candidatesPerPhrase[curPhrase];
    if (curCand < cands.length) {
      result[curPhrase] = cands[curCand];
    }
    const p = prev[curPhrase][curCand];
    if (!p) break;
    curPhrase = p.phraseIdx;
    curCand = p.candIdx;
  }

  return result;
}

// =================== Dedup global ======================================

/**
 * Similaridade textual entre dois trechos (stems, overlap normalizado
 * pelo menor — pega "frase X" dentro de "frase X mais coisa").
 */
export function textSimilarity(a: string, b: string): number {
  const sa = new Set(tokenize(a).map(stem));
  const sb = new Set(tokenize(b).map(stem));
  if (sa.size === 0 || sb.size === 0) return 0;
  let intersect = 0;
  for (const t of sa) if (sb.has(t)) intersect++;
  return intersect / Math.min(sa.size, sb.size);
}

/**
 * Dedup GLOBAL de takes repetidas.
 *
 * Regra dura: se o expert fala a MESMA frase 10x, so 1 sobrevive — MAS
 * duas linhas DISTINTAS da copy (mesmo que parecidas) NUNCA somem.
 *
 * Dois cortes sao a mesma take repetida sse:
 *   - overlap temporal real (mesmo pedaco de video); OU
 *   - mesma frase da copy (normalizada) E transcript sim >= 0.5.
 * Mantem APENAS o de maior score (substitui in-place pra preservar
 * a posicao na ordem da copy).
 */
export function dedupCutsGlobal(cuts: Cut[]): Cut[] {
  if (cuts.length <= 1) return cuts;

  const kept: Cut[] = [];
  for (const cur of cuts) {
    const curPhrase = normalize(cur.copyPhrase);
    let dupIdx = -1;

    for (let i = 0; i < kept.length; i++) {
      const k = kept[i];
      const sim = textSimilarity(cur.transcriptText, k.transcriptText);
      const samePhrase = curPhrase === normalize(k.copyPhrase);
      const timeOverlap =
        !(cur.endMs <= k.startMs || cur.startMs >= k.endMs);

      // So funde se for LITERALMENTE o mesmo pedaco de video, ou se a
      // copy repete a propria linha e o expert refez. NUNCA funde duas
      // linhas DISTINTAS da copy so por serem textualmente parecidas
      // ("ganhar rapido" vs "ganhar facil" sobrevivem as duas).
      const isDuplicate = timeOverlap || (samePhrase && sim >= 0.5);

      if (isDuplicate) {
        dupIdx = i;
        break;
      }
    }

    if (dupIdx >= 0) {
      if (cur.score > kept[dupIdx].score) kept[dupIdx] = cur;
    } else {
      kept.push(cur);
    }
  }

  kept.sort((a, b) => a.startMs - b.startMs);
  return kept;
}

/**
 * Garante que cuts consecutivos NAO se sobrepoem temporalmente.
 */
export function enforceNoTimeOverlap(cuts: Cut[]): Cut[] {
  const result: Cut[] = [];
  for (let i = 0; i < cuts.length; i++) {
    const c = { ...cuts[i] };
    if (i > 0) {
      const prev = result[result.length - 1];
      if (c.startMs < prev.endMs) {
        const mid = Math.floor((prev.endMs + c.startMs) / 2);
        prev.endMs = mid - 25;
        c.startMs = mid + 25;
      }
    }
    if (c.endMs > c.startMs + 100) {
      result.push(c);
    }
  }
  return result;
}

// =================== Pipeline principal =================================

export function matchCopyWindowed(copy: string, words: Word[]): Cut[] {
  if (words.length === 0) return [];
  const phrases = splitIntoPhrases(copy);
  const transcriptStems = words.map((w) => {
    const t = tokenize(w.text)[0] ?? '';
    return stem(t);
  });

  const candidatesPerPhrase: Candidate[][] = phrases.map((phrase) => {
    const targetStems = stemTokens(phrase);
    if (targetStems.length < 2) return [];
    return findTopWindows(
      targetStems,
      words,
      transcriptStems,
      TOP_K_PER_PHRASE,
    );
  });

  const optimal = dpAssignWithSkip(candidatesPerPhrase);

  const rawCuts: Cut[] = [];
  for (let i = 0; i < phrases.length; i++) {
    const cand = optimal[i];
    if (!cand) continue;
    rawCuts.push({
      startMs: Math.max(0, cand.startMs - MARGIN_MS),
      endMs: cand.endMs + MARGIN_MS,
      copyPhrase: phrases[i],
      transcriptText: cand.text,
      score: cand.score,
      recall: cand.recall,
      precision: cand.precision,
    });
  }

  const dedupedCuts = dedupCutsGlobal(rawCuts);
  const finalCuts = enforceNoTimeOverlap(dedupedCuts);

  return finalCuts;
}
