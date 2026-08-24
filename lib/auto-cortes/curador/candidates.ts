/**
 * AUTO CORTES · CURADOR LOCAL — geração de trechos candidatos.
 *
 * Um candidato é sempre um intervalo de FRASES INTEIRAS. Duas travas duras
 * moram aqui, e são elas que impedem o corte de "cheirar a robô":
 *
 *  - INÍCIO: nunca em muleta ("então", "aí", "tipo"), nunca em anáfora
 *    ("isso", "ele"), nunca em conectivo ("mas", "e", "porque"). Além disso o
 *    início precisa ser um ponto onde a fala respira: fronteira de assunto,
 *    pausa antes, ou frase anterior fechada em ponto.
 *  - FIM: só onde a ideia FECHA — pontuação final (ou, quando o ASR não
 *    pontua, pausa longa) e nunca numa palavra pendurada.
 *
 * PURO e determinístico.
 */

import type { Sentence } from '../types';
import { MIN_OPENING_WORDS, type SentenceFeature } from './score';
import type { TopicMap } from './topics';

export type CandidateSpan = {
  i0: number;
  i1: number;
  startMs: number;
  endMs: number;
  durationSec: number;
};

export type LengthRange = { min: number; max: number; ideal: number };

export type BuildCandidatesOpts = {
  sentences: Sentence[];
  features: SentenceFeature[];
  topics: TopicMap;
  range: LengthRange;
  /** quantos fins guardar por início (os mais perto do ideal) */
  maxPerStart?: number;
  /** teto global — protege o navegador em podcast de 3 h */
  maxCandidates?: number;
  /** pausa mínima antes da frase pra ela poder abrir um corte */
  openPauseMs?: number;
};

export type BuildCandidatesResult = {
  spans: CandidateSpan[];
  /** true = precisou afrouxar as travas pra achar QUALQUER coisa */
  relaxed: boolean;
  /** true = a transcrição não tem pontuação final (fim veio da pausa) */
  noPunctuation: boolean;
};

export const DEFAULT_MAX_PER_START = 3;
export const DEFAULT_MAX_CANDIDATES = 4000;
export const DEFAULT_OPEN_PAUSE_MS = 400;
/** Sem pontuação no vídeo inteiro: pausa que passa a valer como fim de ideia. */
export const FALLBACK_END_PAUSE_MS = 500;

/**
 * Gera os spans. O laço é O(frases × frases-que-cabem-na-duração), com corte
 * cedo quando estoura o teto de duração — num podcast de 3 h isso é da ordem
 * de 10^5 operações, roda em milissegundos.
 */
