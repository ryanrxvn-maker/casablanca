'use client';

/**
 * HeroScene — o palco 3D da landing v2.
 *
 * Uma cena noturna de "estúdio rodando sozinho": piso em perspectiva que
 * esteira em direção ao viewer, aurora da marca, o coelho como núcleo de
 * energia e painéis de vidro flutuando em profundidades diferentes — fila do
 * Pilot, take de b-roll REAL (mp4 do produto), SRT alinhando e o ZIP caindo.
 * Tudo reage ao mouse via <Parallax> (CSS vars --px/--py), sem WebGL.
 *
 * Honestidade: os painéis são HUD ilustrativo do produto real; ferramentas
 * Pro carregam a tag "PRO" (lançamento em breve — detalhado nas seções).
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { DarkoLogo } from '../DarkoLogo';
import { SmokeText } from '../SmokeText';
import { Magnetic, Marquee, Parallax, Reveal } from './LandingKit';

/* profundidade: cada camada lê --px/--py do <Parallax> com fator próprio */
function depth(x: number, y: number, rotY = 0): React.CSSProperties {
  return {
    transform:
      `translate3d(calc(var(--px, 0) * ${x}px), calc(var(--py, 0) * ${y}px), 0)` +
      (rotY ? ` rotateY(calc(var(--px, 0) * ${rotY}deg))` : ''),
    willChange: 'transform',
  };
}

