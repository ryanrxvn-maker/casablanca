'use client';

/**
 * PilotModeHub — o visor de entrada do Pilot: DE ONDE vem a task.
 *
 *  CREATOR  · task do zero; a copy é colada no card
 *  DOCS     · Google Docs importado (arquivo ou link); lista todos os ADs dele
 *  CLICKUP  · as tasks do ClickUp — o fluxo de sempre
 *
 * Só muda a origem. Análise, disparo, pós-produção e fila são os mesmos.
 *
 * Visual: três cartões de bisel duplo. O ativo acende na cor do modo e a
 * sombra é TINGIDA por ela (nunca cinza); os outros ficam em hairline. É um
 * radiogroup de verdade: setas navegam, Enter/Espaço escolhem.
 */

import type { ReactNode } from 'react';
import type { ModoPilot } from '@/lib/pilot-fontes';

type Cor = { rgb: string; grad: string; ink: string };

/** Cor presa à identidade do modo, nunca à posição. Lime é a cor da casa
 *  (ClickUp, o modo de sempre); ciano = documento; âmbar = criação. */
const COR: Record<ModoPilot, Cor> = {
  creator: { rgb: '251,191,36', grad: 'linear-gradient(135deg, #fcd57a 0%, #f0b429 100%)', ink: '#1a1203' },
  docs: { rgb: '34,211,238', grad: 'linear-gradient(135deg, #7fe4f5 0%, #22d3ee 100%)', ink: '#04121a' },
  clickup: { rgb: '200,232,124', grad: 'linear-gradient(135deg, #c2cf86 0%, #aebd72 100%)', ink: '#0b0f07' },
};

const ICONE: Record<ModoPilot, ReactNode> = {
  creator: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  ),
  docs: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h6" />
    </svg>
  ),
  clickup: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 16.5 12 9l8 7.5" />
      <path d="m7 4.5 5 4.5 5-4.5" />
    </svg>
  ),
};

const MODOS: Array<{ id: ModoPilot; titulo: string; frase: string }> = [
  {
    id: 'creator',
    titulo: 'Creator',
    frase: 'Task do zero. Cole a copy no card e escolha avatares, versões, decupagem e legendas.',
  },
  {
    id: 'docs',
    titulo: 'Docs',
    frase: 'Importe um Google Docs por arquivo ou link. Todos os ADs do doc viram tasks.',
  },
  {
    id: 'clickup',
    titulo: 'ClickUp Pilot',
    frase: 'As tasks do ClickUp, direto da fila do editor. O fluxo de sempre.',
  },
];

const ORDEM: ModoPilot[] = MODOS.map((m) => m.id);

