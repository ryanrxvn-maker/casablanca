'use client';

/**
 * AUTO CORTES — pipeline do navegador (fiação).
 *
 * A máquina de estados inteira (fases, persistência, fila de render com gate
 * que auto-cura, retomada, ZIP) mora em `pipeline-core.ts`, que é PURO e
 * testado no `npm test`. Este arquivo só entrega as dependências reais:
 * IndexedDB (store), ingestão (extensão/OPFS/upload), transcrição, análise e o
 * motor de render (ffmpeg-wasm + WebCodecs + engine de tipografia).
 *
 * Fluxo de UM corte, na ordem em que a UI vê acontecer:
 *   cutClipCopy (WORKERFS, sem re-encode)  →  probeFirstPts  →  MINIATURA
 *   →  áudio AAC do trecho  →  planReframe  →  renderClip  →  saveBlob
 *
 * Duas decisões que valem comentário:
 *  - a fonte é montada UMA vez por pista (instância do pool) e reusada em todos
 *    os cortes daquela pista: montar por corte custaria um WORKERFS novo a cada
 *    vez num arquivo de 2-4 GB;
 *  - a miniatura sai ANTES do render, com o enquadro provisório (centro), pro
 *    grid aparecer cedo; quando o MP4 fica pronto ela é substituída pela
 *    definitiva, aí sim com o CropPlan real (WYSIWYG de verdade).
 */

import type { FFmpeg } from '@ffmpeg/ffmpeg';

import { FriendlyError, toFriendlyMessage } from '@/lib/friendly-error';
import { logHistory } from '@/lib/history';
import { sleepUnthrottled } from '@/lib/unthrottled-clock';
import { buildZip } from '@/lib/zip-builder';
import { getFFmpegPool, recommendedPoolSize } from '@/lib/ffmpeg-pool';
import {
  cutClipCopy,
  extractAudioRangeAac,
  isCancellationError,
  mountInputs,
  probeFirstPts,
} from '@/lib/ffmpeg-worker';
import { drawCaptions } from '@/lib/typography/engine';
import { ensureTypoFonts } from '@/lib/typography/fonts';
import { getPreset } from '@/lib/typography/presets';
import { blocksToSrt } from '@/lib/typography/group';

import { buildClipCaptions, captionStyleFor } from './captions';
import { drawHeadline, headlineStyleById, makeHeadlineBlock } from './headline';
import { ingestLink, ingestUpload, uploadSignature } from './ingest';
import { opfsGetFile } from './opfs';
import { analyzeTranscript } from './analyze-client';
import { transcribeSource } from './transcribe';
import { curate, type EnergyEnvelope } from './curador/curate';
import { polishTitles } from './titles-ia';
import { extractEnergyEnvelope } from '@/lib/ffmpeg-worker';
import { planReframe, planCrop } from './reframe';
import { makeComposer, renderClip, renderThumb, type OverlayFn, type OutSize } from './render';
import {
  clipBlobKey,
  deleteBlob,
  listProjects,
  loadBlob,
  loadProject,
  pruneProjects,
  saveBlob,
  saveProject,
  thumbBlobKey,
} from './store';
import {
  createPipelineCore,
  emptyProject,
  newProjectId,
  type PipelineDeps,
  type Pipeline,
  type PipelineSource,
  type RenderEngine,
  type RenderJob,
  type RenderLane,
  type RenderOutput,
  type ThumbJob,
} from './pipeline-core';
import { ASPECT_OUTPUT, type ClipSettings, type CropPlan, type Project } from './types';

export type { Pipeline, PipelineSource } from './pipeline-core';
export { newProjectId } from './pipeline-core';

// ───────────────────────────────────────────────────────────────────────────
// Projeto
// ───────────────────────────────────────────────────────────────────────────

/**
 * Abre o projeto salvo ou cria um novo JÁ PERSISTIDO (o registro nasce no IDB
 * antes de qualquer trabalho — princípio de persistir cedo).
 */
export async function loadOrCreateProject(projectId?: string): Promise<Project> {
  if (projectId) {
    try {
      const salvo = await loadProject(projectId);
      if (salvo) return salvo;
    } catch (e) {
      console.warn('[auto-cortes] não consegui abrir o projeto salvo:', e);
    }
  }
  const novo = emptyProject(projectId || newProjectId());
  try {
    await saveProject(novo);
  } catch (e) {
    console.warn('[auto-cortes] projeto novo não persistiu agora (segue em memória):', e);
  }
  return novo;
}

export async function listRecentProjects(): ReturnType<typeof listProjects> {
  return listProjects();
}