export function HeroScene() {
  return (
    <section className="relative overflow-hidden">
      <Parallax className="relative">
        {/* ── Camadas de fundo ───────────────────────────────── */}
        <div aria-hidden className="pointer-events-none absolute inset-0">
          {/* aurora da marca */}
          <div className="hs-aurora hs-aurora-a" style={depth(14, 10)} />
          <div className="hs-aurora hs-aurora-b" style={depth(-10, 8)} />
          <div className="hs-aurora hs-aurora-c" />
          {/* piso em perspectiva (esteira) */}
          <div className="hs-floor-wrap">
            <div className="hs-floor" />
          </div>
          {/* linha do horizonte */}
          <div className="hs-horizon" />
          {/* varredura de luz */}
          <div className="hs-sweep-wrap absolute inset-0 overflow-hidden">
            <div className="hs-sweep" />
          </div>
        </div>

        {/* ── Conteúdo ───────────────────────────────────────── */}
        <div className="relative mx-auto grid max-w-[1240px] grid-cols-1 items-center gap-10 px-5 pb-16 pt-14 md:px-8 md:pt-20 lg:grid-cols-[1.02fr_0.98fr] lg:gap-4 lg:pb-24">
          {/* Copy */}
          <div className="relative z-10 max-w-[620px]">
            <Reveal delay={0} y={16}>
              <div
                className="mb-6 inline-flex items-center gap-2.5 rounded-full border border-violet/35 bg-violet/10 px-3.5 py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.2em] text-violet backdrop-blur-md"
                style={{ fontFamily: 'var(--font-tech)' }}
              >
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet opacity-60" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-violet shadow-[0_0_10px_rgba(167,139,250,0.9)]" />
                </span>
                Suíte de automação de edição
              </div>
            </Reveal>

            <h1
              className="hero-title"
              style={{ fontSize: 'clamp(3rem, 7.2vw, 5.6rem)', lineHeight: 0.98 }}
            >
              <Reveal as="span" className="block" delay={80} y={26}>
                <SmokeText text="Você dorme." />
              </Reveal>
              <Reveal as="span" className="block" delay={220} y={26} style={{ marginTop: '0.08em' }}>
                {/* 0.75em: garante UMA linha na coluna e cria contraste editorial */}
                <span className="hs-grad-line" style={{ fontSize: '0.75em' }}>
                  O estúdio entrega.
                </span>
              </Reveal>
            </h1>

            <Reveal delay={380} y={18}>
              <p
                className="display-subtle mt-5 text-[19px] md:text-[22px]"
                style={{ lineHeight: 1.35 }}
              >
                Edição de vídeo no automático, direto do navegador.
              </p>
            </Reveal>

            <Reveal delay={470} y={16}>
              <p className="mt-4 max-w-[480px] text-[15.5px] leading-relaxed text-text-muted">
                Decupagem automática, legenda alinhada à copy e processamento
                em fila — você liga, vai fazer outra coisa e volta pra revisar
                o que já saiu.
              </p>
            </Reveal>

            <Reveal delay={560} y={14}>
              <div className="mt-8 flex flex-wrap items-center gap-3.5">
                <Magnetic strength={8}>
                  <Link
                    href="/register"
                    className="btn-primary group !px-7 !py-3.5 !text-[14.5px]"
                  >
                    <span>Começar grátis</span>
                    <span className="transition-transform duration-300 group-hover:translate-x-1">
                      →
                    </span>
                  </Link>
                </Magnetic>
                <Magnetic strength={6}>
                  <a href="#suite" className="btn-secondary !px-6 !py-3.5 !text-[13.5px]">
                    Conhecer a suíte
                  </a>
                </Magnetic>
              </div>
            </Reveal>

            <Reveal delay={680} y={12}>
              <div
                className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 text-[10.5px] uppercase tracking-[0.16em] text-text-dim"
                style={{ fontFamily: 'var(--font-label), var(--font-display)' , fontWeight: 600 }}
              >
                <span className="flex items-center gap-2">
                  <i className="hs-dot" style={{ background: 'rgb(var(--lime))' }} />
                  Sem cartão pra começar
                </span>
                <span className="flex items-center gap-2">
                  <i className="hs-dot" style={{ background: 'rgb(var(--violet))' }} />
                  Roda no navegador
                </span>
                <span className="flex items-center gap-2">
                  <i className="hs-dot" style={{ background: 'rgb(var(--cyan))' }} />
                  Cancela quando quiser
                </span>
              </div>
            </Reveal>
          </div>

          {/* Palco 3D */}
          <div className="relative z-10 mx-auto h-[430px] w-full max-w-[560px] md:h-[520px] lg:h-[580px]">
            {/* núcleo: coelho */}
            <div
              className="absolute left-1/2 top-[46%] -translate-x-1/2 -translate-y-1/2"
              style={depth(-9, -7)}
            >
              <div className="hs-core">
                <div className="hs-core-glow" />
                <span className="hs-ring hs-ring-1" />
                <span className="hs-ring hs-ring-2" />
                <span className="hs-ring hs-ring-3" />
                <div className="hs-core-float">
                  <DarkoLogo size={200} />
                </div>
              </div>
            </div>

            {/* HUD: relógio da madrugada */}
            <div className="absolute right-0 top-0" style={depth(-24, -16)}>
              <NightClock />
            </div>

            {/* Painel: fila do Pilot */}
            <div
              className="absolute -right-2 top-[13%] hidden sm:block md:right-0"
              style={depth(-30, -20, -5)}
            >
              <div className="hs-float" style={{ animationDuration: '7s' }}>
                <QueuePanel />
              </div>
            </div>

            {/* Painel: take de b-roll real */}
            <div
              className="absolute left-0 top-[24%] md:left-2"
              style={depth(-18, -12, 6)}
            >
              <div className="hs-float" style={{ animationDuration: '6.2s', animationDelay: '0.6s' }}>
                <BrollPanel />
              </div>
            </div>

            {/* Painel: SRT alinhando */}
            <div
              className="absolute bottom-[6%] left-[4%] hidden md:block"
              style={depth(-12, -8)}
            >
              <div className="hs-float" style={{ animationDuration: '8s', animationDelay: '1.1s' }}>
                <SrtPanel />
              </div>
            </div>

            {/* Chip: ZIP entregue */}
            <div
              className="absolute bottom-[10%] right-[6%]"
              style={depth(-22, -14)}
            >
              <div className="hs-float" style={{ animationDuration: '6.8s', animationDelay: '0.3s' }}>
                <ZipChip />
              </div>
            </div>
          </div>
        </div>

        {/* ── Esteira de capacidades ─────────────────────────── */}
        <div className="relative border-y border-line/50 bg-bg-soft/30 py-4 backdrop-blur-sm">
          <Marquee speed={34}>
            {[
              'Decupagem automática',
              'Legenda alinhada à copy',
              'Fila 24/7 no navegador',
              '3 ZIPs por disparo',
              'Compressão em lote',
              'Camuflagem',
              'Downloader',
              'Mixer de velocidade',
            ].map((t) => (
              <span key={t} className="flex items-center">
                <span
                  className="whitespace-nowrap px-6 text-[11.5px] font-bold uppercase tracking-[0.22em] text-text-muted"
                  style={{ fontFamily: 'var(--font-tech)' }}
                >
                  {t}
                </span>
                <svg width="10" height="10" viewBox="0 0 14 14" fill="rgba(167,139,250,0.55)" aria-hidden>
                  <path d="M7 0l1.2 4.8L13 6l-4.8 1.2L7 12l-1.2-4.8L0 6l4.8-1.2L7 0z" />
                </svg>
              </span>
            ))}
          </Marquee>
        </div>
      </Parallax>

      <style jsx>{`
        /* gradiente da marca na segunda linha do H1 */
        /* ⚠ TEXTO PURO aqui (sem SmokeText): as letras do SmokeText têm
           will-change/transform, viram camadas próprias e escapam do
           background-clip:text — com fill transparente, o texto SOME.
           Gradiente "vivo": background-position animada bem devagar. */
        .hs-grad-line {
          background: linear-gradient(
            110deg,
            #c4b5fd 0%,
            #a78bfa 30%,
            #bcc98c 55%,
            #a78bfa 80%,
            #c4b5fd 100%
          );
          background-size: 220% 100%;
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
          animation: hs-grad-flow 9s ease-in-out infinite;
        }
        @keyframes hs-grad-flow {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }
        .hs-dot {
          display: inline-block;
          width: 5px;
          height: 5px;
          border-radius: 9999px;
          box-shadow: 0 0 8px currentColor;
        }

        /* ── aurora ── */
        .hs-aurora {
          position: absolute;
          border-radius: 9999px;
          filter: blur(80px);
          mix-blend-mode: screen;
          opacity: 0.55;
        }
        .hs-aurora-a {
          width: 620px;
          height: 460px;
          left: -8%;
          top: -18%;
          background: radial-gradient(closest-side, rgba(167, 139, 250, 0.32), transparent 70%);
          animation: hs-aurora-drift 14s ease-in-out infinite;
        }
        .hs-aurora-b {
          width: 540px;
          height: 420px;
          right: -10%;
          top: -4%;
          background: radial-gradient(closest-side, rgba(224, 132, 176, 0.16), transparent 70%);
          animation: hs-aurora-drift 18s ease-in-out infinite reverse;
        }
        .hs-aurora-c {
          width: 700px;
          height: 380px;
          left: 30%;
          bottom: -20%;
          background: radial-gradient(closest-side, rgba(126, 213, 226, 0.10), transparent 70%);
          animation: hs-aurora-drift 22s ease-in-out infinite;
        }
        @keyframes hs-aurora-drift {
          0%, 100% { transform: translate3d(0, 0, 0) scale(1); }
          50% { transform: translate3d(34px, -22px, 0) scale(1.07); }
        }

        /* ── piso em perspectiva ── */
        .hs-floor-wrap {
          position: absolute;
          left: -12%;
          right: -12%;
          bottom: -4%;
          height: 46%;
          perspective: 640px;
          -webkit-mask-image: linear-gradient(to bottom, transparent 0%, #000 32%, #000 78%, transparent 100%);
          mask-image: linear-gradient(to bottom, transparent 0%, #000 32%, #000 78%, transparent 100%);
        }
        .hs-floor {
          position: absolute;
          inset: 0;
          transform: rotateX(62deg) scale(1.6);
          transform-origin: 50% 0%;
          background-image:
            linear-gradient(to right, rgba(167, 139, 250, 0.14) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(167, 139, 250, 0.14) 1px, transparent 1px);
          background-size: 46px 46px;
          animation: hs-floor-run 3s linear infinite;
        }
        @keyframes hs-floor-run {
          from { background-position: 0 0; }
          to { background-position: 0 46px; }
        }
        .hs-horizon {
          position: absolute;
          left: 6%;
          right: 6%;
          bottom: 42%;
          height: 1px;
          background: linear-gradient(
            90deg,
            transparent,
            rgba(167, 139, 250, 0.55) 35%,
            rgba(200, 214, 132, 0.4) 60%,
            transparent
          );
          box-shadow: 0 0 24px rgba(167, 139, 250, 0.35);
        }

        /* ── varredura de luz ── */
        .hs-sweep {
          position: absolute;
          top: -20%;
          bottom: -20%;
          left: -55%;
          width: 38%;
          background: linear-gradient(
            105deg,
            transparent 0%,
            rgba(255, 255, 255, 0.05) 35%,
            rgba(167, 139, 250, 0.10) 50%,
            rgba(255, 255, 255, 0.05) 65%,
            transparent 100%
          );
          mix-blend-mode: screen;
          transform: skewX(-12deg);
          animation: hs-sweep-run 9s ease-in-out infinite;
        }
        @keyframes hs-sweep-run {
          0%, 55% { transform: translateX(0) skewX(-12deg); }
          100% { transform: translateX(440%) skewX(-12deg); }
        }

        /* ── núcleo (coelho) ── */
        .hs-core {
          position: relative;
          display: grid;
          place-items: center;
          width: 300px;
          height: 300px;
        }
        .hs-core-glow {
          position: absolute;
          inset: -8%;
          border-radius: 9999px;
          background: radial-gradient(circle, rgba(167, 139, 250, 0.42), rgba(217, 70, 239, 0.10) 45%, transparent 68%);
          filter: blur(26px);
          animation: hs-core-breathe 5s ease-in-out infinite;
        }
        @keyframes hs-core-breathe {
          0%, 100% { opacity: 0.7; transform: scale(0.96); }
          50% { opacity: 1; transform: scale(1.06); }
        }
        .hs-core-float {
          position: relative;
          animation: hs-core-hover 6.5s ease-in-out infinite;
        }
        @keyframes hs-core-hover {
          0%, 100% { transform: translateY(0) rotateZ(0deg); }
          50% { transform: translateY(-14px) rotateZ(-2deg); }
        }
        .hs-ring {
          position: absolute;
          inset: 0;
          border-radius: 9999px;
          border: 1px solid rgba(167, 139, 250, 0.4);
          animation: hs-ring-pulse 4.2s cubic-bezier(0.2, 0.6, 0.3, 1) infinite;
        }
        .hs-ring-2 { animation-delay: 1.4s; }
        .hs-ring-3 { animation-delay: 2.8s; }
        @keyframes hs-ring-pulse {
          0% { opacity: 0.8; transform: scale(0.62); }
          100% { opacity: 0; transform: scale(1.35); }
        }

        /* flutuação idle dos painéis */
        .hs-float {
          animation-name: hs-float-y;
          animation-timing-function: ease-in-out;
          animation-iteration-count: infinite;
        }
        @keyframes hs-float-y {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-10px); }
        }

        @media (prefers-reduced-motion: reduce) {
          .hs-aurora, .hs-floor, .hs-sweep, .hs-core-glow, .hs-core-float, .hs-ring, .hs-float {
            animation: none !important;
          }
        }
      `}</style>
    </section>
  );
}

