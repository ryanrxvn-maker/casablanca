import { NextResponse } from 'next/server';
import { getUserKey } from '@/lib/user-keys';
import { buildSrtFromCopyAndWords, type Word } from '@/lib/srt-builder';

/**
 * POST /api/mind-ads/transcribe-srt
 *
 * Multipart body:
 *  - audio: arquivo de audio
 *  - copy: texto da copy/script
 *  - provider: 'groq' (default) | 'assemblyai'
 *
 * Pra o tier eco/padrao do Mind Ads, usa Groq Whisper-large-v3 (~$0.04/h,
 * 11x mais barato que AssemblyAI). Pro premium, usa AssemblyAI.
 *
 * Se Groq falhar/key faltando E user tiver AssemblyAI, faz fallback automatico.
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
    let form: FormData;
    try {
      form = await req.formData();
    } catch (e) {
      return jsonError(
        'Falha ao ler upload (limite 4.5MB).',
        413,
        e instanceof Error ? e.message : String(e),
      );
    }

    const audio = form.get('audio');
    const copyText = String(form.get('copy') ?? '').trim();
    const provider = String(form.get('provider') ?? 'groq') as
      | 'groq'
      | 'assemblyai';

    if (!(audio instanceof File)) return jsonError('Audio ausente.', 400);
    if (!copyText) return jsonError('Copy ausente.', 400);

    // Tenta Groq primeiro se solicitado
    if (provider === 'groq') {
      try {
        const result = await transcribeViaGroq(audio);
        const srt = buildSrtFromCopyAndWords(copyText, result);
        return NextResponse.json({
          srt,
          wordCount: result.length,
          provider: 'groq',
        });
      } catch (e) {
        console.warn('[transcribe-srt] Groq falhou, tentando AssemblyAI:', e);
        // Fallback automatico
      }
    }

    // AssemblyAI (premium ou fallback)
    const result = await transcribeViaAssemblyAI(audio);
    const srt = buildSrtFromCopyAndWords(copyText, result);
    return NextResponse.json({
      srt,
      wordCount: result.length,
      provider: 'assemblyai',
    });
  } catch (e) {
    console.error('[mind-ads transcribe-srt]', e);
    return jsonError(
      'Erro inesperado.',
      500,
      e instanceof Error ? e.message : String(e),
    );
  }
}

async function transcribeViaGroq(audio: File): Promise<Word[]> {
  const keyResult = await getUserKey('groq');
  if ('response' in keyResult) {
    throw new Error('Groq key nao configurada.');
  }
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
    throw new Error(`Groq Whisper falhou: ${res.status} ${t.slice(0, 200)}`);
  }

  const json = (await res.json().catch(() => null)) as {
    text?: string;
    words?: Array<{ word: string; start: number; end: number }>;
  } | null;

  if (!json?.words || json.words.length === 0) {
    throw new Error('Groq retornou transcricao vazia.');
  }

  // Groq retorna start/end em segundos. Convertemos pra millis.
  return json.words.map((w) => ({
    text: w.word,
    start: Math.round(w.start * 1000),
    end: Math.round(w.end * 1000),
  }));
}

async function transcribeViaAssemblyAI(audio: File): Promise<Word[]> {
  const keyResult = await getUserKey('assemblyai');
  if ('response' in keyResult) {
    throw new Error('AssemblyAI key nao configurada.');
  }
  const apiKey = keyResult.key;

  // Upload
  const audioBytes = new Uint8Array(await audio.arrayBuffer());
  const uploadRes = await fetch(`${AAI_BASE}/upload`, {
    method: 'POST',
    headers: {
      authorization: apiKey,
      'content-type': 'application/octet-stream',
    },
    body: audioBytes,
  });
  if (!uploadRes.ok) {
    const t = await uploadRes.text().catch(() => '');
    throw new Error(`AssemblyAI upload falhou: ${t.slice(0, 200)}`);
  }
  const { upload_url } = (await uploadRes.json()) as { upload_url: string };

  // Cria transcript
  const trRes = await fetch(`${AAI_BASE}/transcript`, {
    method: 'POST',
    headers: {
      authorization: apiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      audio_url: upload_url,
      language_code: 'pt',
      punctuate: true,
      format_text: true,
    }),
  });
  if (!trRes.ok) {
    const t = await trRes.text().catch(() => '');
    throw new Error(`AssemblyAI transcript falhou: ${t.slice(0, 200)}`);
  }
  const { id: transcriptId } = (await trRes.json()) as { id: string };

  // Polling
  const deadline = Date.now() + 4 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2500));
    const poll = await fetch(`${AAI_BASE}/transcript/${transcriptId}`, {
      headers: { authorization: apiKey },
    });
    const body = (await poll.json()) as {
      status: 'queued' | 'processing' | 'completed' | 'error';
      words?: Word[];
      error?: string;
    };
    if (body.status === 'completed') {
      return (body.words ?? []) as Word[];
    }
    if (body.status === 'error') {
      throw new Error(body.error ?? 'Erro na transcricao.');
    }
  }
  throw new Error('AssemblyAI timeout.');
}
