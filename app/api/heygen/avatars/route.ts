import { NextResponse } from 'next/server';
import { getUserKey } from '@/lib/user-keys';

/**
 * GET /api/heygen/avatars?q=name
 *
 * Lista avatares do user no HeyGen via API. Usado pra preview na ferramenta
 * HeyGen Auto Avatar — usuario digita nome, retornamos lista com thumbnails
 * pra ele escolher visualmente.
 *
 * A API e usada SO PRA PREVIEW. A geracao real do video e feita via
 * automacao de browser (extensao Chrome) usando a sessao logada do usuario,
 * sem consumir a API HeyGen.
 *
 * Retorna: {
 *   avatars: Array<{
 *     avatar_id: string;
 *     avatar_name: string;
 *     preview_image_url: string;
 *     preview_video_url?: string;
 *     gender?: string;
 *     premium?: boolean;
 *   }>
 * }
 */

export const runtime = 'nodejs';
export const maxDuration = 30;

function jsonError(message: string, status = 500, detail?: string) {
  return NextResponse.json(
    detail ? { error: message, detail: detail.slice(0, 500) } : { error: message },
    { status },
  );
}

export async function GET(req: Request) {
  try {
    const keyResult = await getUserKey('heygen');
    if ('response' in keyResult) return keyResult.response;
    const apiKey = keyResult.key;

    const { searchParams } = new URL(req.url);
    const q = (searchParams.get('q') ?? '').trim().toLowerCase();

    // Tenta endpoint v2/avatars (avatares custom + standard do user)
    const res = await fetch('https://api.heygen.com/v2/avatars', {
      method: 'GET',
      headers: { 'X-Api-Key': apiKey },
    });

    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return jsonError('Falha na HeyGen API ao listar avatares.', 502, t);
    }

    const json = (await res.json().catch(() => null)) as {
      data?: {
        avatars?: Array<{
          avatar_id: string;
          avatar_name: string;
          preview_image_url?: string;
          preview_video_url?: string;
          gender?: string;
          premium?: boolean;
        }>;
        talking_photos?: Array<{
          talking_photo_id: string;
          talking_photo_name: string;
          preview_image_url?: string;
        }>;
      };
    } | null;

    const avatars = json?.data?.avatars ?? [];
    const talkingPhotos = json?.data?.talking_photos ?? [];

    // Junta tudo num formato unificado
    const all = [
      ...avatars.map((a) => ({
        id: a.avatar_id,
        name: a.avatar_name,
        thumb: a.preview_image_url ?? null,
        videoPreview: a.preview_video_url ?? null,
        gender: a.gender ?? null,
        premium: a.premium ?? false,
        type: 'avatar' as const,
      })),
      ...talkingPhotos.map((p) => ({
        id: p.talking_photo_id,
        name: p.talking_photo_name,
        thumb: p.preview_image_url ?? null,
        videoPreview: null,
        gender: null,
        premium: false,
        type: 'photo' as const,
      })),
    ];

    // Filtra por query se fornecida
    const filtered = q
      ? all.filter((a) => a.name.toLowerCase().includes(q))
      : all;

    return NextResponse.json({
      avatars: filtered.slice(0, 50),
      total: all.length,
    });
  } catch (e) {
    console.error('[heygen avatars]', e);
    return jsonError(
      'Erro inesperado.',
      500,
      e instanceof Error ? e.message : String(e),
    );
  }
}
