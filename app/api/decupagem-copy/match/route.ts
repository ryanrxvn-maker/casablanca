import { NextResponse } from 'next/server';
import { getUserKey } from '@/lib/user-keys';

/**
 * POST /api/decupagem-copy/match v3 — Window-based + LCS scoring
 *
 * REGRAS CRITICAS:
 *   1. JAMAIS retorna take incompleto (frase cortada mid-fala).
 *   2. Quando o expert repete N vezes, escolhe APENAS o take com melhor
 *      qualidade (mais completo, melhor cadencia, sem hesitacao).
 *   3. Ordem da copy preservada cronologicamente.
 *   4. Margem ampla (250ms) pra nao cortar letra inicial/final.
 *
 * ALGORITMO NOVO (corrige bugs do v2):
 *   1. Splita copy em sentencas (por .!?\n)
 *   2. Pra cada sentenca da copy, slide window pelo transcript com
 *      tamanho ENTRE 70% e 130% do target em palavras
 *   3. Score do window: combinacao de
 *        - LCS (longest common subsequence) ratio — preserva ordem
 *        - Token recall — % das palavras do target presentes
 *        - Token precision — % do window que e' relevante
 *        - Quality (sem fillers, cadencia consistente)
 *   4. Top-K windows por sentenca
 *   5. DP global: escolhe 1 window por sentenca, cronologico, sem overlap.
 *      Permite SKIP de sentenca com penalidade (caso patologico).
 *   6. Aplica margem 250ms +/- pra nao cortar fala.
 *
 * Por que isso resolve:
 *   - Take incompleto "isso nao e um treino de—" tem 6 palavras vs target
 *     de 14. Window size minimum e' 70%*14=10. Esse take NAO ENTRA na
 *     janela de tamanho valido. Eliminado automaticamente.
 *   - Quando expert repete frase 3 vezes, todos 3 viram candidates com
 *     scores parecidos. DP escolhe APENAS UM (o melhor) e impede outros
 *     via constraint de overlap.
 *   - Cronologia respeitada via DP.
 *   - Margem 250ms cobre erro de timestamp do Whisper.
 */

export const runtime = 'nodejs';
export const maxDuration = 300;

const AAI_BASE = 'https://api.assemblyai.com/v2';
const GROQ_BASE = 'https://api.groq.com/openai/v1';

// Margem reduzida pra 120ms — suficiente pra cobrir erro do Whisper sem
// invadir take adjacente (que poderia conter conteudo da mesma frase).
const MARGIN_MS = 120;
const MIN_WINDOW_RATIO = 0.7;
const MAX_WINDOW_RATIO = 1.4;
const TOP_K_PER_PHRASE = 6;
const MIN_SCORE_TO_KEEP = 0.45;
// TOL minimo no DP — antes era 200ms, permitia 200ms de overlap. Agora 0.
const DP_TOL_MS = 0;

type Word = {
  text: string;
  start: number;
  end: number;
  confidence?: number;
};

type Candidate = {
  startIdx: number;
  endIdx: number;
  startMs: number;
  endMs: number;
  text: string;
  score: number;
  // Debug
  recall: number;
  precision: number;
  lcsRatio: number;
};

