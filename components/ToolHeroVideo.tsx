'use client';

import { useEffect, useRef } from 'react';

/**
 * ToolHeroVideo — HERO das ferramentas de IA. O .mp4 16:9 do card É o hero
 * inteiro: ocupa o card todo, em loop, sem título/pipeline/stats por cima.
 *
 * Autoplay BLINDADO (toca quando a aba fica visível, retoma no visibilitychange)
 * pra nunca ficar parado/preto. Mudo + loop + playsInline + sem controles.
 *
 * Usado por: LipSync, Auto B-roll, Decupagem Inteligente, Gerador de SRT,
 * Hey Auto e Removedor de Legenda — um único componente, zero duplicação.
 */
export type ToolHeroVideoProps = {
  /** Caminho do .mp4 em /public (ex.: /cards/lipsync.mp4) */
  src: string;
  /** Poster (primeiro frame) — evita flash preto antes do vídeo tocar */
  poster?: string;
  /** Classes extras no wrapper externo */
  className?: string;
};

export function ToolHeroVideo({ src, poster, className = '' }: ToolHeroVideoProps) {
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
    <div
      className={
        'relative w-full overflow-hidden rounded-[24px] border border-line/60 ' +
        className
      }
      style={{ boxShadow: '0 30px 70px -30px rgba(0,0,0,0.7)' }}
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
        className="block aspect-video w-full object-cover"
        style={{ transform: 'translateZ(0)', backfaceVisibility: 'hidden' }}
      />
    </div>
  );
}
