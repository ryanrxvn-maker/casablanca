'use client';

/**
 * PilotHero — o herói do Pilot (09.10): sem copy, só o nome e a cena.
 *
 * Mesmo lugar e mesma faixa do herói antigo (topo do ToolShell), montado como
 * uma TELA embutida no painel de metal (o acabamento Hardware da página):
 *   • a cena é WebGL (pilot-hero-engine): cérebro de partículas que vira
 *     código, e o código vira avatar real em holograma nos projetores;
 *   • "PILOT" em cromado usinado (Michroma), com profundidade, reflexo no
 *     chão de vidro e um ponto de luz especular que segue o mouse.
 *
 * O mouse mexe em tudo sem re-render: variáveis CSS só neste bloco (nunca no
 * :root) e o motor lê o ponteiro sozinho. Sem WebGL = fica a tela escura com o
 * lettering (nada quebra).
 */

import localFont from 'next/font/local';
import { memo, useEffect, useRef } from 'react';
import { startPilotHero } from './pilot-hero-engine';

const wordmark = localFont({
  src: '../../public/fonts/michroma.woff2',
  variable: '--font-pilot-word',
  weight: '400',
  display: 'swap',
});

function PilotHeroImpl() {
  const rootRef = useRef<HTMLElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wordRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    const root = rootRef.current, canvas = canvasRef.current, word = wordRef.current;
    if (!root || !canvas || !word) return;
    const engine = startPilotHero(canvas, { atlas: '/pilot-hero/holo-atlas.mp4', poster: '/pilot-hero/holo-atlas.jpg' });
    root.dataset.gl = engine ? 'on' : 'off';

    let raf = 0, px = 0, py = 0, lx = -1, ly = -1;
    const flush = () => {
      raf = 0;
      root.style.setProperty('--par-x', px.toFixed(3));
      root.style.setProperty('--par-y', py.toFixed(3));
      if (lx >= 0) {
        word.style.setProperty('--lx', `${lx.toFixed(0)}px`);
        word.style.setProperty('--ly', `${ly.toFixed(0)}px`);
      }
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const r = root.getBoundingClientRect();
      px = ((e.clientX - r.left) / r.width - 0.5) * 2;
      py = ((e.clientY - r.top) / r.height - 0.5) * 2;
      const w = word.getBoundingClientRect();
      lx = e.clientX - w.left;
      ly = e.clientY - w.top;
      root.dataset.pointer = 'on';
      if (!raf) raf = requestAnimationFrame(flush);
    };
    const onLeave = () => {
      px = py = 0;
      lx = ly = -1;
      delete root.dataset.pointer;
      word.style.removeProperty('--lx');
      word.style.removeProperty('--ly');
      if (!raf) raf = requestAnimationFrame(flush);
    };
    root.addEventListener('pointermove', onMove, { passive: true });
    root.addEventListener('pointerleave', onLeave);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      root.removeEventListener('pointermove', onMove);
      root.removeEventListener('pointerleave', onLeave);
      engine?.destroy();
    };
  }, []);

  return (
    <header ref={rootRef} className={`pilot-hero ${wordmark.variable}`}>
      <div className="pilot-hero__screen">
        <canvas ref={canvasRef} className="pilot-hero__gl" aria-hidden />
        <div className="pilot-hero__glass" aria-hidden />
        <div className="pilot-hero__brand">
          <h1 ref={wordRef} className="pilot-hero__word" aria-label="Pilot">
            <span className="pilot-hero__word-depth" aria-hidden>Pilot</span>
            <span className="pilot-hero__word-face" aria-hidden>Pilot</span>
            <span className="pilot-hero__word-spec ae-ambient" aria-hidden>Pilot</span>
          </h1>
        </div>
      </div>
    </header>
  );
}

export const PilotHero = memo(PilotHeroImpl);
