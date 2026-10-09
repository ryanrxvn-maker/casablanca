'use client';

/**
 * Folha do design system "Pilot Control" (08.10) — tokens e peças do Pilot
 * lado a lado, com as classes REAIS do app/pilot-skin.css. Só a bancada dev
 * (/dev/pilot-design) monta isto; serve de referência pra peça nova.
 */

const SUPERFICIES: Array<[string, string]> = [
  ['--ds-inset', 'Encaixe'],
  ['--ds-panel', 'Painel'],
  ['--ds-raise', 'Elevado'],
  ['--ds-raise-2', 'Aceso'],
  ['--ds-key-top', 'Face da tecla'],
];
const TALLY: Array<[string, string, string]> = [
  ['ok', 'Pronto', '--ds-ok'],
  ['live', 'No ar', '--ds-live'],
  ['wait', 'Esperando', '--ds-wait'],
  ['info', 'Info', '--ds-info'],
  ['err', 'Falha', '--ds-err'],
  ['act', 'Ação', '--ds-act'],
];

function Ico({ d }: { d: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

export function PilotDsSpecimen() {
  return (
    <section className="pl-glass mt-10 overflow-hidden">
      <div className="flex flex-wrap items-baseline gap-3 border-b px-5 py-4" style={{ borderColor: 'rgb(var(--ds-hair) / 0.07)' }}>
        <span className="pl-h3">Pilot Control</span>
        <span className="pl-sub">design system · sala de controle do estúdio</span>
        <span className="pl-readout ml-auto">v2 · 08.10</span>
      </div>

      <div className="grid gap-px md:grid-cols-2" style={{ background: 'rgb(var(--ds-hair) / 0.06)' }}>
        {/* superfícies */}
        <div className="p-5" style={{ background: 'rgb(var(--ds-panel))' }}>
          <div className="pl-label mb-3">Superfícies</div>
          <div className="grid grid-cols-5 gap-2">
            {SUPERFICIES.map(([v, n]) => (
              <div key={v}>
                <div className="h-14 rounded-[10px]" style={{ background: `rgb(var(${v}))`, boxShadow: 'inset 0 0 0 1px rgb(var(--ds-hair) / 0.1)' }} />
                <div className="pl-label mt-1.5" style={{ fontSize: 11 }}>{n}</div>
                <div className="pl-sub" style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}>{v.replace('--ds-', '')}</div>
              </div>
            ))}
          </div>
        </div>

        {/* tally */}
        <div className="p-5" style={{ background: 'rgb(var(--ds-panel))' }}>
          <div className="pl-label mb-3">Tally · status</div>
          <div className="grid grid-cols-3 gap-2">
            {TALLY.map(([c, n, v]) => (
              <div key={c} className="flex items-center gap-2.5 rounded-[10px] px-3 py-2.5" style={{ background: 'rgb(var(--ds-inset) / 0.5)', boxShadow: 'inset 0 0 0 1px rgb(var(--ds-hair) / 0.08)' }}>
                <i className="pl-led" data-c={c} />
                <span className="pl-label" style={{ color: 'rgb(var(--ds-ink))' }}>{n}</span>
                <span className="pl-sub ml-auto" style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}>{v.replace('--ds-', '')}</span>
              </div>
            ))}
          </div>
        </div>

        {/* tipografia */}
        <div className="p-5" style={{ background: 'rgb(var(--ds-panel))' }}>
          <div className="pl-label mb-3">Tipografia</div>
          <div className="pl-hero__title" style={{ fontSize: 56 }}>Pilot</div>
          <p className="pl-hero__lead mt-2" style={{ fontSize: 22 }}>O cérebro do estúdio.</p>
          <div className="mt-3 grid gap-1.5">
            <span className="pl-h2">Seção · Bricolage 700 / 20</span>
            <span className="pl-h3">Painel · Bricolage 650 / 15</span>
            <span className="pl-label">Rótulo em frase · Inter 500 / 12</span>
            <span className="pl-readout justify-self-start">00:05:09 · AD01 · 9:16</span>
          </div>
        </div>

        {/* teclas */}
        <div className="p-5" style={{ background: 'rgb(var(--ds-panel))' }}>
          <div className="pl-label mb-3">Teclas</div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="pl-btn pl-btn--primary pl-btn--icon-end">
              Iniciar em background
              <span className="pl-btn__ico">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M8 5.5v13l10.5-6.5z" /></svg>
              </span>
            </button>
            <button type="button" className="pl-btn">Secundária</button>
            <button type="button" className="pl-btn pl-btn--ghost">Fantasma</button>
            <button type="button" className="pl-btn pl-btn--primary" disabled>Desligada</button>
          </div>
          <div className="pl-label mb-2 mt-4">Painel de funções · desligada / ligada</div>
          <div className="pl-toolbar inline-flex">
            <button type="button" className="pl-ibtn" data-tone="lime" style={{ width: 36, height: 36 }} aria-label="Silêncios"><Ico d="M6 6m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0M6 18m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0M20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12" /></button>
            <button type="button" className="pl-ibtn" data-tone="lime" data-on="true" style={{ width: 36, height: 36 }} aria-label="Silêncios ligado"><Ico d="M6 6m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0M6 18m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0M20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12" /></button>
            <button type="button" className="pl-ibtn" data-tone="cyan" data-on="true" style={{ width: 36, height: 36 }} aria-label="Nivelar"><Ico d="M3 6h18M6 10v8M10 10v8M14 10v8M18 10v8" /></button>
            <button type="button" className="pl-ibtn" data-tone="rose" data-on="true" style={{ width: 36, height: 36 }} aria-label="Headline"><Ico d="M4 7h16M4 13h11M4 18h7" /></button>
            <button type="button" className="pl-ibtn" data-tone="amber" style={{ width: 36, height: 36 }} aria-label="Legenda"><Ico d="M3 4h18v16H3zM7 15h4M13 15h4" /></button>
          </div>
          <div className="pl-label mb-2 mt-4">Etiquetas</div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="pl-phase" data-tone="success"><span className="flex items-center gap-1.5">Pronto</span></span>
            <span className="pl-phase" data-tone="progress"><span className="flex items-center gap-1.5">Renderizando</span></span>
            <span className="pl-phase" data-tone="warn"><span className="flex items-center gap-1.5">Aguardando HeyGen</span></span>
            <span className="pl-chan" style={{ ['--sw' as string]: '#c00000' }}>YouTube</span>
            <span className="pl-chan" style={{ ['--sw' as string]: '#2a9fd6' }}>Meta</span>
            <span className="pl-readout">5m09s</span>
          </div>
        </div>
      </div>
    </section>
  );
}
