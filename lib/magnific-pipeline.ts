/**
 * Magnific Auto Pipeline v3.0 — usa o entrypoint batch da extension
 * (`MG_RUN_PIPELINE`) que orquestra TUDO dentro da extensao:
 *   1. Ensure Space
 *   2. Cria N pares Image+Video conectados (configurados Nano Banana 2 + Kling 2.5)
 *   3. Dispara imagens em ondas de 12 simultaneas
 *   4. Dispara videos em ondas de 6 simultaneos
 *   5. Garante UNLIMITED ON sempre (nunca gasta creditos)
 *   6. Detecta render via DOM (pikaso.cdnpk.net/private/.../render.jpg + .mp4)
 *
 * Esta lib agora e fina — pega prompts, dispara o pipeline, baixa MP4s,
 * empacota ZIP. O trabalho pesado e na extension.
 */

import {
  base64ToBlob,
  downloadMagnificAsset,
  runMagnificPipelineExt,
  runMagnificPipelineTemplateExt,
  type ImageModel,
  type PipelineRunResult,
  type ProgressFn,
  type VideoModel,
} from './magnific-extension-bridge';
import { buildZip } from './zip-builder';

export type MagnificTakeInput = {
  idx: number;
  imagePrompt: string;
  videoPrompt?: string;
};

export type MagnificPipelineConfig = {
  spaceName: string;
  takes: MagnificTakeInput[];
  imageModel?: ImageModel;
  videoModel?: VideoModel;
  imageConcurrency?: number;
  videoConcurrency?: number;
  existingSpaceId?: string;
  /** Aspect ratio padrao 9:16 (vertical reels) */
  aspect?: '9:16' | '16:9' | '1:1';
  /** Quality imagem (1K = default Nano Banana 2 unlimited) */
  imageQuality?: '1K' | '2K';
  /** Quality video (720p = default Kling 2.5 unlimited) */
  videoQuality?: '720p' | '1080p';
  /** Duracao em s do video (10s = limite Kling unlimited) */
  videoDuration?: 5 | 10;
  /**
   * v3.2.0: TEMPLATE MODE — se setado, duplica este space (deve ter >= takes
   * pares Kling 2.5 LOCK pre-configurados) ao inves de criar do zero. Pula
   * race condition Seedance + corta setup de ~5min pra ~20s.
   */
  templateSpaceId?: string;
};

export type TakeState =
  | { idx: number; status: 'idle' }
  | { idx: number; status: 'running'; phase: string; percent: number; message: string }
  | { idx: number; status: 'image-done'; imageUrl: string }
  | { idx: number; status: 'video-done'; imageUrl: string; videoUrl: string }
  | { idx: number; status: 'downloading'; videoUrl: string }
  | { idx: number; status: 'ready'; videoUrl: string; mp4Size: number }
  | { idx: number; status: 'failed'; error: string };

export type PipelineProgress = {
  spaceId?: string;
  spaceUrl?: string;
  takes: TakeState[];
  ready: number;
  total: number;
  message?: string;
  phase?: string;
  percent?: number;
};

export type PipelineCallbacks = {
  onProgress?: (p: PipelineProgress) => void;
  signal?: AbortSignal;
};

type RunnerResult = {
  ok: boolean;
  spaceId?: string;
  spaceUrl?: string;
  takes: TakeState[];
  zipBlob?: Blob;
  zipName?: string;
  successCount: number;
  failedCount: number;
  /** v3.5.42: true só quando TODOS os takes geraram (ZIP só sai completo) */
  complete?: boolean;
  /** idxs que ainda faltam quando não está completo */
  missingIdxs?: number[];
};

