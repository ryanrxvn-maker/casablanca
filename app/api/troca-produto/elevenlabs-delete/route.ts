import { NextResponse } from 'next/server';
import { getUserKey } from '@/lib/user-keys';
import { requireTier } from '@/lib/require-tier';

/**
 * POST /api/troca-produto/elevenlabs-delete
 *
 * Remove a voz clonada da biblioteca do ElevenLabs.
 */

export const runtime = 'nodejs';
export const maxDuration = 30;

type Body = { voiceId: string };

function jsonError(message: string, status = 500, detail?: string) {
  return NextResponse.json(
    detail ? { error: message, detail: detail.slice(0, 500) } : { error: message },
    { status },
  );
}

export async function POST(req: Request) {
  try {
    const gate = await requireTier('pro');
    if (!gate.ok) return gate.response;
    const keyResult = await getUserKey('elevenlabs');
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
    if (!body.voiceId) {
      return jsonError('voiceId ausente.', 400);
    }

    const res = await fetch(
      `https://api.elevenlabs.io/v1/voices/${encodeURIComponent(body.voiceId)}`,
      {
        method: 'DELETE',
        headers: { 'xi-api-key': apiKey },
      },
    );

    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return jsonError('Falha ao deletar voz no ElevenLabs.', 502, t);
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[elevenlabs-delete route]', e);
    return jsonError(
      'Erro inesperado no servidor.',
      500,
      e instanceof Error ? e.message : String(e),
    );
  }
}
