/**
 * POST /api/tools/remove-subtitle/upload-url — URL ASSINADA do Supabase
 * Storage pro client subir cada TRECHO do vídeo DIRETO pro Supabase
 * (browser → Supabase), sem passar pela função serverless da Vercel.
 *
 * POR QUÊ: a Vercel corta corpo de request > ~4,5MB. Um vídeo (mesmo
 * picado em trechos) passa disso fácil. Subindo direto pro Supabase via
 * signed URL, o arquivo nunca toca a Vercel — sem limite. Depois a rota
 * /api/tools/remove-subtitle só recebe a URL pública (corpo minúsculo) e
 * baixa server-side.
 *
 * O cliente pica o vídeo em vários trechos e sobe cada um por aqui; o
 * primeiro upload manda { cleanup:true } pra fazer a higiene de órfãos 1x.
 *
 * Admin-only.
 */

import { NextResponse } from 'next/server';
import { serviceClient } from '@/app/api/admin/_helpers';
import { requireTier } from '@/lib/require-tier';

export const runtime = 'nodejs';
export const maxDuration = 30;

// Next.js NÃO permite export arbitrário em route.ts (só GET/POST/config).
const BUCKET = 'subtitle-uploads';

/**
 * Higiene de quota: remove objetos ANTIGOS (>2h) do usuário no bucket —
 * inputs (trechos, já baixados e consumidos) e outputs (trechos limpos que o
 * cliente baixa em segundos). Um job inteiro dura minutos, então tudo com mais
 * de 2h é órfão e deletar é SEGURO — impede o bucket de encher e travar
 * uploads. Best-effort: nunca quebra o request.
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
  const guard = await requireTier('admin', { unlockTools: ['/tools/remover-elementos'] });
  if (!guard.ok) return guard.response;

  let body: { ext?: string; cleanup?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 });
  }

  const ext = (body.ext || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'mp4';

  let sb;
  try {
    sb = serviceClient();
  } catch (e) {
    return NextResponse.json(
      { error: 'Storage não configurado (SUPABASE_SERVICE_ROLE_KEY).', detail: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }

  // Garante o bucket (público) de forma robusta. SEM fileSizeLimit explícito
  // (passar acima do limite global do projeto faz o createBucket falhar).
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

  // Higiene de storage — 1x por job (o cliente pede no primeiro trecho).
  if (body.cleanup) {
    await cleanupOldUserObjects(sb, guard.userId);
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
