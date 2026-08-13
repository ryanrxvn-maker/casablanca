/**
 * Relatório antes × depois do Normalizador — métricas + envelope calculados
 * no navegador a partir do PCM mono (Int16, 8kHz) decodado pelo FFmpeg
 * (ver extractReportPcm em ffmpeg-worker.ts).
 *
 * Tudo aqui é PURO (sem DOM, sem ffmpeg): o PCM entra uma vez, vira ~900
 * buckets de envelope (gráficos) + meia dúzia de métricas, e é descartado —
 * nada de guardar minutos de PCM na memória da página.
 *
 * As métricas de FALA usam janelas de 300ms com hop de 100ms (o padrão de
 * loudness momentânea pra voz): o piso de ruído é o percentil 5 das janelas
 * (as pausas), e "fala ativa" é toda janela 12dB acima do piso. A OSCILAÇÃO
 * (a métrica-chave do relatório: quanto o volume da voz balançava) é metade
 * do spread p10–p90 das janelas ativas — robusta a outliers, lida como
 * "±X dB".
 */

/** Shape mínimo da medição EBU do loudnorm (strings cruas do print_format=json). */
export type EbuMeasure = {
  input_i: string;
  input_tp: string;
  input_lra: string;
};

export type AudioReport = {
  durationSec: number;
  /** Envelope pros gráficos: dBFS por bucket (peak e RMS), piso em -70. */
  env: { peak: Float32Array; rms: Float32Array };
  /** Loudness integrada EBU R128 (LUFS); null se a medição não parseou. */
  lufs: number | null;
  /** Loudness range (LU); null sem medição. */
  lra: number | null;
  /** True-peak (dBTP); null sem medição. */
  truePeakDb: number | null;
  /** Pico de sample (dBFS) — sempre disponível (calculado do PCM). */
  peakDb: number;
  /** RMS global (dBFS). */
  rmsDb: number;
  /** Piso de ruído estimado (percentil 5 das janelas de 300ms), dBFS. */
  noiseFloorDb: number;
  /** Nível médio da fala (média de energia das janelas ativas), dBFS. */
  speechLevelDb: number;
  /** Oscilação da fala: ±X dB (metade do spread p10–p90 das janelas ativas). */
  swingDb: number;
};

/** Nº de buckets do envelope (compartilhado com o desenho dos gráficos). */
export const REPORT_BUCKETS = 900;

const DB_FLOOR = -70;

function dbfs(linear: number): number {
  if (!(linear > 0)) return DB_FLOOR;
  return Math.max(DB_FLOOR, 20 * Math.log10(linear));
}

/** Percentil de um array JÁ ORDENADO (ascendente). p em [0,1]. */
function percentileSorted(sorted: number[] | Float64Array, p: number): number {
  const n = sorted.length;
  if (n === 0) return DB_FLOOR;
  const idx = Math.min(n - 1, Math.max(0, Math.round(p * (n - 1))));
  return sorted[idx];
}

function parseEbu(raw?: string): number | null {
  if (raw == null) return null;
  const v = parseFloat(raw);
  return Number.isFinite(v) ? v : null;
}

