/**
 * AUTO CORTES · CURADOR LOCAL — features por frase e as notas do corte.
 *
 * Substitui o julgamento do LLM por MEDIÇÃO. Cada sub-nota é 0-100 e sai da
 * mesma matéria-prima que um editor humano usa:
 *
 *   hook          o que os 3 primeiros segundos entregam (dado, promessa,
 *                 pergunta, ordem) — e o que eles NÃO podem ter (muleta,
 *                 anáfora, conectivo pendurado)
 *   value         densidade de termo raro (TF-IDF) medida CONTRA A MÉDIA DESTE
 *                 vídeo + prova concreta empilhada − logística − enrolação
 *   emotion       energia do áudio (z contra o vídeo inteiro) MISTURADA com o
 *                 léxico emocional — dois medidores da mesma coisa não somam
 *   completeness  abre em fronteira de assunto, fecha em pontuação, respira
 *   shareability  existe frase citável (curta, com número/contraste/ordem)
 *   standalone    MULTIPLICADOR 0,6–1,0: anáfora não resolvida e referência a
 *                 algo fora do corte derrubam a nota inteira
 *
 * `standalone` não cabe em `ScoreBreakdown` (contrato existente), então entra
 * como fator do total — é penalidade, nunca crédito.
 *
 * PURO: sem DOM, sem rede, sem `Date.now()`, sem `Math.random()`.
 */

import type { ScoreBreakdown, Sentence } from '../types';
import type { Lexicon } from './lexicon';
import { countFamily, hasFamily } from './lexicon';
import {
  countExclamations,
  endsWithFinalPunct,
  firstToken,
  endsWithEllipsis,
  hasAdjacentRepeat,
  hasImpossibleBigramPt,
  isQuestionText,
  lastToken,
  mergeFacts,
  NO_FACTS,
  normalizeForMatch,
  readFacts,
  startsUppercase,
  tokenize,
  type Facts,
} from './text';
import { clipDensity, isContentToken, type CorpusStats, type TfidfModel } from './tfidf';
import type { TopicMap } from './topics';

// ───────────────────────────────────────────────────────────────────────────
// Pesos do total (CURADOR-LOCAL.md)
// ───────────────────────────────────────────────────────────────────────────

export const WEIGHTS = {
  hook: 0.32,
  shareability: 0.22,
  value: 0.16,
  emotion: 0.15,
  completeness: 0.15,
} as const;

/** Piso do multiplicador de autossuficiência. */
export const STANDALONE_FLOOR = 0.6;

/** Abaixo disto o corte é ruim o bastante pra não existir. */
export const MIN_TOTAL = 24;
export const MIN_HOOK = 18;
/** Fração de frases com marcador de logística que reprova o trecho. */
export const MAX_LOGISTICS_RATIO = 0.25;
/**
 * Palavras mínimas na frase que ABRE o corte. Whisper devolve muito caco de 2-4
 * palavras ("Com nesses certeza", "ó") e um deles chegou a abrir corte no
 * primeiro teste com dado real.
 */
export const MIN_OPENING_WORDS = 5;
/** Fração de frases quebradas (caco/continuação) que reprova o trecho inteiro. */
export const MAX_BROKEN_RATIO = 0.5;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const clamp01 = (v: number) => clamp(v, 0, 1);
const clamp100 = (v: number) => Math.round(clamp(v, 0, 100));

// ───────────────────────────────────────────────────────────────────────────
// Features por frase (calculadas UMA vez; candidatos e notas leem daqui)
// ───────────────────────────────────────────────────────────────────────────