export async function runMagnificPipeline(
  cfg: MagnificPipelineConfig,
  cb: PipelineCallbacks = {},
): Promise<RunnerResult> {
  const {
    spaceName,
    takes,
    imageModel = 'nano-banana-2',
    videoModel = 'kling-25',
    imageConcurrency = 12,
    videoConcurrency = 6,
    existingSpaceId,
    aspect = '9:16',
    imageQuality = '1K',
    videoQuality = '720p',
    videoDuration = 10,
    templateSpaceId,
  } = cfg;
  const { onProgress, signal } = cb;

  const state: TakeState[] = takes.map((t) => ({ idx: t.idx, status: 'idle' as const }));
  let spaceId = existingSpaceId;
  let spaceUrl: string | undefined;

  const emit = (extra: Partial<PipelineProgress> = {}) => {
    const ready = state.filter((s) => s.status === 'ready').length;
    onProgress?.({
      spaceId,
      spaceUrl,
      takes: [...state],
      ready,
      total: takes.length,
      ...extra,
    });
  };

  emit({ message: 'Disparando pipeline na extension Magnific...', phase: 'starting', percent: 0 });

  // Chama o entrypoint batch da extension — TEMPLATE mode vs classic
  let pipeRes: PipelineRunResult;
  try {
    if (templateSpaceId) {
      // v3.2.0: duplica template + atribui prompts + dispara
      const r = await runMagnificPipelineTemplateExt(
        {
          templateSpaceId,
          newSpaceName: spaceName,
          takes: takes.map((t) => ({
            idx: t.idx,
            imagePrompt: t.imagePrompt,
            videoPrompt: t.videoPrompt || '',
          })),
          imageConcurrency,
          videoConcurrency,
          strictLock: true,
        },
        (stage, percent, message) => {
          emit({ phase: 'tpl:' + stage, percent, message });
        },
      );
      pipeRes = r;
    } else {
      pipeRes = await runMagnificPipelineExt(
        {
          spaceName,
          spaceId: existingSpaceId,
          takes: takes.map((t) => ({
            idx: t.idx,
            imagePrompt: t.imagePrompt,
            videoPrompt: t.videoPrompt || '',
          })),
          imageModel,
          videoModel,
          imageConcurrency,
          videoConcurrency,
          aspect,
          imageQuality,
          videoQuality,
          videoDuration,
        },
        (stage, percent, message) => {
          emit({ phase: stage, percent, message });
        },
      );
    }
  } catch (e) {
    return {
      ok: false,
      takes: state,
      successCount: 0,
      failedCount: takes.length,
    };
  }
  spaceId = pipeRes.spaceId;
  spaceUrl = pipeRes.spaceUrl;

  // Aplica resultados em state
  for (let i = 0; i < state.length; i++) {
    const r = pipeRes.results.find((x) => x.idx === state[i].idx) || pipeRes.results[i];
    if (!r) continue;
    if (r.videoUrl) {
      state[i] = { idx: state[i].idx, status: 'video-done', imageUrl: r.imageUrl || '', videoUrl: r.videoUrl };
    } else if (r.imageUrl) {
      state[i] = { idx: state[i].idx, status: 'image-done', imageUrl: r.imageUrl };
    } else if (r.error) {
      state[i] = { idx: state[i].idx, status: 'failed', error: r.error };
    }
  }
  emit({ phase: 'download', percent: 95, message: 'Baixando MP4s...' });

  // Download dos MP4s + ZIP
  const filesForZip: Array<{ name: string; data: Blob }> = [];
  const manifest: Array<any> = [];
  const zippedIdx = new Set<number>();

  // Helper: baixa todos os takes 'video-done' que ainda não entraram no ZIP.
  // Reusado após o disparo inicial E após cada rodada de retry.
  const downloadDoneTakes = async () => {
    for (let i = 0; i < state.length; i++) {
      const s = state[i];
      if (s.status !== 'video-done') continue;
      if (zippedIdx.has(s.idx)) continue;
      if (signal?.aborted) break;
      state[i] = { idx: s.idx, status: 'downloading', videoUrl: s.videoUrl };
      emit();
      try {
        const { base64, size } = await downloadMagnificAsset(s.videoUrl);
        const blob = base64ToBlob(base64, 'video/mp4');
        filesForZip.push({ name: `parte${s.idx}.mp4`, data: blob });
        zippedIdx.add(s.idx);
        manifest.push({
          idx: s.idx,
          imagePrompt: takes[i].imagePrompt,
          videoPrompt: takes[i].videoPrompt || '',
          imageUrl: s.imageUrl,
          videoUrl: s.videoUrl,
          bytes: size,
        });
        state[i] = { idx: s.idx, status: 'ready', videoUrl: s.videoUrl, mp4Size: size };
        emit();
      } catch (e) {
        state[i] = { idx: s.idx, status: 'failed', error: 'download: ' + (e as Error).message };
        emit();
      }
    }
  };

  await downloadDoneTakes();

  // v3.5.43 (pedido do user): AUTO-RETRY silencioso dos takes que faltaram,
  // REUSANDO o mesmo space, ANTES do ZIP. Sem mostrar erro — só garante que
  // TODOS os takes disparados vão estar no ZIP. Loop até completar ou esgotar
  // tentativas. Ex: 5 disparados, 4 ok + 1 falhou → re-gera só o 1 que faltou.
  const MAX_RETRY_ROUNDS = 4;
  for (let round = 1; round <= MAX_RETRY_ROUNDS; round++) {
    if (signal?.aborted) break;
    const missing = state.filter((s) => s.status !== 'ready');
    if (missing.length === 0) break; // todos prontos → segue pro ZIP

    emit({
      phase: 'retry',
      percent: 95,
      message: `Recuperando ${missing.length} take(s) faltante(s) — tentativa ${round}/${MAX_RETRY_ROUNDS} (mesmo space)...`,
    });

    const missingTakes = missing
      .map((s) => takes.find((t) => t.idx === s.idx))
      .filter((t): t is MagnificTakeInput => !!t);
    if (!missingTakes.length) break;

    let retryRes: PipelineRunResult | null = null;
    try {
      retryRes = await runMagnificPipelineExt(
        {
          spaceName,
          spaceId, // CRÍTICO: reusa o MESMO space (não cria outro)
          takes: missingTakes.map((t) => ({
            idx: t.idx,
            imagePrompt: t.imagePrompt,
            videoPrompt: t.videoPrompt || '',
          })),
          imageModel,
          videoModel,
          imageConcurrency,
          videoConcurrency,
          aspect,
          imageQuality,
          videoQuality,
          videoDuration,
        },
        (stage, percent, message) => {
          emit({ phase: 'retry:' + stage, percent, message });
        },
      );
    } catch {
      continue; // tentativa falhou — próxima rodada
    }

    // aplica resultados do retry no state
    for (const r of retryRes?.results || []) {
      const i = state.findIndex((s) => s.idx === r.idx);
      if (i < 0) continue;
      if (r.videoUrl) {
        state[i] = { idx: r.idx, status: 'video-done', imageUrl: r.imageUrl || '', videoUrl: r.videoUrl };
      } else if (r.imageUrl && state[i].status !== 'ready') {
        state[i] = { idx: r.idx, status: 'image-done', imageUrl: r.imageUrl };
      }
    }
    await downloadDoneTakes();
  }

  const successCount = state.filter((s) => s.status === 'ready').length;
  const failedCount = state.filter((s) => s.status === 'failed').length;
  const missingIdxs = state.filter((s) => s.status !== 'ready').map((s) => s.idx);
  const complete = successCount === takes.length;

  // ZIP só sai quando TODOS os takes estão prontos (após auto-retry). Se ainda
  // assim faltar após todas as tentativas, retorna sem zipBlob (sem download
  // parcial) — caso extremo; o normal é completar no retry.
  if (!complete) {
    return {
      ok: false,
      complete: false,
      missingIdxs,
      spaceId,
      spaceUrl,
      takes: state,
      successCount,
      failedCount,
    };
  }

  emit({ phase: 'zipping', percent: 98, message: 'Empacotando ZIP...' });
  filesForZip.push({
    name: 'manifest.json',
    data: new Blob(
      [JSON.stringify({ spaceName, spaceId, spaceUrl, imageModel, videoModel, manifest }, null, 2)],
      { type: 'application/json' },
    ),
  });
  const zipBlob = await buildZip(filesForZip);
  const safeName = spaceName.replace(/[^a-z0-9._-]+/gi, '_');
  const zipName = `${safeName}_brolls.zip`;

  emit({ phase: 'done', percent: 100, message: `Pipeline finalizada — ${successCount}/${takes.length} takes prontos.` });
  return {
    ok: true,
    complete: true,
    missingIdxs: [],
    spaceId,
    spaceUrl,
    takes: state,
    zipBlob,
    zipName,
    successCount,
    failedCount,
  };
}

