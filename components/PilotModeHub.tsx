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
 * Visual (08.10): painel de vidro com bisel duplo; um trilho encaixado com
 * três segmentos e uma pílula que corre com mola até o modo ativo, na cor
 * dele (âmbar, ciano, lime). A pílula anda por TRANSFORM (antes animava
 * `left`, que repinta a cada quadro). Nome em frase, sem caixa alta espaçada;
 * um número mostra quantas tasks o modo tem. A ação do modo (o "+", o link do
 * doc) vem como `children`, logo abaixo do trilho, dentro do mesmo painel.
 *
 * É um radiogroup de verdade: setas navegam, Enter/Espaço escolhem.
 */

import type { ReactNode } from 'react';
import type { ModoPilot } from '@/lib/pilot-fontes';
import { PlSpot } from '@/components/pilot/PilotShell';

type Cor = { rgb: string; grad: string; ink: string };

/** Cor presa à identidade do modo, nunca à posição. Lime é a cor da casa
 *  (ClickUp, o modo de sempre); ciano = documento; âmbar = criação. */
export const COR_DO_MODO: Record<ModoPilot, Cor> = {
  creator: { rgb: '240,186,64', grad: 'linear-gradient(180deg, #fde29b 0%, #f0b938 100%)', ink: '#1d1404' },
  docs: { rgb: '86,206,226', grad: 'linear-gradient(180deg, #aaeef8 0%, #46c9de 100%)', ink: '#04141b' },
  clickup: { rgb: '196,212,128', grad: 'linear-gradient(180deg, #dde8a8 0%, #b8c77c 100%)', ink: '#11160a' },
};