export type SentenceFeature = {
  index: number;
  /** texto normalizado com espaço nas bordas (` frase `) */
  norm: string;
  words: number;
  facts: Facts;
  startsWithFiller: boolean;
  startsWithAnaphora: boolean;
  startsWithConnective: boolean;
  endsFinal: boolean;
  endsWithDangling: boolean;
  isQuestion: boolean;
  questionStart: boolean;
  exclamations: number;
  fillerHits: number;
  hookHits: number;
  hookStart: boolean;
  contrastHits: number;
  imperativeStart: boolean;
  imperativeHits: number;
  superlativeHits: number;
  emotionHits: number;
  laughter: boolean;
  logisticsHits: number;
  externalRefHits: number;
  anaphoraHits: number;
  gapBeforeMs: number;
  gapAfterMs: number;
  /** palavras de conteúdo / palavras totais */
  contentRatio: number;
  /** quantas palavras de conteúdo (não-stopword) a frase tem */
  contentWords: number;
  /** alguma palavra de conteúdo se repete na frase (paralelismo, "X mata, Y mata") */
  repeatsContent: boolean;
  /** começa em minúscula = CONTINUAÇÃO cortada pelo ASR (só quando dá pra julgar) */
  startsLower: boolean;
  /** palavras de conteúdo que aparecem em UMA só frase do vídeo inteiro */
  hapaxContent: number;
  /** cheiro de transcrição suja: caco curto, palavra repetida, hapax demais */
  suspectAsr: boolean;
  /** a frase ANTERIOR é pergunta → esta é a resposta (é dela que sai o payoff) */
  answersQuestion: boolean;
  /** 0-100: o quanto essa frase sozinha é citável */
  quotability: number;
};

/** Frase feita que aparece nos 4 primeiros tokens (= abre com ela). */
function startsWithPhrase(norm: string, list: string[]): boolean {
  for (const p of list) if (norm.startsWith(p)) return true;
  return false;
}

export function buildSentenceFeatures(
  sentences: Sentence[],
  model: TfidfModel,
  lex: Lexicon,
): SentenceFeature[] {
  const out: SentenceFeature[] = new Array(sentences.length);

  // A regra "minúscula = continuação" só vale se a transcrição REALMENTE usa
  // caixa. Se o provedor devolveu tudo minúsculo, ela seria um massacre.
  let up = 0;
  let low = 0;
  for (const s of sentences) {
    const u = startsUppercase(s.text);
    if (u === true) up++;
    else if (u === false) low++;
  }
  const caseIsMeaningful = up + low >= 10 && up / Math.max(1, up + low) >= 0.4;
  // o teste de bigrama impossível é gramática de PT: não vale pra EN/ES
  const soPt = lex.langs.length === 1 && lex.langs[0] === 'pt';

  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i];
    const norm = normalizeForMatch(s.text);
    const toks = tokenize(s.text);
    const first = firstToken(s.text);
    const last = lastToken(s.text);
    const facts = readFacts(s.text);

    const fillerHits =
      (lex.fillers.openers.has(first) ? 1 : 0) + countFamily(norm, lex.fillers.phrases);

    const contentCount = model.content[i]?.length ?? 0;
    const contentRatio = toks.length === 0 ? 0 : contentCount / toks.length;

    let hapax = 0;
    const vistos = new Set<string>();
    for (const t of model.content[i] ?? []) {
      if (vistos.has(t)) continue;
      vistos.add(t);
      if ((model.df.get(t) ?? 0) <= 1) hapax++;
    }

    const f: SentenceFeature = {
      index: i,
      norm,
      words: toks.length,
      facts,
      startsWithFiller:
        lex.fillers.openers.has(first) || startsWithPhrase(norm, lex.fillers.phrases),
      startsWithAnaphora:
        lex.anaphoraOpeners.has(first) || startsWithPhrase(norm, lex.anaphoraPhrases),
      startsWithConnective: lex.connectiveOpeners.has(first),
      endsFinal: endsWithFinalPunct(s.text),
      endsWithDangling: lex.danglingEndings.has(last),
      isQuestion: isQuestionText(s.text),
      questionStart: startsWithPhrase(norm, lex.phrases.question),
      exclamations: countExclamations(s.text),
      fillerHits,
      hookHits: countFamily(norm, lex.phrases.hook),
      hookStart: startsWithPhrase(norm, lex.phrases.hook),
      contrastHits: countFamily(norm, lex.phrases.contrast),
      imperativeStart: startsWithPhrase(norm, lex.phrases.imperative),
      imperativeHits: countFamily(norm, lex.phrases.imperative),
      superlativeHits: countFamily(norm, lex.phrases.superlative),
      emotionHits: countFamily(norm, lex.phrases.emotion),
      laughter: hasFamily(norm, lex.phrases.laughter),
      logisticsHits: countFamily(norm, lex.phrases.logistics),
      externalRefHits: countFamily(norm, lex.phrases.externalRef),
      anaphoraHits: countAnaphora(toks, lex),
      gapBeforeMs: i === 0 ? Number.POSITIVE_INFINITY : s.startMs - sentences[i - 1].endMs,
      gapAfterMs:
        i === sentences.length - 1
          ? Number.POSITIVE_INFINITY
          : sentences[i + 1].startMs - s.endMs,
      contentRatio,
      contentWords: contentCount,
      repeatsContent: hasRepeat(model.content[i] ?? []),
      startsLower: caseIsMeaningful && startsUppercase(s.text) === false,
      hapaxContent: hapax,
      suspectAsr: false,
      answersQuestion: i > 0 && isQuestionText(sentences[i - 1].text),
      quotability: 0,
    };
    f.suspectAsr = smellsLikeAsrJunk(
      f,
      hasAdjacentRepeat(s.text) ||
        endsWithEllipsis(s.text) ||
        (soPt && hasImpossibleBigramPt(s.text)),
    );
    f.quotability = quotabilityOf(f);
    out[i] = f;
  }

  return out;
}

