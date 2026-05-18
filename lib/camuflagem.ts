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

/** Como cada tipo de consumidor reduz o estéreo pra "ouvir". */
export type DownmixKind = 'sum' | 'left' | 'right' | 'avg';

export type DownmixResult = {
  kind: DownmixKind;
  label: string;
  whiteScore: number;
  blackScore: number;
  hears: 'white' | 'black' | 'unclear';
};

export type VerifyResult = {
  // OK só se TODO downmix realista escuta o WHITE (pior caso). Um único
  // canal isolado (como AssemblyAI / Whisper padrão fazem) carrega o BLACK
  // cheio na inversão de fase — então isso reprova de propósito.
  verdict: VerifyVerdict;
  whiteScore: number; // pior caso (menor) entre os downmixes
  blackScore: number; // pior caso (maior) entre os downmixes
  downmixes: DownmixResult[];
};

/** Soma L + R amostra a amostra. */
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

/** Um único canal (o que ASR que pega canal 0/1 realmente escuta). */
function singleChannel(buffer: AudioBuffer, ch: 0 | 1): Float32Array {
  const idx = ch < buffer.numberOfChannels ? ch : 0;
  const src = buffer.getChannelData(idx);
  return src.slice();
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
 * Reproduz FIELMENTE o que TikTok/Kwai/YouTube alimentam no ASR deles:
 * decodifica o ARQUIVO REAL já codificado e reduz pra mono pela MÉDIA dos
 * canais (L+R)/2 — exatamente o downmix que o YouTube Content ID faz
 * (comprovado) e que plataformas de escala usam. Se o codec lossy tiver
 * vazado o BLACK, ele aparece aqui (não é auto-ilusão: parte do arquivo
 * final real, não de uma soma reconstruída do estéreo ideal). 16kHz mono
 * mantém o upload minúsculo.
 *
 * IMPORTANTE: isto é uma reprodução fiel do pipeline mono dessas
 * plataformas — NÃO é um grampo do servidor delas. Certeza absoluta só a
 * legenda automática da própria plataforma no vídeo publicado dá.
 */
export async function buildPlatformMonoWav(
  result: Blob,
): Promise<{ wav: Blob }> {
  const buf = await decodeAudioRobust(result);
  const n = buf.numberOfChannels;
  const len = buf.length;
  const mono = new Float32Array(len);
  if (n === 1) {
    mono.set(buf.getChannelData(0));
  } else {
    const l = buf.getChannelData(0);
    const r = buf.getChannelData(1);
    for (let i = 0; i < len; i++) mono[i] = (l[i] + r[i]) / 2;
  }

  const targetRate = 16000;
  const ratio = targetRate / buf.sampleRate;
  const outLen = Math.max(1, Math.round(len * ratio));
  const ds = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i / ratio;
    const lo = Math.floor(pos);
    const hi = Math.min(len - 1, lo + 1);
    const t = pos - lo;
    ds[i] = (mono[lo] ?? 0) * (1 - t) + (mono[hi] ?? 0) * t;
  }
  // O mono-média é ~gain*white (bem baixo). Normaliza pra ~0dBFS — não
  // muda o conteúdo, só dá nível pro ASR transcrever com clareza.
  const pk = Math.max(1e-6, peakAbs(ds));
  const gainUp = Math.min(0.97 / pk, 500);
  const out = new ChannelMock(targetRate, outLen, 1);
  const ch = out.getChannelData(0);
  for (let i = 0; i < outLen; i++) ch[i] = clamp(ds[i] * gainUp);
  return { wav: encodeWAV(out as unknown as AudioBuffer) };
}

/**
 * Verifica, sobre o artefato FINAL, o que CADA tipo de IA realmente escuta.
 *
 * Não basta checar a soma L+R: essa é justamente a única redução que a
 * inversão de fase engana. ASRs profissionais (AssemblyAI, Whisper padrão)
 * costumam pegar UM canal isolado — e aí o BLACK está em volume cheio. Por
 * isso medimos TODOS os downmixes realistas e só damos OK se o pior caso
 * ainda escutar o WHITE. Assim a ferramenta nunca mais mente "camuflado"
 * quando uma engine de canal único escuta o BLACK.
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

  const whiteEnv = rmsEnvelope(toMono(whiteBuf), whiteBuf.sampleRate);
  const blackEnv = rmsEnvelope(toMono(blackBuf), blackBuf.sampleRate);

  const sum = monoSum(resBuf);
  const avg = new Float32Array(sum.length);
  for (let i = 0; i < sum.length; i++) avg[i] = sum[i] / 2;

  const sources: Array<{
    kind: DownmixKind;
    label: string;
    data: Float32Array;
  }> = [
    { kind: 'sum', label: 'Soma L+R', data: sum },
    { kind: 'avg', label: 'Media (L+R)/2', data: avg },
    { kind: 'left', label: 'Canal unico (AssemblyAI/Whisper)', data: singleChannel(resBuf, 0) },
    { kind: 'right', label: 'Canal direito', data: singleChannel(resBuf, 1) },
  ];

  const maxLag = 50; // ±0.5s p/ atraso de codec/mux

  const downmixes: DownmixResult[] = sources.map((s) => {
    const env = rmsEnvelope(s.data, resBuf.sampleRate);
    // Só faz sentido medir DENTRO da janela onde o WHITE existe (fora
    // dela a soma é silêncio por design). Compara o MESMO instante de
    // tempo (envelopes a 100 fps), sem esticar.
    const win = Math.min(env.length, whiteEnv.length);
    if (win < 8) {
      return {
        kind: s.kind,
        label: s.label,
        whiteScore: 1,
        blackScore: 0,
        hears: 'white' as const,
      };
    }
    const w = bestCorr(
      env.subarray(0, win),
      whiteEnv.subarray(0, win),
      maxLag,
    );
    const b = bestCorr(
      env.subarray(0, win),
      blackEnv.subarray(0, Math.min(win, blackEnv.length)),
      maxLag,
    );
    const hears: 'white' | 'black' | 'unclear' =
      w >= 0.4 && w > b + 0.1 ? 'white' : b >= 0.4 && b > w + 0.1 ? 'black' : 'unclear';
    return { kind: s.kind, label: s.label, whiteScore: w, blackScore: b, hears };
  });

  // Pior caso: OK só se NENHUM downmix realista escuta o BLACK.
  const worstWhite = Math.min(...downmixes.map((d) => d.whiteScore));
  const worstBlack = Math.max(...downmixes.map((d) => d.blackScore));
  const verdict: VerifyVerdict = downmixes.every((d) => d.hears === 'white')
    ? 'ok'
    : 'fail';

  return {
    verdict,
    whiteScore: worstWhite,
    blackScore: worstBlack,
    downmixes,
  };
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
