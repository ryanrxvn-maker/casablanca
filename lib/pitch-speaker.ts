/**
 * Separação de locutores por TOM DE VOZ (F0/pitch) — determinística, local.
 *
 * POR QUE EXISTE (2026-06-11): a diarização da AssemblyAI se mostrou
 * instável nos ADs reais (rotulava trechos do Doutor como a mulher do
 * depoimento, mesmo com áudio 48k + voz filtrada). Pro caso dominante de
 * VA multi-avatar — papel principal masculino + depoimento feminino — a
 * frequência fundamental da voz (homem ~85-155Hz, mulher ~165-255Hz) é um
 * discriminador FÍSICO, não estatístico: autocorrelação por janela, mediana
 * por utterance, k-means 1D com k=2. Quando os dois clusters são bem
 * separados, o pitch DECIDE quem fala; a AssemblyAI fica só com o texto e
 * os timestamps. Quando a separação é fraca (locutores do mesmo sexo),
 * devolve confident=false e o caller mantém os labels da AssemblyAI.
 */

export type PitchUtt = { start: number; end: number };

export type PitchClusterResult = {
  /** true = separação clara por pitch — use ranks como verdade */
  confident: boolean;
  /** por utterance: rank do locutor (0 = quem MAIS fala no total) */
  ranks: number[] | null;
  /** F0 médio (Hz) por rank, pra log/UI */
  clusterHz: number[] | null;
  /** explicação curta (log/painel) */
  reason: string;
};

/** Decima o canal pra ~8kHz (boxcar + pick) — barateia a autocorrelação
 *  sem perder F0 de voz (60-400Hz precisa de bem menos que 4kHz Nyquist). */
function decimate(channel: Float32Array, sampleRate: number): { data: Float32Array; sr: number } {
  const factor = Math.max(1, Math.floor(sampleRate / 8000));
  if (factor === 1) return { data: channel, sr: sampleRate };
  const out = new Float32Array(Math.floor(channel.length / factor));
  for (let i = 0; i < out.length; i++) {
    let acc = 0;
    const base = i * factor;
    for (let j = 0; j < factor; j++) acc += channel[base + j];
    out[i] = acc / factor;
  }
  return { data: out, sr: sampleRate / factor };
}

/** F0 mediano (Hz) de um trecho [startSec, endSec] via autocorrelação
 *  normalizada por janelas de 40ms (hop 20ms). Retorna null se o trecho
 *  não tem periodicidade clara suficiente (ruído/silêncio). */
export function medianF0(
  data: Float32Array,
  sr: number,
  startSec: number,
  endSec: number,
): number | null {
  const frame = Math.floor(sr * 0.04);
  const hop = Math.floor(sr * 0.02);
  const minF = 60;
  const maxF = 400;
  const minLag = Math.floor(sr / maxF);
  const maxLag = Math.min(Math.ceil(sr / minF), frame - 1);
  const s = Math.max(0, Math.floor(startSec * sr));
  const e = Math.min(data.length, Math.floor(endSec * sr));
  if (e - s < frame) return null;

  // energia média do trecho — gate relativo (voz filtrada pode estar baixa)
  let totalEnergy = 0;
  for (let i = s; i < e; i++) totalEnergy += data[i] * data[i];
  const meanEnergy = totalEnergy / (e - s);
  const gate = Math.max(meanEnergy * 0.25, 1e-7);

  const f0s: number[] = [];
  for (let i = s; i + frame <= e; i += hop) {
    let energy = 0;
    for (let j = 0; j < frame; j++) energy += data[i + j] * data[i + j];
    energy /= frame;
    if (energy < gate) continue;

    let bestLag = -1;
    let bestVal = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let num = 0;
      let den1 = 0;
      let den2 = 0;
      const lim = frame - lag;
      for (let j = 0; j < lim; j++) {
        const a = data[i + j];
        const b = data[i + j + lag];
        num += a * b;
        den1 += a * a;
        den2 += b * b;
      }
      const corr = num / (Math.sqrt(den1 * den2) + 1e-9);
      if (corr > bestVal) {
        bestVal = corr;
        bestLag = lag;
      }
    }
    if (bestLag > 0 && bestVal > 0.55) f0s.push(sr / bestLag);
  }
  if (f0s.length < 3) return null;
  f0s.sort((a, b) => a - b);
  return f0s[Math.floor(f0s.length / 2)];
}

/**
 * Clusteriza utterances em 2 locutores pelo F0 mediano de cada uma.
 * confident=true só quando:
 *   - >= 2 utterances com F0 estimável
 *   - gap relativo entre os 2 centros > 18% (homem/mulher fica ~40-60%)
 *   - o cluster minoritário tem >= 3s de fala total (anti-outlier)
 */
