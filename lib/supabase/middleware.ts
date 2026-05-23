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
  '/verify-phone',
  '/access-revoked',
  '/auth',
  '/trocar-senha',
];
const DISABLED_AUTH_ROUTES = ['/forgot-password', '/verify'];

// Rotas que o tier 'free' PODE acessar
const FREE_ALLOWED_PREFIXES = [
  '/tools', // só o hub exato é livre — abaixo filtramos ferramentas
  '/configuracoes',
  '/trocar-senha',
];

// Ferramentas específicas liberadas pro 'free'
const FREE_ALLOWED_TOOLS = ['/tools/decupagem', '/tools/downloader'];

// Rotas exclusivamente do admin (mesmo beta não acessa)
const ADMIN_ONLY_PREFIXES = [
  '/admin',
  '/tools/mind-ads',
  '/tools/ltx-video',
  '/tools/remover-elementos',
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

    const { data: profile } = await adminClient
      .from('profiles')
      .select(
        'is_active, is_admin, must_change_password, tier, phone_verified, legacy_no_phone',
      )
      .eq('id', user.id)
      .maybeSingle();

    const isActive = profile?.is_active === true;
    const isAdmin = profile?.is_admin === true;
    const mustChangePw = profile?.must_change_password === true;
    const tier: 'free' | 'beta' | 'admin' =
      (profile?.tier as 'free' | 'beta' | 'admin' | undefined) ??
      (isAdmin ? 'admin' : isActive ? 'beta' : 'free');
    // Phone verified — usuários legacy (sem coluna phone) ficam dispensados.
    const phoneVerified =
      profile?.phone_verified === true || profile?.legacy_no_phone === true;

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

    // ─── Bloqueio admin-only (mesmo beta não acessa) ───
    if (ADMIN_ONLY_PREFIXES.some((p) => pathname.startsWith(p))) {
      if (!isAdmin) {
        const url = request.nextUrl.clone();
        url.pathname = '/tools';
        url.searchParams.set('locked', '1');
        return NextResponse.redirect(url);
      }
    }

    // ─── Bloqueio pro tier 'free' ───
    if (tier === 'free') {
      // Permitido: /tools (hub exato), /configuracoes/*, /trocar-senha,
      // e a ferramenta /tools/decupagem
      const isHubExact = pathname === '/tools';
      const isAllowedTool = FREE_ALLOWED_TOOLS.some(
        (p) => pathname === p || pathname.startsWith(p + '/'),
      );
      const isAllowedPrefix = FREE_ALLOWED_PREFIXES.some((p) =>
        pathname.startsWith(p),
      );
      const isTool = pathname.startsWith('/tools/');

      // Se é ferramenta mas não está na whitelist do free → bloqueia
      if (isTool && !isAllowedTool) {
        const url = request.nextUrl.clone();
        url.pathname = '/tools';
        url.searchParams.set('locked', '1');
        return NextResponse.redirect(url);
      }

      // Outras rotas fora dos prefixos permitidos
      if (!isHubExact && !isAllowedPrefix) {
        const url = request.nextUrl.clone();
        url.pathname = '/tools';
        url.searchParams.set('locked', '1');
        return NextResponse.redirect(url);
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
