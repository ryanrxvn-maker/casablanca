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
import { extractAudio, concatAvatarParts, concatVideosFast, cutVideoSegments, overlaySegmentsOnVideo } from './ffmpeg-worker';
import { isolateVoice, type VoiceIsolatorMode } from './voice-isolator';
import { detectFacePresence, type SegmentFaceResult } from './face-detector';

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
  /** Voice isolation antes do split (CRITICO pra lipsync nao ficar
   *  horrivel quando AD original tem musica/SFX). Default TRUE.
   *  - true: aplica isolateVoice() apos extractAudio
   *  - false: usa audio raw (NAO RECOMENDADO — lipsync vai mixar voz+musica) */
  useVoiceIsolation?: boolean;
  /** Modo do voice isolator. Default 'auto' (detecta stereo/mono).
   *  - 'auto': stereo→CCE, mono→bandpass
   *  - 'center': forca CCE (so use se confirmado stereo bem mixado)
   *  - 'bandpass': so highpass+lowpass+compand
   *  - 'aggressive': denoise + compand mais pesado (audio sujo) */
  voiceIsolatorMode?: VoiceIsolatorMode;
  /** SMART MODE: detecta face em cada segmento do video original, e
   *  substitui APENAS os segmentos com avatar (face presente). B-rolls
   *  ficam intactos. Output: 1 MP4 final por avatar com swap aplicado.
   *  - true: ativa smart mode (default false)
   *  - threshold default: 0.5 (50% dos frames sampled tem face = "tem avatar")
   *  - samples per segment default: 5 */
  smartMode?: boolean;
  /** Threshold (0-1) de face ratio pra considerar segmento "tem avatar" */
  smartModeThreshold?: number;
  /** Samples por segmento na deteccao de face (default 5) */
  smartModeSamplesPerSegment?: number;
};

