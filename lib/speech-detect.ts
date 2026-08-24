/**
 * CASABLANCA — Detector de FALA (o motor da Decupagem)
 *
 * POR QUE ESTE ARQUIVO EXISTE
 * ───────────────────────────
 * O detector antigo (`detectSilences` em audio-engine) decidia tudo por ENERGIA:
 * janela de 20 ms, RMS abaixo de um threshold = silêncio. Só que respiração, ar e
 * ruído de boca têm energia de sobra (−40 a −30 dBFS) e o threshold era capado em
 * −34 dBFS — então respiração NUNCA era silêncio. Pior: ela partia a pausa em duas,
 * e cada metade perdia só as bordas. Medido em material real (gravação humana de
 * 48 s): o detector antigo removia 3% do arquivo; sobravam 28 s de não-fala.
 *
 * COMO ESTE DECIDE
 * ────────────────
 * O que separa voz de respiração não é volume, é PERIODICIDADE: voz tem F0 (as
 * pregas vocais vibram, a onda se repete); respiração/ar/estalo é ruído, não se
 * repete. Por frame de 10 ms medimos:
 *
 *   rms         → energia (piso de segurança: não confundir voz baixa com ruído alto)
 *   periodicity → pico da autocorrelação normalizada na faixa de F0 humano (70–400 Hz)
 *   voiceRatio  → fração da energia entre 300–3400 Hz (aceita fricativa forte, tipo /s/)
 *
 * Medido nos mesmos arquivos: fala fica em periodicity 0.70–0.87, respiração em
 * 0.35–0.39 — a fronteira é larga e estável. A decisão usa histerese (entra em fala
 * com critério forte, continua com critério fraco), fecha buracos curtos (a fricativa
 * no meio da palavra não vira corte) e descarta ilhas curtas (estalo isolado).
 *
 * O CORTE
 * ───────
 * Cada intervalo de não-fala com duração ≥ `minGap` vira uma pausa de `keepSilence`
 * segundos — e a pausa que sobrevive é a janela MAIS SILENCIOSA do intervalo, então
 * a respiração que estava ali sai junto. A fala nunca é tocada (padding de segurança
 * nas duas bordas) e cortes curtos demais são ignorados: no vídeo, cada corte é um
 * jump cut, e picotar de 20 em 20 ms deixaria a imagem tremendo.
 *
 * Roda inteiro no browser, sem dependência: FFT radix-2 própria, sinal decimado pra
 * ~11 kHz (a voz cabe folgada) — ~1 s de CPU pra 1 min de áudio.
 */

export type Segment = { start: number; end: number };

export type SpeechDetectConfig = {
  /** dB abaixo da fala de referência: piso pra ENTRAR em fala */
  enterOffsetDb: number;
  /** dB abaixo da fala de referência: piso pra CONTINUAR em fala (histerese) */
  exitOffsetDb: number;
  /** dB abaixo da fala: acima disso, energia alta na banda de voz já conta como fala (fricativa) */
  loudOffsetDb: number;
  /** periodicidade mínima pra ENTRAR em fala */
  periodicityEnter: number;
  /** periodicidade mínima pra CONTINUAR em fala */
  periodicityStay: number;
  /** fração mínima de energia em 300–3400 Hz pra aceitar fricativa sem F0 */
  voiceRatioMin: number;
  /** fecha buracos de não-fala menores que isso (segundos) */
  closeHolesSec: number;
  /** descarta trechos de fala menores que isso (segundos) */
  minSpeechSec: number;
  /** margem intocada em cada borda da fala (segundos) */
  edgePadSec: number;
  /** piso absoluto do intervalo que vale cortar (segundos). O mínimo REAL sai do
   *  keepSilence escolhido (ver planSpeechCut): pedir uma pausa curta tem que
   *  alcançar pausas curtas, senão o controle "não faz nada" em áudio bem falado. */
  minGapSec: number;
  /** não corta pedaço menor que isso — evita jump cut à toa (segundos) */
  minCutSec: number;
};

export const DEFAULT_SPEECH_CONFIG: SpeechDetectConfig = {
  enterOffsetDb: -30,
  exitOffsetDb: -34,
  loudOffsetDb: -12,
  periodicityEnter: 0.55,
  periodicityStay: 0.5,
  voiceRatioMin: 0.3,
  closeHolesSec: 0.18,
  minSpeechSec: 0.1,
  edgePadSec: 0.02,
  minGapSec: 0.11,
  minCutSec: 0.06,
};

