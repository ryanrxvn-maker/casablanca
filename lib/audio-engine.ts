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
 * Divide o buffer em ~targetChunks partes.
 *
 * Algoritmo em duas passadas:
 *   1. Se o audio TEM silencios naturais (>= MIN_SILENCE_SEC), usa os mais
 *      longos como pontos de corte (comportamento original).
 *   2. Se NAO tem silencios suficientes (audio ja decupado), cai pro fallback
 *      de "vales de energia": detecta os `target - 1` MENORES minimos locais
 *      da envelope RMS (janela de busca > minDistance pra distribuir).
 *      Esses minimos sao os momentos mais quietos do audio — naturalmente
 *      entre palavras — entao nao cortam no meio da fala.
 *
 * Para um audio de 3min, target padrao fica entre 12 e 15.
 */
export function splitByParagraphs(
  buffer: AudioBuffer,
  targetChunks?: number
): AudioBuffer[] {
  const durationSec = buffer.duration;
  const target =
    targetChunks ??
    Math.max(2, Math.round((durationSec / 60) * TARGET_CHUNKS_PER_MIN));

  const sr = buffer.sampleRate;
  const silences = detectSilences(buffer);
  const needed = Math.max(0, target - 1);

  // Se tem silencios suficientes, usa eles (meio do silencio como corte)
  // Senao, cai pro vale-de-energia.
  let cutSamples: number[] = [];

  if (silences.length >= needed && needed > 0) {
    const byDuration = [...silences].sort(
      (a, b) => b.end - b.start - (a.end - a.start),
    );
    cutSamples = byDuration
      .slice(0, needed)
      .map((cut) => Math.floor(((cut.start + cut.end) / 2) * sr))
      .sort((a, b) => a - b);
  } else if (needed > 0) {
    // Fallback: vales na envelope RMS (audio decupado).
    cutSamples = findEnergyValleys(buffer, needed);
  }

  const parts: AudioBuffer[] = [];
  let prev = 0;

  for (const cutSample of cutSamples) {
    const end = Math.max(prev + 1, Math.min(buffer.length, cutSample));
    parts.push(sliceBuffer(buffer, prev, end));
    prev = end;
  }
  if (prev < buffer.length) {
    parts.push(sliceBuffer(buffer, prev, buffer.length));
  }
  return parts;
}

/**
 * Fallback pra audio sem silencios marcantes: acha os N momentos mais quietos,
 * respeitando uma distancia minima entre cortes pra nao ficarem empilhados.
 *
 * Como funciona:
 *   1. Computa RMS por janela de RMS_WINDOW_MS
 *   2. Identifica minimos locais (janela > neighborhood)
 *   3. Filtra minimos muito perto das bordas
 *   4. Ordena por RMS crescente (mais quietos primeiro)
 *   5. Greedy: adiciona cortes se distarem >= minDistanceSec do ja-escolhidos
 *   6. Retorna os samples ordenados por posicao
 */
function findEnergyValleys(buffer: AudioBuffer, count: number): number[] {
  const sr = buffer.sampleRate;
  const ch = buffer.getChannelData(0);
  const total = ch.length;
  const windowSize = Math.max(1, Math.floor((RMS_WINDOW_MS / 1000) * sr));
  const nWindows = Math.floor(total / windowSize);
  if (nWindows < 4) return [];

  const rms = new Float32Array(nWindows);
  for (let w = 0; w < nWindows; w++) {
    const from = w * windowSize;
    const to = Math.min(total, from + windowSize);
    let sum = 0;
    for (let i = from; i < to; i++) sum += ch[i] * ch[i];
    rms[w] = Math.sqrt(sum / (to - from));
  }

  // Vizinhanca pra detectar minimos locais (cerca de 150ms)
  const neighborhood = Math.max(
    3,
    Math.floor((0.15 * 1000) / RMS_WINDOW_MS),
  );

  const candidates: Array<{ w: number; rms: number }> = [];
  for (let w = neighborhood; w < nWindows - neighborhood; w++) {
    let isMin = true;
    const val = rms[w];
    for (let k = 1; k <= neighborhood && isMin; k++) {
      if (rms[w - k] < val || rms[w + k] < val) isMin = false;
    }
    if (isMin) candidates.push({ w, rms: val });
  }

  // Se nao achou o suficiente, relaxa pra todos os windows (ordena por rms)
  const pool =
    candidates.length >= count
      ? candidates
      : Array.from({ length: nWindows }, (_, w) => ({ w, rms: rms[w] }));

  pool.sort((a, b) => a.rms - b.rms);

  // Distancia minima entre cortes: max(2s, duracao / (count+1) * 0.6)
  const durationSec = total / sr;
  const targetSec = durationSec / (count + 1);
  const minDistanceSec = Math.max(1.5, targetSec * 0.55);
  const minDistanceSamples = Math.floor(minDistanceSec * sr);
  const edgeSkipSamples = Math.floor(Math.max(0.5, targetSec * 0.3) * sr);

  const chosen: number[] = [];
  for (const c of pool) {
    if (chosen.length >= count) break;
    const sample = c.w * windowSize;
    if (sample < edgeSkipSamples) continue;
    if (sample > total - edgeSkipSamples) continue;
    let ok = true;
    for (const s of chosen) {
      if (Math.abs(s - sample) < minDistanceSamples) {
        ok = false;
        break;
      }
    }
    if (ok) chosen.push(sample);
  }

  // Se mesmo assim nao deu, completa distribuindo uniformemente
  if (chosen.length < count) {
    const step = total / (count + 1);
    for (let i = 1; i <= count; i++) {
      const target = Math.floor(i * step);
      // pega o minimo local mais proximo do target
      let best = target;
      let bestVal = Infinity;
      const searchRange = Math.floor((step * 0.4) / windowSize);
      const baseW = Math.floor(target / windowSize);
      for (
        let w = Math.max(0, baseW - searchRange);
        w <= Math.min(nWindows - 1, baseW + searchRange);
        w++
      ) {
        if (rms[w] < bestVal) {
          bestVal = rms[w];
          best = w * windowSize;
        }
      }
      if (!chosen.some((s) => Math.abs(s - best) < minDistanceSamples / 2)) {
        chosen.push(best);
        if (chosen.length >= count) break;
      }
    }
  }

  chosen.sort((a, b) => a - b);
  return chosen.slice(0, count);
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
