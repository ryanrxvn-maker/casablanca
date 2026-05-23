'use client';

import { useRef, useState } from 'react';

/**
 * SmokeText v3 — esfumaçado SUTIL que acompanha o mouse.
 *
 * Em vez de "explodir" as letras na entrada do hover, agora calcula a
 * distância de cada letra até o cursor e aplica um blur progressivo
 * (mais perto do cursor = mais fumaça). A animação é leve, sem grandes
 * deslocamentos. Quando o mouse sai, todas as letras voltam a 0 suave.
 *
 * Use APENAS em headlines grandes (h1/h2). Não usar em parágrafos,
 * listas ou textos pequenos — fica visualmente carregado.
 */
export function SmokeText({
  text,
  className = '',
}: {
  text: string;
  className?: string;
}) {
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const lettersRef = useRef<Array<HTMLSpanElement | null>>([]);
  const [active, setActive] = useState(false);

  const letters = Array.from(text);

  // Recalcula intensidade por letra baseado na posição do mouse.
  // Cada letra ganha --d (distância 0..1) que vira blur via CSS.
  const onMove = (e: React.MouseEvent<HTMLSpanElement>) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const wrapRect = wrap.getBoundingClientRect();
    const mx = e.clientX;
    const my = e.clientY;
    const maxDist = Math.max(wrapRect.width * 0.4, 120);

    for (const el of lettersRef.current) {
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const dx = cx - mx;
      const dy = cy - my;
      const dist = Math.sqrt(dx * dx + dy * dy);
      // 0 = bem perto do mouse (fumaça forte), 1 = longe (normal)
      const t = Math.min(1, dist / maxDist);
      const intensity = 1 - t; // 0..1, alto = perto
      el.style.setProperty('--d', String(intensity.toFixed(3)));
    }
  };

  const onLeave = () => {
    setActive(false);
    for (const el of lettersRef.current) {
      if (!el) continue;
      el.style.setProperty('--d', '0');
    }
  };

  return (
    <span
      ref={wrapRef}
      className={'smoke-text inline-block ' + className}
      onMouseEnter={() => setActive(true)}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      data-active={active ? 'on' : 'off'}
      aria-label={text}
    >
      {letters.map((ch, i) => (
        <span
          key={i}
          ref={(el) => {
            lettersRef.current[i] = el;
          }}
          className="smoke-letter inline-block"
          aria-hidden
        >
          {ch === ' ' ? ' ' : ch}
        </span>
      ))}

      <style jsx>{`
        .smoke-text {
          position: relative;
          cursor: pointer;
        }
        .smoke-letter {
          display: inline-block;
          will-change: filter, transform, opacity;
          --d: 0;
          transition:
            filter 350ms cubic-bezier(0.22, 1, 0.36, 1),
            transform 350ms cubic-bezier(0.22, 1, 0.36, 1),
            opacity 350ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        /* Quando há um valor --d > 0, a letra "fumacha" proporcionalmente.
         * Blur máx 5px, lift máx -4px, opacity mín 0.55 — bem mais sutil
         * que a versão anterior (era blur 14px, scale 1.35). */
        .smoke-text[data-active='on'] .smoke-letter {
          filter: blur(calc(var(--d) * 5px));
          transform: translateY(calc(var(--d) * -4px)) scale(calc(1 + var(--d) * 0.08));
          opacity: calc(1 - var(--d) * 0.45);
        }
      `}</style>
    </span>
  );
}
