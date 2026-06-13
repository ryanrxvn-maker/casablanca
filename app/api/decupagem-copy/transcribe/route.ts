import { NextResponse } from 'next/server';
import { requireTier } from '@/lib/require-tier';
import { transcribeAudio } from '@/lib/transcribe';

/**
 * POST /api/decupagem-copy/transcribe
 *
 * Transcreve um audio (tipicamente o RESULTADO ja decupado) e devolve o TEXTO
 * COMPLETO. Sem vocab/word_boost — transcricao crua, fiel ao que o audio tem.
 * Serve pro botao "Transcrever" da UI, pra conferir o resultado sem precisar
 * subir manualmente no AssemblyAI.
 */

export const runtime = 'nodejs';
export const maxDuration = 300;

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
    if (!(audio instanceof File)) {
      return jsonError('Audio ausente no campo "audio".', 400);
    }

    const { words, provider, errors } = await transcribeAudio(audio, {
      provider: 'auto',
    });

    if (words.length === 0) {
      return jsonError('Falha na transcricao.', 502, errors.join(' | '));
    }

    return NextResponse.json({
      text: words.map((w) => w.text).join(' '),
      provider,
      wordCount: words.length,
    });
  } catch (e) {
    console.error('[decupagem-copy transcribe]', e);
    return jsonError(
      'Erro inesperado na transcricao.',
      500,
      e instanceof Error ? e.message : String(e),
    );
  }
}