const FRAME_MS = 10;
const WINDOW_MS = 32;
const TARGET_RATE = 11025; // a voz cabe folgada; 4× menos CPU que 44.1k

// ---------- FFT (radix-2, in-place) ---------------------------------------

function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len >> 1; k++) {
        const ar = re[i + k];
        const ai = im[i + k];
        const br = re[i + k + (len >> 1)] * cr - im[i + k + (len >> 1)] * ci;
        const bi = re[i + k + (len >> 1)] * ci + im[i + k + (len >> 1)] * cr;
        re[i + k] = ar + br;
        im[i + k] = ai + bi;
        re[i + k + (len >> 1)] = ar - br;
        im[i + k + (len >> 1)] = ai - bi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

// ---------- Features por frame --------------------------------------------

export type FrameFeatures = {
  /** dBFS por frame */
  db: Float32Array;
  /** RMS linear por frame */
  rms: Float32Array;
  /** pico da autocorrelação normalizada (0–1) */
  periodicity: Float32Array;
  /** fração da energia em 300–3400 Hz */
  voiceRatio: Float32Array;
  /** duração de cada frame, em segundos (no tempo ORIGINAL) */
  frameSec: number;
  count: number;
};

/** Decima por média de `factor` amostras (passa-baixa simples + downsample). */
function decimate(data: Float32Array, factor: number): Float32Array {
  if (factor <= 1) return data;
  const n = Math.floor(data.length / factor);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    const b = i * factor;
    for (let k = 0; k < factor; k++) s += data[b + k];
    out[i] = s / factor;
  }
  return out;
}

export function extractFeatures(channel: Float32Array, sampleRate: number): FrameFeatures {
  const factor = Math.max(1, Math.round(sampleRate / TARGET_RATE));
  const x = decimate(channel, factor);
  const sr = sampleRate / factor;

  const hop = Math.max(1, Math.round((FRAME_MS / 1000) * sr));
  const win = Math.max(8, Math.round((WINDOW_MS / 1000) * sr));
  const count = Math.max(0, Math.floor((x.length - win) / hop) + 1);

  const db = new Float32Array(count);
  const rms = new Float32Array(count);
  const periodicity = new Float32Array(count);
  const voiceRatio = new Float32Array(count);
  if (count === 0) {
    return { db, rms, periodicity, voiceRatio, frameSec: FRAME_MS / 1000, count };
  }

  const hann = new Float32Array(win);
  for (let i = 0; i < win; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (win - 1));

  const nSpec = nextPow2(win);
  const nAuto = nextPow2(win * 2);
  const sre = new Float32Array(nSpec);
  const sim = new Float32Array(nSpec);
  const are = new Float32Array(nAuto);
  const aim = new Float32Array(nAuto);
  const frame = new Float32Array(win);

  const binHz = sr / nSpec;
  const loBin = Math.max(1, Math.floor(300 / binHz));
  const hiBin = Math.min(nSpec >> 1, Math.ceil(3400 / binHz));
  const lagMin = Math.max(2, Math.floor(sr / 400)); // F0 até 400 Hz
  const lagMax = Math.min(win - 1, Math.ceil(sr / 70)); // F0 a partir de 70 Hz

  for (let f = 0; f < count; f++) {
    const base = f * hop;
    let sum = 0;
    let mean = 0;
    for (let i = 0; i < win; i++) {
      const v = x[base + i] * hann[i];
      frame[i] = v;
      sum += v * v;
      mean += v;
    }
    mean /= win;
    const r = Math.sqrt(sum / win);
    rms[f] = r;
    db[f] = 20 * Math.log10(r + 1e-12);

    // espectro → razão de energia na banda de voz
    sre.fill(0); sim.fill(0);
    sre.set(frame.subarray(0, win));
    fft(sre, sim);
    let total = 0;
    let band = 0;
    for (let k = 1; k <= nSpec >> 1; k++) {
      const p = sre[k] * sre[k] + sim[k] * sim[k];
      total += p;
      if (k >= loBin && k <= hiBin) band += p;
    }
    voiceRatio[f] = total > 0 ? band / total : 0;

    // autocorrelação (via FFT) do frame sem DC → periodicidade
    are.fill(0); aim.fill(0);
    for (let i = 0; i < win; i++) are[i] = frame[i] - mean;
    fft(are, aim);
    for (let k = 0; k < nAuto; k++) {
      const pr = are[k] * are[k] + aim[k] * aim[k];
      are[k] = pr;
      aim[k] = 0;
    }
    // IFFT = conj(FFT(conj)) / n — como o espectro é real, basta FFT e dividir
    fft(are, aim);
    const ac0 = are[0] / nAuto;
    let best = 0;
    if (ac0 > 1e-12) {
      for (let lag = lagMin; lag <= lagMax; lag++) {
        const v = are[lag] / nAuto;
        if (v > best) best = v;
      }
      periodicity[f] = Math.max(0, Math.min(1, best / ac0));
    } else {
      periodicity[f] = 0;
    }
  }

  return { db, rms, periodicity, voiceRatio, frameSec: hop / sr, count };
}