type Cut = {
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

function jsonError(message: string, status = 500, detail?: string) {
  return NextResponse.json(
    detail ? { error: message, detail: detail.slice(0, 500) } : { error: message },
    { status },
  );
}

export async function POST(req: Request) {
  try {
    let form: FormData;
    try {
      form = await req.formData();
    } catch (e) {
      return jsonError(
        'Falha ao ler upload (limite ~4MB).',
        413,
        e instanceof Error ? e.message : String(e),
      );
    }

    const audio = form.get('audio');
    const copyText = String(form.get('copy') ?? '').trim();
    const requestedProvider = String(form.get('provider') ?? 'groq');

    if (!(audio instanceof File)) {
      return jsonError('Audio ausente no campo "audio".', 400);
    }
    if (!copyText) {
      return jsonError('Copy ausente no campo "copy".', 400);
    }
    if (copyText.length > 50000) {
      return jsonError('Copy muito grande (max 50000 caracteres).', 400);
    }

    let words: Word[] = [];
    let provider = '';

    if (requestedProvider === 'groq') {
      try {
        words = await transcribeViaGroq(audio);
        provider = 'groq';
      } catch (e) {
        console.warn('[decupagem v3] Groq falhou, fallback AAI:', e);
      }
    }

    if (words.length === 0) {
      try {
        words = await transcribeViaAssemblyAI(audio);
        provider = 'assemblyai';
      } catch (e) {
        return jsonError(
          'Falha em ambos providers. Configure Groq ou AssemblyAI em /configuracoes/api.',
          502,
          e instanceof Error ? e.message : String(e),
        );
      }
    }

    if (words.length === 0) {
      return jsonError('Transcricao vazia.', 504);
    }

    const cuts = matchCopyWindowed(copyText, words);
    if (cuts.length === 0) {
      return jsonError(
        'Nao consegui alinhar nenhuma frase. Confira se a copy bate com o video.',
        422,
      );
    }

    return NextResponse.json({
      cuts,
      provider,
      transcriptPreview: words
        .map((w) => w.text)
        .join(' ')
        .slice(0, 500),
    });
  } catch (e) {
    console.error('[decupagem-copy v3 match]', e);
    return jsonError(
      'Erro inesperado.',
      500,
      e instanceof Error ? e.message : String(e),
    );
  }
}

// =================== Transcription (igual v2) ===========================

async function transcribeViaGroq(audio: File): Promise<Word[]> {
  const keyResult = await getUserKey('groq');
  if ('response' in keyResult) throw new Error('Groq key ausente.');
  const apiKey = keyResult.key;

  const fd = new FormData();
  fd.append('file', audio, audio.name || 'audio.opus');
  fd.append('model', 'whisper-large-v3');
  fd.append('response_format', 'verbose_json');
  fd.append('timestamp_granularities[]', 'word');
  fd.append('language', 'pt');

  const res = await fetch(`${GROQ_BASE}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: fd,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Groq ${res.status}: ${t.slice(0, 200)}`);
  }
  const json = (await res.json().catch(() => null)) as {
    words?: Array<{ word: string; start: number; end: number }>;
  } | null;
  if (!json?.words) throw new Error('Groq retornou sem palavras.');

  return json.words.map((w) => ({
    text: w.word,
    start: Math.round(w.start * 1000),
    end: Math.round(w.end * 1000),
  }));
}

async function transcribeViaAssemblyAI(audio: File): Promise<Word[]> {
  const keyResult = await getUserKey('assemblyai');
  if ('response' in keyResult) throw new Error('AAI key ausente.');
  const apiKey = keyResult.key;

  const audioBytes = new Uint8Array(await audio.arrayBuffer());
  const uploadRes = await fetch(`${AAI_BASE}/upload`, {
    method: 'POST',
    headers: {
      authorization: apiKey,
      'content-type': 'application/octet-stream',
    },
    body: audioBytes,
  });
  if (!uploadRes.ok) throw new Error(`AAI upload ${uploadRes.status}`);
  const { upload_url } = (await uploadRes.json()) as { upload_url: string };

  const trRes = await fetch(`${AAI_BASE}/transcript`, {
    method: 'POST',
    headers: { authorization: apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({
      audio_url: upload_url,
      language_code: 'pt',
      punctuate: true,
      format_text: true,
    }),
  });
  if (!trRes.ok) throw new Error(`AAI transcript ${trRes.status}`);
  const { id } = (await trRes.json()) as { id: string };

  const deadline = Date.now() + 4 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2500));
    const poll = await fetch(`${AAI_BASE}/transcript/${id}`, {
      headers: { authorization: apiKey },
    });
    const body = (await poll.json()) as {
      status: string;
      words?: Array<{ text: string; start: number; end: number; confidence: number }>;
      error?: string;
    };
    if (body.status === 'completed') {
      return (body.words ?? []).map((w) => ({
        text: w.text,
        start: w.start,
        end: w.end,
        confidence: w.confidence,
      }));
    }
    if (body.status === 'error') throw new Error(body.error ?? 'AAI error');
  }
  throw new Error('AAI timeout');
}

