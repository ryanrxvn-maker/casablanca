'use client';

import { useEffect, useRef } from 'react';

/**
 * HeroSlideBg — fundo cinematográfico ANIMADO dos slides do carrossel promo
 * (ClickUp Pilot / Auto B-roll). Camadas, de baixo pra cima:
 *
 *   1. <img> da imagem (object-cover, center right) com PARALLAX no mousemove
 *      (move devagar no sentido OPOSTO ao cursor, máx 4%); no mobile/touch vira
 *      um drift automático lento (8s, ±2%). Respeita prefers-reduced-motion.
 *   2. Véu branco só no modo claro (rgba 255,255,255,.82) pro texto não sumir.
 *   3. Vinheta que "respira" (opacity 0.25↔0.45 em 5s).
 *   4. <canvas> com 18 partículas magenta/lilás que pulsam (requestAnimationFrame,
 *      pausa via IntersectionObserver quando sai da viewport).
 *
 * Tudo é absolute inset-0 + pointer-events-none → fica ATRÁS do conteúdo (que
 * recebe z-[2]) e não atrapalha cliques. Só anima transform/opacity.
 */
export function HeroSlideBg({ image }: { image: string }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

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

  // ---- Partículas (canvas + rAF + IntersectionObserver) ----
  useEffect(() => {
    const canvas = canvasRef.current;
    const root = rootRef.current;
    if (!canvas || !root) return;
    const prefersReduce =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduce) return; // sem partículas em reduced-motion
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const COLORS = ['#E879F9', '#C084FC'];
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0;
    let h = 0;
    type P = { x: number; y: number; r: number; color: string; alpha: number; period: number; phase: number };
    let particles: P[] = [];

    const build = () => {
      const rect = root.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      particles = Array.from({ length: 18 }, () => {
        // viés pros 60% da direita (80% das partículas nascem em x>0.4)
        const x = (Math.random() < 0.8 ? 0.4 + Math.random() * 0.6 : Math.random()) * w;
        return {
          x,
          y: Math.random() * h,
          r: 3 + Math.random() * 2, // 3–5px
          color: COLORS[Math.floor(Math.random() * COLORS.length)],
          alpha: 0.4 + Math.random() * 0.25, // 0.4–0.65
          period: 2000 + Math.random() * 3000, // 2–5s
          phase: Math.random() * Math.PI * 2,
        };
      });
    };
    build();
    const ro = new ResizeObserver(build);
    ro.observe(root);

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
        const rad = p.r * scale * 3; // halo suave
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
    io.observe(root);

    return () => {
      pause();
      ro.disconnect();
      io.disconnect();
    };
  }, []);

  return (
    <div
      ref={rootRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
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
      {/* 2. Véu branco (só modo claro) */}
      <div className="hero-light-veil absolute inset-0" />
      {/* 3. Vinheta que respira */}
      <div className="hero-vignette absolute inset-0" />
      {/* 4. Partículas */}
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
    </div>
  );
}
