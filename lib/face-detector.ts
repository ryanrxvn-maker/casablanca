/**
 * CASABLANCA — Face Detector (MediaPipe Tasks Vision, browser-side)
 *
 * Detecta presenca de rosto em frames de video. Usado pelo SMART MODE da
 * VA pipeline pra decidir quais segmentos sao "avatar talking" (swap)
 * vs "b-roll" (keep original).
 *
 * STACK:
 * - @mediapipe/tasks-vision via CDN (free, MIT, ~3MB wasm + model)
 * - FaceDetector (mais leve que FaceLandmarker — so detecta presenca/bbox)
 * - Roda 100% no browser, ZERO API calls, ZERO creditos
 *
 * ALGORITMO POR SEGMENTO:
 * 1. Cria <video> hidden + carrega o blob
 * 2. Pra cada segmento [start, end], sample N timestamps (default 5)
 * 3. Em cada timestamp: seek, captura frame em <canvas>, roda detector
 * 4. Conta quantos samples tem face → ratio
 * 5. Se ratio >= threshold (default 0.5) → segmento "tem avatar"
 *
 * FALLBACK: se MediaPipe falhar no segmento (decode error, etc),
 * **assume talking** (segmento conta como "tem avatar" → faz swap).
 * Filosofia: user prefere perder b-roll a perder lipsync swap.
 */

let mediaPipePromise: Promise<{
  FaceDetector: any;
  FilesetResolver: any;
}> | null = null;

const MEDIAPIPE_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const FACE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';

async function loadMediaPipe() {
  if (mediaPipePromise) return mediaPipePromise;
  mediaPipePromise = (async () => {
    // Carrega via dynamic import — CDN ESM
    const mod = await import(/* webpackIgnore: true */ `${MEDIAPIPE_CDN}/vision_bundle.mjs`);
    return { FaceDetector: mod.FaceDetector, FilesetResolver: mod.FilesetResolver };
  })();
  return mediaPipePromise;
}

let detectorPromise: Promise<any> | null = null;

async function getDetector() {
  if (detectorPromise) return detectorPromise;
  detectorPromise = (async () => {
    const { FaceDetector, FilesetResolver } = await loadMediaPipe();
    const vision = await FilesetResolver.forVisionTasks(`${MEDIAPIPE_CDN}/wasm`);
    const detector = await FaceDetector.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: FACE_MODEL_URL,
        delegate: 'GPU',
      },
      runningMode: 'IMAGE',
      minDetectionConfidence: 0.5,
    });
    return detector;
  })();
  return detectorPromise;
}

export function unloadFaceDetector() {
  detectorPromise = null;
  mediaPipePromise = null;
}

export type FaceSample = {
  /** Timestamp em segundos */
  ts: number;
  hasFace: boolean;
  /** Score do detector (0-1). null se erro. */
  score: number | null;
  /** Bounding box normalizada (0-1). null se sem face. */
  bbox?: { x: number; y: number; w: number; h: number } | null;
  /** Erro se houver */
  error?: string;
};

export type SegmentFaceResult = {
  segmentIdx: number;
  start: number;
  end: number;
  samples: FaceSample[];
  /** Ratio 0-1 de samples com face */
  faceRatio: number;
  /** Decisao final: tem avatar? (faceRatio >= threshold OR fallback) */
  hasAvatar: boolean;
  /** Motivo da decisao (debug) */
  reason: 'face_present' | 'no_face' | 'fallback_assume_talking' | 'detector_failed';
};

export type DetectFacePresenceInput = {
  videoBlob: Blob;
  segments: Array<{ start: number; end: number }>;
  /** Samples por segmento (default 5). Mais = mais lento + preciso. */
  samplesPerSegment?: number;
  /** Threshold 0-1 de face ratio (default 0.5) */
  threshold?: number;
  /** Callback de progresso */
  onProgress?: (done: number, total: number, message: string) => void;
  /** Cancelado? */
  isCancelled?: () => boolean;
};

/**
 * Detecta presenca de rosto em cada segmento.
 *
 * NOTA: cria 1 elemento <video> hidden + 1 <canvas> hidden, anexados ao
 * document.body durante a operacao. Removidos ao final (success ou error).
 */
