'use client';

import { useEffect, useRef } from 'react';
import { HeroParticles } from '@/components/HeroParticles';

/**
 * HeroSlideBg — fundo cinematográfico ANIMADO dos slides do carrossel promo
 * (ClickUp Pilot / Auto B-roll). Camadas, de baixo pra cima:
 *
 *   1. <img> da imagem (object-cover, center right) com PARALLAX no mousemove
 *      (move devagar no sentido OPOSTO ao cursor, máx 4%); no mobile/touch vira
 *      um drift automático lento (8s, ±2%). Respeita prefers-reduced-motion.
 *   1b. Bloom que respira + feixe de luz (mix-blend screen) acendendo detalhes.
 *   2. Véu branco só no modo claro (gradiente à esquerda) pro texto não sumir.
 *   3. Vinheta que "respira" (opacity 0.25↔0.45 em 5s).
 *   4. <HeroParticles> — partículas magenta/lilás que pulsam.
 *
 * Tudo é absolute inset-0 + pointer-events-none → fica ATRÁS do conteúdo (que
 * recebe z-[2]) e não atrapalha cliques. Só anima transform/opacity.
 */
export function HeroSlideBg({ image }: { image: string }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  // ---- Parallax (desktop) / drift (mobile) / reduced-motion ----
  useEffect(() => {
    const root = rootRef.current;
    const img = imgRef.current;
    if (!root || !img) return;
    const slide = root.parentElement;
    const prefersReduce =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduce) {
      img.style.transform = 'scale(1.1)';
      return;
    }
    const isTouch =
      typeof window !== 'undefined' && window.matchMedia?.('(hover: none)').matches;
    if (isTouch || !slide) {
      img.style.animation = 'heroDrift 8s ease-in-out infinite alternate';
      return;
    }
    const onMove = (e: MouseEvent) => {
      const r = slide.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5; // -0.5..0.5
      const py = (e.clientY - r.top) / r.height - 0.5;
      // sentido oposto, máximo 4% (px*8 com px máx 0.5 → 4)
      img.style.transform = `scale(1.1) translate(${(-px * 8).toFixed(2)}%, ${(-py * 8).toFixed(2)}%)`;
    };
    const onLeave = () => {
      img.style.transform = 'scale(1.1) translate(0%, 0%)';
    };
    slide.addEventListener('mousemove', onMove);
    slide.addEventListener('mouseleave', onLeave);
    return () => {
      slide.removeEventListener('mousemove', onMove);
      slide.removeEventListener('mouseleave', onLeave);
    };
  }, []);

  return (
    <div
      ref={rootRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden isolate"
    >
      {/* 1. Imagem com parallax */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={image}
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
        style={{
          objectPosition: 'center right',
          transform: 'scale(1.1)',
          transition: 'transform 0.2s ease-out',
          willChange: 'transform',
        }}
      />
      {/* 1b. "Vida" da imagem — blend screen acende os detalhes (circuito/nós).
             Bloom que respira na direita + feixe de luz que cruza devagar. */}
      <div className="hero-bloom absolute inset-0" />
      <div className="hero-sweep-wrap absolute inset-0 overflow-hidden">
        <div className="hero-sweep" />
      </div>

      {/* 2. Véu branco (só modo claro) */}
      <div className="hero-light-veil absolute inset-0" />
      {/* 3. Vinheta que respira */}
      <div className="hero-vignette absolute inset-0" />
      {/* 4. Partículas */}
      <HeroParticles count={18} biasRight />
    </div>
  );
}
