/**
 * DARKO LAB — Camuflagem estéreo.
 *
 * Técnica: inversão de fase entre canais.
 *   L = black + gain * white
 *   R = -black + gain * white
 *
 * Em reprodução estéreo normal, o ouvinte humano percebe principalmente o
 * canal BLACK (o componente em fase). Quando a plataforma combina os canais
 * em mono (L + R), o BLACK se cancela e sobra apenas 2 * gain * WHITE.
 *
 * Ganho: (volumePercent / 100) * 0.05  (equivalente a ~-26dB).
 *
 * Comprimento do output:
 *   O output sempre tem o comprimento do BLACK — o WHITE é apenas uma camada
 *   de camuflagem. Se o WHITE for mais curto, ele simplesmente pára (silêncio
 *   no overlay); se for mais longo, é truncado no fim do BLACK. O BLACK
 *   continua intacto em fase invertida do começo ao fim, preservando a
 *   propriedade de não ser identificado pela IA em mono.
 */

import { decodeAudioRobust, encodeWAV } from './audio-engine';

export type CamuflagemInput = {
  black: Blob;
  white: Blob;
  volumePercent: number; // 5..100
};

/**
 * Processa um par BLACK/WHITE e devolve um Blob WAV estéreo camuflado.
 */
export async function camuflar({
  black,
  white,
  volumePercent,
}: CamuflagemInput): Promise<Blob> {
  const [blackBuf, whiteBuf] = await Promise.all([
    decodeAudioRobust(black),
    decodeAudioRobust(white),
  ]);

  const gain = (Math.max(5, Math.min(100, volumePercent)) / 100) * 0.05;
  const sampleRate = blackBuf.sampleRate;

  // O output TEM SEMPRE o comprimento do BLACK. O WHITE é só uma camada de
  // camuflagem — se for mais curto, a parte sem WHITE sai só com o BLACK em
  // fase invertida (que continua não sendo identificado pela IA em mono,
  // porque L + R = 0 nessa região). Se for mais longo, truncamos.
  const length = blackBuf.length;
  const whiteLen = whiteBuf.length;

  // Converte multicanal para mono somando canais (média)
  const blackMono = toMono(blackBuf);
  const whiteMono = toMono(whiteBuf);

  // Monta buffer estéreo de saída manualmente, compatível com encodeWAV
  const stereo = new StereoMock(sampleRate, length);
  const L = stereo.getChannelData(0);
  const R = stereo.getChannelData(1);

  for (let i = 0; i < length; i++) {
    const b = blackMono[i] ?? 0;
    // Quando o WHITE acaba antes do BLACK, w = 0 a partir daí (só BLACK
    // em fase invertida sobrevive — ainda inaudível em mono).
    const w = i < whiteLen ? whiteMono[i] ?? 0 : 0;
    L[i] = clamp(b + gain * w);
    R[i] = clamp(-b + gain * w);
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

// AudioBuffer stub compatível com o encodeWAV (mesmo padrão do audio-engine)
class StereoMock {
  numberOfChannels = 2;
  length: number;
  sampleRate: number;
  duration: number;
  private channels: [Float32Array, Float32Array];

  constructor(sampleRate: number, length: number) {
    this.sampleRate = sampleRate;
    this.length = length;
    this.duration = length / sampleRate;
    this.channels = [new Float32Array(length), new Float32Array(length)];
  }

  getChannelData(c: number): Float32Array {
    return this.channels[c as 0 | 1];
  }
}
