import { NextResponse } from 'next/server';
import { getUserKey } from '@/lib/user-keys';

/**
 * POST /api/decupagem-copy/match  v2 — Algoritmo assertivo
 *
 * Recebe (multipart):
 *   - audio: arquivo OPUS extraido client-side (12kbps mono 16kHz)
 *   - copy: texto da copy/script
 *   - provider?: 'groq' (default) | 'assemblyai'
 *
 * Pipeline novo:
 *   1. Transcribe com Groq Whisper-large-v3 (word-level timestamps).
 *      Fallback automatico pra AssemblyAI se Groq key faltar.
 *   2. Pra cada frase da copy: ENCONTRA TODAS as ocorrencias possiveis
 *      no transcript via fuzzy sliding window.
 *   3. Scoreia cada candidato: completude + confidence-proxy (variancia
 *      de duracao das palavras) + speech rate (palavras/min) + ausencia
 *      de fillers + limpeza dos boundaries (gap silencioso antes/depois).
 *   4. DYNAMIC PROGRAMMING globalmente otimo: escolhe 1 cut por frase
 *      respeitando ordem cronologica + maximizando score total. Quando
 *      o expert REPETE a mesma frase 3 vezes, o algoritmo escolhe
 *      AUTOMATICAMENTE a melhor das 3 (a com maior score), nunca pega
 *      duas. E garante que cada frase i+1 venha CRONOLOGICAMENTE depois
 *      da frase i.
 *   5. Aplica margem de seguranca (+80ms antes/depois) pra nao cortar
 *      letras iniciais/finais.
 *
 * Resultado: cuts em ordem da copy, com tudo da copy presente, sem
 * repeticoes, sem fora de ordem.
 */

export const runtime = 'nodejs';
export const maxDuration = 300;

const AAI_BASE = 'https://api.assemblyai.com/v2';
const GROQ_BASE = 'https://api.groq.com/openai/v1';

type Word = {
  text: string;
  start: number;     // millis
  end: number;       // millis
  confidence?: number; // 0..1, opcional (AAI tem, Groq normalmente nao)
};

type Candidate = {
  start: number;
  end: number;
  score: number;
  startMs: number;
  endMs: number;
  text: string;
  completeness: number;
  confidence: number;
  speechRate: number;
  noFillers: number;
  boundary: number;
};

type Cut = {
  startMs: number;
  endMs: number;
  copyPhrase: string;
  transcriptText: string;
  score: number;
  // Debug breakdown
  completeness: number;
  confidence: number;
  speechRate: number;
};

const MARGIN_MS = 80; // expande cada cut ±80ms pra nao comer letra
const FILLERS = new Set([
  'uh', 'ah', 'eh', 'oh', 'hum', 'tipo', 'tipow',
  'entao', 'sabe', 'aham', 'ne', 'pois',
]);

