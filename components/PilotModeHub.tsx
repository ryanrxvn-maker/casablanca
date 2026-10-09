'use client';

/**
 * PilotModeHub — o visor de entrada do Pilot: DE ONDE vem a task.
 *
 *  CREATOR · task do zero, avatares primeiro e copy depois (no card)
 *  DOCS    · Google Docs importado (arquivo ou link), todos os ADs viram tasks
 *  CLICKUP · as tasks do ClickUp, o fluxo de sempre
 *
 * Só muda a origem; análise, disparo, pós-produção e fila são os mesmos.
 *
 * Visual: um trilho encaixado (inset) com três segmentos, ícone + nome, e uma
 * pílula que corre com mola até o modo ativo, na cor dele (âmbar, ciano, lime).
 * Sem frases: o nome e o ícone dizem tudo; um número mostra quantas tasks o
 * modo tem. A ação do modo (o "+", o link do doc) vem como `children`, logo
 * abaixo do trilho, dentro do mesmo painel.
 *
 * É um radiogroup de verdade: setas navegam, Enter/Espaço escolhem.
 */

import type { ReactNode } from 'react';
import type { ModoPilot } from '@/lib/pilot-fontes';

type Cor = { rgb: string; grad: string; ink: string };

/** Cor presa à identidade do modo, nunca à posição. Lime é a cor da casa
 *  (ClickUp, o modo de sempre); ciano = documento; âmbar = criação. */
export const COR_DO_MODO: Record<ModoPilot, Cor> = {
  creator: { rgb: '251,191,36', grad: 'linear-gradient(135deg, #fcd57a 0%, #f0b429 100%)', ink: '#1a1203' },
  docs: { rgb: '34,211,238', grad: 'linear-gradient(135deg, #7fe4f5 0%, #22d3ee 100%)', ink: '#04121a' },
  clickup: { rgb: '200,232,124', grad: 'linear-gradient(135deg, #c2cf86 0%, #aebd72 100%)', ink: '#0b0f07' },
};

const ICONE: Record<ModoPilot, ReactNode> = {
  creator: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3.5" y="3.5" width="17" height="17" rx="4.5" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  ),
  docs: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h6" />
    </svg>
  ),
  clickup: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 16.5 12 9l8 7.5" />
      <path d="m7 4.5 5 4.5 5-4.5" />
    </svg>
  ),
};

const MODOS: Array<{ id: ModoPilot; titulo: string }> = [
  { id: 'creator', titulo: 'Creator' },
  { id: 'docs', titulo: 'Docs' },
  { id: 'clickup', titulo: 'ClickUp' },
];

