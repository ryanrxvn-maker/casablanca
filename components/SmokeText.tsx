'use client';

import { useState } from 'react';

/**
 * SmokeText — texto que vira fumaça no hover.
 *
 * Cada letra é um <span> independente. No hover, as letras se dissolvem
 * em sequência (stagger por índice) — translateY + scale + blur + opacity.
 * Quando o mouse sai, a sequência inverte.
 *
 * Usado em:
 *  • Brand (wordmark da topbar/sidebar)
 *  • Landing (títulos, parágrafos, listas)
 *  • Login (subtítulos)
 */
export function SmokeText({
  text,
  className = '',
  /** Quando true, o texto é cor-no-gradient (default true) */
  gradient = false,
}: {
  text: string;
  className?: string;
  gradient?: boolean;
}) {
  const [hover, setHover] = useState(false);
  const letters = Array.from(text);

  return (
    <span
      className={'smoke-text inline-block ' + className}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      data-state={hover ? 'gone' : 'idle'}
      data-gradient={gradient ? 'on' : 'off'}
      aria-label={text}
    >
      {letters.map((ch, i) => {
        const isSpace = ch === ' ';
        return (
          <span
            key={i}
            className="smoke-letter inline-block"
            aria-hidden
            style={{
              transitionDelay: hover ? `${i * 22}ms` : `${(letters.length - 1 - i) * 18}ms`,
            }}
          >
            {isSpace ? ' ' : ch}
          </span>
        );
      })}

      <style jsx>{`
        .smoke-text {
          position: relative;
          cursor: pointer;
        }
        .smoke-text[data-gradient='on'] {
          background: linear-gradient(135deg, #f5e8ff 0%, #c084fc 100%);
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        .smoke-letter {
          display: inline-block;
          will-change: transform, filter, opacity;
          transition:
            transform 520ms cubic-bezier(0.22, 1, 0.36, 1),
            filter 520ms cubic-bezier(0.22, 1, 0.36, 1),
            opacity 520ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .smoke-text[data-state='gone'] .smoke-letter {
          opacity: 0;
          filter: blur(14px);
          transform: translateY(-22px) translateX(var(--sx, 0px)) scale(1.35) rotate(var(--sr, 0deg));
        }
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
        .smoke-text .smoke-letter:nth-child(5n) {
          --sx: -8px;
          --sr: 6deg;
        }
        .smoke-text[data-state='idle'] .smoke-letter {
          opacity: 1;
          filter: blur(0);
          transform: translateY(0) translateX(0) scale(1) rotate(0);
        }
      `}</style>
    </span>
  );
}
