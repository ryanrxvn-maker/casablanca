import { NextResponse } from 'next/server';

/**
 * POST /api/troca-produto/assemblyai
 *
 * Faz upload do audio ao AssemblyAI, dispara transcricao com
 * `word_boost` contendo o produto antigo e polla ate completar.
 *
 * Retorna a lista de palavras com timestamps (start/end em ms) pra
 * o front localizar cada ocorrencia do produto antigo.
 *
 * Usa 2 endpoints da AssemblyAI (upload + transcript + polling).
 */

export const runtime = 'nodejs';
export const maxDuration = 300;

const AAI_BASE = 'https://api.assemblyai.com/v2';

type Word = {
  text: string;
  start: number;
  end: number;
  confidence: number;
};

type TranscriptPoll = {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'error';
  text?: string;
  words?: Word[];
  error?: string;
};

export async function POST(req: Request) {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'ASSEMBLYAI_API_KEY não configurada.' },
      { status: 500 },
    );
  }

  const form = await req.formData();
  const file = form.get('audio');
  const oldProduct = String(form.get('oldProduct') ?? '').trim();
  const languageCode = String(form.get('languageCode') ?? 'pt');

  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: 'Envie o arquivo de áudio no campo "audio".' },
      { status: 400 },
    );
  }
  if (!oldProduct) {
    return NextResponse.json(
      { error: 'Informe o nome do produto antigo.' },
      { status: 400 },
    );
  }

  // 1. Upload do audio
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
    const t = await uploadRes.text();
    return NextResponse.json(
      { error: 'Falha no upload AssemblyAI.', detail: t.slice(0, 500) },
      { status: 502 },
    );
  }
  const { upload_url } = (await uploadRes.json()) as { upload_url: string };

  // 2. Dispara transcricao com word_boost do produto antigo
  const boostTerms = oldProduct
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .slice(0, 6);
  const trRes = await fetch(`${AAI_BASE}/transcript`, {
    method: 'POST',
    headers: {
      authorization: apiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      audio_url: upload_url,
      language_code: languageCode,
      word_boost: [oldProduct, ...boostTerms],
      boost_param: 'high',
      punctuate: true,
      format_text: true,
    }),
  });
  if (!trRes.ok) {
    const t = await trRes.text();
    return NextResponse.json(
      { error: 'Falha ao criar transcrição.', detail: t.slice(0, 500) },
      { status: 502 },
    );
  }
  const created = (await trRes.json()) as { id: string };

  // 3. Polling ate status final
  const deadline = Date.now() + 4 * 60 * 1000; // 4min
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2500));
    const poll = await fetch(`${AAI_BASE}/transcript/${created.id}`, {
      headers: { authorization: apiKey },
    });
    const body = (await poll.json()) as TranscriptPoll;
    if (body.status === 'completed') {
      const words = body.words ?? [];
      const matches = locateMatches(words, oldProduct);
      return NextResponse.json({
        transcriptId: body.id,
        text: body.text ?? '',
        words,
        matches,
      });
    }
    if (body.status === 'error') {
      return NextResponse.json(
        { error: body.error ?? 'Erro desconhecido na transcrição.' },
        { status: 502 },
      );
    }
  }

  return NextResponse.json(
    { error: 'Timeout aguardando transcrição (4 min).' },
    { status: 504 },
  );
}

/**
 * Localiza ocorrencias do produto antigo no array de palavras.
 * Retorna intervalos de start/end ms cobrindo a expressao inteira.
 */
function locateMatches(words: Word[], oldProduct: string) {
  const target = oldProduct
    .toLowerCase()
    .split(/\s+/)
    .map((s) => s.replace(/[.,!?;:]/g, ''))
    .filter(Boolean);
  if (target.length === 0) return [];

  const matches: Array<{ startMs: number; endMs: number; wordIndices: number[] }> = [];

  for (let i = 0; i <= words.length - target.length; i++) {
    let ok = true;
    for (let j = 0; j < target.length; j++) {
      const w = words[i + j]?.text?.toLowerCase().replace(/[.,!?;:]/g, '') ?? '';
      if (w !== target[j]) {
        ok = false;
        break;
      }
    }
    if (ok) {
      const slice = words.slice(i, i + target.length);
      matches.push({
        startMs: slice[0].start,
        endMs: slice[slice.length - 1].end,
        wordIndices: slice.map((_, k) => i + k),
      });
    }
  }
  return matches;
}
