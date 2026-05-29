import { NextResponse } from 'next/server';
import { getUserKey } from '@/lib/user-keys';
import { requireTier } from '@/lib/require-tier';

/**
 * POST /api/troca-produto/assemblyai
 *
 * Faz upload do audio ao AssemblyAI, dispara transcricao com
 * `word_boost` contendo o produto antigo e polla ate completar.
 *
 * Retorna a lista de palavras com timestamps (start/end em ms) pra
 * o front localizar cada ocorrencia do produto antigo.
 *
 * IMPORTANTE: Vercel limita o body multipart a ~4.5MB no plano padrao.
 * Toda falha aqui retorna JSON estruturado pra o client conseguir
 * descrever o problema (em vez de explodir o JSON.parse com texto puro).
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
    const keyResult = await getUserKey('assemblyai');
    if ('response' in keyResult) return keyResult.response;
    const apiKey = keyResult.key;

    let form: FormData;
    try {
      form = await req.formData();
    } catch (e) {
      // Tipicamente cai aqui quando o body excede limite do runtime
      return jsonError(
        'Falha ao ler upload. O arquivo pode ser maior que o limite (4.5MB no Vercel).',
        413,
        e instanceof Error ? e.message : String(e),
      );
    }

    const file = form.get('audio');
    const oldProduct = String(form.get('oldProduct') ?? '').trim();
    const languageCode = String(form.get('languageCode') ?? 'pt');

    if (!(file instanceof File)) {
      return jsonError('Envie o arquivo de audio no campo "audio".', 400);
    }
    if (!oldProduct) {
      return jsonError('Informe o nome do produto antigo.', 400);
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
      const t = await uploadRes.text().catch(() => '');
      return jsonError('Falha no upload AssemblyAI.', 502, t);
    }
    const uploadJson = (await uploadRes.json().catch(() => null)) as
      | { upload_url: string }
      | null;
    if (!uploadJson?.upload_url) {
      return jsonError('AssemblyAI retornou upload sem URL.', 502);
    }

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
        audio_url: uploadJson.upload_url,
        language_code: languageCode,
        word_boost: [oldProduct, ...boostTerms],
        boost_param: 'high',
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

    // 3. Polling ate status final
    const deadline = Date.now() + 4 * 60 * 1000; // 4min
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
        return jsonError(
          body.error ?? 'Erro desconhecido na transcricao.',
          502,
        );
      }
    }

    return jsonError('Timeout aguardando transcricao (4 min).', 504);
  } catch (e) {
    // Garantia final: qualquer throw aqui vira JSON em vez de texto puro.
    console.error('[assemblyai route]', e);
    return jsonError(
      'Erro inesperado no servidor.',
      500,
      e instanceof Error ? e.message : String(e),
    );
  }
}

/**
 * Localiza ocorrencias do produto antigo no array de palavras.
 */
function locateMatches(words: Word[], oldProduct: string) {
  const target = oldProduct
    .toLowerCase()
    .split(/\s+/)
    .map((s) => s.replace(/[.,!?;:]/g, ''))
    .filter(Boolean);
  if (target.length === 0) return [];

  const matches: Array<{
    startMs: number;
    endMs: number;
    wordIndices: number[];
  }> = [];

  for (let i = 0; i <= words.length - target.length; i++) {
    let ok = true;
    for (let j = 0; j < target.length; j++) {
      const w =
        words[i + j]?.text?.toLowerCase().replace(/[.,!?;:]/g, '') ?? '';
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
