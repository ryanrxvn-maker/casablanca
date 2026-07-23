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

/**
 * Higiene de quota: remove objetos ANTIGOS (>2h) do usuário — origem
 * (`${userId}/...-src`) e trilhas (`${userId}/stems/...`). Um job dura
 * minutos, então tudo >2h é órfão e deletar é SEGURO. Impede o bucket de
 * encher e travar uploads (como já acontecia no lipsync antes da limpeza).
 * Best-effort: nunca derruba o request.
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
  for (const prefix of [userId, `${userId}/stems`]) {
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
  const gate = await requireTier('admin', { unlockTools: ['/tools/separador-audio'] });
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

  // Higiene de storage — limpa órfãos >2h pra o bucket nunca encher e travar
  // uploads. Best-effort, não bloqueia.
  await cleanupOldUserObjects(sb, gate.userId);

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
