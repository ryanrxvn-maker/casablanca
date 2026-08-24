/**
 * AUTO CORTES · CURADOR LOCAL — fronteira de assunto (TextTiling sobre TF-IDF).
 *
 * O que o Opus Clip faz bem e parece mágica é achar ONDE um assunto começa e
 * termina. Isso é medição, não geração: se as 6 frases antes de uma junta
 * falam de uma coisa e as 6 depois falam de outra, o cosseno entre os dois
 * blocos DESPENCA. Onde o vale é fundo (comparado aos picos vizinhos), tem
 * fronteira.
 *
 * Dois sinais entram:
 *  1. o vale de similaridade (semântico);
 *  2. pausa longa na fala (≥ 1,5 s) — respiro humano é fronteira mesmo quando
 *     o vocabulário não muda.
 *
 * PURO e determinístico.
 */

import type { Sentence } from '../types';
import { blockVector, cosine, type TfidfModel } from './tfidf';

/** Frases de cada lado da junta na comparação de blocos. */
export const DEFAULT_BLOCK_K = 6;
/** Pausa que força fronteira mesmo sem mudança de vocabulário. */
export const HARD_PAUSE_MS = 1500;
/** Nenhum assunto tem menos que isto (senão vira confete de fronteira). */
export const MIN_SEGMENT_SENTENCES = 3;

export type TopicMap = {
  /** índices de frase em que um assunto COMEÇA (sempre inclui 0) */
  boundaries: number[];
  /** id do assunto (0..n) de cada frase */
  topicOf: number[];
  isBoundary: boolean[];
  /** fronteira que veio de PAUSA LONGA (corte de cena) — nenhum corte a atravessa */
  forced: boolean[];
  /** similaridade dos blocos em cada junta (índice = frase que abre o bloco direito) */
  sim: number[];
  /** profundidade do vale em cada junta */
  depth: number[];
  /** limiar usado (média + 0,5·desvio) */
  threshold: number;
};

export type FindTopicsOpts = {
  k?: number;
  hardPauseMs?: number;
  minSegment?: number;
  /** desvios acima da média pra virar fronteira */
  sensitivity?: number;
};

/**
 * `boundaries[0]` é sempre 0. Uma junta `g` significa "a frase g abre um
 * assunto novo", então o assunto anterior termina em `g - 1`.
 */
export function findTopics(
  model: TfidfModel,
  sentences: Sentence[],
  opts: FindTopicsOpts = {},
): TopicMap {
  const n = sentences.length;
  const sim = new Array<number>(n).fill(1);
  const depth = new Array<number>(n).fill(0);
  const isBoundary = new Array<boolean>(n).fill(false);

  const forced = new Array<boolean>(n).fill(false);

  if (n === 0) {
    return { boundaries: [], topicOf: [], isBoundary, forced, sim, depth, threshold: 0 };
  }
  if (n < 4) {
    isBoundary[0] = true;
    return {
      boundaries: [0],
      topicOf: new Array<number>(n).fill(0),
      isBoundary,
      forced,
      sim,
      depth,
      threshold: 0,
    };
  }

  const k = Math.max(2, Math.min(opts.k ?? DEFAULT_BLOCK_K, Math.floor(n / 4)));
  const hardPauseMs = opts.hardPauseMs ?? HARD_PAUSE_MS;
  const minSegment = Math.max(1, opts.minSegment ?? MIN_SEGMENT_SENTENCES);
  const sensitivity = opts.sensitivity ?? 0.5;

  // 1. similaridade bloco-a-bloco em cada junta
  for (let g = 1; g < n; g++) {
    const left = blockVector(model, g - k, g - 1);
    const right = blockVector(model, g, g + k - 1);
    sim[g] = cosine(left, right);
  }

  // 2. profundidade do vale: (pico à esquerda − vale) + (pico à direita − vale)
  for (let g = 1; g < n; g++) {
    let hl = sim[g];
    for (let i = g - 1; i >= 1 && sim[i] >= hl; i--) hl = sim[i];
    let hr = sim[g];
    for (let i = g + 1; i < n && sim[i] >= hr; i++) hr = sim[i];
    depth[g] = hl - sim[g] + (hr - sim[g]);
  }

  // 3. limiar = média + sensibilidade × desvio (só sobre as juntas reais)
  let sum = 0;
  let count = 0;
  for (let g = 1; g < n; g++) {
    sum += depth[g];
    count++;
  }
  const mean = count > 0 ? sum / count : 0;
  let variance = 0;
  for (let g = 1; g < n; g++) variance += (depth[g] - mean) ** 2;
  variance = count > 0 ? variance / count : 0;
  const threshold = mean + sensitivity * Math.sqrt(variance);

  // 4. candidatas: vale fundo OU pausa longa antes da frase
  type Cand = { g: number; depth: number; forced: boolean };
  const cands: Cand[] = [];
  for (let g = 1; g < n; g++) {
    const pause = sentences[g].startMs - sentences[g - 1].endMs;
    const isForced = pause >= hardPauseMs;
    if (isForced) forced[g] = true;
    if (isForced || depth[g] > threshold) cands.push({ g, depth: depth[g], forced: isForced });
  }

  // 5. segmento mínimo: entre duas fronteiras coladas fica a mais forte
  //    (pausa longa é sinal físico e ganha do vale semântico)
  const chosen: number[] = [0];
  const strength = (c: Cand) => (c.forced ? 1000 + c.depth : c.depth);
  for (const c of cands) {
    const last = chosen[chosen.length - 1];
    if (c.g - last >= minSegment) {
      chosen.push(c.g);
      continue;
    }
    if (last === 0) continue; // nunca desloca a fronteira inicial
    const prev = cands.find((x) => x.g === last);
    if (prev && strength(c) > strength(prev)) chosen[chosen.length - 1] = c.g;
  }

  for (const g of chosen) isBoundary[g] = true;

  const topicOf = new Array<number>(n).fill(0);
  let t = -1;
  for (let i = 0; i < n; i++) {
    if (isBoundary[i]) t++;
    topicOf[i] = Math.max(0, t);
  }

  return { boundaries: chosen, topicOf, isBoundary, forced, sim, depth, threshold };
}
