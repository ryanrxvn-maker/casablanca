import { NextResponse } from 'next/server';
import { getUserKey } from '@/lib/user-keys';

/**
 * GET /api/heygen/voices?q=
 *
 * Lista vozes disponiveis no HeyGen. Usado pra escolher voz override
 * quando a do avatar nao serve.
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
    const lang = (searchParams.get('lang') ?? 'pt').toLowerCase();

    const res = await fetch('https://api.heygen.com/v2/voices', {
      method: 'GET',
      headers: { 'X-Api-Key': apiKey },
    });

    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return jsonError('Falha na HeyGen API ao listar vozes.', 502, t);
    }

    const json = (await res.json().catch(() => null)) as {
      data?: {
        voices?: Array<{
          voice_id: string;
          name: string;
          language?: string;
          gender?: string;
          preview_audio?: string;
          support_pause?: boolean;
          emotion_support?: boolean;
        }>;
      };
    } | null;

    const all = json?.data?.voices ?? [];
    const filtered = all.filter((v) => {
      const matchesLang = lang === 'all' || (v.language ?? '').toLowerCase().includes(lang) || (v.language ?? '').toLowerCase().includes('portu');
      const matchesQ = !q || (v.name ?? '').toLowerCase().includes(q);
      return matchesLang && matchesQ;
    });

    return NextResponse.json({
      voices: filtered.slice(0, 100).map((v) => ({
        id: v.voice_id,
        name: v.name,
        gender: v.gender ?? null,
        language: v.language ?? null,
        previewAudio: v.preview_audio ?? null,
      })),
      total: all.length,
    });
  } catch (e) {
    console.error('[heygen voices]', e);
    return jsonError(
      'Erro inesperado.',
      500,
      e instanceof Error ? e.message : String(e),
    );
  }
}