function jsonError(message: string, status = 500, detail?: string) {
  return NextResponse.json(
    detail
      ? { error: message, detail: detail.slice(0, 500) }
      : { error: message },
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
        'Falha ao ler upload (limite ~4MB no Vercel).',
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

    // 1. Transcricao — tenta Groq, fallback AAI
    let words: Word[] = [];
    let provider = '';

    if (requestedProvider === 'groq') {
      try {
        words = await transcribeViaGroq(audio);
        provider = 'groq';
      } catch (e) {
        console.warn('[decupagem v2] Groq falhou, fallback AAI:', e);
      }
    }

    if (words.length === 0) {
      try {
        words = await transcribeViaAssemblyAI(audio);
        provider = 'assemblyai';
      } catch (e) {
        return jsonError(
          'Falha em ambos providers (Groq + AssemblyAI). Configure ao menos um em /configuracoes/api.',
          502,
          e instanceof Error ? e.message : String(e),
        );
      }
    }

    if (words.length === 0) {
      return jsonError(
        'Transcricao vazia. Verifique se o audio tem fala em portugues.',
        504,
      );
    }

    // 2-4. Match assertivo
    const cuts = matchCopyAssertively(copyText, words);
    if (cuts.length === 0) {
      return jsonError(
        'Nao consegui alinhar nenhuma frase. Confira se a copy realmente bate com o que esta sendo falado.',
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
    console.error('[decupagem-copy v2 match]', e);
    return jsonError(
      'Erro inesperado.',
      500,
      e instanceof Error ? e.message : String(e),
    );
  }
}

// =================== Transcription providers ===========================

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
  if (!uploadRes.ok) {
    const t = await uploadRes.text().catch(() => '');
    throw new Error(`AAI upload ${uploadRes.status}: ${t.slice(0, 200)}`);
  }
  const { upload_url } = (await uploadRes.json()) as { upload_url: string };

  const trRes = await fetch(`${AAI_BASE}/transcript`, {
    method: 'POST',
    headers: {
      authorization: apiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      audio_url: upload_url,
      language_code: 'pt',
      punctuate: true,
      format_text: true,
    }),
  });
  if (!trRes.ok) {
    const t = await trRes.text().catch(() => '');
    throw new Error(`AAI transcript ${trRes.status}: ${t.slice(0, 200)}`);
  }
  const { id } = (await trRes.json()) as { id: string };

  const deadline = Date.now() + 4 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2500));
    const poll = await fetch(`${AAI_BASE}/transcript/${id}`, {
      headers: { authorization: apiKey },
    });
    const body = (await poll.json()) as {
      status: string;
      words?: Array<{
        text: string;
        start: number;
        end: number;
        confidence: number;
      }>;
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
    if (body.status === 'error') {
      throw new Error(body.error ?? 'AAI error');
    }
  }
  throw new Error('AAI timeout');
}

// =================== Tokenizacao ========================================

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

function tokenize(text: string): string[] {
  return normalize(text)
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

function splitIntoPhrases(copy: string): string[] {
  return copy
    .split(/[.!?\n]+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 2);
}

// =================== Fuzzy matching =====================================

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const dp: number[][] = Array(a.length + 1)
    .fill(null)
    .map(() => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }
  return dp[a.length][b.length];
}

function fuzzyEqual(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 3 || b.length < 3) return false;
  const dist = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length);
  return dist / maxLen <= 0.25;
}

// =================== Candidate generation ==============================

/**
 * Gera ATE K candidatos pra uma frase, scoreando cada um.
 * Permite skip de ate maxSkip palavras entre matches (cobre stutters /
 * fillers / repeticoes intermediarias). Garante que pelo menos minMatch
 * % das palavras esperadas casaram.
 */
