'use client';

import { useState } from 'react';

/**
 * SmokeText — wordmark com efeito "vira fumaça" no hover.
 *
 * Cada letra é um <span> independente. No hover, as letras se dissolvem
 * em sequência (stagger por índice) — translateY + scale + blur + opacity.
 * Quando o mouse sai, a sequência inverte (letras "remontam" da fumaça).
 *
 * Detalhe técnico: usamos data-state pra controlar a animação via CSS;
 * isso evita re-render no React e mantém o efeito GPU-only (60fps).
 */
export function SmokeText({
  text,
  className = '',
}: {
  text: string;
  className?: string;
}) {
  const [hover, setHover] = useState(false);
  const letters = Array.from(text);

  return (
    <span
      className={'smoke-text inline-block ' + className}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      data-state={hover ? 'gone' : 'idle'}
      aria-label={text}
      style={{ fontFamily: 'var(--font-tech)', fontWeight: 800, letterSpacing: '-0.02em' }}
    >
      {letters.map((ch, i) => {
        const isSpace = ch === ' ';
        return (
          <span
            key={i}
            className="smoke-letter inline-block"
            aria-hidden
            // Delay escalonado pra criar onda — entrada da esquerda pra direita
            style={{
              animationDelay: `${i * 38}ms`,
              transitionDelay: hover ? `${i * 38}ms` : `${(letters.length - 1 - i) * 28}ms`,
            }}
          >
            {isSpace ? ' ' : ch}
          </span>
        );
      })}

      <style jsx>{`
        .smoke-text {
          position: relative;
          color: #fff;
          cursor: pointer;
        }
        .smoke-letter {
          display: inline-block;
          will-change: transform, filter, opacity;
          transition:
            transform 520ms cubic-bezier(0.22, 1, 0.36, 1),
            filter 520ms cubic-bezier(0.22, 1, 0.36, 1),
            opacity 520ms cubic-bezier(0.22, 1, 0.36, 1),
            color 200ms ease;
          color: #fff;
        }
        /* "AUTO" recebe a cor neon — a parte da assinatura */
        .smoke-text :nth-child(1),
        .smoke-text :nth-child(2),
        .smoke-text :nth-child(3),
        .smoke-text :nth-child(4) {
          background: linear-gradient(135deg, #f5e8ff 0%, #c084fc 100%);
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        /* Estado "fumaça" — letra sobe, gira, espalha, blurra, some */
        .smoke-text[data-state='gone'] .smoke-letter {
          opacity: 0;
          filter: blur(14px);
          transform: translateY(-22px) translateX(var(--sx, 0px)) scale(1.35) rotate(var(--sr, 0deg));
        }
        /* Variação aleatória entre letras (offsets diferentes via nth) */
        .smoke-text .smoke-letter:nth-child(odd) {
          --sx: -6px;
          --sr: -8deg;
        }
        .smoke-text .smoke-letter:nth-child(even) {
          --sx: 7px;
          --sr: 9deg;
        }
        .smoke-text .smoke-letter:nth-child(3n) {
          --sx: -3px;
          --sr: 14deg;
        }
        .smoke-text .smoke-letter:nth-child(4n + 1) {
          --sx: 9px;
          --sr: -12deg;
        }

        /* Estado idle — letra firme, com leve hover-respiro */
        .smoke-text[data-state='idle'] .smoke-letter {
          opacity: 1;
          filter: blur(0);
          transform: translateY(0) translateX(0) scale(1) rotate(0);
        }
      `}</style>
    </span>
  );
}
