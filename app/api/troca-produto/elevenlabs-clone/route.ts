import { NextResponse } from 'next/server';
import { getUserKey } from '@/lib/user-keys';
import { requireTier } from '@/lib/require-tier';

/**
 * POST /api/troca-produto/elevenlabs-clone
 *
 * Recebe o arquivo de audio original e cria uma voz clonada
 * Instant Voice Clone no ElevenLabs. Retorna o voice_id que o front
 * vai usar pra gerar o TTS de substituicao.
 *
 * IMPORTANTE: Vercel limita o body multipart a ~4.5MB no plano padrao.
 * Toda falha aqui retorna JSON estruturado (nunca texto puro).
 */

export const runtime = 'nodejs';
export const maxDuration = 120;

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

    let incoming: FormData;
    try {
      incoming = await req.formData();
    } catch (e) {
      return jsonError(
        'Falha ao ler upload. O arquivo pode ser maior que o limite (4.5MB no Vercel).',
        413,
        e instanceof Error ? e.message : String(e),
      );
    }

    const file = incoming.get('audio');
    const name = String(incoming.get('name') ?? 'darko-clone');
    if (!(file instanceof File)) {
      return jsonError('Envie o arquivo de audio no campo "audio".', 400);
    }

    const fd = new FormData();
    fd.append('name', name);
    fd.append(
      'description',
      'DARKO LAB - voice clone gerada para substituicao de produto em VSL.',
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
      const t = await res.text().catch(() => '');
      return jsonError('Falha ao clonar voz no ElevenLabs.', 502, t);
    }

    const json = (await res.json().catch(() => null)) as
      | { voice_id: string }
      | null;
    if (!json?.voice_id) {
      return jsonError('ElevenLabs nao retornou voice_id.', 502);
    }
    return NextResponse.json({ voiceId: json.voice_id });
  } catch (e) {
    console.error('[elevenlabs-clone route]', e);
    return jsonError(
      'Erro inesperado no servidor.',
      500,
      e instanceof Error ? e.message : String(e),
    );
  }
}
