'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * LipSyncHero3D — hero cinematografico EXCLUSIVO da ferramenta LipSync.
 *
 *   - Mesh gradient violet/fuchsia/cyan respirando
 *   - Grid + corner cuts + particulas voadoras
 *   - LADO ESQUERDO: eyebrow ULTRA ADMIN, titulo gradient enorme com
 *     shine, pipeline de etapas, 3 metricas premium
 *   - LADO DIREITO: CARROSSEL dos 3 vídeos do avatar virando cyborg
 *     (auto-avança no fim de cada um + troca no hover, mostrados INTEIROS).
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
              ◆ DUAL ENGINE · V1 / V2
            </span>
            <span
              className="mono inline-flex items-center gap-1 rounded-full border border-cyan-400/35 bg-cyan-400/10 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.22em] text-cyan-300"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              ALTA DEFINIÇÃO · ZERO TRAVA
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
            Sobe o vídeo do rosto. Sobe o áudio. <span className="text-white">A boca da pessoa passa a falar exatamente o que tá no áudio</span> — com naturalidade absurda. Sem cara de IA, sem dentes torto, sem olho morto.
          </p>

          {/* PIPELINE — 4 etapas, sem jargao */}
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <Step icon="🎬" label="VÍDEO" sub="o rosto" />
            <Arrow />
            <Step icon="🎙" label="ÁUDIO" sub="a fala" />
            <Arrow />
            <Step icon="✨" label="MAGIA" sub="a IA encaixa" tone="text-fuchsia-300" />
            <Arrow />
            <Step icon="🎞" label="ENTREGA" sub="vídeo pronto" tone="text-cyan-300" />
          </div>

          {/* METRICAS */}
          <div className="mt-2 grid max-w-[540px] grid-cols-3 gap-3">
            <Metric value="1–3 min" label="GERAÇÃO" />
            <Metric value="2 modelos" label="V1 + V2" accent="violet" />
            <Metric value="HD" label="SAÍDA" accent="lime" />
          </div>
        </div>

        {/* LADO DIREITO — carrossel dos 3 vídeos cyborg */}
        <CyborgCarousel tiltX={tiltX} tiltY={tiltY} />
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
      `}</style>
    </div>
  );
}

/* ---- CyborgCarousel — carrossel dos 3 vídeos do avatar virando cyborg.
 *
 * - Mostra cada vídeo INTEIRO (object-contain + a caixa segue a PROPORÇÃO
 *   real detectada no load → nunca corta nem distorce).
 * - AUTO-AVANÇA quando o vídeo termina (transição glitch/scan + flash) e
 *   emenda no próximo (1 → 2 → 3 → 1...).
 * - HOVER troca NA HORA (com a mesma animação).
 * - Sem robozinho: os próprios vídeos já viram cyborg.
 */
const HERO_VIDEOS = ['/lipsync-hero/1.mp4', '/lipsync-hero/2.mp4', '/lipsync-hero/3.mp4'];

function CyborgCarousel({ tiltX, tiltY }: { tiltX: number; tiltY: number }) {
  const [index, setIndex] = useState(0);
  const [ratio, setRatio] = useState(0.5625); // w/h — default portrait até detectar
  const [pulse, setPulse] = useState(0); // +1 a cada troca → replay do overlay de transição
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const lastSwitch = useRef(0);

  function advance() {
    setIndex((i) => (i + 1) % HERO_VIDEOS.length);
    setPulse((p) => p + 1);
  }

  // Hover → troca na hora (com anti-spam leve pra não pular vários de uma vez).
  function onEnter() {
    const now = Date.now();
    if (now - lastSwitch.current < 380) return;
    lastSwitch.current = now;
    advance();
  }

  // Pega a proporção REAL do vídeo → mostra inteiro, sem cortar.
  function onMeta() {
    const v = videoRef.current;
    if (v && v.videoWidth && v.videoHeight) setRatio(v.videoWidth / v.videoHeight);
  }

  // Caixa máxima — o vídeo cabe INTEIRO dentro dela preservando a proporção.
  const BOX_W = 380;
  const BOX_H = 440;
  const fitByWidth = ratio >= BOX_W / BOX_H;
  const w = fitByWidth ? BOX_W : BOX_H * ratio;
  const h = fitByWidth ? BOX_W / ratio : BOX_H;

  return (
    <div
      className="relative mx-auto flex items-center justify-center"
      style={{ width: BOX_W, height: BOX_H }}
      onMouseEnter={onEnter}
    >
      {/* AURA */}
      <div
        aria-hidden
        className="absolute inset-[-6%] rounded-full blur-3xl"
        style={{
          background:
            'radial-gradient(circle, rgba(103,232,249,0.4), rgba(232,121,249,0.22) 50%, transparent 78%)',
          animation: 'ccAura 5s ease-in-out infinite',
        }}
      />

      {/* RINGS orbitando atrás */}
      <div
        aria-hidden
        className="absolute rounded-full border border-fuchsia-400/25"
        style={{ width: BOX_W * 0.96, height: BOX_W * 0.96, animation: 'ccRing 26s linear infinite' }}
      />
      <div
        aria-hidden
        className="absolute rounded-full border border-cyan-400/20 border-dashed"
        style={{ width: BOX_W * 1.14, height: BOX_W * 1.14, animation: 'ccRing 46s linear infinite reverse' }}
      />

      {/* FRAME 3D parallax — segue a proporção do vídeo */}
      <div
        className="relative"
        style={{
          width: w,
          height: h,
          transformStyle: 'preserve-3d',
          transform: `perspective(1200px) rotateX(${tiltX}deg) rotateY(${tiltY}deg)`,
          transition: 'transform 0.6s cubic-bezier(.2,.8,.2,1), width 0.5s ease, height 0.5s ease',
        }}
      >
        <div
          className="relative h-full w-full overflow-hidden rounded-[20px] border border-fuchsia-400/40"
          style={{
            background: '#05050a',
            boxShadow:
              '0 0 0 1px rgba(0,0,0,0.4), 0 30px 70px -10px rgba(232,121,249,0.45), inset 0 0 30px rgba(103,232,249,0.12)',
          }}
        >
          {/* VÍDEO — inteiro (object-contain), key força a animação de entrada */}
          <video
            key={index}
            ref={videoRef}
            src={HERO_VIDEOS[index]}
            autoPlay
            muted
            playsInline
            preload="auto"
            onEnded={advance}
            onLoadedMetadata={onMeta}
            className="absolute inset-0 h-full w-full object-contain"
            style={{ animation: 'ccVideoIn 0.6s cubic-bezier(.2,.8,.2,1)', filter: 'saturate(1.06)' }}
          />

          {/* scanline sutil constante */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.06] mix-blend-overlay"
            style={{ backgroundImage: 'repeating-linear-gradient(0deg, transparent 0 2px, rgba(103,232,249,0.6) 2px 3px)' }}
          />

          {/* TRANSIÇÃO — sweep + flash (key=pulse força o replay a cada troca) */}
          <div key={pulse} aria-hidden className="pointer-events-none absolute inset-0">
            <div
              className="absolute inset-x-0 top-0 h-[16%]"
              style={{
                background: 'linear-gradient(180deg, transparent, rgba(103,232,249,0.75), transparent)',
                filter: 'blur(2px)',
                animation: 'ccSweep 0.6s ease-out',
              }}
            />
            <div className="absolute inset-0 bg-white" style={{ animation: 'ccFlash 0.6s ease-out' }} />
          </div>

          {/* CORNER HUD brackets */}
          <span className="pointer-events-none absolute left-2 top-2 h-4 w-4 border-l-2 border-t-2 border-cyan-300/70" />
          <span className="pointer-events-none absolute right-2 top-2 h-4 w-4 border-r-2 border-t-2 border-cyan-300/70" />
          <span className="pointer-events-none absolute left-2 bottom-2 h-4 w-4 border-l-2 border-b-2 border-fuchsia-400/70" />
          <span className="pointer-events-none absolute right-2 bottom-2 h-4 w-4 border-r-2 border-b-2 border-fuchsia-400/70" />
        </div>

        {/* BADGE topo */}
        <div className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 z-20">
          <span
            className="mono inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/55 px-3 py-1 text-[9.5px] font-bold uppercase tracking-[0.18em] text-white/85 backdrop-blur"
            style={{ fontFamily: 'var(--font-tech)' }}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-300" style={{ animation: 'ccBlink 1.4s ease-in-out infinite' }} />
            cyborg · ao vivo
          </span>
        </div>
      </div>

      {/* ÍNDICE 1·2·3 + hint */}
      <div className="pointer-events-none absolute bottom-0 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-1.5">
        <div className="flex items-center gap-1.5">
          {HERO_VIDEOS.map((_, i) => (
            <span
              key={i}
              className="h-1.5 rounded-full transition-all duration-300"
              style={{
                width: i === index ? 18 : 6,
                background: i === index ? 'linear-gradient(90deg,#e879f9,#67e8f9)' : 'rgba(255,255,255,0.25)',
                boxShadow: i === index ? '0 0 10px rgba(232,121,249,0.7)' : 'none',
              }}
            />
          ))}
        </div>
        <span
          className="mono text-[8.5px] uppercase tracking-[0.18em] text-text-dim"
          style={{ fontFamily: 'var(--font-tech)' }}
        >
          passe o mouse pra trocar
        </span>
      </div>

      <style jsx>{`
        @keyframes ccAura {
          0%, 100% { transform: scale(1); opacity: 0.6; }
          50% { transform: scale(1.14); opacity: 1; }
        }
        @keyframes ccRing {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes ccVideoIn {
          0% { opacity: 0; transform: scale(1.05); filter: brightness(1.5) saturate(1.5); }
          45% { opacity: 1; }
          100% { opacity: 1; transform: scale(1); filter: brightness(1) saturate(1.06); }
        }
        @keyframes ccSweep {
          0% { transform: translateY(-120%); opacity: 0; }
          20% { opacity: 1; }
          100% { transform: translateY(620%); opacity: 0; }
        }
        @keyframes ccFlash {
          0% { opacity: 0; }
          22% { opacity: 0.42; }
          100% { opacity: 0; }
        }
        @keyframes ccBlink {
          0%, 100% { opacity: 0.45; }
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
