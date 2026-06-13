import { NextResponse } from 'next/server';
import { requireTier } from '@/lib/require-tier';
import { auditResult, findRepeatedSpans } from '@/lib/decupagem-matcher';
import { transcribeAudio } from '@/lib/transcribe';

/**
 * POST /api/decupagem-copy/audit
 *
 * AUDITORIA INDEPENDENTE do MP4 final (P1). Recebe o audio do RESULTADO ja
 * cortado (ANTES do silence-removal, pra os offsets baterem) + a copy.
 * Re-transcreve SEM vocab/word_boost (a verificacao nao pode herdar o vies da
 * geracao — e' assim que palavra-fantasma cai) e confere frase a frase contra
 * a copy. Devolve um laudo: cada frase ok / review / fail.
 *
 * E' a conferencia manual ("ouvi o resultado e comparei com a copy")
 * automatizada, rodando sozinha a cada job.
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
    const copyText = String(form.get('copy') ?? '').trim();

    if (!(audio instanceof File)) {
      return jsonError('Audio ausente no campo "audio".', 400);
    }
    if (!copyText) {
      return jsonError('Copy ausente no campo "copy".', 400);
    }

    // SEM vocab de proposito: a auditoria precisa ouvir o que o audio REALMENTE
    // tem, sem o word_boost que enviesou a geracao. Assim a palavra-fantasma
    // (ex: "Mounjaro" que ele nao falou) nao se repete na verificacao.
    const { words, provider, errors } = await transcribeAudio(audio, {
      provider: 'auto',
    });

    if (words.length === 0) {
      return jsonError(
        'Falha na transcricao da auditoria.',
        502,
        errors.join(' | '),
      );
    }

    const report = auditResult(copyText, words);
    // Faixas de fala REPETIDA no resultado (restart/retake vazado) a remover —
    // o que o matcher e' cego pra ver no bruto. Em ms, no tempo do RESULTADO.
    const dedupSpans = findRepeatedSpans(words);

    return NextResponse.json({
      report,
      dedupSpans,
      provider,
      transcriptPreview: words
        .map((w) => w.text)
        .join(' ')
        .slice(0, 800),
    });
  } catch (e) {
    console.error('[decupagem-copy audit]', e);
    return jsonError(
      'Erro inesperado na auditoria.',
      500,
      e instanceof Error ? e.message : String(e),
    );
  }
}
