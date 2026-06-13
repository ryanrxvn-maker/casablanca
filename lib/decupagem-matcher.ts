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
// Pausa LONGA — fronteira clara de retake (o expert parou e recomecou). Janela
// que contem uma dessas no meio esta fundindo duas takes distintas.
export const HARD_GAP_MS = 500;
// BURACO — gap interno tao grande que so existe porque o ASR COLAPSOU uma
// retake repetida em 1 ocorrencia no texto, mas os timestamps abracam as duas.
// Janela com buraco = duplicacao INVISIVEL no texto (so audivel). Rejeitar.
export const HOLE_GAP_MS = 1100;
// Densidade minima de fala (soma das duracoes das palavras / span da janela).
// Abaixo disso ha silencio/colapso demais dentro do corte (varios buracos).
export const MIN_SPEECH_DENSITY = 0.5;

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
  // Confianca MEDIA do ASR nas palavras do corte (0..1), so quando o provider
  // entrega confidence por palavra (AssemblyAI). undefined = sem dado real.
  confidence?: number;
  // De qual passe veio: 'strict' (take limpa), 'relaxed' (improvisada) ou
  // 'desperate' (sem take limpa — provavelmente imperfeito, merece revisao).
  pass?: 'strict' | 'relaxed' | 'desperate';
};