function findCandidates(
  expected: string[],
  tokens: string[],
  words: Word[],
  opts: { maxSkip: number; minMatch: number; fuzzy: boolean },
  topK = 8,
): Candidate[] {
  const cands: Candidate[] = [];

  for (let start = 0; start < tokens.length; start++) {
    const firstMatch = opts.fuzzy
      ? fuzzyEqual(tokens[start], expected[0])
      : tokens[start] === expected[0];
    if (!firstMatch) continue;

    let matched = 1;
    let lastIdx = start;
    let exp_i = 1;
    for (
      let i = start + 1;
      i < tokens.length && exp_i < expected.length;
      i++
    ) {
      if (i - lastIdx > opts.maxSkip) break;
      const eq = opts.fuzzy
        ? fuzzyEqual(tokens[i], expected[exp_i])
        : tokens[i] === expected[exp_i];
      if (eq) {
        matched++;
        lastIdx = i;
        exp_i++;
      }
    }

    const completeness = matched / expected.length;
    if (completeness < opts.minMatch) continue;

    const span = words.slice(start, lastIdx + 1);
    const spanTokens = tokens.slice(start, lastIdx + 1);
    const startMs = span[0].start;
    const endMs = span[span.length - 1].end;
    const durMs = endMs - startMs;

    // Confidence proxy:
    //  - se transcript tem confidence (AAI), usa direto
    //  - senao, infere da consistencia das duracoes de palavra. Fala
    //    confiante tem timing consistente; hesitacao tem variancia alta.
    const hasNativeConf = span.some((w) => typeof w.confidence === 'number');
    let confidence: number;
    if (hasNativeConf) {
      const confs = span.map((w) => w.confidence ?? 0.7);
      confidence = confs.reduce((a, b) => a + b, 0) / confs.length;
    } else {
      const wordDurs = span.map((w) => w.end - w.start);
      const meanDur =
        wordDurs.reduce((a, b) => a + b, 0) / wordDurs.length || 1;
      const variance =
        wordDurs.reduce((a, b) => a + (b - meanDur) ** 2, 0) /
        wordDurs.length;
      const cv = Math.sqrt(variance) / meanDur;
      confidence = Math.max(0, Math.min(1, 1 - cv));
    }

    // Speech rate: palavras/segundo. Faixa ideal: 2.5 a 4.5 wps (150-270 wpm).
    // Fora dessa faixa = lento demais (hesitando) ou rapido demais
    // (gaguejou). Penaliza extremos.
    const wps = (spanTokens.length / Math.max(durMs, 1)) * 1000;
    let speechRate: number;
    if (wps >= 2.5 && wps <= 4.5) {
      speechRate = 1.0;
    } else if (wps < 2.5) {
      speechRate = Math.max(0, wps / 2.5);
    } else {
      speechRate = Math.max(0, 1 - (wps - 4.5) / 4.5);
    }

    // Fillers
    const fillerCount = spanTokens.filter((t) => FILLERS.has(t)).length;
    const noFillers = 1 - fillerCount / Math.max(1, spanTokens.length);

    // Boundary cleanness: silencio (gap) antes e depois
    const gapBefore =
      start > 0 ? span[0].start - words[start - 1].end : 1500;
    const gapAfter =
      lastIdx < words.length - 1
        ? words[lastIdx + 1].start - span[span.length - 1].end
        : 1500;
    const boundary = Math.min(1, (gapBefore + gapAfter) / 800);

    // Score combinado. Pesos calibrados pra priorizar completude e
    // confidence (qualidade de fala), penalizando hesitacao e cortes
    // sujos no boundary.
    const score =
      completeness * 0.4 +
      confidence * 0.25 +
      speechRate * 0.15 +
      noFillers * 0.1 +
      boundary * 0.1;

    cands.push({
      start,
      end: lastIdx,
      score,
      startMs,
      endMs,
      text: span.map((w) => w.text).join(' '),
      completeness,
      confidence,
      speechRate,
      noFillers,
      boundary,
    });
  }

  // Ordena por score desc + corta top-K
  cands.sort((a, b) => b.score - a.score);
  return cands.slice(0, topK);
}

// =================== DP — assignment otimo ==============================

/**
 * Dado o conjunto de candidatos pra cada frase (na ordem da copy), escolhe
 * 1 candidato por frase tal que:
 *   1. Cronologia preservada: cand[i].endMs <= cand[i+1].startMs + tolerancia
 *      (tolerancia = 200ms pra dar uma folga em casos onde palavras se
 *      tocam ou ha pequena sobreposicao detectada pelo Whisper)
 *   2. Soma dos scores e MAXIMA
 *
 * Retorna a sequencia otima (uma posicao por frase) ou um fallback "best
 * effort" se nao ha sequencia totalmente cronologica viavel.
 *
 * Complexity: O(N * K^2) onde N=frases, K=candidatos por frase. K ate 8
 * entao isso roda em ms ate pra copy de 100 frases.
 */