// =================== Tokenizacao + utils ================================

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Stemmer leve pra portugues. Reduz variacoes de conjugacao verbal e
 * plurais a uma forma comum, melhorando matching robusto.
 *
 * Exemplos:
 *   treinar / treina / treinou / treinando → "trein"
 *   pernas / perna → "pern"
 *   doenca / doencas → "doenc"
 *
 * Conservador — so corta sufixos quando palavra tem ≥5 chars (evita
 * destruir palavras curtas tipo "isso", "aqui", "nao").
 */
function stem(word: string): string {
  if (word.length < 5) return word;
  let s = word;

  // Sufixos verbais comuns (em ordem do mais longo pro mais curto)
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

  // Plurais
  if (s.length > 4) {
    if (s.endsWith('oes') || s.endsWith('aes') || s.endsWith('ais')) {
      s = s.slice(0, -3) + (s.endsWith('oes') ? 'ao' : 'al');
    } else if (s.endsWith('es') && s.length > 4) {
      s = s.slice(0, -2);
    } else if (s.endsWith('s') && s.length > 4) {
      s = s.slice(0, -1);
    }
  }

  // Genero (so se palavra ficar com >=4 chars)
  if (s.length > 4 && /[ao]$/.test(s)) {
    s = s.slice(0, -1);
  }

  return s;
}

function tokenize(text: string): string[] {
  return normalize(text).split(' ').filter((w) => w.length > 0);
}

/**
 * Tokeniza + stemiza. Usado no matching pra robustez contra variacoes.
 */
function stemTokens(text: string): string[] {
  return tokenize(text).map(stem);
}

/**
 * Auto-tune do window ratio baseado no tamanho do target.
 * Frases curtas precisam janela mais flexivel (mais palavras adicionais
 * relativas), frases longas precisam apertada.
 */
function getWindowRatios(targetLen: number): { min: number; max: number } {
  if (targetLen <= 4) return { min: 0.5, max: 2.0 }; // muito flexivel
  if (targetLen <= 8) return { min: 0.6, max: 1.6 };
  if (targetLen <= 15) return { min: 0.7, max: 1.4 }; // padrao
  if (targetLen <= 25) return { min: 0.8, max: 1.3 };
  return { min: 0.85, max: 1.2 }; // frase muito longa: pouca margem
}

function splitIntoPhrases(copy: string): string[] {
  return copy
    .split(/[.!?\n]+|…/)
    .map((p) => p.trim())
    .filter((p) => p.length > 2);
}

// =================== Window matching ====================================

/**
 * Longest Common Subsequence comprimento. O(n*m).
 */
