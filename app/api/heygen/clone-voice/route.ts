import { NextResponse } from 'next/server';
import { getUserKey } from '@/lib/user-keys';

/**
 * POST /api/heygen/clone-voice
 *
 * Recebe (multipart):
 *   - audio: arquivo de audio com a voz a clonar (5-30s ideal)
 *   - name: nome opcional pra a voz clonada
 *
 * Cria uma instant voice clone no HeyGen e retorna o voice_id pronto pra
 * usar em geracoes de avatar.
 *
 * Nota: voice cloning USA a API HeyGen (consome credito), mas e setup
 * one-shot — depois que voce tem o voice_id, todas as geracoes futuras
 * com aquela voz rodam via extensao sem API.
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
    const keyResult = await getUserKey('heygen');
    if ('response' in keyResult) return keyResult.response;
    const apiKey = keyResult.key;

    let form: FormData;
    try {
      form = await req.formData();
    } catch (e) {
      return jsonError(
        'Falha ao ler upload (limite ~4MB).',
        413,
        e instanceof Error ? e.message : String(e),
      );
    }

    const audio = form.get('audio');
    const name = String(form.get('name') ?? '').trim() || 'DARKO Voice';

    if (!(audio instanceof File)) {
      return jsonError('Audio ausente.', 400);
    }

    // 1) Upload do audio pro HeyGen (asset upload)
    const audioBytes = new Uint8Array(await audio.arrayBuffer());
    const ext = (audio.name.match(/\.([a-z0-9]+)$/i)?.[1] ?? 'mp3').toLowerCase();
    const mime =
      ext === 'wav'
        ? 'audio/wav'
        : ext === 'm4a'
          ? 'audio/mp4'
          : ext === 'ogg' || ext === 'opus'
            ? 'audio/ogg'
            : 'audio/mpeg';

    const uploadRes = await fetch('https://upload.heygen.com/v1/asset', {
      method: 'POST',
      headers: {
        'X-Api-Key': apiKey,
        'Content-Type': mime,
      },
      body: audioBytes,
    });

    if (!uploadRes.ok) {
      const t = await uploadRes.text().catch(() => '');
      return jsonError(
        'Falha no upload de audio pro HeyGen.',
        502,
        t,
      );
    }

    const uploadJson = (await uploadRes.json().catch(() => null)) as {
      data?: { url?: string; file_url?: string };
    } | null;

    const audioUrl =
      uploadJson?.data?.url ?? uploadJson?.data?.file_url ?? '';
    if (!audioUrl) {
      return jsonError('Upload nao retornou URL.', 502);
    }

    // 2) Cria a clone
    const cloneRes = await fetch(
      'https://api.heygen.com/v2/voice/clone',
      {
        method: 'POST',
        headers: {
          'X-Api-Key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          audio_url: audioUrl,
          name,
        }),
      },
    );

    if (!cloneRes.ok) {
      const t = await cloneRes.text().catch(() => '');
      // Fallback v1
      const cloneRes2 = await fetch(
        'https://api.heygen.com/v1/voice/clone',
        {
          method: 'POST',
          headers: {
            'X-Api-Key': apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ audio_url: audioUrl, name }),
        },
      );
      if (!cloneRes2.ok) {
        const t2 = await cloneRes2.text().catch(() => '');
        return jsonError(
          'Falha ao clonar voz no HeyGen (ambos endpoints).',
          502,
          `v2: ${t.slice(0, 200)} | v1: ${t2.slice(0, 200)}`,
        );
      }
      const j2 = (await cloneRes2.json().catch(() => null)) as {
        data?: { voice_id?: string };
      } | null;
      const voiceId = j2?.data?.voice_id;
      if (!voiceId) return jsonError('Clone v1 sem voice_id.', 502);
      return NextResponse.json({ voiceId, name });
    }

    const cloneJson = (await cloneRes.json().catch(() => null)) as {
      data?: { voice_id?: string };
    } | null;
    const voiceId = cloneJson?.data?.voice_id;
    if (!voiceId) {
      return jsonError(
        'Clone retornou sem voice_id.',
        502,
        JSON.stringify(cloneJson).slice(0, 300),
      );
    }

    return NextResponse.json({ voiceId, name });
  } catch (e) {
    console.error('[heygen clone-voice]', e);
    return jsonError(
      'Erro inesperado.',
      500,
      e instanceof Error ? e.message : String(e),
    );
  }
}
