import { NextResponse } from 'next/server';
import { getUserKey } from '@/lib/user-keys';
import { requireTier } from '@/lib/require-tier';
import {
  createImageVideo,
  getImageVideoStatus,
  type ImageInput,
} from '@/lib/heygen-image-video';

/**
 * MODO IMAGEM — dispara um take animando uma imagem, sem avatar na biblioteca.
 *
 * POST /api/heygen/image-video   → cria o vídeo, devolve { videoId }
 * GET  /api/heygen/image-video?videoId=...  → status + url quando pronto
 *
 * Por que é rota de SERVIDOR e não vai pela extensão como o resto: a variante
 * `image` só existe na API pública (`/v3/videos`), que autentica por
 * `X-Api-Key` — e a key nunca pode ir pro browser. O preço disso está no
 * cabeçalho de lib/heygen-image-video.ts: cobra do tier de API (saldo USD à
 * parte), não do plano.
 */

export const runtime = 'nodejs';
export const maxDuration = 120;

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const TIPOS_OK = new Set(['image/jpeg', 'image/png', 'image/webp']);

function jsonError(message: string, status = 500) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(req: Request) {
  try {
    const gate = await requireTier('admin', {
      unlockTools: ['/tools/heygen-auto', '/tools/clickup-pilot'],
    });
    if (!gate.ok) return gate.response;
    const keyResult = await getUserKey('heygen');
    if ('response' in keyResult) return keyResult.response;

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return jsonError('Falha ao ler o upload (limite ~4MB por request no Vercel).', 400);
    }

    const script = String(form.get('script') || '').trim();
    const voiceId = String(form.get('voiceId') || '').trim();
    const motionPrompt = String(form.get('motionPrompt') || '').trim();
    const title = String(form.get('title') || '').trim();
    const aspectRatio = String(form.get('aspectRatio') || '9:16');
    const imageUrl = String(form.get('imageUrl') || '').trim();
    const file = form.get('image');

    if (!script) return jsonError('Falta o texto da fala.', 400);
    if (!voiceId) {
      return jsonError(
        'Escolha uma voz. No modo imagem não existe avatar de onde herdar a voz padrão.',
        400,
      );
    }

    let image: ImageInput;
    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_IMAGE_BYTES) {
        return jsonError(`Imagem muito grande (${(file.size / 1e6).toFixed(1)}MB). Máximo 8MB.`, 400);
      }
      const tipo = file.type || 'image/jpeg';
      if (!TIPOS_OK.has(tipo)) {
        return jsonError(`Formato não suportado (${tipo}). Use JPEG, PNG ou WebP.`, 400);
      }
      const bytes = Buffer.from(await file.arrayBuffer());
      image = { type: 'base64', media_type: tipo, data: bytes.toString('base64') };
    } else if (imageUrl) {
      if (!/^https:\/\//i.test(imageUrl)) {
        return jsonError('A URL da imagem precisa ser HTTPS pública.', 400);
      }
      image = { type: 'url', url: imageUrl };
    } else {
      return jsonError('Suba uma imagem (ou informe uma URL HTTPS).', 400);
    }

    const { videoId } = await createImageVideo(keyResult.key, {
      image,
      voiceId,
      script,
      motionPrompt: motionPrompt || null,
      title: title || 'Video por imagem',
      aspectRatio: aspectRatio as '9:16',
    });
    return NextResponse.json({ videoId });
  } catch (e) {
    return jsonError((e as Error)?.message || 'Erro inesperado no modo imagem.');
  }
}

export async function GET(req: Request) {
  try {
    const gate = await requireTier('admin', {
      unlockTools: ['/tools/heygen-auto', '/tools/clickup-pilot'],
    });
    if (!gate.ok) return gate.response;
    const keyResult = await getUserKey('heygen');
    if ('response' in keyResult) return keyResult.response;

    const videoId = new URL(req.url).searchParams.get('videoId');
    if (!videoId) return jsonError('Falta videoId.', 400);

    const st = await getImageVideoStatus(keyResult.key, videoId);
    return NextResponse.json(st);
  } catch (e) {
    return jsonError((e as Error)?.message || 'Erro ao consultar o vídeo.');
  }
}
