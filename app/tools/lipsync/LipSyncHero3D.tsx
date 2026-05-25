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

        {/* LADO DIREITO — Avatar morph robot ↔ human */}
        <MorphAvatar tiltX={tiltX} tiltY={tiltY} />
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

/* ---- MorphAvatar — wrapper com morph robot ↔ human + smoke + portal */
/**
 * Estados visuais:
 *   - idle:    robot 100%, human 0%, smoke 0%, portal 0%
 *   - hover:   robot 0%, human 100%, smoke fade (curto durante transicao)
 *   - leave:   portal scan-in expand + robot materializa de volta
 *
 * Tudo via CSS transitions com timing diferente em cada camada
 * pra ficar fluido. Sem state machines complexas, sem timers em
 * cascata — so duas variaveis booleanas e deixa o CSS coreografar.
 */
function MorphAvatar({ tiltX, tiltY }: { tiltX: number; tiltY: number }) {
  const [hover, setHover] = useState(false);
  const [returning, setReturning] = useState(false);
  const returnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function onEnter() {
    if (returnTimerRef.current) {
      clearTimeout(returnTimerRef.current);
      returnTimerRef.current = null;
    }
    setReturning(false);
    setHover(true);
  }

  function onLeave() {
    setHover(false);
    // Liga o "portal return" effect por 900ms
    setReturning(true);
    if (returnTimerRef.current) clearTimeout(returnTimerRef.current);
    returnTimerRef.current = setTimeout(() => {
      setReturning(false);
      returnTimerRef.current = null;
    }, 900);
  }

  useEffect(() => {
    return () => {
      if (returnTimerRef.current) clearTimeout(returnTimerRef.current);
    };
  }, []);

  return (
    <div
      className="relative mx-auto h-[360px] w-[300px] md:h-[400px] md:w-[360px]"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      {/* Aura — sempre presente */}
      <div
        aria-hidden
        className="absolute inset-[-10%] rounded-full blur-3xl"
        style={{
          background: hover
            ? 'radial-gradient(circle, rgba(103,232,249,0.5), rgba(232,121,249,0.25) 50%, transparent 80%)'
            : 'radial-gradient(circle, rgba(232,121,249,0.5), rgba(167,139,250,0.2) 50%, transparent 80%)',
          animation: 'lipAura 5s ease-in-out infinite',
          transition: 'background 0.6s',
        }}
      />

      {/* Rings rotativos */}
      <div
        aria-hidden
        className="absolute inset-0 rounded-full border border-fuchsia-400/30"
        style={{ animation: 'lipRing 24s linear infinite' }}
      />
      <div
        aria-hidden
        className="absolute inset-[-12px] rounded-full border border-violet/25"
        style={{ animation: 'lipRing 36s linear infinite reverse' }}
      />
      <div
        aria-hidden
        className="absolute inset-[-26px] rounded-full border border-cyan-400/20 border-dashed"
        style={{ animation: 'lipRing 60s linear infinite' }}
      />

      {/* Portal ring — aparece no return */}
      {returning && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-full"
          style={{
            border: '2px solid rgba(103,232,249,0.85)',
            boxShadow:
              '0 0 60px rgba(103,232,249,0.6), inset 0 0 40px rgba(103,232,249,0.5)',
            animation: 'portalExpand 0.85s ease-out forwards',
          }}
        />
      )}

      {/* Smoke particles — aparecem na transicao */}
      <SmokeParticles active={hover} returning={returning} />

      {/* Wrapper parallax 3D — comum aos dois rostos */}
      <div
        className="relative h-full w-full"
        style={{
          transformStyle: 'preserve-3d',
          transform: `perspective(1200px) rotateX(${tiltX}deg) rotateY(${tiltY}deg)`,
          transition: 'transform 0.6s cubic-bezier(.2,.8,.2,1)',
        }}
      >
        {/* ROBOT LAYER */}
        <div
          className="morph-layer"
          style={{
            opacity: hover ? 0 : 1,
            transform: hover
              ? 'scale(0.78) rotate(-3deg)'
              : returning
                ? 'scale(1) rotate(0deg)'
                : 'scale(1) rotate(0deg)',
            filter: hover ? 'blur(10px) hue-rotate(40deg)' : 'blur(0px) hue-rotate(0deg)',
            transition:
              'opacity 0.45s cubic-bezier(.4,0,.2,1), transform 0.6s cubic-bezier(.34,1.56,.64,1), filter 0.45s ease-out',
            animation: returning ? 'robotMaterialize 0.85s cubic-bezier(.2,.8,.2,1)' : undefined,
          }}
        >
          <RoboticFace3D />
        </div>

        {/* HUMAN LAYER */}
        <div
          className="morph-layer"
          style={{
            opacity: hover ? 1 : 0,
            transform: hover
              ? 'scale(1) rotate(0deg)'
              : 'scale(1.1) rotate(2deg)',
            filter: hover ? 'blur(0px)' : 'blur(8px)',
            transition:
              'opacity 0.5s cubic-bezier(.4,0,.2,1) 0.15s, transform 0.7s cubic-bezier(.34,1.56,.64,1) 0.1s, filter 0.5s ease-out 0.1s',
            pointerEvents: 'none',
          }}
        >
          <HumanFaceClean />
        </div>

        {/* CIRCULAR FLASH — circular sweep instead of retangular scan.
            Aparece com clip-path radial pra nao deixar borda quadrada visivel. */}
        {returning && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-full overflow-hidden"
            style={{
              animation: 'circularFlash 0.85s ease-out forwards',
              clipPath: 'circle(50% at 50% 50%)',
            }}
          >
            <div
              className="absolute inset-0"
              style={{
                background:
                  'conic-gradient(from 0deg, transparent 0deg, rgba(103,232,249,0.85) 30deg, rgba(232,121,249,0.6) 60deg, transparent 90deg, transparent 360deg)',
                animation: 'circularSweep 0.85s ease-out forwards',
                mixBlendMode: 'screen',
                filter: 'blur(6px)',
              }}
            />
          </div>
        )}
      </div>

      {/* Bunny easter egg */}
      <div
        className="absolute bottom-[-8px] right-[-12px] z-20"
        style={{
          animation: 'bunnyPeek 4s ease-in-out infinite',
          filter: 'drop-shadow(0 0 16px rgba(167,139,250,0.6))',
          opacity: hover ? 0.4 : 1,
          transition: 'opacity 0.4s',
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

      {/* Hint label */}
      <div
        className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 z-30"
        style={{
          opacity: hover ? 1 : 0.55,
          transition: 'opacity 0.3s',
        }}
      >
        <span
          className="mono inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/45 px-3 py-1 text-[9.5px] font-bold uppercase tracking-[0.18em] text-white/85 backdrop-blur"
          style={{ fontFamily: 'var(--font-tech)' }}
        >
          {hover ? '◉ humano' : '◉ passe o mouse'}
        </span>
      </div>

      <style jsx>{`
        .morph-layer {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          will-change: opacity, transform, filter;
          backface-visibility: hidden;
        }
        @keyframes portalExpand {
          0% { transform: scale(0.6); opacity: 0; }
          30% { opacity: 1; }
          100% { transform: scale(1.4); opacity: 0; }
        }
        @keyframes robotMaterialize {
          0% { opacity: 0; transform: scale(0.85) rotate(-5deg); filter: blur(8px) hue-rotate(60deg); }
          40% { opacity: 0.6; filter: blur(3px) hue-rotate(20deg); }
          100% { opacity: 1; transform: scale(1) rotate(0deg); filter: blur(0px) hue-rotate(0deg); }
        }
        @keyframes circularFlash {
          0% { opacity: 0; transform: scale(0.7); }
          25% { opacity: 1; transform: scale(1); }
          100% { opacity: 0; transform: scale(1.15); }
        }
        @keyframes circularSweep {
          from { transform: rotate(0deg); }
          to { transform: rotate(540deg); }
        }
      `}</style>
    </div>
  );
}

