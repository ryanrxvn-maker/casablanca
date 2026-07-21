'use client';

/**
 * AuthScenes — as duas cenas animadas do login/registro (AuthShell v6).
 *
 * Substituem o coelho dormindo + mockup de geração de imagem da era
 * "automação". Agora as cenas mostram FERRAMENTAS REAIS que o cliente usa:
 *   1. WaveCutCard — decupagem ao vivo: waveform com trechos de silêncio
 *      sendo cortados em loop, playhead varrendo.
 *   2. SrtAlignCard — Gerador de SRT: legenda alinhando à copy palavra por
 *      palavra, com caret digitando.
 *
 * Tudo CSS puro (sem WebGL, sem assets), aria-hidden — puro decorativo.
 */

/* Waveform determinística (nada de Math.random — SSR/hydration safe).
 * `s: true` = trecho de silêncio: barra baixa avermelhada que o corte remove. */
const BARS: Array<{ h: number; s?: boolean }> = [
  { h: 34 }, { h: 58 }, { h: 42 }, { h: 76 }, { h: 50 }, { h: 88 }, { h: 38 }, { h: 64 },
  { h: 8, s: true }, { h: 6, s: true }, { h: 9, s: true }, { h: 7, s: true },
  { h: 52 }, { h: 80 }, { h: 36 }, { h: 68 }, { h: 44 }, { h: 86 }, { h: 58 }, { h: 30 }, { h: 72 },
  { h: 7, s: true }, { h: 9, s: true }, { h: 6, s: true }, { h: 8, s: true },
  { h: 40 }, { h: 74 }, { h: 54 }, { h: 84 }, { h: 32 }, { h: 66 },
  { h: 8, s: true }, { h: 6, s: true }, { h: 9, s: true },
  { h: 60 }, { h: 78 },
];

/* Delay do "snip" por grupo de silêncio (índice do 1º bar do grupo → delay) */
function snipDelay(i: number): string {
  if (i <= 11) return `${1 + (i - 8) * 0.06}s`;
  if (i <= 24) return `${2.8 + (i - 21) * 0.06}s`;
  return `${4.4 + (i - 31) * 0.06}s`;
}

