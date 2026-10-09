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
 * Visual (design system "Pilot Control", 08.10): um BARRAMENTO de mesa de
 * corte. Três teclas num trilho encaixado; a escolhida acende (face clara +
 * filete de LED na cor da origem: âmbar, ciano, lime) e a tampa acesa corre
 * até ela por transform. Nome em frase, contagem em leitura mono. A ação do
 * modo (o "Nova task", o link do doc) vem como `children`, logo abaixo.
 *
 * É um radiogroup de verdade: setas navegam, Enter/Espaço escolhem.
 */

import type { ReactNode } from 'react';
import type { ModoPilot } from '@/lib/pilot-fontes';
import { PlSpot } from '@/components/pilot/PilotShell';

type Cor = { rgb: string };

/** Cor presa à identidade do modo, nunca à posição. Lime é a cor da casa
 *  (ClickUp, o modo de sempre); ciano = documento; âmbar = criação. */
export const COR_DO_MODO: Record<ModoPilot, Cor> = {
  creator: { rgb: '246,192,74' },
  docs: { rgb: '110,205,228' },
  clickup: { rgb: '196,222,120' },
};

const ICONE: Record<ModoPilot, ReactNode> = {
  creator: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
      <path d="M12 8.2v7.6M8.2 12h7.6" />
    </svg>
  ),
  docs: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h4" />
    </svg>
  ),
  clickup: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
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
      className="pmh pl-glass pl-rise relative mb-6 p-2"
      data-pl-spot
      style={{ ['--i' as string]: 1, ['--pmh' as string]: cor.rgb }}
    >
      <PlSpot />
      <div className="pmh-head">
        <span className="pmh-titulo">Origem</span>
        <span className="pmh-dica">de onde vem a task</span>
      </div>
      <div
        role="radiogroup"
        aria-label="Origem da task"
        className={'pmh-rail relative grid ' + (disabled ? 'opacity-70' : '')}
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
        {/* Tampa acesa: corre por transform até a tecla escolhida */}
        <span
          aria-hidden
          className="pmh-lit pointer-events-none absolute"
          style={{
            width: `calc((100% - 8px) / ${MODOS.length})`,
            transform: `translateX(${idx * 100}%)`,
          }}
        >
          <i />
        </span>

        {MODOS.map((m) => {
          const on = m.id === value;
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
              className={'pmh-seg relative z-10 flex min-w-0 items-center justify-center gap-2.5 px-3 ' + (disabled ? 'cursor-not-allowed' : 'cursor-pointer')}
              style={{ ['--m' as string]: COR_DO_MODO[m.id].rgb }}
            >
              <span className="pmh-ico hidden shrink-0 sm:inline-flex">{ICONE[m.id]}</span>
              <span className="pmh-nome truncate">{m.titulo}</span>
              {n > 0 ? (
                <span className="pmh-n hidden shrink-0 sm:inline-flex" title={`${n} task${n === 1 ? '' : 's'}`}>
                  {n}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {children ? <div className="relative mt-2 px-1.5 pb-1.5 pt-1">{children}</div> : null}

      <style jsx>{`
        .pmh-head {
          display: flex;
          align-items: baseline;
          gap: 10px;
          padding: 6px 8px 10px;
        }
        .pmh-titulo {
          font-family: var(--font-tech), system-ui, sans-serif;
          font-weight: 650;
          font-size: 13px;
          letter-spacing: -0.015em;
          color: rgb(var(--ds-ink));
        }
        .pmh-dica {
          font: 400 12px/1 var(--font-label), system-ui, sans-serif;
          color: rgb(var(--ds-ink-3));
        }
        .pmh-rail {
          padding: 4px;
          border-radius: 13px;
          background: rgb(var(--ds-inset) / 0.6);
          box-shadow:
            inset 0 1px 2px rgba(0, 0, 0, 0.45),
            inset 0 0 0 1px rgb(var(--ds-hair) / 0.07);
        }
        :global(html[data-theme='light']) .pmh-rail {
          box-shadow:
            inset 0 1px 2px rgba(40, 40, 30, 0.12),
            inset 0 0 0 1px rgb(var(--ds-hair) / 0.1);
        }
        .pmh-lit {
          left: 4px;
          top: 4px;
          bottom: 4px;
          border-radius: 10px;
          background: linear-gradient(180deg, rgb(var(--ds-key-top)), rgb(var(--ds-key-bot)));
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.1),
            inset 0 0 0 1px rgb(var(--ds-hair) / 0.13),
            0 1px 0 rgba(0, 0, 0, 0.55),
            0 6px 14px -8px rgba(0, 0, 0, 0.8);
          transition: transform 320ms cubic-bezier(0.2, 0.8, 0.2, 1);
        }
        :global(html[data-theme='light']) .pmh-lit {
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.9),
            inset 0 0 0 1px rgb(var(--ds-hair) / 0.14),
            0 1px 0 rgba(40, 40, 30, 0.14);
        }
        /* filete de LED na cor da origem, no pé da tecla acesa */
        .pmh-lit > i {
          position: absolute;
          left: 50%;
          bottom: 4px;
          width: 26px;
          height: 2px;
          margin-left: -13px;
          border-radius: 2px;
          background: rgb(var(--pmh));
          box-shadow: 0 0 8px rgba(var(--pmh), 0.85);
          transition:
            background 220ms ease,
            box-shadow 220ms ease;
        }
        .pmh-seg {
          height: 46px;
          border-radius: 10px;
          transition: color 160ms ease;
        }
        .pmh-seg:not(:disabled):active {
          transform: translateY(1px);
        }
        .pmh-seg:focus-visible {
          outline: 2px solid rgb(var(--ds-act));
          outline-offset: 2px;
        }
        .pmh-ico {
          color: rgb(var(--ds-ink-3));
          transition: color 160ms ease;
        }
        .pmh-seg[aria-checked='true'] .pmh-ico {
          color: rgb(var(--m));
        }
        .pmh-nome {
          font-family: var(--font-tech), system-ui, sans-serif;
          font-weight: 600;
          font-size: 14px;
          letter-spacing: -0.015em;
          color: rgb(var(--ds-ink-2));
          transition: color 160ms ease;
        }
        .pmh-seg:not(:disabled):hover .pmh-nome,
        .pmh-seg[aria-checked='true'] .pmh-nome {
          color: rgb(var(--ds-ink));
        }
        .pmh-n {
          min-width: 20px;
          height: 20px;
          align-items: center;
          justify-content: center;
          padding: 0 5px;
          border-radius: 5px;
          font: 500 11px/1 var(--font-mono), monospace;
          font-variant-numeric: tabular-nums;
          color: rgb(var(--ds-ink-2));
          background: rgb(var(--ds-inset) / 0.55);
          box-shadow: inset 0 0 0 1px rgb(var(--ds-hair) / 0.09);
        }
        @media (prefers-reduced-motion: reduce) {
          .pmh-lit {
            transition: none;
          }
        }
      `}</style>
    </section>
  );
}
