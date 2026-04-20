'use client';

import { useEffect } from 'react';

/**
 * Atualiza as variaveis CSS --mx/--my no :root com a posicao do mouse
 * (clamped pra viewport). Usado pra criar o spotlight global no body::before.
 *
 * Tambem propaga para elementos com data-glow que possuem --gx/--gy locais
 * (card-3d lookup), dando o efeito de "light follows cursor within card".
 */
export function MouseGlow() {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const prefersReduced = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    if (prefersReduced) return;

    let rafId = 0;
    let pendingX = 0;
    let pendingY = 0;

    function flush() {
      rafId = 0;
      document.documentElement.style.setProperty('--mx', pendingX + 'px');
      document.documentElement.style.setProperty('--my', pendingY + 'px');
    }

    function onMove(e: MouseEvent) {
      pendingX = e.clientX;
      pendingY = e.clientY;
      if (!rafId) rafId = requestAnimationFrame(flush);

      // Atualiza glow local nos cards que o cursor esta sobre.
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const card = target.closest<HTMLElement>('.card-3d');
      if (card) {
        const rect = card.getBoundingClientRect();
        card.style.setProperty(
          '--gx',
          ((e.clientX - rect.left) / rect.width) * 100 + '%',
        );
        card.style.setProperty(
          '--gy',
          ((e.clientY - rect.top) / rect.height) * 100 + '%',
        );
      }
    }

    window.addEventListener('mousemove', onMove, { passive: true });
    return () => {
      window.removeEventListener('mousemove', onMove);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []);

  return null;
}
