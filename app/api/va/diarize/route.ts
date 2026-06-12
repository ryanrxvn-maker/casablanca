import { NextResponse } from 'next/server';
import { getUserKey } from '@/lib/user-keys';
import { requireTier } from '@/lib/require-tier';

/**
 * POST /api/va/diarize
 *
 * Diarizacao de locutor pro pipeline de Variacao de Avatar MULTI-AVATAR:
 * ADs com 2+ avatares (ex 'Doutor' + 'Depoimento Mulher') precisam saber
 * QUEM fala em CADA trecho pra mandar cada segmento pro lipsync com o
 * avatar certo. Recebe o audio (voz ja isolada pelo Demucs, comprimido em
 * opus 12k mono pelo client — ~90KB/min, longe do limite 4.5MB do Vercel)
 * e devolve os turnos de fala via AssemblyAI speaker_labels.
 *
 * Response: { ok, speakers: ['A','B'], utterances: [{speaker, startMs, endMs}] }
 */

export const runtime = 'nodejs';
export const maxDuration = 300;

const AAI_BASE = 'https://api.assemblyai.com/v2';

function jsonError(message: string, status = 500, detail?: string) {
  return NextResponse.json(
    detail ? { error: message, detail: detail.slice(0, 500) } : { error: message },
    { status },
  );
}

type TranscriptPoll = {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'error';
  error?: string;
  utterances?: Array<{ speaker: string; start: number; end: number; text?: string }>;
};

export async function POST(req: Request) {
  try {
    const gate = await requireTier('basic');
    if (!gate.ok) return gate.response;
    const keyResult = await getUserKey('assemblyai');
    if ('response' in keyResult) return keyResult.response;
    const apiKey = keyResult.key;

    let form: FormData;
    try {
      form = await req.formData();
    } catch (e) {
      return jsonError(
        'Falha ao ler upload. O arquivo pode ser maior que o limite (4.5MB no Vercel).',
        413,
        e instanceof Error ? e.message : String(e),
      );
    }
    const file = form.get('audio');
    if (!(file instanceof File)) {
      return jsonError('Envie o arquivo de audio no campo "audio".', 400);
    }
    const languageCode = String(form.get('languageCode') ?? 'pt');
    // Dica opcional de quantos locutores esperamos (numero de papeis do doc)
    const expectedRaw = parseInt(String(form.get('speakersExpected') ?? ''), 10);
    const speakersExpected = Number.isFinite(expectedRaw) && expectedRaw >= 2 && expectedRaw <= 10
      ? expectedRaw
      : null;

    // 1. Upload pro storage da AssemblyAI
    const bytes = new Uint8Array(await file.arrayBuffer());
    const uploadRes = await fetch(`${AAI_BASE}/upload`, {
      method: 'POST',
      headers: { authorization: apiKey, 'content-type': 'application/octet-stream' },
      body: bytes,
    });
    if (!uploadRes.ok) {
      const t = await uploadRes.text().catch(() => '');
      return jsonError('Falha no upload AssemblyAI.', 502, t);
    }
    const uploadJson = (await uploadRes.json().catch(() => null)) as { upload_url?: string } | null;
    if (!uploadJson?.upload_url) return jsonError('AssemblyAI retornou upload sem URL.', 502);

    // 2. Cria transcript com speaker_labels
    const trRes = await fetch(`${AAI_BASE}/transcript`, {
      method: 'POST',
      headers: { authorization: apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        audio_url: uploadJson.upload_url,
        language_code: languageCode,
        speaker_labels: true,
        ...(speakersExpected ? { speakers_expected: speakersExpected } : {}),
        // AssemblyAI EXIGE punctuate junto com speaker_labels — com
        // punctuate:false a API devolve 400 'speaker_labels cannot be True
        // when punctuate is set to False' (reproduzido live 2026-06-11; era
        // a causa da diarizacao falhar e o fallback gerar video errado).
        punctuate: true,
        format_text: true,
      }),
    });
    if (!trRes.ok) {
      const t = await trRes.text().catch(() => '');
      return jsonError('Falha ao criar diarizacao.', 502, t);
    }
    const created = (await trRes.json().catch(() => null)) as { id?: string } | null;
    if (!created?.id) return jsonError('AssemblyAI nao retornou id da transcricao.', 502);

    // 3. Poll ate completar (maxDuration 300s cobre ADs de varios minutos)
    const deadline = Date.now() + 280000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2500));
      const pollRes = await fetch(`${AAI_BASE}/transcript/${created.id}`, {
        headers: { authorization: apiKey },
      });
      if (!pollRes.ok) continue;
      const poll = (await pollRes.json().catch(() => null)) as TranscriptPoll | null;
      if (!poll) continue;
      if (poll.status === 'error') {
        return jsonError('AssemblyAI erro na diarizacao.', 502, poll.error || 'sem detalhe');
      }
      if (poll.status === 'completed') {
        const utterances = (poll.utterances || []).map((u) => ({
          speaker: u.speaker,
          startMs: u.start,
          endMs: u.end,
        }));
        const speakers = Array.from(new Set(utterances.map((u) => u.speaker)));
        return NextResponse.json({ ok: true, speakers, utterances });
      }
    }
    return jsonError('Timeout aguardando diarizacao da AssemblyAI.', 504);
  } catch (e) {
    return jsonError('Erro interno na diarizacao.', 500, e instanceof Error ? e.message : String(e));
  }
}
