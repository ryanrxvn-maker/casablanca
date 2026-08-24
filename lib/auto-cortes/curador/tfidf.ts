/**
 * AUTO CORTES · CURADOR LOCAL — TF-IDF sobre a própria transcrição.
 *
 * O corpus é o PRÓPRIO VÍDEO: cada frase é um documento. Isso é o que faz o
 * modelo funcionar sem rede e sem treino — "tráfego" é raro num vídeo de
 * culinária e comum num de marketing, e é exatamente essa diferença que
 * separa assunto de conversa fiada.
 *
 * Serve a três coisas:
 *  - `topics.ts`: cosseno entre blocos → fronteira de assunto;
 *  - `score.ts`:  densidade de termo raro → nota de valor;
 *  - `titles.ts`: termos de maior peso → tema, título e hashtags.
 *
 * PURO e determinístico (todo empate desempata por ordem alfabética).
 */

import { NUM_WORDS, tokenize } from './text';

export type TfidfModel = {
  /** nº de frases (documentos) */
  n: number;
  /** tokens de conteúdo por frase (sem stopword) */
  content: string[][];
  /** todos os tokens por frase (com stopword) — usado pra razão de conteúdo */
  all: string[][];
  df: Map<string, number>;
  idf: Map<string, number>;
  /** idf do termo que aparece 1 vez só — teto da normalização */
  maxIdf: number;
  /** vetor tf-idf L2-normalizado por frase */
  vectors: Array<Map<string, number>>;
  /** contagem global por termo (desempate estável em `topTerms`) */
  total: Map<string, number>;
  /** densidade (0..1) de cada FRASE — média do idf dos seus termos distintos */
  sentDensity: number[];
  /** palavras de conteúdo / palavras totais de cada frase */
  sentContentRatio: number[];
};

/** Token que conta como CONTEÚDO: fora da stoplist e com corpo (≥ 3 letras). */
export function isContentToken(t: string, stopwords: Set<string>): boolean {
  if (!t) return false;
  if (stopwords.has(t)) return false;
  if (/^\d[\d.,]*$/.test(t)) return true; // número é conteúdo (dado concreto)
  return t.length >= 3;
}

export function buildTfidf(texts: string[], stopwords: Set<string>): TfidfModel {
  const n = texts.length;
  const all: string[][] = new Array(n);
  const content: string[][] = new Array(n);
  const df = new Map<string, number>();
  const total = new Map<string, number>();

  for (let i = 0; i < n; i++) {
    const toks = tokenize(texts[i]);
    all[i] = toks;
    const c: string[] = [];
    for (const t of toks) if (isContentToken(t, stopwords)) c.push(t);
    content[i] = c;
    const seen = new Set<string>();
    for (const t of c) {
      total.set(t, (total.get(t) ?? 0) + 1);
      if (!seen.has(t)) {
        seen.add(t);
        df.set(t, (df.get(t) ?? 0) + 1);
      }
    }
  }

  const idf = new Map<string, number>();
  for (const [term, d] of df) idf.set(term, Math.log(1 + n / d));
  const maxIdf = Math.log(1 + Math.max(1, n));

  const vectors: Array<Map<string, number>> = new Array(n);
  for (let i = 0; i < n; i++) {
    const tf = new Map<string, number>();
    for (const t of content[i]) tf.set(t, (tf.get(t) ?? 0) + 1);
    const v = new Map<string, number>();
    const len = Math.max(1, content[i].length);
    let norm = 0;
    for (const [t, c] of tf) {
      const w = (c / len) * (idf.get(t) ?? maxIdf);
      v.set(t, w);
      norm += w * w;
    }
    norm = Math.sqrt(norm);
    if (norm > 0) for (const [t, w] of v) v.set(t, w / norm);
    vectors[i] = v;
  }

  // Grandezas POR FRASE. É delas que sai a régua do vídeo — medir por frase e
  // depois tirar a média no corte deixa a nota de valor independente do
  // TAMANHO do corte (senão corte longo acumula termo raro e ganha sempre).
  const sentDensity: number[] = new Array(n);
  const sentContentRatio: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const seen = new Set<string>();
    let sum = 0;
    for (const t of content[i]) {
      if (seen.has(t)) continue;
      seen.add(t);
      sum += (idf.get(t) ?? maxIdf) / maxIdf;
    }
    sentDensity[i] = seen.size === 0 ? 0 : sum / seen.size;
    sentContentRatio[i] = all[i].length === 0 ? 0 : content[i].length / all[i].length;
  }

  return { n, content, all, df, idf, maxIdf, vectors, total, sentDensity, sentContentRatio };
}

