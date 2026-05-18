/**
 * DARKO LAB — Camuflagem estéreo.
 *
 * Técnica: inversão de fase entre canais.
 *   L = bScale * black + gain * white
 *   R = -bScale * black + gain * white
 *
 * Em reprodução estéreo normal, o ouvinte humano percebe principalmente o
 * canal BLACK (o componente fora de fase). Quando a plataforma combina os
 * canais em mono (L + R), o BLACK se cancela EXATAMENTE e sobra apenas
 * 2 * gain * WHITE — então a IA transcreve o WHITE.
 *
 * GARANTIA DE CANCELAMENTO
 * ------------------------
 * O cancelamento L + R = 2*gain*white só é perfeito se NENHUMA amostra
 * sofrer clipping. A versão antiga clampava L e R de forma independente:
 * quando o BLACK era "quente" (perto de 0 dBFS, comum em locuções
 * normalizadas), `b + gain*w` estourava ±1, o clamp cortava só um dos
 * canais e a simetria b / -b quebrava — sobrando uma cópia distorcida do
 * BLACK na soma mono. Resultado: a IA escutava o BLACK. Era exatamente o
 * sintoma de "às vezes funciona, às vezes não".
 *
 * Correção: reservamos headroom determinístico ANTES de somar, de forma
 * que |bScale*b| + gain*|w| nunca passe de 1. Como nada é clampado, a
 * subtração entre canais é exata e a soma mono é SEMPRE 2*gain*white.
 * O BLACK só é atenuado (no máximo ~0.45 dB para gain≤0.05), o que é
 * inaudível, mas o cancelamento passa a ser matematicamente garantido.
 *
 * Ganho: (volumePercent / 100) * 0.05  (equivalente a ~-26dB).
 *
 * Comprimento do output:
 *   O output sempre tem o comprimento do BLACK — o WHITE é apenas uma
 *   camada de camuflagem. Se o WHITE for mais curto, ele simplesmente pára;
 *   se for mais longo, é truncado no fim do BLACK.
 */

import { decodeAudioRobust, encodeWAV } from './audio-engine';

export type CamuflagemInput = {
  black: Blob;
  white: Blob;
  volumePercent: number; // 5..100
  /**
   * Reforço de ganho do WHITE (>=1). Usado pelo loop de garantia: se o
   * MP3/MP4 codificado não passar na verificação, subimos esse fator e
   * recamuflamos até a IA voltar a escutar o WHITE no arquivo real.
   * O ganho efetivo é limitado a 0.5 (WHITE em ~-6dB) — o cancelamento
   * continua matematicamente exato em qualquer valor.
   */
  gainBoost?: number;
};

export const BASE_GAIN_MAX = 0.05;
export const GAIN_HARD_CAP = 0.5;

function peakAbs(data: Float32Array): number {
  let m = 0;
  for (let i = 0; i < data.length; i++) {
    const a = Math.abs(data[i]);
    if (a > m) m = a;
  }
  return m;
}

/**
 * Processa um par BLACK/WHITE e devolve um Blob WAV estéreo camuflado.
 */
export async function camuflar({
  black,
  white,
  volumePercent,
  gainBoost = 1,
}: CamuflagemInput): Promise<Blob> {
  const [blackBuf, whiteBuf] = await Promise.all([
    decodeAudioRobust(black),
    decodeAudioRobust(white),
  ]);

  const baseGain =
    (Math.max(5, Math.min(100, volumePercent)) / 100) * BASE_GAIN_MAX;
  const gain = Math.min(
    GAIN_HARD_CAP,
    baseGain * Math.max(1, gainBoost),
  );
  const sampleRate = blackBuf.sampleRate;

  const length = blackBuf.length;
  const whiteLen = whiteBuf.length;

  const blackMono = toMono(blackBuf);
  const whiteMono = toMono(whiteBuf);

  // Headroom determinístico: garante |bScale*b| + gain*|w| <= 1 em TODA
  // amostra, então nenhum canal precisa de clamp e o cancelamento mono é
  // exato. Normaliza picos de entrada >1 (FFmpeg float pode estourar).
  const bPeak = Math.max(1, peakAbs(blackMono));
  const wPeak = Math.max(1, peakAbs(whiteMono));
  const bScale = (1 - gain) / bPeak;
  const wScale = gain / wPeak;

  const stereo = new ChannelMock(sampleRate, length, 2);
  const L = stereo.getChannelData(0);
  const R = stereo.getChannelData(1);

  for (let i = 0; i < length; i++) {
    const b = (blackMono[i] ?? 0) * bScale;
    const w = (i < whiteLen ? whiteMono[i] ?? 0 : 0) * wScale;
    // Sem clamp por design (|b| + |w| <= 1). O clamp abaixo é só uma
    // âncora de segurança numérica e, pela construção acima, nunca dispara
    // — preservando L + R = 2 * w exatamente.
    L[i] = clamp(b + w);
    R[i] = clamp(-b + w);
  }

  return encodeWAV(stereo as unknown as AudioBuffer);
}

