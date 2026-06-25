'use client';

import { useEffect, useRef } from 'react';

/**
 * HeroParticles — camada de partículas magenta/lilás que pulsam, em <canvas>.
 * Dimensiona-se ao ELEMENTO PAI (que deve ser position:relative). rAF + pausa
 * via IntersectionObserver; respeita prefers-reduced-motion. Reusada pelos heros
 * da home (HeroSlideBg) e pelo hero das ferramentas (ToolHeroVideo).
 */
export function HeroParticles({
  count = 18,
  biasRight = false,
  className = '',
}: {
  count?: number;
  biasRight?: boolean;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;
    const prefersReduce =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduce) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const COLORS = ['#E879F9', '#C084FC'];
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0;
    let h = 0;
    type P = { x: number; y: number; r: number; color: string; alpha: number; period: number; phase: number };
    let particles: P[] = [];

    const build = () => {
      const rect = parent.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      particles = Array.from({ length: count }, () => {
        const x = (biasRight ? (Math.random() < 0.8 ? 0.4 + Math.random() * 0.6 : Math.random()) : Math.random()) * w;
        return {
          x,
          y: Math.random() * h,
          r: 3 + Math.random() * 2,
          color: COLORS[Math.floor(Math.random() * COLORS.length)],
          alpha: 0.4 + Math.random() * 0.25,
          period: 2000 + Math.random() * 3000,
          phase: Math.random() * Math.PI * 2,
        };
      });
    };
    build();
    const ro = new ResizeObserver(build);
    ro.observe(parent);

    const toRGBA = (hex: string, a: number) => {
      const n = parseInt(hex.slice(1), 16);
      return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
    };

    let raf = 0;
    let running = false;
    const frame = (now: number) => {
      ctx.clearRect(0, 0, w, h);
      for (const p of particles) {
        const s = Math.sin((2 * Math.PI * now) / p.period + p.phase);
        const scale = 1 + 0.35 * s;
        const alpha = p.alpha * (0.7 + 0.3 * s);
        const rad = p.r * scale * 3;
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rad);
        g.addColorStop(0, toRGBA(p.color, alpha));
        g.addColorStop(1, toRGBA(p.color, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, rad, 0, Math.PI * 2);
        ctx.fill();
      }
      raf = requestAnimationFrame(frame);
    };
    const play = () => {
      if (!running) {
        running = true;
        raf = requestAnimationFrame(frame);
      }
    };
    const pause = () => {
      running = false;
      cancelAnimationFrame(raf);
    };
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => (e.isIntersecting ? play() : pause())),
      { threshold: 0.05 },
    );
    io.observe(parent);

    return () => {
      pause();
      ro.disconnect();
      io.disconnect();
    };
  }, [count, biasRight]);

  return <canvas ref={canvasRef} aria-hidden className={'absolute inset-0 h-full w-full ' + className} />;
}