export type Cut = {
  startMs: number;
  endMs: number;
  copyPhrase: string;
  transcriptText: string;
  score: number;
  recall: number;
  precision: number;
  // Confianca do ASR no trecho (0..1). undefined quando o provider nao da.
  confidence?: number;
  // Procedencia do match (ver Candidate.pass). 'desperate' = revisar.
  pass?: 'strict' | 'relaxed' | 'desperate';
  // Outras takes candidatas da MESMA frase (ranqueadas), pro auto-retry trocar
  // quando a auditoria reprova este corte. Leves: so tempo + texto.
  alts?: Array<{ startMs: number; endMs: number; text: string }>;
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
  'ate', 'ainda', 'tambem', 'assim', 'entao', 'sera', 'ser', 'ter', 'como',
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

// =================== Vocab hints (viés de transcrição) ==================

// Palavras comuns que iniciam frase em PT — capitalizadas mas NAO sao nome
// proprio. Filtradas pra nao virar "boost" inutil.
const SENT_START = new Set([
  'entao', 'porque', 'porem', 'quando', 'clique', 'clica', 'mesmo', 'sem',
  'para', 'voce', 'isso', 'isto', 'como', 'aqui', 'tem', 'mas', 'essa',
  'esse', 'cada', 'eu', 'meu', 'minha', 'então', 'porquê', 'você', 'ah',
  'sera', 'será', 'agora', 'depois', 'antes', 'todo', 'toda', 'uma', 'que',
  'por', 'com', 'tudo', 'basta', 'assim', 'então', 'resultado', 'pernas',
]);

// Termos de DOMINIO/marca que o ASR erra muito em audio comprimido. Boostados
// mesmo em minuscula. (Lista vive aqui pra ser facil de estender por nicho.)
const DOMAIN_TERMS =
  /\b(lipedema|linf[aá]ticas?|ozempic|mounjaro|monjaro|tirzepatida|semaglutida|retatrutida|retratutida|intermitente|anti-?inflamat[oó]rias?|drenagem|celulites?|fisiculturista|nutricionista)\b/giu;

/**
 * Extrai termos da COPY pra usar como dica de vocabulario na transcricao
 * (Whisper `prompt` / AssemblyAI `word_boost`). Pega nomes proprios
 * (capitalizados no meio da frase, ex: "Mounjaro", "Ozempic", "Matheus") e
 * termos de dominio conhecidos. Resolve o erro de marca ("Manjaro") sem
 * induzir alucinacao (lista enxuta, sem frases inteiras).
 */
export function extractVocabHints(copy: string): string[] {
  const hints = new Map<string, string>(); // chave minuscula -> forma original
  const add = (w: string) => {
    const clean = w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}-]+$/gu, '');
    if (clean.length < 4) return;
    const key = clean.toLowerCase();
    if (!hints.has(key)) hints.set(key, clean);
  };

  // 1) Nomes proprios: tokens capitalizados (len>=4) que nao sao so inicio de
  //    frase comum em PT.
  for (const raw of copy.split(/\s+/)) {
    const clean = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}-]+$/gu, '');
    if (clean.length < 4) continue;
    if (!/^[A-ZÀ-Ý]/u.test(clean)) continue;
    if (SENT_START.has(clean.toLowerCase())) continue;
    add(clean);
  }

  // 2) Termos de dominio/marca conhecidos (mesmo minusculos).
  for (const m of copy.matchAll(DOMAIN_TERMS)) add(m[0]);

  return Array.from(hints.values()).slice(0, 40);
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
  // Passe "desesperado": estrito e relaxado nao acharam NADA, entao desliga os
  // guards de buraco/densidade/duracao (mantem anti-duplicacao de TEXTO) pra
  // nunca sumir uma linha em silencio — o pior candidato vem flagado no audit.
  desperate = false,
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
  // A ULTIMA palavra-conceito e' a ancora de "a ideia terminou aqui". Se ela
  // falta, a take quase certamente foi cortada no fim (erro #6).
  const lastStem = eff.length ? eff[eff.length - 1] : '';

  // Quantas stopwords a copy tem ANTES da 1a palavra-conceito e DEPOIS da
  // ultima — usado pra estender o corte sobre esses conectivos (FIX-2),
  // pro video comecar/terminar numa palavra INTEIRA ("Tem mulher...", "E ai
  // comeca...", "E por isso que voce faz..."), nao no meio da fala.
  const firstContentIdx = targetStems.findIndex(isContent);
  let lastContentIdx = -1;
  for (let i = targetStems.length - 1; i >= 0; i--) {
    if (isContent(targetStems[i])) { lastContentIdx = i; break; }
  }
  const headLead = firstContentIdx < 0 ? 0 : firstContentIdx;
  const tailTrail =
    lastContentIdx < 0 ? 0 : targetStems.length - 1 - lastContentIdx;

  // Quantas vezes a copy espera CADA palavra-conceito. Se a janela repete uma
  // que a copy so pede 1x, e' retake REFORMULADO vazando (FIX-1b) — o sinal
  // que nao depende de pausa nem de grafia identica (#3/#6/#12/#15/#25).
  const targetContentCount = new Map<string, number>();
  for (const t of targetStems) {
    if (isContent(t)) targetContentCount.set(t, (targetContentCount.get(t) ?? 0) + 1);
  }

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
    if (!relaxed && !desperate) {
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

      // ===== FIX-1: anti-fusao DURA (vale no passe estrito E no relaxado) ====
      // (a) Bigrama de palavras-CONCEITO repetido = a janela atravessou um
      //     retake (o expert repetiu "desse resultado", "mostrando exatamente"
      //     etc). Rejeita — nunca funde duas takes (erros #24/#25).
      const contentSeq = window.filter(isContent);
      let repeatedBigram = false;
      const seenBg = new Set<string>();
      for (let b = 0; b + 1 < contentSeq.length; b++) {
        const bg = contentSeq[b] + '' + contentSeq[b + 1];
        if (seenBg.has(bg)) { repeatedBigram = true; break; }
        seenBg.add(bg);
      }
      if (repeatedBigram) continue;
      const winDurMs = wordSlice[wordSlice.length - 1].end - wordSlice[0].start;
      if (!desperate) {
        // (a2) FIX-1b: palavra-CONCEITO repetida que a copy so pede 1x =
        //     retake reformulado vazou (o expert refez com palavras diferentes,
        //     mas as ancoras "dieta/academia/pernas" se repetem). Pega o que o
        //     bigrama nao pega (reformulacao) e o que o buraco nao pega (restart
        //     rapido sem pausa). Rejeita.
        const winContentCount = new Map<string, number>();
        let unigramOverflow = false;
        for (const s of contentSeq) {
          const c = (winContentCount.get(s) ?? 0) + 1;
          winContentCount.set(s, c);
          if (c >= 2 && (targetContentCount.get(s) ?? 0) <= 1) {
            unigramOverflow = true;
            break;
          }
        }
        if (unigramOverflow) continue;

        // (b) Teto de duracao: take unica improvisada e' generosa, mas o DOBRO
        //     (duas takes coladas) estoura. Backstop pra fusoes sem bigrama.
        if (winDurMs > targetLen * 950 + 4000) continue;
        // (b) Teto de duracao: take unica improvisada e' generosa, mas o DOBRO
        //     (duas takes coladas) estoura. Backstop pra fusoes sem bigrama.
        if (winDurMs > targetLen * 950 + 4000) continue;

        // ===== P0: rejeicao por BURACO/DENSIDADE (o ASR colapsa retake) ======
        // (c) Buraco interno >= HOLE_GAP_MS: o ASR transcreveu 1 ocorrencia mas
        //     os timestamps abracam DUAS (duplicacao invisivel no texto). Onde
        //     ele colapsou sobra um buraco de segundos entre palavras. Rejeita.
        let maxInternalGap = 0;
        for (let g = start; g < end; g++) {
          if (gaps[g] > maxInternalGap) maxInternalGap = gaps[g];
        }
        if (maxInternalGap >= HOLE_GAP_MS) continue;
        // (d) Densidade de fala: soma das duracoes / span. Baixa = silencio/
        //     colapso demais dentro do corte (varios buracos medios).
        let speechMs = 0;
        for (const w of wordSlice) speechMs += Math.max(0, w.end - w.start);
        if (winDurMs > 0 && speechMs / winDurMs < MIN_SPEECH_DENSITY) continue;
      }

      let intersect = 0;
      for (const t of targetSet) if (windowSet.has(t)) intersect++;
      const recall = intersect / targetLen;
      const precision = intersect / size;
      if (recall < (desperate ? 0.4 : relaxed ? 0.5 : 0.55)) continue;

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
      // A ultima palavra-conceito da copy esta no fim da janela? (ancora forte)
      const lastCov =
        lastStem === '' || inPoolFuzzy(lastStem, tailPoolSet, tailPool) ? 1 : 0;

      // REJEICAO DURA de take cortada: nao termina numa pausa E (nao tem a
      // palavra-fim OU mal cobre o fim da ideia) → fala interrompida. Fora.
      if (!relaxed && !desperate && !endsAtBoundary && (lastCov === 0 || tailCov < 0.5)) {
        continue;
      }

      // Janela que CRUZA uma pausa longa esta juntando DUAS takes (retake) →
      // gera duplicacao/vazamento (erro #27). Conta as fronteiras INTERNAS.
      let internalHardBreaks = 0;
      for (let g = start; g < end; g++) {
        if (gaps[g] >= HARD_GAP_MS) internalHardBreaks++;
      }
      const mergePenalty = internalHardBreaks * 0.15;

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
      let realConf: number | undefined;
      if (hasConf) {
        const cs = wordSlice.map((w) => w.confidence ?? 0.7);
        confidence = cs.reduce((a, b) => a + b, 0) / cs.length;
        realConf = confidence; // confianca REAL do ASR (pra exibir/avaliar)
      } else {
        confidence = cadence;
      }

      const boundary = (startsAtBoundary ? 0.5 : 0) + (endsAtBoundary ? 0.5 : 0);

      // Tail/last-coverage e boundary DOMINAM: garantem fala COMPLETA que
      // termina no ponto certo. LCS/recall garantem a ideia certa na ordem
      // certa. mergePenalty derruba janelas que fundem duas takes.
      const score =
        lastCov * 0.24 +
        tailCov * 0.12 +
        headCov * 0.10 +
        lcsRatio * 0.14 +
        recall * 0.11 +
        boundary * 0.12 +
        precision * 0.05 +
        confidence * 0.05 +
        noFillers * 0.03 +
        cadence * 0.02 -
        mergePenalty;

      if (score < MIN_SCORE_TO_KEEP) continue;

      // ===== FIX-2: estende sobre os conectivos de borda da copy ============
      // O matcher ancora a janela na 1a palavra-CONCEITO, clipando o "Tem"/"E
      // ai"/"E por isso que voce" inicial. Puxa de volta SO as stopwords que a
      // copy tem na borda, na MESMA respiracao (gap < GAP_MS), no maximo o
      // tanto que a copy tem (headLead/tailTrail) — nunca vaza palavra de outra
      // frase nem conteudo.
      let exStart = start;
      for (let k = 0; k < headLead && exStart > 0; k++) {
        const prev = exStart - 1;
        if (gaps[prev] >= GAP_MS) break;
        const ps = transcriptStems[prev];
        if (isContent(ps) || !targetSet.has(ps)) break;
        exStart = prev;
      }
      let exEnd = end;
      for (let k = 0; k < tailTrail && exEnd < transcriptStems.length - 1; k++) {
        if (gaps[exEnd] >= GAP_MS) break;
        const nx = transcriptStems[exEnd + 1];
        if (isContent(nx) || !targetSet.has(nx)) break;
        exEnd = exEnd + 1;
      }
      const exSlice = words.slice(exStart, exEnd + 1);

      // ---- Snap do corte pro meio do silencio adjacente -------------------
      const gapBefore = exStart === 0 ? Infinity : gaps[exStart - 1];
      const gapAfter = gaps[exEnd];
      const padBefore = Math.min(MARGIN_MS, Math.max(0, gapBefore / 2));
      const padAfter = Math.min(MARGIN_MS, Math.max(0, gapAfter / 2));
      const startMs = Math.max(0, exSlice[0].start - padBefore);
      const endMs = exSlice[exSlice.length - 1].end + padAfter;

      candidates.push({
        startIdx: exStart,
        endIdx: exEnd,
        startMs,
        endMs,
        text: exSlice.map((w) => w.text).join(' '),
        score,
        recall,
        precision,
        lcsRatio,
        confidence: realConf,
        pass: desperate ? 'desperate' : relaxed ? 'relaxed' : 'strict',
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

// =================== Auditoria pos-render (P1) ==========================

export type PhraseAudit = {
  idx: number;
  phrase: string;
  coverage: number; // fracao das palavras-conceito da copy ouvidas no resultado
  tailOk: boolean; // a ultima palavra-conceito da frase apareceu?
  duplicated: boolean; // a frase aparece 2x seguidas (retake vazou)?
  status: 'ok' | 'review' | 'fail';
};

export type AuditReport = {
  phrases: PhraseAudit[];
  okCount: number;
  reviewCount: number;
  failCount: number;
  total: number;
};

/**
 * AUDITORIA INDEPENDENTE do MP4 final (P1).
 *
 * Recebe a copy e a transcricao do RESULTADO re-transcrito SEM viés (sem
 * word_boost/prompt — a verificacao nao pode herdar a alucinacao da geracao).
 * Para cada frase da copy, confere SEQUENCIALMENTE no audio do resultado:
 *   - coverage: quantas palavras-conceito da frase foram realmente ouvidas;
 *   - tailOk:   a ultima palavra-conceito (ancora de "frase completa") veio;
 *   - duplicated: a frase aparece 2x seguidas (retake vazou no corte).
 *
 * status: fail (corte ruim/ausente — vermelho), review (suspeito — ambar),
 * ok (verde). E' EXATAMENTE a conferencia manual, automatizada.
 */
export function auditResult(copy: string, auditWords: Word[]): AuditReport {
  const phrases = splitIntoPhrases(copy);
  const auditContent: string[] = [];
  for (const w of auditWords) {
    const s = stem(tokenize(w.text)[0] ?? '');
    if (isContent(s)) auditContent.push(s);
  }

  const out: PhraseAudit[] = [];
  let cursor = 0;

  for (let i = 0; i < phrases.length; i++) {
    const phraseStart = cursor; // onde esta frase comecou a procurar
    const pc = stemTokens(phrases[i]).filter(isContent);
    if (pc.length === 0) {
      out.push({
        idx: i, phrase: phrases[i], coverage: 1, tailOk: true,
        duplicated: false, status: 'ok',
      });
      continue;
    }

    // COBERTURA POR JANELA (set-based, NAO guloso-encadeado). Desliza uma
    // janela local a partir do cursor e escolhe a posicao com maior cobertura
    // das palavras-conceito da frase. Imune a:
    //   - salto distante por fuzzy (uma palavra solta la longe nao arrasta o
    //     cursor — a janela e' local e pontuada por CLUSTER);
    //   - reordenacao (set, nao ordem) — "as suas pernas continuarem" etc.
    // Janela JUSTA (nao pode abracar 2+ frases, senao um ghost word casa
    // fuzzy com palavra de outra frase e arrasta o cursor — bug do all-red).
    const W = pc.length + 6;
    const scanLimit = Math.min(auditContent.length, cursor + W * 2 + 12);
    let bestCov = -1;
    let bestStart = cursor;
    let bestTailOk = false;
    let bestLastPos = -1;
    for (let s = cursor; s <= scanLimit; s++) {
      const winEnd = Math.min(auditContent.length, s + W);
      if (s >= winEnd) break;
      let found = 0;
      let lastPos = -1;
      let tailHit = false;
      for (let p = 0; p < pc.length; p++) {
        for (let j = s; j < winEnd; j++) {
          if (fuzzyEq(pc[p], auditContent[j])) {
            found++;
            if (j > lastPos) lastPos = j;
            if (p === pc.length - 1) tailHit = true;
            break;
          }
        }
      }
      const cov = found / pc.length;
      if (cov > bestCov) {
        bestCov = cov; bestStart = s; bestTailOk = tailHit; bestLastPos = lastPos;
      }
      if (bestCov >= 1 && bestTailOk) break;
      // achou um cluster bom — nao vagueia atras de um melhor longe (evita
      // grudar numa ocorrencia posterior/duplicada).
      if (bestCov >= 0.7 && s > bestStart + 2) break;
    }
    const coverage = bestCov < 0 ? 0 : bestCov;
    const tailOk = bestTailOk;

    // Duplicacao por EXCESSO (robusto, simetrico): na regiao da frase (a partir
    // de phraseStart, larga o bastante p/ 2 ocorrencias), quantas palavras-
    // conceito aparecem MAIS vezes do que a copy pede? Se boa parte dobra, o
    // retake vazou no corte. Imune a:
    //   - qual ocorrencia a janela de coverage travou (ancora em phraseStart);
    //   - palavra que a copy repete DE PROPOSITO (compara com o esperado).
    let duplicated = false;
    if (pc.length >= 2 && coverage >= 0.5) {
      const phraseCount = new Map<string, number>();
      for (const s of pc) phraseCount.set(s, (phraseCount.get(s) ?? 0) + 1);
      const regionEnd = Math.min(
        auditContent.length,
        phraseStart + Math.round(pc.length * 2.5) + 8,
      );
      let excess = 0;
      for (const [s, expected] of phraseCount) {
        let cnt = 0;
        for (let j = phraseStart; j < regionEnd; j++) {
          if (fuzzyEq(s, auditContent[j])) cnt++;
        }
        if (cnt > expected) excess++;
      }
      duplicated = excess >= 2 && excess / phraseCount.size >= 0.4;
    }

    let status: 'ok' | 'review' | 'fail';
    if (coverage < 0.5 || !tailOk) status = 'fail';
    else if (duplicated || coverage < 0.8) status = 'review';
    else status = 'ok';

    out.push({ idx: i, phrase: phrases[i], coverage, tailOk, duplicated, status });
    // So avanca o cursor se casou de verdade — frase ausente nao queima a
    // regiao da proxima. E LIMITA o avanco ao cluster (bestStart + W): um match
    // fuzzy isolado na borda da janela nao pode catapultar o cursor adiante.
    if (coverage >= 0.5 && bestLastPos >= 0) {
      cursor = Math.min(bestLastPos + 1, bestStart + W);
    }
  }

  const okCount = out.filter((p) => p.status === 'ok').length;
  const reviewCount = out.filter((p) => p.status === 'review').length;
  const failCount = out.filter((p) => p.status === 'fail').length;
  return { phrases: out, okCount, reviewCount, failCount, total: out.length };
}

// =================== Dedup-trim do RESULTADO (P2) =======================

/**
 * Acha trechos de fala REPETIDA (restart/retake que vazou) no RESULTADO ja
 * cortado, usando os timestamps por palavra da re-transcricao. Retorna as
 * faixas de tempo (ms) a REMOVER — sempre a 1a ocorrencia (abandonada),
 * mantendo a 2a (que continua na frase completa).
 *
 * Isto e' o que o matcher NAO consegue: ele e' cego pra duplicacao que o ASR
 * do BRUTO colapsou. Aqui operamos no que esta REALMENTE no video — entao
 * garante zero fala repetida, independente de existir take limpa no bruto.
 *
 * Detecta: a partir de uma palavra-conceito, um bigrama de conteudo que
 * REINICIA adiante (dentro de ~40 palavras) com >=70% do 1o bloco reaparecendo
 * no 2o = e' a mesma frase refeita. Remove [inicio do 1o bloco, inicio do 2o].
 * Tolera variacao do ASR (fuzzy) e palavra inserida no meio ("pessoal").
 */
export function findRepeatedSpans(
  words: Word[],
): Array<{ startMs: number; endMs: number }> {
  const n = words.length;
  if (n < 4) return [];
  const stems = words.map((w) => stem(tokenize(w.text)[0] ?? ''));
  const isC = (k: number) => isContent(stems[k]);
  const nextContent = (k: number) => {
    let j = k;
    while (j < n && !isC(j)) j++;
    return j < n ? j : -1;
  };

  const spans: Array<{ startMs: number; endMs: number }> = [];
  let i = 0;
  while (i < n) {
    if (!isC(i)) { i++; continue; }
    const a2 = nextContent(i + 1);
    if (a2 < 0) break;

    let found = -1;
    const limit = Math.min(n, i + 40);
    for (let j = a2 + 1; j < limit; j++) {
      if (!isC(j) || !fuzzyEq(stems[j], stems[i])) continue;
      const jn = nextContent(j + 1);
      if (jn < 0 || !fuzzyEq(stems[jn], stems[a2])) continue;

      // O 1o bloco [i, j) reaparece no 2o bloco [j, ...)? (restart de verdade)
      const firstContent: string[] = [];
      for (let k = i; k < j; k++) if (isC(k)) firstContent.push(stems[k]);
      if (firstContent.length < 2) continue;
      const secEnd = Math.min(n, j + (j - i) + 6);
      let reappear = 0;
      for (const s of firstContent) {
        for (let k = j; k < secEnd; k++) {
          if (isC(k) && fuzzyEq(stems[k], s)) { reappear++; break; }
        }
      }
      if (reappear / firstContent.length >= 0.7) { found = j; break; }
    }

    if (found > i) {
      spans.push({ startMs: words[i].start, endMs: words[found].start });
      i = found;
    } else {
      i++;
    }
  }
  return spans;
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
    // Fallback 1: nenhuma janela "limpa" passou — tenta relaxado pra nunca
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
    // Fallback 2 (desesperado): nem relaxado achou — desliga os guards de
    // buraco/densidade/duracao pra NUNCA sumir linha em silencio. O candidato
    // (possivelmente sujo) sera flagado pelo audit pos-render.
    if (cands.length === 0) {
      cands = findTopWindows(
        targetStems,
        words,
        transcriptStems,
        gaps,
        TOP_K_PER_PHRASE,
        true,
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
    // Takes alternativas da MESMA frase (outras janelas candidatas), pro
    // auto-retry trocar quando a auditoria reprovar este corte.
    const alts = candidatesPerPhrase[i]
      .filter((c) => c !== cand)
      .slice(0, 3)
      .map((c) => ({ startMs: c.startMs, endMs: c.endMs, text: c.text }));
    // startMs/endMs ja vem snapados pro meio do silencio adjacente.
    rawCuts.push({
      startMs: cand.startMs,
      endMs: cand.endMs,
      copyPhrase: phrases[i],
      transcriptText: cand.text,
      score: cand.score,
      recall: cand.recall,
      precision: cand.precision,
      confidence: cand.confidence,
      pass: cand.pass,
      alts,
    });
  }

  const dedupedCuts = dedupCutsGlobal(rawCuts);
  const finalCuts = enforceNoTimeOverlap(dedupedCuts);

  return finalCuts;
}
