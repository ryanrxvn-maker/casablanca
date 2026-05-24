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
import { encryptSecret } from '@/lib/secrets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * CORS helper: a extensão Freepik Sync chama esse endpoint do origin
 * `chrome-extension://<id>` com `credentials: 'include'`. Precisamos:
 *  - Echar Access-Control-Allow-Origin com o origin exato (não *) pra
 *    poder usar Allow-Credentials.
 *  - Allow-Credentials: true pra o cookie supabase-auth-token passar.
 */
function corsHeaders(req: NextRequest): Record<string, string> {
  const origin = req.headers.get('origin') || '';
  const isExt = origin.startsWith('chrome-extension://') || origin.startsWith('moz-extension://');
  if (!isExt) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

/**
 * GET — retorna status atual sem expor cookies em plaintext.
 * Resposta: { configured, magnificUserId, plan, updatedAt }
 */
export async function GET(req: NextRequest) {
  const cors = corsHeaders(req);
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401, headers: cors });
  }
  const { data: row } = await supabase
    .from('user_secrets')
    .select('magnific_user_id, magnific_plan, magnific_updated_at, magnific_cookie')
    .eq('user_id', userData.user.id)
    .maybeSingle();
  return NextResponse.json({
    configured: !!row?.magnific_cookie,
    magnificUserId: row?.magnific_user_id ?? null,
    plan: row?.magnific_plan ?? null,
    updatedAt: row?.magnific_updated_at ?? null,
  }, { headers: cors });
}

/**
 * DELETE — remove credenciais.
 */
export async function DELETE(req: NextRequest) {
  const cors = corsHeaders(req);
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401, headers: cors });
  }
  const { error } = await supabase
    .from('user_secrets')
    .update({
      magnific_cookie: null,
      magnific_xsrf_token: null,
      magnific_user_id: null,
      magnific_plan: null,
      magnific_updated_at: null,
    })
    .eq('user_id', userData.user.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500, headers: cors });
  }
  return NextResponse.json({ ok: true }, { headers: cors });
}

export async function POST(req: NextRequest) {
  const cors = corsHeaders(req);
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401, headers: cors });
  }
  const userId = userData.user.id;

  let body: { cookie?: string; xsrfToken?: string; userId?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400, headers: cors });
  }
  if (!body.cookie || !body.xsrfToken) {
    return NextResponse.json(
      { error: 'Faltam campos: cookie, xsrfToken' },
      { status: 400, headers: cors },
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
      { status: 401, headers: cors },
    );
  }

  // Persist no DB com cifragem AES-256-GCM.
  // Cookie + XSRF nunca ficam em plaintext no Postgres.
  let cipherCookie: string;
  let cipherXsrf: string;
  try {
    cipherCookie = encryptSecret(body.cookie);
    cipherXsrf = encryptSecret(body.xsrfToken);
  } catch (e) {
    return NextResponse.json(
      {
        error:
          'Falha ao cifrar credenciais (SECRETS_ENCRYPTION_KEY ausente?): ' +
          (e instanceof Error ? e.message : String(e)),
      },
      { status: 500, headers: cors },
    );
  }

  const { error: upsertErr } = await supabase.from('user_secrets').upsert({
    user_id: userId,
    magnific_cookie: cipherCookie,
    magnific_xsrf_token: cipherXsrf,
    magnific_user_id: magnificUserId,
    magnific_plan: plan ?? null,
    magnific_updated_at: new Date().toISOString(),
  });
  if (upsertErr) {
    return NextResponse.json(
      { error: 'Falha ao persistir: ' + upsertErr.message },
      { status: 500, headers: cors },
    );
  }

  return NextResponse.json({
    ok: true,
    magnificUserId,
    plan: plan || 'desconhecido',
    credits: credits ?? null,
  }, { headers: cors });
}
