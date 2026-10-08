'use client';

/**
 * ui — peças de texto compartilhadas da landing v4.
 *
 *   ToolTag     → selo da ferramenta (pílula em frase, sem caixa alta).
 *   SectionHead → o padrão de copy que o Silas pediu (07.10): uma PERGUNTA que
 *                 dá o gatilho e, logo embaixo, a RESPOSTA com a solução. A
 *                 resposta entra palavra por palavra, do jeito que as legendas
 *                 da ferramenta entram, e a palavra-chave ganha uma tarja na
 *                 cor da ferramenta.
 *
 * SSR mostra tudo pronto (crawler e reduced-motion leem certo); a animação só
 * arma depois do mount.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { reducedMotion, useInView } from '../v3/kit';

export function ToolTag({ tone, label }: { tone: string; label: string }) {
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[12.5px] font-semibold"
      style={{ fontFamily: 'var(--font-label)', color: tone, borderColor: `${tone}4d`, background: `${tone}12` }}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: tone }} />
      {label}
    </span>
  );
}

/** Pedaço da resposta: texto normal ou trecho com tarja. */
export type Seg = string | { mark: string };

/** cor de texto que lê em cima da tarja (tom claro pede texto escuro) */
function inkOn(tone: string): string {
  const h = tone.replace('#', '');
  if (h.length !== 6) return '#fff';
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#17120a' : '#fff';
}

export function SectionHead({
  tone,
  tag,
  ask,
  answer,
  lead,
  align = 'left',
  size = 'lg',
  children,
}: {
  tone: string;
  tag?: string;
  ask: string;
  answer: Seg[];
  lead?: ReactNode;
  align?: 'left' | 'center';
  size?: 'md' | 'lg' | 'xl';
  children?: ReactNode;
}) {
  const { ref, inView } = useInView<HTMLDivElement>(0.3);
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!reducedMotion()) setArmed(true);
  }, []);

  // quebra a resposta em palavras, mantendo o trecho com tarja inteiro.
  // ⚠ estes spans são montados FORA do return: o styled-jsx não põe a classe
  // de escopo neles, por isso o CSS de .shw/.shm/.shm-box é :global (07.10)
  let wi = 0;
  const words: ReactNode[] = [];
  answer.forEach((seg, si) => {
    if (typeof seg === 'string') {
      const parts = seg.split(' ').filter(Boolean);
      parts.forEach((w, k) => {
        const i = wi++;
        words.push(
          <span key={`${si}-${k}`} className="shw" style={{ ['--i' as string]: i }}>
            {w + ' '}
          </span>,
        );
      });
    } else {
      const i = wi++;
      words.push(
        <span key={`${si}-m`} className="shw shm" style={{ ['--i' as string]: i, color: inkOn(tone) }}>
          <span aria-hidden className="shm-box" style={{ background: tone }} />
          <span className="relative">{seg.mark}</span>
          {' '}
        </span>,
      );
    }
  });
  const nWords = wi;

  return (
    <div
      ref={ref}
      className={
        'sh ' +
        (armed ? 'sh-armed ' : '') +
        (inView ? 'sh-in ' : '') +
        (align === 'center' ? 'mx-auto text-center ' : '') +
        (size === 'xl' ? 'max-w-[980px]' : 'max-w-[900px]')
      }
      style={{ ['--n' as string]: nWords }}
    >
      {tag && (
        <div className="sh-tag">
          <ToolTag tone={tone} label={tag} />
        </div>
      )}
      <p className="sh-ask mt-5" style={{ fontFamily: 'var(--font-serif)' }}>
        {ask}
      </p>
      <h2
        className={'sh-answer mt-2 text-white ' + (size === 'xl' ? 'is-xl' : size === 'md' ? 'is-md' : '')}
        style={{ fontFamily: 'var(--font-tech)' }}
      >
        {words}
      </h2>
      {lead && (
        <p className={'sh-lead mt-5 text-[16.5px] leading-[1.7] text-white/[0.66] ' + (align === 'center' ? 'mx-auto' : '')}>
          {lead}
        </p>
      )}
      {children}

      <style jsx>{`
        .sh-ask {
          font-style: italic;
          font-weight: 400;
          font-size: clamp(24px, 2.6vw, 34px);
          line-height: 1.15;
          color: rgba(255, 255, 255, 0.7);
          letter-spacing: -0.005em;
        }
        .sh-answer {
          font-weight: 800;
          font-size: clamp(36px, 4.6vw, 64px);
          line-height: 1.02;
          letter-spacing: -0.03em;
        }
        .sh-answer.is-xl {
          font-size: clamp(40px, 5.6vw, 80px);
        }
        .sh-answer.is-md {
          font-size: clamp(34px, 3.6vw, 52px);
        }
        .sh-lead {
          max-width: 60ch;
        }
        :global(.shw) {
          display: inline-block;
          white-space: pre;
        }
        :global(.shm) {
          position: relative;
          padding: 0 0.14em;
          margin: 0 0.02em;
          /* trecho com tarja quebra linha quando não cabe (celular) */
          white-space: normal;
          max-width: 100%;
        }
        :global(.shm-box) {
          position: absolute;
          inset: 0.08em -0.02em 0.04em;
          border-radius: 0.12em;
          transform: rotate(-1.5deg);
          transform-origin: 0 50%;
          box-shadow: 0 0.12em 0 rgba(0, 0, 0, 0.35);
        }
        /* armado: espera entrar na tela; dentro: pergunta, depois palavra por palavra */
        .sh-armed .sh-ask,
        .sh-armed .sh-tag,
        .sh-armed .sh-lead {
          opacity: 0;
          transform: translate3d(0, 12px, 0);
        }
        .sh-armed :global(.shw) {
          opacity: 0;
          transform: translate3d(0, 0.45em, 0);
        }
        .sh-armed :global(.shm-box) {
          transform: rotate(-1.5deg) scaleX(0);
        }
        .sh-armed.sh-in .sh-tag {
          animation: sh-up 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        .sh-armed.sh-in .sh-ask {
          animation: sh-up 0.7s 0.08s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        .sh-armed.sh-in :global(.shw) {
          animation: sh-word 0.62s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          animation-delay: calc(0.45s + var(--i) * 70ms);
        }
        .sh-armed.sh-in :global(.shm-box) {
          animation: sh-mark 0.55s cubic-bezier(0.32, 0.72, 0, 1) forwards;
          animation-delay: calc(0.6s + var(--n) * 70ms);
        }
        .sh-armed.sh-in .sh-lead {
          animation: sh-up 0.7s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          animation-delay: calc(0.6s + var(--n) * 70ms);
        }
        @keyframes sh-up {
          to {
            opacity: 1;
            transform: none;
          }
        }
        @keyframes sh-word {
          to {
            opacity: 1;
            transform: none;
          }
        }
        @keyframes sh-mark {
          to {
            transform: rotate(-1.5deg) scaleX(1);
          }
        }
      `}</style>
    </div>
  );
}
