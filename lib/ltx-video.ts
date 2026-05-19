/**
 * LTX-Video 2.3 — integração com a Space gratuita do Hugging Face (ZeroGPU).
 *
 * "Unlimited" = nós fazemos PROXY server-side pra Space pública
 * `Lightricks/ltx-video-distilled` (Gradio 5, ZeroGPU H200). A quota do
 * ZeroGPU é por conta/IP; pra não esbarrar nela rotacionamos um pool de
 * tokens HF (env `HF_TOKENS`, separados por vírgula). Sem token, cai no
 * modo anônimo (ainda funciona, só com quota menor por IP do servidor).
 *
 * Esse arquivo é compartilhado client/server — só constantes e tipos puros,
 * sem dependência de Node nem de browser.
 */

export const LTX_SPACE_HOST = 'lightricks-ltx-video-distilled.hf.space';
export const LTX_API_PREFIX = '/gradio_api';

/** Endpoints nomeados da Space (confirmados via /gradio_api/info). */
export const LTX_FN = {
  t2v: 'text_to_video',
  i2v: 'image_to_video',
} as const;

export type LtxMode = 'text-to-video' | 'image-to-video';

/**
 * Ordem EXATA dos 13 inputs do fn `text_to_video` / `image_to_video`:
 *  0 prompt              string
 *  1 negative_prompt     string
 *  2 input_image_filepath  string | FileData | null
 *  3 input_video_filepath  string | null
 *  4 height_ui           number  (256..1280, passo 32)
 *  5 width_ui            number  (256..1280, passo 32)
 *  6 mode                string  ("text-to-video" | "image-to-video")
 *  7 duration_ui         number  (0.3..8.5, passo 0.1)  -> segundos
 *  8 ui_frames_to_use    number  (9, p/ t2v fixo)
 *  9 seed_ui             integer
 * 10 randomize_seed      boolean
 * 11 ui_guidance_scale   number
 * 12 improve_texture_flag boolean
 */
export function buildLtxData(opts: {
  prompt: string;
  negativePrompt?: string;
  imageFilepath?: unknown | null;
  width: number;
  height: number;
  mode: LtxMode;
  duration: number;
  seed?: number;
  guidanceScale?: number;
  improveTexture?: boolean;
}): unknown[] {
  return [
    opts.prompt,
    opts.negativePrompt ??
      'worst quality, inconsistent motion, blurry, jittery, distorted',
    opts.imageFilepath ?? null,
    null,
    clampStep(opts.height, 256, 1280, 32),
    clampStep(opts.width, 256, 1280, 32),
    opts.mode,
    Math.min(8.5, Math.max(0.3, Number(opts.duration.toFixed(1)))),
    9,
    typeof opts.seed === 'number' ? opts.seed : 42,
    typeof opts.seed === 'number' ? false : true,
    opts.guidanceScale ?? 1,
    opts.improveTexture ?? true,
  ];
}

function clampStep(v: number, min: number, max: number, step: number): number {
  const c = Math.min(max, Math.max(min, v));
  return Math.round(c / step) * step;
}

/* ---------- Opções do painel (espelham a imagem de referência) ---------- */

export type ResolutionOption = {
  id: string;
  label: string;
  width: number;
  height: number;
};

// Todos múltiplos de 32 (exigência do slider da Space).
export const LTX_RESOLUTIONS: ResolutionOption[] = [
  { id: '1024x576', label: '1024×576 (16:9)', width: 1024, height: 576 },
  { id: '768x448', label: '768×448 (16:9 rápido)', width: 768, height: 448 },
  { id: '576x1024', label: '576×1024 (9:16 vertical)', width: 576, height: 1024 },
  { id: '768x768', label: '768×768 (1:1)', width: 768, height: 768 },
];

export type DurationOption = {
  id: string;
  label: string;
  /** segundos por chunk enviados pra Space */
  seconds: number;
  /** quantos chunks gerados e concatenados (continuação i2v) */
  chunks: number;
};

export const LTX_DURATIONS: DurationOption[] = [
  { id: '4s', label: '4s (1 chunk)', seconds: 4, chunks: 1 },
  { id: '6s', label: '6s (1 chunk)', seconds: 6, chunks: 1 },
  { id: '8s', label: '8s (1 chunk)', seconds: 8, chunks: 1 },
  { id: '12s', label: '12s (2 chunks)', seconds: 6, chunks: 2 },
];

export type StepsOption = {
  id: string;
  label: string;
  improveTexture: boolean;
};

// A Space distilled não recebe "steps" cru — o que muda a qualidade é o
// passo de refino (improve_texture). Mantemos o rótulo "STEPS" pra bater
// com o painel de referência, mas mapeia pro que a Space realmente aceita.
export const LTX_STEPS: StepsOption[] = [
  { id: '50', label: '50 (máxima)', improveTexture: true },
  { id: '30', label: '30 (rápida)', improveTexture: false },
];

export const LTX_MODES = [{ id: 'fast', label: 'Fast (HF · grátis)' }] as const;
