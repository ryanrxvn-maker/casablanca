import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

type CookieToSet = { name: string; value: string; options: CookieOptions };

const PUBLIC_AUTH_ROUTES = [
  '/login',
  '/access-revoked',
  '/auth',
  '/trocar-senha',
];
const DISABLED_AUTH_ROUTES = ['/register', '/forgot-password', '/verify'];

export async function updateSession(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith('/api/')) {
    const originGuard = checkOrigin(request);
    if (originGuard) return originGuard;
  }

  if (DISABLED_AUTH_ROUTES.some((p) => pathname.startsWith(p))) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('beta', 'closed');
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
      .select('is_active, is_admin, must_change_password')
      .eq('id', user.id)
      .maybeSingle();

    const isActive = profile?.is_active === true;
    const isAdmin = profile?.is_admin === true;
    const mustChangePw = profile?.must_change_password === true;

    if (!isActive) {
      await supabase.auth.signOut();
      const url = request.nextUrl.clone();
      url.pathname = '/access-revoked';
      return NextResponse.redirect(url);
    }

    // Senha provisoria: redireciona pra trocar antes de qualquer coisa
    if (mustChangePw && !pathname.startsWith('/trocar-senha')) {
      const url = request.nextUrl.clone();
      url.pathname = '/trocar-senha';
      return NextResponse.redirect(url);
    }

    // Se ja trocou e tenta voltar pra /trocar-senha, manda pra /tools
    if (!mustChangePw && pathname.startsWith('/trocar-senha')) {
      const url = request.nextUrl.clone();
      url.pathname = '/tools';
      return NextResponse.redirect(url);
    }

    if (pathname.startsWith('/admin') && !isAdmin) {
      const url = request.nextUrl.clone();
      url.pathname = '/tools';
      return NextResponse.redirect(url);
    }

    // Mind Ads Suite — so admin acessa por enquanto
    if (pathname.startsWith('/tools/mind-ads') && !isAdmin) {
      const url = request.nextUrl.clone();
      url.pathname = '/tools';
      return NextResponse.redirect(url);
    }

    // LTX-Video 2.3 — só a conta admin
    if (pathname.startsWith('/tools/ltx-video') && !isAdmin) {
      const url = request.nextUrl.clone();
      url.pathname = '/tools';
      return NextResponse.redirect(url);
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
