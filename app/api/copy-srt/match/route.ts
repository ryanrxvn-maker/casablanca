import { NextResponse } from 'next/server';
import { getUserKey } from '@/lib/user-keys';

/**
 * POST /api/copy-srt/match
 *
 * Recebe (multipart):
 *  - audio: arquivo OPUS/MP3/WAV (extraido client-side)
 *  - copy: texto da copy/script
 *
 * Pipeline:
 *   1. Upload audio → AssemblyAI
 *   2. Cria transcript com word-level timestamps (language pt)
 *   3. Polling ate completar
 *   4. Alinha o texto da COPY contra os timestamps das palavras
 *      transcritas. Substitui o texto transcrito (que pode ter erros)
 *      pelo texto exato da copy, mantendo o timing.
 *   5. Gera SRT pronto pra importar no CapCut/Premiere.
 *
 * Custo: AssemblyAI ~$0.45/h.
 */

export const runtime = 'nodejs';
export const maxDuration = 300;

const AAI_BASE = 'https://api.assemblyai.com/v2';

type Word = {
  text: string;
  start: number;
  end: number;
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
    const keyResult = await getUserKey('assemblyai');
    if ('response' in keyResult) return keyResult.response;
    const apiKey = keyResult.key;

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

    if (!(audio instanceof File)) {
      return jsonError('Audio ausente.', 400);
    }
    if (!copyText) {
      return jsonError('Copy ausente.', 400);
    }

    // Upload audio
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
      return jsonError('Falha no upload AssemblyAI.', 502, t);
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
      return jsonError('Falha ao criar transcricao.', 502, t);
    }
    const { id: transcriptId } = (await trRes.json()) as { id: string };

    // Polling
    const deadline = Date.now() + 4 * 60 * 1000;
    let words: Word[] = [];
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2500));
      const poll = await fetch(`${AAI_BASE}/transcript/${transcriptId}`, {
        headers: { authorization: apiKey },
      });
      const body = (await poll.json()) as TranscriptPoll;
      if (body.status === 'completed') {
        words = body.words ?? [];
        break;
      }
      if (body.status === 'error') {
        return jsonError(body.error ?? 'Erro na transcricao.', 502);
      }
    }
    if (words.length === 0) {
      return jsonError('Timeout ou transcricao vazia.', 504);
    }

    // Gera SRT alinhando copy com timestamps das palavras
    const srt = buildSrtFromCopyAndWords(copyText, words);

    return NextResponse.json({ srt, wordCount: words.length });
  } catch (e) {
    console.error('[copy-srt match]', e);
    return jsonError(
      'Erro inesperado.',
      500,
      e instanceof Error ? e.message : String(e),
    );
  }
}

/**
 * Algoritmo do SRT:
 *   1. Tokeniza copy em "palavras" (preserva pontuacao agrupada)
 *   2. Distribui timestamps das palavras transcritas pra cada palavra
 *      da copy (assume mesma ordem temporal)
 *   3. Agrupa palavras em legendas curtas (max 7 palavras OU 4 segundos)
 *   4. Formata como SRT (HH:MM:SS,mmm)
 *
 * Estrategia simples: o numero de palavras na copy ~= numero no transcript.
 * Faz mapping linear, distribuindo proporcionalmente quando ha drift.
 */
function buildSrtFromCopyAndWords(copy: string, words: Word[]): string {
  // Tokeniza copy preservando pontuacao
  const copyTokens = copy
    .replace(/\s+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);

  if (copyTokens.length === 0) return '';

  const N = copyTokens.length;
  const M = words.length;

  // Mapeamento linear: palavra i da copy → palavra(s) j..k do transcript.
  // Cada palavra da copy recebe um intervalo proporcional de palavras do transcript.
  const startTimes: number[] = [];
  const endTimes: number[] = [];
  for (let i = 0; i < N; i++) {
    const j = Math.floor((i * M) / N);
    const k = Math.max(j, Math.floor(((i + 1) * M) / N) - 1);
    startTimes.push(words[Math.min(j, M - 1)].start);
    endTimes.push(words[Math.min(k, M - 1)].end);
  }

  // Agrupa em legendas (max 7 palavras OU 4s OU pontuacao final)
  type Subtitle = { start: number; end: number; text: string };
  const subs: Subtitle[] = [];
  let group: number[] = [];
  let groupStart = startTimes[0];

  function flush() {
    if (group.length === 0) return;
    const text = group.map((idx) => copyTokens[idx]).join(' ');
    const end = endTimes[group[group.length - 1]];
    subs.push({ start: groupStart, end, text });
    group = [];
  }

  for (let i = 0; i < N; i++) {
    if (group.length === 0) groupStart = startTimes[i];
    group.push(i);

    const tok = copyTokens[i];
    const endsSentence = /[.!?]$/.test(tok);
    const groupDur = (endTimes[i] - groupStart) / 1000;

    if (group.length >= 7 || groupDur >= 4 || endsSentence) {
      flush();
    }
  }
  flush();

  // Formata como SRT
  return subs
    .map((s, i) => {
      return `${i + 1}\n${msToSrt(s.start)} --> ${msToSrt(s.end)}\n${s.text}\n`;
    })
    .join('\n');
}

function msToSrt(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  const mm = total % 1000;
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(mm, 3)}`;
}
