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
import { serviceClient } from '@/app/api/admin/_helpers';
import { requireToolAccess } from '@/lib/require-tier';

export const runtime = 'nodejs';
export const maxDuration = 30;

// Next.js NÃO permite export arbitrário em route.ts (só GET/POST/config).
const BUCKET = 'lipsync-uploads';

/**
 * Higiene de quota: remove objetos ANTIGOS (>2h) do usuário no bucket — tanto
 * inputs (rosto/áudio, já baixados pro server e consumidos) quanto outputs (MP4
 * que o cliente baixa em segundos). Um job inteiro dura minutos, então tudo com
 * mais de 2h é órfão e deletar é SEGURO — e impede o bucket de encher (quota
 * free ~1GB) e voltar a travar uploads. Best-effort: nunca quebra o request.
 */
async function cleanupOldUserObjects(
  sb: ReturnType<typeof serviceClient>,
  userId: string,
): Promise<void> {
  const MAX_AGE_MS = 2 * 60 * 60 * 1000;
  const now = Date.now();
  const isOld = (createdAt?: string | null): boolean => {
    if (!createdAt) return false;
    const t = new Date(createdAt).getTime();
    return Number.isFinite(t) && now - t > MAX_AGE_MS;
  };
  for (const prefix of [userId, `outputs/${userId}`]) {
    try {
      const { data } = await sb.storage
        .from(BUCKET)
        .list(prefix, { limit: 1000, sortBy: { column: 'created_at', order: 'asc' } });
      if (!Array.isArray(data)) continue;
      const stale = data
        .filter((o) => o?.name && isOld((o as { created_at?: string }).created_at))
        .map((o) => `${prefix}/${o.name}`);
      if (stale.length) await sb.storage.from(BUCKET).remove(stale);
    } catch {
      /* best-effort — higiene nunca derruba o upload */
    }
  }
}

export async function POST(req: Request) {
  const guard = await requireToolAccess('/tools/lipsync', 'pro');
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

  // Garante o bucket (público) de forma robusta. SEM fileSizeLimit
  // explícito — usar o limite global do projeto (passar um valor acima
  // do limite global faz o createBucket falhar).
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

  // Higiene de storage — 1x por job (só no upload do vídeo, que sobe uma vez):
  // limpa órfãos >2h pra o bucket nunca encher e travar uploads. Não bloqueia
  // o áudio (que sobe N vezes nos chunks).
  if (kind === 'video') {
    await cleanupOldUserObjects(sb, guard.userId);
  }

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
