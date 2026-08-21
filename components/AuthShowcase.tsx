'use client';

/**
 * AuthShowcase — o palco do login: um banner temático por ferramenta,
 * trocando sozinho de 6 em 6 segundos com deslize lateral. Cada slide usa a
 * CENA REAL da landing (as Legendas rodam o engine de verdade, a Decupagem
 * anima a timeline, o telejornal digita a manchete) + uma copy própria da
 * ferramenta.
 *
 * As cenas ficam empilhadas na MESMA célula de grid: a altura do palco é a da
 * cena mais alta, então a troca não faz a página pular. Passar o mouse pausa
 * a rotação; os pontos embaixo trocam na mão.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { reducedMotion } from './landing/v3/kit';
import {
  CamuflagemScene,
  DecupagemScene,
  LegendasScene,
  TelejornalCard,
} from './landing/v3/scenes';

const ROTATE_MS = 6000;

type Slide = {
  id: string;
  tag: string;
  tone: string;
  copy: string;
  scene: ReactNode;
};

const SLIDES: Slide[] = [
  {
    id: 'legendas',
    tag: 'Legendas Automáticas',
    tone: '#ffd60a',
    copy:
      'A fala do seu vídeo vira legenda animada, palavra por palavra — e esse card é o motor real da ferramenta rodando, não um vídeo.',
    scene: <LegendasScene />,
  },
  {
    id: 'decupagem',
    tag: 'Decupagem',
    tone: '#c8d684',
    copy:
      'Sobe o vídeo e recebe de volta sem os silêncios, com a voz nivelada — em lote, direto no navegador.',
    scene: <DecupagemScene />,
  },
  {
    id: 'fakeprint',
    tag: 'FakePrint',
    tone: '#e0483f',
    copy:
      'Manchete de telejornal, portal de notícia e print de conversa do jeito que a sua história pede — 41 modelos com tela verde.',
    scene: <TelejornalCard />,
  },
  {
    id: 'camuflagem',
    tag: 'Camuflagem',
    tone: '#3ec7bb',
    copy:
      'Quem assiste ouve o seu áudio. A transcrição das plataformas lê a trilha que você deixou por baixo.',
    scene: <CamuflagemScene />,
  },
];

export function AuthShowcase() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused || reducedMotion()) return;
    const id = setTimeout(() => setActive((v) => (v + 1) % SLIDES.length), ROTATE_MS);
    return () => clearTimeout(id);
  }, [active, paused]);

  const current = SLIDES[active] ?? SLIDES[0]!;

  return (
    <div onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      {/* palco — todas as cenas na mesma célula; a ativa desliza pra dentro */}
      <div className="grid">
        {SLIDES.map((s, i) => {
          // posição relativa no ciclo: 0 = ativa, len-1 = acabou de sair
          // (sai pela esquerda), resto espera à direita.
          const rel = (i - active + SLIDES.length) % SLIDES.length;
          const activeNow = rel === 0;
          const leaving = rel === SLIDES.length - 1;
          return (
            <div
              key={s.id}
              aria-hidden={!activeNow || undefined}
              className={
                'col-start-1 row-start-1 flex items-center transition-all duration-700 ease-[cubic-bezier(.16,.84,.28,1)] ' +
                (activeNow
                  ? 'pointer-events-auto translate-x-0 opacity-100'
                  : leaving
                    ? 'pointer-events-none -translate-x-9 opacity-0'
                    : 'pointer-events-none translate-x-9 opacity-0')
              }
            >
              <div className="w-full">{s.scene}</div>
            </div>
          );
        })}
      </div>

      {/* a copy da ferramenta em cena */}
      <div key={current.id} className="as-in mt-5 min-h-[64px]">
        <span
          className="inline-flex items-center rounded-[4px] px-2 py-1 text-[9.5px] font-bold uppercase tracking-[0.2em]"
          style={{
            fontFamily: 'var(--font-label)',
            color: current.tone,
            border: `1px solid ${current.tone}55`,
            background: `${current.tone}14`,
          }}
        >
          {current.tag}
        </span>
        <p className="mt-2 max-w-[58ch] text-[13.5px] leading-relaxed text-text-muted">
          {current.copy}
        </p>
      </div>

      {/* navegação */}
      <div className="mt-4 flex items-center gap-2">
        {SLIDES.map((s, i) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setActive(i)}
            aria-label={`Ver ${s.tag}`}
            aria-current={i === active || undefined}
            className="group flex h-6 items-center"
          >
            <span
              className="block h-[3px] rounded-full transition-all duration-500"
              style={{
                width: i === active ? 26 : 12,
                background:
                  i === active ? s.tone : 'rgba(255,255,255,0.18)',
              }}
            />
          </button>
        ))}
      </div>

      <style jsx>{`
        .as-in {
          animation: as-in 560ms cubic-bezier(0.16, 0.84, 0.28, 1) both;
        }
        @keyframes as-in {
          from {
            opacity: 0;
            transform: translateY(7px);
          }
          to {
            opacity: 1;
            transform: none;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .as-in {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}
