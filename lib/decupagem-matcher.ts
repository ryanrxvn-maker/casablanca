/**
 * Decupagem por Copy — matcher PURO (sem rede, sem browser).
 *
 * Extraido de app/api/decupagem-copy/match/route.ts pra ser testavel
 * isoladamente. A route so faz transcricao + chama matchCopyWindowed.
 *
 * MODELO MENTAL (o que um editor profissional faz):
 *   O bruto e' cheio de RETAKES — o expert fala a mesma ideia varias vezes,
 *   melhorando ate acertar, e IMPROVISA (mesma ideia, palavras diferentes).
 *   A copy e' o roteiro IDEALIZADO. Pra cada linha da copy, o editor acha a
 *   take em que o expert disse a ideia COMPLETA e limpa, e corta nas PAUSAS
 *   ao redor dela (no silencio) — nunca no meio de uma palavra/fala.
 *
 *   A unidade de edicao e' a FALA COMPLETA entre pausas, nao uma janela
 *   arbitraria de palavras. Por isso:
 *     - a janela so vale se cobre o INICIO e o FIM da ideia da copy
 *       (head/tail coverage) — senao e' take cortada;
 *     - janela que comeca/termina numa PAUSA real ganha bonus (fala inteira);
 *     - o corte e' "snapado" pro meio do silencio adjacente — zero vazamento,
 *       zero corte de silaba.
 *
 * REGRAS CRITICAS (testadas em lib/decupagem-matcher.test.ts):
 *   1. JAMAIS retorna take incompleta (frase cortada mid-fala).
 *   2. Se o expert fala a MESMA frase 10x, sobrevive APENAS 1 take
 *      (o de maior qualidade). Nunca duplica.
 *   3. Ordem da copy preservada cronologicamente.
 *   4. Corte cai no silencio — nao corta letra inicial/final, nao vaza vizinho.
 *   5. Frases distintas da copy NUNCA sao fundidas por engano.
 */

// Margem MAXIMA de silencio em volta do corte. O corte real cai no meio da
// pausa detectada (min(MARGIN, gap/2)), entao nunca invade a fala vizinha.
export const MARGIN_MS = 120;
export const TOP_K_PER_PHRASE = 6;
export const MIN_SCORE_TO_KEEP = 0.45;
// TOL no DP — 0 = nao permite nenhum overlap entre takes escolhidas.
export const DP_TOL_MS = 0;
// Pausa (ms) que marca fronteira de fala/take. Acima disso, o expert pausou
// de proposito (fim de frase ou inicio de retake). Pausas de virgula
// (~150-250ms) ficam ABAIXO, entao nao quebram uma frase no meio.
export const GAP_MS = 300;

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

// Stopwords (formas curtas ja sao iguais pos-stem). Usadas pra escolher as
// palavras-CONCEITO da copy (head/tail) — ignorar "de/que/uma/com" e focar no
// que realmente identifica o fim da ideia ("consultorio", "2020", "ozempic").
const STOP = new Set([
  'de', 'da', 'do', 'das', 'dos', 'que', 'e', 'o', 'a', 'os', 'as', 'um',
  'uma', 'uns', 'umas', 'com', 'sem', 'para', 'pra', 'por', 'em', 'no', 'na',
  'nos', 'nas', 'se', 'tu', 'voce', 'vc', 'eu', 'ele', 'ela', 'isso', 'isto',
  'esse', 'essa', 'este', 'esta', 'mais', 'menos', 'ja', 'ao', 'aos', 'la',
  'meu', 'minha', 'seu', 'sua', 'tao', 'ou', 'mas', 'ne', 'ai', 'aqui', 'ali',
  'te', 'me', 'lhe', 'nao', 'sim', 'foi', 'era', 'sao', 'tem', 'vai', 'vou',
]);

function isContent(s: string): boolean {
  return s.length >= 3 && !STOP.has(s);
}

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

/**
 * Distancia de edicao (Levenshtein) com teto. Para fuzzy match de palavras —
 * nomes de marca/ASR variam ("mounjaro" vs "monjaro", "desinchava" vs
 * "desinchavam"). Cap em `max+1` (early-exit barato).
 */
function levenshtein(a: string, b: string, max: number): number {
  const n = a.length;
  const m = b.length;
  if (Math.abs(n - m) > max) return max + 1;
  let prev = new Array(m + 1);
  let cur = new Array(m + 1);
  for (let j = 0; j <= m; j++) prev[j] = j;
  for (let i = 1; i <= n; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    [prev, cur] = [cur, prev];
  }
  return prev[m];
}