// ---------- Máscara de fala ------------------------------------------------

function percentile(sorted: Float32Array, p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[i];
}

/** Marca cada frame como fala (true) ou não-fala (false). */
export function detectSpeechMask(
  f: FrameFeatures,
  cfg: SpeechDetectConfig = DEFAULT_SPEECH_CONFIG,
): { mask: Uint8Array; speechRefDb: number } {
  const n = f.count;
  const mask = new Uint8Array(n);
  if (n === 0) return { mask, speechRefDb: -100 };

  const sorted = Float32Array.from(f.db).sort();
  const p75 = percentile(sorted, 0.75);
  const p05 = percentile(sorted, 0.05);
  // referência = mediana do que está acima do p75 (a FALA do arquivo, não o ruído)
  const strong: number[] = [];
  for (let i = 0; i < n; i++) if (f.db[i] > p75) strong.push(f.db[i]);
  strong.sort((a, b) => a - b);
  const speechRef = strong.length ? strong[Math.floor(strong.length / 2)] : sorted[sorted.length - 1];

  // O piso de ruído (p05) levanta o threshold pra não confundir chiado com voz.
  // MAS num áudio que é quase todo fala (típico: uma parte de avatar falando sem
  // parar) o p05 é a própria voz — sem o teto abaixo, o threshold subia ACIMA da
  // fala e o arquivo inteiro virava "não-fala" (0 segmentos → o Pilot mantinha a
  // parte sem cortar nada). Por isso o threshold nunca passa de speechRef − 6 dB.
  const enterDb = Math.min(Math.max(speechRef + cfg.enterOffsetDb, p05 + 6), speechRef - 6);
  const exitDb = Math.min(Math.max(speechRef + cfg.exitOffsetDb, p05 + 3), speechRef - 9);
  const loudDb = speechRef + cfg.loudOffsetDb;

  let on = false;
  for (let i = 0; i < n; i++) {
    const voicedEnter = f.periodicity[i] >= cfg.periodicityEnter && f.db[i] >= enterDb;
    const voicedStay = f.periodicity[i] >= cfg.periodicityStay && f.db[i] >= exitDb;
    // fricativa/plosiva: sem F0, mas energia alta concentrada na banda da voz
    const fricative = f.db[i] >= loudDb && f.voiceRatio[i] >= cfg.voiceRatioMin;
    if (!on && (voicedEnter || fricative)) on = true;
    else if (on && !(voicedStay || fricative)) on = false;
    mask[i] = on ? 1 : 0;
  }

  // fecha buracos curtos (fricativa no meio da palavra não vira corte)
  const closeN = Math.round(cfg.closeHolesSec / f.frameSec);
  for (let i = 0; i < n; ) {
    if (!mask[i]) {
      let j = i;
      while (j < n && !mask[j]) j++;
      if (i > 0 && j < n && j - i <= closeN) mask.fill(1, i, j);
      i = j;
    } else i++;
  }
  // descarta ilhas curtas de "fala" (estalo isolado)
  const minSpeechN = Math.round(cfg.minSpeechSec / f.frameSec);
  for (let i = 0; i < n; ) {
    if (mask[i]) {
      let j = i;
      while (j < n && mask[j]) j++;
      if (j - i < minSpeechN) mask.fill(0, i, j);
      i = j;
    } else i++;
  }

  return { mask, speechRefDb: speechRef };
}

