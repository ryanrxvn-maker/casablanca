'use client';

import { useRef, useState } from 'react';

/**
 * SmokeText v4 — esfumaçado sutil + nunca quebra palavra no meio.
 *
 * Estrutura crítica:
 *   <wrapper>
 *     <word> ← display:inline-block + white-space:nowrap (NÃO quebra)
 *       <letter/><letter/><letter/>
 *     </word>
 *     <space/>
 *     <word>...</word>
 *   </wrapper>
 *
 * O navegador pode quebrar entre palavras (espaços), mas NUNCA dentro de
 * uma palavra — porque cada palavra é um inline-block que não quebra.
 * Isso resolve o bug de "automático" virar "automát-ico".
 *
 * A animação: cada letra mede distância pro cursor e ganha blur sutil
 * proporcional (máx 5px), translateY -4px, scale +0.08. Mouse-out volta
 * todas as letras a 0 suavemente.
 *
 * Use só em headlines grandes.
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

  // Tokeniza por espaço; mantém o espaço como token separado pra preservar
  // largura natural quando renderizado.
  const tokens: Array<{ kind: 'word' | 'space'; chars: string[] }> = [];
  let current: string[] = [];
  for (const ch of Array.from(text)) {
    if (ch === ' ') {
      if (current.length) {
        tokens.push({ kind: 'word', chars: current });
        current = [];
      }
      tokens.push({ kind: 'space', chars: [' '] });
    } else {
      current.push(ch);
    }
  }
  if (current.length) tokens.push({ kind: 'word', chars: current });

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
      const t = Math.min(1, dist / maxDist);
      const intensity = 1 - t;
      el.style.setProperty('--d', intensity.toFixed(3));
    }
  };

  const onLeave = () => {
    setActive(false);
    for (const el of lettersRef.current) {
      if (!el) continue;
      el.style.setProperty('--d', '0');
    }
  };

  // Reset do index das letras pra mapear corretamente entre palavras
  let letterIdx = 0;

  return (
    <span
      ref={wrapRef}
      className={'smoke-text inline ' + className}
      onMouseEnter={() => setActive(true)}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      data-active={active ? 'on' : 'off'}
      aria-label={text}
    >
      {tokens.map((tok, i) => {
        if (tok.kind === 'space') {
          // Espaço como nó de texto puro (permite quebra natural aqui).
          return <span key={`s-${i}`}> </span>;
        }
        // Palavra: inline-block + nowrap → letras animam, mas a palavra
        // permanece inteira em uma linha.
        return (
          <span key={`w-${i}`} className="smoke-word" aria-hidden>
            {tok.chars.map((ch) => {
              const idx = letterIdx++;
              return (
                <span
                  key={idx}
                  ref={(el) => {
                    lettersRef.current[idx] = el;
                  }}
                  className="smoke-letter"
                >
                  {ch}
                </span>
              );
            })}
          </span>
        );
      })}

      <style jsx>{`
        .smoke-text {
          cursor: pointer;
          /* Garante quebra apenas entre palavras */
          word-break: normal;
          overflow-wrap: normal;
          -webkit-hyphens: none;
          hyphens: none;
        }
        .smoke-word {
          display: inline-block;
          white-space: nowrap;
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
        .smoke-text[data-active='on'] .smoke-letter {
          filter: blur(calc(var(--d) * 5px));
          transform: translateY(calc(var(--d) * -4px)) scale(calc(1 + var(--d) * 0.08));
          opacity: calc(1 - var(--d) * 0.45);
        }
      `}</style>
    </span>
  );
}