/**
 * Heurística de transcrição suja. Conservadora de propósito: só reprova o texto
 * como FONTE DE MANCHETE, nunca o corte inteiro — num podcast real 54% do
 * vocabulário é hapax, então hapax sozinho não prova nada. O que prova é hapax
 * concentrado numa frase curta sem número, ou palavra repetida colada.
 */
function smellsLikeAsrJunk(f: SentenceFeature, artefato: boolean): boolean {
  if (f.words < MIN_OPENING_WORDS) return true;
  if (artefato) return true;
  const conteudo = Math.max(1, Math.round(f.contentRatio * f.words));
  if (!f.facts.hasNumber && conteudo <= 5 && f.hapaxContent >= 2) return true;
  return false;
}

function hasRepeat(tokens: string[]): boolean {
  const seen = new Set<string>();
  for (const t of tokens) {
    if (seen.has(t)) return true;
    seen.add(t);
  }
  return false;
}

function countAnaphora(tokens: string[], lex: Lexicon): number {
  let n = 0;
  for (const t of tokens) if (lex.anaphoraOpeners.has(t)) n++;
  return n;
}

/** 0-100 — o quanto a frase SOZINHA vira print/legenda de post. */
export function quotabilityOf(f: SentenceFeature): number {
  let q = 0;
  if (f.words >= 4 && f.words <= 14) q += 30;
  else if (f.words <= 20) q += 16;
  else if (f.words <= 26) q += 6;

  if (f.imperativeStart) q += 20;
  else if (f.imperativeHits > 0) q += 10;

  if (f.contrastHits > 0) q += 14;

  if (f.facts.hasMoney || f.facts.hasPercent) q += 20;
  else if (f.facts.hasCountQty || f.facts.hasTimeQty || f.facts.hasBigNumber) q += 15;
  else if (f.facts.hasNumber) q += 9;

  if (f.superlativeHits > 0) q += 12;
  if (f.emotionHits > 0) q += 8;
  if (f.hookHits > 0) q += 8;
  if (f.isQuestion) q += 8;
  // frase curta e cheia de conteúdo = frase de efeito
  if (f.words <= 12 && f.contentRatio >= 0.55) q += 12;
  // paralelismo/repetição é o que faz a frase virar print
  if (f.words <= 14 && f.repeatsContent) q += 10;

  q -= 12 * f.fillerHits;
  q -= 14 * (f.startsWithAnaphora ? 1 : 0);
  q -= 25 * f.logisticsHits;
  q -= 10 * f.externalRefHits;
  return clamp100(q);
}