/* ────────────────────── HUD: relógio da madrugada ────────────────────── */

function NightClock() {
  // Ficção ilustrativa: 03:47 e a fila segue rodando. Puramente decorativo.
  const [sec, setSec] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setSec((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const total = 3 * 3600 + 47 * 60 + 12 + sec;
  const hh = String(Math.floor(total / 3600) % 24).padStart(2, '0');
  const mm = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');

  return (
    <div
      aria-hidden
      className="flex items-center gap-2.5 rounded-full border border-white/10 bg-black/55 px-3.5 py-1.5 backdrop-blur-xl"
      style={{ boxShadow: '0 10px 26px -12px rgba(0,0,0,0.8)' }}
    >
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-lime opacity-60" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-lime shadow-[0_0_8px_rgba(200,214,132,0.9)]" />
      </span>
      <span className="num text-[12px] text-white/90" style={{ fontFamily: 'var(--font-mono)' }}>
        {hh}:{mm}:{ss}
      </span>
      <span
        className="text-[9px] font-bold uppercase tracking-[0.18em] text-white/45"
        style={{ fontFamily: 'var(--font-tech)' }}
      >
        fila rodando
      </span>
    </div>
  );
}

/* ────────────────────── Painel: fila do Pilot ────────────────────── */

function QueuePanel() {
  const rows = [
    { name: 'Lipsync · ADS04', state: 'done' as const },
    { name: 'Lipsync · ADS05', state: 'done' as const },
    { name: 'Lipsync · ADS06', state: 'running' as const },
    { name: 'Lipsync · ADS07', state: 'queued' as const },
  ];
  return (
    <div
      className="w-[264px] overflow-hidden rounded-[18px] border border-white/12 bg-black/60 backdrop-blur-xl"
      style={{
        boxShadow:
          'inset 0 1px 0 rgba(255,255,255,0.08), 0 30px 60px -22px rgba(0,0,0,0.85), 0 0 44px -18px rgba(167,139,250,0.45)',
      }}
    >
      <div className="flex items-center gap-1.5 border-b border-white/8 px-3.5 py-2.5">
        <span className="h-2 w-2 rounded-full bg-red-400/70" />
        <span className="h-2 w-2 rounded-full bg-amber-400/70" />
        <span className="h-2 w-2 rounded-full bg-emerald-400/70" />
        <span
          className="ml-1.5 text-[9px] font-bold uppercase tracking-[0.18em] text-lime"
          style={{ fontFamily: 'var(--font-tech)' }}
        >
          Pilot · em execução
        </span>
        <span
          className="ml-auto rounded-full border border-violet/45 bg-violet/15 px-1.5 py-px text-[7.5px] font-bold uppercase tracking-[0.14em] text-violet"
          style={{ fontFamily: 'var(--font-tech)' }}
        >
          PRO
        </span>
      </div>

      <div className="px-3.5 pt-3">
        <div className="flex items-center justify-between">
          <span
            className="text-[9px] uppercase tracking-[0.18em] text-white/50"
            style={{ fontFamily: 'var(--font-tech)' }}
          >
            Fila do dia
          </span>
          <span className="num text-[10.5px] text-lime" style={{ fontFamily: 'var(--font-mono)' }}>
            12 / 18
          </span>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
          <div className="qp-bar h-full rounded-full" />
        </div>
      </div>

      <div className="space-y-1.5 px-3.5 py-3">
        {rows.map((t, i) => (
          <div
            key={i}
            className="flex items-center justify-between rounded-[9px] border border-white/8 bg-white/[0.03] px-2.5 py-1.5"
          >
            <div className="flex items-center gap-2">
              <span
                className={
                  'h-1.5 w-1.5 rounded-full ' + (t.state === 'running' ? 'qp-pulse' : '')
                }
                style={{
                  background:
                    t.state === 'done' ? '#c8d684' : t.state === 'running' ? '#a78bfa' : '#3a3a44',
                  boxShadow:
                    t.state !== 'queued'
                      ? `0 0 8px ${t.state === 'done' ? '#c8d684' : '#a78bfa'}`
                      : 'none',
                }}
              />
              <span className="text-[10.5px] font-medium text-white/90">{t.name}</span>
            </div>
            <span
              className="text-[8px] font-bold uppercase tracking-[0.14em]"
              style={{
                fontFamily: 'var(--font-tech)',
                color: t.state === 'done' ? '#c8d684' : t.state === 'running' ? '#c084fc' : '#5a5a64',
              }}
            >
              {t.state === 'done' ? 'pronto' : t.state === 'running' ? 'rodando' : 'fila'}
            </span>
          </div>
        ))}
      </div>

      <style jsx>{`
        .qp-bar {
          width: 66%;
          background: linear-gradient(90deg, #c8d684, #a78bfa, #7ed5e2);
          box-shadow: 0 0 12px rgba(167, 139, 250, 0.6);
          animation: qp-glow 2.4s ease-in-out infinite;
        }
        @keyframes qp-glow {
          0%, 100% { filter: brightness(1); }
          50% { filter: brightness(1.25); }
        }
        .qp-pulse {
          animation: qp-pulse 1.2s ease-in-out infinite;
        }
        @keyframes qp-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
        @media (prefers-reduced-motion: reduce) {
          .qp-bar, .qp-pulse { animation: none; }
        }
      `}</style>
    </div>
  );
}

/* ────────────────────── Painel: b-roll real (9:16) ────────────────────── */

function BrollPanel() {
  return (
    <div
      className="relative w-[148px] overflow-hidden rounded-[16px] border border-lime/40 md:w-[160px]"
      style={{
        aspectRatio: '9/16',
        boxShadow:
          '0 26px 52px -20px rgba(0,0,0,0.9), 0 0 42px -14px rgba(200,214,132,0.4), inset 0 1px 0 rgba(255,255,255,0.1)',
      }}
    >
      <video
        src="/cards/b-rolls.mp4"
        poster="/cards/b-rolls.jpg"
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        className="h-full w-full object-cover"
      />
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background: 'linear-gradient(180deg, rgba(0,0,0,0.35) 0%, transparent 30%, transparent 62%, rgba(0,0,0,0.55) 100%)',
        }}
      />
      <div
        className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded bg-black/65 px-1.5 py-0.5 backdrop-blur-sm"
        style={{ fontFamily: 'var(--font-tech)' }}
      >
        <span className="text-[7.5px] font-bold uppercase tracking-widest text-violet">Take</span>
        <span className="num text-[7.5px] font-extrabold text-white">04</span>
      </div>
      <div
        className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded-full bg-black/65 px-1.5 py-0.5 backdrop-blur-sm"
        style={{ fontFamily: 'var(--font-tech)' }}
      >
        <span className="h-1 w-1 rounded-full bg-lime shadow-[0_0_6px_rgba(200,214,132,0.9)]" />
        <span className="text-[7px] font-bold uppercase tracking-widest text-lime">pronto</span>
      </div>
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between px-2 pb-1.5">
        <span
          className="text-[7px] font-bold uppercase tracking-widest text-white/80"
          style={{ fontFamily: 'var(--font-tech)' }}
        >
          9:16 · 720p
        </span>
        <span className="num text-[7px] font-bold text-lime" style={{ fontFamily: 'var(--font-mono)' }}>
          10s
        </span>
      </div>
    </div>
  );
}

