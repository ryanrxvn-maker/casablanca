'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Brand } from './Brand';
import { ClickUpPilotButton } from './ClickUpPilotButton';
import { HeyGenHistoryButton } from './HeyGenHistoryButton';
import { PointsButton } from './PointsButton';
import { createClient } from '@/lib/supabase/client';

type Profile = {
  name: string | null;
  avatar_url: string | null;
  is_admin: boolean;
};

/**
 * Header global — usado dentro das areas logadas.
 *
 * Privacidade:
 * - O email NAO e exibido (vazava info pessoal pra qualquer um olhando a tela).
 * - Sem badge ONLINE.
 * - Conta: apenas Configuracoes + Sair no dropdown.
 */
export function Header() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [open, setOpen] = useState(false);
  const [avatarBroken, setAvatarBroken] = useState(false);
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

    // Escuta evento customizado (mantido por compatibilidade) pra manter
    // o Header em sync sem refresh quando o nome ou avatar mudarem.
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

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace('/login');
    router.refresh();
  }

  const displayName = profile?.name?.trim() || 'Editor';
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/80 backdrop-blur-md">
      <div className="container-app flex h-16 items-center justify-between">
        <Brand />

        <div className="flex items-center gap-3">
          <PointsButton />
          <HeyGenHistoryButton />
          <ClickUpPilotButton />

        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className={
              'group flex items-center gap-3 rounded-full border bg-bg/60 py-1 pl-1 pr-3 text-left transition-all duration-300 hover:bg-bg ' +
              (open
                ? 'border-lime/70 shadow-[0_0_22px_-6px_rgba(200,255,0,0.65)]'
                : 'border-line hover:border-lime/60 hover:shadow-[0_0_18px_-8px_rgba(200,255,0,0.45)]')
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
              <span className="flex h-8 w-8 items-center justify-center rounded-full border border-line bg-bg-soft text-xs font-bold text-lime">
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
              className="dropdown-pop absolute right-0 mt-2 w-60 overflow-hidden rounded-[12px] border border-line bg-bg-soft/95 shadow-2xl backdrop-blur-md"
            >
              <div className="border-b border-line px-4 py-3">
                <div className="truncate text-sm font-semibold">
                  {displayName}
                </div>
                <div className="mt-0.5 text-[11px] uppercase tracking-widest text-text-muted">
                  Conta ativa
                </div>
              </div>
              <nav className="flex flex-col py-1 text-sm">
                <Link
                  href="/tools"
                  onClick={() => setOpen(false)}
                  className="px-4 py-2 text-text-muted transition hover:bg-bg hover:text-text"
                  role="menuitem"
                >
                  Ferramentas
                </Link>
                <Link
                  href="/configuracoes"
                  onClick={() => setOpen(false)}
                  className="px-4 py-2 text-text-muted transition hover:bg-bg hover:text-text"
                  role="menuitem"
                >
                  Configurações
                </Link>
                {profile?.is_admin ? (
                  <Link
                    href="/admin"
                    onClick={() => setOpen(false)}
                    className="flex items-center justify-between px-4 py-2 text-lime transition hover:bg-bg"
                    role="menuitem"
                  >
                    Admin
                    <span className="mono rounded-full border border-lime/60 px-1.5 py-0.5 text-[8px] uppercase tracking-widest">
                      ADMIN
                    </span>
                  </Link>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    handleLogout();
                  }}
                  className="border-t border-line px-4 py-2 text-left text-red-400 transition hover:bg-red-500/10 hover:text-red-300"
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
