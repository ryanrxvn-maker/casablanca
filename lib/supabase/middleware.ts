import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

type CookieToSet = { name: string; value: string; options: CookieOptions };

/**
 * Middleware unico do app:
 *   - Sessao Supabase em todo request
 *   - Bloqueia rotas privadas pra non-auth
 *   - Bloqueia /tools, /configuracoes pra usuarios com is_active=false
 *   - Bloqueia /admin pra non-admins
 *   - Bloqueia /api/* de origins externos (anti-clone)
 *   - Redireciona signup/forgot-password fechados para /login
 */

const PUBLIC_AUTH_ROUTES = ['/login', '/access-revoked', '/auth'];
const DISABLED_AUTH_ROUTES = ['/register', '/forgot-password', '/verify'];

export async function updateSession(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ===== Anti-clone: origin check em /api/* =====
  // Bloqueia chamadas de API que venham de outro domínio. Aceita:
  //   - same-origin (Origin/Referer batem com host atual)
  //   - origin = NEXT_PUBLIC_SITE_URL (env var configurada)
  //   - sem origin (server-to-server, pode passar)
  if (pathname.startsWith('/api/')) {
    const originGuard = checkOrigin(request);
    if (originGuard) return originGuard;
  }

  // ===== Rotas de auth fechadas (closed beta): redireciona pra /login =====
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

  // Se logado tentando login → vai pro /tools
  if (user && pathname.startsWith('/login')) {
    const url = request.nextUrl.clone();
    url.pathname = '/tools';
    return NextResponse.redirect(url);
  }

  // ===== Validacao is_active + is_admin pra rotas protegidas =====
  if (user && (pathname.startsWith('/tools') || pathname.startsWith('/configuracoes') || pathname.startsWith('/admin'))) {
const adminClient = createServerClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { cookies: { getAll: () => [], setAll: () => {} } }
);

const { data: profile } = await adminClient
  .from('profiles')
  .select('is_active, is_admin')
  .eq('id', user.id)
  .maybeSingle();
    const isActive = profile?.is_active === true;
    const isAdmin = profile?.is_admin === true;

    if (!isActive) {
      // Sign out + manda pra /access-revoked
      await supabase.auth.signOut();
      const url = request.nextUrl.clone();
      url.pathname = '/access-revoked';
      return NextResponse.redirect(url);
    }

    if (pathname.startsWith('/admin') && !isAdmin) {
      const url = request.nextUrl.clone();
      url.pathname = '/tools';
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}

/**
 * Origin check pra todas as rotas /api/*. Bloqueia chamada de origens
 * fora do dominio atual e da NEXT_PUBLIC_SITE_URL configurada.
 * Permite same-origin (Origin === host) e o caso Origin=null (server calls).
 */
function checkOrigin(request: NextRequest): NextResponse | null {
  const allowedOrigin = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '');
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const host = request.headers.get('host');
  const proto = request.headers.get('x-forwarded-proto') || 'https';
  const selfOrigin = host ? `${proto}://${host}` : null;

  // Sem origin nem referer = server-to-server ou navegacao direta. Pode passar.
  if (!origin && !referer) return null;

  const candidate = origin || (referer ? new URL(referer).origin : null);
  if (!candidate) return null;

  const isAllowed =
    candidate === selfOrigin ||
    (allowedOrigin && candidate === allowedOrigin) ||
    candidate.endsWith('.vercel.app'); // permite preview deploys

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