export function buildAudioReport(
  pcm: Int16Array,
  sampleRate: number,
  ebu?: EbuMeasure | null,
): AudioReport {
  const n = pcm.length;
  const durationSec = n / Math.max(1, sampleRate);

  const empty: AudioReport = {
    durationSec: 0,
    env: { peak: new Float32Array(1), rms: new Float32Array(1) },
    lufs: null,
    lra: null,
    truePeakDb: null,
    peakDb: DB_FLOOR,
    rmsDb: DB_FLOOR,
    noiseFloorDb: DB_FLOOR,
    speechLevelDb: DB_FLOOR,
    swingDb: 0,
  };
  empty.env.peak[0] = DB_FLOOR;
  empty.env.rms[0] = DB_FLOOR;
  if (n === 0) return empty;

  // ---- Envelope por bucket (gráficos) + agregados globais -----------------
  const buckets = Math.max(1, Math.min(REPORT_BUCKETS, n));
  const peakEnv = new Float32Array(buckets);
  const rmsEnv = new Float32Array(buckets);
  const perBucket = n / buckets;
  let globalPeak = 0;
  let globalSumSq = 0;
  for (let b = 0; b < buckets; b++) {
    const start = Math.floor(b * perBucket);
    const end = Math.max(start + 1, Math.min(n, Math.floor((b + 1) * perBucket)));
    let pk = 0;
    let sum = 0;
    for (let i = start; i < end; i++) {
      const v = Math.abs(pcm[i]) / 32768;
      if (v > pk) pk = v;
      sum += v * v;
    }
    const cnt = end - start;
    peakEnv[b] = dbfs(pk);
    rmsEnv[b] = dbfs(Math.sqrt(sum / cnt));
    if (pk > globalPeak) globalPeak = pk;
    globalSumSq += sum;
  }

  // ---- Janelas de 300ms / hop 100ms (métricas de fala) --------------------
  // Energia por bloco de hop (O(n) uma vez), janela = soma de 3 blocos.
  const hop = Math.max(1, Math.round(0.1 * sampleRate));
  const blocksPerWin = 3;
  const nBlocks = Math.floor(n / hop);
  const windows: number[] = [];
  if (nBlocks >= blocksPerWin) {
    const blockEnergy = new Float64Array(nBlocks);
    for (let bIdx = 0; bIdx < nBlocks; bIdx++) {
      let s = 0;
      const st = bIdx * hop;
      const en = st + hop;
      for (let i = st; i < en; i++) {
        const v = pcm[i] / 32768;
        s += v * v;
      }
      blockEnergy[bIdx] = s;
    }
    for (let bIdx = 0; bIdx + blocksPerWin <= nBlocks; bIdx++) {
      let s = 0;
      for (let k = 0; k < blocksPerWin; k++) s += blockEnergy[bIdx + k];
      windows.push(dbfs(Math.sqrt(s / (blocksPerWin * hop))));
    }
  } else {
    windows.push(dbfs(Math.sqrt(globalSumSq / n)));
  }

  const sorted = windows.slice().sort((a, b) => a - b);
  const noiseFloorDb = percentileSorted(sorted, 0.05);
  // Gate de fala: 12dB acima do piso (piso muito baixo → trava em -55 pra não
  // classificar respiração/ambiente como fala). Se quase nada passar (ex.:
  // fala contínua sem pausa → piso superestimado), relaxa pra mediana.
  const gate = Math.max(noiseFloorDb + 12, -55);
  let active = windows.filter((d) => d > gate);
  if (active.length < 5) {
    const median = percentileSorted(sorted, 0.5);
    active = windows.filter((d) => d >= median);
  }

  let speechLevelDb: number;
  let swingDb = 0;
  if (active.length > 0) {
    let e = 0;
    for (const d of active) e += Math.pow(10, d / 10);
    speechLevelDb = 10 * Math.log10(e / active.length);
    const actSorted = active.slice().sort((a, b) => a - b);
    if (actSorted.length >= 5) {
      swingDb =
        (percentileSorted(actSorted, 0.9) - percentileSorted(actSorted, 0.1)) / 2;
    }
  } else {
    speechLevelDb = dbfs(Math.sqrt(globalSumSq / n));
  }

  return {
    durationSec,
    env: { peak: peakEnv, rms: rmsEnv },
    lufs: parseEbu(ebu?.input_i),
    lra: parseEbu(ebu?.input_lra),
    truePeakDb: parseEbu(ebu?.input_tp),
    peakDb: dbfs(globalPeak),
    rmsDb: dbfs(Math.sqrt(globalSumSq / n)),
    noiseFloorDb,
    speechLevelDb,
    swingDb,
  };
}
