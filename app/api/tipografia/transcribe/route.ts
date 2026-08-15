import { NextResponse } from 'next/server';
import { requireTier } from '@/lib/require-tier';
import { transcribeAudio } from '@/lib/transcribe';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * Tipografia Automática — transcrição word-level do áudio já extraído no
 * NAVEGADOR (opus 16k mono, ≤4MB). Groq Whisper primeiro (barato/free tier,
 * key do próprio usuário em /configuracoes/api) com fallback AssemblyAI.
 * Devolve as palavras cruas com timestamps em ms — o agrupamento em blocos
 * e o render são 100% client-side.
 */
export async function POST(req: Request) {
  const gate = await requireTier('free');
  if (!gate.ok) return gate.response;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: 'Falha ao ler o upload (limite ~4MB de áudio).' },
      { status: 413 },
    );
  }

  const audio = form.get('audio');
  if (!(audio instanceof File) || audio.size === 0) {
    return NextResponse.json({ error: 'Áudio ausente.' }, { status: 400 });
  }

  // aceita 'pt-br'/'pt-pt' etc — o Whisper só conhece o idioma base, então a
  // região é descartada ('pt-br' → 'pt'); 'auto' passa direto
  const langRaw = String(form.get('language') ?? 'pt').toLowerCase();
  const language = /^(auto|[a-z]{2}(-[a-z]{2})?)$/.test(langRaw)
    ? langRaw.split('-')[0] === 'auto'
      ? 'auto'
      : langRaw.split('-')[0]
    : 'pt';

  const { words, provider, errors } = await transcribeAudio(audio, {
    provider: 'groq',
    language,
  });

  if (words.length === 0) {
    // O primeiro erro costuma ser o de key ausente (400 do getUserKey) — o
    // MissingKeyBanner do client já orienta; aqui devolve o motivo cru.
    return NextResponse.json(
      {
        error:
          'Não consegui transcrever o áudio agora. ' +
          (errors[0] ? `(${errors[0].slice(0, 140)})` : 'Tenta de novo em instantes.'),
      },
      { status: 502 },
    );
  }

  return NextResponse.json({ words, provider });
}
