/**
 * Magnific Auto Pipeline — orquestra N prompts em N takes (imagem -> video)
 * usando a extension DARKO LAB Magnific Auto.
 *
 * Fluxo:
 *   1. Garante 1 Space novo no Magnific (nomeado pelo AD/codigo da task)
 *   2. Dispara N prompts -> imagens via Nano Banana 2/Pro (concorrencia 12)
 *   3. Dispara cada imagem -> video via Kling 2.5 (concorrencia 6)
 *   4. Baixa cada MP4 -> Blob
 *   5. Empacota tudo em ZIP final (take1.mp4 ... takeN.mp4 + manifest.json)
 *
 * IMPORTANTE: requer Plano Premium+ no Magnific (Kling 2.5 720p + Nano Banana
 * 1K ilimitado). Pipeline NAO mede credito — Premium+ e ilimitado nesses 2
 * modelos.
 */

import {
  animateMagnificImage,
  base64ToBlob,
  createMagnificSpace,
  downloadMagnificAsset,
  generateMagnificImage,
  type ImageModel,
  type VideoModel,
} from './magnific-extension-bridge';
import { buildZip } from './zip-builder';

export type MagnificTakeInput = {
  /** Index humano (1-based) — vira "take{idx}.mp4" no ZIP. */
  idx: number;
  /** Prompt em ingles pro Nano Banana 2/Pro. */
  imagePrompt: string;
  /** Prompt opcional pro Kling 2.5 (motion description). Default = vazio. */
  videoPrompt?: string;
};

export type MagnificPipelineConfig = {
  /** Nome do Space (ex: "AD15VN-PRPB06"). */
  spaceName: string;
  takes: MagnificTakeInput[];
  imageModel?: ImageModel;
  videoModel?: VideoModel;
  /** Concorrencia max para imagens. Default 12 (limite Magnific Premium+). */
  imageConcurrency?: number;
  /** Concorrencia max para videos. Default 6 (limite Magnific Premium+). */
  videoConcurrency?: number;
  /** Pode reusar um spaceId existente ao inves de criar um novo. */
  existingSpaceId?: string;
};

export type TakeState =
  | { idx: number; status: 'idle' }
  | { idx: number; status: 'image-pending'; percent: number; message: string }
  | { idx: number; status: 'image-done'; imageUrl: string; imageGenerationId: string }
  | { idx: number; status: 'video-pending'; percent: number; message: string; imageUrl: string }
  | { idx: number; status: 'video-done'; videoUrl: string; videoGenerationId: string; imageUrl: string }
  | { idx: number; status: 'downloading'; videoUrl: string }
  | { idx: number; status: 'ready'; videoUrl: string; mp4Size: number }
  | { idx: number; status: 'failed'; error: string };

export type PipelineProgress = {
  spaceId?: string;
  spaceUrl?: string;
  takes: TakeState[];
  /** Resumo: quantos prontos vs total. */
  ready: number;
  total: number;
  /** Mensagem global atual. */
  message?: string;
};

export type PipelineCallbacks = {
  onProgress?: (p: PipelineProgress) => void;
  /** Sinaliza abort externo — pipeline interrompe novas tasks (jobs in-flight
   *  continuam, mas resultado e ignorado). */
  signal?: AbortSignal;
};

type RunnerResult = {
  ok: boolean;
  spaceId?: string;
  spaceUrl?: string;
  takes: TakeState[];
  /** Blob do ZIP final com take1.mp4 ... takeN.mp4 + manifest.json. */
  zipBlob?: Blob;
  zipName?: string;
  /** Conta quantos viraram MP4 final. */
  successCount: number;
  failedCount: number;
};

/** Runs an async fn over items with a max concurrency window. */
async function withConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  let cursor = 0;
  const workers: Promise<void>[] = [];
  const worker = async () => {
    while (true) {
      if (signal?.aborted) return;
      const idx = cursor++;
      if (idx >= items.length) return;
      await fn(items[idx], idx);
    }
  };
  for (let i = 0; i < Math.min(limit, items.length); i++) workers.push(worker());
  await Promise.all(workers);
}

