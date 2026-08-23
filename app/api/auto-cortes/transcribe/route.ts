import { NextResponse } from 'next/server';
import { requireToolAccess } from '@/lib/require-tier';
import { transcribeAudio } from '@/lib/transcribe';

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

/**
 * AUTO CORTES — transcrição word-level de UM PEDAÇO de áudio.
 *
 * Gêmea da /api/tipografia/transcribe, com duas diferenças que importam:
 *  1. gate Premium por ferramenta (`requireToolAccess('/tools/auto-cortes')`) —
 *     rota de tool paga nunca fica aberta pra conta free com cookie válido;
 *  2. o cliente manda MUITOS pedaços (vídeo longo é o caso normal), então o
 *     navegador é quem orquestra paralelismo/retry — aqui cada request é um
 *     pedaço só, opus 16k mono de ~3 MB.
 *
 * Nenhum byte de VÍDEO sobe: o que chega é só o áudio já extraído no
 * navegador. Groq Whisper primeiro (chave do próprio cliente) com fallback
 * AssemblyAI — é o comportamento de `transcribeAudio`.
 */
export async function POST(req: Request) {
  const gate = await requireToolAccess('/tools/auto-cortes', 'basic');
  if (!gate.ok) return gate.response;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      {
        error:
          'O pedaço de áudio chegou grande demais pro servidor (limite ~4 MB). ' +
          'Recarregue a página e tente de novo — os pedaços são gerados menores automaticamente.',
      },
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

  const { words, provider, errors, detectedLanguage } = await transcribeAudio(audio, {
    provider: 'groq',
    language,
  });

  if (words.length === 0) {
    // O primeiro erro costuma ser o de chave ausente (o MissingKeyBanner do
    // client já orienta); devolvemos o motivo curto pra não ficar cego.
    return NextResponse.json(
      {
        error:
          'Não consegui transcrever esse pedaço agora. ' +
          (errors[0] ? `(${errors[0].slice(0, 140)})` : 'Tenta de novo em instantes.'),
      },
      { status: 502 },
    );
  }

  return NextResponse.json({ words, provider, ...(detectedLanguage ? { language: detectedLanguage } : {}) });
}
