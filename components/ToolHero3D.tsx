'use client';

import { useEffect, useRef, useState } from 'react';
import { ToolHeroVideo } from '@/components/ToolHeroVideo';

/**
 * ToolHero3D — shared cinematic hero for AI suite tool pages.
 *
 * Pattern: mesh gradient bg + grid + floating particles + corner cuts +
 * bunny mascot 3D right + customizable left content (title, pipeline,
 * stats, illustration). All AI tools follow this template — each gets
 * its own color, copy, pipeline icons and tool-specific illustration.
 *
 * Used by: AutoBroll, Remover Legenda, Decupagem Inteligente,
 * Gerador SRT, HeyGen Auto.
 */

export type ToolHero3DProps = {
  /** Top-left eyebrow tag with ping dot — tool brand */
  eyebrow: string;
  /** Optional second pill (e.g. "∞ UNLIMITED · ZERO CRÉDITO") */
  eyebrow2?: string;
  /** Hero title (gradient text). Use "\n" for line break OR pass titleSecondLine */
  title: string;
  /** Optional second line of title with gradient accent */
  titleAccent?: string;
  /** Short copy (1-2 sentences) under the title */
  subtitle: React.ReactNode;
  /** Color theme — used in eyebrow border + glows */
  tint: 'violet' | 'lime' | 'cyan' | 'pink' | 'amber' | 'fuchsia';
  /** Pipeline steps (left-to-right flow with arrows) */
  pipeline: Array<{ icon: React.ReactNode; label: string; sub: string; tone?: string }>;
  /** Stat pills (3 cards) — short numeric/text claims */
  stats: Array<{ value: string; label: string }>;
  /**
   * Tool-specific animated illustration shown ABOVE the bunny on the
   * right side (optional — defaults to just the bunny). For tools that
   * have a strong visual story (e.g. subtitle being erased).
   */
  illustration?: React.ReactNode;
  /** Hide bunny entirely (rare — only if illustration is dominant) */
  hideBunny?: boolean;
  /**
   * Vídeo 16:9 do card (em /public/cards/). Quando definido, o lado direito
   * mostra o painel de vídeo premium (ToolHeroVideo) no lugar do coelho.
   */
  video?: string;
  /** Poster (primeiro frame) do vídeo acima */
  videoPoster?: string;
};

const TINT_MAP = {
  violet: {
    primary: 'rgba(167,139,250,0.55)',
    secondary: 'rgba(200,232,124,0.12)',
    border: 'border-violet/40',
    pillBg: 'bg-violet/10',
    pillText: 'text-violet',
    pillBorder: 'border-violet/40',
    pingBg: 'bg-violet',
    gradient: ['#ffffff', '#fafafa', '#c2cf86', '#a78bfa'],
    aura: 'rgba(167,139,250,0.35), rgba(200,232,124,0.15) 50%',
    glow: 'rgba(200,232,124,0.4)',
  },
  lime: {
    primary: 'rgba(200,232,124,0.40)',
    secondary: 'rgba(163,230,53,0.18)',
    border: 'border-lime/40',
    pillBg: 'bg-lime/10',
    pillText: 'text-lime',
    pillBorder: 'border-lime/40',
    pingBg: 'bg-lime',
    gradient: ['#ffffff', '#fafafa', '#a78bfa', '#c2cf86'],
    aura: 'rgba(200,232,124,0.40), rgba(167,139,250,0.15) 50%',
    glow: 'rgba(167,139,250,0.4)',
  },
  cyan: {
    primary: 'rgba(34,211,238,0.45)',
    secondary: 'rgba(167,139,250,0.15)',
    border: 'border-cyan-400/40',
    pillBg: 'bg-cyan-400/10',
    pillText: 'text-cyan-300',
    pillBorder: 'border-cyan-400/40',
    pingBg: 'bg-cyan-300',
    gradient: ['#ffffff', '#fafafa', '#a78bfa', '#67e8f9'],
    aura: 'rgba(34,211,238,0.40), rgba(167,139,250,0.15) 50%',
    glow: 'rgba(34,211,238,0.4)',
  },
  pink: {
    primary: 'rgba(244,114,182,0.45)',
    secondary: 'rgba(200,232,124,0.12)',
    border: 'border-pink-400/40',
    pillBg: 'bg-pink-400/10',
    pillText: 'text-pink-300',
    pillBorder: 'border-pink-400/40',
    pingBg: 'bg-pink-300',
    gradient: ['#ffffff', '#fafafa', '#c2cf86', '#f472b6'],
    aura: 'rgba(244,114,182,0.40), rgba(200,232,124,0.15) 50%',
    glow: 'rgba(244,114,182,0.4)',
  },
  amber: {
    primary: 'rgba(251,191,36,0.45)',
    secondary: 'rgba(167,139,250,0.12)',
    border: 'border-amber-400/40',
    pillBg: 'bg-amber-400/10',
    pillText: 'text-amber-300',
    pillBorder: 'border-amber-400/40',
    pingBg: 'bg-amber-300',
    gradient: ['#ffffff', '#fafafa', '#a78bfa', '#fbbf24'],
    aura: 'rgba(251,191,36,0.40), rgba(167,139,250,0.15) 50%',
    glow: 'rgba(251,191,36,0.4)',
  },
  fuchsia: {
    primary: 'rgba(232,121,249,0.50)',
    secondary: 'rgba(200,232,124,0.12)',
    border: 'border-fuchsia-400/40',
    pillBg: 'bg-fuchsia-400/10',
    pillText: 'text-fuchsia-300',
    pillBorder: 'border-fuchsia-400/40',
    pingBg: 'bg-fuchsia-300',
    gradient: ['#ffffff', '#fafafa', '#c2cf86', '#e879f9'],
    aura: 'rgba(232,121,249,0.40), rgba(200,232,124,0.15) 50%',
    glow: 'rgba(232,121,249,0.4)',
  },
};