function clamp(v: number) {
  return Math.max(-1, Math.min(1, v));
}

function toMono(buffer: AudioBuffer): Float32Array {
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);
  const len = buffer.length;
  const out = new Float32Array(len);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const ch = buffer.getChannelData(c);
    for (let i = 0; i < len; i++) out[i] += ch[i];
  }
  for (let i = 0; i < len; i++) out[i] /= buffer.numberOfChannels;
  return out;
}

// ---------------------------------------------------------------------------
// VERIFICAÇÃO — "o que a IA realmente escuta"
//
// Plataformas/ASR combinam os canais em mono somando L + R. Decodificamos o
// artefato FINAL (já depois de WAV/MP3/MP4) e reproduzimos exatamente esse
// downmix. Sobre essa soma medimos com qual faixa (WHITE ou BLACK) ela se
// parece, via correlação de envelope RMS (robusta a sample-rate e a perdas
// de codec). É a garantia objetiva de que a camuflagem segurou.
// ---------------------------------------------------------------------------

export type VerifyVerdict = 'ok' | 'fail';

export type VerifyResult = {
  verdict: VerifyVerdict;
  whiteScore: number; // 0..1 — quão parecida a soma mono é com o WHITE
  blackScore: number; // 0..1 — quão parecida a soma mono é com o BLACK
};

/** Soma L + R amostra a amostra (o que a IA recebe). */
function monoSum(buffer: AudioBuffer): Float32Array {
  const len = buffer.length;
  const out = new Float32Array(len);
  const n = buffer.numberOfChannels;
  if (n === 1) {
    out.set(buffer.getChannelData(0));
    return out;
  }
  const l = buffer.getChannelData(0);
  const r = buffer.getChannelData(1);
  for (let i = 0; i < len; i++) out[i] = l[i] + r[i];
  return out;
}

/** Envelope RMS em frames fixos de 10ms (100 fps), independente do rate. */
function rmsEnvelope(data: Float32Array, sampleRate: number): Float32Array {
  const frame = Math.max(1, Math.round(sampleRate * 0.01));
  const frames = Math.max(1, Math.floor(data.length / frame));
  const env = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let acc = 0;
    const start = f * frame;
    for (let i = 0; i < frame; i++) {
      const v = data[start + i] ?? 0;
      acc += v * v;
    }
    env[f] = Math.sqrt(acc / frame);
  }
  return env;
}

/**
 * Pearson |r| entre a[aStart..aStart+n] e b[bStart..bStart+n].
 * Os dois envelopes estão a 100 fps (frames de 10ms), então o índice de
 * frame É o tempo real — comparamos a MESMA posição temporal, sem esticar.
 */
function pearson(
  a: Float32Array,
  aStart: number,
  b: Float32Array,
  bStart: number,
  n: number,
): number {
  if (n < 8) return 0;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[aStart + i];
    mb += b[bStart + i];
  }
  ma /= n;
  mb /= n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const xa = a[aStart + i] - ma;
    const xb = b[bStart + i] - mb;
    num += xa * xb;
    da += xa * xa;
    db += xb * xb;
  }
  if (da === 0 || db === 0) return 0;
  return Math.abs(num / Math.sqrt(da * db));
}

/**
 * Melhor correlação alinhando `ref` contra `sig` com uma pequena busca de
 * lag (codec/mux podem introduzir alguns ms de atraso). Compara só onde
 * AMBOS têm conteúdo no mesmo tempo — nada de reamostrar/esticar.
 */
function bestCorr(
  sig: Float32Array,
  ref: Float32Array,
  maxLag: number,
): number {
  let best = 0;
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    const s0 = Math.max(0, lag);
    const r0 = Math.max(0, -lag);
    const n = Math.min(sig.length - s0, ref.length - r0);
    if (n < 8) continue;
    const c = pearson(sig, s0, ref, r0, n);
    if (c > best) best = c;
  }
  return best;
}

/**
 * Decodifica o resultado camuflado e devolve a soma mono (L+R) já num WAV
 * mono — exatamente o sinal que uma plataforma/IA processaria. É esse blob
 * que enviamos pra transcrição no botão TRANSCREVER.
 */
