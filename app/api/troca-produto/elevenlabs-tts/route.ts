import { NextResponse } from 'next/server';
import { getUserKey } from '@/lib/user-keys';
import { requireTier } from '@/lib/require-tier';

/**
 * POST /api/troca-produto/elevenlabs-tts
 *
 * Dado um voice_id (clonado previamente) e o nome do produto novo,
 * gera um audio MP3 da palavra/expressao falada pela voz clonada.
 */

export const runtime = 'nodejs';
export const maxDuration = 60;

type Body = {
  voiceId: string;
  text: string;
  previousText?: string;
  nextText?: string;
};

function jsonError(message: string, status = 500, detail?: string) {
  return NextResponse.json(
    detail ? { error: message, detail: detail.slice(0, 500) } : { error: message },
    { status },
  );
}

export async function POST(req: Request) {
  try {
    const gate = await requireTier('admin'); // admin-only duro: nem bypass de manutenção passa
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

    if (!body.voiceId || !body.text) {
      return jsonError('voiceId e text sao obrigatorios.', 400);
    }

    const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(body.voiceId)}?output_format=mp3_44100_192`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'content-type': 'application/json',
        accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text: body.text,
        model_id: 'eleven_multilingual_v2',
        previous_text: body.previousText,
        next_text: body.nextText,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.85,
          style: 0.15,
          use_speaker_boost: true,
        },
      }),
    });

    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return jsonError('Falha no TTS ElevenLabs.', 502, t);
    }

    const buf = await res.arrayBuffer();
    return new Response(buf, {
      status: 200,
      headers: {
        'content-type': 'audio/mpeg',
        'cache-control': 'no-store',
      },
    });
  } catch (e) {
    console.error('[elevenlabs-tts route]', e);
    return jsonError(
      'Erro inesperado no servidor.',
      500,
      e instanceof Error ? e.message : String(e),
    );
  }
}
