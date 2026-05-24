import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

type CookieToSet = { name: string; value: string; options: CookieOptions };

/**
 * Roteamento + autenticação + tier gating.
 *
 *   /login              → público
 *   /register           → público (cadastro aberto pro tier 'free')
 *   /verify, /forgot-password → desabilitados (redirect /login)
 *   /                   → público (landing)
 *
 *  Após login:
 *    • tier='admin' → acessa tudo
 *    • tier='beta'  → acessa tudo (exceto rotas admin-only)
 *    • tier='free'  → SÓ /tools (hub) + /tools/decupagem + /configuracoes.
 *                     Tudo o mais redireciona pra /tools?locked=1.
 *                     Dentro de /tools/decupagem, a opção "vídeo" é
 *                     desabilitada na UI (e o backend também filtra).
 */

const PUBLIC_AUTH_ROUTES = [
  '/login',
  '/register',
  '/verify',           // OTP code entry (signup + recovery)
  '/verify-phone',
  '/access-revoked',
  '/forgot-password',  // esqueci a senha (envia código por email)
  '/reset-password',   // entra código + nova senha
  '/auth',
  '/trocar-senha',
];
const DISABLED_AUTH_ROUTES: string[] = [];

// Rotas que o tier 'free' PODE acessar
const FREE_ALLOWED_PREFIXES = [
  '/tools', // só o hub exato é livre — abaixo filtramos ferramentas
  '/configuracoes',
  '/trocar-senha',
];

// Ferramentas específicas liberadas pro 'free'
const FREE_ALLOWED_TOOLS = ['/tools/decupagem', '/tools/downloader'];
// Outras rotas (não-/tools) que free pode ver (educacionais/comerciais)
const FREE_EXTRA_OK_PREFIXES = ['/pilot', '/planos'];

// Ferramentas que SÓ Pro/Admin acessam — Basic é bloqueado nelas
const PRO_ONLY_TOOLS = [
  '/tools/auto-broll',
  '/tools/troca-produto',
  '/tools/heygen-auto',
  '/tools/decupagem-copy',     // Smart Decup
  '/tools/clickup-pilot',
  '/tools/remover-elementos',  // Smart Remover (legenda + marca d'água)
];

// Rotas exclusivamente do admin (mesmo beta não acessa)
const ADMIN_ONLY_PREFIXES = [
  '/admin',
  '/tools/ltx-video',
  '/tools/points', // sistema de pontos é interno
];

