'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  IconAcelerador,
  IconAudioSplit,
  IconAutoBroll,
  IconCamuflagem,
  IconCompressor,
  IconCopySRT,
  IconDecupageCopy,
  IconDecupagem,
  IconDownloader,
  IconHeyGenAuto,
  IconNormalizador,
  IconRemoverElementos,
  IconTrocaProduto,
} from './ToolIcons';

type Item = {
  href: string;
  label: string;
  icon: React.ReactNode;
  hue: string;
  adminOnly?: boolean;
};

const BASE_ITEMS: Item[] = [
  { href: '/tools/decupagem', label: 'Decupagem', icon: <IconDecupagem size={20} />, hue: 'rgba(163,230,53,0.4)' },
  { href: '/tools/camuflagem', label: 'Camuflagem', icon: <IconCamuflagem size={20} />, hue: 'rgba(45,212,191,0.4)' },
  { href: '/tools/downloader', label: 'Downloader', icon: <IconDownloader size={20} />, hue: 'rgba(96,165,250,0.4)' },
  { href: '/tools/compressor', label: 'Compressor', icon: <IconCompressor size={20} />, hue: 'rgba(129,140,248,0.4)' },
  { href: '/tools/audio-split', label: 'Dividir áudios', icon: <IconAudioSplit size={20} />, hue: 'rgba(34,211,238,0.4)' },
  { href: '/tools/acelerador', label: 'Mixer de Velocidade', icon: <IconAcelerador size={20} />, hue: 'rgba(251,191,36,0.4)' },
  { href: '/tools/normalizador', label: 'Normalizador', icon: <IconNormalizador size={20} />, hue: 'rgba(94,234,212,0.4)' },
];

const AI_ITEMS: Item[] = [
  { href: '/tools/auto-broll', label: 'Auto B-roll', icon: <IconAutoBroll size={20} />, hue: 'rgba(240,171,252,0.45)' },
  { href: '/tools/troca-produto', label: 'Troca de produto', icon: <IconTrocaProduto size={20} />, hue: 'rgba(244,114,182,0.45)' },
  { href: '/tools/remover-elementos', label: 'Remover Legenda', icon: <IconRemoverElementos size={20} />, hue: 'rgba(244,114,182,0.45)' },
  { href: '/tools/decupagem-copy', label: 'Decupagem Inteligente', icon: <IconDecupageCopy size={20} />, hue: 'rgba(232,121,249,0.45)' },
  { href: '/tools/copy-srt', label: 'Gerador de SRT', icon: <IconCopySRT size={20} />, hue: 'rgba(196,181,253,0.45)' },
  { href: '/tools/heygen-auto', label: 'HeyGen Auto', icon: <IconHeyGenAuto size={20} />, hue: 'rgba(103,232,249,0.45)' },
];

const BASE_PATHS = BASE_ITEMS.map((i) => i.href);
const AI_PATHS = AI_ITEMS.map((i) => i.href);

/**
 * SubSidebar — coluna lateral 240px com a lista de ferramentas
 * da categoria atual (Base ou IA). Aparece SÓ quando o pathname
 * pertence a uma das suites.
 *
 * Estrutura:
 *   ┌──────────────────────┐
 *   │ TRABALHO RÁPIDO      │ ← eyebrow
 *   │ 9 ferramentas        │ ← contador
 *   ├──────────────────────┤
 *   │ [ic] Decupagem       │ ← lista vertical
 *   │ [ic] Camuflagem ←    │
 *   │ [ic] Downloader      │
 *   │ ...                  │
 *   └──────────────────────┘
 */
