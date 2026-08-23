/**
 * AUTO CORTES — reenquadro (parte de DOM).
 *
 * Aqui mora só o que precisa de navegador: amostrar o clipe num `<video>`,
 * rodar o detector de rostos (MediaPipe, `lib/face-detector.ts`) e medir o
 * histograma de luminância de cada amostra. TODA a decisão de enquadro é
 * pura e vive em `reframe-plan.ts` (testada no `npm test`).
 *
 * Fluxo típico (o pipeline chama nesta ordem):
 *   const scan = await sampleFaces({ clip, clipFirstPts, absStart, absEnd });
 *   const plan = planCrop(scan.samples, sceneCuts(scan.hists), { srcW, srcH, aspect, mode });
 *   const compose = makeComposer(plan, srcW, srcH, out);   // lib/auto-cortes/render.ts
 *
 * Ou, num passo só: `planReframe({ clip, ... })`.
 */

import { CANCELLED_ERROR } from '@/lib/ffmpeg-worker';
import { detectFacesInImage } from '@/lib/face-detector';
import type { AspectRatio, CropPlan, FaceSample, NormBox, ReframeMode } from './types';
import {
  HIST_BINS,
  planCrop,
  sceneCuts,
  type CropPlan as PureCropPlan,
  type FaceSample as PureFaceSample,
  type HistSample,
  type NormBox as PureNormBox,
} from './reframe-plan';

export {
  ASPECT_AR,
  boxAtTime,
  buildTracks,
  cropSizeFor,
  histDiff,
  iou,
  liveTracks,
  planCrop,
  sceneCuts,
  simplifyKeyframes,
  splitHalfAR,
  splitOrientation,
  type HistSample,
} from './reframe-plan';

/**
 * TRAVA DE CONTRATO: `reframe-plan.ts` espelha os tipos de `types.ts` porque
 * precisa compilar sem o alias `@/` no `npm test`. Se um dos dois mudar e os
 * dois deixarem de ser equivalentes, estas linhas quebram o `tsc --noEmit`.
 */
type Equivalente<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
export type _TravaCropPlan = Equivalente<PureCropPlan, CropPlan>;
export type _TravaFaceSample = Equivalente<PureFaceSample, FaceSample>;
export type _TravaNormBox = Equivalente<PureNormBox, NormBox>;

/** Amostragem completa de um clipe: rostos + histogramas da MESMA passada. */
export type ReframeScan = { samples: FaceSample[]; hists: HistSample[] };

export type SampleFacesInput = {
  /** clipe já cortado (saída do cutClipCopy) */
  clip: Blob;
  /**
   * Segundo ABSOLUTO (na fonte) do 1º frame do clipe. Ver render.ts: quando o
   * corte saiu COM `-copyts` isso é o `probeFirstPts`; sem `-copyts` o chamador
   * passa a melhor estimativa (o `-ss` pedido), porque o arquivo não carrega
   * mais essa informação.
   */
  clipFirstPts: number;
  /** intervalo ABSOLUTO do corte final */
  absStart: number;
  absEnd: number;
  /** amostras por segundo (padrão 5) */
  fps?: number;
  /** largura da imagem de análise (padrão 320 px) */
  analysisWidth?: number;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
};

const DEFAULT_SAMPLE_FPS = 5;
const DEFAULT_ANALYSIS_WIDTH = 320;

function seekVideo(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      video.removeEventListener('seeked', finish);
      clearTimeout(timer);
      resolve();
    };
    // 'seeked' nem sempre dispara quando o alvo é o frame atual (ou o fim do
    // arquivo) — o timeout mantém a varredura viva, igual ao face-detector.
    const timer = setTimeout(finish, 4000);
    video.addEventListener('seeked', finish);
    video.currentTime = t;
  });
}

/** Histograma de luminância em 16 bins, normalizado (soma 1). */
export function lumaHistogram(data: Uint8ClampedArray, bins = HIST_BINS): number[] {
  const hist = new Array<number>(bins).fill(0);
  let total = 0;
  // passo de 4 pixels: histograma de cena não precisa de todos os pontos e
  // isso deixa a varredura barata mesmo num clipe longo
  for (let i = 0; i < data.length; i += 16) {
    const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    const b = Math.min(bins - 1, Math.floor((l / 256) * bins));
    hist[b]++;
    total++;
  }
  if (total > 0) for (let i = 0; i < bins; i++) hist[i] /= total;
  return hist;
}

