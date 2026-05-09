/**
 * Mind Ads Suite — configuracao de tiers (econ/padrao/premium).
 *
 * Cada tier mapeia pra um conjunto de modelos especificos no Replicate +
 * provider de transcricao. UI manda o tier, route resolve o modelo.
 *
 * Custo estimado pra ad de 60s com 8 brolls (atualizar quando providers
 * mudarem precos):
 *   eco:     ~$0.90  (Flux schnell + Kling standard + Groq Whisper)
 *   padrao:  ~$1.50  (Flux dev + Luma Ray 2 Flash + Groq Whisper)
 *   premium: ~$3.90  (Nano Banana Pro + Wan 2.1 + AssemblyAI)
 */

export type MindAdsTier = 'eco' | 'padrao' | 'premium';
export type TranscriptionProvider = 'groq' | 'assemblyai';

export type MindAdsTierConfig = {
  label: string;
  shortDesc: string;
  costEstimate: string;
  imageModel: string;
  videoModel: string;
  transcription: TranscriptionProvider;
};

export const MIND_ADS_TIERS: Record<MindAdsTier, MindAdsTierConfig> = {
  eco: {
    label: 'Economico',
    shortDesc: 'Flux schnell + Kling standard',
    costEstimate: '~$0.90',
    imageModel: 'black-forest-labs/flux-schnell',
    videoModel: 'kwaivgi/kling-v1.6-standard',
    transcription: 'groq',
  },
  padrao: {
    label: 'Padrao',
    shortDesc: 'Flux dev + Luma Ray 2 Flash',
    costEstimate: '~$1.50',
    imageModel: 'black-forest-labs/flux-dev',
    videoModel: 'luma/ray-flash-2-540p',
    transcription: 'groq',
  },
  premium: {
    label: 'Premium',
    shortDesc: 'Nano Banana Pro + Wan 2.1',
    costEstimate: '~$3.90',
    imageModel: 'google/nano-banana',
    videoModel: 'wavespeedai/wan-2.1-i2v-720p',
    transcription: 'assemblyai',
  },
};

/**
 * Resolve um tier a partir do body da request, com fallback eco.
 */
export function resolveTier(input: unknown): MindAdsTierConfig {
  const t = String(input ?? 'eco') as MindAdsTier;
  return MIND_ADS_TIERS[t] ?? MIND_ADS_TIERS.eco;
}

/**
 * Estima o custo de um anuncio baseado no tier + numero de takes broll.
 * Calculado em USD. Premissas:
 *   - 1 imagem + 1 video por take broll
 *   - 1 chamada Claude pra prompts (independe do tier)
 *   - HeyGen via extensao = $0 (mensalidade)
 *   - Transcricao: ~5min de avatar fala
 */
export function estimateAdCost(
  tier: MindAdsTier,
  numBrolls: number,
  durationMin = 1,
): { total: number; breakdown: Record<string, number> } {
  const cfg = MIND_ADS_TIERS[tier];

  // Custos por unidade (em USD)
  const IMAGE_PRICES: Record<string, number> = {
    'flux-schnell': 0.003,
    'flux-dev': 0.025,
    'nano-banana': 0.039,
  };
  const VIDEO_PRICES: Record<string, number> = {
    'kling-v1.6-standard': 0.10,
    'ray-flash-2-540p': 0.18,
    'wan-2.1-i2v-720p': 0.40,
  };

  const imageKey = Object.keys(IMAGE_PRICES).find((k) =>
    cfg.imageModel.includes(k),
  );
  const videoKey = Object.keys(VIDEO_PRICES).find((k) =>
    cfg.videoModel.includes(k),
  );

  const imageCost = (IMAGE_PRICES[imageKey ?? ''] ?? 0.04) * numBrolls;
  const videoCost = (VIDEO_PRICES[videoKey ?? ''] ?? 0.4) * numBrolls;

  const transcriptionCostPerHour =
    cfg.transcription === 'groq' ? 0.04 : 0.45;
  const transcriptionCost = (transcriptionCostPerHour * durationMin) / 60;

  const claudePromptsCost = 0.05; // sonnet sempre

  const total =
    imageCost + videoCost + transcriptionCost + claudePromptsCost;

  return {
    total,
    breakdown: {
      claude_prompts: claudePromptsCost,
      images: imageCost,
      videos: videoCost,
      transcription: transcriptionCost,
      heygen: 0,
    },
  };
}

/**
 * Constroi o input shape correto pra cada modelo de imagem no Replicate.
 * Diferentes modelos tem diferentes chaves esperadas.
 */
export function buildImageInput(
  model: string,
  prompt: string,
  aspectRatio: '9:16' | '1:1' | '16:9',
): Record<string, unknown> {
  if (model.includes('flux-schnell')) {
    return {
      prompt,
      aspect_ratio: aspectRatio,
      num_outputs: 1,
      output_format: 'jpg',
      output_quality: 90,
      go_fast: true,
    };
  }
  if (model.includes('flux-dev')) {
    return {
      prompt,
      aspect_ratio: aspectRatio,
      num_outputs: 1,
      output_format: 'jpg',
      output_quality: 90,
      go_fast: true,
      guidance: 3.5,
      num_inference_steps: 28,
    };
  }
  if (model.includes('nano-banana')) {
    return {
      prompt,
      aspect_ratio: aspectRatio,
      output_format: 'jpg',
    };
  }
  // fallback generico
  return { prompt, aspect_ratio: aspectRatio };
}

/**
 * Constroi input pra modelo de video. Diferentes shapes pra Kling, Luma, Wan.
 */
export function buildVideoInput(
  model: string,
  imageUrl: string,
  prompt: string,
  durationSec: number,
): Record<string, unknown> {
  if (model.includes('kling')) {
    // kwaivgi/kling-v1.6-standard
    return {
      prompt,
      start_image: imageUrl,
      duration: durationSec === 10 ? 10 : 5,
      aspect_ratio: '9:16',
      negative_prompt: '',
    };
  }
  if (model.includes('luma') || model.includes('ray')) {
    // luma/ray-flash-2-540p
    return {
      prompt,
      start_image_url: imageUrl,
      aspect_ratio: '9:16',
      duration: 5,
      loop: false,
    };
  }
  if (model.includes('wan')) {
    // wavespeedai/wan-2.1-i2v-720p
    const numFrames = durationSec === 3 ? 49 : durationSec === 7 ? 113 : 81;
    return {
      image: imageUrl,
      prompt,
      num_frames: numFrames,
    };
  }
  // fallback
  return { image: imageUrl, prompt };
}

/**
 * Extrai o URL de saida do output do Replicate (que varia por modelo).
 */
export function extractOutputUrl(output: unknown): string | null {
  if (!output) return null;
  if (typeof output === 'string') return output;
  if (Array.isArray(output) && output.length > 0) {
    const first = output[0];
    if (typeof first === 'string') return first;
  }
  // alguns modelos retornam { url } ou { video }
  if (typeof output === 'object' && output !== null) {
    const obj = output as Record<string, unknown>;
    for (const key of ['url', 'video', 'image', 'output']) {
      if (typeof obj[key] === 'string') return obj[key] as string;
    }
  }
  return null;
}