// ---------- Planejamento do corte -----------------------------------------

export type CutPlan = {
  /** trechos a MANTER, em segundos */
  segments: Segment[];
  /** trechos removidos, em segundos */
  removed: Segment[];
  totalSec: number;
  keptSec: number;
  /** quantas pausas foram encurtadas */
  cuts: number;
  speechRefDb: number;
};

/**
 * Monta o plano de corte de um AudioBuffer.
 * `keepSilence` = quanto de pausa FICA no lugar de cada intervalo cortado.
 */
export function planSpeechCut(
  buffer: { getChannelData(ch: number): Float32Array; sampleRate: number; duration: number; length: number },
  keepSilence = 0.08,
  cfgIn?: Partial<SpeechDetectConfig>,
): CutPlan {
  const cfg: SpeechDetectConfig = { ...DEFAULT_SPEECH_CONFIG, ...(cfgIn || {}) };
  const total = buffer.duration || buffer.length / buffer.sampleRate;
  const f = extractFeatures(buffer.getChannelData(0), buffer.sampleRate);
  const { mask, speechRefDb } = detectSpeechMask(f, cfg);
  if (f.count === 0) {
    return { segments: [{ start: 0, end: total }], removed: [], totalSec: total, keptSec: total, cuts: 0, speechRefDb };
  }

  const fs = f.frameSec;
  const padN = Math.round(cfg.edgePadSec / fs);
  const keepN = Math.max(1, Math.round(keepSilence / fs));
  // O intervalo mínimo que vale cortar ACOMPANHA o keepSilence: pra sobrar a pausa
  // pedida ainda é preciso caber as duas bordas intocadas + um corte que valha a
  // pena. Sem isso, o controle da UI não alcançava as pausas curtas — o usuário
  // arrastava de 0.50 até 0.01 e a duração mal mudava em áudio bem falado.
  const minGapSec = Math.max(cfg.minGapSec, keepSilence + 2 * cfg.edgePadSec + cfg.minCutSec);
  const minGapN = Math.round(minGapSec / fs);
  const minCutN = Math.max(1, Math.round(cfg.minCutSec / fs));

  const drops: Array<[number, number]> = [];
  for (let i = 0; i < f.count; ) {
    if (mask[i]) { i++; continue; }
    let j = i;
    while (j < f.count && !mask[j]) j++;
    const gapLen = j - i;
    if (gapLen >= minGapN) {
      const innerA = i + (i > 0 ? padN : 0);
      const innerB = j - (j < f.count ? padN : 0);
      if (innerB - innerA > keepN) {
        // a pausa que sobrevive é a janela mais silenciosa do intervalo:
        // é assim que a respiração some junto com o silêncio.
        let bestOff = 0;
        let bestSum = Infinity;
        let run = 0;
        for (let k = 0; k < keepN && innerA + k < innerB; k++) run += f.rms[innerA + k];
        bestSum = run;
        for (let k = innerA + keepN; k < innerB; k++) {
          run += f.rms[k] - f.rms[k - keepN];
          if (run < bestSum) { bestSum = run; bestOff = k - keepN - innerA + 1; }
        }
        const qa = innerA + bestOff;
        const qb = qa + keepN;
        if (qa - innerA >= minCutN) drops.push([innerA, qa]);
        if (innerB - qb >= minCutN) drops.push([qb, innerB]);
      }
    }
    i = j;
  }

  drops.sort((a, b) => a[0] - b[0]);
  const segments: Segment[] = [];
  const removed: Segment[] = [];
  let cursor = 0;
  for (const [a, b] of drops) {
    const aSec = a * fs;
    const bSec = b * fs;
    if (aSec > cursor) segments.push({ start: cursor, end: aSec });
    removed.push({ start: aSec, end: bSec });
    cursor = bSec;
  }
  if (cursor < total) segments.push({ start: cursor, end: total });

  const clean = segments.filter((s) => s.end - s.start > 0.02).map((s) => ({ start: s.start, end: Math.min(s.end, total) }));
  const keptSec = clean.reduce((n, s) => n + (s.end - s.start), 0);
  return { segments: clean, removed, totalSec: total, keptSec, cuts: drops.length, speechRefDb };
}
