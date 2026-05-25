/**
 * /api/voice-isolate-pro — Voice isolation neural via Replicate Demucs.
 *
 * Modelo: ryan5453/demucs (Demucs v4 hybrid transformer, Meta).
 *   - State-of-the-art em music source separation
 *   - Separa vocals/drums/bass/other com qualidade studio
 *   - GPU: A40 ~$0.001/s
 *   - Tempo: ~30-90s pra audio de 1-3min
 *
 * Por que NÃO HF Space:
 *   gradio/audio-separation-mdx tá fora do ar ("Space metadata could not
 *   be loaded"). Spaces gratuitos caem direto. Replicate é pago mas
 *   confiabilidade industrial.
 *
 * Body: multipart/form-data com campo `audio` (.mp3 ou .wav).
 *
 * Output: { vocals_url: string } — URL temporária do Replicate (expira ~1h).
 *
 * Use case PRIMARY: VA de Avatar (extract voz limpa antes de mandar pro
 * HeyGen lipsync). user reportou voz vinha com trilha sonora — fix definitivo.
 */

import { NextResponse } from 'next/server';
import Replicate from 'replicate';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 min — Demucs Replicate raro passa de 2min

// Modelo Demucs v4 no Replicate. ryan5453/demucs aceita stem='vocals'
// e retorna URL única (não array de stems) quando especifica stem.
// Sem version → SDK pega latest automaticamente.
const DEMUCS_MODEL = 'ryan5453/demucs';

export async function POST(req: Request) {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: 'REPLICATE_API_TOKEN nao configurada no servidor.' },
      { status: 500 },
    );
  }

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
  // Demucs aceita até ~50MB facilmente. Limita pra evitar abuso.
  const MAX_MB = 100;
  if (file.size > MAX_MB * 1024 * 1024) {
    return NextResponse.json(
      { error: `Arquivo muito grande. Máximo ${MAX_MB}MB.` },
      { status: 413 },
    );
  }

  // 1. Upload pro Replicate Files API (URL pública pro modelo consumir)
  const filename = (file as File).name || 'audio.wav';
  let audioUrl: string;
  try {
    const upstream = new FormData();
    upstream.append('content', file, filename);
    upstream.append('type', file.type || 'audio/wav');
    const r = await fetch('https://api.replicate.com/v1/files', {
      method: 'POST',
      headers: { Authorization: `Token ${token}` },
      body: upstream,
    });
    if (!r.ok) {
      const txt = await r.text();
      return NextResponse.json(
        {
          error: `Replicate Files upload falhou (HTTP ${r.status})`,
          detail: txt.slice(0, 500),
          kind: 'config',
        },
        { status: 502 },
      );
    }
    const j = (await r.json()) as { id: string; urls?: { get?: string } };
    audioUrl = j.urls?.get || `https://api.replicate.com/v1/files/${j.id}`;
  } catch (e) {
    return NextResponse.json(
      {
        error: 'Falha upload Replicate Files: ' + ((e as Error)?.message || String(e)),
        kind: 'network',
      },
      { status: 502 },
    );
  }

  // 2. Roda Demucs — stem='vocals' retorna 1 URL diretamente
  const replicate = new Replicate({ auth: token });
  try {
    const output = (await replicate.run(DEMUCS_MODEL as `${string}/${string}`, {
      input: {
        audio: audioUrl,
        stem: 'vocals',     // só queremos voz
        model: 'htdemucs',  // default, hybrid transformer
        shifts: 1,          // qualidade vs velocidade (1 = fast, padrão)
        overlap: 0.25,
        clip_mode: 'rescale',
        mp3_output: false,  // WAV preserva qualidade
        mp3_bitrate: 320,
      },
    })) as unknown;

    // Output shape: pode ser string URL OU array OU FileOutput (SDK >0.32)
    let vocalsUrl: string | null = null;
    if (typeof output === 'string') {
      vocalsUrl = output;
    } else if (Array.isArray(output)) {
      vocalsUrl = typeof output[0] === 'string' ? output[0] : null;
    } else if (output && typeof output === 'object') {
      const o = output as Record<string, unknown>;
      // SDK file-like: { url() => string }
      if (typeof (o as { url?: unknown }).url === 'function') {
        try {
          vocalsUrl = (o as { url: () => string }).url();
        } catch {}
      }
      // Objeto stems-by-name
      if (!vocalsUrl && typeof o.vocals === 'string') vocalsUrl = o.vocals as string;
    }

    if (!vocalsUrl) {
      return NextResponse.json(
        {
          error: 'Demucs Replicate não retornou URL de vocals',
          detail: JSON.stringify(output).slice(0, 500),
          kind: 'runtime',
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      vocals_url: vocalsUrl,
      model: DEMUCS_MODEL,
    });
  } catch (e) {
    const msg = (e as Error)?.message || String(e);
    const kind: string = msg.toLowerCase().includes('quota')
      ? 'quota'
      : msg.toLowerCase().includes('timeout')
        ? 'timeout'
        : 'runtime';
    console.error('[voice-isolate-pro]', msg);
    return NextResponse.json(
      { error: 'Demucs Replicate falhou: ' + msg, kind },
      { status: 502 },
    );
  }
}
