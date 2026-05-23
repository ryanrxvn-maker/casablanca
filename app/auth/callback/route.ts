import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { EmailOtpType } from '@supabase/supabase-js';

/**
 * OAuth + email-link callback.
 *
 * Aceita 3 formatos de link:
 *   1. `?code=XYZ` (PKCE) — login OAuth e signup com template antigo.
 *      Precisa do code_verifier no MESMO browser que iniciou.
 *   2. `?token_hash=XYZ&type=signup|email|...` (newer email template).
 *      Self-contained — funciona cross-device.
 *   3. `#access_token=...&refresh_token=...` (implicit fragment) — não
 *      é processável no server (fragment não chega ao backend); o user
 *      será redirecionado pra /tools e o browser pega a sessão via JS.
 *
 * Em caso de erro → redireciona pra /auth/error com motivo + flag pra
 * o user pedir um novo link.
 *
 * Para login via Google, o Supabase ja valida o email pelo provider,
 * entao nao exigimos o codigo OTP adicional. Se o profile ainda nao
 * existir, cria com nome vindo do user_metadata.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const tokenHash = searchParams.get('token_hash');
  const type = (searchParams.get('type') ?? 'email') as EmailOtpType;
  const rawNext = searchParams.get('next') ?? '/tools';
  const errorParam = searchParams.get('error');
  const errorDesc = searchParams.get('error_description');

  // Sanitiza `next` pra evitar open-redirect (só caminhos relativos OK)
  const safeNext =
    rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/tools';

  // Supabase pode redirecionar pra cá com erro no querystring (link
  // expirado, já usado, etc) — passa direto pra página de erro.
  if (errorParam) {
    const reason = errorDesc || errorParam;
    return NextResponse.redirect(
      `${origin}/auth/error?reason=${encodeURIComponent(reason)}&code=${encodeURIComponent(errorParam)}`,
    );
  }

  const supabase = createClient();

  // Caminho 1: token_hash (cross-device, funciona em qualquer browser)
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
      `${origin}/auth/error?reason=${encodeURIComponent(error.message)}&code=token_hash_failed`,
    );
  }

  // Caminho 2: code (PKCE) — precisa do verifier no mesmo device
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      await ensureProfile(supabase);
      return NextResponse.redirect(`${origin}${safeNext}`);
    }
    // Erro mais comum aqui: PKCE verifier ausente (user clicou o link
    // num browser diferente do que fez o signup).
    return NextResponse.redirect(
      `${origin}/auth/error?reason=${encodeURIComponent(error.message)}&code=pkce_failed`,
    );
  }

  // Caminho 3: sem code/token — fragment-only ou link bugado.
  // Redireciona pra /tools — se houver fragment com access_token, o
  // browser-side Supabase pega via storage e segue a sessão.
  return NextResponse.redirect(`${origin}${safeNext}`);
}

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
  const avatar =
    (meta.avatar_url as string | undefined) ??
    (meta.picture as string | undefined) ??
    null;
  const phone = (meta.phone as string | undefined) ?? null;
  await supabase.from('profiles').upsert({
    id: user.id,
    name,
    avatar_url: avatar,
    phone,
    whatsapp: phone,
  });
}
