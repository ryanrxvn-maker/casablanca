/**
 * Separação de locutores por TOM DE VOZ ao nível de PALAVRA.
 *
 * Diferença do pitch-speaker (por utterance):
 *  - Calcula um CONTORNO de F0 contínuo sobre TODO o áudio (hop 10ms) e
 *    junta TODOS os frames vozeados num único 2-means → centróides muito
 *    mais estáveis que a mediana por utterance curta (que falhava no áudio
 *    real bandpass; user reportou 2026-06-11).
 *  - Atribui cada PALAVRA pelo F0 mediano dos frames dentro dela.
 *  - Como cada palavra é classificada inteira e os cortes caem nos GAPS
 *    entre palavras, é FISICAMENTE IMPOSSÍVEL uma palavra de um locutor
 *    vazar pro outro (requisito do user: zero vazamento, jamais).
 */

export type PitchWord = { text: string; start: number; end: number };

export type PitchWordsResult = {
  confident: boolean;
  /** por palavra: cluster 0 = loHz, 1 = hiHz, -1 = sem F0 (herda vizinho) */
  clusters: number[];
  /** [F0 cluster 0 (loHz), F0 cluster 1 (hiHz)] */
  clusterHz: [number, number] | null;
  reason: string;
};

/** Decima pra ~8kHz (autocorrelação de F0 60-400Hz não precisa mais). */
function decimate(ch: Float32Array, sr: number): { data: Float32Array; sr: number } {
  const factor = Math.max(1, Math.floor(sr / 8000));
  if (factor === 1) return { data: ch, sr };
  const out = new Float32Array(Math.floor(ch.length / factor));
  for (let i = 0; i < out.length; i++) {
    let acc = 0;
    const base = i * factor;
    for (let j = 0; j < factor; j++) acc += ch[base + j];
    out[i] = acc / factor;
  }
  return { data: out, sr: sr / factor };
}

/** Contorno de F0: um valor (Hz) ou 0 por frame (hop 10ms). */
function f0Contour(data: Float32Array, sr: number): { f0: Float32Array; hopSec: number } {
  const frame = Math.floor(sr * 0.04);
  const hop = Math.floor(sr * 0.01);
  const minF = 60, maxF = 400;
  const minLag = Math.floor(sr / maxF);
  const maxLag = Math.min(Math.ceil(sr / minF), frame - 1);
  const nFrames = Math.max(0, Math.floor((data.length - frame) / hop) + 1);
  const f0 = new Float32Array(nFrames);

  // gate de energia adaptativo: mediana da energia dos frames * fator
  const energies = new Float32Array(nFrames);
  for (let f = 0; f < nFrames; f++) {
    const i = f * hop;
    let e = 0;
    for (let j = 0; j < frame; j++) e += data[i + j] * data[i + j];
    energies[f] = e / frame;
  }
  const sortedE = Array.from(energies).sort((a, b) => a - b);
  const medE = sortedE[Math.floor(sortedE.length / 2)] || 0;
  const gate = Math.max(medE * 0.5, 1e-8);

  for (let f = 0; f < nFrames; f++) {
    if (energies[f] < gate) continue;
    const i = f * hop;
    let bestLag = -1, bestVal = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let num = 0, d1 = 0, d2 = 0;
      const lim = frame - lag;
      for (let j = 0; j < lim; j++) {
        const a = data[i + j], b = data[i + j + lag];
        num += a * b; d1 += a * a; d2 += b * b;
      }
      const corr = num / (Math.sqrt(d1 * d2) + 1e-9);
      if (corr > bestVal) { bestVal = corr; bestLag = lag; }
    }
    if (bestLag > 0 && bestVal > 0.5) f0[f] = sr / bestLag;
  }
  return { f0, hopSec: hop / sr };
}

/** 2-means 1D, k=2, init nos quantis 25/75 (robusto a outliers). */
function twoMeans(values: number[]): { c0: number; c1: number; assign: number[] } | null {
  if (values.length < 2) return null;
  const sorted = [...values].sort((a, b) => a - b);
  let c0 = sorted[Math.floor(sorted.length * 0.25)];
  let c1 = sorted[Math.floor(sorted.length * 0.75)];
  if (c0 === c1) { c0 = sorted[0]; c1 = sorted[sorted.length - 1]; }
  const assign = new Array<number>(values.length).fill(0);
  for (let it = 0; it < 40; it++) {
    let changed = false;
    for (let i = 0; i < values.length; i++) {
      const a = Math.abs(values[i] - c0) <= Math.abs(values[i] - c1) ? 0 : 1;
      if (a !== assign[i]) { assign[i] = a; changed = true; }
    }
    let s0 = 0, n0 = 0, s1 = 0, n1 = 0;
    for (let i = 0; i < values.length; i++) {
      if (assign[i] === 0) { s0 += values[i]; n0++; } else { s1 += values[i]; n1++; }
    }
    if (n0 === 0 || n1 === 0) return null;
    c0 = s0 / n0; c1 = s1 / n1;
    if (!changed) break;
  }
  return c0 <= c1 ? { c0, c1, assign } : { c0: c1, c1: c0, assign: assign.map((a) => (a === 0 ? 1 : 0)) };
}

