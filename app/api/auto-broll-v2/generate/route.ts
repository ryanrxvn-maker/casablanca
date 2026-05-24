/**
 * POST /api/auto-broll-v2/generate
 *
 * Auto B-roll v2 — server-side via API direta do Magnific.com.
 * Bypass total da extension/UI automation. 10x mais rápido + 100% robusto.
 *
 * Body:
 * {
 *   "takes": [
 *     { "imagePrompt": "...", "videoPrompt": "..." },
 *     ...
 *   ],
 *   "concurrency": 5  // opcional, default 5
 * }
 *
 * Response: streaming NDJSON ou JSON com URLs finais.
 *
 * Auth: lê cookies Magnific do user (salvos via /api/auto-broll-v2/save-creds).
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  generateBrollPair,
  type MagnificCreds,
} from '@/lib/magnific-api-server';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 min — videos Kling podem demorar
export const dynamic = 'force-dynamic';

type TakeInput = {
  imagePrompt: string;
  videoPrompt?: string;
};

type TakeResult = {
  idx: number;
  imagePrompt: string;
  videoPrompt: string;
  imageUrl?: string;
  videoUrl?: string;
  error?: string;
  imageMs?: number;
  videoMs?: number;
};

export async function POST(req: NextRequest) {
  // Auth do user no nosso app
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
  }
  const userId = userData.user.id;

  // Body
  let body: { takes?: TakeInput[]; concurrency?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }
  const takes = Array.isArray(body.takes) ? body.takes : [];
  if (takes.length === 0) {
    return NextResponse.json({ error: 'Nenhum take fornecido' }, { status: 400 });
  }
  const concurrency = Math.max(1, Math.min(8, body.concurrency || 5));

  // Carrega creds do user (salvos previamente)
  const { data: credsRow } = await supabase
    .from('user_secrets')
    .select('magnific_cookie, magnific_xsrf_token, magnific_user_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (!credsRow?.magnific_cookie || !credsRow?.magnific_user_id) {
    return NextResponse.json(
      {
        error:
          'Credenciais Magnific não configuradas. Vá em /configuracoes/magnific pra configurar.',
      },
      { status: 412 },
    );
  }
  const creds: MagnificCreds = {
    cookie: credsRow.magnific_cookie,
    xsrfToken: credsRow.magnific_xsrf_token || '',
    userId: credsRow.magnific_user_id,
  };

  // Processa em paralelo limitado por concurrency
  const results: TakeResult[] = takes.map((t, i) => ({
    idx: i + 1,
    imagePrompt: t.imagePrompt,
    videoPrompt: t.videoPrompt || '',
  }));

  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= takes.length) break;
      const take = takes[i];
      const t0 = Date.now();
      try {
        const pair = await generateBrollPair(
          creds,
          take.imagePrompt,
          take.videoPrompt || take.imagePrompt,
        );
        results[i].imageUrl = pair.image.url;
        results[i].videoUrl = pair.video.url;
        results[i].imageMs = pair.image.metadata?.elapsedTime as number | undefined;
        results[i].videoMs = pair.video.metadata?.elapsedTime as number | undefined;
      } catch (e) {
        results[i].error = e instanceof Error ? e.message : String(e);
        results[i].imageMs = Date.now() - t0;
      }
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, takes.length) }, () =>
    worker(),
  );
  await Promise.all(workers);

  return NextResponse.json({
    total: takes.length,
    success: results.filter((r) => r.videoUrl).length,
    failed: results.filter((r) => r.error).length,
    results,
  });
}