// ───────────────────────────────────────────────────────────────────────────
// Energia (prosódia)
// ───────────────────────────────────────────────────────────────────────────

export type EnergyStats = { mean: number; std: number; count: number };

/** Média e desvio do vídeo inteiro — a régua contra a qual o corte é medido. */
export function energyStats(db: Float32Array | null | undefined): EnergyStats | null {
  if (!db || db.length < 4) return null;
  let sum = 0;
  for (let i = 0; i < db.length; i++) sum += db[i];
  const mean = sum / db.length;
  let v = 0;
  for (let i = 0; i < db.length; i++) v += (db[i] - mean) ** 2;
  const std = Math.sqrt(v / db.length);
  return { mean, std: std > 1e-6 ? std : 1, count: db.length };
}

export type EnergySlice = { mean: number; p90: number };

export function energySlice(
  db: Float32Array,
  stepSec: number,
  startMs: number,
  endMs: number,
): EnergySlice | null {
  const step = stepSec > 0 ? stepSec : 0.5;
  const a = Math.max(0, Math.floor(startMs / 1000 / step));
  const b = Math.min(db.length - 1, Math.ceil(endMs / 1000 / step));
  if (b < a) return null;
  const vals: number[] = [];
  let sum = 0;
  for (let i = a; i <= b; i++) {
    vals.push(db[i]);
    sum += db[i];
  }
  if (vals.length === 0) return null;
  vals.sort((x, y) => x - y);
  const p90 = vals[Math.min(vals.length - 1, Math.floor(vals.length * 0.9))];
  return { mean: sum / vals.length, p90 };
}

// ───────────────────────────────────────────────────────────────────────────
// Nota do corte
// ───────────────────────────────────────────────────────────────────────────

export type ScoreContext = {
  sentences: Sentence[];
  features: SentenceFeature[];
  model: TfidfModel;
  /** régua de densidade do próprio vídeo (`corpusStats`) */
  corpus: CorpusStats;
  topics: TopicMap;
  lex: Lexicon;
  energy: { stepSec: number; db: Float32Array } | null;
  energyRef: EnergyStats | null;
  /** tokens do "momentos específicos" pedido pelo cliente (já sem stopword) */
  focusTokens: Set<string>;
};

export type ClipSignals = {
  facts: Facts;
  /** o gancho abre com dado concreto */
  hookFact: boolean;
  hookMarker: boolean;
  question: boolean;
  imperative: boolean;
  contrast: boolean;
  emotional: boolean;
  energyHigh: boolean;
  /** índice ABSOLUTO da frase mais citável do corte */
  quoteIndex: number;
  quotability: number;
  endsFinal: boolean;
  gapAfterMs: number;
  startsAtBoundary: boolean;
  logisticsRatio: number;
  /** 0..1 de aderência aos "momentos específicos" */
  focusMatch: number;
  topicId: number;
};

export type ClipScore = {
  breakdown: ScoreBreakdown;
  standalone: number;
  /** 0-100, já com `standalone` e o empurrão de foco */
  total: number;
  /** motivo da reprovação dura, ou null */
  rejected: string | null;
  signals: ClipSignals;
};

/** Frases que cabem nos ~3,5 s de abertura (1 ou 2). */
function hookScope(sentences: Sentence[], i0: number, i1: number): number {
  const start = sentences[i0].startMs;
  if (i0 + 1 <= i1 && sentences[i0].endMs - start < 3500) return i0 + 1;
  return i0;
}

