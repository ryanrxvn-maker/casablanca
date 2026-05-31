'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * AutoBrollHero — cinematic header for /tools/auto-broll.
 *
 * Features:
 *  - Mesh gradient background (animated, breathing)
 *  - Grid lines + corner accents
 *  - Bunny mascote 3D que segue o mouse com parallax
 *  - Stats pills: 9:16 / 10s / ZIP entrega pronta
 *  - Pipeline visualization: 4 etapas conectadas por glow trail
 *  - Eyebrow tag + title gigante com gradient text + sub
 *  - Floating particles
 */
export function AutoBrollHero() {
  const heroRef = useRef<HTMLDivElement | null>(null);
  const [mouse, setMouse] = useState({ x: 0.5, y: 0.5 });

  useEffect(() => {
    const el = heroRef.current;
    if (!el) return;
    function onMove(e: MouseEvent) {
      const rect = el!.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      setMouse({ x, y });
    }
    el.addEventListener('mousemove', onMove);
    return () => el.removeEventListener('mousemove', onMove);
  }, []);

  const tiltX = (mouse.y - 0.5) * 8;
  const tiltY = (mouse.x - 0.5) * -8;

  return (
    <div
      ref={heroRef}
      className="relative isolate overflow-hidden rounded-[24px] border border-line/60 bg-bg-soft/30 px-6 py-12 md:px-10 md:py-16"
      style={{
        backgroundImage:
          'radial-gradient(40% 60% at 20% 30%, rgba(167,139,250,0.18), transparent 60%), radial-gradient(50% 50% at 80% 70%, rgba(200,232,124,0.10), transparent 60%), radial-gradient(30% 40% at 50% 90%, rgba(34,211,238,0.10), transparent 60%)',
      }}
    >
      {/* Animated mesh gradient layer */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          background:
            'radial-gradient(circle at 30% 20%, rgba(167,139,250,0.25), transparent 40%), radial-gradient(circle at 70% 80%, rgba(200,232,124,0.10), transparent 40%)',
          animation: 'meshBreathe 8s ease-in-out infinite alternate',
        }}
      />

      {/* Subtle grid */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            'linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />

      {/* Floating particles */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        {Array.from({ length: 18 }).map((_, i) => (
          <span
            key={i}
            className="absolute h-1 w-1 rounded-full bg-white/40"
            style={{
              left: `${(i * 37) % 100}%`,
              top: `${(i * 53) % 100}%`,
              animation: `floatDot ${6 + (i % 4)}s ease-in-out ${i * 0.3}s infinite`,
              boxShadow: '0 0 8px rgba(255,255,255,0.6)',
            }}
          />
        ))}
      </div>

      {/* Corner cuts */}
      <CornerCut pos="tl" />
      <CornerCut pos="tr" />
      <CornerCut pos="bl" />
      <CornerCut pos="br" />

      <div className="relative z-10 grid items-center gap-8 md:grid-cols-[1fr_auto]">
        {/* LEFT — content */}
        <div className="flex flex-col gap-4">
          {/* Eyebrow */}
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="mono inline-flex items-center gap-1.5 rounded-full border border-violet/40 bg-violet/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-violet shadow-[0_0_18px_-4px_rgba(167,139,250,0.55)]"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-violet" />
              </span>
              MAGNIFIC · AUTO B-ROLL
            </span>
            <span
              className="mono inline-flex items-center gap-1 rounded-full border border-lime/40 bg-lime/10 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.18em] text-lime"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              ∞ UNLIMITED · ZERO CRÉDITO
            </span>
          </div>

          {/* Title with gradient */}
          <h1
            className="text-5xl font-black leading-[1.02] tracking-tight md:text-7xl"
            style={{
              fontFamily: 'var(--font-display)',
              backgroundImage:
                'linear-gradient(135deg, #ffffff 0%, #fafafa 30%, #c2cf86 60%, #a78bfa 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              backgroundSize: '200% 200%',
              animation: 'titleShine 6s ease-in-out infinite',
            }}
          >
            Auto B-Roll
          </h1>

          <p className="max-w-xl text-[15px] leading-relaxed text-text-muted md:text-[17px]">
            Cola sua lista. Aperta o play. <span className="font-semibold text-white">Os vídeos saem prontos</span> enquanto você faz outra coisa.
          </p>

          {/* Pipeline flowchart */}
          <div className="mt-3 flex flex-wrap items-center gap-1">
            <PipelineStep
              icon="📝"
              label="JSON"
              sub="Prompts do Claude"
              tone="text-text-muted"
            />
            <PipelineArrow />
            <PipelineStep
              icon="🍌"
              label="Imagem"
              sub="Nano Banana · 1K"
              tone="text-violet"
            />
            <PipelineArrow />
            <PipelineStep
              icon="🎬"
              label="Vídeo"
              sub="Kling 2.5 · 720p"
              tone="text-cyan-300"
            />
            <PipelineArrow />
            <PipelineStep
              icon="📦"
              label="ZIP"
              sub="MP4s organizados"
              tone="text-lime"
            />
          </div>

          {/* Stats */}
          <div className="mt-2 grid max-w-xl grid-cols-3 gap-3">
            <StatPill value="9:16" label="vertical · vivo" />
            <StatPill value="10s" label="por take" />
            <StatPill value="ZIP" label="entrega pronta" />
          </div>
        </div>

        {/* RIGHT — bunny mascote 3D */}
        <div
          className="relative hidden h-[280px] w-[280px] shrink-0 md:block"
          style={{
            transformStyle: 'preserve-3d',
            transform: `perspective(1200px) rotateX(${tiltX}deg) rotateY(${tiltY}deg)`,
            transition: 'transform 0.6s cubic-bezier(.2,.8,.2,1)',
          }}
        >
          {/* Aura glow */}
          <div
            aria-hidden
            className="absolute inset-0 rounded-full blur-3xl"
            style={{
              background:
                'radial-gradient(circle, rgba(167,139,250,0.35), rgba(200,232,124,0.15) 50%, transparent 70%)',
              animation: 'auraPulse 4s ease-in-out infinite',
            }}
          />
          {/* Floating bunny */}
          <div
            className="relative flex h-full w-full items-center justify-center"
            style={{
              animation: 'bunnyFloat 5s ease-in-out infinite',
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/auto-edit-logo@256.png"
              alt="Auto Edit"
              width={220}
              height={220}
              className="drop-shadow-[0_30px_60px_rgba(167,139,250,0.5)]"
              style={{
                filter: 'drop-shadow(0 0 30px rgba(200,232,124,0.4))',
              }}
            />
          </div>
          {/* Orbital ring */}
          <div
            aria-hidden
            className="absolute inset-0 rounded-full border border-violet/30"
            style={{ animation: 'ringSpin 30s linear infinite' }}
          />
          <div
            aria-hidden
            className="absolute inset-[-10px] rounded-full border border-lime/15"
            style={{ animation: 'ringSpin 45s linear infinite reverse' }}
          />
        </div>
      </div>

      <style jsx>{`
        @keyframes meshBreathe {
          0%, 100% { transform: scale(1); opacity: 0.6; }
          50% { transform: scale(1.05); opacity: 0.9; }
        }
        @keyframes floatDot {
          0%, 100% { transform: translateY(0) translateX(0); opacity: 0.4; }
          50% { transform: translateY(-20px) translateX(10px); opacity: 1; }
        }
        @keyframes titleShine {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }
        @keyframes auraPulse {
          0%, 100% { transform: scale(1); opacity: 0.7; }
          50% { transform: scale(1.15); opacity: 1; }
        }
        @keyframes bunnyFloat {
          0%, 100% { transform: translateY(0) rotate(-2deg); }
          50% { transform: translateY(-14px) rotate(2deg); }
        }
        @keyframes ringSpin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

function CornerCut({ pos }: { pos: 'tl' | 'tr' | 'bl' | 'br' }) {
  const cls = {
    tl: 'left-3 top-3 border-l-2 border-t-2 rounded-tl-[8px]',
    tr: 'right-3 top-3 border-r-2 border-t-2 rounded-tr-[8px]',
    bl: 'left-3 bottom-3 border-l-2 border-b-2 rounded-bl-[8px]',
    br: 'right-3 bottom-3 border-r-2 border-b-2 rounded-br-[8px]',
  }[pos];
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute h-5 w-5 border-violet/50 ${cls}`}
    />
  );
}

function PipelineStep({
  icon,
  label,
  sub,
  tone,
}: {
  icon: string;
  label: string;
  sub: string;
  tone: string;
}) {
  return (
    <div className="group flex items-center gap-2 rounded-[10px] border border-line bg-bg/40 px-3 py-2 backdrop-blur transition-all duration-300 hover:-translate-y-0.5 hover:border-violet/40 hover:bg-bg/60 hover:shadow-[0_8px_22px_-10px_rgba(167,139,250,0.4)]">
      <span className="text-[18px] transition-transform duration-500 group-hover:scale-110 group-hover:rotate-[-6deg]">
        {icon}
      </span>
      <div className="flex flex-col gap-0">
        <span
          className={`mono text-[10px] font-bold uppercase tracking-[0.14em] ${tone}`}
          style={{ fontFamily: 'var(--font-tech)' }}
        >
          {label}
        </span>
        <span
          className="mono text-[9px] uppercase tracking-widest text-text-dim"
          style={{ fontFamily: 'var(--font-tech)' }}
        >
          {sub}
        </span>
      </div>
    </div>
  );
}

function PipelineArrow() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className="mx-0.5 text-text-dim"
      style={{ filter: 'drop-shadow(0 0 4px rgba(167,139,250,0.4))' }}
    >
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function StatPill({ value, label }: { value: string; label: string }) {
  return (
    <div
      className="group flex flex-col gap-0.5 rounded-[10px] border border-line bg-bg/40 px-3 py-2 transition-all duration-300 hover:border-lime/40 hover:bg-bg/60 hover:shadow-[0_8px_22px_-10px_rgba(200,232,124,0.4)]"
    >
      <span
        className="text-[20px] font-extrabold leading-none text-white transition-colors group-hover:text-lime"
        style={{ fontFamily: 'var(--font-tech)' }}
      >
        {value}
      </span>
      <span
        className="mono text-[9.5px] uppercase tracking-[0.14em] text-text-muted"
        style={{ fontFamily: 'var(--font-tech)' }}
      >
        {label}
      </span>
    </div>
  );
}
