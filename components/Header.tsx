'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { BackgroundTasksButton } from './BackgroundTasksButton';
import { Brand } from './Brand';
import { ClickUpPilotButton } from './ClickUpPilotButton';
import { LipsyncHistoryButton } from './LipsyncHistoryButton';
import { PointsButton } from './PointsButton';
import { createClient } from '@/lib/supabase/client';

type Profile = {
  name: string | null;
  avatar_url: string | null;
  is_admin: boolean;
};

/**
 * Header v2 — vidro com motion ao scroll.
 *
 * - Encolhe sutilmente quando o usuario rola pra baixo (depth feel)
 * - Backdrop blur mais forte + borda mais sutil
 * - Dropdown da conta com motion 3D refinado
 */
export function Header() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [open, setOpen] = useState(false);
  const [avatarBroken, setAvatarBroken] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

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

    function onProfileUpdated() {
      fetchProfile();
    }
    window.addEventListener('darko:profile-updated', onProfileUpdated);

    return () => {
      cancelled = true;
      window.removeEventListener('darko:profile-updated', onProfileUpdated);
    };
  }, []);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 8);
    }
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace('/login');
    router.refresh();
  }

  const displayName = profile?.name?.trim() || 'Editor';
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <header
      className={
        'sticky top-0 z-30 border-b transition-all duration-300 ' +
        (scrolled
          ? 'border-line/80 bg-bg/85 backdrop-blur-xl shadow-[0_8px_24px_-12px_rgba(0,0,0,0.6)]'
          : 'border-line/50 bg-bg/55 backdrop-blur-md')
      }
    >
      <div
        className={
          'container-app flex items-center justify-between transition-all duration-300 ' +
          (scrolled ? 'h-14' : 'h-16')
        }
      >
        <Brand />

        <div className="flex items-center gap-2.5">
          <PointsButton />
          <BackgroundTasksButton />
          <LipsyncHistoryButton />
          <ClickUpPilotButton />

          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className={
                'group flex items-center gap-2.5 rounded-full border bg-bg/60 py-1 pl-1 pr-3 text-left transition-all duration-300 hover:bg-bg ' +
                (open
                  ? 'border-violet/60 shadow-[0_0_22px_-6px_rgba(167,139,250,0.6)]'
                  : 'border-line-strong hover:border-violet/50 hover:shadow-[0_0_18px_-8px_rgba(167,139,250,0.4)]')
              }
              aria-haspopup="menu"
              aria-expanded={open}
            >
              {profile?.avatar_url && !avatarBroken ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={profile.avatar_url}
                  alt={displayName}
                  onError={() => setAvatarBroken(true)}
                  referrerPolicy="no-referrer"
                  className="h-8 w-8 rounded-full border border-line object-cover"
                />
              ) : (
                <span
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-line bg-gradient-to-br from-bg-soft to-bg text-xs font-bold text-violet"
                  style={{
                    boxShadow:
                      'inset 0 1px 0 rgba(255,255,255,0.06), 0 0 18px -6px rgba(167,139,250,0.5)',
                  }}
                >
                  {initial}
                </span>
              )}
              <span className="hidden max-w-[140px] truncate text-sm font-semibold text-text md:inline">
                {displayName}
              </span>
              <svg
                className={
                  'h-4 w-4 text-text-muted transition-transform duration-200 ' +
                  (open ? 'rotate-180' : '')
                }
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden
              >
                <path
                  fillRule="evenodd"
                  d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                  clipRule="evenodd"
                />
              </svg>
            </button>

            {open ? (
              <div
                role="menu"
                className="dropdown-pop absolute right-0 mt-2 w-64 overflow-hidden rounded-[16px] border border-line bg-bg-soft/95 shadow-2xl backdrop-blur-xl"
                style={{
                  boxShadow:
                    '0 1px 0 rgba(255,255,255,0.06) inset, 0 24px 48px -16px rgba(0,0,0,0.95), 0 0 40px -10px rgba(167,139,250,0.25)',
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
                    Conta ativa
                  </div>
                </div>
                <nav className="flex flex-col py-1.5 text-sm">
                  <Link
                    href="/tools"
                    onClick={() => setOpen(false)}
                    className="group flex items-center justify-between px-4 py-2.5 text-text-muted transition hover:bg-bg hover:text-text"
                    role="menuitem"
                  >
                    <span>Ferramentas</span>
                    <span className="text-text-dim transition group-hover:translate-x-0.5 group-hover:text-violet">
                      →
                    </span>
                  </Link>
                  <Link
                    href="/configuracoes"
                    onClick={() => setOpen(false)}
                    className="group flex items-center justify-between px-4 py-2.5 text-text-muted transition hover:bg-bg hover:text-text"
                    role="menuitem"
                  >
                    <span>Configurações</span>
                    <span className="text-text-dim transition group-hover:translate-x-0.5 group-hover:text-violet">
                      →
                    </span>
                  </Link>
                  {profile?.is_admin ? (
                    <Link
                      href="/admin"
                      onClick={() => setOpen(false)}
                      className="flex items-center justify-between px-4 py-2.5 text-lime transition hover:bg-bg"
                      role="menuitem"
                    >
                      <span>Admin</span>
                      <span className="pill-lime text-[9px]">ADMIN</span>
                    </Link>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      handleLogout();
                    }}
                    className="mt-1 border-t border-line px-4 py-2.5 text-left text-red-400 transition hover:bg-red-500/10 hover:text-red-300"
                    role="menuitem"
                  >
                    Sair
                  </button>
                </nav>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
}