export function PilotModeHub({
  value,
  onChange,
  disabled = false,
  contagem,
  children,
}: {
  value: ModoPilot;
  onChange: (m: ModoPilot) => void;
  /** Análise/carregamento em andamento: não troca de origem no meio. */
  disabled?: boolean;
  /** Quantas tasks cada modo tem agora (só aparece quando > 0). */
  contagem?: Partial<Record<ModoPilot, number>>;
  /** A ação do modo ativo (o "+", a linha do doc), logo abaixo do trilho. */
  children?: ReactNode;
}) {
  const idx = Math.max(0, MODOS.findIndex((m) => m.id === value));
  const cor = COR_DO_MODO[MODOS[idx]?.id ?? 'clickup'];
  const pct = 100 / MODOS.length;

  function mover(dir: 1 | -1) {
    if (disabled) return;
    const prox = MODOS[(idx + dir + MODOS.length) % MODOS.length];
    if (prox && prox.id !== value) onChange(prox.id);
  }

  return (
    <section
      className="pmh relative mb-5 overflow-hidden rounded-[18px] p-3 md:p-4"
      style={{
        background:
          'linear-gradient(180deg, rgba(255,255,255,0.025), rgba(0,0,0,0.18)), linear-gradient(180deg, rgb(var(--bg-softer)), rgb(var(--bg-soft)))',
        boxShadow: 'inset 0 0 0 1px rgb(var(--line) / 0.6), inset 0 1px 0 rgba(255,255,255,0.05)',
      }}
    >
      {/* Luz da cor do modo, no canto: sinal periférico de "onde eu estou". */}
      <span
        aria-hidden
        className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full opacity-30 blur-3xl"
        style={{ background: `rgba(${cor.rgb},0.5)`, transition: 'background 400ms ease' }}
      />

      <div
        role="radiogroup"
        aria-label="Origem da task"
        className={'pmh-rail relative grid rounded-[14px] p-1.5 ' + (disabled ? 'opacity-70' : '')}
        style={{
          gridTemplateColumns: `repeat(${MODOS.length}, minmax(0, 1fr))`,
          background: 'linear-gradient(180deg, rgb(var(--bg) / 0.85), rgb(var(--bg-soft) / 0.65))',
          boxShadow: 'inset 0 2px 6px rgba(0,0,0,0.35), inset 0 -1px 0 rgba(255,255,255,0.06)',
        }}
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
        {/* Pílula deslizante */}
        <span
          aria-hidden
          className="pmh-pill pointer-events-none absolute bottom-1.5 top-1.5 rounded-[11px]"
          style={{
            left: `calc(${idx * pct}% + 6px)`,
            width: `calc(${pct}% - 12px)`,
            background: cor.grad,
            boxShadow: `0 0 34px -8px rgba(${cor.rgb},0.8), inset 0 1px 0 rgba(255,255,255,0.45), inset 0 -2px 0 rgba(0,0,0,0.22)`,
          }}
        />

        {MODOS.map((m) => {
          const on = m.id === value;
          const c = COR_DO_MODO[m.id];
          const n = contagem?.[m.id] ?? 0;
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
                'pmh-seg relative z-10 flex min-w-0 items-center justify-center gap-2.5 rounded-[11px] px-3 py-2.5 sm:gap-3 sm:px-4 ' +
                (disabled ? 'cursor-not-allowed' : 'cursor-pointer')
              }
              style={{ color: on ? c.ink : undefined }}
            >
              <span
                className={'pmh-ico flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] ' + (on ? '' : 'text-text-muted')}
                style={
                  on
                    ? { background: 'rgba(0,0,0,0.16)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.25), inset 0 -1px 0 rgba(0,0,0,0.18)' }
                    : { boxShadow: 'inset 0 0 0 1px rgb(var(--line) / 0.7)' }
                }
              >
                {ICONE[m.id]}
              </span>
              <span
                className={'pmh-nome truncate text-[12.5px] font-extrabold uppercase tracking-[0.14em] ' + (on ? '' : 'text-text-muted')}
                style={{ fontFamily: 'var(--font-tech)', textShadow: on ? '0 1px 0 rgba(255,255,255,0.35)' : undefined }}
              >
                {m.titulo}
              </span>
              {n > 0 ? (
                <span
                  className={
                    'mono hidden shrink-0 rounded-full px-2 py-[2px] text-[10.5px] font-bold tabular-nums sm:inline-flex ' +
                    (on ? 'bg-black/20' : 'text-text-muted')
                  }
                  style={on ? undefined : { boxShadow: 'inset 0 0 0 1px rgb(var(--line) / 0.7)' }}
                  title={`${n} task${n === 1 ? '' : 's'}`}
                >
                  {n}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {children ? <div className="relative mt-3">{children}</div> : null}

      <style jsx>{`
        .pmh-pill {
          transition:
            left 460ms cubic-bezier(0.34, 1.56, 0.44, 1),
            background 300ms ease,
            box-shadow 300ms ease;
        }
        .pmh-seg {
          transition:
            transform 220ms cubic-bezier(0.32, 0.72, 0, 1),
            color 220ms ease;
        }
        .pmh-seg:not(:disabled):hover {
          transform: translateY(-1px);
        }
        .pmh-seg:not(:disabled):hover .pmh-nome {
          color: rgb(var(--text) / 0.92);
        }
        .pmh-seg[aria-checked='true']:not(:disabled):hover .pmh-nome {
          color: inherit;
        }
        .pmh-seg:not(:disabled):active {
          transform: translateY(1px) scale(0.98);
          transition-duration: 80ms;
        }
        .pmh-seg:focus-visible {
          outline: 2px solid rgba(255, 255, 255, 0.55);
          outline-offset: 2px;
        }
        .pmh-ico {
          transition:
            background 220ms ease,
            box-shadow 220ms ease,
            color 220ms ease;
        }
        @media (prefers-reduced-motion: reduce) {
          .pmh-pill {
            transition: left 120ms linear !important;
          }
          .pmh-seg,
          .pmh-seg:not(:disabled):hover,
          .pmh-seg:not(:disabled):active {
            transform: none;
            transition: none;
          }
        }
      `}</style>
    </section>
  );
}