export type VAPipelineProgress = {
  stage:
    | 'extract_audio'
    | 'isolate_voice'   // voice isolation pre-split pra lipsync limpo
    | 'split_audio'
    | 'detect_faces'    // SMART MODE: face detection nos segmentos
    | 'dispatch'
    | 'mount'
    | 'assemble_smart'  // SMART MODE: overlay lipsync no video original
    | 'zip'
    | 'done';
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
  /** SMART MODE stats (so preenchido se smartMode:true) */
  smartModeStats?: {
    totalSegments: number;
    swapSegments: number;       // segmentos com face detectada
    keepSegments: number;       // segmentos sem face (b-roll mantido)
    fallbackSegments: number;   // segmentos com fallback "assume talking"
    detectorFailed: boolean;    // se MediaPipe nao carregou
  };
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
  const rawAudioBlob = await extractAudio(adVideoBlob);

  // 1.5. Voice isolation — CRITICO pra lipsync limpo (sem musica/SFX/ruido)
  // Default true. Pra desligar (debug): useVoiceIsolation:false na input.
  const useVoiceIsolation = input.useVoiceIsolation !== false;
  let audioBlob: Blob = rawAudioBlob;
  if (useVoiceIsolation) {
    progress({
      stage: 'isolate_voice',
      message: 'Isolando voz (removendo musica/SFX/ruido)...',
      percent: 10,
    });
    try {
      audioBlob = await isolateVoice(rawAudioBlob, {
        mode: input.voiceIsolatorMode ?? 'auto',
        format: 'wav',
        onProgress: (p) => {
          progress({
            stage: 'isolate_voice',
            message: `Isolando voz (${Math.round(p.ratio * 100)}%)...`,
            percent: 10 + Math.round(p.ratio * 4),
          });
        },
      });
      progress({
        stage: 'isolate_voice',
        message: 'Voz isolada — lipsync vai usar audio limpo.',
        percent: 14,
      });
    } catch (e) {
      // Se isolation falhar, NAO aborta: usa audio raw com warning.
      // Pior caso = lipsync com musica (estado atual), mas pipeline nao quebra.
      console.warn('[va-pipeline] voice isolation falhou, usando audio raw:', e);
      progress({
        stage: 'isolate_voice',
        message: 'Voice isolation falhou — seguindo com audio raw (lipsync pode ficar misturado).',
        percent: 14,
      });
      audioBlob = rawAudioBlob;
    }
  }

  // 2. Decode + detect silencios + plan boundaries
  progress({ stage: 'split_audio', message: 'Analisando silencios pra split sem cortar fala...', percent: 15 });
  const audioBuffer = await decodeAudioRobust(audioBlob);
  const silences = detectSilences(audioBuffer);
  const boundaries = planAudioSplitBoundaries(audioBuffer.duration, silences, targetSec, minSec, maxSec);
  progress({ stage: 'split_audio', message: `Split planejado: ${boundaries.length} segmentos`, percent: 20 });

  // 3. SMART MODE: face detection nos segmentos do video original
  const smartMode = input.smartMode === true;
  let faceResults: SegmentFaceResult[] = [];
  let smartModeStats: VAPipelineResult['smartModeStats'] | undefined;
  let activeSwapBoundaries: typeof boundaries = boundaries;
  let swapIndices: number[] = boundaries.map((_, i) => i); // por default, todos

  if (smartMode) {
    progress({
      stage: 'detect_faces',
      message: `Smart Mode: detectando face em ${boundaries.length} segmentos...`,
      percent: 22,
    });
    try {
      faceResults = await detectFacePresence({
        videoBlob: adVideoBlob,
        segments: boundaries.map((b) => ({ start: b.start, end: b.end })),
        samplesPerSegment: input.smartModeSamplesPerSegment ?? 5,
        threshold: input.smartModeThreshold ?? 0.5,
        isCancelled: input.isCancelled,
        onProgress: (done, total, msg) => {
          progress({
            stage: 'detect_faces',
            message: msg,
            percent: 22 + Math.round((done / total) * 8),
          });
        },
      });
      const fallbackCount = faceResults.filter((r) => r.reason === 'fallback_assume_talking' || r.reason === 'detector_failed').length;
      const swapCount = faceResults.filter((r) => r.hasAvatar).length;
      smartModeStats = {
        totalSegments: faceResults.length,
        swapSegments: swapCount,
        keepSegments: faceResults.length - swapCount,
        fallbackSegments: fallbackCount,
        detectorFailed: faceResults.every((r) => r.reason === 'detector_failed'),
      };
      // Filter swap boundaries
      swapIndices = faceResults.filter((r) => r.hasAvatar).map((r) => r.segmentIdx);
      activeSwapBoundaries = swapIndices.map((i) => boundaries[i]);
      progress({
        stage: 'detect_faces',
        message: `Smart Mode: ${swapCount}/${boundaries.length} segmentos com avatar (${faceResults.length - swapCount} b-rolls mantidos)`,
        percent: 30,
      });
      if (activeSwapBoundaries.length === 0) {
        // Nada pra trocar — output = original.
        progress({ stage: 'done', message: 'Smart Mode: nenhum segmento com avatar detectado. Output = original.', percent: 100 });
        return {
          items: input.avatares.map((av) => ({
            avaCode: av.avaCode,
            filename: `${input.baseAdId}-${av.avaCode}-smart.mp4`,
            blob: adVideoBlob, // copia original
          })),
          audioSegmentCount: 0,
          summary: 'Smart Mode: zero swap (nenhum segmento com face). Output = original.',
          smartModeStats,
        };
      }
    } catch (e) {
      // Face detection completamente falhou — fallback: assume todos talking
      console.warn('[va-pipeline] face detection falhou (fallback):', e);
      smartModeStats = {
        totalSegments: boundaries.length,
        swapSegments: boundaries.length,
        keepSegments: 0,
        fallbackSegments: boundaries.length,
        detectorFailed: true,
      };
    }
  }

  // 3.1. Slice cada segmento em WAV (apenas dos segmentos a serem trocados em smart mode)
  const segmentWavs: Uint8Array[] = activeSwapBoundaries.map((b) =>
    sliceAudioBufferToWAV(audioBuffer, b.start, b.end),
  );

  // 4. Pra cada avatar, dispatcha cada segmento + monta
  const items: VAPipelineResult['items'] = [];
  const totalDispatches = input.avatares.length * activeSwapBoundaries.length;
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

    if (smartMode) {
      // SMART MODE: overlay cada lipsync no video original no timestamp exato.
      // Output: 1 MP4 mesma duracao do original, com avatar trocado apenas onde
      // tem face (b-rolls intactos). Cut puro, frame-perfect.
      const smartFilename = `${input.baseAdId}-${av.avaCode}-smart.mp4`;
      progress({
        stage: 'assemble_smart',
        message: `${av.avaCode} · overlay smart: ${videoBlobs.length} segmentos no original...`,
        percent: 80 + (ai / input.avatares.length) * 15,
        avatarIdx: ai,
      });
      try {
        const overlays = activeSwapBoundaries.map((b, idx) => ({
          start: b.start,
          end: b.end,
          video: videoBlobs[idx] as Blob,
        }));
        const finalVideo = await overlaySegmentsOnVideo(adVideoBlob, overlays);
        items.push({ avaCode: av.avaCode, filename: smartFilename, blob: finalVideo });
      } catch (e) {
        items.push({
          avaCode: av.avaCode,
          filename: smartFilename,
          blob: null,
          error: 'smart overlay: ' + (e as Error)?.message,
        });
      }
      continue;
    }

    // Mount classico: concat na ordem (sem smart mode)
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
  const summary = smartMode
    ? `${items.filter((i) => i.blob).length}/${items.length} avatares OK · Smart Mode: ${activeSwapBoundaries.length}/${boundaries.length} segmentos trocados`
    : `${items.filter((i) => i.blob).length}/${items.length} avatares OK · ${segmentWavs.length} takes por avatar`;
  return { items, audioSegmentCount: segmentWavs.length, summary, smartModeStats };
}
