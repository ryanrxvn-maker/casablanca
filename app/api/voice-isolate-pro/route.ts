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

// Modelo Demucs no Replicate. cjwbw/demucs é o mais estabelecido (~30k runs).
// Same owner do cjwbw/wav2lip que o lipsync usa.
// Override possível via env REPLICATE_DEMUCS_MODEL pra trocar sem deploy.
const DEMUCS_MODEL = (process.env.REPLICATE_DEMUCS_MODEL || 'cjwbw/demucs') as `${string}/${string}`;

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

  // 2. Roda Demucs. cjwbw/demucs aceita inputs diferentes de outros forks —
  // mandamos MULTIPLAS chaves redundantes pra robustez (server ignora as
  // que nao reconhece).
  const replicate = new Replicate({ auth: token });
  try {
    const output = (await replicate.run(DEMUCS_MODEL, {
      input: {
        // audio fields (cjwbw, ryan5453, etc usam diferentes nomes)
        audio: audioUrl,
        audio_file: audioUrl,
        // stem selection (priorizar vocals)
        stem: 'vocals',
        stems: 'vocals',
        target: 'vocals',
        // model (cjwbw usa model_name, outros usam model)
        model: 'htdemucs',
        model_name: 'htdemucs',
        // output format (preserva qualidade)
        output_format: 'wav',
        mp3: false,
        wav: true,
        // performance/quality knobs
        shifts: 1,
        overlap: 0.25,
        clip_mode: 'rescale',
      },
    })) as unknown;

    // Tenta extrair URL de "vocals" — output pode ser:
    //  - string URL única (stem=vocals respeitado)
    //  - array [drums, bass, other, vocals] (cjwbw/demucs convention)
    //  - dict { vocals, drums, bass, other }
    //  - FileOutput object com .url()
    const extractUrl = (v: unknown): string | null => {
      if (!v) return null;
      if (typeof v === 'string') return v.startsWith('http') ? v : null;
      if (typeof v === 'object') {
        const o = v as Record<string, unknown>;
        if (typeof (o as { url?: unknown }).url === 'function') {
          try { return (o as { url: () => string }).url(); } catch { return null; }
        }
        if (typeof o.url === 'string' && o.url.startsWith('http')) return o.url;
      }
      return null;
    };

    let vocalsUrl: string | null = extractUrl(output);

    if (!vocalsUrl && Array.isArray(output)) {
      // Procura URL com 'vocals' no path PRIMEIRO; senão pega o último
      // (convenção cjwbw/demucs: [drums, bass, other, vocals])
      const urls = output.map(extractUrl).filter(Boolean) as string[];
      vocalsUrl = urls.find((u) => /vocals?/i.test(u)) || urls[urls.length - 1] || null;
    }

    if (!vocalsUrl && output && typeof output === 'object') {
      const o = output as Record<string, unknown>;
      // Procura key 'vocals' / 'vocal' / 'voice'
      for (const key of ['vocals', 'vocal', 'voice', 'output', 'audio']) {
        if (o[key]) {
          vocalsUrl = extractUrl(o[key]);
          if (vocalsUrl) break;
        }
      }
    }

    if (!vocalsUrl) {
      return NextResponse.json(
        {
          error: 'Demucs Replicate retornou output mas não conseguimos extrair URL de vocals',
          detail: JSON.stringify(output).slice(0, 800),
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
