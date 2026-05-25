'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * LipSyncHero3D — hero cinematografico EXCLUSIVO da ferramenta LipSync.
 *
 * Nao usa o ToolHero3D padrao porque essa eh a "primeira ULTRA tool de IA"
 * do CASABLANCA e merece um show a parte:
 *
 *   - Mesh gradient violet/fuchsia/cyan respirando
 *   - Grid + corner cuts
 *   - Particulas voadoras
 *   - LADO ESQUERDO: eyebrow ULTRA ADMIN, titulo gradient enorme com
 *     shine, pipeline de 5 etapas com fluxo animado, 3 metricas premium
 *   - LADO DIREITO: AVATAR UGC 3D animado sendo "gerado" — wireframe
 *     → poligonos → boca falando em loop. Parallax 3D no mouse.
 *   - Aura pulsante + ring rotation + bunny mascote pequeno sentado
 *     observando o avatar (easter egg)
 */
export function LipSyncHero3D() {
  const heroRef = useRef<HTMLDivElement | null>(null);
  const [mouse, setMouse] = useState({ x: 0.5, y: 0.5 });

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

  const tiltX = (mouse.y - 0.5) * 10;
  const tiltY = (mouse.x - 0.5) * -10;

  return (
    <div
      ref={heroRef}
      className="relative isolate overflow-hidden rounded-[28px] border border-line/60 bg-bg-soft/30 px-6 py-14 md:px-10 md:py-20"
      style={{
        backgroundImage:
          'radial-gradient(50% 70% at 18% 25%, rgba(232,121,249,0.22), transparent 60%), radial-gradient(50% 50% at 82% 75%, rgba(167,139,250,0.18), transparent 60%), radial-gradient(30% 40% at 50% 95%, rgba(103,232,249,0.12), transparent 60%)',
      }}
    >
      {/* MESH GRADIENT BREATHING */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          background:
            'radial-gradient(circle at 28% 22%, rgba(232,121,249,0.32), transparent 42%), radial-gradient(circle at 72% 78%, rgba(167,139,250,0.25), transparent 42%), radial-gradient(circle at 50% 50%, rgba(103,232,249,0.10), transparent 50%)',
          animation: 'meshBreathe 9s ease-in-out infinite alternate',
        }}
      />

      {/* GRID */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            'linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)',
          backgroundSize: '44px 44px',
        }}
      />

      {/* SCAN LINES (cinematic touch) */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.04] mix-blend-overlay"
        style={{
          backgroundImage:
            'repeating-linear-gradient(0deg, transparent 0, transparent 3px, rgba(255,255,255,0.6) 3px, rgba(255,255,255,0.6) 4px)',
        }}
      />

      {/* PARTICULAS VOADORAS */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        {Array.from({ length: 22 }).map((_, i) => (
          <span
            key={i}
            className="absolute h-1 w-1 rounded-full"
            style={{
              left: `${(i * 41) % 100}%`,
              top: `${(i * 67) % 100}%`,
              background:
                i % 3 === 0
                  ? 'rgba(232,121,249,0.7)'
                  : i % 3 === 1
                    ? 'rgba(167,139,250,0.7)'
                    : 'rgba(255,255,255,0.5)',
              animation: `lipFloat ${5 + (i % 5)}s ease-in-out ${i * 0.27}s infinite`,
              boxShadow:
                i % 2 === 0
                  ? '0 0 10px rgba(232,121,249,0.7)'
                  : '0 0 8px rgba(167,139,250,0.6)',
            }}
          />
        ))}
      </div>

      {/* CORNER CUTS */}
      <CornerCut pos="tl" />
      <CornerCut pos="tr" />
      <CornerCut pos="bl" />
      <CornerCut pos="br" />

      <div className="relative z-10 grid items-center gap-10 md:grid-cols-[1fr_360px] lg:grid-cols-[1fr_420px]">
        {/* LADO ESQUERDO — Copy */}
        <div className="flex flex-col gap-5">
          {/* EYEBROWS */}
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="mono inline-flex items-center gap-1.5 rounded-full border border-fuchsia-400/45 bg-fuchsia-400/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.22em] text-fuchsia-300 shadow-[0_0_22px_-4px_rgba(232,121,249,0.6)]"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-fuchsia-300 opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-fuchsia-300" />
              </span>
              ULTRA · ADMIN LAB
            </span>
            <span
              className="mono inline-flex items-center gap-1 rounded-full border border-violet/40 bg-violet/10 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.22em] text-violet"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              ◆ LATENTSYNC · BYTEDANCE
            </span>
            <span
              className="mono inline-flex items-center gap-1 rounded-full border border-cyan-400/35 bg-cyan-400/10 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.22em] text-cyan-300"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              4K · ZERO TRAVA
            </span>
          </div>

          {/* TITULO GIGANTE */}
          <div>
            <h1
              className="text-[44px] font-black leading-[0.92] tracking-tight md:text-[68px] lg:text-[78px]"
              style={{
                fontFamily: 'var(--font-display)',
                backgroundImage:
                  'linear-gradient(135deg, #ffffff 0%, #f5e6ff 22%, #e879f9 50%, #a78bfa 78%, #67e8f9 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
                backgroundSize: '220% 220%',
                animation: 'lipShine 7s ease-in-out infinite',
                letterSpacing: '-0.035em',
              }}
            >
              A boca fala
              <br />
              <span style={{ opacity: 0.9 }}>o que você quiser.</span>
            </h1>
          </div>

          <p className="max-w-[540px] text-[15px] leading-relaxed text-text-muted md:text-[17px]">
            Sobe o vídeo do rosto. Sobe o áudio. A IA reconstroi cada
            fonema, cada respiração, cada microexpressão da boca em
            sincronia perfeita com a fala. Sem dentes torto, sem olho
            morto, sem aquele jeito artificial. <span className="text-white">É como se a pessoa tivesse falado aquilo de verdade.</span>
          </p>

          {/* PIPELINE — 5 etapas */}
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <Step icon="🎬" label="VÍDEO" sub="rosto fonte" />
            <Arrow />
            <Step icon="🎙" label="ÁUDIO" sub="fala alvo" />
            <Arrow />
            <Step icon="🧠" label="LATENT" sub="encoder neural" tone="text-fuchsia-300" />
            <Arrow />
            <Step icon="👄" label="SYNC" sub="boca + dentes" tone="text-violet" />
            <Arrow />
            <Step icon="🎞" label="RENDER" sub="export 1080p" tone="text-cyan-300" />
          </div>

          {/* METRICAS */}
          <div className="mt-2 grid max-w-[540px] grid-cols-3 gap-3">
            <Metric value="60–180s" label="GERAÇÃO" />
            <Metric value="32 FPS" label="OUTPUT" accent="violet" />
            <Metric value="$0.07" label="POR VÍDEO" accent="lime" />
          </div>
        </div>

        {/* LADO DIREITO — Avatar UGC 3D animado */}
        <div className="relative mx-auto h-[360px] w-[300px] md:h-[400px] md:w-[360px]">
          {/* Aura */}
          <div
            aria-hidden
            className="absolute inset-[-10%] rounded-full blur-3xl"
            style={{
              background:
                'radial-gradient(circle, rgba(232,121,249,0.5), rgba(167,139,250,0.2) 50%, transparent 80%)',
              animation: 'lipAura 5s ease-in-out infinite',
            }}
          />

          {/* Ring rotativo externo */}
          <div
            aria-hidden
            className="absolute inset-0 rounded-full border border-fuchsia-400/30"
            style={{ animation: 'lipRing 24s linear infinite' }}
          />
          <div
            aria-hidden
            className="absolute inset-[-12px] rounded-full border border-violet/25"
            style={{
              animation: 'lipRing 36s linear infinite reverse',
            }}
          />
          <div
            aria-hidden
            className="absolute inset-[-26px] rounded-full border border-cyan-400/20 border-dashed"
            style={{ animation: 'lipRing 60s linear infinite' }}
          />

          {/* AVATAR — wrapped em parallax */}
          <div
            className="relative h-full w-full"
            style={{
              transformStyle: 'preserve-3d',
              transform: `perspective(1200px) rotateX(${tiltX}deg) rotateY(${tiltY}deg)`,
              transition: 'transform 0.6s cubic-bezier(.2,.8,.2,1)',
            }}
          >
            <AvatarUGC />
          </div>

          {/* Bunny mini observador — easter egg */}
          <div
            className="absolute bottom-[-8px] right-[-12px] z-20"
            style={{
              animation: 'bunnyPeek 4s ease-in-out infinite',
              filter: 'drop-shadow(0 0 16px rgba(167,139,250,0.6))',
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/auto-edit-logo@128.png"
              alt=""
              aria-hidden
              width={72}
              height={72}
              style={{ transform: 'rotate(-8deg)' }}
            />
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes meshBreathe {
          0%, 100% { transform: scale(1); opacity: 0.65; }
          50% { transform: scale(1.06); opacity: 1; }
        }
        @keyframes lipFloat {
          0%, 100% { transform: translateY(0) translateX(0) scale(1); opacity: 0.5; }
          50% { transform: translateY(-22px) translateX(12px) scale(1.4); opacity: 1; }
        }
        @keyframes lipShine {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }
        @keyframes lipAura {
          0%, 100% { transform: scale(1); opacity: 0.6; }
          50% { transform: scale(1.18); opacity: 1; }
        }
        @keyframes lipRing {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes bunnyPeek {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-8px); }
        }
      `}</style>
    </div>
  );
}

/* ---- AvatarUGC ---- Avatar 3D animado SVG sendo gerado --------- */
function AvatarUGC() {
  return (
    <div
      className="relative h-full w-full"
      style={{ animation: 'avFloat 6s ease-in-out infinite' }}
    >
      <svg
        viewBox="0 0 360 400"
        width="100%"
        height="100%"
        className="drop-shadow-[0_30px_60px_rgba(232,121,249,0.4)]"
        style={{ overflow: 'visible' }}
      >
        <defs>
          {/* Gradient skin */}
          <radialGradient id="ugc-skin" cx="50%" cy="42%" r="60%">
            <stop offset="0%" stopColor="#ffe7f7" />
            <stop offset="40%" stopColor="#f4c4e0" />
            <stop offset="100%" stopColor="#b85099" />
          </radialGradient>
          {/* Gradient hair */}
          <linearGradient id="ugc-hair" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#2a1147" />
            <stop offset="60%" stopColor="#4c2a85" />
            <stop offset="100%" stopColor="#a78bfa" />
          </linearGradient>
          {/* Gradient backdrop */}
          <radialGradient id="ugc-bg" cx="50%" cy="55%" r="60%">
            <stop offset="0%" stopColor="rgba(232,121,249,0.35)" />
            <stop offset="60%" stopColor="rgba(167,139,250,0.18)" />
            <stop offset="100%" stopColor="transparent" />
          </radialGradient>
          {/* Mouth gradient */}
          <linearGradient id="ugc-mouth" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#7a1a3b" />
            <stop offset="100%" stopColor="#3a0a1b" />
          </linearGradient>
          {/* Glow filter */}
          <filter id="ugc-glow">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          {/* Wireframe pattern (build-in animation) */}
          <pattern id="ugc-wire" patternUnits="userSpaceOnUse" width="16" height="16">
            <path
              d="M0 8 L16 8 M8 0 L8 16"
              stroke="rgba(232,121,249,0.4)"
              strokeWidth="0.5"
            />
          </pattern>
        </defs>

        {/* Background circle */}
        <circle cx="180" cy="200" r="170" fill="url(#ugc-bg)" />

        {/* Halo arc */}
        <circle
          cx="180"
          cy="200"
          r="155"
          fill="none"
          stroke="rgba(232,121,249,0.5)"
          strokeWidth="1.2"
          strokeDasharray="3 7"
          style={{ animation: 'avRotate 30s linear infinite', transformOrigin: '180px 200px' }}
        />

        {/* Wireframe sketch building */}
        <g style={{ animation: 'avBuild 4s ease-in-out infinite' }} opacity="0.6">
          <ellipse cx="180" cy="190" rx="85" ry="98" fill="url(#ugc-wire)" />
        </g>

        {/* HEAD */}
        <ellipse
          cx="180"
          cy="190"
          rx="84"
          ry="96"
          fill="url(#ugc-skin)"
          filter="url(#ugc-glow)"
        />

        {/* Hair top */}
        <path
          d="M 95 158 Q 110 90 180 95 Q 250 100 265 158 Q 254 130 230 122 Q 200 132 180 122 Q 160 132 130 122 Q 106 130 95 158 Z"
          fill="url(#ugc-hair)"
          filter="url(#ugc-glow)"
        />

        {/* Hair side strand */}
        <path
          d="M 100 158 Q 92 200 102 240 Q 110 220 108 198 Q 106 178 100 158 Z"
          fill="url(#ugc-hair)"
          opacity="0.9"
        />

        {/* Cheek blush left */}
        <ellipse cx="130" cy="218" rx="14" ry="9" fill="rgba(232,121,249,0.45)" />
        {/* Cheek blush right */}
        <ellipse cx="228" cy="218" rx="14" ry="9" fill="rgba(232,121,249,0.45)" />

        {/* EYE LEFT — closed/lash style (calm) */}
        <g>
          <path
            d="M 142 178 Q 152 173 162 178"
            stroke="#2a1147"
            strokeWidth="2.5"
            fill="none"
            strokeLinecap="round"
          />
          <path
            d="M 144 175 L 144 172 M 150 174 L 150 170 M 156 174 L 156 170 M 161 175 L 161 172"
            stroke="#2a1147"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
          {/* small sparkle */}
          <circle cx="151" cy="180" r="1.2" fill="#fff" opacity="0.9" />
        </g>

        {/* EYE RIGHT */}
        <g>
          <path
            d="M 198 178 Q 208 173 218 178"
            stroke="#2a1147"
            strokeWidth="2.5"
            fill="none"
            strokeLinecap="round"
          />
          <path
            d="M 200 175 L 200 172 M 206 174 L 206 170 M 212 174 L 212 170 M 217 175 L 217 172"
            stroke="#2a1147"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
          <circle cx="207" cy="180" r="1.2" fill="#fff" opacity="0.9" />
        </g>

        {/* Nose */}
        <path
          d="M 178 198 Q 174 218 178 232 Q 184 232 184 226"
          stroke="rgba(106,30,68,0.6)"
          strokeWidth="1.8"
          fill="none"
          strokeLinecap="round"
        />

        {/* MOUTH — animated lipsync */}
        <g style={{ animation: 'avMouth 0.9s ease-in-out infinite', transformOrigin: '180px 252px' }}>
          {/* Mouth opening (oval gets taller/shorter) */}
          <ellipse
            cx="180"
            cy="252"
            rx="20"
            ry="9"
            fill="url(#ugc-mouth)"
            stroke="rgba(106,30,68,0.85)"
            strokeWidth="1.4"
          />
          {/* Teeth top */}
          <rect x="167" y="245" width="26" height="4.5" rx="1.2" fill="#fff" opacity="0.92" />
          {/* Tongue hint */}
          <ellipse cx="180" cy="256" rx="10" ry="3" fill="#d6427a" opacity="0.85" />
          {/* Lips top */}
          <path
            d="M 158 246 Q 170 240 180 244 Q 190 240 202 246"
            stroke="#a8336a"
            strokeWidth="2.2"
            fill="none"
            strokeLinecap="round"
          />
          {/* Lips bottom */}
          <path
            d="M 160 258 Q 180 268 200 258"
            stroke="#a8336a"
            strokeWidth="2.2"
            fill="none"
            strokeLinecap="round"
          />
        </g>

        {/* Chin shadow */}
        <ellipse
          cx="180"
          cy="278"
          rx="36"
          ry="6"
          fill="rgba(106,30,68,0.18)"
        />

        {/* Earring sparkle (UGC vibe) */}
        <circle cx="100" cy="218" r="2.5" fill="#fff" opacity="0.95" />
        <circle cx="260" cy="218" r="2.5" fill="#fff" opacity="0.95" />

        {/* Audio waveform overlay (mouth output simulation) */}
        <g
          transform="translate(180 320)"
          style={{ animation: 'avWaveOpacity 2s ease-in-out infinite' }}
        >
          {Array.from({ length: 11 }).map((_, i) => {
            const offset = i - 5;
            return (
              <rect
                key={i}
                x={offset * 8 - 1.5}
                y="-8"
                width="3"
                height="16"
                rx="1.5"
                fill="#e879f9"
                style={{
                  animation: `avWave 0.6s ease-in-out ${i * 0.08}s infinite alternate`,
                  transformOrigin: 'center',
                }}
              />
            );
          })}
        </g>

        {/* Mic icon (subtle) */}
        <g transform="translate(290 70)" opacity="0.85">
          <circle r="12" fill="rgba(232,121,249,0.18)" stroke="rgba(232,121,249,0.7)" strokeWidth="1.2" />
          <rect x="-2.5" y="-6" width="5" height="9" rx="2" fill="#e879f9" />
          <path d="M -5 1 Q -5 6 0 6 Q 5 6 5 1" stroke="#e879f9" strokeWidth="1.4" fill="none" strokeLinecap="round" />
          <line x1="0" y1="6" x2="0" y2="9" stroke="#e879f9" strokeWidth="1.4" />
        </g>

        {/* Camera icon (subtle) */}
        <g transform="translate(60 70)" opacity="0.85">
          <circle r="12" fill="rgba(167,139,250,0.18)" stroke="rgba(167,139,250,0.7)" strokeWidth="1.2" />
          <rect x="-7" y="-4" width="14" height="9" rx="1.5" fill="none" stroke="#a78bfa" strokeWidth="1.4" />
          <circle r="2.5" fill="#a78bfa" cy="0.5" />
        </g>
      </svg>

      <style jsx>{`
        @keyframes avFloat {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-10px); }
        }
        @keyframes avRotate {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes avBuild {
          0%, 100% { opacity: 0; }
          50% { opacity: 0.5; }
        }
        @keyframes avMouth {
          0%, 100% { transform: scaleY(0.5) scaleX(1); }
          25% { transform: scaleY(1.6) scaleX(0.8); }
          50% { transform: scaleY(0.4) scaleX(1.1); }
          75% { transform: scaleY(1.2) scaleX(0.9); }
        }
        @keyframes avWave {
          from { transform: scaleY(0.3); }
          to { transform: scaleY(1.4); }
        }
        @keyframes avWaveOpacity {
          0%, 100% { opacity: 0.55; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}

/* ---- Mini blocks ---------------------------------------------- */

function Step({
  icon,
  label,
  sub,
  tone,
}: {
  icon: string;
  label: string;
  sub: string;
  tone?: string;
}) {
  return (
    <div className="group flex items-center gap-2 rounded-[10px] border border-line bg-bg/40 px-3 py-2 backdrop-blur transition-all duration-300 hover:-translate-y-0.5 hover:border-fuchsia-400/40 hover:bg-bg/60 hover:shadow-[0_8px_22px_-10px_rgba(232,121,249,0.5)]">
      <span className="text-[20px] transition-transform duration-500 group-hover:scale-110 group-hover:-rotate-6">
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

function Arrow() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className="mx-0.5 text-text-dim"
      style={{ filter: 'drop-shadow(0 0 4px rgba(232,121,249,0.5))' }}
    >
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function Metric({
  value,
  label,
  accent = 'fuchsia',
}: {
  value: string;
  label: string;
  accent?: 'fuchsia' | 'violet' | 'lime';
}) {
  const colors = {
    fuchsia: 'group-hover:text-fuchsia-300',
    violet: 'group-hover:text-violet',
    lime: 'group-hover:text-lime',
  };
  const glows = {
    fuchsia: 'hover:shadow-[0_8px_22px_-10px_rgba(232,121,249,0.5)]',
    violet: 'hover:shadow-[0_8px_22px_-10px_rgba(167,139,250,0.5)]',
    lime: 'hover:shadow-[0_8px_22px_-10px_rgba(200,255,0,0.5)]',
  };
  return (
    <div
      className={`group flex flex-col gap-0.5 rounded-[10px] border border-line bg-bg/40 px-3 py-2 transition-all duration-300 hover:border-fuchsia-400/40 hover:bg-bg/60 ${glows[accent]}`}
    >
      <span
        className={`text-[22px] font-extrabold leading-none text-white transition-colors ${colors[accent]}`}
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
      className={`pointer-events-none absolute h-5 w-5 border-fuchsia-400/40 ${cls}`}
    />
  );
}
