/**
 * Pipeline Variacao de Avatar (VA) — feature DARKO LAB.
 *
 * Fluxo (diferente do clickup-pilot normal):
 *  1. Download MP4 do AD original (Drive ID) via extension
 *  2. Extract audio via ffmpeg-worker
 *  3. Split audio em N segmentos ~20s respeitando silencios
 *     (NUNCA corta fala — splita SO em pausa)
 *  4. Pra cada avatar de variacao (2-10):
 *     - Loop por segmento → dispatch HeyGen modo audio (lipsync)
 *     - Quando todos prontos, baixa + concat na ordem
 *     - Decupagem (remove silencios das bordas) — opcional, herda config
 *  5. Output: ZIP com N videos finais nomeados:
 *     <baseAdId>-AVA01.mp4, <baseAdId>-AVA02.mp4, ...
 *     + DEPOIMENTO-AVA<X>.mp4 se task tem depoimento
 *
 * Pre-req: extension v4.2.2+, sessao HeyGen logada, AD video acessivel
 * (Drive compartilhado OU public OR user logado tem acesso).
 */

import { decodeAudioRobust, detectSilences } from './audio-engine';
import { extractAudio, concatAvatarParts, concatVideosFast, cutVideoSegments } from './ffmpeg-worker';

export type VAPipelineAvatar = {
  /** AVA01, AVA02, ... — usado no filename de output */
  avaCode: string;
  /** Avatar HeyGen escolhido (já matched no slot da UI) */
  avatarId: string;
  avatarName: string;
};

export type VAPipelineInput = {
  /** Base AD ID (ex 'AD10G1VN-PRPB06') — vira prefixo dos arquivos */
  baseAdId: string;
  /** Bytes do MP4 do AD original (ja baixado) */
  adVideoBytes: Uint8Array | Blob;
  /** Avatares de variacao com IDs HeyGen ja resolvidos */
  avatares: VAPipelineAvatar[];
  /** Numero alvo de splits do audio (mais alto = mais takes curtos).
   *  Default: divide pra ficar com segments de ~20s */
  targetSegmentSec?: number;
  /** Min segment seconds — nao splita abaixo disso */
  minSegmentSec?: number;
  /** Max segment seconds — split mesmo se silencio nao bate (fallback) */
  maxSegmentSec?: number;
  /** Callback progresso */
  onProgress?: (msg: VAPipelineProgress) => void;
  /** Funcao pra disparar 1 take HeyGen via extension (audio mode).
   *  Recebe (avatarId, audioBlob, label) → resolve com videoBlob.
   *  Caller injeta — pipeline nao tem dependencia direta do bridge. */
  dispatchAudioTake: (params: {
    avatarId: string;
    audioBytes: Uint8Array;
    audioFilename: string;
    label: string;
  }) => Promise<Blob>;
  /** Cancelado? */
  isCancelled?: () => boolean;
};

export type VAPipelineProgress = {
  stage: 'extract_audio' | 'split_audio' | 'dispatch' | 'mount' | 'zip' | 'done';
  message: string;
  percent: number;
  avatarIdx?: number;
  segmentIdx?: number;
};

export type VAPipelineResult = {
  /** Final videos por avatar: {avaCode → Blob mp4 final} */
  items: Array<{ avaCode: string; filename: string; blob: Blob | null; error?: string }>;
  /** Audio segmentos (debug) */
  audioSegmentCount: number;
  /** Resumo */
  summary: string;
};

/* ============================== AUDIO SPLIT ============================== */

/** Split AudioBuffer em segmentos respeitando silencios.
 *  Algoritmo:
 *    1. Detecta silencios via detectSilences (audio-engine)
 *    2. Calcula targets de boundary baseado em targetSegmentSec
 *    3. Pra cada target, escolhe silence mais proximo (dentro de tolerancia)
 *       — se nao tiver silence, split duro (so como ultimo recurso)
 *  Retorna lista de {start, end} em segundos. */