export async function detectFacePresence(
  input: DetectFacePresenceInput,
): Promise<SegmentFaceResult[]> {
  const {
    videoBlob,
    segments,
    samplesPerSegment = 5,
    threshold = 0.5,
    onProgress,
    isCancelled,
  } = input;

  if (typeof window === 'undefined') {
    throw new Error('detectFacePresence so funciona no browser.');
  }
  if (segments.length === 0) return [];

  // Tenta carregar detector. Se falhar, retorna fallback "assume talking" pra todos.
  let detector: any = null;
  let detectorError: string | null = null;
  try {
    detector = await getDetector();
  } catch (e) {
    detectorError = e instanceof Error ? e.message : String(e);
    console.warn('[face-detector] falha ao carregar MediaPipe:', detectorError);
  }

  // Se detector nao carregou — TODOS segmentos viram "fallback assume talking"
  if (!detector || detectorError) {
    return segments.map((s, i) => ({
      segmentIdx: i,
      start: s.start,
      end: s.end,
      samples: [],
      faceRatio: 0,
      hasAvatar: true, // fallback: assume talking → faz swap
      reason: 'detector_failed' as const,
    }));
  }

  // Cria video + canvas hidden
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.crossOrigin = 'anonymous';
  video.style.position = 'fixed';
  video.style.left = '-99999px';
  video.style.top = '-99999px';
  video.style.width = '320px';
  video.style.height = '180px';

  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 360;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context nao disponivel.');

  const url = URL.createObjectURL(videoBlob);
  video.src = url;
  document.body.appendChild(video);

  const cleanup = () => {
    try { document.body.removeChild(video); } catch {}
    URL.revokeObjectURL(url);
  };

  try {
    // Espera video carregar metadata
    await new Promise<void>((resolve, reject) => {
      const onLoaded = () => {
        video.removeEventListener('loadedmetadata', onLoaded);
        video.removeEventListener('error', onErr);
        resolve();
      };
      const onErr = () => {
        video.removeEventListener('loadedmetadata', onLoaded);
        video.removeEventListener('error', onErr);
        reject(new Error('Falha ao carregar video pra face detection.'));
      };
      video.addEventListener('loadedmetadata', onLoaded);
      video.addEventListener('error', onErr);
      // Force preload
      video.load();
      setTimeout(() => reject(new Error('Timeout 30s ao carregar video metadata.')), 30000);
    });

    // Adjust canvas to video aspect (downscale pra detecto rápido)
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const scale = Math.min(640 / vw, 360 / vh, 1);
    canvas.width = Math.round(vw * scale);
    canvas.height = Math.round(vh * scale);

    const results: SegmentFaceResult[] = [];
    const totalSamples = segments.length * samplesPerSegment;
    let doneSamples = 0;

    for (let si = 0; si < segments.length; si++) {
      if (isCancelled?.()) break;
      const seg = segments[si];
      const samples: FaceSample[] = [];

      // Sample N timestamps evenly inside segment
      for (let k = 0; k < samplesPerSegment; k++) {
        if (isCancelled?.()) break;
        // Posição relativa: 0.1, 0.3, 0.5, 0.7, 0.9 (evita bordas exatas)
        const rel = (k + 0.5) / samplesPerSegment;
        const ts = seg.start + (seg.end - seg.start) * rel;

        let hasFace = false;
        let score: number | null = null;
        let bbox: FaceSample['bbox'] = null;
        let err: string | undefined;

        try {
          // Seek + wait frame ready
          await seekVideo(video, ts);
          // Draw frame to canvas
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          // Run detection
          const det = detector.detect(canvas);
          const detections = det?.detections || [];
          if (detections.length > 0) {
            const best = detections[0];
            hasFace = true;
            score = best?.categories?.[0]?.score ?? 1;
            if (best.boundingBox) {
              bbox = {
                x: best.boundingBox.originX / canvas.width,
                y: best.boundingBox.originY / canvas.height,
                w: best.boundingBox.width / canvas.width,
                h: best.boundingBox.height / canvas.height,
              };
            }
          }
        } catch (e) {
          err = e instanceof Error ? e.message : String(e);
        }
        samples.push({ ts, hasFace, score, bbox, error: err });
        doneSamples++;
        if (doneSamples % 3 === 0 || doneSamples === totalSamples) {
          onProgress?.(doneSamples, totalSamples,
            `Detectando faces: segmento ${si + 1}/${segments.length} (${doneSamples}/${totalSamples} frames)`);
        }
      }

      const validSamples = samples.filter((s) => s.error === undefined);
      const facesCount = validSamples.filter((s) => s.hasFace).length;
      const faceRatio = validSamples.length > 0 ? facesCount / validSamples.length : 0;

      let hasAvatar: boolean;
      let reason: SegmentFaceResult['reason'];
      if (validSamples.length === 0) {
        // Todos samples falharam → fallback assume talking
        hasAvatar = true;
        reason = 'fallback_assume_talking';
      } else if (faceRatio >= threshold) {
        hasAvatar = true;
        reason = 'face_present';
      } else {
        hasAvatar = false;
        reason = 'no_face';
      }

      results.push({
        segmentIdx: si,
        start: seg.start,
        end: seg.end,
        samples,
        faceRatio,
        hasAvatar,
        reason,
      });
    }

    return results;
  } finally {
    cleanup();
  }
}

/** Helper: seek o video pro timestamp e espera o frame estar pronto. */
function seekVideo(video: HTMLVideoElement, ts: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      video.removeEventListener('seeked', finish);
      video.removeEventListener('error', onErr);
      resolve();
    };
    const onErr = () => {
      if (done) return;
      done = true;
      video.removeEventListener('seeked', finish);
      video.removeEventListener('error', onErr);
      reject(new Error('Video seek error at ' + ts.toFixed(2) + 's'));
    };
    video.addEventListener('seeked', finish);
    video.addEventListener('error', onErr);
    video.currentTime = Math.max(0, Math.min(ts, (video.duration || ts) - 0.001));
    setTimeout(() => {
      if (!done) {
        // Em alguns browsers, seeked nao dispara em frames muito proximos
        // do final. Resolve mesmo assim — o frame atual e o que captura.
        finish();
      }
    }, 2000);
  });
}