/**
 * Igualdade fuzzy entre dois stems. Tolera variacao de marca/ASR/conjugacao
 * que o stemmer leve nao pega. Conservador o suficiente pra nao confundir
 * palavras distintas ("rapido" vs "facil" continuam diferentes).
 */
export function fuzzyEq(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 4 || b.length < 4) return false;
  // Prefixo compartilhado >= 4 chars (mesma raiz).
  let p = 0;
  const mm = Math.min(a.length, b.length);
  while (p < mm && a[p] === b[p]) p++;
  if (p >= 4 && Math.abs(a.length - b.length) <= 3) return true;
  // Levenshtein curto.
  const maxLen = Math.max(a.length, b.length);
  const tol = maxLen >= 7 ? 2 : 1;
  return levenshtein(a, b, tol) <= tol;
}

/** Verdadeiro se `target` aparece (fuzzy) em algum dos `pool` stems. */
function inPoolFuzzy(target: string, poolSet: Set<string>, pool: string[]): boolean {
  if (poolSet.has(target)) return true;
  for (const w of pool) if (fuzzyEq(target, w)) return true;
  return false;
}

function getWindowRatios(targetLen: number): { min: number; max: number } {
  if (targetLen <= 4) return { min: 0.5, max: 2.2 };
  if (targetLen <= 8) return { min: 0.55, max: 1.8 };
  if (targetLen <= 15) return { min: 0.6, max: 1.6 };
  if (targetLen <= 25) return { min: 0.7, max: 1.45 };
  return { min: 0.8, max: 1.3 };
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
 * Pausa (ms) DEPOIS da palavra i. gaps[n-1] = Infinity (fim do video conta
 * como fronteira). Usado pra detectar fim/inicio de fala e snapar o corte.
 */
export function computeGaps(words: Word[]): number[] {
  return words.map((w, i) =>
    i + 1 < words.length ? Math.max(0, words[i + 1].start - w.end) : Infinity,
  );
}

/**
 * Top-K janelas no transcript que melhor casam com targetStems, modelando a
 * janela como uma FALA COMPLETA entre pausas.
 *
 * Regras de qualidade embutidas:
 *   - head/tail coverage: a janela tem que cobrir o INICIO e o FIM da ideia da
 *     copy (com fuzzy match). Take cortada (sem o fim) e' fortemente penalizada
 *     e, se nao terminar numa pausa, e' rejeitada.
 *   - boundary bonus: janela que comeca E termina numa pausa real (>= GAP_MS)
 *     e' uma fala inteira → bonus.
 *   - corte snapado: startMs/endMs caem no MEIO do silencio adjacente
 *     (min(MARGIN, gap/2)) → nunca corta silaba nem vaza a fala vizinha.
 *
 * `relaxed` desliga as travas de head/boundary (passe de fallback) pra
 * garantir que uma linha matchavel NUNCA suma silenciosamente.
 */
export function findTopWindows(
  targetStems: string[],
  words: Word[],
  transcriptStems: string[],
  gaps: number[],
  topK: number,
  relaxed = false,
): Candidate[] {
  const targetLen = targetStems.length;
  if (targetLen < 2 || transcriptStems.length === 0) return [];

  const targetSet = new Set(targetStems);
  // Palavras-conceito (sem stopword). Fallback pro target inteiro quando a
  // frase e' so de palavras curtas ("por que").
  const content = targetStems.filter(isContent);
  const eff = content.length >= 2 ? content : targetStems;
  const headStems = eff.slice(0, 3);
  const tailStems = eff.slice(-3);

  const ratios = getWindowRatios(targetLen);
  const minSize = Math.max(2, Math.floor(targetLen * ratios.min));
  // Teto generoso: o expert improvisa MAIS longo que a copy, e a take completa
  // precisa caber na janela pra ser alcancada.
  const maxSize = Math.min(
    transcriptStems.length,
    Math.ceil(targetLen * ratios.max) + 8,
  );

  const candidates: Candidate[] = [];

  for (let start = 0; start < transcriptStems.length; start++) {
    const startsAtBoundary = start === 0 || gaps[start - 1] >= GAP_MS;

    // A janela tem que COMECAR onde a ideia comeca: uma das palavras-cabeca
    // da copy aparece nas primeiras palavras. (relaxed: ignora.)
    if (!relaxed) {
      const headWin = transcriptStems.slice(start, start + 4);
      const headWinSet = new Set(headWin);
      const headHit = headStems.some((h) =>
        inPoolFuzzy(h, headWinSet, headWin),
      );
      if (!headHit) continue;
    } else {
      // No passe relaxado, exige so 1 palavra do target nas proximas 5.
      const look = transcriptStems.slice(start, start + 5);
      if (!look.some((t) => targetSet.has(t))) continue;
    }

    for (let size = minSize; size <= maxSize; size++) {
      const end = start + size - 1;
      if (end >= transcriptStems.length) break;

      const endsAtBoundary = gaps[end] >= GAP_MS; // gaps[last] = Infinity
      const window = transcriptStems.slice(start, end + 1);
      const wordSlice = words.slice(start, end + 1);
      const windowSet = new Set(window);

      let intersect = 0;
      for (const t of targetSet) if (windowSet.has(t)) intersect++;
      const recall = intersect / targetLen;
      const precision = intersect / size;
      if (recall < (relaxed ? 0.5 : 0.55)) continue;

      // Cobertura de FIM e INICIO (fuzzy), checando nas pontas da janela.
      const headPool = window.slice(0, 5);
      const tailPool = window.slice(-5);
      const headPoolSet = new Set(headPool);
      const tailPoolSet = new Set(tailPool);
      const headCov =
        headStems.length === 0
          ? 1
          : headStems.filter((t) => inPoolFuzzy(t, headPoolSet, headPool))
              .length / headStems.length;
      const tailCov =
        tailStems.length === 0
          ? 1
          : tailStems.filter((t) => inPoolFuzzy(t, tailPoolSet, tailPool))
              .length / tailStems.length;

      // REJEICAO DURA de take cortada: nao termina numa pausa E nao alcancou o
      // fim da ideia → e' fala interrompida no meio. Fora. (relaxed pula.)
      if (!relaxed && !endsAtBoundary && tailCov < 0.5) continue;

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
      let confidence: number;
      if (hasConf) {
        const cs = wordSlice.map((w) => w.confidence ?? 0.7);
        confidence = cs.reduce((a, b) => a + b, 0) / cs.length;
      } else {
        confidence = cadence;
      }

      const boundary = (startsAtBoundary ? 0.5 : 0) + (endsAtBoundary ? 0.5 : 0);

      // Tail-coverage e boundary DOMINAM: garantem fala completa que termina no
      // ponto certo. LCS/recall garantem que e' a ideia certa, na ordem certa.
      const score =
        tailCov * 0.30 +
        headCov * 0.12 +
        lcsRatio * 0.18 +
        recall * 0.13 +
        boundary * 0.12 +
        precision * 0.05 +
        confidence * 0.05 +
        noFillers * 0.03 +
        cadence * 0.02;

      if (score < MIN_SCORE_TO_KEEP) continue;

      // ---- Snap do corte pro meio do silencio adjacente -------------------
      const gapBefore = start === 0 ? Infinity : gaps[start - 1];
      const gapAfter = gaps[end];
      const padBefore = Math.min(MARGIN_MS, Math.max(0, gapBefore / 2));
      const padAfter = Math.min(MARGIN_MS, Math.max(0, gapAfter / 2));
      const startMs = Math.max(0, wordSlice[0].start - padBefore);
      const endMs = wordSlice[wordSlice.length - 1].end + padAfter;

      candidates.push({
        startIdx: start,
        endIdx: end,
        startMs,
        endMs,
        text: wordSlice.map((w) => w.text).join(' '),
        score,
        recall,
        precision,
        lcsRatio,
      });
    }
  }

  // Tiebreak: empate (<2%) -> take MAIS TARDIA (expert refaz ate acertar, a
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
  const gaps = computeGaps(words);
  const transcriptStems = words.map((w) => {
    const t = tokenize(w.text)[0] ?? '';
    return stem(t);
  });

  const candidatesPerPhrase: Candidate[][] = phrases.map((phrase) => {
    const targetStems = stemTokens(phrase);
    if (targetStems.length < 2) return [];
    let cands = findTopWindows(
      targetStems,
      words,
      transcriptStems,
      gaps,
      TOP_K_PER_PHRASE,
      false,
    );
    // Fallback: nenhuma janela "limpa" passou — tenta relaxado pra nunca
    // sumir uma linha que existe no bruto (so com palavras improvisadas).
    if (cands.length === 0) {
      cands = findTopWindows(
        targetStems,
        words,
        transcriptStems,
        gaps,
        TOP_K_PER_PHRASE,
        true,
      );
    }
    return cands;
  });

  const optimal = dpAssignWithSkip(candidatesPerPhrase);

  const rawCuts: Cut[] = [];
  for (let i = 0; i < phrases.length; i++) {
    const cand = optimal[i];
    if (!cand) continue;
    // startMs/endMs ja vem snapados pro meio do silencio adjacente.
    rawCuts.push({
      startMs: cand.startMs,
      endMs: cand.endMs,
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
