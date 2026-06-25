'use client';

import { useEffect, useRef } from 'react';

/**
 * ToolHeroVideo — painel de vídeo 16:9 premium pro lado direito dos heroes
 * das ferramentas de IA. Mostra o .mp4 do card INTEIRO (object-cover num quadro
 * 16:9 = sem corte), com anel conic rotativo, aura, cantos HUD e flutuação leve.
 *
 * Autoplay BLINDADO (toca quando a aba fica visível, retoma no visibilitychange)
 * pra nunca ficar parado/preto. Mudo + loop + playsInline + sem controles.
 *
 * Compartilhado por: LipSync, Auto B-roll, Decupagem Inteligente, Gerador SRT,
 * Hey Auto (via ToolHero3D). Um único componente → zero duplicação.
 */
export type ToolHeroVideoProps = {
  /** Caminho do .mp4 em /public (ex.: /cards/lipsync.mp4) */
  src: string;
  /** Poster (primeiro frame) — some assim que o vídeo toca */
  poster?: string;
  /** Cor do glow/aura/anel (rgba). Default violet. */
  glow?: string;
  /** Parallax 3D vindo do hero (graus). Default 0. */
  tiltX?: number;
  tiltY?: number;
  /** Classes extras no wrapper externo (largura, etc.) */
  className?: string;
};

export function ToolHeroVideo({
  src,
  poster,
  glow = 'rgba(167,139,250,0.5)',
  tiltX = 0,
  tiltY = 0,
  className = '',
}: ToolHeroVideoProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Autoplay blindado — o navegador pausa vídeo com a aba em segundo plano.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const tryPlay = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      const p = v.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    };
    tryPlay();
    const t = setTimeout(tryPlay, 140);
    document.addEventListener('visibilitychange', tryPlay);
    return () => {
      clearTimeout(t);
      document.removeEventListener('visibilitychange', tryPlay);
    };
  }, []);

  return (
    <div className={'relative ' + className}>
      {/* Aura glow atrás do quadro */}
      <div
        aria-hidden
        className="absolute inset-[-12%] rounded-[28px] blur-3xl"
        style={{
          background: `radial-gradient(circle, ${glow}, transparent 72%)`,
          animation: 'thvAura 5s ease-in-out infinite',
        }}
      />

      {/* Wrapper parallax 3D + flutuação */}
      <div
        className="relative"
        style={{
          transformStyle: 'preserve-3d',
          transform: `perspective(1200px) rotateX(${tiltX}deg) rotateY(${tiltY}deg)`,
          transition: 'transform 0.6s cubic-bezier(.2,.8,.2,1)',
        }}
      >
        <div
          className="relative aspect-video w-full"
          style={{ animation: 'thvFloat 6s ease-in-out infinite' }}
        >
          {/* Anel conic rotativo (borda premium) */}
          <div
            aria-hidden
            className="absolute inset-[-4px] rounded-[22px]"
            style={{
              background:
                'conic-gradient(from 0deg, #e879f9, #a78bfa, #67e8f9, #c2cf86, #e879f9)',
              animation: 'thvSpin 9s linear infinite',
              filter: 'blur(2px)',
              opacity: 0.85,
            }}
          />

          {/* Quadro do vídeo */}
          <div
            className="absolute inset-0 overflow-hidden rounded-[20px]"
            style={{
              boxShadow:
                'inset 0 0 0 1px rgba(255,255,255,0.08), 0 20px 60px -10px rgba(0,0,0,0.6), 0 0 0 1px rgba(0,0,0,0.4)',
              background: '#05050a',
            }}
          >
            <video
              ref={videoRef}
              src={src}
              poster={poster}
              autoPlay
              loop
              muted
              playsInline
              preload="auto"
              className="absolute inset-0 h-full w-full object-cover"
              style={{ transform: 'translateZ(0)', backfaceVisibility: 'hidden' }}
            />
            {/* Brilho no topo (rim light) */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-1/3"
              style={{
                background:
                  'linear-gradient(180deg, rgba(255,255,255,0.14), transparent 100%)',
                mixBlendMode: 'soft-light',
              }}
            />
            {/* Vinheta */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 rounded-[20px]"
              style={{ boxShadow: 'inset 0 -40px 60px -24px rgba(0,0,0,0.5)' }}
            />
          </div>

          {/* Cantos HUD */}
          <Corner pos="tl" glow={glow} />
          <Corner pos="tr" glow={glow} />
          <Corner pos="bl" glow={glow} />
          <Corner pos="br" glow={glow} />
        </div>
      </div>

      <style jsx>{`
        @keyframes thvAura {
          0%, 100% { transform: scale(1); opacity: 0.6; }
          50% { transform: scale(1.12); opacity: 1; }
        }
        @keyframes thvSpin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes thvFloat {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-8px); }
        }
      `}</style>
    </div>
  );
}

function Corner({ pos, glow }: { pos: 'tl' | 'tr' | 'bl' | 'br'; glow: string }) {
  const cls = {
    tl: 'left-[-6px] top-[-6px] border-l-2 border-t-2 rounded-tl-[8px]',
    tr: 'right-[-6px] top-[-6px] border-r-2 border-t-2 rounded-tr-[8px]',
    bl: 'left-[-6px] bottom-[-6px] border-l-2 border-b-2 rounded-bl-[8px]',
    br: 'right-[-6px] bottom-[-6px] border-r-2 border-b-2 rounded-br-[8px]',
  }[pos];
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute h-5 w-5 ${cls}`}
      style={{ borderColor: glow }}
    />
  );
}
