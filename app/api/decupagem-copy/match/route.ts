import { NextResponse } from 'next/server';
import { requireTier } from '@/lib/require-tier';
import {
  matchCopyWindowed,
  extractVocabHints,
} from '@/lib/decupagem-matcher';
import { transcribeAudio, type TranscribeProvider } from '@/lib/transcribe';

/**
 * POST /api/decupagem-copy/match
 *
 * Transcreve (AssemblyAI primario, fallback Groq) e alinha cada frase da
 * copy com a melhor take no video. Toda a logica de matching e' pura e
 * vive em lib/decupagem-matcher.ts (testada em
 * lib/decupagem-matcher.test.ts). A transcricao vive em lib/transcribe.ts.
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
    // 'auto' (default) = AssemblyAI se houver chave (forced-align + confidence),
    // senao Groq. Pode forcar 'groq' ou 'assemblyai'.
    const requestedProvider = String(form.get('provider') ?? 'auto');

    if (!(audio instanceof File)) {
      return jsonError('Audio ausente no campo "audio".', 400);
    }
    if (!copyText) {
      return jsonError('Copy ausente no campo "copy".', 400);
    }
    if (copyText.length > 50000) {
      return jsonError('Copy muito grande (max 50000 caracteres).', 400);
    }

    // Termos da copy (marcas/nomes/dominio) que viram dica de vocabulario pro
    // ASR — resolve mistranscricao de marca ("Manjaro" -> "Mounjaro").
    const vocab = extractVocabHints(copyText);

    const { words, provider, errors } = await transcribeAudio(audio, {
      vocab,
      provider: requestedProvider as TranscribeProvider,
    });

    if (words.length === 0) {
      return jsonError(
        'Falha na transcricao. Configure Groq ou AssemblyAI em /configuracoes/api.',
        502,
        errors.join(' | '),
      );
    }

    const cuts = matchCopyWindowed(copyText, words);
    if (cuts.length === 0) {
      return jsonError(
        'Nao consegui alinhar nenhuma frase. Confira se a copy bate com o video.',
        422,
      );
    }

    // Confianca media do ASR sobre os trechos efetivamente cortados (so quando
    // o provider entrega confidence — AssemblyAI). Serve de termometro pro user.
    const confVals = cuts
      .map((c) => c.confidence)
      .filter((v): v is number => typeof v === 'number');
    const avgConfidence =
      confVals.length > 0
        ? confVals.reduce((a, b) => a + b, 0) / confVals.length
        : null;

    // debug=1: devolve o words array COMPLETO (word-level timestamps) pra
    // replay offline de qualquer misterio — em vez do ciclo testa-adivinha.
    const debug = String(form.get('debug') ?? '') === '1';

    return NextResponse.json({
      cuts,
      provider,
      avgConfidence,
      transcriptPreview: words
        .map((w) => w.text)
        .join(' ')
        .slice(0, 500),
      ...(debug ? { words } : {}),
    });
  } catch (e) {
    console.error('[decupagem-copy match]', e);
    return jsonError(
      'Erro inesperado.',
      500,
      e instanceof Error ? e.message : String(e),
    );
  }
}
