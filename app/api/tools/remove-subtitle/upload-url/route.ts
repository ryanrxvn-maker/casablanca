/**
 * /api/tools/remove-subtitle/upload-url — URL ASSINADA do Supabase Storage
 * pro client subir o vídeo DIRETO pro Supabase (browser → Supabase), sem
 * passar pela função serverless da Vercel (que corta corpos > ~4,5MB).
 *
 * Depois a rota /api/tools/remove-subtitle só recebe a URL pública (corpo
 * minúsculo) e baixa o vídeo server-side pra mandar pro vmake.
 *
 * Admin-only.
 */

import { NextResponse } from 'next/server';
import { requireAdmin, serviceClient } from '@/app/api/admin/_helpers';

export const runtime = 'nodejs';
export const maxDuration = 30;

const BUCKET = 'remover-uploads';

export async function POST(req: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  let body: { ext?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 });
  }

  const ext =
    (body.ext || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'mp4';

  let sb;
  try {
    sb = serviceClient();
  } catch (e) {
    return NextResponse.json(
      { error: 'Storage não configurado (SUPABASE_SERVICE_ROLE_KEY).', detail: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }

  try {
    const { data: buckets } = await sb.storage.listBuckets();
    const exists = Array.isArray(buckets) && buckets.some((b) => b.name === BUCKET);
    if (!exists) {
      const { error: cbErr } = await sb.storage.createBucket(BUCKET, { public: true });
      if (cbErr && !/exist/i.test(cbErr.message || '')) {
        return NextResponse.json(
          { error: 'Falha ao criar bucket de upload.', detail: cbErr.message },
          { status: 502 },
        );
      }
    }
  } catch (e) {
    return NextResponse.json(
      { error: 'Falha ao preparar o storage.', detail: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }

  const path = `${guard.userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { data, error } = await sb.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    return NextResponse.json(
      { error: 'Falha ao criar URL de upload.', detail: error?.message },
      { status: 502 },
    );
  }
  const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(path);

  return NextResponse.json({ path: data.path, token: data.token, publicUrl: pub.publicUrl });
}