/**
 * Varre o clipe em `fps` amostras por segundo entre `absStart` e `absEnd`,
 * devolvendo os rostos (normalizados na FONTE) e o histograma de cada amostra.
 * Falha do detector não derruba a varredura: a amostra sai sem rosto e o
 * planner degrada pra centro.
 */
export async function sampleFaces(input: SampleFacesInput): Promise<ReframeScan> {
  const {
    clip,
    clipFirstPts,
    absStart,
    absEnd,
    fps = DEFAULT_SAMPLE_FPS,
    analysisWidth = DEFAULT_ANALYSIS_WIDTH,
    onProgress,
    signal,
  } = input;

  const throwIfAborted = () => {
    if (signal?.aborted) throw new Error(CANCELLED_ERROR);
  };
  throwIfAborted();

  const dur = Math.max(0, absEnd - absStart);
  const step = 1 / Math.max(1, fps);
  const total = Math.max(1, Math.floor(dur / step));

  const url = URL.createObjectURL(clip);
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'auto';
  video.playsInline = true;

  const samples: FaceSample[] = [];
  const hists: HistSample[] = [];

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout ao abrir o clipe')), 15000);
      video.onloadedmetadata = () => {
        clearTimeout(timer);
        resolve();
      };
      video.onerror = () => {
        clearTimeout(timer);
        reject(new Error('o navegador não abriu o clipe pra analisar o enquadro'));
      };
      video.src = url;
    });
    throwIfAborted();

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return { samples, hists };

    const canvas = document.createElement('canvas');
    const scale = Math.min(1, analysisWidth / vw);
    canvas.width = Math.max(2, Math.round(vw * scale));
    canvas.height = Math.max(2, Math.round(vh * scale));
    const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
    if (!ctx) return { samples, hists };

    const clipDur = isFinite(video.duration) ? video.duration : dur;

    for (let i = 0; i < total; i++) {
      throwIfAborted();
      const tAbs = absStart + (i + 0.5) * step;
      // tempo DENTRO do clipe: o <video> conta a partir do 1º frame do arquivo
      const tLocal = Math.max(0, Math.min(tAbs - clipFirstPts, Math.max(0, clipDur - 0.001)));
      await seekVideo(video, tLocal);
      throwIfAborted();

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      let hist: number[] = [];
      try {
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        hist = lumaHistogram(img.data);
      } catch {
        hist = [];
      }
      if (hist.length > 0) hists.push({ tSec: tAbs, hist });

      const faces = await detectFacesInImage(canvas);
      samples.push({ tSec: tAbs, faces });

      if (i % 5 === 0 || i === total - 1) onProgress?.(i + 1, total);
    }

    return { samples, hists };
  } finally {
    try {
      video.removeAttribute('src');
      video.load();
    } catch {
      /* ignora */
    }
    URL.revokeObjectURL(url);
  }
}

export type PlanReframeInput = SampleFacesInput & {
  srcW: number;
  srcH: number;
  aspect: AspectRatio;
  mode: ReframeMode;
};

/**
 * Atalho: varre o clipe e já devolve o plano. Modos que não precisam de rosto
 * (`ajustar`, `centro`) e aspecto igual ao da fonte NEM abrem o vídeo.
 */
export async function planReframe(
  input: PlanReframeInput,
): Promise<{ plan: CropPlan; scan: ReframeScan | null }> {
  const { srcW, srcH, aspect, mode } = input;
  const semVarredura = mode === 'ajustar' || mode === 'centro';
  const vazio: ReframeScan = { samples: [], hists: [] };
  if (semVarredura) {
    return { plan: planCrop([], [], { srcW, srcH, aspect, mode }), scan: null };
  }
  // aspecto igual ao da fonte: o planner devolve 'none' sem olhar nada
  const seco = planCrop([], [], { srcW, srcH, aspect, mode: 'centro' });
  if (seco.layout === 'none') return { plan: seco, scan: null };

  const scan = await sampleFaces(input).catch((e) => {
    if (e instanceof Error && e.message === CANCELLED_ERROR) throw e;
    console.warn('[auto-cortes] varredura de rostos falhou, caindo pro centro:', e);
    return vazio;
  });
  const cuts = sceneCuts(scan.hists);
  return { plan: planCrop(scan.samples, cuts, { srcW, srcH, aspect, mode }), scan };
}
