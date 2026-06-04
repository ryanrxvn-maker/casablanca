/**
 * /api/separador-audio/upload-url — gera URL ASSINADA do Supabase Storage
 * pro client subir o áudio DIRETO pro Supabase (browser → Supabase), sem
 * passar por função serverless da Vercel.
 *
 * POR QUÊ: a Vercel corta qualquer corpo de request > ~4,5MB
 * (FUNCTION_PAYLOAD_TOO_LARGE → HTTP 413). Áudios de separação passam disso
 * fácil (o user reportou 56MB). Subindo direto pro Supabase via signed URL,
 * o arquivo nunca toca a Vercel — sem limite de tamanho. Depois a rota
 * /api/separador-audio só recebe a URL pública (corpo minúsculo) e manda o
 * Demucs (Replicate) baixar dela.
 *
 * Mesmo padrão de /api/tools/lipsync/upload-url.
 *
 * Tier: Pro+ (separação gasta GPU paga no Replicate).
 */

import { NextResponse } from 'next/server';
import { serviceClient } from '@/app/api/admin/_helpers';
import { requireTier } from '@/lib/require-tier';

export const runtime = 'nodejs';
export const maxDuration = 30;

const BUCKET = 'separador-uploads';

export async function POST(req: Request) {
  const gate = await requireTier('pro');
  if (!gate.ok) return gate.response;

  let body: { ext?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 });
  }

  const ext =
    (body.ext || 'wav')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 5) || 'wav';

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

  // Garante o bucket (público) de forma robusta. SEM fileSizeLimit explícito
  // — usa o limite global do projeto (passar valor acima do global faz o
  // createBucket falhar).
  try {
    const { data: buckets } = await sb.storage.listBuckets();
    const exists =
      Array.isArray(buckets) && buckets.some((b) => b.name === BUCKET);
    if (!exists) {
      const { error: cbErr } = await sb.storage.createBucket(BUCKET, {
        public: true,
      });
      if (cbErr && !/exist/i.test(cbErr.message || '')) {
        return NextResponse.json(
          { error: 'Falha ao criar bucket de upload.', detail: cbErr.message },
          { status: 502 },
        );
      }
    }
  } catch (e) {
    return NextResponse.json(
      {
        error: 'Falha ao preparar o storage.',
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 502 },
    );
  }

  const path = `${gate.userId}/${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}-src.${ext}`;

  const { data, error } = await sb.storage
    .from(BUCKET)
    .createSignedUploadUrl(path);
  if (error || !data) {
    return NextResponse.json(
      { error: 'Falha ao criar URL de upload.', detail: error?.message },
      { status: 502 },
    );
  }

  const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(path);

  return NextResponse.json({
    bucket: BUCKET,
    path: data.path,
    token: data.token,
    publicUrl: pub.publicUrl,
  });
}
