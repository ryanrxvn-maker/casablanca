import { NextResponse } from 'next/server';

/**
 * POST /api/troca-produto/elevenlabs-tts
 *
 * Dado um voice_id (clonado previamente) e o nome do produto novo,
 * gera um audio MP3 da palavra/expressao falada pela voz clonada.
 *
 * A duracao exata varia — o front cuida do time-stretch no FFmpeg WASM
 * pra caber no slot original da palavra antiga.
 *
 * JSON body:
 *  - voiceId: string
 *  - text: string (texto a ser falado — normalmente o nome do produto novo,
 *                  mas pode ser uma frase curta pra contextualizar a entonacao)
 *  - previousText?: string (palavras anteriores, ajudam na entonacao)
 *  - nextText?: string (palavras seguintes, idem)
 */

export const runtime = 'nodejs';
export const maxDuration = 60;

type Body = {
  voiceId: string;
  text: string;
  previousText?: string;
  nextText?: string;
};

export async function POST(req: Request) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'ELEVENLABS_API_KEY não configurada.' },
      { status: 500 },
    );
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'Body JSON inválido.' }, { status: 400 });
  }

  if (!body.voiceId || !body.text) {
    return NextResponse.json(
      { error: 'voiceId e text são obrigatórios.' },
      { status: 400 },
    );
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
    const t = await res.text();
    return NextResponse.json(
      { error: 'Falha no TTS ElevenLabs.', detail: t.slice(0, 500) },
      { status: 502 },
    );
  }

  const buf = await res.arrayBuffer();
  return new Response(buf, {
    status: 200,
    headers: {
      'content-type': 'audio/mpeg',
      'cache-control': 'no-store',
    },
  });
}
