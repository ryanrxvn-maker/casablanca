'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { BackgroundTasksButton } from './BackgroundTasksButton';
import { ClickUpPilotButton } from './ClickUpPilotButton';
import { LipsyncHistoryButton } from './LipsyncHistoryButton';
import { PointsButton } from './PointsButton';

/**
 * TopBar v3 — barra fina topo direito.
 *
 * - Encolhe (h-12) ao rolar pra baixo
 * - Mostra título contextual da rota à esquerda + ações à direita
 * - Sem brand (já está na sidebar)
 */
const TITLES: Record<string, string> = {
  '/tools': 'Início',
  '/tools/decupagem': 'Decupagem',
  '/tools/camuflagem': 'Camuflagem',
  '/tools/downloader': 'Downloader',
  '/tools/compressor': 'Compressor',
  '/tools/audio-split': 'Separar áudios',
  '/tools/acelerador': 'Acelerador',
  '/tools/normalizador': 'Normalizador',
  '/tools/take-splitter': 'Separar takes',
  '/tools/calculadora': 'Calculadora',
  '/tools/auto-broll': 'Auto B-roll',
  '/tools/troca-produto': 'Troca de produto',
  '/tools/remover-elementos': 'Remover legenda',
  '/tools/decupagem-copy': 'Decupagem por roteiro',
  '/tools/copy-srt': 'Roteiro vira legenda',
  '/tools/heygen-auto': 'Avatar automático',
  '/tools/ltx-video': 'Vídeo do zero',
  '/tools/points': 'Pontos',
  '/configuracoes': 'Conta',
};

export function TopBar() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 8);
    }
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const title =
    TITLES[pathname] ??
    Object.keys(TITLES)
      .filter((k) => pathname.startsWith(k))
      .sort((a, b) => b.length - a.length)[0];

  const display = title ? TITLES[title] ?? title : '';

  return (
    <header
      className={
        'sticky top-0 z-30 border-b transition-all duration-300 ' +
        (scrolled
          ? 'border-line/70 bg-bg/85 backdrop-blur-xl'
          : 'border-line/30 bg-bg/50 backdrop-blur-md')
      }
    >
      <div
        className={
          'flex items-center justify-between px-5 transition-all duration-300 md:px-8 ' +
          (scrolled ? 'h-12' : 'h-14')
        }
      >
        <div className="ml-12 flex items-center gap-3 md:ml-0">
          {display ? (
            <span
              className="text-[13px] font-semibold tracking-tight text-white"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              {display}
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <PointsButton />
          <BackgroundTasksButton />
          <LipsyncHistoryButton />
          <ClickUpPilotButton />
        </div>
      </div>
    </header>
  );
}