export function buildCandidates(opts: BuildCandidatesOpts): BuildCandidatesResult {
  const { sentences, features: F, topics, range } = opts;
  const n = sentences.length;
  const maxPerStart = Math.max(1, opts.maxPerStart ?? DEFAULT_MAX_PER_START);
  const maxCandidates = Math.max(50, opts.maxCandidates ?? DEFAULT_MAX_CANDIDATES);
  const openPauseMs = opts.openPauseMs ?? DEFAULT_OPEN_PAUSE_MS;

  if (n === 0) return { spans: [], relaxed: false, noPunctuation: false };

  const punctuated = F.some((f) => f.endsFinal);
  const noPunctuation = !punctuated;

  const isIdeaEnd = (i: number): boolean => {
    if (i === n - 1) return true;
    if (F[i].endsFinal) return true;
    return noPunctuation && F[i].gapAfterMs >= FALLBACK_END_PAUSE_MS;
  };

  const cleanStart = (i: number): boolean =>
    !F[i].startsWithFiller &&
    !F[i].startsWithAnaphora &&
    !F[i].startsWithConnective &&
    // caco do ASR e retomada de assunto de fora nunca abrem corte
    !F[i].startsLower &&
    F[i].words >= MIN_OPENING_WORDS &&
    F[i].contentWords >= 2 &&
    !F[i].suspectAsr &&
    F[i].externalRefHits === 0;

  const breathes = (i: number): boolean =>
    i === 0 || topics.isBoundary[i] === true || F[i].gapBeforeMs >= openPauseMs || F[i - 1].endsFinal;

  const strictStart = (i: number) => cleanStart(i) && breathes(i) && F[i].logisticsHits === 0;

  let starts = collectStarts(n, strictStart);
  let relaxed = false;
  if (starts.length === 0) {
    starts = collectStarts(n, cleanStart);
    relaxed = starts.length > 0;
  }
  if (starts.length === 0) {
    starts = collectStarts(n, () => true);
    relaxed = true;
  }

  // Teto global: quando há início demais, ficam os de MAIOR prioridade
  // (fronteira de assunto + gancho + citabilidade). Ordem final volta a ser
  // por índice, então o resultado não depende da ordenação intermediária.
  const budget = Math.max(1, Math.floor(maxCandidates / maxPerStart));
  if (starts.length > budget) {
    const ranked = starts
      .map((i) => ({ i, p: startPriority(i, F, topics) }))
      .sort((a, b) => b.p - a.p || a.i - b.i)
      .slice(0, budget)
      .map((x) => x.i);
    ranked.sort((a, b) => a - b);
    starts = ranked;
  }

  const spans: CandidateSpan[] = [];
  for (const i0 of starts) {
    const startMs = sentences[i0].startMs;
    const ends: Array<{ i1: number; dur: number }> = [];
    for (let i1 = i0; i1 < n; i1++) {
      // Pausa longa é corte de cena: atravessá-la cola dois assuntos num clipe
      // só. Para AQUI e o que vier depois é outro candidato.
      if (i1 > i0 && topics.forced[i1]) break;
      const dur = (sentences[i1].endMs - startMs) / 1000;
      if (dur > range.max) break;
      if (dur < range.min) continue;
      if (!isIdeaEnd(i1)) continue;
      if (F[i1].endsWithDangling) continue;
      // fechar num caco do ASR ("o que está saindo.") não fecha ideia nenhuma
      if (F[i1].suspectAsr) continue;
      // nem numa PERGUNTA: quem assiste fica esperando a resposta que não vem
      if (F[i1].isQuestion) continue;
      // Terminar NA primeira frase de outro assunto = entregar a abertura do
      // próximo tema como se fosse o fecho deste. Nunca fecha bem.
      if (topics.isBoundary[i1] && topics.topicOf[i1] !== topics.topicOf[i0]) continue;
      ends.push({ i1, dur });
    }
    if (ends.length === 0) continue;
    ends.sort(
      (a, b) => Math.abs(a.dur - range.ideal) - Math.abs(b.dur - range.ideal) || a.i1 - b.i1,
    );
    for (const e of ends.slice(0, maxPerStart)) {
      spans.push({
        i0,
        i1: e.i1,
        startMs,
        endMs: sentences[e.i1].endMs,
        durationSec: e.dur,
      });
    }
  }

  spans.sort((a, b) => a.i0 - b.i0 || a.i1 - b.i1);
  return { spans, relaxed, noPunctuation };
}

function collectStarts(n: number, pred: (i: number) => boolean): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (pred(i)) out.push(i);
  return out;
}

/** Quem tem mais cara de abertura sobrevive ao teto global. */
function startPriority(i: number, F: SentenceFeature[], topics: TopicMap): number {
  const f = F[i];
  let p = 0;
  if (topics.isBoundary[i]) p += 40;
  if (f.hookStart) p += 30;
  else if (f.hookHits > 0) p += 18;
  if (f.facts.hasMoney || f.facts.hasPercent) p += 22;
  else if (f.facts.hasNumber) p += 10;
  if (f.imperativeStart) p += 16;
  if (f.isQuestion) p += 10;
  p += Math.round(f.quotability / 5);
  p -= 30 * f.logisticsHits;
  return p;
}

/** Sobreposição como fração da MENOR duração (0..1). */
export function overlapRatio(
  a: { startMs: number; endMs: number },
  b: { startMs: number; endMs: number },
): number {
  const shorter = Math.min(a.endMs - a.startMs, b.endMs - b.startMs);
  if (shorter <= 0) return 0;
  const over = Math.max(0, Math.min(a.endMs, b.endMs) - Math.max(a.startMs, b.startMs));
  return over / shorter;
}
