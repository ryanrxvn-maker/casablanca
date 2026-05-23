import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { EmailOtpType } from '@supabase/supabase-js';

/**
 * /auth/confirm — fluxo OTP-link (token_hash) compatível com o template
 * "moderno" do Supabase (`{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type={{ .Type }}&next={{ .RedirectTo }}`).
 *
 * Diferente do /auth/callback (que usa PKCE `code` + verifier no browser
 * que iniciou o signup), este flow funciona MESMO se o user clicar no
 * link em outro device/browser — token_hash é self-contained.
 *
 * Aceita `type` = signup | email | recovery | invite | email_change.
 *
 * Em caso de falha (token expirado/inválido) → redireciona pra /auth/error
 * com ?reason=... pra o user ver o motivo + reenviar.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get('token_hash');
  const type = (searchParams.get('type') ?? 'email') as EmailOtpType;
  const code = searchParams.get('code'); // fallback se Supabase enviou PKCE
  const next = searchParams.get('next') ?? '/tools';

  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/tools';

  const supabase = createClient();

  // Caminho A: token_hash (recomendado — funciona cross-device)
  if (tokenHash) {
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (!error) {
      await ensureProfile(supabase);
      return NextResponse.redirect(`${origin}${safeNext}`);
    }
    return NextResponse.redirect(
      `${origin}/auth/error?reason=${encodeURIComponent(error.message)}&code=token_hash_invalid`,
    );
  }

  // Caminho B: code (PKCE) — só funciona se verifier estiver presente
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      await ensureProfile(supabase);
      return NextResponse.redirect(`${origin}${safeNext}`);
    }
    return NextResponse.redirect(
      `${origin}/auth/error?reason=${encodeURIComponent(error.message)}&code=pkce_failed`,
    );
  }

  return NextResponse.redirect(`${origin}/auth/error?code=missing_params`);
}

/**
 * Garante row em `profiles` pra novos usuários — copia name/phone do
 * user_metadata se ainda não houver row.
 */
async function ensureProfile(
  supabase: ReturnType<typeof createClient>,
): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  const user = u?.user;
  if (!user) return;
  const { data: existing } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', user.id)
    .maybeSingle();
  if (existing) return;
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const name =
    (meta.full_name as string | undefined) ??
    (meta.name as string | undefined) ??
    (user.email ? user.email.split('@')[0] : 'Editor');
  const phone = (meta.phone as string | undefined) ?? null;
  const avatar =
    (meta.avatar_url as string | undefined) ??
    (meta.picture as string | undefined) ??
    null;
  await supabase.from('profiles').upsert({
    id: user.id,
    name,
    phone,
    whatsapp: phone,
    avatar_url: avatar,
  });
}