/* ---- SmokeParticles — particulas que aparecem na transicao ------- */
function SmokeParticles({ active, returning }: { active: boolean; returning: boolean }) {
  const visible = active || returning;
  // 14 particulas com angulos predeterminados pra parecer uma nuvem realista
  const particles = Array.from({ length: 14 }, (_, i) => {
    const angle = (i / 14) * Math.PI * 2 + (i % 2 === 0 ? 0.3 : -0.3);
    const dist = 60 + (i % 4) * 25;
    return {
      key: i,
      x: Math.cos(angle) * dist,
      y: Math.sin(angle) * dist * 0.7,
      size: 28 + (i % 5) * 8,
      delay: i * 35,
    };
  });

  if (!visible) return null;

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-10">
      {particles.map((p) => (
        <span
          key={p.key}
          className="absolute left-1/2 top-1/2 rounded-full"
          style={{
            width: p.size,
            height: p.size,
            marginLeft: -p.size / 2,
            marginTop: -p.size / 2,
            background:
              p.key % 3 === 0
                ? 'radial-gradient(circle, rgba(103,232,249,0.55), transparent 70%)'
                : p.key % 3 === 1
                  ? 'radial-gradient(circle, rgba(232,121,249,0.5), transparent 70%)'
                  : 'radial-gradient(circle, rgba(167,139,250,0.5), transparent 70%)',
            filter: 'blur(8px)',
            animation: `smokePuff 0.9s ease-out ${p.delay}ms forwards`,
            ['--tx' as string]: `${p.x}px`,
            ['--ty' as string]: `${p.y}px`,
          }}
        />
      ))}
      <style jsx>{`
        @keyframes smokePuff {
          0% {
            transform: translate(0, 0) scale(0.3);
            opacity: 0;
          }
          25% {
            opacity: 1;
          }
          100% {
            transform: translate(var(--tx), var(--ty)) scale(1.4);
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
}

/* ---- HumanFaceClean — UGC creator real photo + ultra premium framing */
/**
 * Substitui o SVG cartoon (que ficou ruim) por uma FOTO REAL de
 * creator UGC, com framing fotorealistico premium:
 *
 *  - Foto circular com soft mask (vinheta nos cantos pra blend)
 *  - Frame conic-gradient rotativo (rainbow) na borda
 *  - Halo glow externo intenso
 *  - HUD brackets [ ] flutuantes nos cantos
 *  - Aspect breath subtle (scale 1 ↔ 1.025)
 *  - Audio waveform embaixo
 *  - Pick aleatorio entre 3 avatares pra variedade
 *  - Imagens hospedadas localmente em /public (Unsplash CC-0, baixadas
 *    em 25/05/2026)
 */

const HUMAN_AVATARS = [
  '/lipsync-avatar-1.jpg',
  '/lipsync-avatar-2.jpg',
  '/lipsync-avatar-3.jpg',
  '/lipsync-avatar-4.jpg',
  '/lipsync-avatar-5.jpg',
];

function HumanFaceClean() {
  const [avatarSrc, setAvatarSrc] = useState<string>(HUMAN_AVATARS[0]);

  useEffect(() => {
    // pick random on mount
    setAvatarSrc(HUMAN_AVATARS[Math.floor(Math.random() * HUMAN_AVATARS.length)]);
  }, []);

  return (
    <div
      className="relative h-full w-full"
      style={{ animation: 'avFloat 6s ease-in-out infinite' }}
    >
      {/* PHOTO CIRCLE — main visual */}
      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
        style={{
          width: '82%',
          aspectRatio: '1',
          animation: 'hfBreath 4.5s ease-in-out infinite',
        }}
      >
        {/* Outer gradient ring */}
        <div
          aria-hidden
          className="absolute inset-[-6px] rounded-full"
          style={{
            background:
              'conic-gradient(from 0deg, #e879f9, #a78bfa, #67e8f9, #c8ff00, #e879f9)',
            animation: 'hfRingSpin 9s linear infinite',
            filter: 'blur(2px)',
            opacity: 0.85,
          }}
        />
        {/* Inner mask (dark rim) */}
        <div
          aria-hidden
          className="absolute inset-[-2px] rounded-full"
          style={{
            background: 'radial-gradient(circle, transparent 92%, rgba(0,0,0,0.6) 100%)',
            zIndex: 2,
          }}
        />

        {/* Photo */}
        <div
          className="absolute inset-0 rounded-full overflow-hidden"
          style={{
            boxShadow:
              'inset 0 0 0 2px rgba(255,255,255,0.08), 0 20px 60px rgba(232,121,249,0.45), 0 0 0 1px rgba(0,0,0,0.4)',
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={avatarSrc}
            alt=""
            aria-hidden
            className="absolute inset-0 h-full w-full object-cover"
            draggable={false}
            style={{
              filter: 'saturate(1.08) contrast(1.04)',
              animation: 'hfTalkPulse 0.9s ease-in-out infinite',
              transformOrigin: 'center 65%',
            }}
          />
          {/* Color overlay sutil pra integrar com tema */}
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              background:
                'radial-gradient(120% 80% at 30% 20%, rgba(232,121,249,0.15), transparent 60%), radial-gradient(120% 80% at 80% 80%, rgba(103,232,249,0.12), transparent 60%)',
              mixBlendMode: 'overlay',
            }}
          />
          {/* Top rim light */}
          <div
            aria-hidden
            className="absolute inset-x-0 top-0 h-1/3"
            style={{
              background:
                'linear-gradient(180deg, rgba(255,255,255,0.18), transparent 100%)',
              mixBlendMode: 'soft-light',
            }}
          />
          {/* Mouth-area glow pulse — sugere fala */}
          <div
            aria-hidden
            className="pointer-events-none absolute"
            style={{
              left: '38%',
              top: '64%',
              width: '24%',
              height: '14%',
              borderRadius: '50%',
              background:
                'radial-gradient(ellipse at center, rgba(232,121,249,0.55), rgba(167,139,250,0.25) 50%, transparent 80%)',
              filter: 'blur(8px)',
              mixBlendMode: 'screen',
              animation: 'hfMouthGlow 0.6s ease-in-out infinite alternate',
            }}
          />
          {/* Bottom vinheta */}
          <div
            aria-hidden
            className="absolute inset-0 rounded-full"
            style={{
              boxShadow: 'inset 0 -40px 60px -20px rgba(0,0,0,0.55)',
            }}
          />
        </div>

        {/* FALANDO indicator — appears next to face */}
        <div
          className="absolute z-30 pointer-events-none"
          style={{
            left: '-8%',
            top: '38%',
          }}
        >
          <div
            className="mono inline-flex items-center gap-1.5 rounded-full border border-fuchsia-400/55 bg-black/65 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.18em] text-fuchsia-300 backdrop-blur-md"
            style={{
              fontFamily: 'var(--font-tech)',
              animation: 'hfTalkBadge 1.4s ease-in-out infinite',
              boxShadow: '0 0 18px -4px rgba(232,121,249,0.7)',
            }}
          >
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-fuchsia-300 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-fuchsia-300" />
            </span>
            FALANDO
          </div>
        </div>

        {/* Audio bars side — at mouth height, simulating voice output */}
        <div
          className="absolute z-30 pointer-events-none flex items-end gap-[2px]"
          style={{
            right: '-14%',
            top: '60%',
            height: 28,
          }}
        >
          {Array.from({ length: 5 }).map((_, i) => (
            <span
              key={i}
              className="block w-[3px] rounded-full bg-gradient-to-t from-fuchsia-500 to-fuchsia-200"
              style={{
                height: '100%',
                animation: `hfBars 0.5s ease-in-out ${i * 0.08}s infinite alternate`,
                transformOrigin: 'bottom',
                filter: 'drop-shadow(0 0 4px rgba(232,121,249,0.7))',
              }}
            />
          ))}
        </div>
      </div>

      {/* SVG overlay com framing/HUD/waveform — fica POR CIMA da foto */}
      <svg
        viewBox="0 0 360 400"
        width="100%"
        height="100%"
        className="relative drop-shadow-[0_30px_60px_rgba(232,121,249,0.4)]"
        style={{ overflow: 'visible', pointerEvents: 'none' }}
      >
        <defs>
          {/* Backdrop */}
          <radialGradient id="hf-bg" cx="50%" cy="55%" r="60%">
            <stop offset="0%" stopColor="rgba(232,121,249,0.28)" />
            <stop offset="60%" stopColor="rgba(167,139,250,0.18)" />
            <stop offset="100%" stopColor="transparent" />
          </radialGradient>
          <filter id="hf-glow">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Backdrop circle (atras da foto) */}
        <circle cx="180" cy="200" r="170" fill="url(#hf-bg)" />

        {/* HUD halo external */}
        <circle
          cx="180"
          cy="200"
          r="158"
          fill="none"
          stroke="rgba(232,121,249,0.4)"
          strokeWidth="1"
          strokeDasharray="2 18"
          style={{ animation: 'avRotate 30s linear infinite', transformOrigin: '180px 200px' }}
        />

        {/* HUD brackets em volta da foto */}
        <g stroke="rgba(232,121,249,0.75)" strokeWidth="1.5" fill="none">
          <path d="M 50 130 L 50 110 L 70 110" />
          <path d="M 310 110 L 290 110 L 290 130" />
          <path d="M 50 290 L 50 310 L 70 310" />
          <path d="M 310 310 L 290 310 L 290 290" />
        </g>

        {/* Audio waveform outside (sound radiando) */}
        <g
          transform="translate(180 360)"
          style={{ animation: 'avWaveOpacity 2s ease-in-out infinite' }}
        >
          {Array.from({ length: 13 }).map((_, i) => {
            const offset = i - 6;
            return (
              <rect
                key={i}
                x={offset * 9 - 1.5}
                y="-8"
                width="3"
                height="16"
                rx="1.5"
                fill="#e879f9"
                style={{
                  animation: `avWave 0.6s ease-in-out ${i * 0.08}s infinite alternate`,
                  transformOrigin: 'center',
                  filter: 'drop-shadow(0 0 4px rgba(232,121,249,0.6))',
                }}
              />
            );
          })}
        </g>

        {/* HUD txt */}
        <g fontFamily="monospace" fontSize="8" fill="rgba(232,121,249,0.75)">
          <text x="40" y="385">[ CREATOR · MODE ]</text>
          <text x="40" y="395">READY TO TALK</text>
        </g>
        <g fontFamily="monospace" fontSize="8" fill="rgba(103,232,249,0.75)">
          <text x="232" y="385">[ HD · NATURAL ]</text>
          <text x="232" y="395">SYNC LOCKED</text>
        </g>
      </svg>

      <style jsx>{`
        @keyframes hfBreath {
          0%, 100% { transform: translate(-50%, -50%) scale(1); }
          50% { transform: translate(-50%, -50%) scale(1.025); }
        }
        @keyframes hfRingSpin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes hfTalkPulse {
          0%, 100% {
            transform: scale(1);
            filter: saturate(1.08) contrast(1.04) brightness(1);
          }
          30% {
            transform: scale(1.005);
            filter: saturate(1.12) contrast(1.05) brightness(1.03);
          }
          60% {
            transform: scale(1.002);
            filter: saturate(1.06) contrast(1.04) brightness(0.99);
          }
        }
        @keyframes hfMouthGlow {
          from { opacity: 0.35; transform: scaleX(0.85) scaleY(0.7); }
          to { opacity: 0.85; transform: scaleX(1.15) scaleY(1.1); }
        }
        @keyframes hfTalkBadge {
          0%, 100% { transform: translateY(0); opacity: 0.95; }
          50% { transform: translateY(-3px); opacity: 1; }
        }
        @keyframes hfBars {
          from { transform: scaleY(0.2); }
          to { transform: scaleY(1); }
        }
      `}</style>
    </div>
  );
}

/* ---- RoboticFace3D — rosto cyborg ultra futurista ---------------- */
/**
 * Cabeca robotica:
 *  - Plataforma facial hexagonal cromada (silver/cyan/violet gradient)
 *  - Visor HUD escuro com 2 LEDs cyan-violet brilhantes (olhos scanner)
 *  - Scan line horizontal varrendo o visor
 *  - Antena no topo com pulse LED
 *  - Boca-equalizer: 11 barras de audio dentro de uma fenda horizontal,
 *    cada barra animando em frequencia diferente (parece voz sendo
 *    sintetizada de verdade)
 *  - Vents laterais, status LEDs, circuit traces
 *  - HUD brackets [ ] em volta do visor
 *  - Halo HUD rotativo com tick marks tipo radar
 */
function RoboticFace3D() {
  return (
    <div
      className="relative h-full w-full"
      style={{ animation: 'avFloat 6s ease-in-out infinite' }}
    >
      <svg
        viewBox="0 0 360 400"
        width="100%"
        height="100%"
        className="drop-shadow-[0_30px_60px_rgba(103,232,249,0.4)]"
        style={{ overflow: 'visible' }}
      >
        <defs>
          {/* Chrome face gradient */}
          <linearGradient id="bot-chrome" x1="0%" y1="0%" x2="50%" y2="100%">
            <stop offset="0%" stopColor="#1a1a24" />
            <stop offset="25%" stopColor="#5a5a72" />
            <stop offset="50%" stopColor="#a8a8c4" />
            <stop offset="70%" stopColor="#4a4a5e" />
            <stop offset="100%" stopColor="#1a1a24" />
          </linearGradient>
          {/* Inner panel — darker */}
          <linearGradient id="bot-panel" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#2a2a38" />
            <stop offset="100%" stopColor="#0e0e16" />
          </linearGradient>
          {/* Visor — dark glass with cyan tint */}
          <linearGradient id="bot-visor" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#050810" />
            <stop offset="50%" stopColor="#0a1420" />
            <stop offset="100%" stopColor="#050810" />
          </linearGradient>
          {/* Eye core glow */}
          <radialGradient id="bot-eye" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#e0f9ff" />
            <stop offset="30%" stopColor="#67e8f9" />
            <stop offset="70%" stopColor="#a78bfa" />
            <stop offset="100%" stopColor="rgba(167,139,250,0)" />
          </radialGradient>
          {/* Backdrop circle */}
          <radialGradient id="bot-bg" cx="50%" cy="55%" r="60%">
            <stop offset="0%" stopColor="rgba(103,232,249,0.28)" />
            <stop offset="50%" stopColor="rgba(167,139,250,0.18)" />
            <stop offset="100%" stopColor="transparent" />
          </radialGradient>
          {/* Mouth slot interior */}
          <linearGradient id="bot-mouth-bg" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#000000" />
            <stop offset="100%" stopColor="#0a1018" />
          </linearGradient>
          {/* Equalizer bar gradient */}
          <linearGradient id="bot-eq" x1="0%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%" stopColor="#a78bfa" />
            <stop offset="50%" stopColor="#67e8f9" />
            <stop offset="100%" stopColor="#e879f9" />
          </linearGradient>
          {/* Glow filter strong */}
          <filter id="bot-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          {/* Glow filter soft */}
          <filter id="bot-glow-soft" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* BACKDROP */}
        <circle cx="180" cy="200" r="170" fill="url(#bot-bg)" />

        {/* HUD halo with tick marks (rotating radar style) */}
        <g style={{ animation: 'avRotate 28s linear infinite', transformOrigin: '180px 200px' }}>
          <circle
            cx="180"
            cy="200"
            r="158"
            fill="none"
            stroke="rgba(103,232,249,0.45)"
            strokeWidth="1"
            strokeDasharray="2 18"
          />
          {/* 4 cardinal tick marks (longer) */}
          {[0, 90, 180, 270].map((deg) => (
            <line
              key={deg}
              x1="180"
              y1="42"
              x2="180"
              y2="50"
              stroke="rgba(103,232,249,0.85)"
              strokeWidth="2"
              transform={`rotate(${deg} 180 200)`}
            />
          ))}
          {/* radar sweep */}
          <path
            d="M 180 200 L 180 50 A 150 150 0 0 1 285 100 Z"
            fill="url(#bot-bg)"
            opacity="0.4"
          />
        </g>

        {/* Outer HUD bracket corners */}
        <g stroke="rgba(103,232,249,0.7)" strokeWidth="1.5" fill="none">
          <path d="M 60 100 L 60 80 L 80 80" />
          <path d="M 300 80 L 280 80 L 280 100" />
          <path d="M 60 300 L 60 320 L 80 320" />
          <path d="M 300 320 L 280 320 L 280 300" />
        </g>

        {/* ANTENNA on top */}
        <g style={{ animation: 'antPulse 1.6s ease-in-out infinite' }}>
          <line x1="180" y1="88" x2="180" y2="62" stroke="#a8a8c4" strokeWidth="2.5" />
          <circle cx="180" cy="58" r="5" fill="#67e8f9" filter="url(#bot-glow)" />
          <circle cx="180" cy="58" r="2.5" fill="#e0f9ff" />
          {/* Side antenna tips */}
          <line x1="160" y1="92" x2="156" y2="74" stroke="#a8a8c4" strokeWidth="2" />
          <circle cx="156" cy="72" r="2.2" fill="#e879f9" />
          <line x1="200" y1="92" x2="204" y2="74" stroke="#a8a8c4" strokeWidth="2" />
          <circle cx="204" cy="72" r="2.2" fill="#e879f9" />
        </g>

        {/* HEAD — Hexagonal angular shape */}
        <g filter="url(#bot-glow-soft)">
          {/* Main face plate (chrome) */}
          <path
            d="M 110 110
               L 250 110
               L 282 145
               L 282 230
               L 260 270
               L 220 296
               L 140 296
               L 100 270
               L 78 230
               L 78 145 Z"
            fill="url(#bot-chrome)"
            stroke="rgba(103,232,249,0.55)"
            strokeWidth="1.5"
          />
          {/* Inner darker plate */}
          <path
            d="M 122 122
               L 238 122
               L 264 152
               L 264 224
               L 245 258
               L 212 280
               L 148 280
               L 115 258
               L 96 224
               L 96 152 Z"
            fill="url(#bot-panel)"
            opacity="0.85"
          />
        </g>

        {/* Forehead HUD strip */}
        <g>
          <rect x="135" y="132" width="90" height="6" rx="1" fill="rgba(103,232,249,0.15)" stroke="rgba(103,232,249,0.5)" strokeWidth="0.6" />
          {Array.from({ length: 8 }).map((_, i) => (
            <rect
              key={i}
              x={140 + i * 10}
              y="133.5"
              width="6"
              height="3"
              fill={i < 5 ? '#67e8f9' : 'rgba(103,232,249,0.25)'}
              style={{ animation: `hudBlink ${1 + (i % 3) * 0.3}s ease-in-out ${i * 0.1}s infinite` }}
            />
          ))}
        </g>

        {/* VISOR — dark glass */}
        <g>
          {/* Visor brackets [ ] */}
          <path d="M 96 168 L 92 168 L 92 210 L 96 210" stroke="rgba(103,232,249,0.75)" strokeWidth="1.5" fill="none" strokeLinecap="round" />
          <path d="M 264 168 L 268 168 L 268 210 L 264 210" stroke="rgba(103,232,249,0.75)" strokeWidth="1.5" fill="none" strokeLinecap="round" />

          {/* Visor body */}
          <rect
            x="105"
            y="162"
            width="150"
            height="52"
            rx="14"
            fill="url(#bot-visor)"
            stroke="rgba(103,232,249,0.4)"
            strokeWidth="1.2"
          />
          {/* Visor reflection top */}
          <rect x="110" y="165" width="140" height="14" rx="8" fill="rgba(167,139,250,0.08)" />

          {/* Scan line varrendo */}
          <rect
            x="105"
            y="162"
            width="150"
            height="2"
            fill="rgba(103,232,249,0.85)"
            style={{
              animation: 'visorScan 2.6s ease-in-out infinite',
              filter: 'drop-shadow(0 0 6px rgba(103,232,249,0.9))',
            }}
          />

          {/* Eye LEFT — LED core + scanner crosshair */}
          <g style={{ animation: 'eyePulse 2.2s ease-in-out infinite' }}>
            <circle cx="146" cy="188" r="14" fill="url(#bot-eye)" filter="url(#bot-glow)" />
            <circle cx="146" cy="188" r="6" fill="#e0f9ff" />
            <circle cx="146" cy="188" r="2.5" fill="#67e8f9" />
            {/* crosshair */}
            <line x1="128" y1="188" x2="164" y2="188" stroke="rgba(103,232,249,0.45)" strokeWidth="0.8" />
            <line x1="146" y1="170" x2="146" y2="206" stroke="rgba(103,232,249,0.45)" strokeWidth="0.8" />
          </g>

          {/* Eye RIGHT */}
          <g style={{ animation: 'eyePulse 2.2s ease-in-out 0.4s infinite' }}>
            <circle cx="214" cy="188" r="14" fill="url(#bot-eye)" filter="url(#bot-glow)" />
            <circle cx="214" cy="188" r="6" fill="#e0f9ff" />
            <circle cx="214" cy="188" r="2.5" fill="#67e8f9" />
            <line x1="196" y1="188" x2="232" y2="188" stroke="rgba(103,232,249,0.45)" strokeWidth="0.8" />
            <line x1="214" y1="170" x2="214" y2="206" stroke="rgba(103,232,249,0.45)" strokeWidth="0.8" />
          </g>

          {/* Tiny HUD text dots in corners */}
          <circle cx="113" cy="170" r="1.2" fill="#e879f9" />
          <circle cx="247" cy="170" r="1.2" fill="#e879f9" />
          <circle cx="113" cy="206" r="1.2" fill="#67e8f9" />
          <circle cx="247" cy="206" r="1.2" fill="#67e8f9" />
        </g>

        {/* NOSE — vent bridge */}
        <g>
          <rect x="174" y="222" width="12" height="22" rx="2" fill="rgba(20,20,28,0.85)" stroke="rgba(103,232,249,0.35)" strokeWidth="0.6" />
          {/* 3 horizontal vent lines */}
          <line x1="176" y1="228" x2="184" y2="228" stroke="rgba(103,232,249,0.55)" strokeWidth="0.7" />
          <line x1="176" y1="233" x2="184" y2="233" stroke="rgba(103,232,249,0.55)" strokeWidth="0.7" />
          <line x1="176" y1="238" x2="184" y2="238" stroke="rgba(103,232,249,0.55)" strokeWidth="0.7" />
        </g>

        {/* MOUTH — equalizer slot */}
        <g>
          {/* Mouth bracket corners */}
          <path d="M 130 250 L 128 250 L 128 274 L 130 274" stroke="rgba(232,121,249,0.7)" strokeWidth="1.2" fill="none" />
          <path d="M 230 250 L 232 250 L 232 274 L 230 274" stroke="rgba(232,121,249,0.7)" strokeWidth="1.2" fill="none" />

          {/* Slot body */}
          <rect
            x="135"
            y="252"
            width="90"
            height="22"
            rx="3"
            fill="url(#bot-mouth-bg)"
            stroke="rgba(232,121,249,0.55)"
            strokeWidth="1"
          />

          {/* Equalizer bars dentro do slot */}
          <g clipPath="inset(252 0 0 0 round 3)">
            {Array.from({ length: 11 }).map((_, i) => (
              <rect
                key={i}
                x={140 + i * 7.5}
                y="256"
                width="4"
                height="14"
                rx="1.5"
                fill="url(#bot-eq)"
                style={{
                  animation: `eqBar 0.55s ease-in-out ${i * 0.07}s infinite alternate`,
                  transformOrigin: `${142 + i * 7.5}px 263px`,
                  filter: 'drop-shadow(0 0 3px rgba(232,121,249,0.65))',
                }}
              />
            ))}
          </g>

          {/* Mouth glow underneath */}
          <ellipse cx="180" cy="280" rx="60" ry="6" fill="rgba(232,121,249,0.35)" filter="url(#bot-glow)" />
        </g>

        {/* CHEEK VENTS — left */}
        <g stroke="rgba(103,232,249,0.5)" strokeWidth="1.2" strokeLinecap="round">
          <line x1="98" y1="218" x2="112" y2="218" />
          <line x1="98" y1="226" x2="112" y2="226" />
          <line x1="98" y1="234" x2="112" y2="234" />
          <line x1="98" y1="242" x2="112" y2="242" />
        </g>
        {/* CHEEK VENTS — right */}
        <g stroke="rgba(103,232,249,0.5)" strokeWidth="1.2" strokeLinecap="round">
          <line x1="248" y1="218" x2="262" y2="218" />
          <line x1="248" y1="226" x2="262" y2="226" />
          <line x1="248" y1="234" x2="262" y2="234" />
          <line x1="248" y1="242" x2="262" y2="242" />
        </g>

        {/* Status LEDs (cheekbones) */}
        <circle cx="125" cy="220" r="2" fill="#e879f9" style={{ animation: 'ledBlink 1.4s ease-in-out infinite' }} />
        <circle cx="235" cy="220" r="2" fill="#67e8f9" style={{ animation: 'ledBlink 1.4s ease-in-out 0.7s infinite' }} />

        {/* Chin bottom plate detail */}
        <path d="M 158 290 L 202 290 L 195 296 L 165 296 Z" fill="rgba(20,20,28,0.85)" stroke="rgba(103,232,249,0.4)" strokeWidth="0.8" />

        {/* External audio waveform (sound radiating out) */}
        <g
          transform="translate(180 332)"
          style={{ animation: 'avWaveOpacity 2s ease-in-out infinite' }}
        >
          {Array.from({ length: 13 }).map((_, i) => {
            const offset = i - 6;
            return (
              <rect
                key={i}
                x={offset * 9 - 1.5}
                y="-8"
                width="3"
                height="16"
                rx="1.5"
                fill="#67e8f9"
                style={{
                  animation: `avWave 0.6s ease-in-out ${i * 0.08}s infinite alternate`,
                  transformOrigin: 'center',
                  filter: 'drop-shadow(0 0 4px rgba(103,232,249,0.7))',
                }}
              />
            );
          })}
        </g>

        {/* Floating icon — mic */}
        <g transform="translate(290 70)" opacity="0.9" style={{ animation: 'iconFloat 4s ease-in-out infinite' }}>
          <circle r="13" fill="rgba(232,121,249,0.16)" stroke="rgba(232,121,249,0.8)" strokeWidth="1.3" />
          <rect x="-2.5" y="-6" width="5" height="9" rx="2" fill="#e879f9" />
          <path d="M -5 1 Q -5 6 0 6 Q 5 6 5 1" stroke="#e879f9" strokeWidth="1.4" fill="none" strokeLinecap="round" />
          <line x1="0" y1="6" x2="0" y2="9" stroke="#e879f9" strokeWidth="1.4" />
        </g>

        {/* Floating icon — camera */}
        <g transform="translate(60 70)" opacity="0.9" style={{ animation: 'iconFloat 4s ease-in-out 1.5s infinite' }}>
          <circle r="13" fill="rgba(103,232,249,0.16)" stroke="rgba(103,232,249,0.8)" strokeWidth="1.3" />
          <rect x="-7" y="-4" width="14" height="9" rx="1.5" fill="none" stroke="#67e8f9" strokeWidth="1.4" />
          <circle r="2.5" fill="#67e8f9" cy="0.5" />
        </g>

        {/* HUD txt — left bottom */}
        <g
          fontFamily="monospace"
          fontSize="8"
          fill="rgba(103,232,249,0.7)"
          style={{ animation: 'hudBlink 1.6s ease-in-out infinite' }}
        >
          <text x="60" y="350">[ NEURAL · LATENT ]</text>
          <text x="60" y="362">SYNC 99.7%</text>
        </g>
        {/* HUD txt — right bottom */}
        <g fontFamily="monospace" fontSize="8" fill="rgba(232,121,249,0.7)">
          <text x="232" y="350" textAnchor="start">[ PHONEME · LOCK ]</text>
          <text x="232" y="362">FPS 32</text>
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
        @keyframes antPulse {
          0%, 100% { opacity: 0.85; }
          50% { opacity: 1; transform: translateY(-1px); }
        }
        @keyframes visorScan {
          0% { transform: translateY(0); opacity: 0; }
          15% { opacity: 1; }
          50% { transform: translateY(48px); opacity: 1; }
          85% { opacity: 1; }
          100% { transform: translateY(0); opacity: 0; }
        }
        @keyframes eyePulse {
          0%, 100% { opacity: 0.9; }
          50% { opacity: 1; transform: scale(1.06); transform-origin: center; }
        }
        @keyframes eqBar {
          from { transform: scaleY(0.18); }
          to { transform: scaleY(1.4); }
        }
        @keyframes ledBlink {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 1; }
        }
        @keyframes hudBlink {
          0%, 100% { opacity: 0.55; }
          50% { opacity: 1; }
        }
        @keyframes avWave {
          from { transform: scaleY(0.3); }
          to { transform: scaleY(1.4); }
        }
        @keyframes avWaveOpacity {
          0%, 100% { opacity: 0.55; }
          50% { opacity: 1; }
        }
        @keyframes iconFloat {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-6px); }
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
