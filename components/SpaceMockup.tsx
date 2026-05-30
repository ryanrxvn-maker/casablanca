/**
 * SpaceMockup — janela tipo Space (HF/Replicate) gerando imagem.
 *
 * Mockup decorativo: top bar mac, "gerando" com spinner, frame da imagem
 * em construção com scan line + thumbnails de outputs anteriores embaixo.
 * Ambiente cinematográfico violet/cyan.
 */
export function SpaceMockup() {
  return (
    <div
      className="relative overflow-hidden rounded-[22px] border border-line/70"
      style={{
        height: 280,
        background:
          'radial-gradient(60% 70% at 80% 20%, rgba(103,232,249,0.18), transparent 65%), linear-gradient(180deg, rgb(var(--bg-softer)), #0a0a0c)',
      }}
    >
      {/* Janela mockup */}
      <div
        className="absolute left-3 right-3 top-3 overflow-hidden rounded-[14px] border border-white/8 bg-black/60 backdrop-blur-xl"
        style={{
          boxShadow:
            '0 16px 32px -12px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.05)',
        }}
      >
        {/* Top bar */}
        <div className="flex items-center gap-1.5 border-b border-white/8 px-3 py-2">
          <span className="h-2 w-2 rounded-full bg-red-400/70" />
          <span className="h-2 w-2 rounded-full bg-amber-400/70" />
          <span className="h-2 w-2 rounded-full bg-emerald-400/70" />
          <span
            className="ml-2 text-[8.5px] font-bold uppercase tracking-[0.18em] text-violet"
            style={{ fontFamily: 'var(--font-tech)' }}
          >
            · gerando
          </span>
          <span className="ml-auto inline-flex">
            <span
              className="h-3 w-3 rounded-full border-2 border-violet/40 border-t-violet"
              style={{ animation: 'space-spin 1s linear infinite' }}
            />
          </span>
        </div>

        {/* Frame de imagem em construção */}
        <div
          className="relative aspect-[4/3] w-full overflow-hidden"
          style={{
            background:
              'linear-gradient(135deg, rgba(167,139,250,0.32) 0%, rgba(103,232,249,0.20) 50%, rgba(244,114,182,0.18) 100%)',
          }}
        >
          {/* Pattern dot grid */}
          <div
            aria-hidden
            className="absolute inset-0 opacity-30"
            style={{
              backgroundImage:
                'radial-gradient(circle at center, rgba(255,255,255,0.15) 1px, transparent 1px)',
              backgroundSize: '12px 12px',
            }}
          />

          {/* Scan line */}
          <div
            aria-hidden
            className="absolute inset-x-0 h-[3px]"
            style={{
              background:
                'linear-gradient(90deg, transparent, rgba(192,132,252,0.95) 45%, rgba(255,255,255,0.9) 50%, rgba(192,132,252,0.95) 55%, transparent)',
              boxShadow: '0 0 18px rgba(192,132,252,0.85)',
              animation: 'space-scan 2.6s ease-in-out infinite',
            }}
          />

          {/* Pequena silhueta sugerindo personagem sendo desenhado */}
          <svg
            viewBox="0 0 100 75"
            className="absolute inset-0 h-full w-full opacity-80"
            preserveAspectRatio="xMidYMid meet"
          >
            <path
              d="M50 18a8 8 0 110 16 8 8 0 010-16z"
              fill="none"
              stroke="rgba(255,255,255,0.55)"
              strokeWidth="0.8"
              strokeDasharray="2 1.5"
              style={{ animation: 'space-trace 4s linear infinite' }}
            />
            <path
              d="M30 65c0-10 9-18 20-18s20 8 20 18"
              fill="none"
              stroke="rgba(255,255,255,0.45)"
              strokeWidth="0.8"
              strokeDasharray="2 1.5"
              style={{
                animation: 'space-trace 4s linear infinite',
                animationDelay: '0.8s',
              }}
            />
          </svg>
        </div>

        {/* Barra de progresso fake */}
        <div className="px-3 py-2.5">
          <div className="flex items-center justify-between">
            <span
              className="text-[8.5px] font-bold uppercase tracking-[0.18em] text-text-muted"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              Step 18 / 24
            </span>
            <span
              className="text-[9px] text-cyan-300"
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              4.2s
            </span>
          </div>
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/8">
            <div
              className="h-full rounded-full"
              style={{
                width: '75%',
                background: 'linear-gradient(90deg, #a78bfa, #67e8f9)',
                boxShadow: '0 0 8px rgba(167,139,250,0.6)',
                animation: 'space-bar 2.4s ease-in-out infinite',
              }}
            />
          </div>
        </div>
      </div>

      {/* Thumbnails antigos embaixo */}
      <div className="absolute bottom-3 left-3 right-3 flex items-center gap-1.5">
        <Thumb hue="rgba(167,139,250,0.5)" />
        <Thumb hue="rgba(103,232,249,0.5)" />
        <Thumb hue="rgba(244,114,182,0.5)" />
        <Thumb hue="rgba(200,255,0,0.5)" />
        <Thumb hue="rgba(167,139,250,0.5)" />
        <span
          className="ml-auto text-[8.5px] font-bold uppercase tracking-[0.18em] text-text-muted"
          style={{ fontFamily: 'var(--font-tech)' }}
        >
          fila · 06
        </span>
      </div>

      <style jsx>{`
        @keyframes space-spin {
          to { transform: rotate(360deg); }
        }
        @keyframes space-scan {
          0% { top: 0; }
          100% { top: 100%; }
        }
        @keyframes space-trace {
          0% { stroke-dashoffset: 0; }
          100% { stroke-dashoffset: -20; }
        }
        @keyframes space-bar {
          0%, 100% { opacity: 0.8; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}

function Thumb({ hue }: { hue: string }) {
  return (
    <span
      aria-hidden
      className="h-8 w-8 shrink-0 rounded-[6px] border border-white/8"
      style={{
        background: `linear-gradient(135deg, ${hue}, rgba(0,0,0,0.4))`,
        boxShadow: `0 0 12px -4px ${hue}`,
      }}
    />
  );
}
