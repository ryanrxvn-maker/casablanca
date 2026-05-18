import { NextResponse } from 'next/server';
import { getUserKey } from '@/lib/user-keys';

/**
 * POST /api/camuflagem/transcribe
 *
 * Recebe um WAV MONO já com a soma L+R (exatamente o que uma plataforma/IA
 * processaria) e devolve a transcrição completa via AssemblyAI. Serve de
 * PROVA: se o texto for o roteiro do WHITE, a camuflagem segurou; se vier o
 * roteiro do BLACK, ela falhou e o usuário vê na hora.
 *
 * Sem word_boost / sem produto — é transcrição crua, igual a IA "ouviria".
 *
 * IMPORTANTE: Vercel limita o body multipart a ~4.5MB no plano padrao.
 */

export const runtime = 'nodejs';
export const maxDuration = 300;

const AAI_BASE = 'https://api.assemblyai.com/v2';

type TranscriptPoll = {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'error';
  text?: string;
  error?: string;
};

function jsonError(message: string, status = 500, detail?: string) {
  return NextResponse.json(
    detail ? { error: message, detail: detail.slice(0, 500) } : { error: message },
    { status },
  );
}

export async function POST(req: Request) {
  try {
    const keyResult = await getUserKey('assemblyai');
    if ('response' in keyResult) return keyResult.response;
    const apiKey = keyResult.key;

    let form: FormData;
    try {
      form = await req.formData();
    } catch (e) {
      return jsonError(
        'Falha ao ler upload. O arquivo pode ser maior que o limite (4.5MB no Vercel).',
        413,
        e instanceof Error ? e.message : String(e),
      );
    }

    const file = form.get('audio');
    const languageCode = String(form.get('languageCode') ?? 'pt');
    if (!(file instanceof File)) {
      return jsonError('Envie o arquivo de audio no campo "audio".', 400);
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const uploadRes = await fetch(`${AAI_BASE}/upload`, {
      method: 'POST',
      headers: {
        authorization: apiKey,
        'content-type': 'application/octet-stream',
      },
      body: bytes,
    });
    if (!uploadRes.ok) {
      const t = await uploadRes.text().catch(() => '');
      return jsonError('Falha no upload AssemblyAI.', 502, t);
    }
    const uploadJson = (await uploadRes.json().catch(() => null)) as
      | { upload_url: string }
      | null;
    if (!uploadJson?.upload_url) {
      return jsonError('AssemblyAI retornou upload sem URL.', 502);
    }

    const trRes = await fetch(`${AAI_BASE}/transcript`, {
      method: 'POST',
      headers: {
        authorization: apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        audio_url: uploadJson.upload_url,
        language_code: languageCode,
        punctuate: true,
        format_text: true,
      }),
    });
    if (!trRes.ok) {
      const t = await trRes.text().catch(() => '');
      return jsonError('Falha ao criar transcricao.', 502, t);
    }
    const created = (await trRes.json().catch(() => null)) as
      | { id: string }
      | null;
    if (!created?.id) {
      return jsonError('AssemblyAI nao retornou transcript id.', 502);
    }

    const deadline = Date.now() + 4 * 60 * 1000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2500));
      const poll = await fetch(`${AAI_BASE}/transcript/${created.id}`, {
        headers: { authorization: apiKey },
      });
      const body = (await poll.json().catch(() => null)) as TranscriptPoll | null;
      if (!body) {
        return jsonError('Resposta invalida do AssemblyAI no polling.', 502);
      }
      if (body.status === 'completed') {
        return NextResponse.json({ text: (body.text ?? '').trim() });
      }
      if (body.status === 'error') {
        return jsonError(body.error ?? 'Erro desconhecido na transcricao.', 502);
      }
    }

    return jsonError('Timeout aguardando transcricao (4 min).', 504);
  } catch (e) {
    console.error('[camuflagem transcribe route]', e);
    return jsonError(
      'Erro inesperado no servidor.',
      500,
      e instanceof Error ? e.message : String(e),
    );
  }
}