// ============== PARSER DE PROMPTS (mantido do v1) ==============

/**
 * v3.5.45 — extrai JSON de forma robusta antes do parse estrito. Resolve o
 * bug "3 takes vira 14": LLMs/cópias trazem cercas markdown (```json), aspas
 * curvas, texto antes/depois, vírgula final — JSON.parse estrito falha e cai
 * no modo texto que super-conta. Aqui sanitizamos e extraímos o array/obj.
 */
function __extractJson(raw: string): any | null {
  let s = raw.trim();
  // 1) remove cercas markdown ```json ... ``` (ou ``` ... ```)
  s = s.replace(/^```[a-zA-Z]*\s*/m, '').replace(/```\s*$/m, '').trim();
  // 2) normaliza aspas curvas/tipográficas → retas
  s = s
    .replace(/[“”„‟″‶]/g, '"')
    .replace(/[‘’‚‛′‵]/g, "'");
  // 3) tenta direto
  const tryParse = (txt: string): any | null => {
    try { return JSON.parse(txt); } catch { return null; }
  };
  let j = tryParse(s);
  if (j != null) return j;
  // 4) extrai o maior bloco [...] ou {...} (ignora prosa antes/depois)
  const firstArr = s.indexOf('[');
  const lastArr = s.lastIndexOf(']');
  const firstObj = s.indexOf('{');
  const lastObj = s.lastIndexOf('}');
  const candidates: string[] = [];
  if (firstArr !== -1 && lastArr > firstArr) candidates.push(s.slice(firstArr, lastArr + 1));
  if (firstObj !== -1 && lastObj > firstObj) candidates.push(s.slice(firstObj, lastObj + 1));
  for (const c of candidates) {
    j = tryParse(c);
    if (j != null) return j;
    // 5) remove vírgulas finais antes de ] ou }
    const noTrailing = c.replace(/,\s*([\]}])/g, '$1');
    j = tryParse(noTrailing);
    if (j != null) return j;
  }
  return null;
}