export function planAudioSplitBoundaries(
  totalDur: number,
  silences: Array<{ start: number; end: number }>,
  targetSec: number,
  minSec: number,
  maxSec: number,
): Array<{ start: number; end: number }> {
  if (totalDur <= targetSec) return [{ start: 0, end: totalDur }];

  const segments: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  while (cursor < totalDur) {
    const targetEnd = cursor + targetSec;
    if (targetEnd >= totalDur - minSec) {
      segments.push({ start: cursor, end: totalDur });
      break;
    }
    // Encontra silencio mais proximo do targetEnd, preferindo dentro da janela
    // [cursor + minSec, cursor + maxSec]. Boundary = MEIO do silencio.
    const candidates = silences
      .map((s) => ({ s, mid: (s.start + s.end) / 2 }))
      .filter(({ mid }) => mid > cursor + minSec && mid < cursor + maxSec)
      .sort((a, b) => Math.abs(a.mid - targetEnd) - Math.abs(b.mid - targetEnd));

    let boundary: number;
    if (candidates.length > 0) {
      boundary = candidates[0].mid;
    } else {
      // Sem silencio na janela — fallback split duro em targetEnd
      // (preferimos isso a um segmento > maxSec)
      boundary = Math.min(targetEnd, totalDur);
    }
    segments.push({ start: cursor, end: boundary });
    cursor = boundary;
  }
  return segments;
}

