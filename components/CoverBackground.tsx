'use client';

import { useEffect, useRef } from 'react';

/**
 * Animacoes de fundo canvas-based usadas no hero do portfolio publico.
 * Sao leves (60fps mesmo em mobile) e respeitam prefers-reduced-motion
 * (desliga a animacao nesses casos, mantendo so o fundo estatico).
 */
export function CoverBackground({ cover }: { cover: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) return;
    if (cover === 'minimal') return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let running = true;

    function resize() {
      if (!canvas) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener('resize', resize);

    const cleanup = startAnimation(cover, canvas, ctx, () => running);

    function loop() {
      if (!running) return;
      raf = requestAnimationFrame(loop);
    }
    loop();

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      cleanup?.();
    };
  }, [cover]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 h-full w-full opacity-40"
      aria-hidden
    />
  );
}

type Stop = () => void;

function startAnimation(
  cover: string,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  isRunning: () => boolean,
): Stop | void {
  switch (cover) {
    case 'matrix':
      return startMatrix(canvas, ctx, isRunning);
    case 'dollars':
      return startDollars(canvas, ctx, isRunning);
    case 'tech':
      return startTech(canvas, ctx, isRunning);
    default:
      return startParticles(canvas, ctx, isRunning);
  }
}

// --- Matrix rain ---
function startMatrix(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  isRunning: () => boolean,
): Stop {
  const chars = '01アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモ';
  const fontSize = 14;
  let cols = Math.ceil(canvas.clientWidth / fontSize);
  let drops: number[] = Array.from({ length: cols }, () =>
    Math.random() * -30,
  );

  function render() {
    if (!isRunning()) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    cols = Math.ceil(w / fontSize);
    if (drops.length !== cols) {
      drops = Array.from({ length: cols }, (_, i) => drops[i] ?? Math.random() * -30);
    }

    ctx.fillStyle = 'rgba(3,5,3,0.16)';
    ctx.fillRect(0, 0, w, h);

    ctx.font = fontSize + 'px monospace';
    ctx.fillStyle = '#84cc16'; // lime-500
    for (let i = 0; i < drops.length; i++) {
      const c = chars[Math.floor(Math.random() * chars.length)];
      ctx.fillText(c, i * fontSize, drops[i] * fontSize);
      if (drops[i] * fontSize > h && Math.random() > 0.975) {
        drops[i] = 0;
      }
      drops[i] += 0.6;
    }
    requestAnimationFrame(render);
  }
  render();
  return () => {};
}

// --- Falling dollars ---
function startDollars(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  isRunning: () => boolean,
): Stop {
  type Bill = { x: number; y: number; v: number; s: number; r: number; rv: number };
  let bills: Bill[] = [];
  const COUNT = 32;

  function spawn(): Bill {
    return {
      x: Math.random() * canvas.clientWidth,
      y: Math.random() * -canvas.clientHeight,
      v: 0.6 + Math.random() * 1.6,
      s: 16 + Math.random() * 14,
      r: Math.random() * Math.PI,
      rv: (Math.random() - 0.5) * 0.04,
    };
  }
  bills = Array.from({ length: COUNT }, spawn);

  function render() {
    if (!isRunning()) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    ctx.fillStyle = 'rgba(2,3,2,0.2)';
    ctx.fillRect(0, 0, w, h);

    for (const b of bills) {
      b.y += b.v;
      b.r += b.rv;
      if (b.y > h + 20) {
        Object.assign(b, spawn(), { y: -20 });
      }
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.r);
      ctx.font = `bold ${b.s}px system-ui`;
      ctx.fillStyle = '#22c55e'; // green-500
      ctx.fillText('$', -b.s / 3, b.s / 3);
      ctx.restore();
    }
    requestAnimationFrame(render);
  }
  render();
  return () => {};
}

// --- Tech grid + scanner line ---
function startTech(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  isRunning: () => boolean,
): Stop {
  let t = 0;

  function render() {
    if (!isRunning()) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    ctx.fillStyle = 'rgba(3,7,18,0.35)';
    ctx.fillRect(0, 0, w, h);

    // Grid
    ctx.strokeStyle = 'rgba(59,130,246,0.18)';
    ctx.lineWidth = 1;
    const step = 40;
    for (let x = 0; x < w; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y < h; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Scanner horizontal
    const scan = (Math.sin(t / 80) * 0.5 + 0.5) * h;
    const grad = ctx.createLinearGradient(0, scan - 30, 0, scan + 30);
    grad.addColorStop(0, 'rgba(59,130,246,0)');
    grad.addColorStop(0.5, 'rgba(59,130,246,0.35)');
    grad.addColorStop(1, 'rgba(59,130,246,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, scan - 30, w, 60);

    t++;
    requestAnimationFrame(render);
  }
  render();
  return () => {};
}

// --- Subtle particles (default) ---
function startParticles(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  isRunning: () => boolean,
): Stop {
  type P = { x: number; y: number; vx: number; vy: number; r: number };
  const particles: P[] = Array.from({ length: 50 }, () => ({
    x: Math.random() * canvas.clientWidth,
    y: Math.random() * canvas.clientHeight,
    vx: (Math.random() - 0.5) * 0.3,
    vy: (Math.random() - 0.5) * 0.3,
    r: 1 + Math.random() * 1.5,
  }));

  function render() {
    if (!isRunning()) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    ctx.fillStyle = 'rgba(3,5,3,0.22)';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(132,204,22,0.55)';
    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0 || p.x > w) p.vx *= -1;
      if (p.y < 0 || p.y > h) p.vy *= -1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    // Lines between near particles
    ctx.strokeStyle = 'rgba(132,204,22,0.08)';
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const d2 = dx * dx + dy * dy;
        if (d2 < 120 * 120) {
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.stroke();
        }
      }
    }
    requestAnimationFrame(render);
  }
  render();
  return () => {};
}
