import { NextResponse } from 'next/server';
import { getUserKey } from '@/lib/user-keys';
import { requireTier } from '@/lib/require-tier';
import { explicarFalhaTranscricao } from '@/lib/key-errors';

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

/** Motivo em português pra falha da AssemblyAI (chave, saldo, limite, sem fala). */
function falhaAai(cru: string): string {
  return explicarFalhaTranscricao(
    [`assemblyai: ${cru}`],
    ['assemblyai'],
    'Não consegui transcrever o áudio agora. Tente de novo em instantes.',
  );
}

function jsonError(message: string, status = 500, detail?: string) {
  return NextResponse.json(
    detail ? { error: message, detail: detail.slice(0, 500) } : { error: message },
    { status },
  );
}

export async function POST(req: Request) {
  try {
    const gate = await requireTier('basic');
    if (!gate.ok) return gate.response;
    const keyResult = await getUserKey('assemblyai');
    if ('response' in keyResult) return keyResult.response;
    const apiKey = keyResult.key;

    let form: FormData;
    try {
      form = await req.formData();
    } catch (e) {
      return jsonError(
        'O áudio passou do limite de envio (4,5 MB). Use um trecho mais curto e tente de novo.',
        413,
        e instanceof Error ? e.message : String(e),
      );
    }

    const file = form.get('audio');
    const languageCode = String(form.get('languageCode') ?? 'pt');
    if (!(file instanceof File)) {
      return jsonError('Não recebi o áudio. Gere a camuflagem de novo e tente outra vez.', 400);
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
      return jsonError(falhaAai(`${uploadRes.status} ${t}`), 502, t);
    }
    const uploadJson = (await uploadRes.json().catch(() => null)) as
      | { upload_url: string }
      | null;
    if (!uploadJson?.upload_url) {
      return jsonError('Não consegui enviar o áudio pra transcrição agora. Tente de novo em instantes.', 502);
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
      return jsonError(falhaAai(`${trRes.status} ${t}`), 502, t);
    }
    const created = (await trRes.json().catch(() => null)) as
      | { id: string }
      | null;
    if (!created?.id) {
      return jsonError('Não consegui iniciar a transcrição agora. Tente de novo em instantes.', 502);
    }

    const deadline = Date.now() + 4 * 60 * 1000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2500));
      const poll = await fetch(`${AAI_BASE}/transcript/${created.id}`, {
        headers: { authorization: apiKey },
      }).catch(() => null);
      if (!poll || !poll.ok) continue; // blip transitório → tenta de novo até o deadline
      const body = (await poll.json().catch(() => null)) as TranscriptPoll | null;
      if (!body) continue; // resposta não-JSON (502 HTML) → NÃO aborta mais, tenta de novo
      if (body.status === 'completed') {
        return NextResponse.json({ text: (body.text ?? '').trim() });
      }
      if (body.status === 'error') {
        return jsonError(falhaAai(body.error ?? ''), 502, body.error ?? undefined);
      }
    }

    return jsonError(
      'A transcrição passou de 4 minutos sem terminar e foi interrompida. Tente de novo; se repetir, use um trecho mais curto.',
      504,
    );
  } catch (e) {
    console.error('[camuflagem transcribe route]', e);
    return jsonError(
      'Não consegui transcrever o áudio agora. Tente de novo em instantes.',
      500,
      e instanceof Error ? e.message : String(e),
    );
  }
}
