'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { BackgroundTasksButton } from './BackgroundTasksButton';
import { CalculadoraButton } from './CalculadoraButton';
import { ClickUpPilotButton } from './ClickUpPilotButton';
import { GlobalSearchButton } from './GlobalSearch';
import { LipsyncHistoryButton } from './LipsyncHistoryButton';
import { PointsButton } from './PointsButton';
import { ThemeToggle } from './ThemeToggle';

/**
 * TopBar v4 — barra fina com título contextual + cluster de ações.
 *
 *  ┌─ Título da rota ─────────────────────── [Pontos · Bg · ⏱ · Pilot] ─┐
 *
 * Os 4 ícones agora vivem dentro de um cluster (.topbar-cluster) —
 * pílula com fundo translúcido e divisor entre grupo "do usuário"
 * (Pontos) e grupo "do trabalho" (Bg/Histórico/Pilot).
 */
const TITLES: Record<string, string> = {
  '/tools': 'Início',
  '/tools/decupagem': 'Decupagem',
  '/tools/camuflagem': 'Camuflagem',
  '/tools/downloader': 'Downloader',
  '/tools/compressor': 'Compressor',
  '/tools/audio-split': 'Dividir áudios',
  '/tools/acelerador': 'Mixer de Velocidade',
  '/tools/normalizador': 'Normalizador',
  '/tools/separador-audio': 'Separador de Áudio',
  '/tools/calculadora': 'Calculadora',
  '/tools/auto-broll': 'Auto B-roll',
  '/tools/troca-produto': 'Troca de produto',
  '/tools/remover-elementos': 'Remover Legenda/Marca d’Água',
  '/tools/decupagem-copy': 'Decupagem Inteligente',
  '/tools/copy-srt': 'Gerador de SRT',
  '/tools/heygen-auto': 'HeyGen Auto',
  '/tools/points': 'Pontos',
  '/tools/background': 'Tarefas em segundo plano',
  '/tools/lipsync-history': 'Histórico de avatares',
  '/tools/clickup-pilot': 'ClickUp Pilot',
  '/tools/voice-test': 'Isolar voz',
  '/configuracoes': 'Configurações',
  '/configuracoes/api': 'Chaves de IA',
  '/configuracoes/clickup-pilot': 'ClickUp Pilot · ajustes',
  '/admin': 'Painel admin',
};

export function TopBar() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 6);
    }
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Resolve título: exato primeiro, senão o prefixo mais longo
  let display: string | undefined = TITLES[pathname];
  if (!display) {
    const matches = Object.keys(TITLES)
      .filter((k) => pathname === k || pathname.startsWith(k + '/'))
      .sort((a, b) => b.length - a.length);
    if (matches.length > 0) display = TITLES[matches[0]];
  }

  return (
    <header
      className={
        'sticky top-0 z-30 border-b transition-all duration-300 ' +
        (scrolled
          ? 'border-line/60 bg-bg/85 backdrop-blur-xl'
          : 'border-line/20 bg-bg/40 backdrop-blur-md')
      }
    >
      <div
        className={
          'flex items-center justify-between gap-4 px-5 transition-all duration-300 md:px-8 ' +
          (scrolled ? 'h-12' : 'h-14')
        }
      >
        {/* Esquerda: título da rota */}
        <div className="ml-12 flex min-w-0 items-center gap-3 md:ml-0">
          {display ? (
            <h2
              className="truncate text-[13.5px] font-bold tracking-tight text-white"
              style={{ fontFamily: 'var(--font-tech)', letterSpacing: '-0.01em' }}
            >
              {display}
            </h2>
          ) : null}
        </div>

        {/* Direita: pílula de busca (3D) + cluster de ícones */}
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <GlobalSearchButton />
          <div className="topbar-cluster">
            <CalculadoraButton />
            <span aria-hidden className="topbar-divider" />
            <PointsButton />
            <BackgroundTasksButton />
            <LipsyncHistoryButton />
            <ClickUpPilotButton />
          </div>
        </div>
      </div>
    </header>
  );
}