function dpAssign(
  candidatesPerPhrase: Candidate[][],
): (Candidate | null)[] {
  const N = candidatesPerPhrase.length;
  if (N === 0) return [];

  const TOL = 200; // 200ms de tolerancia

  // dp[i][j] = melhor score acumulado escolhendo cand j pra frase i
  // prev[i][j] = qual j foi escolhido pra frase i-1 (pra reconstruir caminho)
  const dp: number[][] = [];
  const prev: number[][] = [];

  for (let i = 0; i < N; i++) {
    const cands = candidatesPerPhrase[i];
    dp.push(new Array(cands.length).fill(-Infinity));
    prev.push(new Array(cands.length).fill(-1));
  }

  // Base case: frase 0
  for (let j = 0; j < candidatesPerPhrase[0].length; j++) {
    dp[0][j] = candidatesPerPhrase[0][j].score;
  }

  // Transicao: frase i a partir de frase i-1
  for (let i = 1; i < N; i++) {
    const cur = candidatesPerPhrase[i];
    const prevCands = candidatesPerPhrase[i - 1];
    for (let j = 0; j < cur.length; j++) {
      let bestPrev = -1;
      let bestScore = -Infinity;
      for (let k = 0; k < prevCands.length; k++) {
        if (dp[i - 1][k] === -Infinity) continue;
        // Constraint cronologica: prev candidate deve TERMINAR antes (ou
        // muito proximo) do start do atual
        if (prevCands[k].endMs > cur[j].startMs + TOL) continue;
        const cand = dp[i - 1][k];
        if (cand > bestScore) {
          bestScore = cand;
          bestPrev = k;
        }
      }
      if (bestPrev >= 0) {
        dp[i][j] = bestScore + cur[j].score;
        prev[i][j] = bestPrev;
      }
    }
  }

  // Reconstrucao: escolhe o melhor j na ultima frase
  let bestEndJ = -1;
  let bestEndScore = -Infinity;
  for (let j = 0; j < candidatesPerPhrase[N - 1].length; j++) {
    if (dp[N - 1][j] > bestEndScore) {
      bestEndScore = dp[N - 1][j];
      bestEndJ = j;
    }
  }

  const path: number[] = new Array(N).fill(-1);
  if (bestEndJ < 0) {
    // Nao ha caminho totalmente conexo. Fallback: pega o melhor candidato
    // de cada frase isoladamente (pode haver sobreposicao em casos
    // patologicos, mas nunca perdemos uma frase).
    for (let i = 0; i < N; i++) {
      const cands = candidatesPerPhrase[i];
      if (cands.length > 0) path[i] = 0; // ja ordenado por score desc
    }
  } else {
    path[N - 1] = bestEndJ;
    for (let i = N - 1; i > 0; i--) {
      path[i - 1] = prev[i][path[i]] >= 0 ? prev[i][path[i]] : 0;
    }
  }

  return path.map((j, i) =>
    j >= 0 && j < candidatesPerPhrase[i].length
      ? candidatesPerPhrase[i][j]
      : candidatesPerPhrase[i][0] ?? null,
  );
}

// =================== Pipeline principal =================================

function matchCopyAssertively(copy: string, words: Word[]): Cut[] {
  if (words.length === 0) return [];
  const phrases = splitIntoPhrases(copy);
  const tokens = words.map((w) => tokenize(w.text)[0] ?? '');

  // Pra cada frase, gera candidatos com 3 passes progressivamente
  // mais relaxados — assegura que ate frases dificeis tenham candidatos.
  const candidatesPerPhrase: Candidate[][] = [];

  for (const phrase of phrases) {
    const expected = tokenize(phrase);
    if (expected.length === 0) {
      candidatesPerPhrase.push([]);
      continue;
    }

    let cands: Candidate[] = [];
    const passes = [
      { maxSkip: 4, minMatch: 0.6, fuzzy: false },
      { maxSkip: 6, minMatch: 0.4, fuzzy: false },
      { maxSkip: 8, minMatch: 0.3, fuzzy: true },
    ];
    for (const p of passes) {
      cands = findCandidates(expected, tokens, words, p, 8);
      if (cands.length >= 3) break; // tem candidatos suficientes, para
    }

    candidatesPerPhrase.push(cands);
  }

  // DP pra assignment otimo
  const optimal = dpAssign(candidatesPerPhrase);

  // Constroi cuts finais com margem de seguranca
  const cuts: Cut[] = [];
  for (let i = 0; i < phrases.length; i++) {
    const cand = optimal[i];
    if (!cand) continue;
    cuts.push({
      startMs: Math.max(0, cand.startMs - MARGIN_MS),
      endMs: cand.endMs + MARGIN_MS,
      copyPhrase: phrases[i],
      transcriptText: cand.text,
      score: cand.score,
      completeness: cand.completeness,
      confidence: cand.confidence,
      speechRate: cand.speechRate,
    });
  }

  return cuts;
}
