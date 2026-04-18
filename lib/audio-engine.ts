/**
 * CASABLANCA — Audio engine (Web Audio API)
 *
 * Funções puras para decodificação, detecção de silêncio, trim, split e
 * codificação WAV. Todo o processamento acontece no browser — nenhum
 * upload é feito para servidor.
 */

export const SAMPLE_RATE = 44100;
export const RMS_WINDOW_MS = 20;          // 20ms de janela
export const SILENCE_THRESHOLD = 0.008;   // RMS abaixo disso = silêncio
export const MIN_SILENCE_SEC = 0.15;      // duração mínima para contar como silêncio
export const TARGET_CHUNKS_PER_MIN = 4.2; // ~12-15 partes para 3min

// ---------- Decodificação --------------------------------------------------

/**
 * Decodifica um arquivo (Blob/File) em AudioBuffer via AudioContext.
 * Fecha o contexto após decodificar para evitar memory leak.
 */
export async function decodeAudio(file: Blob): Promise<AudioBuffer> {
  const AC =
    (window as any).AudioContext || (window as any).webkitAudioContext;
  const ctx: AudioContext = new AC({ sampleRate: SAMPLE_RATE });
  const arrayBuffer = await file.arrayBuffer();
  const buffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
  await ctx.close();
  return buffer;
}

/**
 * Variante robusta: tenta decodeAudio; se falhar (codec nao suportado pelo
 * browser, como AAC em certas builds do Firefox), baixa o FFmpeg WASM via
 * lazy-import, extrai a trilha de audio como WAV PCM e decodifica o WAV.
 *
 * O callback `onStage` permite a UI informar o usuario do fallback ("baixando
 * FFmpeg..."), ja que o primeiro fallback pode levar alguns segundos.
 */
export async function decodeAudioRobust(
  file: Blob,
  onStage?: (stage: string) => void,
): Promise<AudioBuffer> {
  try {
    return await decodeAudio(file);
  } catch (nativeErr) {
    console.warn('[audio-engine] decodeAudio falhou, tentando fallback FFmpeg:', nativeErr);
    onStage?.('Codec nao suportado pelo browser, usando FFmpeg...');
    const { extractAudio } = await import('./ffmpeg-worker');
    const wav = await extractAudio(file);
    onStage?.('Decodificando WAV extraido...');
    return await decodeAudio(wav);
  }
}

// ---------- Detecção de silêncio ------------------------------------------

export type SilenceRegion = { start: number; end: number }; // em segundos

/**
 * Detecta regiões silenciosas usando RMS com janela de 20ms.
 * Retorna array de regiões (start/end em segundos) com duração ≥ MIN_SILENCE_SEC.
 */
export function detectSilences(buffer: AudioBuffer): SilenceRegion[] {
  const sampleRate = buffer.sampleRate;
  const windowSize = Math.max(1, Math.floor((RMS_WINDOW_MS / 1000) * sampleRate));
  const channelData = buffer.getChannelData(0);
  const total = channelData.length;
  const regions: SilenceRegion[] = [];

  let silentStart: number | null = null;

  for (let i = 0; i < total; i += windowSize) {
    const end = Math.min(i + windowSize, total);
    let sum = 0;
    for (let j = i; j < end; j++) sum += channelData[j] * channelData[j];
    const rms = Math.sqrt(sum / (end - i));

    if (rms < SILENCE_THRESHOLD) {
      if (silentStart === null) silentStart = i;
    } else if (silentStart !== null) {
      const startSec = silentStart / sampleRate;
      const endSec = i / sampleRate;
      if (endSec - startSec >= MIN_SILENCE_SEC) {
        regions.push({ start: startSec, end: endSec });
      }
      silentStart = null;
    }
  }

  // Silêncio no final
  if (silentStart !== null) {
    const startSec = silentStart / sampleRate;
    const endSec = total / sampleRate;
    if (endSec - startSec >= MIN_SILENCE_SEC) {
      regions.push({ start: startSec, end: endSec });
    }
  }

  return regions;
}

// ---------- Trim de silêncios ---------------------------------------------

/**
 * Remove silêncios do buffer, mantendo `keepSilence` segundos nas bordas.
 * Concatena todos os trechos "com som".
 */
