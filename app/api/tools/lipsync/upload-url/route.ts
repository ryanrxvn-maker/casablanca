/**
 * /api/tools/lipsync/upload-url — gera uma URL ASSINADA do Supabase
 * Storage pro client subir vídeo/áudio DIRETO pro Supabase (browser →
 * Supabase), sem passar por função serverless da Vercel.
 *
 * POR QUÊ: a Vercel corta qualquer corpo de request > ~4,5MB
 * (FUNCTION_PAYLOAD_TOO_LARGE). Vídeos/áudios de lipsync passam disso
 * fácil. Subindo direto pro Supabase via signed URL, o arquivo nunca
 * toca a Vercel — sem limite de tamanho. Depois a rota /api/tools/lipsync
 * só recebe a URL pública (corpo minúsculo) e baixa server-side.
 *
 * Admin-only.
 */

import { NextResponse } from 'next/server';
import { requireAdmin, serviceClient } from '@/app/api/admin/_helpers';

export const runtime = 'nodejs';
export const maxDuration = 30;

// Next.js NÃO permite export arbitrário em route.ts (só GET/POST/config).
const BUCKET = 'lipsync-uploads';

export async function POST(req: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  let body: { kind?: string; ext?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 });
  }

  const kind = body.kind === 'audio' ? 'audio' : 'video';
  const ext = (body.ext || (kind === 'audio' ? 'mp3' : 'mp4'))
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 5) || 'bin';

  let sb;
  try {
    sb = serviceClient();
  } catch (e) {
    return NextResponse.json(
      { error: 'Storage não configurado (SUPABASE_SERVICE_ROLE_KEY).', detail: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }

  // Garante o bucket (idempotente — ignora erro se já existe).
  await sb.storage
    .createBucket(BUCKET, { public: true, fileSizeLimit: 500 * 1024 * 1024 })
    .catch(() => {});

  const path = `${guard.userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${kind}.${ext}`;

  const { data, error } = await sb.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    return NextResponse.json(
      { error: 'Falha ao criar URL de upload.', detail: error?.message },
      { status: 502 },
    );
  }

  const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(path);

  return NextResponse.json({
    path: data.path,
    token: data.token,
    publicUrl: pub.publicUrl,
  });
}