/** Encode AudioBuffer em WAV PCM 16-bit. */
function encodeWAV(audioBuffer: AudioBuffer): Uint8Array {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const numSamples = audioBuffer.length;
  const bitsPerSample = 16;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;
  const buf = new ArrayBuffer(44 + dataSize);
  const v = new DataView(buf);
  const ws = (off: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  ws(0, 'RIFF'); v.setUint32(4, 36 + dataSize, true);
  ws(8, 'WAVE'); ws(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, numChannels, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, byteRate, true);
  v.setUint16(32, blockAlign, true); v.setUint16(34, bitsPerSample, true);
  ws(36, 'data'); v.setUint32(40, dataSize, true);
  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) channels.push(audioBuffer.getChannelData(c));
  let off = 44;
  for (let i = 0; i < numSamples; i++) {
    for (let c = 0; c < numChannels; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
  }
  return new Uint8Array(buf);
}

/** Extrai um trecho de AudioBuffer (start..end em segundos) como WAV. */
function sliceAudioBufferToWAV(audioBuffer: AudioBuffer, startSec: number, endSec: number): Uint8Array {
  const sr = audioBuffer.sampleRate;
  const startSample = Math.floor(startSec * sr);
  const endSample = Math.floor(endSec * sr);
  const numSamples = endSample - startSample;
  const numChannels = audioBuffer.numberOfChannels;
  // Cria AudioBuffer "virtual" via OfflineAudioContext? Mais simples: clone manual em ArrayBuffer.
  const sliced = {
    numberOfChannels: numChannels,
    sampleRate: sr,
    length: numSamples,
    getChannelData: (c: number) => audioBuffer.getChannelData(c).subarray(startSample, endSample),
  } as unknown as AudioBuffer;
  return encodeWAV(sliced);
}

/* ============================== PIPELINE ============================== */

export async function runVAPipeline(input: VAPipelineInput): Promise<VAPipelineResult> {
  const targetSec = input.targetSegmentSec ?? 20;
  const minSec = input.minSegmentSec ?? 8;
  const maxSec = input.maxSegmentSec ?? 35;
  const progress = input.onProgress ?? (() => {});

  // 1. Extract audio do MP4
  progress({ stage: 'extract_audio', message: 'Extraindo audio do AD original...', percent: 5 });
  const adVideoBlob = input.adVideoBytes instanceof Blob
    ? input.adVideoBytes
    : new Blob([input.adVideoBytes as BlobPart], { type: 'video/mp4' });
  const audioBlob = await extractAudio(adVideoBlob);

  // 2. Decode + detect silencios + plan boundaries
  progress({ stage: 'split_audio', message: 'Analisando silencios pra split sem cortar fala...', percent: 15 });
  const audioBuffer = await decodeAudioRobust(audioBlob);
  const silences = detectSilences(audioBuffer);
  const boundaries = planAudioSplitBoundaries(audioBuffer.duration, silences, targetSec, minSec, maxSec);
  progress({ stage: 'split_audio', message: `Split planejado: ${boundaries.length} segmentos`, percent: 20 });

  // 3. Slice cada segmento em WAV
  const segmentWavs: Uint8Array[] = boundaries.map((b) => sliceAudioBufferToWAV(audioBuffer, b.start, b.end));

  // 4. Pra cada avatar, dispatcha cada segmento + monta
  const items: VAPipelineResult['items'] = [];
  const totalDispatches = input.avatares.length * boundaries.length;
  let dispatchDone = 0;

  for (let ai = 0; ai < input.avatares.length; ai++) {
    if (input.isCancelled?.()) break;
    const av = input.avatares[ai];
    const filename = `${input.baseAdId}-${av.avaCode}.mp4`;
    progress({
      stage: 'dispatch',
      message: `Avatar ${ai + 1}/${input.avatares.length} (${av.avaCode}) — dispatching ${segmentWavs.length} takes...`,
      percent: 20 + (dispatchDone / totalDispatches) * 60,
      avatarIdx: ai,
    });

    // Dispatch sequencial (HeyGen Auto Dynamic limita paralelismo via extension)
    const videoBlobs: (Blob | null)[] = [];
    let avatarErr: string | undefined;
    for (let si = 0; si < segmentWavs.length; si++) {
      if (input.isCancelled?.()) break;
      try {
        const videoBlob = await input.dispatchAudioTake({
          avatarId: av.avatarId,
          audioBytes: segmentWavs[si],
          audioFilename: `parte${si + 1}.wav`,
          label: `${av.avaCode}_parte${si + 1}`,
        });
        videoBlobs.push(videoBlob);
      } catch (e) {
        avatarErr = `segmento ${si + 1}: ${(e as Error)?.message || 'falha'}`;
        videoBlobs.push(null);
        break;
      }
      dispatchDone++;
      progress({
        stage: 'dispatch',
        message: `${av.avaCode} · take ${si + 1}/${segmentWavs.length} OK`,
        percent: 20 + (dispatchDone / totalDispatches) * 60,
        avatarIdx: ai,
        segmentIdx: si,
      });
    }

    if (avatarErr || videoBlobs.some((v) => !v)) {
      items.push({ avaCode: av.avaCode, filename, blob: null, error: avatarErr || 'algum take falhou' });
      continue;
    }

    // Mount: concat na ordem
    progress({
      stage: 'mount',
      message: `Montando ${av.avaCode} (${videoBlobs.length} takes)...`,
      percent: 80 + (ai / input.avatares.length) * 15,
      avatarIdx: ai,
    });
    try {
      let mounted: Blob;
      try {
        mounted = await concatVideosFast(videoBlobs as Blob[]);
      } catch {
        // Fast falhou → fallback slow re-encode
        mounted = await concatAvatarParts(videoBlobs as Blob[]);
      }
      items.push({ avaCode: av.avaCode, filename, blob: mounted });
    } catch (e) {
      items.push({ avaCode: av.avaCode, filename, blob: null, error: 'mount: ' + (e as Error)?.message });
    }
  }

  progress({ stage: 'done', message: 'Pipeline concluido', percent: 100 });
  const summary = `${items.filter((i) => i.blob).length}/${items.length} avatares OK · ${segmentWavs.length} takes por avatar`;
  return { items, audioSegmentCount: segmentWavs.length, summary };
}
