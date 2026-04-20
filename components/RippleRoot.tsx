'use client';

import { useEffect } from 'react';

/**
 * Global click ripple em qualquer botao [data-ripple] OU em botoes de classe
 * btn-primary / btn-secondary. Respeita prefers-reduced-motion.
 */
export function RippleRoot() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    function onDown(e: MouseEvent) {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      const btn = t.closest<HTMLElement>(
        'button.btn-primary, button.btn-secondary, [data-ripple]',
      );
      if (!btn) return;
      if (btn.hasAttribute('disabled')) return;
      const rect = btn.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const dot = document.createElement('span');
      dot.className = 'ripple-dot';
      dot.style.setProperty('--rx', x + 'px');
      dot.style.setProperty('--ry', y + 'px');
      // garante position:relative no botao (css ja aplica overflow hidden
      // em btn-primary/btn-secondary)
      const prevPos = getComputedStyle(btn).position;
      if (prevPos === 'static') btn.style.position = 'relative';
      btn.appendChild(dot);
      setTimeout(() => {
        dot.remove();
      }, 650);
    }

    window.addEventListener('mousedown', onDown, { passive: true });
    return () => window.removeEventListener('mousedown', onDown);
  }, []);

  return null;
}
