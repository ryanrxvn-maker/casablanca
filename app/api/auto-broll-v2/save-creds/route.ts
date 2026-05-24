/**
 * POST /api/auto-broll-v2/save-creds
 *
 * Salva credenciais Magnific do user (cookie + XSRF). Roda verifyCredentials
 * primeiro pra validar antes de persistir.
 *
 * Body: { "cookie": "...", "xsrfToken": "...", "userId": number }
 *   OU
 * Body: { "cookie": "...", "xsrfToken": "..." }  ← descobrimos userId via verify
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { verifyCredentials } from '@/lib/magnific-api-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
  }
  const userId = userData.user.id;

  let body: { cookie?: string; xsrfToken?: string; userId?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }
  if (!body.cookie || !body.xsrfToken) {
    return NextResponse.json(
      { error: 'Faltam campos: cookie, xsrfToken' },
      { status: 400 },
    );
  }

  // Descobre userId se não passou (via /auth/verify do Magnific)
  let magnificUserId = body.userId;
  let plan: string | undefined;
  let credits: number | undefined;
  try {
    const v = await verifyCredentials({
      cookie: body.cookie,
      xsrfToken: body.xsrfToken,
      userId: magnificUserId || 0,
    });
    magnificUserId = v.userId;
    plan = v.plan;
    credits = v.credits;
  } catch (e) {
    return NextResponse.json(
      {
        error:
          'Credenciais inválidas no Magnific: ' +
          (e instanceof Error ? e.message : String(e)),
      },
      { status: 401 },
    );
  }

  // Persist no DB
  await supabase.from('user_secrets').upsert({
    user_id: userId,
    magnific_cookie: body.cookie,
    magnific_xsrf_token: body.xsrfToken,
    magnific_user_id: magnificUserId,
    magnific_updated_at: new Date().toISOString(),
  });

  return NextResponse.json({
    ok: true,
    magnificUserId,
    plan: plan || 'desconhecido',
    credits: credits ?? null,
  });
}