export function WaveCutCard() {
  return (
    <div
      aria-hidden
      className="relative overflow-hidden rounded-[22px] border border-line/70"
      style={{
        height: 280,
        background:
          'radial-gradient(60% 80% at 50% 55%, rgba(167,139,250,0.16), transparent 70%), linear-gradient(180deg, rgb(var(--bg-softer)), var(--card-deep))',
      }}
    >
      {/* chips do topo */}
      <div className="absolute left-3.5 right-3.5 top-3.5 flex items-center justify-between">
        <span
          className="rounded-full border border-violet/35 bg-violet/10 px-2.5 py-1 text-[8.5px] font-bold uppercase tracking-[0.2em] text-violet backdrop-blur-md"
          style={{ fontFamily: 'var(--font-tech)' }}
        >
          Decupagem
        </span>
        <span className="flex items-center gap-1.5 rounded-full border border-white/10 bg-black/55 px-2.5 py-1 backdrop-blur-md">
          <span className="h-1 w-1 rounded-full bg-lime shadow-[0_0_6px_rgba(200,214,132,0.9)]" />
          <span className="num text-[9.5px] text-lime" style={{ fontFamily: 'var(--font-mono)' }}>
            −06:12
          </span>
          <span
            className="text-[7.5px] font-bold uppercase tracking-[0.16em] text-white/45"
            style={{ fontFamily: 'var(--font-tech)' }}
          >
            silêncio
          </span>
        </span>
      </div>

      {/* waveform */}
      <div className="absolute inset-x-5 top-1/2 flex h-[112px] -translate-y-1/2 items-center justify-center gap-[2.5px]">
        {BARS.map((b, i) => (
          <span
            key={i}
            className={b.s ? 'wc-bar wc-silence' : 'wc-bar wc-speech'}
            style={{
              height: b.h,
              animationDelay: b.s ? snipDelay(i) : `${i * 0.05}s`,
            }}
          />
        ))}
        {/* playhead */}
        <span className="wc-playhead" />
      </div>

      {/* label rodapé */}
      <div
        className="absolute bottom-3 left-3 right-3 text-center"
        style={{ fontFamily: 'var(--font-tech)' }}
      >
        <div className="text-[9.5px] font-bold uppercase tracking-[0.22em] text-violet">
          O silêncio some · a fala fica
        </div>
      </div>

      <style jsx>{`
        .wc-bar {
          display: inline-block;
          width: 4px;
          flex: 0 0 4px;
          border-radius: 2px;
        }
        .wc-speech {
          background: linear-gradient(180deg, #c4b5fd, #a78bfa 55%, #8b5cf6);
          box-shadow: 0 0 8px rgba(167, 139, 250, 0.35);
          animation: wc-bob 2.2s ease-in-out infinite alternate;
        }
        .wc-silence {
          background: rgba(248, 113, 113, 0.6);
          box-shadow: 0 0 6px rgba(248, 113, 113, 0.35);
          animation: wc-snip 6s ease-in-out infinite;
        }
        @keyframes wc-bob {
          from { transform: scaleY(1); }
          to { transform: scaleY(0.72); }
        }
        @keyframes wc-snip {
          0%, 6% { opacity: 0.9; transform: scaleY(1); }
          10% { opacity: 1; transform: scaleY(1.4); }
          16%, 72% { opacity: 0.12; transform: scaleY(0.06); }
          84%, 100% { opacity: 0.9; transform: scaleY(1); }
        }
        .wc-playhead {
          position: absolute;
          top: -10%;
          bottom: -10%;
          left: 0;
          width: 2px;
          border-radius: 2px;
          background: linear-gradient(180deg, transparent, rgba(255, 255, 255, 0.9) 30%, rgba(192, 132, 252, 0.95) 70%, transparent);
          box-shadow: 0 0 14px rgba(192, 132, 252, 0.8);
          animation: wc-sweep 5.5s linear infinite;
        }
        @keyframes wc-sweep {
          from { left: 0%; }
          to { left: 100%; }
        }
        @media (prefers-reduced-motion: reduce) {
          .wc-speech, .wc-silence, .wc-playhead {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}

export function SrtAlignCard() {
  return (
    <div
      aria-hidden
      className="relative overflow-hidden rounded-[22px] border border-line/70"
      style={{
        height: 280,
        background:
          'radial-gradient(60% 70% at 80% 20%, rgba(126,213,226,0.14), transparent 65%), linear-gradient(180deg, rgb(var(--bg-softer)), var(--card-deep))',
      }}
    >
      {/* janela */}
      <div
        className="absolute left-3 right-3 top-3 overflow-hidden rounded-[14px] border border-white/8 bg-black/60 backdrop-blur-xl"
        style={{
          boxShadow: '0 16px 32px -12px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.05)',
        }}
      >
        {/* top bar */}
        <div className="flex items-center gap-1.5 border-b border-white/8 px-3 py-2">
          <span className="h-2 w-2 rounded-full bg-red-400/70" />
          <span className="h-2 w-2 rounded-full bg-amber-400/70" />
          <span className="h-2 w-2 rounded-full bg-emerald-400/70" />
          <span
            className="ml-2 text-[8.5px] font-bold uppercase tracking-[0.18em] text-violet"
            style={{ fontFamily: 'var(--font-tech)' }}
          >
            legenda.srt
          </span>
          <span
            className="ml-auto text-[8.5px] text-white/40"
            style={{ fontFamily: 'var(--font-mono)' }}
          >
            alinhando…
          </span>
        </div>

        {/* blocos SRT */}
        <div className="space-y-2.5 px-3.5 py-3" style={{ fontFamily: 'var(--font-mono)' }}>
          <div>
            <div className="num text-[9px] text-violet/85">00:04,120 → 00:05,360</div>
            <div className="text-[11.5px] text-white/90">sobe o áudio e a copy</div>
          </div>
          <div>
            <div className="num text-[9px] text-violet/85">00:05,520 → 00:06,940</div>
            <div className="text-[11.5px] text-white/90">a legenda sai alinhada</div>
          </div>
          <div>
            <div className="num text-[9px] text-violet/85">00:07,100 → 00:08,220</div>
            <div className="srt-typing text-[11.5px] text-white/90">pronta pro CapCut</div>
          </div>
        </div>

        {/* progresso */}
        <div className="px-3.5 pb-3">
          <div className="flex items-center justify-between">
            <span
              className="text-[8px] font-bold uppercase tracking-[0.18em] text-text-muted"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              palavra por palavra
            </span>
            <span className="num text-[9px] text-cyan-300" style={{ fontFamily: 'var(--font-mono)' }}>
              18 / 24
            </span>
          </div>
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/8">
            <div className="srt-bar h-full rounded-full" />
          </div>
        </div>
      </div>

      {/* label rodapé */}
      <div
        className="absolute bottom-3 left-3 right-3 text-center"
        style={{ fontFamily: 'var(--font-tech)' }}
      >
        <div className="text-[9.5px] font-bold uppercase tracking-[0.22em] text-cyan-300/90">
          Legenda alinhada à copy
        </div>
      </div>

      <style jsx>{`
        .srt-typing::after {
          content: '▍';
          margin-left: 1px;
          color: rgba(167, 139, 250, 0.9);
          animation: srt-caret 1.05s steps(1) infinite;
        }
        @keyframes srt-caret {
          0%, 60% { opacity: 1; }
          61%, 100% { opacity: 0; }
        }
        .srt-bar {
          width: 75%;
          background: linear-gradient(90deg, #a78bfa, #67e8f9);
          box-shadow: 0 0 8px rgba(167, 139, 250, 0.6);
          animation: srt-glow 2.4s ease-in-out infinite;
        }
        @keyframes srt-glow {
          0%, 100% { opacity: 0.8; }
          50% { opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          .srt-typing::after, .srt-bar {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}