/* ────────────────────── Painel: SRT alinhando ────────────────────── */

function SrtPanel() {
  return (
    <div
      className="w-[218px] overflow-hidden rounded-[14px] border border-white/10 bg-black/55 px-3.5 py-3 backdrop-blur-xl"
      style={{
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 22px 44px -18px rgba(0,0,0,0.85)',
        fontFamily: 'var(--font-mono)',
      }}
    >
      <div className="flex items-center justify-between">
        <span
          className="text-[8.5px] font-bold uppercase tracking-[0.2em] text-violet"
          style={{ fontFamily: 'var(--font-tech)' }}
        >
          legenda.srt
        </span>
        <span className="text-[8.5px] text-white/40">alinhando…</span>
      </div>
      <div className="mt-2.5 space-y-2">
        <div>
          <div className="num text-[8.5px] text-violet/85">00:12,480 → 00:13,020</div>
          <div className="text-[10px] text-white/85">você liga a fila</div>
        </div>
        <div>
          <div className="num text-[8.5px] text-violet/85">00:13,180 → 00:14,300</div>
          <div className="srt-typing text-[10px] text-white/85">e vai dormir</div>
        </div>
      </div>
      <style jsx>{`
        .srt-typing::after {
          content: '▍';
          margin-left: 1px;
          color: rgba(167, 139, 250, 0.9);
          animation: srt-caret 1.05s steps(1) infinite;
        }
        @keyframes srt-caret {
          0%, 60% { opacity: 1; }
          61%, 100% { opacity: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .srt-typing::after { animation: none; }
        }
      `}</style>
    </div>
  );
}

