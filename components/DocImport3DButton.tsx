'use client';

/**
 * DocImport3DButton — botao 3D animado SEM TEXTO.
 *
 * Visual: disco 3D flutuante (bevel + glow) com aneis girando, brilho pulsante
 * e um icone de documento/scan no centro. Hover ergue o botao (translateY +
 * glow mais forte); active afunda. Tudo CSS puro (sem libs).
 *
 * Uso: abre o fluxo de importar copy do Google Docs (link ou arquivo) com a
 * inteligencia do ClickUp Pilot. So dispara onClick — o modal vive no page.
 */
export function DocImport3DButton({
  onClick,
  disabled = false,
  pulse = false,
}: {
  onClick: () => void;
  disabled?: boolean;
  /** Quando true, pulsa pra chamar atencao (ex: fila vazia). */
  pulse?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label="Importar copy do Google Docs (link ou arquivo)"
      title="Importar copy do Google Docs — lê com a inteligência do ClickUp Pilot"
      className={
        'group relative grid h-[88px] w-[88px] shrink-0 place-items-center rounded-[26px] ' +
        'transition-all duration-300 ease-[cubic-bezier(.34,1.56,.64,1)] ' +
        (disabled
          ? 'cursor-not-allowed opacity-40'
          : 'cursor-pointer hover:-translate-y-1.5 active:translate-y-0 active:scale-95')
      }
      style={{ transformStyle: 'preserve-3d', perspective: '600px' }}
    >
      {/* Halo externo girando */}
      <span
        className={
          'pointer-events-none absolute inset-[-10px] rounded-full opacity-60 blur-md transition-opacity duration-300 ' +
          (disabled ? '' : 'group-hover:opacity-90 ') +
          (pulse ? 'animate-pulse ' : '')
        }
        style={{
          background:
            'conic-gradient(from 0deg, rgba(34,211,238,0), rgba(34,211,238,.55), rgba(168,85,247,.55), rgba(34,211,238,0))',
          animation: disabled ? undefined : 'docimp-spin 4.5s linear infinite',
        }}
      />
      {/* Corpo do disco com bevel 3D */}
      <span
        className="absolute inset-0 rounded-[26px] border border-cyan-300/40"
        style={{
          background:
            'radial-gradient(120% 120% at 30% 20%, rgba(34,211,238,.25), rgba(10,12,16,.92) 55%, rgba(5,6,9,.98))',
          boxShadow:
            'inset 0 2px 3px rgba(255,255,255,.18), inset 0 -6px 14px rgba(0,0,0,.7), 0 14px 30px -10px rgba(34,211,238,.55), 0 4px 10px rgba(0,0,0,.6)',
        }}
      />
      {/* Anel interno girando ao contrario */}
      <span
        className="pointer-events-none absolute inset-[14px] rounded-full border border-dashed border-cyan-200/30"
        style={{ animation: disabled ? undefined : 'docimp-spin-rev 7s linear infinite' }}
      />
      {/* Icone central: documento + seta de import + linha de scan */}
      <span className="relative z-10 grid place-items-center text-cyan-100 drop-shadow-[0_2px_4px_rgba(0,0,0,.6)]">
        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
          <path d="M14 3v5h5" />
          <line x1="9" y1="13" x2="15" y2="13" className="text-cyan-300" />
          <line x1="9" y1="16.5" x2="13" y2="16.5" className="text-cyan-300" />
        </svg>
        {/* Linha de scan animada */}
        {!disabled ? (
          <span
            className="pointer-events-none absolute left-1/2 top-1/2 h-[2px] w-9 -translate-x-1/2 rounded-full bg-cyan-300/80"
            style={{
              boxShadow: '0 0 8px 1px rgba(34,211,238,.9)',
              animation: 'docimp-scan 2.2s ease-in-out infinite',
            }}
          />
        ) : null}
      </span>

      <style jsx>{`
        @keyframes docimp-spin {
          to { transform: rotate(360deg); }
        }
        @keyframes docimp-spin-rev {
          to { transform: rotate(-360deg); }
        }
        @keyframes docimp-scan {
          0%, 100% { transform: translate(-50%, -10px); opacity: 0; }
          50% { transform: translate(-50%, 10px); opacity: 1; }
        }
      `}</style>
    </button>
  );
}
