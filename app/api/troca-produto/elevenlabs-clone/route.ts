import { NextResponse } from 'next/server';

/**
 * POST /api/troca-produto/elevenlabs-clone
 *
 * Recebe o arquivo de audio original e cria uma voz clonada
 * Instant Voice Clone no ElevenLabs. Retorna o voice_id que o front
 * vai usar pra gerar o TTS de substituicao.
 *
 * Multipart fields:
 *  - audio: File (audio do narrador)
 *  - name: string (nome identificador da voice)
 */

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(req: Request) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'ELEVENLABS_API_KEY não configurada.' },
      { status: 500 },
    );
  }

  const incoming = await req.formData();
  const file = incoming.get('audio');
  const name = String(incoming.get('name') ?? 'darko-clone');
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: 'Envie o arquivo de áudio no campo "audio".' },
      { status: 400 },
    );
  }

  const fd = new FormData();
  fd.append('name', name);
  fd.append(
    'description',
    'DARKO LAB — voice clone gerada para substituição de produto em VSL.',
  );
  fd.append('files', file, file.name || 'sample.wav');
  fd.append('remove_background_noise', 'true');
  fd.append(
    'labels',
    JSON.stringify({ source: 'darko-lab', purpose: 'product-swap' }),
  );

  const res = await fetch('https://api.elevenlabs.io/v1/voices/add', {
    method: 'POST',
    headers: { 'xi-api-key': apiKey },
    body: fd,
  });

  if (!res.ok) {
    const t = await res.text();
    return NextResponse.json(
      { error: 'Falha ao clonar voz.', detail: t.slice(0, 500) },
      { status: 502 },
    );
  }

  const json = (await res.json()) as { voice_id: string };
  return NextResponse.json({ voiceId: json.voice_id });
}