export function clusterUtterancesByPitch(
  channel: Float32Array,
  sampleRate: number,
  utts: PitchUtt[],
  expectedSpeakers = 2,
): PitchClusterResult {
  if (expectedSpeakers !== 2) {
    return { confident: false, ranks: null, clusterHz: null, reason: `pitch só suporta 2 locutores (doc pede ${expectedSpeakers})` };
  }
  if (!utts.length) return { confident: false, ranks: null, clusterHz: null, reason: 'sem utterances' };

  const { data, sr } = decimate(channel, sampleRate);

  // F0 por utterance — analisa no máximo 12s do MIOLO (bordas têm overlap
  // de locutores/respiração)
  const f0ByUtt: (number | null)[] = utts.map((u) => {
    const dur = u.end - u.start;
    let s = u.start;
    let e = u.end;
    if (dur > 12) {
      const mid = (u.start + u.end) / 2;
      s = mid - 6;
      e = mid + 6;
    } else if (dur > 2) {
      // tira 10% de cada borda
      s = u.start + dur * 0.1;
      e = u.end - dur * 0.1;
    }
    return medianF0(data, sr, s, e);
  });

  const valid = f0ByUtt
    .map((f0, i) => ({ f0, i }))
    .filter((x): x is { f0: number; i: number } => x.f0 !== null);
  if (valid.length < 2) {
    return { confident: false, ranks: null, clusterHz: null, reason: `só ${valid.length} utterance(s) com F0 estimável` };
  }

  // k-means 1D, k=2, init nos extremos
  const f0s = valid.map((v) => v.f0);
  let c0 = Math.min(...f0s);
  let c1 = Math.max(...f0s);
  let assign = new Array<number>(valid.length).fill(0);
  for (let iter = 0; iter < 30; iter++) {
    let changed = false;
    for (let i = 0; i < valid.length; i++) {
      const a = Math.abs(valid[i].f0 - c0) <= Math.abs(valid[i].f0 - c1) ? 0 : 1;
      if (a !== assign[i]) { assign[i] = a; changed = true; }
    }
    let s0 = 0, n0 = 0, s1 = 0, n1 = 0;
    for (let i = 0; i < valid.length; i++) {
      if (assign[i] === 0) { s0 += valid[i].f0; n0++; }
      else { s1 += valid[i].f0; n1++; }
    }
    if (n0 === 0 || n1 === 0) {
      return { confident: false, ranks: null, clusterHz: null, reason: 'cluster vazio (F0 homogêneo — provavelmente 1 locutor ou mesmo sexo)' };
    }
    c0 = s0 / n0;
    c1 = s1 / n1;
    if (!changed) break;
  }

  // Confiança: gap relativo + tamanho mínimo do cluster minoritário
  const gap = Math.abs(c1 - c0) / ((c1 + c0) / 2);
  if (gap < 0.18) {
    return { confident: false, ranks: null, clusterHz: null, reason: `gap de pitch fraco (${(gap * 100).toFixed(0)}% — ${c0.toFixed(0)}Hz vs ${c1.toFixed(0)}Hz)` };
  }
  const talkByCluster = [0, 0];
  for (let i = 0; i < valid.length; i++) {
    const u = utts[valid[i].i];
    talkByCluster[assign[i]] += u.end - u.start;
  }
  const minorTalk = Math.min(talkByCluster[0], talkByCluster[1]);
  if (minorTalk < 3) {
    return { confident: false, ranks: null, clusterHz: null, reason: `cluster minoritário com só ${minorTalk.toFixed(1)}s de fala (anti-outlier)` };
  }

  // rank: 0 = cluster que MAIS fala (papel principal)
  const rankOfCluster = talkByCluster[0] >= talkByCluster[1] ? [0, 1] : [1, 0];
  const ranks = new Array<number>(utts.length).fill(0);
  const clusterByUttIdx = new Map<number, number>();
  for (let i = 0; i < valid.length; i++) clusterByUttIdx.set(valid[i].i, assign[i]);
  for (let i = 0; i < utts.length; i++) {
    const cl = clusterByUttIdx.get(i);
    if (cl !== undefined) {
      ranks[i] = rankOfCluster[cl];
    } else {
      // F0 não estimável (trecho curto/ruidoso): herda o VIZINHO anterior
      // (continuação da mesma fala é o caso comum); primeiro vai pro principal
      ranks[i] = i > 0 ? ranks[i - 1] : 0;
    }
  }
  const clusterHz = rankOfCluster[0] === 0 ? [c0, c1] : [c1, c0];
  return {
    confident: true,
    ranks,
    clusterHz,
    reason: `pitch separou ${clusterHz[0].toFixed(0)}Hz (principal) vs ${clusterHz[1].toFixed(0)}Hz (secundário) · gap ${(gap * 100).toFixed(0)}%`,
  };
}