export function PilotModeHub({
  value,
  onChange,
  disabled = false,
  meta,
}: {
  value: ModoPilot;
  onChange: (m: ModoPilot) => void;
  /** Análise/carregamento em andamento: não troca de origem no meio. */
  disabled?: boolean;
  /** Linha de estado por modo ("B2C", "RIPTVWA.docx · 51 tasks", "3 tasks"). */
  meta?: Partial<Record<ModoPilot, string>>;
}) {
  function mover(dir: 1 | -1) {
    if (disabled) return;
    const i = Math.max(0, ORDEM.indexOf(value));
    const prox = ORDEM[(i + dir + ORDEM.length) % ORDEM.length];
    if (prox && prox !== value) onChange(prox);
  }

  return (
    <div className="pmh-wrap mb-5">
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <span className="field-label">De onde vem a task</span>
        {disabled ? (
          <span className="mono text-[10.5px] uppercase tracking-[0.18em] text-text-muted">trabalhando…</span>
        ) : null}
      </div>
      <div
        role="radiogroup"
        aria-label="Origem da task"
        className="grid gap-3 sm:grid-cols-3"
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
            e.preventDefault();
            mover(1);
          } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
            e.preventDefault();
            mover(-1);
          }
        }}
      >
        {MODOS.map((m) => {
          const on = m.id === value;
          const c = COR[m.id];
          const linha = meta?.[m.id];
          return (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              disabled={disabled}
              onClick={() => !on && onChange(m.id)}
              className={
                'pmh-card relative overflow-hidden rounded-[18px] border p-4 text-left ' +
                (on ? 'pmh-on border-transparent' : 'border-line/60 hover:border-line-strong')
              }
              style={
                on
                  ? {
                      background: `linear-gradient(180deg, rgba(${c.rgb},0.14), rgba(${c.rgb},0.04)), linear-gradient(180deg, rgb(var(--bg-softer)), rgb(var(--bg-soft)))`,
                      boxShadow: `0 0 0 1px rgba(${c.rgb},0.55), 0 18px 40px -22px rgba(${c.rgb},0.6), inset 0 1px 0 rgba(255,255,255,0.10)`,
                    }
                  : {
                      background:
                        'linear-gradient(180deg, rgba(255,255,255,0.02), rgba(0,0,0,0.14)), linear-gradient(180deg, rgb(var(--bg-softer)), rgb(var(--bg-soft)))',
                      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)',
                    }
              }
            >
              {on ? (
                <span
                  aria-hidden
                  className="pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full opacity-40 blur-3xl"
                  style={{ background: `rgba(${c.rgb},0.55)` }}
                />
              ) : null}
              <span className="relative flex items-start gap-3">
                <span
                  className="pmh-ico flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] border"
                  style={
                    on
                      ? {
                          background: c.grad,
                          color: c.ink,
                          borderColor: 'transparent',
                          boxShadow: `0 0 22px -6px rgba(${c.rgb},0.7), inset 0 1px 0 rgba(255,255,255,0.45), inset 0 -2px 0 rgba(0,0,0,0.22)`,
                        }
                      : {
                          borderColor: 'rgb(var(--line) / 0.7)',
                          color: 'rgb(var(--text) / 0.75)',
                          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
                        }
                  }
                >
                  {ICONE[m.id]}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span
                      className={'text-[13px] font-extrabold uppercase tracking-[0.14em] ' + (on ? '' : 'text-text')}
                      style={{ fontFamily: 'var(--font-tech)', color: on ? `rgb(${c.rgb})` : undefined }}
                    >
                      {m.titulo}
                    </span>
                    <span
                      aria-hidden
                      className={'h-2 w-2 shrink-0 rounded-full ' + (on ? '' : 'opacity-0')}
                      style={{ background: `rgb(${c.rgb})`, boxShadow: `0 0 10px rgba(${c.rgb},0.9)` }}
                    />
                  </span>
                  <span className="mt-1 block text-[12.5px] leading-snug text-text-muted">{m.frase}</span>
                  {linha ? (
                    <span
                      className={'mono mt-2 block text-[11px] uppercase leading-snug tracking-[0.1em] ' + (on ? '' : 'text-text-muted')}
                      style={{ color: on ? `rgba(${c.rgb},0.95)` : undefined }}
                      title={linha}
                    >
                      {linha}
                    </span>
                  ) : null}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <style jsx>{`
        .pmh-card {
          transition:
            transform 260ms cubic-bezier(0.32, 0.72, 0, 1),
            box-shadow 260ms cubic-bezier(0.32, 0.72, 0, 1),
            border-color 200ms ease,
            background 260ms ease;
        }
        .pmh-card:not(:disabled):hover {
          transform: translateY(-2px);
        }
        .pmh-card:not(:disabled):active {
          transform: translateY(0) scale(0.995);
          transition-duration: 90ms;
        }
        .pmh-card:focus-visible {
          outline: 2px solid rgba(255, 255, 255, 0.55);
          outline-offset: 2px;
        }
        .pmh-card:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .pmh-ico {
          transition:
            background 260ms ease,
            color 260ms ease,
            box-shadow 260ms ease;
        }
        @media (prefers-reduced-motion: reduce) {
          .pmh-card,
          .pmh-card:not(:disabled):hover,
          .pmh-card:not(:disabled):active {
            transform: none;
            transition: none;
          }
        }
      `}</style>
    </div>
  );
}