export function trimSilences(
  buffer: AudioBuffer,
  keepSilence: number = 0.05
): AudioBuffer {
  const silences = detectSilences(buffer);
  const sr = buffer.sampleRate;
  const chCount = buffer.numberOfChannels;
  const keepSamples = Math.max(0, Math.floor(keepSilence * sr));

  // Deriva regiões "com som" como complemento das silenciosas
  const soundRegions: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  for (const s of silences) {
    const silStart = Math.max(0, Math.floor(s.start * sr) + keepSamples);
    const silEnd = Math.min(
      buffer.length,
      Math.floor(s.end * sr) - keepSamples
    );
    if (silEnd > silStart) {
      if (silStart > cursor) {
        soundRegions.push({ start: cursor, end: silStart });
      }
      cursor = silEnd;
    }
  }
  if (cursor < buffer.length) {
    soundRegions.push({ start: cursor, end: buffer.length });
  }

  const totalSamples = soundRegions.reduce((n, r) => n + (r.end - r.start), 0);
  const out = new AudioBufferMock(chCount, Math.max(totalSamples, 1), sr);

  for (let ch = 0; ch < chCount; ch++) {
    const src = buffer.getChannelData(ch);
    const dst = out.getChannelData(ch);
    let offset = 0;
    for (const r of soundRegions) {
      dst.set(src.subarray(r.start, r.end), offset);
      offset += r.end - r.start;
    }
  }

  return out as unknown as AudioBuffer;
}

// ---------- Split por parágrafos ------------------------------------------

/**
 * Divide o buffer em ~targetChunks partes nas pausas mais longas.
 * Para um áudio de 3min, target padrão fica entre 12 e 15.
 */
export function splitByParagraphs(
  buffer: AudioBuffer,
  targetChunks?: number
): AudioBuffer[] {
  const durationSec = buffer.duration;
  const target =
    targetChunks ??
    Math.max(2, Math.round((durationSec / 60) * TARGET_CHUNKS_PER_MIN));

  const silences = detectSilences(buffer);

  // Ordena silêncios por duração (maiores primeiro) e pega os `target - 1` melhores
  // para usar como pontos de divisão — depois reordena pela posição.
  const byDuration = [...silences].sort(
    (a, b) => b.end - b.start - (a.end - a.start)
  );
  const cuts = byDuration
    .slice(0, Math.max(0, target - 1))
    .sort((a, b) => a.start - b.start);

  const sr = buffer.sampleRate;
  const parts: AudioBuffer[] = [];
  let prev = 0;

  for (const cut of cuts) {
    // Divide no meio do silêncio para ficar natural
    const mid = Math.floor(((cut.start + cut.end) / 2) * sr);
    const end = Math.max(prev + 1, Math.min(buffer.length, mid));
    parts.push(sliceBuffer(buffer, prev, end));
    prev = end;
  }
  if (prev < buffer.length) {
    parts.push(sliceBuffer(buffer, prev, buffer.length));
  }
  return parts;
}

function sliceBuffer(buffer: AudioBuffer, from: number, to: number): AudioBuffer {
  const chCount = buffer.numberOfChannels;
  const out = new AudioBufferMock(chCount, to - from, buffer.sampleRate);
  for (let ch = 0; ch < chCount; ch++) {
    out.getChannelData(ch).set(buffer.getChannelData(ch).subarray(from, to));
  }
  return out as unknown as AudioBuffer;
}

// ---------- Codificação WAV 16-bit PCM ------------------------------------

/**
 * Converte AudioBuffer em Blob WAV 16-bit PCM little-endian.
 * Suporta 1 ou 2 canais.
 */
export function encodeWAV(buffer: AudioBuffer): Blob {
  const chCount = Math.min(buffer.numberOfChannels, 2);
  const sampleRate = buffer.sampleRate;
  const length = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = chCount * bytesPerSample;
  const dataSize = length * blockAlign;
  const totalSize = 44 + dataSize;

  const ab = new ArrayBuffer(totalSize);
  const view = new DataView(ab);

  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');

  // fmt chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);            // subchunk size
  view.setUint16(20, 1, true);             // PCM
  view.setUint16(22, chCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // byte rate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);            // bits per sample

  // data chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  // Interleave & encode
  const channels: Float32Array[] = [];
  for (let c = 0; c < chCount; c++) channels.push(buffer.getChannelData(c));

  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let c = 0; c < chCount; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([ab], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}

// ---------- Utilidades ----------------------------------------------------

/**
 * Converte um Blob para data URL (base64). Usado para download confiável
 * em qualquer ambiente (URL.createObjectURL pode falhar em alguns casos).
 */
export function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
}

export async function downloadBlob(blob: Blob, filename: string): Promise<void> {
  const dataUrl = await blobToDataURL(blob);
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// ---------- Implementação mínima de AudioBuffer ---------------------------
// AudioBuffer real precisa de AudioContext para criar novas instâncias.
// Este mock cobre a API que usamos (length, duration, sampleRate,
// numberOfChannels, getChannelData) sem precisar abrir um AudioContext.

class AudioBufferMock {
  length: number;
  sampleRate: number;
  numberOfChannels: number;
  duration: number;
  private channels: Float32Array[];

  constructor(channels: number, length: number, sampleRate: number) {
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this.channels = Array.from({ length: channels }, () => new Float32Array(length));
  }

  getChannelData(c: number): Float32Array {
    return this.channels[c];
  }

  copyFromChannel(): void {
    throw new Error('not implemented');
  }

  copyToChannel(): void {
    throw new Error('not implemented');
  }
}
