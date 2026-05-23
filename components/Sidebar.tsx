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
};

type NavItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
  match?: (path: string) => boolean;
  adminOnly?: boolean;
};

/**
 * Sidebar v3 — navegação principal lateral estilo HeyGen.
 *
 * Substitui o Header horizontal antigo. Sempre fixa, 84px no desktop,
 * fechada em mobile (com botão pra abrir). Cada item: ícone grande
 * dentro de um quadro com glow + label embaixo. Item ativo ganha
 * fundo translúcido + borda violet.
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
      const { data } = await supabase
        .from('profiles')
        .select('name, avatar_url, is_admin')
        .eq('id', uid)
        .maybeSingle();
      if (!cancelled) {
        setProfile({
          name: data?.name ?? null,
          avatar_url: data?.avatar_url ?? null,
          is_admin: !!data?.is_admin,
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

  const navItems: NavItem[] = [
    {
      href: '/tools',
      label: 'Início',
      icon: <IconHome />,
      match: (p) => p === '/tools',
    },
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
      match: (p) => AI_PATHS.some((bp) => p === bp || p.startsWith(bp + '/')),
    },
    {
      href: '/tools/points',
      label: 'Pontos',
      icon: <IconTrophy />,
      match: (p) => p.startsWith('/tools/points'),
    },
    {
      href: '/configuracoes',
      label: 'Conta',
      icon: <IconGear />,
      match: (p) => p.startsWith('/configuracoes'),
    },
  ];

  if (profile?.is_admin) {
    navItems.push({
      href: '/admin',
      label: 'Admin',
      icon: <IconAdmin />,
      match: (p) => p.startsWith('/admin'),
      adminOnly: true,
    });
  }

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

        {/* Navegação principal */}
        <nav className="flex-1 overflow-y-auto py-3">
          <ul className="flex flex-col gap-1 px-2.5">
            {navItems.map((it) => {
              const active = isActive(it);
              return (
                <li key={it.href}>
                  <Link
                    href={it.href}
                    onClick={() => setMobileOpen(false)}
                    className={
                      'group relative flex flex-col items-center justify-center gap-1 rounded-[14px] py-3 transition-all duration-300 ' +
                      (active
                        ? 'bg-violet/12 text-violet'
                        : 'text-text-muted hover:bg-bg/50 hover:text-white')
                    }
                  >
                    {/* Indicador lateral ativo */}
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
                        'flex h-9 w-9 items-center justify-center rounded-[10px] transition-all duration-300 ' +
                        (active
                          ? 'scale-105'
                          : 'group-hover:scale-105 group-hover:-translate-y-[1px]')
                      }
                    >
                      {it.icon}
                    </span>
                    <span
                      className="text-[10px] font-semibold tracking-[0.04em]"
                      style={{ fontFamily: 'var(--font-tech)' }}
                    >
                      {it.label}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Rodapé — avatar/conta */}
        <div className="relative border-t border-line/60 px-2.5 py-3">
          <button
            type="button"
            onClick={() => setAccountOpen((v) => !v)}
            className="group flex w-full flex-col items-center justify-center gap-1 rounded-[14px] py-2 transition hover:bg-bg/50"
            aria-haspopup="menu"
            aria-expanded={accountOpen}
          >
            {profile?.avatar_url && !avatarBroken ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={profile.avatar_url}
                alt={displayName}
                onError={() => setAvatarBroken(true)}
                referrerPolicy="no-referrer"
                className="h-10 w-10 rounded-full border-2 border-line object-cover transition-transform group-hover:scale-105"
              />
            ) : (
              <span
                className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-line bg-gradient-to-br from-violet/30 to-violet-deep/40 text-sm font-bold text-white transition-transform group-hover:scale-105"
                style={{
                  boxShadow:
                    'inset 0 1px 0 rgba(255,255,255,0.12), 0 0 18px -6px rgba(167,139,250,0.6)',
                }}
              >
                {initial}
              </span>
            )}
          </button>

          {accountOpen ? (
            <div
              role="menu"
              className="dropdown-pop absolute bottom-3 left-[80px] z-50 w-60 overflow-hidden rounded-[16px] border border-line bg-bg-soft/95 shadow-2xl backdrop-blur-xl"
              style={{
                boxShadow:
                  '0 1px 0 rgba(255,255,255,0.06) inset, 0 32px 64px -20px rgba(0,0,0,0.95), 0 0 48px -12px rgba(167,139,250,0.28)',
              }}
            >
              <div className="border-b border-line px-4 py-3">
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
                  href="/configuracoes"
                  onClick={() => setAccountOpen(false)}
                  className="group flex items-center justify-between px-4 py-2.5 text-text-muted transition hover:bg-bg hover:text-text"
                >
                  <span>Configurações</span>
                  <span className="text-text-dim transition group-hover:translate-x-0.5 group-hover:text-violet">→</span>
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    setAccountOpen(false);
                    handleLogout();
                  }}
                  className="mt-1 border-t border-line px-4 py-2.5 text-left text-red-400 transition hover:bg-red-500/10 hover:text-red-300"
                >
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

/* ─── Paths usados pra detectar "Base" / "IA" no nav ─── */
const BASE_PATHS = [
  '/tools/decupagem',
  '/tools/camuflagem',
  '/tools/downloader',
  '/tools/compressor',
  '/tools/audio-split',
  '/tools/acelerador',
  '/tools/normalizador',
  '/tools/take-splitter',
  '/tools/calculadora',
];
const AI_PATHS = [
  '/tools/auto-broll',
  '/tools/troca-produto',
  '/tools/remover-elementos',
  '/tools/decupagem-copy',
  '/tools/copy-srt',
  '/tools/heygen-auto',
  '/tools/ltx-video',
];

/* ─── Ícones grandes da sidebar (gradientes coloridos) ─── */

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
          <stop offset="0%" stopColor="#c8ff00" />
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

function IconGear() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <defs>
        <linearGradient id="sb-gear" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#94a3b8" />
          <stop offset="100%" stopColor="#cbd5e1" />
        </linearGradient>
      </defs>
      <circle cx="12" cy="12" r="3" stroke="url(#sb-gear)" strokeWidth="1.8" />
      <path
        d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.9 2.9l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 01-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1A2 2 0 113.1 16.9l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H1a2 2 0 010-4h.1A1.7 1.7 0 002.6 9a1.7 1.7 0 00-.3-1.8l-.1-.1A2 2 0 015.1 4.2l.1.1a1.7 1.7 0 001.8.3H7a1.7 1.7 0 001-1.5V3a2 2 0 014 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 012.9 2.9l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H23a2 2 0 010 4h-.1a1.7 1.7 0 00-1.5 1z"
        stroke="url(#sb-gear)"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconAdmin() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <defs>
        <linearGradient id="sb-ad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#c8ff00" />
          <stop offset="100%" stopColor="#84cc16" />
        </linearGradient>
      </defs>
      <path
        d="M12 2l9 4v6c0 5-3.5 9-9 10-5.5-1-9-5-9-10V6l9-4z"
        stroke="url(#sb-ad)"
        strokeWidth="1.8"
        strokeLinejoin="round"
        fill="rgba(200,255,0,0.06)"
      />
      <path d="M9 12l2 2 4-4" stroke="url(#sb-ad)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