export async function runMagnificPipeline(
  cfg: MagnificPipelineConfig,
  cb: PipelineCallbacks = {},
): Promise<RunnerResult> {
  const {
    spaceName,
    takes,
    imageModel = 'nano-banana-2',
    videoModel = 'kling-2.5',
    imageConcurrency = 12,
    videoConcurrency = 6,
    existingSpaceId,
  } = cfg;
  const { onProgress, signal } = cb;

  const state: TakeState[] = takes.map((t) => ({ idx: t.idx, status: 'idle' as const }));
  let spaceId = existingSpaceId;
  let spaceUrl: string | undefined;

  const emit = (message?: string) => {
    const ready = state.filter((s) => s.status === 'ready').length;
    onProgress?.({
      spaceId,
      spaceUrl,
      takes: [...state],
      ready,
      total: takes.length,
      message,
    });
  };

  // 1) Cria/reusa Space
  if (!spaceId) {
    emit('Criando Space "' + spaceName + '"...');
    try {
      const r = await createMagnificSpace(spaceName);
      spaceId = r.spaceId || undefined;
      spaceUrl = r.url || undefined;
    } catch (e) {
      // Nao bloqueia — Magnific aceita generations sem space tambem
      emit('Sem Space (continuando avulso): ' + (e as Error).message);
    }
  } else {
    spaceUrl = `https://www.magnific.com/app/spaces/${spaceId}`;
  }

  // 2) Imagens em paralelo (max 12)
  emit('Disparando ' + takes.length + ' imagens (' + imageModel + ', concorrencia ' + imageConcurrency + ')...');
  await withConcurrency(
    takes,
    imageConcurrency,
    async (t, i) => {
      if (signal?.aborted) return;
      state[i] = { idx: t.idx, status: 'image-pending', percent: 0, message: 'Submetendo...' };
      emit();
      try {
        const r = await generateMagnificImage(
          { spaceId, prompt: t.imagePrompt, model: imageModel },
          (_stage, percent, message) => {
            state[i] = { idx: t.idx, status: 'image-pending', percent, message };
            emit();
          },
        );
        state[i] = {
          idx: t.idx,
          status: 'image-done',
          imageUrl: r.imageUrl,
          imageGenerationId: r.generationId,
        };
        emit();
      } catch (e) {
        state[i] = { idx: t.idx, status: 'failed', error: 'image: ' + (e as Error).message };
        emit();
      }
    },
    signal,
  );

  // 3) Videos em paralelo (max 6) — so pra takes com imagem ok
  emit('Animando takes com Kling 2.5 (concorrencia ' + videoConcurrency + ')...');
  const animatable = state
    .map((s, i) => ({ s, i, t: takes[i] }))
    .filter((x) => x.s.status === 'image-done');

  await withConcurrency(
    animatable,
    videoConcurrency,
    async (entry) => {
      const { i, t, s } = entry;
      if (signal?.aborted) return;
      if (s.status !== 'image-done') return;
      const imageUrl = s.imageUrl;
      const imageGenerationId = s.imageGenerationId;
      state[i] = { idx: t.idx, status: 'video-pending', percent: 0, message: 'Submetendo Kling...', imageUrl };
      emit();
      try {
        const r = await animateMagnificImage(
          {
            spaceId,
            imageGenerationId,
            imageUrl,
            prompt: t.videoPrompt || '',
            model: videoModel,
          },
          (_stage, percent, message) => {
            state[i] = { idx: t.idx, status: 'video-pending', percent, message, imageUrl };
            emit();
          },
        );
        state[i] = {
          idx: t.idx,
          status: 'video-done',
          videoUrl: r.videoUrl,
          videoGenerationId: r.videoGenerationId,
          imageUrl,
        };
        emit();
      } catch (e) {
        state[i] = { idx: t.idx, status: 'failed', error: 'video: ' + (e as Error).message };
        emit();
      }
    },
    signal,
  );

  // 4) Download das MP4 + ZIP
  emit('Baixando MP4s...');
  const filesForZip: Array<{ name: string; data: Blob }> = [];
  const manifest: Array<{
    idx: number;
    imagePrompt: string;
    videoPrompt: string;
    imageUrl: string;
    videoUrl: string;
    bytes: number;
  }> = [];

  for (let i = 0; i < state.length; i++) {
    const s = state[i];
    if (s.status !== 'video-done') continue;
    if (signal?.aborted) break;
    state[i] = { idx: s.idx, status: 'downloading', videoUrl: s.videoUrl };
    emit();
    try {
      const { base64, size } = await downloadMagnificAsset(s.videoUrl);
      const blob = base64ToBlob(base64, 'video/mp4');
      filesForZip.push({ name: `take${s.idx}.mp4`, data: blob });
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

  const successCount = state.filter((s) => s.status === 'ready').length;
  const failedCount = state.filter((s) => s.status === 'failed').length;

  if (filesForZip.length === 0) {
    return {
      ok: false,
      spaceId,
      spaceUrl,
      takes: [...state],
      successCount,
      failedCount,
    };
  }

  emit('Empacotando ZIP...');
  const manifestBlob = new Blob(
    [JSON.stringify({ spaceName, spaceId, spaceUrl, imageModel, videoModel, manifest }, null, 2)],
    { type: 'application/json' },
  );
  filesForZip.push({ name: 'manifest.json', data: manifestBlob });

  const zipBlob = await buildZip(filesForZip);
  const safeName = spaceName.replace(/[^a-z0-9._-]+/gi, '_');
  const zipName = `${safeName}_brolls.zip`;

  emit('Pipeline finalizada.');
  return {
    ok: true,
    spaceId,
    spaceUrl,
    takes: [...state],
    zipBlob,
    zipName,
    successCount,
    failedCount,
  };
}

/**
 * Parser pra blocos de prompts colados pelo user (texto bruto saido do Claude).
 *
 * Aceita 3 formatos:
 *   A) JSON array crue: [{ "imagePrompt": "...", "videoPrompt": "..." }, ...]
 *   B) JSON com chaves: { "prompts": [...] } / { "takes": [...] }
 *   C) Texto livre numerado: "1. PROMPT_IMG ... MOTION: ..." (1 prompt por bloco)
 *      ou linhas separadas por --- ou blocos com "Prompt N:" / "Take N:"
 *
 * Em caso de duvida prefere o JSON. Sem dependencia de Claude API.
 */
export function parseMagnificPrompts(raw: string): MagnificTakeInput[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  // (A/B) Tenta JSON
  try {
    const j = JSON.parse(trimmed);
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
  } catch {
    // segue pro texto livre
  }

  // (C) Texto livre — divide em blocos
  // Heuristica: divide em blocos por linhas em branco duplas ou separadores "---"
  // e detecta "MOTION:" / "VIDEO:" dentro do bloco como prompt de video.
  const blocks = trimmed
    .split(/\n\s*(?:---+|===+|\*\*\*+)\s*\n|\n{2,}/g)
    .map((b) => b.trim())
    .filter(Boolean);

  // Se nao houve split, tenta dividir por "1. ", "2. " no inicio das linhas
  let candidate = blocks;
  if (candidate.length <= 1) {
    candidate = trimmed.split(/\n(?=\s*\d{1,3}[\.\)]\s)/g).map((b) => b.trim()).filter(Boolean);
  }
  if (candidate.length <= 1) {
    // ultima tentativa: cada linha = 1 prompt
    candidate = trimmed.split(/\n+/g).map((l) => l.trim()).filter(Boolean);
  }

  return candidate.map((block, i) => {
    // Remove numerador inicial "1." / "1)"
    let body = block.replace(/^\s*\d{1,3}[\.\)]\s*/, '').trim();
    // Captura MOTION/VIDEO se houver
    let videoPrompt = '';
    const motionMatch = body.match(/(?:MOTION|VIDEO|KLING|ANIMATION)\s*[:\-]\s*([\s\S]+)$/i);
    if (motionMatch) {
      videoPrompt = motionMatch[1].trim();
      body = body.slice(0, motionMatch.index).trim();
    }
    // Remove rotulo "IMG:" / "IMAGE:" / "PROMPT:"
    body = body.replace(/^(?:IMG|IMAGE|PROMPT|NANO BANANA)\s*[:\-]\s*/i, '').trim();
    return { idx: i + 1, imagePrompt: body, videoPrompt };
  }).filter((t) => t.imagePrompt.length > 0);
}