export function scoreClip(i0: number, i1: number, ctx: ScoreContext): ClipScore {
  const { features: F, sentences, model, topics, lex } = ctx;
  const count = i1 - i0 + 1;
  const head = F[i0];
  const tail = F[i1];
  const hookEnd = hookScope(sentences, i0, i1);

  // ── fatos e agregados do corte
  let facts = NO_FACTS;
  let logisticsSentences = 0;
  let quebradas = 0;
  let fillerHits = 0;
  let externalRefHits = 0;
  let emotionHits = 0;
  let exclamations = 0;
  let laughter = false;
  let contrastHits = 0;
  let allTokens = 0;
  let contentTokens = 0;
  let bestQ = 0;
  let secondQ = 0;
  let quoteIndex = i0;
  const distinct = new Set<string>();

  for (let i = i0; i <= i1; i++) {
    const f = F[i];
    facts = mergeFacts(facts, f.facts);
    if (f.logisticsHits > 0) logisticsSentences++;
    if (f.suspectAsr || f.startsLower) quebradas++;
    fillerHits += f.fillerHits;
    externalRefHits += f.externalRefHits;
    emotionHits += f.emotionHits;
    exclamations += f.exclamations;
    contrastHits += f.contrastHits;
    if (f.laughter) laughter = true;
    allTokens += model.all[i].length;
    contentTokens += model.content[i].length;
    for (const t of model.content[i]) distinct.add(t);
    if (f.quotability > bestQ) {
      secondQ = bestQ;
      bestQ = f.quotability;
      quoteIndex = i;
    } else if (f.quotability > secondQ) {
      secondQ = f.quotability;
    }
  }

  const logisticsRatio = count > 0 ? logisticsSentences / count : 0;
  const asrRatio = count > 0 ? quebradas / count : 0;
  const contentRatio = allTokens > 0 ? contentTokens / allTokens : 0;
  const distinctRatio = contentTokens > 0 ? distinct.size / contentTokens : 0;

  // ── hook (0-100)
  let hookNorm = '';
  let hookFacts = NO_FACTS;
  for (let i = i0; i <= hookEnd; i++) {
    hookNorm += F[i].norm;
    hookFacts = mergeFacts(hookFacts, F[i].facts);
  }
  const hookMarker = hasFamily(hookNorm, lex.phrases.hook);
  const hookQuestion = head.isQuestion && head.questionStart;
  const hookImperative = head.imperativeStart;
  const hookContrast = hasFamily(hookNorm, lex.phrases.contrast);
  const hookSuper = hasFamily(hookNorm, lex.phrases.superlative);

  let hook = 26;
  if (hookMarker) hook += 16;
  hook += hookFacts.hasMoney
    ? 26
    : hookFacts.hasPercent
      ? 22
      : hookFacts.hasCountQty
        ? 18
        : hookFacts.hasTimeQty
          ? 14
          : hookFacts.hasBigNumber
            ? 13
            : hookFacts.hasNumber
              ? 10
              : 0;
  if (hookQuestion) hook += 12;
  if (hookImperative) hook += 14;
  if (hookSuper) hook += 7;
  if (hookContrast) hook += 8;
  if (head.words >= 4 && head.words <= 16) hook += 8;
  else if (head.words <= 24) hook += 3;
  if (head.emotionHits > 0) hook += 6;
  hook -= 12 * head.fillerHits;
  if (head.startsWithAnaphora) hook -= 18;
  if (head.startsWithConnective) hook -= 22;
  hook -= 20 * head.logisticsHits;
  hook -= 12 * head.externalRefHits;
  const hookScore = clamp100(hook);

  // ── value (0-100) — SEMPRE relativo ao próprio vídeo, senão satura
  // A média de k frases oscila menos que uma frase solta, então a régua é o
  // erro-padrão (com teto em 5 frases pra corte longo não virar z gigante).
  const spread = Math.sqrt(Math.min(5, count));
  const densZ =
    ((clipDensity(model, i0, i1) - ctx.corpus.meanDensity) * spread) / ctx.corpus.stdDensity;
  const contZ =
    ((contentRatio - ctx.corpus.meanContentRatio) * spread) / ctx.corpus.stdContentRatio;
  const dens = clamp01(0.5 + densZ / 3);
  const cont = clamp01(0.5 + contZ / 3);
  const div = clamp01((distinctRatio - 0.45) / 0.4);
  let value = 100 * (0.46 * dens + 0.32 * cont + 0.22 * div);
  // Prova concreta EMPILHA: um trecho com dinheiro + contagem + prazo entrega
  // mais que um com um número solto, e isso é o que o espectador chama de
  // "valeu meu tempo". (Não é só o melhor dado: é quantos dados.)
  const concrete =
    (facts.hasMoney ? 1 : 0) +
    (facts.hasPercent ? 1 : 0) +
    (facts.hasCountQty ? 1 : 0) +
    (facts.hasTimeQty ? 0.5 : 0) +
    (facts.hasBigNumber ? 0.5 : 0) +
    (facts.hasNumber ? 0.25 : 0);
  value += Math.min(20, 8 * concrete);
  value -= 60 * logisticsRatio;
  value -= 45 * (fillerHits / Math.max(1, count));
  const valueScore = clamp100(value);

  // ── emotion (0-100)
  // Dois medidores da MESMA coisa (energia do áudio e léxico), então eles se
  // MISTURAM em vez de somar. Somando, um bloco cheio de palavra emocional em
  // cima de um pico de RMS estourava 100 e atropelava gancho muito melhor.
  const lexEmotion = clamp100(
    40 + 8 * emotionHits + Math.min(10, 5 * exclamations) + (laughter ? 10 : 0),
  );
  let emotionScore = lexEmotion;
  let energyHigh = false;
  if (ctx.energy && ctx.energyRef) {
    const slice = energySlice(
      ctx.energy.db,
      ctx.energy.stepSec,
      sentences[i0].startMs,
      sentences[i1].endMs,
    );
    if (slice) {
      const z = clamp((slice.mean - ctx.energyRef.mean) / ctx.energyRef.std, -2, 2);
      const varRatio = clamp((slice.p90 - slice.mean) / ctx.energyRef.std, 0, 2);
      const energyPart = clamp100(48 + 18 * z + 8 * varRatio);
      emotionScore = clamp100(0.62 * energyPart + 0.38 * lexEmotion);
      energyHigh = z >= 0.5;
    }
  }

  // ── completeness (0-100)
  const startsAtBoundary = topics.isBoundary[i0] === true;
  const prevEndsFinal = i0 === 0 || F[i0 - 1].endsFinal;
  const endsTopic = i1 + 1 >= sentences.length || topics.isBoundary[i1 + 1] === true;

  let completeness = 18;
  if (startsAtBoundary) completeness += 24;
  else if (head.gapBeforeMs >= 700 || prevEndsFinal) completeness += 12;
  if (tail.endsFinal) completeness += 24;
  if (tail.gapAfterMs >= 500) completeness += 12;
  else if (tail.gapAfterMs >= 250) completeness += 6;
  if (endsTopic) completeness += 8;
  if (count >= 3) completeness += 10;
  else if (count >= 2) completeness += 5;
  if (tail.endsWithDangling) completeness -= 35;
  if (head.startsWithFiller) completeness -= 15;
  const completenessScore = clamp100(completeness);

  // ── shareability (0-100)
  let share = 0.75 * bestQ + 0.25 * secondQ;
  if (tail.quotability >= 45) share += 8;
  const shareScore = clamp100(share);

  // ── standalone (multiplicador)
  const firstTwoAnaphora = head.anaphoraHits + (i0 + 1 <= i1 ? F[i0 + 1].anaphoraHits : 0);
  let standalone = 1;
  if (head.startsWithAnaphora) standalone -= 0.22;
  standalone -= 0.09 * Math.min(3, firstTwoAnaphora);
  standalone -= 0.11 * Math.min(3, externalRefHits);
  standalone = clamp(standalone, STANDALONE_FLOOR, 1);

  // ── foco pedido pelo cliente ("momentos específicos")
  let focusMatch = 0;
  if (ctx.focusTokens.size > 0) {
    let hits = 0;
    for (const t of distinct) if (ctx.focusTokens.has(t)) hits++;
    focusMatch = clamp01(hits / Math.min(6, ctx.focusTokens.size));
  }

  const base =
    WEIGHTS.hook * hookScore +
    WEIGHTS.shareability * shareScore +
    WEIGHTS.value * valueScore +
    WEIGHTS.emotion * emotionScore +
    WEIGHTS.completeness * completenessScore;
  const total = clamp(base * standalone + 10 * focusMatch, 0, 100);

  // ── reprovação dura (o que NUNCA pode virar corte)
  let rejected: string | null = null;
  if (head.logisticsHits > 0) rejected = 'abre em logistica/agradecimento';
  else if (logisticsRatio > MAX_LOGISTICS_RATIO) rejected = 'trecho de logistica';
  // Retomada: "A gente já conversou sobre isso." Pega o espectador no meio de
  // uma conversa que ele não viu — mata a autossuficiência na primeira frase.
  else if (head.externalRefHits > 0) rejected = 'abre retomando assunto de fora';
  else if (head.startsLower) rejected = 'abre no meio de frase (ASR)';
  else if (head.words < MIN_OPENING_WORDS) rejected = 'abre em caco de frase';
  // "Como é que eu posso te falar?" tem 8 palavras e ZERO conteúdo: é fala de
  // preenchimento. Abertura precisa dizer alguma coisa.
  else if (head.contentWords < 2) rejected = 'abre sem conteudo';
  // Trecho em que a maioria das frases é caco ou continuação: a transcrição
  // ali está quebrada demais pra virar corte apresentável, e o texto que sai
  // dele é sempre sem sentido ("Mercado na aí batalha").
  else if (asrRatio > MAX_BROKEN_RATIO) rejected = 'transcricao quebrada no trecho';
  else if (head.startsWithFiller) rejected = 'abre em muleta';
  else if (head.startsWithConnective) rejected = 'abre em conectivo';
  else if (head.startsWithAnaphora) rejected = 'abre em anafora';
  else if (tail.endsWithDangling) rejected = 'termina em conectivo';
  else if (hookScore < MIN_HOOK) rejected = 'gancho fraco';
  else if (total < MIN_TOTAL) rejected = 'nota abaixo do piso';

  return {
    breakdown: {
      hook: hookScore,
      value: valueScore,
      emotion: emotionScore,
      completeness: completenessScore,
      shareability: shareScore,
    },
    standalone,
    total,
    rejected,
    signals: {
      facts,
      hookFact:
        hookFacts.hasMoney ||
        hookFacts.hasPercent ||
        hookFacts.hasTimeQty ||
        hookFacts.hasCountQty ||
        hookFacts.hasBigNumber ||
        hookFacts.hasDigit,
      hookMarker,
      question: hookQuestion,
      imperative: hookImperative,
      contrast: contrastHits > 0,
      emotional: emotionHits > 0 || laughter,
      energyHigh,
      quoteIndex,
      quotability: bestQ,
      endsFinal: tail.endsFinal,
      gapAfterMs: tail.gapAfterMs,
      startsAtBoundary,
      logisticsRatio,
      focusMatch,
      topicId: topics.topicOf[i0] ?? 0,
    },
  };
}

/** Tokens de conteúdo do "momentos específicos" (pra dar peso a quem bate). */
export function focusTokensOf(focusPrompt: string, stopwords: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const t of tokenize(focusPrompt ?? '')) {
    if (isContentToken(t, stopwords)) out.add(t);
  }
  return out;
}