export function ToolHero3D({
  eyebrow,
  eyebrow2,
  title,
  titleAccent,
  subtitle,
  tint,
  pipeline,
  stats,
  illustration,
  hideBunny = false,
  video,
  videoPoster,
}: ToolHero3DProps) {
  const heroRef = useRef<HTMLDivElement | null>(null);
  const [mouse, setMouse] = useState({ x: 0.5, y: 0.5 });
  const t = TINT_MAP[tint];

  useEffect(() => {
    const el = heroRef.current;
    if (!el) return;
    function onMove(e: MouseEvent) {
      const rect = el!.getBoundingClientRect();
      setMouse({
        x: (e.clientX - rect.left) / rect.width,
        y: (e.clientY - rect.top) / rect.height,
      });
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
        backgroundImage: `radial-gradient(40% 60% at 20% 30%, ${t.primary.replace('0.45', '0.18').replace('0.55', '0.18').replace('0.50', '0.18').replace('0.40', '0.18')}, transparent 60%), radial-gradient(50% 50% at 80% 70%, ${t.secondary}, transparent 60%), radial-gradient(30% 40% at 50% 90%, rgba(34,211,238,0.10), transparent 60%)`,
      }}
    >
      {/* Animated mesh */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          background: `radial-gradient(circle at 30% 20%, ${t.primary}, transparent 40%), radial-gradient(circle at 70% 80%, ${t.secondary}, transparent 40%)`,
          animation: 'meshBreathe 8s ease-in-out infinite alternate',
        }}
      />

      {/* Grid */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            'linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />

      {/* Particles */}
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
      <CornerCut pos="tl" tint={tint} />
      <CornerCut pos="tr" tint={tint} />
      <CornerCut pos="bl" tint={tint} />
      <CornerCut pos="br" tint={tint} />

      <div className="relative z-10 grid items-center gap-8 md:grid-cols-[1fr_auto]">
        {/* LEFT — content */}
        <div className="flex flex-col gap-4">
          {/* Eyebrows */}
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`mono inline-flex items-center gap-1.5 rounded-full border ${t.pillBorder} ${t.pillBg} px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] ${t.pillText} shadow-[0_0_18px_-4px_${t.glow}]`}
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              <span className="relative flex h-1.5 w-1.5">
                <span
                  className={`absolute inline-flex h-full w-full animate-ping rounded-full ${t.pingBg} opacity-60`}
                />
                <span
                  className={`relative inline-flex h-1.5 w-1.5 rounded-full ${t.pingBg}`}
                />
              </span>
              {eyebrow}
            </span>
            {eyebrow2 && (
              <span
                className="mono inline-flex items-center gap-1 rounded-full border border-lime/40 bg-lime/10 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.18em] text-lime"
                style={{ fontFamily: 'var(--font-tech)' }}
              >
                {eyebrow2}
              </span>
            )}
          </div>

          {/* Title gradient */}
          <h1
            className="text-5xl font-black leading-[1.02] tracking-tight md:text-7xl"
            style={{
              fontFamily: 'var(--font-display)',
              backgroundImage: `linear-gradient(135deg, ${t.gradient[0]} 0%, ${t.gradient[1]} 30%, ${t.gradient[2]} 60%, ${t.gradient[3]} 100%)`,
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              backgroundSize: '200% 200%',
              animation: 'titleShine 6s ease-in-out infinite',
            }}
          >
            {title}
            {titleAccent && (
              <>
                <br />
                <span style={{ opacity: 0.85 }}>{titleAccent}</span>
              </>
            )}
          </h1>

          <p className="max-w-xl text-[15px] leading-relaxed text-text-muted md:text-[17px]">
            {subtitle}
          </p>

          {/* Pipeline flow */}
          <div className="mt-3 flex flex-wrap items-center gap-1">
            {pipeline.map((step, i) => (
              <Fragment key={i}>
                <PipelineStep {...step} />
                {i < pipeline.length - 1 && <PipelineArrow />}
              </Fragment>
            ))}
          </div>

          {/* Stats */}
          <div className="mt-2 grid max-w-xl grid-cols-3 gap-3">
            {stats.map((s, i) => (
              <StatPill key={i} value={s.value} label={s.label} />
            ))}
          </div>
        </div>

        {/* RIGHT — painel de vídeo 16:9 (quando há vídeo) OU illustration + bunny */}
        {video ? (
          <div className="relative hidden w-[320px] shrink-0 md:block lg:w-[400px] xl:w-[460px]">
            <ToolHeroVideo
              src={video}
              poster={videoPoster}
              glow={t.glow}
              tiltX={tiltX}
              tiltY={tiltY}
            />
          </div>
        ) : (
        <div className="relative hidden h-[280px] w-[280px] shrink-0 md:block">
          {illustration && (
            <div className="absolute inset-0 z-10">{illustration}</div>
          )}
          {!hideBunny && (
            <div
              className="relative h-full w-full"
              style={{
                transformStyle: 'preserve-3d',
                transform: `perspective(1200px) rotateX(${tiltX}deg) rotateY(${tiltY}deg)`,
                transition: 'transform 0.6s cubic-bezier(.2,.8,.2,1)',
              }}
            >
              <div
                aria-hidden
                className="absolute inset-0 rounded-full blur-3xl"
                style={{
                  background: `radial-gradient(circle, ${t.aura}, transparent 70%)`,
                  animation: 'auraPulse 4s ease-in-out infinite',
                }}
              />
              <div
                className="relative flex h-full w-full items-center justify-center"
                style={{ animation: 'bunnyFloat 5s ease-in-out infinite' }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/auto-edit-logo@256.png"
                  alt="Auto Edit"
                  width={220}
                  height={220}
                  className="drop-shadow-[0_30px_60px_rgba(167,139,250,0.5)]"
                  style={{
                    filter: `drop-shadow(0 0 30px ${t.glow})`,
                  }}
                />
              </div>
              <div
                aria-hidden
                className={`absolute inset-0 rounded-full border ${t.pillBorder}`}
                style={{ animation: 'ringSpin 30s linear infinite' }}
              />
              <div
                aria-hidden
                className={`absolute inset-[-10px] rounded-full border ${t.pillBorder}`}
                style={{
                  opacity: 0.4,
                  animation: 'ringSpin 45s linear infinite reverse',
                }}
              />
            </div>
          )}
        </div>
        )}
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

function CornerCut({
  pos,
  tint,
}: {
  pos: 'tl' | 'tr' | 'bl' | 'br';
  tint: ToolHero3DProps['tint'];
}) {
  const t = TINT_MAP[tint];
  const cls = {
    tl: 'left-3 top-3 border-l-2 border-t-2 rounded-tl-[8px]',
    tr: 'right-3 top-3 border-r-2 border-t-2 rounded-tr-[8px]',
    bl: 'left-3 bottom-3 border-l-2 border-b-2 rounded-bl-[8px]',
    br: 'right-3 bottom-3 border-r-2 border-b-2 rounded-br-[8px]',
  }[pos];
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute h-5 w-5 ${t.pillBorder} ${cls}`}
    />
  );
}

function PipelineStep({
  icon,
  label,
  sub,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  sub: string;
  tone?: string;
}) {
  return (
    <div className="group flex items-center gap-2 rounded-[10px] border border-line bg-bg/40 px-3 py-2 backdrop-blur transition-all duration-300 hover:-translate-y-0.5 hover:border-violet/40 hover:bg-bg/60 hover:shadow-[0_8px_22px_-10px_rgba(167,139,250,0.4)]">
      <span className="text-[18px] transition-transform duration-500 group-hover:scale-110 group-hover:rotate-[-6deg]">
        {icon}
      </span>
      <div className="flex flex-col gap-0">
        <span
          className={`mono text-[10px] font-bold uppercase tracking-[0.14em] ${tone || 'text-text-muted'}`}
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
    <div className="group flex flex-col gap-0.5 rounded-[10px] border border-line bg-bg/40 px-3 py-2 transition-all duration-300 hover:border-lime/40 hover:bg-bg/60 hover:shadow-[0_8px_22px_-10px_rgba(200,232,124,0.4)]">
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

// Inline fragment helper
function Fragment({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
