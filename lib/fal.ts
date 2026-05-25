/**
 * lib/fal.ts — Cliente Fal.ai (LipSync via LatentSync).
 *
 * O client default eh configurado pra usar o proxy interno
 * em /api/fal/proxy. Isso garante que a FAL_KEY NUNCA aparece
 * no browser — ela so existe server-side. O upload via
 * `fal.storage.upload(file)` no client tambem passa pelo proxy.
 *
 * Uso server-side (em route handlers) — importe direto do pacote
 * e configure com credentials, sem proxy:
 *
 *   import { fal } from '@fal-ai/client';
 *   fal.config({ credentials: process.env.FAL_KEY });
 */

import { fal } from '@fal-ai/client';

fal.config({
  proxyUrl: '/api/fal/proxy',
});

export { fal };

export interface LatentSyncInput {
  video_url: string;
  audio_url: string;
  guidance_scale?: number;
  num_inference_steps?: number;
  seed?: number;
}

export interface LatentSyncOutput {
  video: {
    url: string;
    content_type: string;
    file_name: string;
    file_size: number;
  };
}
