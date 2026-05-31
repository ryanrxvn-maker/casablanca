'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * LipSyncHero3D — hero cinematografico EXCLUSIVO da ferramenta LipSync.
 *
 *   - Mesh gradient violet/fuchsia/cyan respirando
 *   - Grid + corner cuts + particulas voadoras
 *   - LADO ESQUERDO: eyebrow ULTRA ADMIN, titulo gradient enorme com
 *     shine, pipeline de etapas, 3 metricas premium
 *   - LADO DIREITO: o MESMO enquadramento CIRCULAR premium de antes (anel
 *     arco-íris conic rotativo + rings + HUD + waveform), agora com os 3
 *     vídeos do avatar virando cyborg em carrossel (auto-avança no fim de
 *     cada um + troca no hover).
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

        {/* LADO DIREITO — carrossel circular dos 3 vídeos cyborg */}
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

/* ---- CyborgCarousel — MESMO círculo premium de antes, com os 3 vídeos.
 *
 * Enquadramento idêntico ao da loira: vídeo CIRCULAR (object-cover preenchendo
 * o círculo) + anel arco-íris conic rotativo + rings + HUD SVG + waveform +
 * badges + respiração. Trocamos a loira pelos 3 vídeos cyborg em carrossel:
 * auto-avança quando o vídeo termina (fade limpo) e troca na hora no hover.
 *
 * IMPORTANTE (bug do branco resolvido): NÃO há mais overlay de "flash" branco
 * que voltava pra opacity 1 e cobria o vídeo. A transição é só um fade do
 * próprio vídeo (termina visível). Autoplay blindado (toca quando a aba está
 * visível, retoma no visibilitychange) → nunca fica parado/branco.
 */
const HERO_VIDEOS = ['/lipsync-hero/1.mp4', '/lipsync-hero/2.mp4', '/lipsync-hero/3.mp4'];

