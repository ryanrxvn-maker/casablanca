'use client';

/**
 * LangSwitch3D — idioma da copy (DR MILLION).
 *
 * A copy do DR MILLION vem em polonês com a tradução em português ao lado.
 * O disparo é em POLONÊS; o português está lá pra guiar — e às vezes você
 * quer conferir, ou disparar em PT de propósito. Este controle troca os dois.
 *
 * Visual: mesma família do seletor de empresa — trilho encaixado, pílula
 * deslizante com bevel, spring no movimento. Bandeira ajuda a bater o olho
 * e reconhecer sem ler.
 */

const CORES = {
  pl: {
    rgb: '244,114,182',
    text: '#1a0710',
    grad: 'linear-gradient(135deg, #fbcfe8 0%, #f472b6 100%)',
  },
  pt: {
    rgb: '110,231,183',
    text: '#04140d',
    grad: 'linear-gradient(135deg, #a7f3d0 0%, #34d399 100%)',
  },
} as const;

export type Lang = 'pl' | 'pt';

const OPCOES: Array<{ id: Lang; label: string; flag: string; titulo: string }> = [
  { id: 'pl', label: 'PL', flag: '🇵🇱', titulo: 'Polonês — idioma em que o anúncio vai ao ar' },
  { id: 'pt', label: 'PT', flag: '🇧🇷', titulo: 'Português — a tradução que serve de guia' },
];

export function LangSwitch3D({
  value,
  onChange,
  disabled = false,
  /** Idiomas que o AD realmente tem no doc. O que faltar fica travado. */
  disponivel = { pt: true, pl: true },
}: {
  value: Lang;
  onChange: (v: Lang) => void;
  disabled?: boolean;
  disponivel?: { pt: boolean; pl: boolean };
}) {
  const idx = Math.max(0, OPCOES.findIndex((o) => o.id === value));
  const cor = CORES[OPCOES[idx]?.id ?? 'pl'];
  const pct = 100 / OPCOES.length;

  return (
    <div className="inline-flex items-center gap-2">
      <span
        className="hidden select-none text-[9.5px] font-bold uppercase tracking-[0.24em] text-text-muted sm:block"
        style={{ fontFamily: 'var(--font-tech)' }}
      >
        Fala em
      </span>

      <div
        role="radiogroup"
        aria-label="Idioma da copy"
        className={
          'lang3d-rail relative flex select-none rounded-[13px] border border-line/70 p-1 ' +
          (disabled ? 'opacity-60' : '')
        }
        style={{
          background: 'linear-gradient(180deg, rgb(var(--bg) / 0.85), rgb(var(--bg-soft) / 0.65))',
          boxShadow:
            'inset 0 2px 5px rgb(0 0 0 / 0.30), inset 0 -1px 0 rgb(255 255 255 / 0.06)',
        }}
      >
        <span
          aria-hidden
          className="lang3d-pill pointer-events-none absolute bottom-1 top-1 rounded-[10px]"
          style={{
            left: `calc(${idx * pct}% + 4px)`,
            width: `calc(${pct}% - 8px)`,
            background: cor.grad,
            boxShadow: `0 0 22px -6px rgba(${cor.rgb},0.75), inset 0 1px 0 rgba(255,255,255,0.5), inset 0 -2px 0 rgba(0,0,0,0.22)`,
            transition: 'left 420ms cubic-bezier(.34,1.56,.44,1), background 260ms ease',
          }}
        />

        {OPCOES.map((o) => {
          const ativo = o.id === value;
          const temNoDoc = disponivel[o.id];
          const travado = disabled || !temNoDoc;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={ativo}
              disabled={travado}
              title={temNoDoc ? o.titulo : `${o.titulo} — este AD não tem essa versão no doc`}
              onClick={() => !ativo && onChange(o.id)}
              className={
                'lang3d-opt relative z-10 inline-flex items-center gap-1.5 whitespace-nowrap rounded-[10px] px-3 py-1.5 text-[11px] font-extrabold uppercase tracking-[0.12em] transition-all duration-250 ' +
                (travado ? 'cursor-not-allowed opacity-45 ' : 'cursor-pointer ') +
                (ativo ? '' : 'text-text-muted')
              }
              style={{
                fontFamily: 'var(--font-tech)',
                color: ativo ? CORES[o.id].text : undefined,
                textShadow: ativo ? '0 1px 0 rgba(255,255,255,0.35)' : undefined,
              }}
            >
              <span aria-hidden className="text-[12px] leading-none">{o.flag}</span>
              {o.label}
            </button>
          );
        })}
      </div>

      <style jsx>{`
        .lang3d-opt:not(:disabled):hover {
          transform: translateY(-1px);
        }
        .lang3d-opt:not(:disabled):active {
          transform: translateY(1px) scale(0.97);
          transition-duration: 80ms;
        }
        .lang3d-opt:focus-visible {
          outline: 2px solid rgba(255, 255, 255, 0.55);
          outline-offset: 2px;
        }
        @media (prefers-reduced-motion: reduce) {
          .lang3d-pill {
            transition: left 120ms linear !important;
          }
          .lang3d-opt:hover,
          .lang3d-opt:active {
            transform: none;
          }
        }
      `}</style>
    </div>
  );
}