export async function updateSession(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith('/api/')) {
    const originGuard = checkOrigin(request);
    if (originGuard) return originGuard;
  }

  if (DISABLED_AUTH_ROUTES.some((p) => pathname.startsWith(p))) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }: CookieToSet) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }: CookieToSet) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublicRoute =
    PUBLIC_AUTH_ROUTES.some((p) => pathname.startsWith(p)) ||
    pathname === '/' ||
    pathname.startsWith('/planos') ||
    pathname.startsWith('/api/');

  if (!user && !isPublicRoute) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  if (user && pathname.startsWith('/login')) {
    const url = request.nextUrl.clone();
    url.pathname = '/tools';
    return NextResponse.redirect(url);
  }

  if (user && pathname.startsWith('/register')) {
    // Já logado tentando se cadastrar de novo → vai pra tools
    const url = request.nextUrl.clone();
    url.pathname = '/tools';
    return NextResponse.redirect(url);
  }

  if (
    user &&
    (pathname.startsWith('/tools') ||
      pathname.startsWith('/configuracoes') ||
      pathname.startsWith('/admin') ||
      pathname.startsWith('/trocar-senha'))
  ) {
    const adminClient = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { cookies: { getAll: () => [], setAll: () => {} } },
    );

    // Tentativa 1: select completo (com phone_verified/legacy_no_phone/tier)
    // Se a migration 015 ainda não rodou, a coluna não existe — fazemos
    // fallback pro select básico pra não quebrar o login do admin.
    type ProfileShape = {
      is_active: boolean | null;
      is_admin: boolean | null;
      must_change_password: boolean | null;
      tier?: 'free' | 'beta' | 'admin' | null;
      phone_verified?: boolean | null;
      legacy_no_phone?: boolean | null;
    };
    let profile: ProfileShape | null = null;

    const full = await adminClient
      .from('profiles')
      .select(
        'is_active, is_admin, must_change_password, tier, phone_verified, legacy_no_phone',
      )
      .eq('id', user.id)
      .maybeSingle();

    if (full.error) {
      // Coluna ausente → cai pro select legado (assume tudo verificado)
      const fallback = await adminClient
        .from('profiles')
        .select('is_active, is_admin, must_change_password')
        .eq('id', user.id)
        .maybeSingle();
      profile = (fallback.data ?? null) as unknown as ProfileShape | null;
    } else {
      profile = (full.data ?? null) as unknown as ProfileShape | null;
    }

    const isActive = profile?.is_active === true;
    const isAdmin = profile?.is_admin === true;
    const mustChangePw = profile?.must_change_password === true;
    // Tier — normaliza: beta legado vira pro
    const rawTier = (profile?.tier ?? '') as string;
    let tier: 'free' | 'basic' | 'pro' | 'admin';
    if (isAdmin) tier = 'admin';
    else if (rawTier === 'pro' || rawTier === 'beta') tier = 'pro';
    else if (rawTier === 'basic') tier = 'basic';
    else if (rawTier === 'free') tier = 'free';
    else tier = isActive ? 'free' : 'free';

    // ─── ADMIN BYPASS ─────────────────────────────────────────────────
    // Admin nunca precisa de phone_verified. Se a coluna phone_verified
    // for undefined (migration não rodou), também consideramos verificado
    // pra não bloquear ninguém retroativamente.
    //
    // SMS_REQUIRED (env): default 'false' enquanto não houver Twilio
    // configurado. Quando setar `SMS_REQUIRED=1` na Vercel, a verificação
    // volta a ser obrigatória pra novos cadastros — admin sempre passa.
    const smsRequired = process.env.SMS_REQUIRED === '1';
    const phoneVerified =
      !smsRequired ||
      isAdmin ||
      profile?.phone_verified === true ||
      profile?.legacy_no_phone === true ||
      // Coluna ausente (signal: ambos undefined) → trata como verificado
      (profile?.phone_verified === undefined &&
        profile?.legacy_no_phone === undefined);

    if (!isActive) {
      await supabase.auth.signOut();
      const url = request.nextUrl.clone();
      url.pathname = '/access-revoked';
      return NextResponse.redirect(url);
    }

    if (mustChangePw && !pathname.startsWith('/trocar-senha')) {
      const url = request.nextUrl.clone();
      url.pathname = '/trocar-senha';
      return NextResponse.redirect(url);
    }
    if (!mustChangePw && pathname.startsWith('/trocar-senha')) {
      const url = request.nextUrl.clone();
      url.pathname = '/tools';
      return NextResponse.redirect(url);
    }

    // Phone obrigatório: usuário precisa verificar antes de acessar tools
    // (admin sempre passa via isAdmin bypass acima)
    if (!phoneVerified && !pathname.startsWith('/verify-phone')) {
      const url = request.nextUrl.clone();
      url.pathname = '/verify-phone';
      return NextResponse.redirect(url);
    }
    if (phoneVerified && pathname.startsWith('/verify-phone')) {
      const url = request.nextUrl.clone();
      url.pathname = '/tools';
      return NextResponse.redirect(url);
    }

    // Helper local: monta o redirect pra /tools com info de qual rota
    // foi bloqueada + qual tier era necessário (UX no LockedFlash).
    function lockedRedirect(needTier: 'basic' | 'pro' | 'admin') {
      const url = request.nextUrl.clone();
      url.pathname = '/tools';
      url.searchParams.set('locked', '1');
      url.searchParams.set('from', pathname);
      url.searchParams.set('need', needTier);
      return NextResponse.redirect(url);
    }

    // ─── Bloqueio admin-only (mesmo beta não acessa) ───
    if (ADMIN_ONLY_PREFIXES.some((p) => pathname.startsWith(p))) {
      if (!isAdmin) {
        return lockedRedirect('admin');
      }
    }

    // ─── Bloqueio pro tier 'free' ───
    if (tier === 'free') {
      const isHubExact = pathname === '/tools';
      const isAllowedTool = FREE_ALLOWED_TOOLS.some(
        (p) => pathname === p || pathname.startsWith(p + '/'),
      );
      const isAllowedPrefix = FREE_ALLOWED_PREFIXES.some((p) =>
        pathname.startsWith(p),
      );
      const isExtraOk = FREE_EXTRA_OK_PREFIXES.some((p) =>
        pathname.startsWith(p),
      );
      const isTool = pathname.startsWith('/tools/');
      const isProOnly = PRO_ONLY_TOOLS.some(
        (p) => pathname === p || pathname.startsWith(p + '/'),
      );

      if (isTool && !isAllowedTool) {
        // Free tentando acessar tool → se é Pro-only mostra "Pro",
        // senão "Basic" (basic libera quase tudo)
        return lockedRedirect(isProOnly ? 'pro' : 'basic');
      }
      if (!isHubExact && !isAllowedPrefix && !isExtraOk) {
        return lockedRedirect('basic');
      }
    }

    // ─── Bloqueio pro tier 'basic' (acessa quase tudo, exceto IA premium) ───
    if (tier === 'basic') {
      const isProOnly = PRO_ONLY_TOOLS.some(
        (p) => pathname === p || pathname.startsWith(p + '/'),
      );
      if (isProOnly) {
        return lockedRedirect('pro');
      }
    }
  }

  return supabaseResponse;
}

function checkOrigin(request: NextRequest): NextResponse | null {
  const allowedOrigin = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '');
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const host = request.headers.get('host');
  const proto = request.headers.get('x-forwarded-proto') || 'https';
  const selfOrigin = host ? `${proto}://${host}` : null;

  if (!origin && !referer) return null;

  const candidate = origin || (referer ? new URL(referer).origin : null);
  if (!candidate) return null;

  const isAllowed =
    candidate === selfOrigin ||
    (allowedOrigin && candidate === allowedOrigin) ||
    candidate.endsWith('.vercel.app');

  if (!isAllowed) {
    return new NextResponse(
      JSON.stringify({
        error: 'Origin nao autorizado.',
        origin: candidate,
      }),
      {
        status: 403,
        headers: { 'content-type': 'application/json' },
      },
    );
  }

  return null;
}
