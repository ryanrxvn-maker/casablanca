import { NextResponse } from 'next/server';
import { getUserKey } from '@/lib/user-keys';
import { requireTier } from '@/lib/require-tier';
import { matchCopyWindowed, type Word } from '@/lib/decupagem-matcher';

/**
 * POST /api/decupagem-copy/match
 *
 * Transcreve (Groq Whisper, fallback AssemblyAI) e alinha cada frase da
 * copy com a melhor take no video. Toda a logica de matching e' pura e
 * vive em lib/decupagem-matcher.ts (testada em
 * lib/decupagem-matcher.test.ts). Esta route so faz I/O de rede.
 */

export const runtime = 'nodejs';
export const maxDuration = 300;

const AAI_BASE = 'https://api.assemblyai.com/v2';
const GROQ_BASE = 'https://api.groq.com/openai/v1';

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
    const requestedProvider = String(form.get('provider') ?? 'groq');

    if (!(audio instanceof File)) {
      return jsonError('Audio ausente no campo "audio".', 400);
    }
    if (!copyText) {
      return jsonError('Copy ausente no campo "copy".', 400);
    }
    if (copyText.length > 50000) {
      return jsonError('Copy muito grande (max 50000 caracteres).', 400);
    }

    let words: Word[] = [];
    let provider = '';

    if (requestedProvider === 'groq') {
      try {
        words = await transcribeViaGroq(audio);
        provider = 'groq';
      } catch (e) {
        console.warn('[decupagem] Groq falhou, fallback AAI:', e);
      }
    }

    if (words.length === 0) {
      try {
        words = await transcribeViaAssemblyAI(audio);
        provider = 'assemblyai';
      } catch (e) {
        return jsonError(
          'Falha em ambos providers. Configure Groq ou AssemblyAI em /configuracoes/api.',
          502,
          e instanceof Error ? e.message : String(e),
        );
      }
    }

    if (words.length === 0) {
      return jsonError('Transcricao vazia.', 504);
    }

    const cuts = matchCopyWindowed(copyText, words);
    if (cuts.length === 0) {
      return jsonError(
        'Nao consegui alinhar nenhuma frase. Confira se a copy bate com o video.',
        422,
      );
    }

    return NextResponse.json({
      cuts,
      provider,
      transcriptPreview: words
        .map((w) => w.text)
        .join(' ')
        .slice(0, 500),
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

// =================== Transcription ======================================

async function transcribeViaGroq(audio: File): Promise<Word[]> {
  const keyResult = await getUserKey('groq');
  if ('response' in keyResult) throw new Error('Groq key ausente.');
  const apiKey = keyResult.key;

  const fd = new FormData();
  fd.append('file', audio, audio.name || 'audio.opus');
  fd.append('model', 'whisper-large-v3');
  fd.append('response_format', 'verbose_json');
  fd.append('timestamp_granularities[]', 'word');
  fd.append('language', 'pt');

  const res = await fetch(`${GROQ_BASE}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: fd,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Groq ${res.status}: ${t.slice(0, 200)}`);
  }
  const json = (await res.json().catch(() => null)) as {
    words?: Array<{ word: string; start: number; end: number }>;
  } | null;
  if (!json?.words) throw new Error('Groq retornou sem palavras.');

  return json.words.map((w) => ({
    text: w.word,
    start: Math.round(w.start * 1000),
    end: Math.round(w.end * 1000),
  }));
}

async function transcribeViaAssemblyAI(audio: File): Promise<Word[]> {
  const keyResult = await getUserKey('assemblyai');
  if ('response' in keyResult) throw new Error('AAI key ausente.');
  const apiKey = keyResult.key;

  const audioBytes = new Uint8Array(await audio.arrayBuffer());
  const uploadRes = await fetch(`${AAI_BASE}/upload`, {
    method: 'POST',
    headers: {
      authorization: apiKey,
      'content-type': 'application/octet-stream',
    },
    body: audioBytes,
  });
  if (!uploadRes.ok) throw new Error(`AAI upload ${uploadRes.status}`);
  const { upload_url } = (await uploadRes.json()) as { upload_url: string };

  const trRes = await fetch(`${AAI_BASE}/transcript`, {
    method: 'POST',
    headers: { authorization: apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({
      audio_url: upload_url,
      language_code: 'pt',
      punctuate: true,
      format_text: true,
    }),
  });
  if (!trRes.ok) throw new Error(`AAI transcript ${trRes.status}`);
  const { id } = (await trRes.json()) as { id: string };

  const deadline = Date.now() + 4 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2500));
    const poll = await fetch(`${AAI_BASE}/transcript/${id}`, {
      headers: { authorization: apiKey },
    });
    const body = (await poll.json()) as {
      status: string;
      words?: Array<{ text: string; start: number; end: number; confidence: number }>;
      error?: string;
    };
    if (body.status === 'completed') {
      return (body.words ?? []).map((w) => ({
        text: w.text,
        start: w.start,
        end: w.end,
        confidence: w.confidence,
      }));
    }
    if (body.status === 'error') throw new Error(body.error ?? 'AAI error');
  }
  throw new Error('AAI timeout');
}