const ICONE: Record<ModoPilot, ReactNode> = {
  creator: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
      <path d="M12 8.2v7.6M8.2 12h7.6" />
    </svg>
  ),
  docs: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h4" />
    </svg>
  ),
  clickup: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
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

  function mover(dir: 1 | -1) {
    if (disabled) return;
    const prox = MODOS[(idx + dir + MODOS.length) % MODOS.length];
    if (prox && prox.id !== value) onChange(prox.id);
  }

  return (
    <section
      className="pmh pl-glass pl-rise relative mb-6 overflow-hidden p-2.5"
      data-pl-spot
      style={{ ['--i' as string]: 1, ['--pmh' as string]: cor.rgb }}
    >
      <PlSpot />
      {/* Luz da cor do modo, no canto: sinal periférico de "onde eu estou". */}
      <span aria-hidden className="pmh-luz pointer-events-none absolute -z-[1]" />

      <div
        role="radiogroup"
        aria-label="Origem da task"
        className={'pmh-rail relative grid p-1.5 ' + (disabled ? 'opacity-70' : '')}
        style={{ gridTemplateColumns: `repeat(${MODOS.length}, minmax(0, 1fr))` }}
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
        {/* Pílula deslizante: anda por transform (GPU) */}
        <span
          aria-hidden
          className="pmh-pill pointer-events-none absolute"
          style={{
            width: `calc((100% - 12px) / ${MODOS.length})`,
            transform: `translateX(${idx * 100}%)`,
            background: cor.grad,
            boxShadow: `inset 0 1px 0 rgba(255,255,255,0.6), inset 0 -1px 0 rgba(0,0,0,0.2), 0 0 0 1px rgba(${cor.rgb},0.55), 0 10px 30px -10px rgba(${cor.rgb},0.85)`,
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
                'pmh-seg relative z-10 flex min-w-0 items-center justify-center gap-2.5 px-3 py-2.5 sm:gap-3 sm:px-4 ' +
                (disabled ? 'cursor-not-allowed' : 'cursor-pointer')
              }
              style={{ color: on ? c.ink : undefined }}
            >
              <span className={'pmh-ico hidden h-8 w-8 shrink-0 items-center justify-center sm:flex ' + (on ? 'is-on' : '')}>
                {ICONE[m.id]}
              </span>
              <span className="pmh-nome truncate">{m.titulo}</span>
              {n > 0 ? (
                <span
                  className={'pmh-n hidden shrink-0 sm:inline-grid ' + (on ? 'is-on' : '')}
                  title={`${n} task${n === 1 ? '' : 's'}`}
                >
                  {n}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {children ? <div className="relative mt-2.5 px-1 pb-1">{children}</div> : null}

      <style jsx>{`
        .pmh-luz {
          right: -18%;
          top: -120%;
          width: 60%;
          height: 260%;
          background: radial-gradient(closest-side, rgba(var(--pmh), 0.16), transparent);
          transition: background 500ms ease;
        }
        .pmh-rail {
          border-radius: 18px;
          background: rgb(var(--bg) / 0.6);
          box-shadow:
            inset 0 2px 5px rgba(0, 0, 0, 0.4),
            inset 0 0 0 1px rgb(var(--text) / 0.05),
            inset 0 -1px 0 rgb(var(--text) / 0.05);
        }
        :global(html[data-theme='light']) .pmh-rail {
          background: rgb(var(--bg) / 0.65);
          box-shadow:
            inset 0 2px 5px rgba(40, 40, 30, 0.14),
            inset 0 0 0 1px rgb(var(--text) / 0.07);
        }
        .pmh-pill {
          left: 6px;
          top: 6px;
          bottom: 6px;
          border-radius: 13px;
          transition:
            transform 560ms cubic-bezier(0.34, 1.4, 0.44, 1),
            background 320ms ease,
            box-shadow 320ms ease;
        }
        .pmh-seg {
          border-radius: 13px;
          transition:
            transform 400ms cubic-bezier(0.32, 0.72, 0, 1),
            color 220ms ease;
        }
        .pmh-seg:not(:disabled):hover {
          transform: translateY(-1px);
        }
        .pmh-seg:not(:disabled):active {
          transform: translateY(1px) scale(0.98);
          transition-duration: 80ms;
        }
        .pmh-seg:focus-visible {
          outline: 2px solid rgb(var(--text) / 0.55);
          outline-offset: 2px;
        }
        .pmh-ico {
          border-radius: 10px;
          color: rgb(var(--text) / 0.55);
          box-shadow: inset 0 0 0 1px rgb(var(--text) / 0.1);
          transition:
            background 260ms ease,
            box-shadow 260ms ease,
            color 220ms ease;
        }
        .pmh-ico.is-on {
          color: inherit;
          background: rgba(0, 0, 0, 0.12);
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.35),
            inset 0 -1px 0 rgba(0, 0, 0, 0.14);
        }
        .pmh-seg:not(:disabled):hover .pmh-ico:not(.is-on) {
          color: rgb(var(--text) / 0.85);
          box-shadow: inset 0 0 0 1px rgb(var(--text) / 0.18);
        }
        .pmh-nome {
          font-family: var(--font-tech), system-ui, sans-serif;
          font-weight: 650;
          font-size: 14.5px;
          letter-spacing: -0.02em;
          color: rgb(var(--text) / 0.6);
          transition: color 220ms ease;
        }
        .pmh-seg[aria-checked='true'] .pmh-nome {
          color: inherit;
        }
        .pmh-seg:not(:disabled):hover .pmh-nome {
          color: rgb(var(--text) / 0.92);
        }
        .pmh-seg[aria-checked='true']:not(:disabled):hover .pmh-nome {
          color: inherit;
        }
        .pmh-n {
          min-width: 22px;
          height: 20px;
          padding: 0 6px;
          place-items: center;
          border-radius: 999px;
          font: 700 11px/1 var(--font-mono), monospace;
          font-variant-numeric: tabular-nums;
          color: rgb(var(--text) / 0.6);
          box-shadow: inset 0 0 0 1px rgb(var(--text) / 0.12);
        }
        .pmh-n.is-on {
          color: inherit;
          background: rgba(0, 0, 0, 0.13);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.3);
        }
        @media (prefers-reduced-motion: reduce) {
          .pmh-pill {
            transition: transform 120ms linear !important;
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
