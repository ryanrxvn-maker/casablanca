'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { DarkoLogo } from './DarkoLogo';

type Profile = {
  name: string | null;
  avatar_url: string | null;
  is_admin: boolean;
  tier: 'free' | 'basic' | 'pro' | 'admin' | null;
};

type NavItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
  match?: (path: string) => boolean;
};

type NavSection = {
  label: string;
  items: NavItem[];
};

/**
 * Sidebar v4 — categorias visuais.
 *
 * Estrutura:
 *   ┌─────────────┐
 *   │   [Logo]    │
 *   ├─────────────┤
 *   │  NAVEGAR    │  ← label de categoria
 *   │  Início     │
 *   ├─────────────┤
 *   │ FERRAMENTAS │  ← label de categoria
 *   │  Base       │
 *   │  IA         │
 *   │  Pontos     │
 *   └─────────────┘
 *           ↓
 *      [avatar S]   ← clica aqui pra Conta/Admin/Sair
 *
 * Conta e Admin foram removidos da nav principal — só aparecem no
 * dropdown ao clicar no avatar do rodapé.
 */
export function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [avatarBroken, setAvatarBroken] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function fetchProfile() {
      const supabase = createClient();
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) return;
      // Tenta select com tier; se a coluna não existir, cai pro select básico.
      type RowShape = {
        name?: string | null;
        avatar_url?: string | null;
        is_admin?: boolean | null;
        tier?: string | null;
      };
      let row: RowShape | null = null;
      const full = await supabase
        .from('profiles')
        .select('name, avatar_url, is_admin, tier')
        .eq('id', uid)
        .maybeSingle();
      if (full.error) {
        const basic = await supabase
          .from('profiles')
          .select('name, avatar_url, is_admin')
          .eq('id', uid)
          .maybeSingle();
        row = (basic.data ?? null) as unknown as RowShape | null;
      } else {
        row = (full.data ?? null) as unknown as RowShape | null;
      }
      const data = row;
      if (!cancelled) {
        const rawTier = (data?.tier ?? '') as string;
        let resolvedTier: 'free' | 'basic' | 'pro' | 'admin' = 'free';
        // PRIORIDADE: is_admin sempre ganha
        if (data?.is_admin) resolvedTier = 'admin';
        else if (rawTier === 'pro' || rawTier === 'beta') resolvedTier = 'pro';
        else if (rawTier === 'basic') resolvedTier = 'basic';
        else if (rawTier === 'free') resolvedTier = 'free';
        setProfile({
          name: data?.name ?? null,
          avatar_url: data?.avatar_url ?? null,
          is_admin: !!data?.is_admin,
          tier: resolvedTier,
        });
        setAvatarBroken(false);
      }
    }
    fetchProfile();
    function onUpd() {
      fetchProfile();
    }
    window.addEventListener('darko:profile-updated', onUpd);
    return () => {
      cancelled = true;
      window.removeEventListener('darko:profile-updated', onUpd);
    };
  }, []);

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace('/login');
    router.refresh();
  }

  const displayName = profile?.name?.trim() || 'Editor';
  const initial = displayName.charAt(0).toUpperCase();

  // Atalhos extras (Pontos só pra admin). Calculadora migrou pra
  // cluster da TopBar (CalculadoraButton), não vive mais aqui.
  const extras: NavItem[] = [];
  if (profile?.is_admin) {
    extras.push({
      href: '/tools/points',
      label: 'Pontos',
      icon: <IconTrophy />,
      match: (p) => p.startsWith('/tools/points'),
    });
  }

  const sections: NavSection[] = [
    {
      label: 'Navegar',
      items: [
        {
          href: '/tools',
          label: 'Início',
          icon: <IconHome />,
          match: (p) => p === '/tools',
        },
      ],
    },
    {
      label: 'Ferramentas',
      items: [
        {
          href: '/tools/decupagem',
          label: 'Base',
          icon: <IconBase />,
          match: (p) =>
            BASE_PATHS.some((bp) => p === bp || p.startsWith(bp + '/')),
        },
        {
          href: '/tools/auto-broll',
          label: 'IA',
          icon: <IconAi />,
          match: (p) =>
            AI_PATHS.some((bp) => p === bp || p.startsWith(bp + '/')),
        },
      ],
    },
    // Seção "Atalhos" só aparece se houver algum item (admin → Pontos).
    ...(extras.length > 0 ? [{ label: 'Atalhos', items: extras }] : []),
  ];

  const isActive = (it: NavItem) =>
    it.match ? it.match(pathname) : pathname === it.href;

  return (
    <>
      {/* Botão mobile (fora da sidebar) */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="fixed left-4 top-4 z-40 flex h-10 w-10 items-center justify-center rounded-[12px] border border-line bg-bg-soft/90 backdrop-blur-md md:hidden"
        aria-label="Abrir menu"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M3 6h18M3 12h18M3 18h18" />
        </svg>
      </button>

      {/* Overlay mobile */}
      {mobileOpen ? (
        <div
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
        />
      ) : null}

      <aside
        className={
          'fixed left-0 top-0 z-40 flex h-screen w-[84px] flex-col border-r border-line/80 bg-bg-soft/95 backdrop-blur-xl transition-transform duration-300 md:translate-x-0 ' +
          (mobileOpen ? 'translate-x-0' : '-translate-x-full')
        }
        style={{
          boxShadow: '8px 0 32px -16px rgba(0,0,0,0.6)',
        }}
      >
        {/* Logo */}
        <Link
          href="/tools"
          onClick={() => setMobileOpen(false)}
          className="group flex h-[68px] items-center justify-center border-b border-line/60 transition hover:bg-bg/40"
        >
          <div className="transition-transform duration-500 group-hover:scale-110 group-hover:rotate-[-6deg]">
            <DarkoLogo size={34} />
          </div>
        </Link>

        {/* Navegação principal por categorias */}
        <nav className="flex-1 overflow-y-auto py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {sections.map((section, sIdx) => (
            <div key={section.label} className={sIdx === 0 ? '' : 'mt-4'}>
              {/* Label de categoria */}
              <div
                className="mb-1.5 px-2.5 text-center text-[8.5px] font-bold uppercase tracking-[0.18em] text-text-dim"
                style={{ fontFamily: 'var(--font-tech)' }}
              >
                {section.label}
              </div>
              {/* Linha sutil sob a label */}
              <div className="mx-auto mb-2 h-px w-8 bg-line/80" />
              <ul className="flex flex-col gap-1 px-2.5">
                {section.items.map((it) => {
                  const active = isActive(it);
                  return (
                    <li key={it.href}>
                      <Link
                        href={it.href}
                        onClick={() => setMobileOpen(false)}
                        className={
                          'group relative flex flex-col items-center justify-center gap-1 rounded-[14px] py-2.5 transition-all duration-300 ' +
                          (active
                            ? 'text-violet'
                            : 'text-text-muted hover:bg-bg/50 hover:text-white')
                        }
                      >
                        {active ? (
                          <span
                            aria-hidden
                            className="absolute -left-[10px] top-1/2 h-7 w-[3px] -translate-y-1/2 rounded-r-full"
                            style={{
                              background:
                                'linear-gradient(180deg, #c084fc 0%, #6d4ee8 100%)',
                              boxShadow:
                                '0 0 12px rgba(167,139,250,0.85), 0 0 28px rgba(167,139,250,0.3)',
                            }}
                          />
                        ) : null}
                        <span
                          className={
                            'sb-nav-icon flex h-9 w-9 items-center justify-center rounded-[10px] transition-all duration-300 ' +
                            // HeyGen-style: ícone CINZA por padrão (dessaturado +
                            // apagado), acende a cor só no hover/ativo.
                            (active
                              ? 'sb-icon-active scale-105 grayscale-0 opacity-100'
                              : 'grayscale opacity-45 group-hover:scale-105 group-hover:-translate-y-[1px] group-hover:grayscale-0 group-hover:opacity-100')
                          }
                        >
                          {it.icon}
                        </span>
                        <span
                          className="max-w-full truncate px-1 text-center text-[9.5px] font-semibold leading-tight tracking-[0.02em]"
                          style={{ fontFamily: 'var(--font-tech)' }}
                          title={it.label}
                        >
                          {it.label}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* Rodapé — avatar/conta (Conta e Admin SÓ vivem aqui) */}
        <div className="relative border-t border-line/60 px-2.5 py-3">
          <button
            type="button"
            onClick={() => setAccountOpen((v) => !v)}
            className="group flex w-full flex-col items-center justify-center gap-1 rounded-[14px] py-2 transition hover:bg-bg/50"
            aria-haspopup="menu"
            aria-expanded={accountOpen}
            title={displayName}
          >
            <TierAvatar
              tier={profile?.tier ?? 'free'}
              avatarUrl={profile?.avatar_url}
              avatarBroken={avatarBroken}
              onAvatarError={() => setAvatarBroken(true)}
              displayName={displayName}
              initial={initial}
              active={accountOpen}
            />
            {/* Pill do tier embaixo */}
            <span
              className="mt-1 rounded-full px-1.5 py-0.5 text-[8.5px] font-bold uppercase tracking-[0.18em]"
              style={{
                fontFamily: 'var(--font-tech)',
                color: tierColorOf(profile?.tier ?? 'free'),
                background: tierBgOf(profile?.tier ?? 'free'),
                border: `1px solid ${tierBorderOf(profile?.tier ?? 'free')}`,
              }}
            >
              {tierLabelOf(profile?.tier ?? 'free')}
            </span>
          </button>

          {accountOpen ? (
            <div
              role="menu"
              className="dropdown-pop absolute bottom-3 left-[80px] z-50 w-64 overflow-hidden rounded-[16px] border border-line bg-bg-soft/95 shadow-2xl backdrop-blur-xl"
              style={{
                boxShadow:
                  '0 1px 0 rgba(255,255,255,0.06) inset, 0 32px 64px -20px rgba(0,0,0,0.95), 0 0 48px -12px rgba(167,139,250,0.28)',
              }}
            >
              <div className="border-b border-line px-4 py-3.5">
                <div className="truncate text-sm font-semibold">
                  {displayName}
                </div>
                <div
                  className="mt-1 text-[10px] uppercase tracking-[0.18em] text-text-muted"
                  style={{ fontFamily: 'var(--font-tech)' }}
                >
                  Conectado
                </div>
              </div>
              <nav className="flex flex-col py-1 text-sm">
                <Link
                  href="/planos?upgrade=1"
                  onClick={() => setAccountOpen(false)}
                  className="group flex items-center gap-3 px-4 py-2.5 text-text-muted transition hover:bg-bg hover:text-text"
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-[8px] border border-violet/30 bg-violet/10">
                    <DotPlans />
                  </span>
                  <span className="flex-1 font-semibold text-lime">Upgrade</span>
                  <span className="text-text-dim transition group-hover:translate-x-0.5 group-hover:text-violet">→</span>
                </Link>
                <Link
                  href="/configuracoes"
                  onClick={() => setAccountOpen(false)}
                  className="group flex items-center gap-3 px-4 py-2.5 text-text-muted transition hover:bg-bg hover:text-text"
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-[8px] border border-line bg-bg">
                    <DotGear />
                  </span>
                  <span className="flex-1">Configurações</span>
                  <span className="text-text-dim transition group-hover:translate-x-0.5 group-hover:text-violet">→</span>
                </Link>
                {profile?.is_admin ? (
                  <Link
                    href="/admin"
                    onClick={() => setAccountOpen(false)}
                    className="group flex items-center gap-3 px-4 py-2.5 text-text-muted transition hover:bg-bg hover:text-text"
                  >
                    <span className="flex h-7 w-7 items-center justify-center rounded-[8px] border border-lime/30 bg-lime/10">
                      <DotShield />
                    </span>
                    <span className="flex-1">Painel admin</span>
                    <span className="rounded-full border border-lime/40 bg-lime/10 px-1.5 py-0.5 text-[8.5px] font-bold uppercase tracking-[0.18em] text-lime" style={{ fontFamily: 'var(--font-tech)' }}>
                      ADMIN
                    </span>
                  </Link>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    setAccountOpen(false);
                    handleLogout();
                  }}
                  className="mt-1 flex items-center gap-3 border-t border-line px-4 py-2.5 text-left text-red-400 transition hover:bg-red-500/10 hover:text-red-300"
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-[8px] border border-red-500/30 bg-red-500/10">
                    <DotExit />
                  </span>
                  Sair
                </button>
              </nav>
            </div>
          ) : null}
        </div>
      </aside>
    </>
  );
}

/* ─── Paths Base / IA (usados pra match do nav ativo) ─── */
const BASE_PATHS = [
  '/tools/decupagem',
  '/tools/camuflagem',
  '/tools/downloader',
  '/tools/compressor',
  '/tools/audio-split',
  '/tools/acelerador',
  '/tools/normalizador',
  '/tools/separador-audio',
];
const AI_PATHS = [
  '/tools/auto-broll',
  '/tools/remover-elementos',
  '/tools/decupagem-copy',
  '/tools/copy-srt',
  '/tools/heygen-auto',
];

/* ─── Ícones grandes (gradientes) ─── */

function IconHome() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <defs>
        <linearGradient id="sb-home" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#67e8f9" />
          <stop offset="100%" stopColor="#a78bfa" />
        </linearGradient>
      </defs>
      <path
        d="M3 11.5L12 4l9 7.5V20a1 1 0 01-1 1h-5v-6h-6v6H4a1 1 0 01-1-1v-8.5z"
        stroke="url(#sb-home)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconBase() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <defs>
        <linearGradient id="sb-base" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#c2cf86" />
          <stop offset="100%" stopColor="#67e8f9" />
        </linearGradient>
      </defs>
      <path
        d="M14.7 6.3a4 4 0 00-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 005.4-5.4l-2.7 2.7-2.6-2.6 2.7-2.7z"
        stroke="url(#sb-base)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

function IconAi() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <defs>
        <linearGradient id="sb-ai" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#f0abfc" />
          <stop offset="100%" stopColor="#a78bfa" />
        </linearGradient>
      </defs>
      <path
        d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z"
        fill="url(#sb-ai)"
      />
      <path
        d="M19 16l0.7 2 2 0.7-2 0.7-0.7 2-0.7-2-2-0.7 2-0.7 0.7-2z"
        fill="url(#sb-ai)"
        opacity="0.7"
      />
    </svg>
  );
}

function IconTrophy() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <defs>
        <linearGradient id="sb-tro" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#fbbf24" />
          <stop offset="100%" stopColor="#f97316" />
        </linearGradient>
      </defs>
      <path
        d="M7 4h10v3a5 5 0 01-10 0V4z"
        stroke="url(#sb-tro)"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M4 5h3v2a3 3 0 01-3-3M20 5h-3v2a3 3 0 003-3"
        stroke="url(#sb-tro)"
        strokeWidth="1.6"
        fill="none"
      />
      <path d="M9 14v2h6v-2M10 16l-1 4h6l-1-4" stroke="url(#sb-tro)" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/* ─── Mini ícones do dropdown da conta ─── */

/* ─── TierAvatar — moldura do avatar muda conforme tier ─── */

type AvatarTier = 'free' | 'basic' | 'pro' | 'admin';

// Cores de tier via CSS vars → tema-aware (no claro viram escuras e legíveis).
function tierColorOf(t: AvatarTier): string {
  return t === 'admin'
    ? 'rgb(var(--lime))'
    : t === 'pro'
      ? 'rgb(var(--violet))'
      : t === 'basic'
        ? 'rgb(var(--pink))'
        : 'rgb(var(--text-muted))';
}
function tierBgOf(t: AvatarTier): string {
  return t === 'admin'
    ? 'rgb(var(--lime) / 0.12)'
    : t === 'pro'
      ? 'rgb(var(--violet) / 0.14)'
      : t === 'basic'
        ? 'rgb(var(--pink) / 0.12)'
        : 'rgb(var(--text-muted) / 0.10)';
}
function tierBorderOf(t: AvatarTier): string {
  return t === 'admin'
    ? 'rgb(var(--lime) / 0.45)'
    : t === 'pro'
      ? 'rgb(var(--violet) / 0.45)'
      : t === 'basic'
        ? 'rgb(var(--pink) / 0.45)'
        : 'rgb(var(--text-muted) / 0.35)';
}
function tierLabelOf(t: AvatarTier): string {
  return t === 'admin' ? 'ADMIN' : t === 'pro' ? 'PRO' : t === 'basic' ? 'BASIC' : 'FREE';
}

function TierAvatar({
  tier,
  avatarUrl,
  avatarBroken,
  onAvatarError,
  displayName,
  initial,
  active,
}: {
  tier: AvatarTier;
  avatarUrl: string | null | undefined;
  avatarBroken: boolean;
  onAvatarError: () => void;
  displayName: string;
  initial: string;
  active: boolean;
}) {
  const color = tierColorOf(tier);
  const isPremium = tier === 'pro' || tier === 'admin';
  const isAdmin = tier === 'admin';

  // Moldura conforme tier:
  //  free → borda simples cinza
  //  basic → gradient rosa
  //  pro → gradient violet com glow + ring extra
  //  admin → gradient lime + sparkles flutuantes
  const ringStyle: React.CSSProperties = (() => {
    if (tier === 'free') {
      return {
        background: 'rgba(139,139,150,0.25)',
      };
    }
    if (tier === 'basic') {
      return {
        background:
          'conic-gradient(from 0deg, #f472b6, #ec4899, #f472b6, #f9a8d4, #f472b6)',
      };
    }
    if (tier === 'pro') {
      return {
        background:
          'conic-gradient(from 0deg, #c084fc, #a78bfa, #c084fc, #d8b4fe, #c084fc)',
        animation: 'tier-ring-spin 6s linear infinite',
      };
    }
    // admin
    return {
      background:
        'conic-gradient(from 0deg, #c2cf86, #aebd72, #c2cf86, #d9f99d, #c2cf86)',
      animation: 'tier-ring-spin 4s linear infinite',
    };
  })();

  return (
    <div className="tier-avatar relative inline-block">
      {/* Glow externo (só basic+) */}
      {isPremium ? (
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-1.5 rounded-full opacity-70 blur-md"
          style={{
            background: color,
            animation: 'tier-glow-pulse 2.6s ease-in-out infinite',
          }}
        />
      ) : null}

      {/* Anel conic giratório (basic+, pro, admin) */}
      <div
        className="relative h-12 w-12 rounded-full p-[2px]"
        style={ringStyle}
      >
        <div className="relative h-full w-full overflow-hidden rounded-full bg-bg">
          {avatarUrl && !avatarBroken ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatarUrl}
              alt={displayName}
              onError={onAvatarError}
              referrerPolicy="no-referrer"
              className="h-full w-full object-cover"
            />
          ) : (
            <div
              className="flex h-full w-full items-center justify-center bg-gradient-to-br from-violet/20 to-violet-deep/30 text-[15px] font-bold text-white"
              style={{
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.12)',
              }}
            >
              {initial}
            </div>
          )}
        </div>
      </div>

      {/* Coroa decorativa pra admin */}
      {isAdmin ? (
        <span
          aria-hidden
          className="absolute -top-1.5 left-1/2 -translate-x-1/2"
          style={{
            filter: 'drop-shadow(0 0 6px rgba(200,232,124,0.85))',
          }}
        >
          <svg width="20" height="14" viewBox="0 0 24 16" fill="none">
            <path
              d="M2 14L4 4l5 6 3-10 3 10 5-6 2 10z"
              fill="#c2cf86"
              stroke="#aebd72"
              strokeWidth="0.8"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      ) : null}

      {/* Sparkle decorativo Pro */}
      {tier === 'pro' ? (
        <span
          aria-hidden
          className="absolute -right-1 -top-1"
          style={{
            animation: 'tier-spark 2.4s ease-in-out infinite',
          }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M5 0l1 4 4 1-4 1-1 4-1-4-4-1 4-1z" fill="#c084fc" />
          </svg>
        </span>
      ) : null}

      {/* Outline de active (hover/open) */}
      {active ? (
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-1 rounded-full"
          style={{
            border: `1.5px solid ${color}`,
            opacity: 0.65,
          }}
        />
      ) : null}

      <style jsx>{`
        @keyframes tier-ring-spin {
          to { transform: rotate(360deg); }
        }
        @keyframes tier-glow-pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 0.85; }
        }
        @keyframes tier-spark {
          0%, 100% { transform: scale(0.7) rotate(0); opacity: 0.6; }
          50% { transform: scale(1.2) rotate(90deg); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

function DotPlans() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#c084fc" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7l9-4 9 4-9 4z" />
      <path d="M3 12l9 4 9-4" />
      <path d="M3 17l9 4 9-4" />
    </svg>
  );
}

function DotGear() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.9 2.9l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 01-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1A2 2 0 113.1 16.9l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H1a2 2 0 010-4h.1A1.7 1.7 0 002.6 9a1.7 1.7 0 00-.3-1.8l-.1-.1A2 2 0 015.1 4.2l.1.1a1.7 1.7 0 001.8.3H7a1.7 1.7 0 001-1.5V3a2 2 0 014 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 012.9 2.9l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H23a2 2 0 010 4h-.1a1.7 1.7 0 00-1.5 1z" />
    </svg>
  );
}

function DotShield() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#c2cf86" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2l9 4v6c0 5-3.5 9-9 10-5.5-1-9-5-9-10V6l9-4z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

function DotExit() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
      <path d="M16 17l5-5-5-5M21 12H9" />
    </svg>
  );
}
