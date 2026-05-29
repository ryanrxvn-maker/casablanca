/**
 * POST /api/separador-audio
 *
 * Recebe `multipart/form-data` com campo `audio` (arquivo) e devolve JSON
 * com 3 URLs (vocals, instrumental, sfx) que apontam pra arquivos hospedados
 * na Space HF. O client baixa cada um separadamente pra ter blob local
 * (toca + permite download direto).
 *
 * Tier gate: PRO+ (audio separation gasta GPU HF — não liberar pra free).
 */

import { NextRequest, NextResponse } from 'next/server';
import { separateAudio } from '@/lib/audio-separator-server';
import { MAX_AUDIO_MB } from '@/lib/audio-separator';
import { requireTier } from '@/lib/require-tier';

export const runtime = 'nodejs';
// Demucs em ZeroGPU pode levar 2-5 min num clip de 5min
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const gate = await requireTier('pro');
  if (!gate.ok) return gate.response;
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: 'Envie multipart/form-data com o campo "audio".' },
      { status: 400 },
    );
  }

  const file = form.get('audio');
  if (!(file instanceof Blob)) {
    return NextResponse.json(
      { error: 'Campo "audio" precisa ser um arquivo.' },
      { status: 400 },
    );
  }

  if (file.size === 0) {
    return NextResponse.json({ error: 'Arquivo vazio.' }, { status: 400 });
  }

  if (file.size > MAX_AUDIO_MB * 1024 * 1024) {
    return NextResponse.json(
      {
        error: `Arquivo muito grande. Máximo ${MAX_AUDIO_MB}MB — use o Compressor antes.`,
      },
      { status: 413 },
    );
  }

  const filename = (file as File).name || 'audio.mp3';
  const buf = new Uint8Array(await file.arrayBuffer());

  const result = await separateAudio({ audio: buf, filename });
  if (!result.ok) {
    const status =
      result.kind === 'quota' ? 429 : result.kind === 'config' ? 503 : 502;
    return NextResponse.json(
      { error: result.error, kind: result.kind, retrySec: result.retrySec },
      { status },
    );
  }

  return NextResponse.json({
    stems: result.stems,
  });
}