function median(arr: number[]): number {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/**
 * @param channel  canal 0 (voz isolada de preferência)
 * @param words    palavras com start/end em SEGUNDOS
 */
export function clusterWordsByPitch(
  channel: Float32Array,
  sampleRate: number,
  words: PitchWord[],
): PitchWordsResult {
  if (!words.length) return { confident: false, clusters: [], clusterHz: null, reason: 'sem palavras' };
  const { data, sr } = decimate(channel, sampleRate);
  const { f0, hopSec } = f0Contour(data, sr);

  // F0 mediano por palavra (frames dentro de [start,end])
  const f0ByWord: (number | null)[] = words.map((w) => {
    const a = Math.floor(w.start / hopSec);
    const b = Math.ceil(w.end / hopSec);
    const vals: number[] = [];
    for (let f = a; f < b && f < f0.length; f++) if (f0[f] > 0) vals.push(f0[f]);
    return vals.length >= 2 ? median(vals) : null;
  });

  // 2-means sobre os F0 de palavra válidos (pool global = estável)
  const valid = f0ByWord
    .map((v, i) => ({ v, i }))
    .filter((x): x is { v: number; i: number } => x.v !== null);
  if (valid.length < 2) {
    return { confident: false, clusters: words.map(() => -1), clusterHz: null, reason: `só ${valid.length} palavra(s) com F0` };
  }
  const km = twoMeans(valid.map((x) => x.v));
  if (!km) {
    return { confident: false, clusters: words.map(() => -1), clusterHz: null, reason: 'F0 homogêneo (1 locutor ou mesmo sexo)' };
  }
  const gap = Math.abs(km.c1 - km.c0) / ((km.c0 + km.c1) / 2);
  // gap menor que homem/mulher (~40-60%) mas firme o bastante p/ 2 vozes
  if (gap < 0.15) {
    return { confident: false, clusters: words.map(() => -1), clusterHz: [km.c0, km.c1], reason: `gap fraco (${(gap * 100).toFixed(0)}% — ${km.c0.toFixed(0)} vs ${km.c1.toFixed(0)}Hz)` };
  }

  // cluster por palavra (nearest centroid); sem F0 → -1 (herda vizinho depois)
  const clusters = f0ByWord.map((v) => {
    if (v === null) return -1;
    return Math.abs(v - km.c0) <= Math.abs(v - km.c1) ? 0 : 1;
  });
  // herda vizinho anterior pros -1 (continuação de fala)
  for (let i = 0; i < clusters.length; i++) {
    if (clusters[i] === -1) clusters[i] = i > 0 ? clusters[i - 1] : (clusters.find((c) => c >= 0) ?? 0);
  }
  // anti-outlier: o cluster minoritário precisa de >=3 palavras
  let n0 = 0, n1 = 0;
  for (const c of clusters) { if (c === 0) n0++; else if (c === 1) n1++; }
  if (Math.min(n0, n1) < 3) {
    return { confident: false, clusters: words.map(() => -1), clusterHz: [km.c0, km.c1], reason: `cluster minoritário com só ${Math.min(n0, n1)} palavra(s)` };
  }

  return {
    confident: true,
    clusters,
    clusterHz: [km.c0, km.c1],
    reason: `F0 por palavra: ${km.c0.toFixed(0)}Hz vs ${km.c1.toFixed(0)}Hz · gap ${(gap * 100).toFixed(0)}% · ${valid.length} palavras com tom`,
  };
}

/**
 * Constrói SEGMENTOS role-homogêneos a partir dos clusters por palavra.
 * Cada segmento é um run contíguo de palavras do mesmo cluster; o corte
 * fica no MEIO do gap entre a última palavra de um e a primeira do
 * próximo (silêncio) — zero vazamento. Bordas estendidas pra cobrir todo
 * o áudio. Funde micro-runs (<minWords) no vizinho (erro de F0 numa
 * palavra solta não vira troca de locutor).
 */
export function wordsToRoleSegments(
  words: PitchWord[],
  clusters: number[],
  totalDur: number,
  minWordsPerRun = 2,
): Array<{ start: number; end: number; cluster: number; text: string }> {
  if (!words.length) return [];
  // 1. runs por cluster
  type Run = { startIdx: number; endIdx: number; cluster: number };
  const runs: Run[] = [];
  for (let i = 0; i < words.length; i++) {
    const last = runs[runs.length - 1];
    if (last && last.cluster === clusters[i]) last.endIdx = i;
    else runs.push({ startIdx: i, endIdx: i, cluster: clusters[i] });
  }
  // 2. funde micro-runs (provável erro de F0) no run anterior
  const merged: Run[] = [];
  for (const r of runs) {
    const len = r.endIdx - r.startIdx + 1;
    const last = merged[merged.length - 1];
    if (last && (len < minWordsPerRun)) {
      last.endIdx = r.endIdx; // absorve no anterior, mantém o cluster do anterior
    } else if (last && last.cluster === r.cluster) {
      last.endIdx = r.endIdx;
    } else {
      merged.push({ ...r });
    }
  }
  // primeiro run minúsculo: absorve no próximo
  if (merged.length > 1 && (merged[0].endIdx - merged[0].startIdx + 1) < minWordsPerRun) {
    merged[1].startIdx = merged[0].startIdx;
    merged.shift();
  }
  // 3. boundaries nos gaps + cobertura total
  const segs = merged.map((r) => ({
    start: words[r.startIdx].start,
    end: words[r.endIdx].end,
    cluster: r.cluster,
    text: words.slice(r.startIdx, r.endIdx + 1).map((w) => w.text).join(' '),
  }));
  for (let i = 0; i < segs.length; i++) {
    if (i === 0) segs[i].start = 0;
    if (i === segs.length - 1) segs[i].end = totalDur;
    if (i > 0) {
      const mid = (segs[i - 1].end + segs[i].start) / 2;
      segs[i - 1].end = mid;
      segs[i].start = mid;
    }
  }
  return segs;
}
