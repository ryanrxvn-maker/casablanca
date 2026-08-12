'use client';

/**
 * WorkspaceSwitch3D — seletor 3D de EMPRESA (workspace do ClickUp).
 *
 * Você trabalha pra duas empresas com o mesmo login do ClickUp. Esse
 * controle troca de qual delas o Pilot lista as tasks, sem passar pela
 * página de configurações.
 *
 * Visual: trilho encaixado (inset), pílula deslizante com bevel e glow que
 * corre atrás do rótulo ativo. A pílula anda com spring; os rótulos fazem
 * lift 3D no hover. Cada empresa tem sua cor — lime pro B2C, violeta pro
 * DR MILLION — pra dar sinal periférico de "onde eu estou" sem precisar ler.
 *
 * Acessibilidade: é um radiogroup de verdade (setas do teclado navegam),
 * não uma fileira de divs clicáveis.
 */

export type WorkspaceOption = {
  id: string;
  label: string;
  /** Nome completo do workspace — vai no title/tooltip. */
  fullName?: string;
};

const ACCENTS = [
  {
    // lime — B2C
    rgb: '200,232,124',
    text: '#0b0f07',
    grad: 'linear-gradient(135deg, #c2cf86 0%, #aebd72 100%)',
  },
  {
    // violeta — DR MILLION
    rgb: '167,139,250',
    text: '#0b0713',
    grad: 'linear-gradient(135deg, #b9a5fb 0%, #8b6cf0 100%)',
  },
  {
    // ciano — terceiro workspace, se existir
    rgb: '34,211,238',
    text: '#04121a',
    grad: 'linear-gradient(135deg, #7fe4f5 0%, #22d3ee 100%)',
  },
];

export function WorkspaceSwitch3D({
  options,
  value,
  onChange,
  disabled = false,
  busy = false,
}: {
  options: WorkspaceOption[];
  value: string | null;
  onChange: (id: string) => void;
  disabled?: boolean;
  /** Troca em andamento — trava cliques e liga o brilho de carregamento. */
  busy?: boolean;
}) {
  if (options.length < 2) return null;

  const idx = Math.max(0, options.findIndex((o) => o.id === value));
  const accent = ACCENTS[idx % ACCENTS.length];
  const pct = 100 / options.length;
  const locked = disabled || busy;

  function move(dir: 1 | -1) {
    if (locked) return;
    const next = options[(idx + dir + options.length) % options.length];
    if (next && next.id !== value) onChange(next.id);
  }

  return (
    <div className="ws3d-wrap inline-flex items-center gap-2.5">
      <span
        className="ws3d-caption hidden select-none text-[9.5px] font-bold uppercase tracking-[0.24em] text-text-muted sm:block"
        style={{ fontFamily: 'var(--font-tech)' }}
      >
        Empresa
      </span>

      <div
        role="radiogroup"
        aria-label="Empresa (workspace do ClickUp)"
        aria-busy={busy || undefined}
        className={
          'ws3d-rail relative flex select-none rounded-[14px] border border-line/70 p-1 ' +
          (locked ? 'opacity-60' : '')
        }
        style={{
          background:
            'linear-gradient(180deg, rgba(0,0,0,0.34), rgba(0,0,0,0.14))',
          boxShadow:
            'inset 0 2px 5px rgba(0,0,0,0.55), inset 0 -1px 0 rgba(255,255,255,0.05)',
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
            e.preventDefault();
            move(1);
          } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
            e.preventDefault();
            move(-1);
          }
        }}
      >
        {/* Pílula deslizante */}
        <span
          aria-hidden
          className="ws3d-pill pointer-events-none absolute bottom-1 top-1 rounded-[11px]"
          style={{
            left: `calc(${idx * pct}% + 4px)`,
            width: `calc(${pct}% - 8px)`,
            background: accent.grad,
            boxShadow: `0 0 26px -6px rgba(${accent.rgb},0.75), inset 0 1px 0 rgba(255,255,255,0.45), inset 0 -2px 0 rgba(0,0,0,0.22)`,
            transition:
              'left 460ms cubic-bezier(.34,1.56,.44,1), width 300ms ease, background 300ms ease, box-shadow 300ms ease',
          }}
        >
          {busy ? (
            <span
              aria-hidden
              className="ws3d-sheen absolute inset-0 overflow-hidden rounded-[11px]"
            >
              <span className="absolute inset-y-0 -left-full w-full bg-gradient-to-r from-transparent via-white/55 to-transparent" />
            </span>
          ) : null}
        </span>

        {options.map((o, i) => {
          const active = o.id === value;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={active}
              tabIndex={active ? 0 : -1}
              disabled={locked}
              title={o.fullName ? `Workspace: ${o.fullName}` : o.label}
              onClick={() => !active && onChange(o.id)}
              className={
                'ws3d-opt relative z-10 whitespace-nowrap rounded-[11px] px-4 py-2 text-[11.5px] font-extrabold uppercase tracking-[0.14em] transition-all duration-300 ' +
                (locked ? 'cursor-not-allowed ' : 'cursor-pointer ') +
                (active ? 'ws3d-on' : 'ws3d-off text-text-muted')
              }
              style={{
                fontFamily: 'var(--font-tech)',
                minWidth: 96,
                color: active ? ACCENTS[i % ACCENTS.length].text : undefined,
                textShadow: active
                  ? '0 1px 0 rgba(255,255,255,0.35)'
                  : undefined,
              }}
            >
              {o.label}
            </button>
          );
        })}
      </div>

      <style jsx>{`
        .ws3d-rail {
          perspective: 600px;
        }
        .ws3d-opt:not(:disabled):hover {
          transform: translateY(-1px);
        }
        .ws3d-opt:not(:disabled):active {
          transform: translateY(1px) scale(0.97);
          transition-duration: 80ms;
        }
        .ws3d-off:not(:disabled):hover {
          color: rgb(var(--text) / 0.92);
        }
        .ws3d-opt:focus-visible {
          outline: 2px solid rgba(255, 255, 255, 0.55);
          outline-offset: 2px;
        }
        .ws3d-sheen span {
          animation: ws3d-sweep 1.15s ease-in-out infinite;
        }
        @keyframes ws3d-sweep {
          0% {
            transform: translateX(0);
          }
          100% {
            transform: translateX(200%);
          }
        }
        /* Quem prefere menos movimento não leva spring nem varredura. */
        @media (prefers-reduced-motion: reduce) {
          .ws3d-pill {
            transition: left 120ms linear !important;
          }
          .ws3d-sheen span {
            animation: none;
          }
          .ws3d-opt:hover,
          .ws3d-opt:active {
            transform: none;
          }
        }
      `}</style>
    </div>
  );
}
