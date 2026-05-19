/**
 * LTX-Video 2.3 — integração com a Space oficial do Hugging Face (ZeroGPU).
 *
 * Space: `Lightricks/LTX-2-3` ("LTX 2.3 Distilled", H200/ZeroGPU, vídeo+áudio).
 * Endpoint: `/generate_video` — 8 inputs (confirmado via view_api):
 *   0 input_image    FileData|null  (opcional; usado p/ continuação i2v)
 *   1 prompt         str
 *   2 duration       float  (1..10s, passo 0.1)
 *   3 enhance_prompt bool
 *   4 seed           float
 *   5 randomize_seed bool
 *   6 height         int
 *   7 width          int
 * Retorno: [ videoFilepath, seed ]
 *
 * "Unlimited": chamada anônima/raw-REST NÃO funciona no ZeroGPU — só via
 * @gradio/client autenticado com token HF (handshake de quota). Cada CONTA
 * HF tem quota diária própria de GPU; cada chamada reserva ~150s de H200.
 * Rotacionamos um pool de tokens (`HF_TOKENS`) — idealmente de contas
 * diferentes — e pulamos pro próximo quando um estoura a quota.
 *
 * Arquivo compartilhado client/server: só constantes/tipos puros.
 */

export const LTX_SPACE = 'Lightricks/LTX-2-3';
export const LTX_FN = '/generate_video';

export function clampStep(
  v: number,
  min: number,
  max: number,
  step: number,
): number {
  const c = Math.min(max, Math.max(min, v));
  return Math.round(c / step) * step;
}

/** Monta os 8 inputs na ordem exata do endpoint. */
export function buildLtxData(opts: {
  prompt: string;
  duration: number;
  width: number;
  height: number;
  inputImage?: unknown | null;
  enhancePrompt?: boolean;
  seed?: number;
}): unknown[] {
  const hasSeed = typeof opts.seed === 'number';
  return [
    opts.inputImage ?? null,
    opts.prompt,
    clampStep(opts.duration, 1, 10, 0.1),
    opts.enhancePrompt ?? false,
    hasSeed ? (opts.seed as number) : 10,
    !hasSeed,
    clampStep(opts.height, 256, 1536, 32),
    clampStep(opts.width, 256, 1536, 32),
  ];
}

/* ---------- Opções do painel (espelham a imagem de referência) ---------- */

export type ResolutionOption = {
  id: string;
  label: string;
  width: number;
  height: number;
};

// IMPORTANTE: a Space SÓ aceita estes presets exatos (RESOLUTIONS no
// app.py). Qualquer outro WxH faz o pipeline lançar exceção e voltar
// vídeo nulo. Pares são (width × height).
//   high: 16:9=(1536,1024) 9:16=(1024,1536) 1:1=(1024,1024)
//   low : 16:9=(768,512)   9:16=(512,768)   1:1=(768,768)
export const LTX_RESOLUTIONS: ResolutionOption[] = [
  { id: '768x512', label: '768×512 (16:9 rápido)', width: 768, height: 512 },
  { id: '1536x1024', label: '1536×1024 (16:9 HD)', width: 1536, height: 1024 },
  { id: '512x768', label: '512×768 (9:16 rápido)', width: 512, height: 768 },
  { id: '1024x1536', label: '1024×1536 (9:16 vertical HD)', width: 1024, height: 1536 },
  { id: '768x768', label: '768×768 (1:1 rápido)', width: 768, height: 768 },
  { id: '1024x1024', label: '1024×1024 (1:1 HD)', width: 1024, height: 1024 },
];

export type DurationOption = {
  id: string;
  label: string;
  /** segundos por chunk enviados pra Space (máx 10) */
  seconds: number;
  /** quantos chunks gerados+concatenados (continuação i2v) */
  chunks: number;
};

export const LTX_DURATIONS: DurationOption[] = [
  { id: '4s', label: '4s (1 chunk)', seconds: 4, chunks: 1 },
  { id: '6s', label: '6s (1 chunk)', seconds: 6, chunks: 1 },
  { id: '10s', label: '10s (1 chunk)', seconds: 10, chunks: 1 },
  { id: '12s', label: '12s (2 chunks)', seconds: 6, chunks: 2 },
];

export type StepsOption = { id: string; label: string; enhance: boolean };

// A Space 2.3 distilled não recebe "steps" cru. Mantemos o rótulo "STEPS"
// pra bater com o painel; mapeia pro enhance_prompt (melhora aderência/
// detalhe do prompt, custo de qualidade "máxima").
export const LTX_STEPS: StepsOption[] = [
  { id: '50', label: '50 (máxima)', enhance: true },
  { id: '30', label: '30 (rápida)', enhance: false },
];

export const LTX_MODES = [{ id: 'fast', label: 'Fast (HF · grátis)' }] as const;
