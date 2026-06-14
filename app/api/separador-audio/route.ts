/**
 * POST /api/separador-audio
 *
 * Body JSON: { audioUrl: string, filename?: string }
 *   - audioUrl: URL pública (Supabase) do áudio que o client subiu DIRETO,
 *     via /api/separador-audio/upload-url. NUNCA recebe o arquivo aqui —
 *     é por isso que sumiu o HTTP 413 (a Vercel corta corpo > ~4,5MB).
 *
 * Roda o Demucs (Replicate) → 4 trilhas brutas (vocals/drums/bass/other),
 * re-hospeda cada uma no Supabase (replicate.delivery não tem CORS pro
 * browser) e devolve as URLs públicas. O client monta os alvos finais
 * (voz / trilha / SFX / etc) a partir dessas 4 trilhas — sem GPU extra.
 *
 * Tier: Pro+ (separação gasta GPU paga).
 */

import { NextRequest, NextResponse } from 'next/server';
import { separateStems } from '@/lib/audio-separator-server';
import { RAW_STEMS, type RawStem } from '@/lib/audio-separator';
import { serviceClient } from '@/app/api/admin/_helpers';
import { requireTier } from '@/lib/require-tier';
import { assertPublicHttpUrl, safeFetch, SsrfError } from '@/lib/safe-fetch';

export const runtime = 'nodejs';
// Demucs num clip de alguns minutos roda em ~30-120s; re-host adiciona pouco.
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const BUCKET = 'separador-uploads';

export async function POST(req: NextRequest) {
  const gate = await requireTier('pro');
  if (!gate.ok) return gate.response;

  let body: { audioUrl?: string; filename?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'Envie JSON com { audioUrl }.' },
      { status: 400 },
    );
  }

  const audioUrl = (body.audioUrl || '').trim();
  if (!audioUrl || !/^https?:\/\//.test(audioUrl)) {
    return NextResponse.json(
      { error: 'audioUrl ausente ou inválida.' },
      { status: 400 },
    );
  }
  // Anti-SSRF: a audioUrl é repassada pro Replicate baixar; barra destino
  // interno antes (impede usar o Replicate/servidor como proxy pra rede interna).
  try {
    await assertPublicHttpUrl(audioUrl);
  } catch (e) {
    if (e instanceof SsrfError) {
      return NextResponse.json({ error: 'audioUrl não permitida.' }, { status: 400 });
    }
    return NextResponse.json({ error: 'Falha ao validar a audioUrl.' }, { status: 400 });
  }

  // 1) Separa via Replicate Demucs → 4 trilhas brutas (replicate.delivery).
  const result = await separateStems({ audioUrl });
  if (!result.ok) {
    const status =
      result.kind === 'quota' ? 429 : result.kind === 'config' ? 503 : 502;
    return NextResponse.json(
      { error: result.error, kind: result.kind },
      { status },
    );
  }

  // 2) Re-hospeda cada trilha no Supabase pra o browser conseguir baixar
  //    (replicate.delivery não manda CORS). O download é server-side.
  let sb;
  try {
    sb = serviceClient();
  } catch (e) {
    return NextResponse.json(
      {
        error: 'Storage não configurado (SUPABASE_SERVICE_ROLE_KEY).',
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    );
  }

  const base = `${gate.userId}/stems/${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;

  const stems: Partial<Record<RawStem, { url: string; size: number }>> = {};

  for (const stem of RAW_STEMS) {
    const srcUrl = result.stems[stem];
    if (!srcUrl) continue; // trilha ausente (ok pra alvos que não usam ela)

    let bytes: ArrayBuffer;
    try {
      const dl = await safeFetch(srcUrl);
      if (!dl.ok) throw new Error(`HTTP ${dl.status}`);
      bytes = await dl.arrayBuffer();
    } catch (e) {
      return NextResponse.json(
        {
          error: `Falha ao baixar a trilha "${stem}" do Replicate: ${
            e instanceof Error ? e.message : String(e)
          }`,
          kind: 'network',
        },
        { status: 502 },
      );
    }

    if (bytes.byteLength < 512) {
      return NextResponse.json(
        { error: `Trilha "${stem}" veio vazia (${bytes.byteLength}B).`, kind: 'runtime' },
        { status: 502 },
      );
    }

    const path = `${base}-${stem}.mp3`;
    const { error: upErr } = await sb.storage
      .from(BUCKET)
      .upload(path, Buffer.from(bytes), {
        contentType: 'audio/mpeg',
        upsert: true,
      });
    if (upErr) {
      return NextResponse.json(
        { error: `Falha ao hospedar a trilha "${stem}": ${upErr.message}`, kind: 'config' },
        { status: 502 },
      );
    }
    const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(path);
    stems[stem] = { url: pub.publicUrl, size: bytes.byteLength };
  }

  if (!stems.vocals) {
    return NextResponse.json(
      { error: 'Separação não produziu a trilha de voz.', kind: 'runtime' },
      { status: 502 },
    );
  }

  return NextResponse.json({ stems });
}