/** Cosseno de dois vetores esparsos JÁ normalizados (= produto interno). */
export function cosine(a: Map<string, number>, b: Map<string, number>): number {
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [t, w] of small) {
    const o = big.get(t);
    if (o !== undefined) dot += w * o;
  }
  return dot;
}

/**
 * Vetor de um BLOCO de frases `[from, to]` (inclusive): soma dos tf-idf crus e
 * L2 no fim. Bloco, e não média de frases, porque o assunto é o conjunto.
 */
export function blockVector(model: TfidfModel, from: number, to: number): Map<string, number> {
  const a = Math.max(0, from);
  const b = Math.min(model.n - 1, to);
  const acc = new Map<string, number>();
  if (b < a) return acc;
  for (let i = a; i <= b; i++) {
    const toks = model.content[i];
    const len = Math.max(1, toks.length);
    for (const t of toks) {
      const w = (1 / len) * (model.idf.get(t) ?? model.maxIdf);
      acc.set(t, (acc.get(t) ?? 0) + w);
    }
  }
  let norm = 0;
  for (const w of acc.values()) norm += w * w;
  norm = Math.sqrt(norm);
  if (norm > 0) for (const [t, w] of acc) acc.set(t, w / norm);
  return acc;
}

export type CorpusStats = {
  /** média/desvio da densidade de termo raro POR FRASE — a régua do vídeo */
  meanDensity: number;
  stdDensity: number;
  /** média/desvio da razão de conteúdo POR FRASE */
  meanContentRatio: number;
  stdContentRatio: number;
};

/**
 * A régua do PRÓPRIO vídeo, medida POR FRASE. Sem isso a nota de valor satura:
 * num corpus de 120 frases curtas quase todo termo é "raro" e todo trecho
 * tiraria 95. Medindo o trecho contra a média do vídeo, "denso" volta a
 * significar denso PRA ESTE VÍDEO — que é a única comparação honesta.
 */
export function corpusStats(model: TfidfModel): CorpusStats {
  const dens: number[] = [];
  const cont: number[] = [];
  for (let i = 0; i < model.n; i++) {
    if (model.all[i].length < 3) continue;
    dens.push(model.sentDensity[i]);
    cont.push(model.sentContentRatio[i]);
  }
  const stat = (xs: number[]): { mean: number; std: number } => {
    if (xs.length === 0) return { mean: 0, std: 1 };
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const v = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length;
    const std = Math.sqrt(v);
    return { mean, std: std > 1e-6 ? std : 1 };
  };
  const d = stat(dens);
  const c = stat(cont);
  return {
    meanDensity: d.mean,
    stdDensity: d.std,
    meanContentRatio: c.mean,
    stdContentRatio: c.std,
  };
}

/** Média das densidades das FRASES do trecho (invariante ao tamanho do corte). */
export function clipDensity(model: TfidfModel, from: number, to: number): number {
  const a = Math.max(0, from);
  const b = Math.min(model.n - 1, to);
  let sum = 0;
  let count = 0;
  for (let i = a; i <= b; i++) {
    sum += model.sentDensity[i];
    count++;
  }
  return count === 0 ? 0 : sum / count;
}

export type TermWeight = { term: string; weight: number };

/**
 * Termos mais fortes do trecho: **repetição × raridade**. É a repetição que
 * separa o TEMA do achado solto — um termo raro que apareceu 1 vez é ruído,
 * o que voltou 5 vezes é do que o trecho fala. Empate por ordem alfabética;
 * número puro fica de fora (não vira tema nem hashtag).
 */
export function topTerms(
  model: TfidfModel,
  from: number,
  to: number,
  k: number,
  minDf = 1,
): TermWeight[] {
  const a = Math.max(0, from);
  const b = Math.min(model.n - 1, to);
  const acc = new Map<string, number>();
  for (let i = a; i <= b; i++) {
    const once = new Set<string>();
    for (const t of model.content[i]) {
      if (/^\d/.test(t)) continue;
      if (NUM_WORDS.has(t)) continue; // "dezoito" não é tema, é quantidade
      if (t.length < 4) continue;
      // Termo que aparece numa frase só do VÍDEO INTEIRO é quase sempre erro de
      // ASR ("quai", "tabula") — não vira tema nem hashtag.
      if ((model.df.get(t) ?? 0) < minDf) continue;
      if (once.has(t)) continue; // conta 1 vez por FRASE: tema é o que volta
      once.add(t);               // ao longo do corte, não o que repete na frase
      acc.set(t, (acc.get(t) ?? 0) + (model.idf.get(t) ?? model.maxIdf));
    }
  }
  const out: TermWeight[] = [];
  for (const [term, weight] of acc) out.push({ term, weight });
  out.sort((x, y) => y.weight - x.weight || (x.term < y.term ? -1 : x.term > y.term ? 1 : 0));
  return out.slice(0, Math.max(0, k));
}
