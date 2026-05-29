import { NextResponse } from 'next/server';
import { getUserKey } from '@/lib/user-keys';
import { requireTier } from '@/lib/require-tier';

/**
 * GET /api/heygen/avatars?q=name&motor=III|IV|V
 *
 * Lista avatares do user no HeyGen via API.
 *
 * Filtros:
 *  - q: substring no nome (case-insensitive)
 *  - motor: filtra por versao de avatar
 *      III = Photo Avatars (gratuitos no plano)
 *      IV  = Studio Avatars normais
 *      V   = Studio Plus (premium)
 *
 * Cache: server cachea a lista bruta por 5 minutos POR USER (key=apiKey).
 * Reduz drasticamente latencia em buscas sucessivas (300ms → ~5ms).
 */

export const runtime = 'nodejs';
export const maxDuration = 30;

type RawAvatar = {
  avatar_id: string;
  avatar_name: string;
  preview_image_url?: string;
  preview_video_url?: string;
  gender?: string;
  premium?: boolean;
};

type RawTalkingPhoto = {
  talking_photo_id: string;
  talking_photo_name: string;
  preview_image_url?: string;
};

type AvatarItem = {
  id: string;
  name: string;
  thumb: string | null;
  videoPreview: string | null;
  gender: string | null;
  premium: boolean;
  type: 'avatar' | 'photo';
  isCustom: boolean;
};

type CacheEntry = {
  expiresAt: number;
  items: AvatarItem[];
};

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

function jsonError(message: string, status = 500, detail?: string) {
  return NextResponse.json(
    detail ? { error: message, detail: detail.slice(0, 500) } : { error: message },
    { status },
  );
}

async function fetchAvatarList(apiKey: string): Promise<AvatarItem[]> {
  const cached = cache.get(apiKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.items;
  }

  const res = await fetch('https://api.heygen.com/v2/avatars', {
    method: 'GET',
    headers: { 'X-Api-Key': apiKey },
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`HeyGen ${res.status}: ${t.slice(0, 200)}`);
  }

  const json = (await res.json().catch(() => null)) as {
    data?: {
      avatars?: RawAvatar[];
      talking_photos?: RawTalkingPhoto[];
    };
  } | null;

  const avatars = json?.data?.avatars ?? [];
  const talkingPhotos = json?.data?.talking_photos ?? [];

  // Customs sao geralmente os mais recentes do user. HeyGen nao da flag
  // explicita "is_custom", mas talking_photos custom geralmente nao tem
  // preview_video_url (so imagem).
  const items: AvatarItem[] = [
    ...avatars.map((a) => ({
      id: a.avatar_id,
      name: a.avatar_name,
      thumb: a.preview_image_url ?? null,
      videoPreview: a.preview_video_url ?? null,
      gender: a.gender ?? null,
      premium: a.premium ?? false,
      type: 'avatar' as const,
      isCustom: !a.premium,
    })),
    ...talkingPhotos.map((p) => ({
      id: p.talking_photo_id,
      name: p.talking_photo_name,
      thumb: p.preview_image_url ?? null,
      videoPreview: null,
      gender: null,
      premium: false,
      type: 'photo' as const,
      isCustom: true,
    })),
  ];

  cache.set(apiKey, {
    items,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  return items;
}

export async function GET(req: Request) {
  try {
    const gate = await requireTier('pro');
    if (!gate.ok) return gate.response;
    const keyResult = await getUserKey('heygen');
    if ('response' in keyResult) return keyResult.response;
    const apiKey = keyResult.key;

    const { searchParams } = new URL(req.url);
    const q = (searchParams.get('q') ?? '').trim().toLowerCase();
    const motor = (searchParams.get('motor') ?? '').trim().toUpperCase();

    let items: AvatarItem[];
    try {
      items = await fetchAvatarList(apiKey);
    } catch (e) {
      return jsonError(
        'Falha na HeyGen API.',
        502,
        e instanceof Error ? e.message : String(e),
      );
    }

    // Filtra por motor antes de qualquer outra coisa
    if (motor === 'III') {
      // Photo Avatars (Avatar III — ilimitado no plano)
      items = items.filter((a) => a.type === 'photo');
    } else if (motor === 'IV') {
      // Studio Avatars normais (nao premium)
      items = items.filter((a) => a.type === 'avatar' && !a.premium);
    } else if (motor === 'V') {
      // Studio Plus / premium
      items = items.filter((a) => a.type === 'avatar' && a.premium);
    }

    // Filtra por nome (substring case-insensitive)
    if (q) {
      items = items.filter((a) => a.name.toLowerCase().includes(q));
    }

    // Ordena: custom primeiro, depois por nome
    items.sort((a, b) => {
      if (a.isCustom !== b.isCustom) return a.isCustom ? -1 : 1;
      return a.name.localeCompare(b.name, 'pt');
    });

    return NextResponse.json({
      avatars: items.slice(0, 50),
      total: items.length,
      cached: cache.has(apiKey),
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