function lcsLength(a: string[], b: string[]): number {
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
 * Encontra os top-K windows no transcript que melhor casam com targetTokens.
 * Janela com size entre 70% e 140% do target em palavras — incompletas
 * automaticamente rejeitadas (size fora da janela valida).
 */
function findTopWindows(
  targetStems: string[],
  words: Word[],
  transcriptStems: string[],
  topK: number,
): Candidate[] {
  const targetLen = targetStems.length;
  const targetSet = new Set(targetStems);
  // Auto-tune ratios baseado no tamanho da frase
  const ratios = getWindowRatios(targetLen);
  const minSize = Math.max(2, Math.floor(targetLen * ratios.min));
  const maxSize = Math.ceil(targetLen * ratios.max);

  const candidates: Candidate[] = [];

  for (let start = 0; start < transcriptStems.length; start++) {
    // Pre-filter: skip se as primeiras 3-5 palavras do window nao tem
    // overlap com target (acelera muito busca).
    const lookAhead = transcriptStems.slice(start, start + 5);
    const overlap = lookAhead.filter((t) => targetSet.has(t)).length;
    if (overlap < 1) continue;

    for (let size = minSize; size <= maxSize; size++) {
      if (start + size > transcriptStems.length) break;
      const window = transcriptStems.slice(start, start + size);
      const wordSlice = words.slice(start, start + size);

      // Set overlap (recall + precision) usando stems
      const windowSet = new Set(window);
      let intersect = 0;
      for (const t of targetSet) if (windowSet.has(t)) intersect++;
      const recall = intersect / targetLen;
      const precision = intersect / size;

      // Reject early se recall < 55% (um pouco mais permissivo com stems)
      if (recall < 0.55) continue;

      // LCS pra preservar ordem (usa stems)
      const lcs = lcsLength(targetStems, window);
      const lcsRatio = lcs / Math.max(targetLen, size);

      // Quality: ausencia de fillers + consistencia de duracao das palavras
      const fillers = window.filter((t) => FILLERS.has(t)).length;
      const noFillers = 1 - fillers / size;

      const durs = wordSlice.map((w) => w.end - w.start);
      const meanDur = durs.reduce((a, b) => a + b, 0) / durs.length || 1;
      const variance =
        durs.reduce((a, b) => a + (b - meanDur) ** 2, 0) / durs.length;
      const cv = Math.sqrt(variance) / meanDur;
      const cadence = Math.max(0, Math.min(1, 1 - cv));

      // Confidence (Whisper raramente da, AAI da)
      const hasConf = wordSlice.some((w) => typeof w.confidence === 'number');
      let confidence = 0.7;
      if (hasConf) {
        const cs = wordSlice.map((w) => w.confidence ?? 0.7);
        confidence = cs.reduce((a, b) => a + b, 0) / cs.length;
      } else {
        confidence = cadence; // proxy
      }

      // Score: LCS e' o mais importante (preserva ordem da fala)
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
        // Texto ORIGINAL (nao stemizado) pra debug/exibicao
        text: wordSlice.map((w) => w.text).join(' '),
        score,
        recall,
        precision,
        lcsRatio,
      });
    }
  }

  // Ordena por score desc. Tiebreak: quando dois takes empatam (diff < 2%),
  // prefere o MAIS TARDIO no video — expert refaz a frase ate acertar, a
  // ultima take quase sempre e' a boa (a primeira costuma ter hesitacao).
  candidates.sort((a, b) => {
    if (Math.abs(a.score - b.score) < 0.02) return b.startMs - a.startMs;
    return b.score - a.score;
  });

  // Remove candidatos que se sobrepoe MUITO com outros melhores (>50%
  // overlap) — fica so os mais distintos
  const dedup: Candidate[] = [];
  for (const c of candidates) {
    const overlapsWithBetter = dedup.some((d) => {
      const overlapStart = Math.max(c.startIdx, d.startIdx);
      const overlapEnd = Math.min(c.endIdx, d.endIdx);
      const overlap = Math.max(0, overlapEnd - overlapStart + 1);
      const cLen = c.endIdx - c.startIdx + 1;
      return overlap / cLen > 0.5;
    });
    if (!overlapsWithBetter) dedup.push(c);
    if (dedup.length >= topK) break;
  }

  return dedup;
}

// =================== DP cronologico com skip permitido =================

/**
 * Escolhe 1 candidato por phrase respeitando ordem cronologica.
 * Se nao ha caminho perfeito, PERMITE pular phrase (penalidade alta).
 *
 * Estado: dp[i][j] = melhor score acumulado escolhendo cand j pra phrase i
 *                    (ou -1 se phrase i foi pulada)
 *
 * Permitir skip evita o fallback ruim do v2 (que ignorava cronologia).
 */