export function SubSidebar() {
  const pathname = usePathname();
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        const { data: u } = await supabase.auth.getUser();
        const uid = u.user?.id;
        if (!uid) return;
        const { data } = await supabase
          .from('profiles')
          .select('is_admin')
          .eq('id', uid)
          .maybeSingle();
        if (!cancelled) setIsAdmin(!!data?.is_admin);
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const inBase = BASE_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + '/'),
  );
  const inAi = AI_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + '/'),
  );

  if (!inBase && !inAi) return null;

  const items = (inBase ? BASE_ITEMS : AI_ITEMS).filter(
    (it) => !it.adminOnly || isAdmin,
  );
  const meta = inBase
    ? { eyebrow: 'TRABALHO RÁPIDO', dot: '#c8ff00' }
    : { eyebrow: 'INTELIGÊNCIA', dot: '#a78bfa' };

  return (
    <aside
      className="fixed left-[84px] top-0 z-30 hidden h-screen w-[244px] flex-col border-r border-line/70 bg-bg-soft/70 backdrop-blur-xl md:flex"
      style={{
        boxShadow: '4px 0 24px -16px rgba(0,0,0,0.5)',
      }}
    >
      {/* Cabeçalho */}
      <div className="px-5 pb-3 pt-5">
        <div
          className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.22em]"
          style={{ fontFamily: 'var(--font-tech)', color: meta.dot }}
        >
          <span
            className="inline-block h-1.5 w-1.5 animate-pulse-soft rounded-full"
            style={{ background: meta.dot, boxShadow: `0 0 10px ${meta.dot}` }}
          />
          {meta.eyebrow}
        </div>
        <div className="mt-1 text-[11px] text-text-dim">
          {items.length} {items.length === 1 ? 'ferramenta' : 'ferramentas'}
        </div>
      </div>

      {/* Divisor sutil */}
      <div className="mx-5 h-px bg-line/80" />

      {/* Lista */}
      <nav className="flex-1 overflow-y-auto px-3 py-3">
        <ul className="flex flex-col gap-1">
          {items.map((it, i) => {
            const active =
              pathname === it.href || pathname.startsWith(it.href + '/');
            return (
              <li
                key={it.href}
                className="sub-sidebar-item"
                style={{ animationDelay: `${i * 35}ms` }}
              >
                <Link
                  href={it.href}
                  className={
                    'group relative flex items-center gap-3 rounded-[12px] px-3 py-2.5 transition-all duration-300 ' +
                    (active
                      ? 'bg-violet/12 text-white'
                      : 'text-text-muted hover:bg-bg/60 hover:text-white')
                  }
                >
                  {/* Indicador vertical ativo */}
                  {active ? (
                    <span
                      aria-hidden
                      className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-full"
                      style={{
                        background:
                          'linear-gradient(180deg, #c084fc 0%, #6d4ee8 100%)',
                        boxShadow: '0 0 10px rgba(167,139,250,0.75)',
                      }}
                    />
                  ) : null}

                  <span
                    className={
                      'flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border transition-all duration-300 ' +
                      (active
                        ? 'border-white/12 bg-black/35 scale-105'
                        : 'border-white/5 bg-black/25 group-hover:border-white/12 group-hover:bg-black/35 group-hover:scale-105')
                    }
                    style={{
                      boxShadow: `0 0 18px -6px ${it.hue}, inset 0 1px 0 rgba(255,255,255,0.06)`,
                    }}
                  >
                    {it.icon}
                  </span>
                  <span
                    className="truncate text-[13px] font-semibold tracking-tight"
                    style={{ fontFamily: 'var(--font-tech)', letterSpacing: '-0.01em' }}
                  >
                    {it.label}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <style jsx>{`
        .sub-sidebar-item {
          animation: ssi-in 380ms cubic-bezier(0.2, 0.9, 0.3, 1) both;
        }
        @keyframes ssi-in {
          0% { opacity: 0; transform: translateX(-12px); }
          100% { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </aside>
  );
}

/**
 * Hook auxiliar — diz se o pathname atual pede a sub-sidebar.
 * Usado pelo layout pra ajustar o padding esquerdo do conteúdo.
 */
export function useSubSidebarActive() {
  const pathname = usePathname();
  const inBase = BASE_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + '/'),
  );
  const inAi = AI_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + '/'),
  );
  return inBase || inAi;
}