/* ────────────────────── Chip: ZIP entregue ────────────────────── */

function ZipChip() {
  return (
    <div
      className="flex items-center gap-2.5 rounded-[13px] border border-white/12 bg-black/60 px-3.5 py-2.5 backdrop-blur-xl"
      style={{
        boxShadow:
          'inset 0 1px 0 rgba(255,255,255,0.07), 0 22px 44px -16px rgba(0,0,0,0.85), 0 0 34px -14px rgba(200,214,132,0.4)',
      }}
    >
      <span
        className="grid h-8 w-8 place-items-center rounded-[9px] border border-lime/40 bg-lime/10"
        aria-hidden
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#c8d684" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 8v13H3V8" />
          <path d="M1 3h22v5H1z" />
          <path d="M10 12h4" />
        </svg>
      </span>
      <div className="leading-tight">
        <div className="num text-[11px] font-bold text-white/95" style={{ fontFamily: 'var(--font-mono)' }}>
          AD14_montado.zip
        </div>
        <div
          className="mt-0.5 flex items-center gap-1.5 text-[8.5px] font-bold uppercase tracking-[0.16em] text-lime"
          style={{ fontFamily: 'var(--font-tech)' }}
        >
          <span className="h-1 w-1 rounded-full bg-lime shadow-[0_0_6px_rgba(200,214,132,0.9)]" />
          3 arquivos · entregue
        </div>
      </div>
    </div>
  );
}