function CyborgCarousel({ tiltX, tiltY }: { tiltX: number; tiltY: number }) {
  const [index, setIndex] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const lastSwitch = useRef(0);

  function advance() {
    setIndex((i) => (i + 1) % HERO_VIDEOS.length);
  }

  function onEnter() {
    const now = Date.now();
    if (now - lastSwitch.current < 380) return; // anti-spam de hover
    lastSwitch.current = now;
    advance();
  }

  // Autoplay BLINDADO: o navegador pausa vídeo com a aba em segundo plano,
  // então tocamos sempre que a aba está visível — ao montar, a cada troca e
  // quando a aba volta a ficar visível.
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
  }, [index]);

  return (
    <div
      className="relative mx-auto h-[400px] w-[330px] md:h-[460px] md:w-[400px]"
      onMouseEnter={onEnter}
    >
      {/* Aura */}
      <div
        aria-hidden
        className="absolute inset-[-10%] rounded-full blur-3xl"
        style={{
          background: 'radial-gradient(circle, rgba(232,121,249,0.5), rgba(167,139,250,0.2) 50%, transparent 80%)',
          animation: 'ccAura 5s ease-in-out infinite',
        }}
      />

      {/* Rings rotativos */}
      <div aria-hidden className="absolute inset-0 rounded-full border border-fuchsia-400/30" style={{ animation: 'ccSpin 24s linear infinite' }} />
      <div aria-hidden className="absolute inset-[-12px] rounded-full border border-violet/25" style={{ animation: 'ccSpin 36s linear infinite reverse' }} />
      <div aria-hidden className="absolute inset-[-26px] rounded-full border border-cyan-400/20 border-dashed" style={{ animation: 'ccSpin 60s linear infinite' }} />

      {/* Wrapper parallax 3D */}
      <div
        className="relative h-full w-full"
        style={{
          transformStyle: 'preserve-3d',
          transform: `perspective(1200px) rotateX(${tiltX}deg) rotateY(${tiltY}deg)`,
          transition: 'transform 0.6s cubic-bezier(.2,.8,.2,1)',
        }}
      >
        {/* Float */}
        <div className="relative h-full w-full" style={{ animation: 'ccFloat 6s ease-in-out infinite' }}>
          {/* CÍRCULO do vídeo (igual ao da loira) */}
          <div
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
            style={{ width: '86%', aspectRatio: '1', animation: 'ccBreath 4.5s ease-in-out infinite' }}
          >
            {/* Anel arco-íris conic rotativo */}
            <div
              aria-hidden
              className="absolute inset-[-6px] rounded-full"
              style={{
                background: 'conic-gradient(from 0deg, #e879f9, #a78bfa, #67e8f9, #c8ff00, #e879f9)',
                animation: 'ccSpin 9s linear infinite',
                filter: 'blur(2px)',
                opacity: 0.9,
              }}
            />
            {/* Rim escuro */}
            <div
              aria-hidden
              className="absolute inset-[-2px] rounded-full"
              style={{ background: 'radial-gradient(circle, transparent 92%, rgba(0,0,0,0.6) 100%)', zIndex: 2 }}
            />

            {/* VÍDEO circular — preenche o círculo (object-cover), key força o fade */}
            <div
              className="absolute inset-0 rounded-full overflow-hidden"
              style={{ boxShadow: 'inset 0 0 0 2px rgba(255,255,255,0.08), 0 20px 60px rgba(232,121,249,0.45), 0 0 0 1px rgba(0,0,0,0.4)', background: '#05050a' }}
            >
              <video
                key={index}
                ref={videoRef}
                src={HERO_VIDEOS[index]}
                autoPlay
                muted
                playsInline
                preload="auto"
                onEnded={advance}
                className="absolute inset-0 h-full w-full object-cover"
                style={{ filter: 'saturate(1.08) contrast(1.04)', animation: 'ccFadeIn 0.6s cubic-bezier(.2,.8,.2,1)' }}
              />
              {/* color overlay sutil */}
              <div
                aria-hidden
                className="absolute inset-0"
                style={{ background: 'radial-gradient(120% 80% at 30% 20%, rgba(232,121,249,0.15), transparent 60%), radial-gradient(120% 80% at 80% 80%, rgba(103,232,249,0.12), transparent 60%)', mixBlendMode: 'overlay' }}
              />
              {/* top rim light */}
              <div
                aria-hidden
                className="absolute inset-x-0 top-0 h-1/3"
                style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.18), transparent 100%)', mixBlendMode: 'soft-light' }}
              />
              {/* vinheta */}
              <div aria-hidden className="absolute inset-0 rounded-full" style={{ boxShadow: 'inset 0 -40px 60px -20px rgba(0,0,0,0.55)' }} />
            </div>

            {/* badge CYBORG — ao lado do círculo (igual o FALANDO de antes) */}
            <div className="absolute z-30 pointer-events-none" style={{ left: '-8%', top: '38%' }}>
              <div
                className="mono inline-flex items-center gap-1.5 rounded-full border border-cyan-400/55 bg-black/65 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.18em] text-cyan-300 backdrop-blur-md"
                style={{ fontFamily: 'var(--font-tech)', animation: 'ccBadge 1.4s ease-in-out infinite', boxShadow: '0 0 18px -4px rgba(103,232,249,0.7)' }}
              >
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-300 opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-cyan-300" />
                </span>
                CYBORG
              </div>
            </div>

            {/* audio bars — à direita */}
            <div className="absolute z-30 pointer-events-none flex items-end gap-[2px]" style={{ right: '-14%', top: '60%', height: 28 }}>
              {Array.from({ length: 5 }).map((_, i) => (
                <span
                  key={i}
                  className="block w-[3px] rounded-full bg-gradient-to-t from-fuchsia-500 to-fuchsia-200"
                  style={{ height: '100%', animation: `ccBars 0.5s ease-in-out ${i * 0.08}s infinite alternate`, transformOrigin: 'bottom', filter: 'drop-shadow(0 0 4px rgba(232,121,249,0.7))' }}
                />
              ))}
            </div>
          </div>

          {/* SVG overlay HUD/waveform — por cima */}
          <svg
            viewBox="0 0 400 400"
            width="100%"
            height="100%"
            className="relative drop-shadow-[0_30px_60px_rgba(232,121,249,0.4)]"
            style={{ overflow: 'visible', pointerEvents: 'none' }}
          >
            <defs>
              <radialGradient id="cc-bg" cx="50%" cy="55%" r="60%">
                <stop offset="0%" stopColor="rgba(232,121,249,0.26)" />
                <stop offset="60%" stopColor="rgba(167,139,250,0.16)" />
                <stop offset="100%" stopColor="transparent" />
              </radialGradient>
            </defs>

            {/* Backdrop atras do circulo */}
            <circle cx="200" cy="200" r="188" fill="url(#cc-bg)" />

            {/* Halo HUD rotativo (dashes) */}
            <circle
              cx="200"
              cy="200"
              r="182"
              fill="none"
              stroke="rgba(232,121,249,0.4)"
              strokeWidth="1"
              strokeDasharray="2 18"
              style={{ animation: 'ccSpin 30s linear infinite', transformOrigin: '200px 200px' }}
            />
            {/* ticks cardeais */}
            {[0, 90, 180, 270].map((deg) => (
              <line key={deg} x1="200" y1="12" x2="200" y2="20" stroke="rgba(103,232,249,0.8)" strokeWidth="2" transform={`rotate(${deg} 200 200)`} />
            ))}

            {/* HUD brackets em volta do circulo */}
            <g stroke="rgba(232,121,249,0.75)" strokeWidth="1.5" fill="none">
              <path d="M 58 132 L 58 110 L 80 110" />
              <path d="M 342 110 L 320 110 L 320 132" />
              <path d="M 58 268 L 58 290 L 80 290" />
              <path d="M 342 290 L 320 290 L 320 268" />
            </g>

            {/* Waveform embaixo */}
            <g transform="translate(200 372)" style={{ animation: 'ccWaveOp 2s ease-in-out infinite' }}>
              {Array.from({ length: 15 }).map((_, i) => {
                const offset = i - 7;
                return (
                  <rect
                    key={i}
                    x={offset * 9 - 1.5}
                    y="-8"
                    width="3"
                    height="16"
                    rx="1.5"
                    fill="#e879f9"
                    style={{ animation: `ccWave 0.6s ease-in-out ${i * 0.07}s infinite alternate`, transformOrigin: 'center', filter: 'drop-shadow(0 0 4px rgba(232,121,249,0.6))' }}
                  />
                );
              })}
            </g>

            {/* HUD txt */}
            <g fontFamily="monospace" fontSize="8" fill="rgba(232,121,249,0.75)">
              <text x="52" y="386">[ CYBORG · MODE ]</text>
              <text x="52" y="396">READY TO TALK</text>
            </g>
            <g fontFamily="monospace" fontSize="8" fill="rgba(103,232,249,0.75)">
              <text x="262" y="386">[ HD · NATURAL ]</text>
              <text x="262" y="396">SYNC LOCKED</text>
            </g>
          </svg>
        </div>
      </div>

      {/* Badge topo */}
      <div className="pointer-events-none absolute left-1/2 top-1 -translate-x-1/2 z-30">
        <span
          className="mono inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/50 px-3 py-1 text-[9.5px] font-bold uppercase tracking-[0.18em] text-white/85 backdrop-blur"
          style={{ fontFamily: 'var(--font-tech)' }}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-lime" style={{ animation: 'ccBlink 1.3s ease-in-out infinite' }} />
          CYBORG · AO VIVO
        </span>
      </div>

      {/* Índice 1·2·3 + hint */}
      <div className="pointer-events-none absolute bottom-0 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center gap-1.5">
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
        <span className="mono text-[8.5px] uppercase tracking-[0.18em] text-text-dim" style={{ fontFamily: 'var(--font-tech)' }}>
          passe o mouse pra trocar
        </span>
      </div>

      <style jsx>{`
        @keyframes ccAura {
          0%, 100% { transform: scale(1); opacity: 0.6; }
          50% { transform: scale(1.18); opacity: 1; }
        }
        @keyframes ccSpin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes ccFloat {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-10px); }
        }
        @keyframes ccBreath {
          0%, 100% { transform: translate(-50%, -50%) scale(1); }
          50% { transform: translate(-50%, -50%) scale(1.025); }
        }
        /* fade do vídeo na troca — TERMINA visível (opacity 1) = sem bug de branco */
        @keyframes ccFadeIn {
          0% { opacity: 0; transform: scale(1.05); filter: brightness(1.5) saturate(1.4); }
          45% { opacity: 1; }
          100% { opacity: 1; transform: scale(1); filter: brightness(1) saturate(1.08); }
        }
        @keyframes ccBadge {
          0%, 100% { transform: translateY(0); opacity: 0.95; }
          50% { transform: translateY(-3px); opacity: 1; }
        }
        @keyframes ccBars {
          from { transform: scaleY(0.2); }
          to { transform: scaleY(1.3); }
        }
        @keyframes ccBlink {
          0%, 100% { opacity: 0.45; }
          50% { opacity: 1; }
        }
        @keyframes ccWave {
          from { transform: scaleY(0.3); }
          to { transform: scaleY(1.4); }
        }
        @keyframes ccWaveOp {
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
