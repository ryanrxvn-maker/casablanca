import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { isPaidExpired, isPaymentBlocked } from '@/lib/plan-prices';
import { isToolInMaintenance, canBypassMaintenance } from '@/lib/maintenance';
import { emailUnlocksPath, pathUnlockedByList } from '@/lib/tool-unlocks';

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
const FREE_ALLOWED_TOOLS = [
  '/tools/decupagem',
  '/tools/downloader',
  '/tools/caixinha-pergunta',
  '/tools/fakepass',
  '/tools/compressor',
  '/tools/historico', // histórico geral — todo tier vê o próprio trabalho
];
// Outras rotas (não-/tools) que free pode ver (educacionais/comerciais)
const FREE_EXTRA_OK_PREFIXES = ['/planos'];

// Ferramentas que SÓ Premium (tier interno 'basic') ou acima acessam —
// free é mandado direto pra /planos ao tentar abrir
const PREMIUM_ONLY_TOOLS = [
  '/tools/decupagem-copy',     // Decupagem Inteligente
  '/tools/lipsync',            // Lipsync Video to Video
];

// Rotas exclusivamente do admin (mesmo Pro legado não acessa)
const ADMIN_ONLY_PREFIXES = [
  '/admin',
  '/tools/ltx-video',
  '/tools/points', // sistema de pontos é interno
  '/tools/normalizador',      // uso interno — some pra conta não-admin
  '/tools/separador-audio',   // uso interno — some pra conta não-admin
  '/tools/remover-elementos', // Smart Remover (legenda + marca d'água) — admin-only
  '/tools/auto-broll',        // uso interno — some pra conta não-admin
  '/tools/heygen-auto',       // uso interno — some pra conta não-admin
  '/tools/clickup-pilot',     // uso interno — some pra conta não-admin
  '/tools/tipografia',        // Tipografia Automática — admin-only até liberar

  '/tools/background',        // viewer da fila do Pilot — uso interno
  '/tools/lipsync-history',   // histórico dos batches Pilot/VA — uso interno
  '/pilot',                   // página de pitch do Pilot — uso interno
  '/configuracoes/clickup-pilot',
  '/configuracoes/magnific',
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

  // Copia os cookies de sessão (incl. refresh) pro response de um redirect.
  // Sem isso, quando a sessão é renovada E ocorre um redirect, os cookies
  // novos são perdidos → usuário desloga sozinho (bug clássico @supabase/ssr).
  const redir = (url: URL): NextResponse => {
    const res = NextResponse.redirect(url);
    supabaseResponse.cookies.getAll().forEach((c) => res.cookies.set(c));
    return res;
  };

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
    pathname.startsWith('/termos') ||
    pathname.startsWith('/politica') ||
    pathname.startsWith('/recursos') ||
    // Arquivos de SEO — devem ser servidos pra crawlers anônimos.
    pathname === '/robots.txt' ||
    pathname === '/sitemap.xml' ||
    pathname === '/llms.txt' ||
    pathname.startsWith('/opengraph-image') ||
    pathname.startsWith('/api/');

  if (!user && !isPublicRoute) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return redir(url);
  }

  if (user && pathname.startsWith('/login')) {
    const url = request.nextUrl.clone();
    url.pathname = '/tools';
    return redir(url);
  }

  if (user && pathname.startsWith('/register')) {
    // Já logado tentando se cadastrar de novo → vai pra tools
    const url = request.nextUrl.clone();
    url.pathname = '/tools';
    return redir(url);
  }

  if (
    user &&
    (pathname.startsWith('/tools') ||
      pathname.startsWith('/configuracoes') ||
      pathname.startsWith('/admin') ||
      pathname.startsWith('/pilot') ||
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
      subscription_status?: string | null;
      current_period_end?: string | null;
      tool_unlocks?: string[] | null;
    };
    let profile: ProfileShape | null = null;

    const full = await adminClient
      .from('profiles')
      .select(
        'is_active, is_admin, must_change_password, tier, phone_verified, legacy_no_phone, subscription_status, current_period_end, tool_unlocks',
      )
      .eq('id', user.id)
      .maybeSingle();

    if (full.error) {
      // tool_unlocks ausente (migration 028 não rodou) → tenta o select
      // completo SEM ela — preserva tier/assinatura/phone.
      const noUnlocks = await adminClient
        .from('profiles')
        .select(
          'is_active, is_admin, must_change_password, tier, phone_verified, legacy_no_phone, subscription_status, current_period_end',
        )
        .eq('id', user.id)
        .maybeSingle();
      if (noUnlocks.error) {
        // Coluna ausente → cai pro select legado (assume tudo verificado)
        const fallback = await adminClient
          .from('profiles')
          .select('is_active, is_admin, must_change_password')
          .eq('id', user.id)
          .maybeSingle();
        profile = (fallback.data ?? null) as unknown as ProfileShape | null;
      } else {
        profile = (noUnlocks.data ?? null) as unknown as ProfileShape | null;
      }
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

    // Acesso pago vencido → cai pra free (admin nunca expira).
    if (
      !isAdmin &&
      isPaidExpired(profile?.subscription_status, profile?.current_period_end)
    ) {
      tier = 'free';
    }

    // Renovação tentada e NÃO paga (past_due/unpaid) → acesso SUSPENSO na
    // hora, até o cliente resolver o pagamento na tela de assinatura.
    if (!isAdmin && isPaymentBlocked(profile?.subscription_status)) {
      tier = 'free';
    }

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
      return redir(url);
    }

    if (mustChangePw && !pathname.startsWith('/trocar-senha')) {
      const url = request.nextUrl.clone();
      url.pathname = '/trocar-senha';
      return redir(url);
    }
    if (!mustChangePw && pathname.startsWith('/trocar-senha')) {
      const url = request.nextUrl.clone();
      url.pathname = '/tools';
      return redir(url);
    }

    // Phone obrigatório: usuário precisa verificar antes de acessar tools
    // (admin sempre passa via isAdmin bypass acima)
    if (!phoneVerified && !pathname.startsWith('/verify-phone')) {
      const url = request.nextUrl.clone();
      url.pathname = '/verify-phone';
      return redir(url);
    }
    if (phoneVerified && pathname.startsWith('/verify-phone')) {
      const url = request.nextUrl.clone();
      url.pathname = '/tools';
      return redir(url);
    }

    // Helper local: monta o redirect pra /tools com info de qual rota
    // foi bloqueada + qual tier era necessário (UX no LockedFlash).
    function lockedRedirect(needTier: 'basic' | 'pro' | 'admin') {
      const url = request.nextUrl.clone();
      url.pathname = '/tools';
      url.searchParams.set('locked', '1');
      url.searchParams.set('from', pathname);
      url.searchParams.set('need', needTier);
      return redir(url);
    }

    // Tentou abrir ferramenta Premium sem ter o plano → manda DIRETO pra
    // /planos pra fazer upgrade (sem furo: o gating é server-side, aqui).
    function planosRedirect() {
      const url = request.nextUrl.clone();
      url.pathname = '/planos';
      url.searchParams.set('upgrade', 'premium');
      url.searchParams.set('from', pathname);
      return redir(url);
    }

    // Desbloqueio pontual (BETA PRO): banco (profiles.tool_unlocks, via
    // painel /admin) OU email fixo (lib/tool-unlocks.ts).
    const hasUnlock = (path: string) =>
      pathUnlockedByList(profile?.tool_unlocks, path) ||
      emailUnlocksPath(user.email, path);

    // ─── Bloqueio admin-only (mesmo beta não acessa) ───
    // Exceção: contas com desbloqueio pontual de ferramenta interna
    // passam SÓ nos paths desbloqueados.
    if (ADMIN_ONLY_PREFIXES.some((p) => pathname.startsWith(p))) {
      if (!isAdmin && !hasUnlock(pathname)) {
        return lockedRedirect('admin');
      }
    }

    // ─── Bloqueio pro tier 'free' ───
    if (tier === 'free') {
      const isHubExact = pathname === '/tools';
      const isAllowedTool =
        FREE_ALLOWED_TOOLS.some(
          (p) => pathname === p || pathname.startsWith(p + '/'),
        ) || hasUnlock(pathname);
      const isAllowedPrefix = FREE_ALLOWED_PREFIXES.some((p) =>
        pathname.startsWith(p),
      );
      const isExtraOk = FREE_EXTRA_OK_PREFIXES.some((p) =>
        pathname.startsWith(p),
      );
      const isTool = pathname.startsWith('/tools/');
      const isPremiumOnly = PREMIUM_ONLY_TOOLS.some(
        (p) => pathname === p || pathname.startsWith(p + '/'),
      );

      if (isTool && !isAllowedTool) {
        // Free tentando acessar tool Premium → vai DIRETO pra /planos.
        // Tool de outro tier → flash de upgrade pro Premium.
        return isPremiumOnly ? planosRedirect() : lockedRedirect('basic');
      }
      if (!isHubExact && !isAllowedPrefix && !isExtraOk) {
        return lockedRedirect('basic');
      }
    }

    // ─── MANUTENÇÃO (depois do gate de tier) ─────────────────────────
    // Quem chega aqui numa ferramenta em manutenção é Pro/Admin. Bloqueia
    // TODOS menos admin e emails do allowlist (clientes de confiança, ex.:
    // Elder). Free/Basic já foram pra /planos acima. Defesa real server-side.
    if (!isAdmin && !canBypassMaintenance(user.email) && isToolInMaintenance(pathname)) {
      const url = request.nextUrl.clone();
      url.pathname = '/tools';
      url.searchParams.set('maintenance', '1');
      url.searchParams.set('from', pathname);
      return redir(url);
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

  // Sem Origin NEM Referer: same-origin GETs, navegações diretas e clientes
  // server-to-server (webhook do Stripe, CLI). Fail-OPEN é seguro pra métodos
  // SAFE. Pra métodos que MUTAM estado, fail-CLOSED — exceto os callers sem
  // browser reconhecidos por header próprio (assinatura do Stripe / chave do
  // CLI). Browser sempre manda Origin em POST/PUT/PATCH/DELETE, então usuário
  // legítimo não é afetado; isso só fecha o CSRF fail-open (defesa a mais além
  // do SameSite=Lax do cookie do Supabase).
  if (!origin && !referer) {
    const method = request.method.toUpperCase();
    const isSafe = method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
    if (isSafe) return null;
    const isTrustedMachine =
      !!request.headers.get('stripe-signature') ||
      !!request.headers.get('x-autoedit-key');
    if (isTrustedMachine) return null;
    return new NextResponse(
      JSON.stringify({ error: 'Origin ausente em requisição de escrita.' }),
      { status: 403, headers: { 'content-type': 'application/json' } },
    );
  }

  const candidate = origin || (referer ? new URL(referer).origin : null);
  if (!candidate) return null;

  // Browser extensions (Chrome/Firefox) podem chamar a API — usadas pra
  // sincronizar cookies de magnific.com com /api/auto-broll-v2/save-creds.
  // Não há como saber o ID exato da extensão antes do publish, então
  // confiamos no protocolo + na autenticação Supabase do endpoint.
  const isBrowserExtension =
    candidate.startsWith('chrome-extension://') ||
    candidate.startsWith('moz-extension://') ||
    candidate.startsWith('safari-web-extension://');

  const isAllowed =
    candidate === selfOrigin ||
    (allowedOrigin && candidate === allowedOrigin) ||
    isBrowserExtension;

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