export function parseMagnificPrompts(raw: string): MagnificTakeInput[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  {
    const j = __extractJson(trimmed);
    let arr: any[] | null = null;
    if (Array.isArray(j)) arr = j;
    else if (Array.isArray(j?.prompts)) arr = j.prompts;
    else if (Array.isArray(j?.takes)) arr = j.takes;
    else if (Array.isArray(j?.nano_banana_prompts)) arr = j.nano_banana_prompts;
    if (arr) {
      const out: MagnificTakeInput[] = [];
      arr.forEach((item: any, i: number) => {
        if (typeof item === 'string') {
          const s = item.trim();
          if (s) out.push({ idx: i + 1, imagePrompt: s, videoPrompt: '' });
          return;
        }
        const imagePrompt = String(
          item.imagePrompt || item.image_prompt || item.nano_banana_prompt || item.prompt || item.image || '',
        ).trim();
        const videoPrompt = String(
          item.videoPrompt || item.video_prompt || item.kling_prompt || item.motion || item.video || '',
        ).trim();
        if (imagePrompt) out.push({ idx: i + 1, imagePrompt, videoPrompt });
      });
      return out;
    }
  }

  // Texto livre — só chega aqui se NÃO há JSON válido detectável
  let candidate = trimmed.split(/\n\s*(?:---+|===+|\*\*\*+)\s*\n|\n{2,}/g)
    .map((b) => b.trim())
    .filter(Boolean);
  if (candidate.length <= 1) {
    candidate = trimmed.split(/\n(?=\s*\d{1,3}[\.\)]\s)/g).map((b) => b.trim()).filter(Boolean);
  }
  if (candidate.length <= 1) {
    candidate = trimmed.split(/\n+/g).map((l) => l.trim()).filter(Boolean);
  }
  return candidate.map((block, i) => {
    let body = block.replace(/^\s*\d{1,3}[\.\)]\s*/, '').trim();
    let videoPrompt = '';
    const motionMatch = body.match(/(?:MOTION|VIDEO|KLING|ANIMATION)\s*[:\-]\s*([\s\S]+)$/i);
    if (motionMatch) {
      videoPrompt = motionMatch[1].trim();
      body = body.slice(0, motionMatch.index).trim();
    }
    body = body.replace(/^(?:IMG|IMAGE|PROMPT|NANO BANANA)\s*[:\-]\s*/i, '').trim();
    return { idx: i + 1, imagePrompt: body, videoPrompt };
  }).filter((t) => t.imagePrompt.length > 0);
}