// ───────────────────────────────────────────────────────────────────────────
// Utilidades do navegador
// ───────────────────────────────────────────────────────────────────────────

function isCancel(e: unknown): boolean {
  if (isCancellationError(e)) return true;
  if (e instanceof Error && e.name === 'AbortError') return true;
  if (e instanceof Error && /cancelado por voc/i.test(e.message)) return true;
  return false;
}

function extOf(name: string): string {
  const m = /\.([a-zA-Z0-9]{2,5})$/.exec(name || '');
  return m ? m[1].toLowerCase() : 'mp4';
}

/** Metadados de um clipe já cortado (o probe do ffmpeg só entrega altura). */
async function probeSizeFromClip(clip: Blob): Promise<{ width: number; height: number } | null> {
  if (typeof document === 'undefined') return null;
  const url = URL.createObjectURL(clip);
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'metadata';
  video.playsInline = true;
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout lendo as dimensões do trecho')), 15000);
      video.onloadedmetadata = () => {
        clearTimeout(timer);
        resolve();
      };
      video.onerror = () => {
        clearTimeout(timer);
        reject(new Error('o navegador não abriu o trecho pra ler as dimensões'));
      };
      video.src = url;
    });
    if (video.videoWidth > 0 && video.videoHeight > 0) {
      return { width: video.videoWidth, height: video.videoHeight };
    }
    return null;
  } catch (e) {
    console.warn('[auto-cortes] não consegui ler as dimensões da fonte:', e);
    return null;
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

/**
 * Overlay do corte = legenda animada + headline, com o MESMO `drawCaptions` da
 * Tipografia (é isso que garante o WYSIWYG entre card, miniatura e MP4).
 * `captionPresetId: null` e `headlinePresetId: null` significam "sem" — e aí a
 * camada simplesmente não é desenhada.
 */
function makeOverlay(job: {
  settings: ClipSettings;
  captionBlocks: RenderJob['captionBlocks'];
  headline: string;
  durationMs: number;
}): OverlayFn {
  const s = job.settings;
  const out = ASPECT_OUTPUT[s.aspect];

  const capPreset = s.captionPresetId ? getPreset(s.captionPresetId) : null;
  const capStyle = s.captionPresetId ? captionStyleFor(s.aspect, s.captionPresetId) : null;
  const capBlocks = capPreset ? job.captionBlocks ?? [] : [];

  const texto = (job.headline || '').trim();
  const hlPreset = s.headlinePresetId && texto ? getPreset(s.headlinePresetId) : null;
  const hlStyle = s.headlinePresetId && texto ? headlineStyleById(s.aspect, s.headlinePresetId) : null;
  const hlDur =
    s.headlineDuration === 'primeiros5s' ? Math.min(5000, Math.max(1, job.durationMs)) : Math.max(1, job.durationMs);
  const hlBlock = hlPreset ? makeHeadlineBlock(texto, hlDur) : null;

  return (ctx, tRelMs) => {
    if (capPreset && capStyle && capBlocks.length > 0) {
      drawCaptions(ctx, capBlocks, capPreset, capStyle, tRelMs, out.w, out.h);
    }
    if (hlBlock && hlPreset && hlStyle) {
      drawHeadline(ctx, hlBlock, hlPreset, hlStyle, tRelMs, out.w, out.h);
    }
  };
}

/** Plano provisório (sem varrer rosto) — usado só pela miniatura antecipada. */
function planoProvisorio(settings: ClipSettings, srcW: number, srcH: number): CropPlan {
  return planCrop([], [], {
    srcW: srcW || 1920,
    srcH: srcH || 1080,
    aspect: settings.aspect,
    mode: settings.reframe === 'ajustar' ? 'ajustar' : 'centro',
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Motor de render (ffmpeg-wasm + WebCodecs)
// ───────────────────────────────────────────────────────────────────────────

function createBrowserEngine(): RenderEngine {
  let file: File | null = null;

  return {
    async begin(o) {
      file = o.file;
      // Fontes UMA vez por lote: cada renderClip/renderThumb recebe skipFonts.
      await ensureTypoFonts();
    },

    async lane(): Promise<RenderLane> {
      if (!file) throw new FriendlyError('O vídeo não está aberto. Selecione o arquivo e tente de novo.');
      const pool = getFFmpegPool(recommendedPoolSize());
      const ff: FFmpeg = await pool.acquire();
      const inputName = `ac_src.${extOf(file.name)}`;
      let mounted: { dir: string; cleanup: () => Promise<void> } | null = null;
      try {
        mounted = await mountInputs(ff, [{ name: inputName, data: file }]);
      } catch (e) {
        pool.release(ff);
        throw e;
      }
      const mountedPath = `${mounted.dir}/${inputName}`;
      const fonte = mounted;

      return {
        async cut(startSec, endSec) {
          const r = await cutClipCopy(ff, mountedPath, startSec, endSec);
          // Com -copyts o pts do 1º frame É o segundo absoluto na fonte. Sem
          // ele (fallback do cutClipCopy), o clipe começa em 0 e a melhor
          // referência que existe é o -ss que a gente mesmo pediu.
          let firstPts = Math.max(0, startSec);
          if (r.copyts) {
            const pts = await probeFirstPts(ff, r.blob).catch(() => 0);
            if (pts > 0) firstPts = pts;
          }
          return { blob: r.blob, firstPts };
        },
        async audio(clip, startSec, durSec) {
          return extractAudioRangeAac(clip, startSec, durSec, { ff });
        },
        async close() {
          try {
            await fonte.cleanup();
          } finally {
            pool.release(ff);
          }
        },
      };
    },

    async probeSize(clip) {
      return probeSizeFromClip(clip);
    },

    async thumb(job: ThumbJob) {
      const out: OutSize = ASPECT_OUTPUT[job.settings.aspect];
      const plan = job.cropPlan ?? planoProvisorio(job.settings, job.srcW, job.srcH);
      const compose = makeComposer(plan, job.srcW || 1920, job.srcH || 1080, out);
      const overlay = makeOverlay({
        settings: job.settings,
        captionBlocks: job.captionBlocks,
        headline: job.headline,
        durationMs: 60_000,
      });
      try {
        return await renderThumb(job.clipBlob, job.tAbs, job.clipFirstPts, compose, overlay, out, {
          skipFonts: true,
        });
      } catch (e) {
        if (isCancel(e)) throw e;
        console.warn('[auto-cortes] miniatura falhou:', e);
        return null;
      }
    },

    async run(job: RenderJob): Promise<RenderOutput> {
      const out: OutSize = ASPECT_OUTPUT[job.settings.aspect];
      const srcW = job.srcW || 1920;
      const srcH = job.srcH || 1080;

      job.onStage('enquadrando', 0.02);
      const { plan } = await planReframe({
        clip: job.clipBlob,
        clipFirstPts: job.clipFirstPts,
        absStart: job.absStart,
        absEnd: job.absEnd,
        srcW,
        srcH,
        aspect: job.settings.aspect,
        mode: job.settings.reframe,
        signal: job.signal,
        onProgress: (done, total) => job.onStage('enquadrando', 0.02 + 0.08 * (total ? done / total : 0)),
      });

      const compose = makeComposer(plan, srcW, srcH, out);
      const overlay = makeOverlay({
        settings: job.settings,
        captionBlocks: job.captionBlocks,
        headline: job.headline,
        durationMs: (job.absEnd - job.absStart) * 1000,
      });

      job.onStage('renderizando', 0.1);
      const res = await renderClip({
        clip: job.clipBlob,
        absStart: job.absStart,
        absEnd: job.absEnd,
        clipFirstPts: job.clipFirstPts,
        out,
        compose,
        overlay,
        audio: job.audio,
        skipFonts: true,
        signal: job.signal,
        onProgress: (p) => {
          if (p.phase === 'audio') job.onStage('audio', 0.9 + 0.08 * p.ratio);
          else if (p.phase === 'finalizando') job.onStage('renderizando', 0.99);
          else job.onStage('renderizando', 0.1 + 0.8 * p.ratio);
        },
      });

      // Miniatura DEFINITIVA (mesmo compositor do MP4 que acabou de sair).
      let thumb: Blob | null = null;
      try {
        const tAbs = Math.min(job.absStart + 1, Math.max(job.absStart, job.absEnd - 0.05));
        thumb = await renderThumb(job.clipBlob, tAbs, job.clipFirstPts, compose, overlay, out, { skipFonts: true });
      } catch (e) {
        if (isCancel(e)) throw e;
        console.warn('[auto-cortes] miniatura final falhou (fica a provisória):', e);
      }

      return { blob: res.blob, thumb, cropPlan: plan, mode: res.mode };
    },

    async end() {
      file = null;
    },
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Dependências reais
// ───────────────────────────────────────────────────────────────────────────

/**
 * Envelope de energia (RMS 0,5 s) da fonte. Monta o arquivo numa instância do
 * pool (WORKERFS, sem heap) e devolve a instância no fim. Qualquer falha vira
 * `null`: o curador pontua sem prosódia em vez de derrubar o lote.
 */
async function energiaDoVideo(file: File, signal?: AbortSignal): Promise<EnergyEnvelope | null> {
  const pool = getFFmpegPool(recommendedPoolSize());
  let ff: Awaited<ReturnType<typeof pool.acquire>> | null = null;
  let limpar: (() => Promise<void>) | null = null;
  try {
    if (signal?.aborted) return null;
    ff = await pool.acquire();
    const nome = `ac_energy_${Date.now().toString(36)}.${(file.name.split('.').pop() || 'mp4').slice(0, 4)}`;
    const m = await mountInputs(ff, [{ name: nome, data: file }]);
    limpar = m.cleanup;
    return await extractEnergyEnvelope(ff, `${m.dir}/${nome}`);
  } catch (e) {
    console.warn('[auto-cortes] envelope de energia indisponível:', e);
    return null;
  } finally {
    if (limpar) await limpar().catch(() => {});
    if (ff) pool.release(ff);
  }
}

function browserDeps(): PipelineDeps {
  return {
    store: {
      saveProject,
      loadProject,
      saveBlob,
      loadBlob,
      deleteBlob,
      prune: (o) => pruneProjects(o) as Promise<unknown>,
    },
    keys: { clip: clipBlobKey, thumb: thumbBlobKey },
    ingest: {
      link: (url, o) =>
        ingestLink(url, {
          projectId: o.projectId,
          signal: o.signal,
          onWarn: o.onWarn,
          onProgress: (p) => o.onProgress?.({ ratio: p.ratio, label: p.label }),
        }),
      upload: (f) => ingestUpload(f),
      signature: uploadSignature,
      fromOpfs: (path) => opfsGetFile(path, 'video/mp4'),
    },
    transcribe: (f, o) =>
      transcribeSource(f, {
        durationSec: o.durationSec,
        language: o.language,
        pool: getFFmpegPool(recommendedPoolSize()),
        onProgress: o.onProgress,
        onWarning: o.onWarning,
        onDuration: o.onDuration,
        signal: o.signal,
      }),
    analyze: async (input, o) => {
      // 1) CURADOR LOCAL — sem rede, sem chave, sem cota. É sempre o que manda.
      const energy = await energiaDoVideo(input.file, o.signal);
      o.onProgress?.({ stage: 'reduce' });
      const bruto = curate({
        transcript: input.transcript,
        energy,
        settings: input.settings,
        durationSec: input.source.durationSec,
      });
      // O curador local trabalha direto nos cortes finais: não existe etapa de
      // "candidatos" (isso era da leitura por IA em 2 passos).
      const local = { ...bruto, candidates: [] };

      // 2) IA de texto (opcional) reescreve SÓ título e headline dos cortes que o
      // curador escolheu — uma chamada pequena. Falhou? Fica o texto local.
      if (input.settings.intelligence !== 'ia') return local;
      const polido = await polishTitles(local.clips, input.transcript, { signal: o.signal });
      return {
        ...local,
        clips: polido.clips,
        warnings: polido.warning ? [...local.warnings, polido.warning] : local.warnings,
      };
    },
    engine: createBrowserEngine(),
    captions: (words, startMs, endMs, pace) => buildClipCaptions(words, startMs, endMs, pace),
    srt: (blocks) => blocksToSrt(blocks),
    zip: (entries) => buildZip(entries.map((e) => ({ name: e.name, data: e.data }))),
    logHistory: (ev) => logHistory({ tool: ev.tool, title: ev.title, kind: 'done', meta: ev.meta }),
    sleep: (ms) => sleepUnthrottled(ms),
    now: () => Date.now(),
    objectUrl: {
      create: (b) => URL.createObjectURL(b),
      revoke: (u) => URL.revokeObjectURL(u),
    },
    friendly: (e, fallback) => toFriendlyMessage(e, fallback),
    isCancel,
    makeError: (m) => new FriendlyError(m),
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Fábrica
// ───────────────────────────────────────────────────────────────────────────

export type CreatePipelineOptions = {
  projectId: string;
  /** Arquivo em memória (upload) — a página guarda o `File` do input. */
  getFile?: () => File | null;
  /** Projeto já lido do IDB (`loadOrCreateProject`). Sem ele, `resume()` relê. */
  initial?: Project | null;
  /** Substituição de dependências (testes/harness). Não usar na UI. */
  deps?: Partial<PipelineDeps>;
};

export function createPipeline(opts: CreatePipelineOptions): Pipeline {
  const base = browserDeps();
  const deps: PipelineDeps = opts.deps ? { ...base, ...opts.deps } : base;
  return createPipelineCore({
    projectId: opts.projectId,
    initial: opts.initial ?? null,
    getFile: opts.getFile,
    deps,
  });
}