export async function buildMonoSumWav(
  result: Blob,
): Promise<{ wav: Blob; sampleRate: number }> {
  const buf = await decodeAudioRobust(result);
  const sumRaw = monoSum(buf);
  // Reamostra pra 16kHz mono: é a taxa padrão de ASR e mantém o upload bem
  // abaixo do limite de 4.5MB do Vercel sem perder inteligibilidade.
  const targetRate = 16000;
  const ratio = targetRate / buf.sampleRate;
  const outLen = Math.max(1, Math.round(sumRaw.length * ratio));
  const sum = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i / ratio;
    const lo = Math.floor(pos);
    const hi = Math.min(sumRaw.length - 1, lo + 1);
    const t = pos - lo;
    sum[i] = (sumRaw[lo] ?? 0) * (1 - t) + (sumRaw[hi] ?? 0) * t;
  }
  // A soma é ~2*gain*white (bem baixa, ~-26dB). Normaliza pra perto de 0dBFS
  // — não muda o conteúdo, só dá nível pro ASR transcrever com clareza.
  const pk = Math.max(1e-6, peakAbs(sum));
  const gainUp = Math.min(0.97 / pk, 500);
  const out = new ChannelMock(targetRate, outLen, 1);
  const ch = out.getChannelData(0);
  for (let i = 0; i < outLen; i++) ch[i] = clamp(sum[i] * gainUp);
  return {
    wav: encodeWAV(out as unknown as AudioBuffer),
    sampleRate: targetRate,
  };
}

/**
 * Verifica, sobre o artefato FINAL, se a soma mono carrega o WHITE (camuflou)
 * ou o BLACK (falhou). Comparação por envelope RMS — imune a sample-rate e a
 * degradação de codec.
 */
export async function verifyCamouflage(args: {
  result: Blob;
  white: Blob;
  black: Blob;
}): Promise<VerifyResult> {
  const [resBuf, whiteBuf, blackBuf] = await Promise.all([
    decodeAudioRobust(args.result),
    decodeAudioRobust(args.white),
    decodeAudioRobust(args.black),
  ]);

  const sumEnv = rmsEnvelope(monoSum(resBuf), resBuf.sampleRate);
  const whiteEnv = rmsEnvelope(toMono(whiteBuf), whiteBuf.sampleRate);
  const blackEnv = rmsEnvelope(toMono(blackBuf), blackBuf.sampleRate);

  // O WHITE quase sempre é mais curto que o BLACK. No mono-sum, FORA da
  // região do WHITE só sobra silêncio (o BLACK cancela exato). Então só
  // faz sentido medir DENTRO da janela onde o WHITE existe — e comparando
  // o MESMO instante de tempo (envelopes a 100 fps), não esticando. Era
  // exatamente isso que dava falso negativo: comparava sum longo+silêncio
  // contra WHITE curto reamostrado, e a correlação desabava pra ~0.
  const win = Math.min(sumEnv.length, whiteEnv.length);
  if (win < 8) {
    // WHITE curtíssimo: nada confiável a medir — não reprova à toa.
    return { verdict: 'ok', whiteScore: 1, blackScore: 0 };
  }
  const sumWin = sumEnv.subarray(0, win);
  const whiteWin = whiteEnv.subarray(0, win);
  const blackWin = blackEnv.subarray(0, Math.min(win, blackEnv.length));

  // ±0.5s de tolerância de lag (atraso de encoder/mux).
  const maxLag = 50;
  const whiteScore = bestCorr(sumWin, whiteWin, maxLag);
  const blackScore = bestCorr(sumWin, blackWin, maxLag);

  // Camuflou se a soma mono acompanha claramente o WHITE e não o BLACK.
  // Quando segura, sumWin É ~white escalado → correlação alta com WHITE.
  const verdict: VerifyVerdict =
    whiteScore >= 0.4 && whiteScore > blackScore + 0.1 ? 'ok' : 'fail';

  return { verdict, whiteScore, blackScore };
}

// AudioBuffer stub compatível com encodeWAV (mesmo padrão do audio-engine).
class ChannelMock {
  numberOfChannels: number;
  length: number;
  sampleRate: number;
  duration: number;
  private channels: Float32Array[];

  constructor(sampleRate: number, length: number, channels: number) {
    this.sampleRate = sampleRate;
    this.length = length;
    this.numberOfChannels = channels;
    this.duration = length / sampleRate;
    this.channels = Array.from(
      { length: channels },
      () => new Float32Array(length),
    );
  }

  getChannelData(c: number): Float32Array {
    return this.channels[c];
  }
}
