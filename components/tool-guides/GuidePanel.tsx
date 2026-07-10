'use client';

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

import { GUIDES } from './guides';

/**
 * Card flutuante do guia — abre por cima de tudo, com passo a passo visual.
 * ESC, clique no fundo ou no ✕ fecham. Scroll do body travado enquanto aberto.
 */
export function GuidePanel({
  path,
  onClose,
}: {
  path: string;
  onClose: () => void;
}) {
  const guide = GUIDES[path];
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!guide && process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.warn(`[ToolGuide] rota sem guia registrado: ${path}`);
    }
  }, [guide, path]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  if (!guide) return null;

  return createPortal(
    <div
      className="guide-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Guia — ${guide.title}`}
        className={'guide-card' + (guide.size === 'large' ? ' guide-card--large' : '')}
      >
        {/* Cabeçalho fixo */}
        <div className="flex items-start justify-between gap-4 px-6 pb-4 pt-6 md:px-7">
          <div>
            <p
              className="mb-1.5 text-[10.5px] font-bold uppercase tracking-[0.18em] text-violet"
              style={{ fontFamily: 'var(--font-label)' }}
            >
              Guia da ferramenta
            </p>
            <h2
              className="text-[20px] font-bold leading-tight text-text md:text-[22px]"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              {guide.title}
            </h2>
            <p className="mt-1 text-[13px] leading-relaxed text-text-muted">
              {guide.tagline}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Fechar guia"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line-strong bg-bg-elev text-text-muted transition-all hover:border-violet/60 hover:text-text"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path
                d="M2 2l10 10M12 2L2 12"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <div className="divider-grad mx-6 md:mx-7" />

        {/* Passos */}
        <div className="guide-card__scroll px-6 pt-5 md:px-7">
          <ol className="flex flex-col gap-6">
            {guide.steps.map((step, i) => (
              <li key={i} className="flex gap-4">
                <span
                  className="mono mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-violet/40 bg-violet/10 text-[12px] font-bold text-violet"
                  aria-hidden
                >
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <h3
                    className="text-[14.5px] font-bold text-text"
                    style={{ fontFamily: 'var(--font-tech)' }}
                  >
                    {step.title}
                  </h3>
                  <div className="mt-1 text-[13px] leading-relaxed text-text-muted">
                    {step.text}
                  </div>
                  {step.visual ? <div className="mt-3">{step.visual}</div> : null}
                </div>
              </li>
            ))}
          </ol>

          {guide.tips && guide.tips.length > 0 ? (
            <div className="mt-7 rounded-[14px] border border-lime/25 bg-lime/[0.06] px-4 py-3.5">
              <p
                className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.16em]"
                style={{ fontFamily: 'var(--font-label)', color: 'rgb(var(--lime))' }}
              >
                Bom saber
              </p>
              <ul className="flex flex-col gap-1.5">
                {guide.tips.map((tip, i) => (
                  <li
                    key={i}
                    className="flex gap-2 text-[12.5px] leading-relaxed text-text-muted"
                  >
                    <span aria-hidden style={{ color: 'rgb(var(--lime))' }}>
                      ·
                    </span>
                    {tip}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