function dpAssignWithSkip(
  candidatesPerPhrase: Candidate[][],
): Array<Candidate | null> {
  const N = candidatesPerPhrase.length;
  if (N === 0) return [];

  const SKIP_PENALTY = 0.5;
  const TOL = DP_TOL_MS;

  // dp[i][j] = melhor score acumulado se phrase i usa cand j (j=-1 significa skip)
  // Compactamos j=-1 como cand[length] (ultimo+1)
  type PrevRef = { phraseIdx: number; candIdx: number };
  const dp: number[][] = [];
  const prev: (PrevRef | null)[][] = [];

  for (let i = 0; i < N; i++) {
    const cands = candidatesPerPhrase[i];
    dp.push(new Array(cands.length + 1).fill(-Infinity));
    prev.push(new Array<PrevRef | null>(cands.length + 1).fill(null));
  }

  // Base case: phrase 0
  for (let j = 0; j < candidatesPerPhrase[0].length; j++) {
    dp[0][j] = candidatesPerPhrase[0][j].score;
  }
  // Skip phrase 0
  dp[0][candidatesPerPhrase[0].length] = -SKIP_PENALTY;

  // Transicoes
  for (let i = 1; i < N; i++) {
    const cur = candidatesPerPhrase[i];
    const skipIdx = cur.length;

    for (let j = 0; j <= cur.length; j++) {
      let bestScore = -Infinity;
      let bestPrev: PrevRef | null = null;

      // Procura prev nao-skipped que satisfaz cronologia
      // Permite pular ate K phrases anteriores
      for (let prevPhraseIdx = i - 1; prevPhraseIdx >= Math.max(0, i - 5); prevPhraseIdx--) {
        const prevCands = candidatesPerPhrase[prevPhraseIdx];
        // Tenta cada cand do prev (incluindo skip)
        for (let k = 0; k <= prevCands.length; k++) {
          if (dp[prevPhraseIdx][k] === -Infinity) continue;

          // Se prev nao foi skipped, verifica cronologia
          if (k < prevCands.length && j < cur.length) {
            if (prevCands[k].endMs > cur[j].startMs + TOL) continue;
          }

          // Penalidade por pular phrases entre prev e i
          const skipsBetween = i - 1 - prevPhraseIdx;
          const skipPenalty = skipsBetween * SKIP_PENALTY;

          // Score atual: cand atual ou skip
          const currentScore = j < cur.length ? cur[j].score : -SKIP_PENALTY;
          const totalScore = dp[prevPhraseIdx][k] + currentScore - skipPenalty;

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

  // Reconstroi: pega melhor terminal
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

  // Walk back
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

// =================== Pipeline principal =================================

function matchCopyWindowed(copy: string, words: Word[]): Cut[] {
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

  // Pos-processamento: dedup GLOBAL. Se o expert fala a mesma frase 10x,
  // so 1 take pode sobreviver. Compara cada cut contra TODOS os ja aceitos
  // (nao so o anterior) por similaridade textual, igualdade da frase da
  // copy e overlap temporal. Mantem sempre o de maior score.
  const dedupedCuts = dedupCutsGlobal(rawCuts);

  // Tambem garante NO TIME OVERLAP — se cut[i].endMs > cut[i+1].startMs,
  // ajusta pra eliminar overlap (corta ponto medio).
  const finalCuts = enforceNoTimeOverlap(dedupedCuts);

  return finalCuts;
}

/**
 * Similaridade textual entre dois trechos (stems, set overlap simetrico
 * normalizado pelo menor — pega "frase X" dentro de "frase X mais coisa").
 */
function textSimilarity(a: string, b: string): number {
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
 * Regra dura pedida: se o expert fala a MESMA frase 10x, so 1 sobrevive.
 *
 * Pra cada cut (em ordem da copy) compara contra TODOS os ja aceitos:
 *   - similaridade textual >= 0.6  → mesma fala repetida
 *   - mesma frase da copy + sim >= 0.4 → repeticao da mesma linha
 *   - overlap temporal real → pegou o mesmo pedaco de video 2x
 * Em qualquer caso mantem APENAS o de maior score (substitui in-place pra
 * preservar a posicao na ordem da copy).
 */
function dedupCutsGlobal(cuts: Cut[]): Cut[] {
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

      if (sim >= 0.6 || (samePhrase && sim >= 0.4) || timeOverlap) {
        dupIdx = i;
        break;
      }
    }

    if (dupIdx >= 0) {
      if (cur.score > kept[dupIdx].score) kept[dupIdx] = cur;
      // senao descarta — duplicada de qualidade inferior
    } else {
      kept.push(cur);
    }
  }

  // Mantem ordem cronologica (= ordem da copy apos o DP) pra concat correto.
  kept.sort((a, b) => a.startMs - b.startMs);
  return kept;
}

/**
 * Garante que cuts consecutivos NAO se sobrepoem temporalmente.
 * Se cut[i].endMs > cut[i+1].startMs, ajusta endMs do anterior pra ser o
 * startMs do proximo - 50ms (gap minimo).
 */
function enforceNoTimeOverlap(cuts: Cut[]): Cut[] {
  const result: Cut[] = [];
  for (let i = 0; i < cuts.length; i++) {
    const c = { ...cuts[i] };
    if (i > 0) {
      const prev = result[result.length - 1];
      if (c.startMs < prev.endMs) {
        // Overlap detectado — corta no ponto medio
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
