'use client';

import { useEffect } from 'react';

/** One delegated listener; only the hovered card updates, at most once per frame. */
export function PointerLight() {
  useEffect(() => {
    const fine = window.matchMedia('(pointer:fine)');
    const reduced = window.matchMedia('(prefers-reduced-motion:reduce)');
    let frame = 0;
    let target: HTMLElement | null = null;
    let x = 0; let y = 0;
    const move = (event: PointerEvent) => {
      if (!fine.matches || reduced.matches) return;
      const card = (event.target as Element | null)?.closest<HTMLElement>('.ae-hub-card');
      if (!card) return;
      target=card; x=event.clientX; y=event.clientY;
      if (frame) return;
      frame=requestAnimationFrame(() => {
        frame=0;
        if (!target?.isConnected) return;
        const rect=target.getBoundingClientRect();
        target.style.setProperty('--pointer-x', `${x-rect.left}px`);
        target.style.setProperty('--pointer-y', `${y-rect.top}px`);
      });
    };
    document.addEventListener('pointermove',move,{passive:true});
    return () => { document.removeEventListener('pointermove',move); cancelAnimationFrame(frame); };
  }, []);
  return null;
}
