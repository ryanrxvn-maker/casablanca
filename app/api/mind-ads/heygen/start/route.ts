import { NextResponse } from 'next/server';
import { getUserKey } from '@/lib/user-keys';

/**
 * POST /api/mind-ads/heygen/start
 *
 * Inicia uma geracao de video no HeyGen com o avatar do usuario falando
 * a copy completa. Retorna video_id pra o front polar via /status.
 *
 * Body: {
 *   avatarId: string;       // extraido do link HeyGen
 *   copy: string;           // texto que o avatar vai falar
 *   voiceId?: string;       // opcional — se vazio usa a voz default do avatar
 *   avatarType?: 'III' | 'IV' | 'V';  // tier do avatar (afeta avatar_style)
 * }
 *
 * Sem timeout no servidor — o cliente decide quando desistir.
 */

export const runtime = 'nodejs';
export const maxDuration = 60;

type Body = {
  avatarId?: string;
  copy?: string;
  voiceId?: string;
  avatarType?: 'III' | 'IV' | 'V';
};

function jsonError(message: string, status = 500, detail?: string) {
  return NextResponse.json(
    detail ? { error: message, detail: detail.slice(0, 500) } : { error: message },
    { status },
  );
}

/**
 * Extrai avatar_id de uma URL HeyGen ou retorna o input se ja for um id puro.
 * URLs aceitas:
 *   https://app.heygen.com/avatars/<id>
 *   https://app.heygen.com/avatars/<id>?something
 *   <id>  (assume ja e o id)
 */
function parseAvatarId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const urlMatch = trimmed.match(/avatars\/([a-zA-Z0-9_-]+)/);
  if (urlMatch) return urlMatch[1];
  // Sem barra, se parecer com id, devolve direto
  if (/^[a-zA-Z0-9_-]{10,}$/.test(trimmed)) return trimmed;
  return null;
}

export async function POST(req: Request) {
  try {
    const keyResult = await getUserKey('heygen');
    if ('response' in keyResult) return keyResult.response;
    const apiKey = keyResult.key;

    let body: Body;
    try {
      body = (await req.json()) as Body;
    } catch (e) {
      return jsonError(
        'Body JSON invalido.',
        400,
        e instanceof Error ? e.message : String(e),
      );
    }

    const avatarRaw = String(body.avatarId ?? '').trim();
    const copy = String(body.copy ?? '').trim();
    const voiceId = String(body.voiceId ?? '').trim();
    const avatarType = (body.avatarType ?? 'IV') as 'III' | 'IV' | 'V';

    if (!avatarRaw) return jsonError('avatarId obrigatorio.', 400);
    if (!copy) return jsonError('copy obrigatoria.', 400);
    if (copy.length > 5000) {
      return jsonError('Copy muito longa (max 5000 chars).', 400);
    }

    const avatarId = parseAvatarId(avatarRaw);
    if (!avatarId) {
      return jsonError(
        'Link/ID HeyGen invalido. Use o link da pagina do avatar.',
        400,
      );
    }

    // Avatar style: avatares III/IV usam 'normal', V usa 'circle' por padrao
    // (esses sao os labels do produto Mind Ads — nao confundir com tiers HeyGen)
    const avatarStyle = avatarType === 'V' ? 'closeUp' : 'normal';

    // Voice fallback: se nao informou voice id, usa default ElevenLabs neutro
    // mas o ideal e o usuario informar. Se vazio, manda o campo voice_id vazio
    // pra o HeyGen tentar a voz vinculada ao avatar.
    const voiceBlock: Record<string, unknown> = voiceId
      ? { type: 'text', input_text: copy, voice_id: voiceId }
      : { type: 'text', input_text: copy };

    const payload = {
      video_inputs: [
        {
          character: {
            type: 'avatar',
            avatar_id: avatarId,
            avatar_style: avatarStyle,
          },
          voice: voiceBlock,
          background: { type: 'color', value: '#0a0a0a' },
        },
      ],
      dimension: { width: 1080, height: 1920 }, // 9:16 vertical pra ads
    };

    const res = await fetch('https://api.heygen.com/v2/video/generate', {
      method: 'POST',
      headers: {
        'X-Api-Key': apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return jsonError('Falha na HeyGen API ao iniciar video.', 502, t);
    }

    const json = (await res.json().catch(() => null)) as {
      data?: { video_id?: string };
      error?: { message?: string } | string;
    } | null;

    const videoId = json?.data?.video_id;
    if (!videoId) {
      return jsonError(
        'HeyGen nao retornou video_id.',
        502,
        JSON.stringify(json).slice(0, 300),
      );
    }

    return NextResponse.json({ videoId, avatarId });
  } catch (e) {
    console.error('[mind-ads heygen start]', e);
    return jsonError(
      'Erro inesperado.',
      500,
      e instanceof Error ? e.message : String(e),
    );
  }
}
