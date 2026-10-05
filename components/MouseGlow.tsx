'use client';

import { useEffect, useRef } from 'react';

/**
 * Spotlight global que segue o mouse (o brilho violeta sutil atrás do
 * conteúdo) + o glow local dos cards `.card-3d`.
 *
 * PERFORMANCE (05.10): antes isto gravava --mx/--my no :root a cada
 * movimento, e o spotlight era um `body::before` lendo essas variáveis.
 * Variável no :root é HERDADA por todo elemento — cada movimento do mouse
 * recalculava o estilo da página INTEIRA (~22 ms por movimento só na
 * landing, medido; nas ferramentas, com 10x mais elementos, travava tudo).
 * Agora o spotlight é um elemento próprio movido por `transform` — o
 * compositor da GPU move a camada e nenhum outro elemento é recalculado.
 * O gradiente é o mesmo (raio, cor, queda), só que centrado no elemento.
 */
export function MouseGlow() {
  const spotRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const prefersReduced = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    if (prefersReduced) return;

    let rafId = 0;
    let pendingX = 0;
    let pendingY = 0;
    let pendingTarget: HTMLElement | null = null;

    function flush() {
      rafId = 0;
      const spot = spotRef.current;
      if (spot) {
        spot.style.transform = `translate3d(${pendingX}px, ${pendingY}px, 0)`;
      }

      // Glow local no card sob o cursor (variáveis no PRÓPRIO card, então só
      // ele é recalculado). Medido no frame, não no evento: o
      // getBoundingClientRect fora do frame forçava layout a cada evento.
      const target = pendingTarget;
      pendingTarget = null;
      if (!target || !target.isConnected || typeof target.closest !== 'function') return;
      const card = target.closest<HTMLElement>('.card-3d');
      if (card) {
        const rect = card.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          card.style.setProperty(
            '--gx',
            ((pendingX - rect.left) / rect.width) * 100 + '%',
          );
          card.style.setProperty(
            '--gy',
            ((pendingY - rect.top) / rect.height) * 100 + '%',
          );
        }
      }
    }

    function onMove(e: MouseEvent) {
      pendingX = e.clientX;
      pendingY = e.clientY;
      pendingTarget = e.target as HTMLElement | null;
      if (!rafId) rafId = requestAnimationFrame(flush);
    }

    window.addEventListener('mousemove', onMove, { passive: true });
    return () => {
      window.removeEventListener('mousemove', onMove);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []);

  // Posição inicial = a do antigo --mx/--my padrão (50vw, -10vh).
  return (
    <div
      ref={spotRef}
      aria-hidden
      className="mouse-spotlight"
      style={{ transform: 'translate3d(50vw, -10vh, 0)' }}
    />
  );
}
