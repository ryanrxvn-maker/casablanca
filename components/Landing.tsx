'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Brand } from './Brand';
import { DarkoLogo } from './DarkoLogo';
import { SmokeText } from './SmokeText';
import {
  IconAutoBroll,
  IconClickUpPilot,
  IconDecupagem,
  IconHeyGenAuto,
  IconRemoverElementos,
  IconTrocaProduto,
} from './ToolIcons';

/**
 * Landing — página pública em `/`.
 *
 * Copy 100% focada em AUTOMAÇÃO (não na edição em si).
 * Texto da copy quando passa o mouse vira fumaça (SmokeText).
 */
export function Landing() {
  return (
    <main className="relative min-h-screen overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          background:
            'radial-gradient(48% 36% at 18% 12%, rgba(167,139,250,0.18), transparent 65%),' +
            'radial-gradient(40% 32% at 84% 4%, rgba(244,114,182,0.12), transparent 65%),' +
            'radial-gradient(55% 40% at 50% 100%, rgba(103,232,249,0.08), transparent 70%)',
        }}
      />

      <LandingHeader />
      <HeroSection />
      <StatsRow />
      <PilotShowcase />
      <PilotHowItWorks />
      <AutoBrollShowcase />
      <AutoBrollHowItWorks />
      <CapabilitiesSection />
      <ShowcaseSection />
      <FinalCTA />
      <LandingFooter />
    </main>
  );
}

/* ────────────────────────── HEADER ────────────────────────── */

function LandingHeader() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 14);
    }
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={
        'sticky top-0 z-30 transition-all duration-300 ' +
        (scrolled
          ? 'border-b border-line/70 bg-bg/80 backdrop-blur-xl'
          : 'border-b border-transparent bg-transparent')
      }
    >
      <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-5 md:px-8">
        <Brand href="/" />
        <div className="flex items-center gap-2">
          <Link href="/planos" className="btn-silver">
            Planos
          </Link>
          <Link href="/login" className="btn-ghost">
            Entrar
          </Link>
          <Link href="/register" className="btn-primary">
            Começar grátis
          </Link>
        </div>
      </div>
    </header>
  );
}

/* ────────────────────────── HERO ────────────────────────── */

function HeroSection() {
  return (
    <section className="relative px-5 pt-12 md:px-8 md:pt-20">
      <div className="mx-auto grid max-w-[1200px] grid-cols-1 items-center gap-12 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="relative z-10">
          <div
            className="mb-5 inline-flex items-center gap-2 rounded-full border border-violet/35 bg-violet/10 px-3 py-1 text-[10.5px] font-semibold uppercase tracking-[0.20em] text-violet animate-fade-in"
            style={{ fontFamily: 'var(--font-tech)' }}
          >
            <span className="inline-block h-1.5 w-1.5 animate-pulse-soft rounded-full bg-violet shadow-[0_0_10px_rgba(167,139,250,0.9)]" />
            Suite de automação criativa
          </div>

          <h1 className="hero-title" style={{ fontSize: 'clamp(2.5rem, 6vw, 4.5rem)' }}>
            <SmokeText text="Edição no automático." className="block" />
            <span className="block" style={{ marginTop: '0.2em' }}>
              <span className="display-subtle" style={{ fontSize: 'clamp(1.8rem, 4vw, 3rem)', lineHeight: '1.1' }}>
                <span style={{ color: 'var(--violet)' }}>
                  <SmokeText text="Você dorme, o estúdio entrega." />
                </span>
              </span>
            </span>
          </h1>

          <p
            className="mt-6 max-w-[540px] text-[16px] leading-relaxed text-text-muted fade-in-up"
            style={{ animationDelay: '500ms' }}
          >
            Ligue a automação, feche o notebook e vá dormir.<br />
            Acorde com B-roll e lipsync prontos.
          </p>

          <div
            className="mt-8 flex flex-wrap items-center gap-3 fade-in-up"
            style={{ animationDelay: '600ms' }}
          >
            <Link href="/login" className="btn-primary group">
              <span>Começar agora</span>
              <span className="transition-transform duration-300 group-hover:translate-x-1">→</span>
            </Link>
            <a href="#capacidades" className="btn-secondary">
              Ver como funciona
            </a>
          </div>

          <div className="mt-8 flex items-center gap-4 fade-in-up" style={{ animationDelay: '720ms' }}>
            <AvatarStack />
            <p className="text-[12.5px] leading-tight text-text-muted">
              <span className="font-semibold text-white">Estúdios automatizados</span>
              <br />
              entregando 20× mais com a mesma equipe.
            </p>
          </div>
        </div>

        <HeroVisual />
      </div>
    </section>
  );
}

function HeroVisual() {
  return (
    <div className="hero-visual relative mx-auto flex h-[460px] w-full max-w-[520px] items-center justify-center md:h-[560px]">
      <div className="hv-orbit hv-orbit-1 absolute inset-0">
        <FloatIcon delay={0} className="absolute left-[8%] top-[12%]" hue="rgba(240,171,252,0.45)" icon={<IconAutoBroll size={28} />} />
        <FloatIcon delay={300} className="absolute right-[6%] top-[20%]" hue="rgba(103,232,249,0.45)" icon={<IconHeyGenAuto size={28} />} />
        <FloatIcon delay={600} className="absolute left-[5%] bottom-[18%]" hue="rgba(163,230,53,0.4)" icon={<IconDecupagem size={28} />} />
        <FloatIcon delay={900} className="absolute right-[8%] bottom-[10%]" hue="rgba(244,114,182,0.45)" icon={<IconTrocaProduto size={28} />} />
        <FloatIcon delay={1200} className="absolute right-[40%] top-[5%]" hue="rgba(167,139,250,0.45)" icon={<IconRemoverElementos size={28} />} />
      </div>

      <div className="hv-mark relative z-10">
        <div
          aria-hidden
          className="absolute inset-0 -m-12 rounded-full opacity-60 blur-3xl"
          style={{ background: 'radial-gradient(circle, rgba(167,139,250,0.5), transparent 65%)' }}
        />
        <div className="relative">
          <DarkoLogo size={220} />
        </div>
      </div>

      <style jsx>{`
        .hv-mark { animation: hv-mark-float 6s ease-in-out infinite; }
        @keyframes hv-mark-float {
          0%, 100% { transform: translateY(0) rotateZ(0); }
          50% { transform: translateY(-12px) rotateZ(-2deg); }
        }
        .hv-orbit { animation: hv-orbit-spin 30s linear infinite; }
        @keyframes hv-orbit-spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

function FloatIcon({
  icon,
  hue,
  delay,
  className,
}: {
  icon: React.ReactNode;
  hue: string;
  delay: number;
  className?: string;
}) {
  return (
    <div className={'float-icon ' + (className || '')} style={{ animationDelay: `${delay}ms` }}>
      <span
        className="float-icon-inner flex h-14 w-14 items-center justify-center rounded-[16px] border border-white/10 bg-black/40 backdrop-blur-md"
        style={{ boxShadow: `0 0 32px -6px ${hue}, inset 0 1px 0 rgba(255,255,255,0.1)` }}
      >
        {icon}
      </span>
      <style jsx>{`
        .float-icon { animation: fi-pop 600ms cubic-bezier(0.34, 1.56, 0.64, 1) both, fi-float 5s ease-in-out infinite; }
        .float-icon-inner { animation: fi-counterspin 30s linear infinite; }
        @keyframes fi-pop {
          0% { opacity: 0; transform: scale(0.4); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes fi-float {
          0%, 100% { transform: translate(0, 0); }
          50% { transform: translate(0, -8px); }
        }
        @keyframes fi-counterspin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(-360deg); }
        }
      `}</style>
    </div>
  );
}

function AvatarStack() {
  const seeds = ['#a78bfa', '#67e8f9', '#f0abfc', '#c8ff00', '#fbbf24'];
  return (
    <div className="flex -space-x-2">
      {seeds.map((c, i) => (
        <span
          key={i}
          className="h-8 w-8 rounded-full border-2 border-bg"
          style={{
            background: `linear-gradient(135deg, ${c}, #1a1a20)`,
            boxShadow: `inset 0 1px 0 rgba(255,255,255,0.2), 0 0 12px -4px ${c}`,
          }}
        />
      ))}
    </div>
  );
}

/* ────────────────────────── STATS ────────────────────────── */

function StatsRow() {
  const stats = [
    { value: '20×', label: 'mais rápido que editar à mão' },
    { value: '90%', label: 'do trabalho repetitivo no automático' },
    { value: '24/7', label: 'rodando enquanto você dorme' },
    { value: '1×', label: 'clique pra disparar o dia inteiro' },
  ];
  return (
    <section className="mx-auto mt-24 max-w-[1200px] px-5 md:px-8">
      <div className="grid grid-cols-2 gap-6 rounded-[20px] border border-line/60 bg-bg-soft/50 px-6 py-7 backdrop-blur-md md:grid-cols-4 md:px-10">
        {stats.map((s, i) => (
          <div key={i} className="fade-in-up text-center" style={{ animationDelay: `${i * 80}ms` }}>
            <div
              className="text-3xl font-extrabold tracking-tight md:text-4xl"
              style={{
                fontFamily: 'var(--font-tech)',
                background: 'linear-gradient(135deg, #fff 0%, #a78bfa 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                letterSpacing: '-0.02em',
              }}
            >
              {s.value}
            </div>
            <p className="mt-2 text-[12px] leading-snug text-text-muted">
              {s.label}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ────────────────────── PILOT SHOWCASE ────────────────────── */

function PilotShowcase() {
  return (
    <section id="pilot" className="mx-auto mt-32 max-w-[1200px] px-5 md:px-8">
      <div
        className="relative overflow-hidden rounded-[32px] border border-line/70 fade-in-up"
        style={{
          background:
            'linear-gradient(120deg, rgba(200,255,0,0.18) 0%, rgba(167,139,250,0.22) 50%, rgba(34,211,238,0.14) 100%), linear-gradient(180deg, #15151a, #08080a)',
        }}
      >
        {/* Pulsos animados — fundo ambient */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(55% 90% at 0% 50%, rgba(200,255,0,0.32), transparent 58%)',
            animation: 'promo-pulse-a 6s ease-in-out infinite',
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(55% 90% at 100% 50%, rgba(167,139,250,0.40), transparent 58%)',
            animation: 'promo-pulse-b 7s ease-in-out infinite',
          }}
        />

        {/* Grid sutil */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              'linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)',
            backgroundSize: '46px 46px',
          }}
        />

        {/* Sparkles */}
        <SparkleFloat className="absolute top-10 right-[30%]" delay={0} />
        <SparkleFloat className="absolute top-[55%] right-[20%]" delay={900} />
        <SparkleFloat className="absolute top-[28%] right-[10%]" delay={1800} />
        <SparkleFloat className="absolute bottom-12 left-[18%]" delay={2400} />

        {/* Mockup HUD do Pilot */}
        <div
          aria-hidden
          className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 lg:block"
        >
          <PilotMockup />
        </div>

        {/* Conteúdo */}
        <div className="relative flex flex-col items-start gap-7 px-7 py-14 md:px-14 md:py-24">
          {/* Numeração editorial */}
          <div
            className="flex items-baseline gap-3 text-white/35"
            style={{ fontFamily: 'var(--font-mono)' }}
          >
            <span className="text-[10.5px] tracking-[0.32em]">001</span>
            <span className="h-px w-10 bg-white/25" />
            <span
              className="text-[10.5px] uppercase tracking-[0.28em] text-lime"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              O CENTRO DA OPERAÇÃO
            </span>
          </div>

          <h2
            className="max-w-[820px] text-[36px] font-extrabold leading-[1] tracking-tight text-white md:text-[64px]"
            style={{ fontFamily: 'var(--font-tech)', letterSpacing: '-0.03em' }}
          >
            <SmokeText text="Você sai do escritório." className="block" />
            <span
              className="block"
              style={{
                background:
                  'linear-gradient(135deg, #c8ff00 0%, #a78bfa 60%, #67e8f9 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              <SmokeText text="Ele continua editando." />
            </span>
          </h2>

          <p className="max-w-[580px] text-[15.5px] leading-relaxed text-white/85">
            O Pilot lê os briefings no seu ClickUp, identifica avatar e roteiro
            de cada task, e dispara o lipsync sozinho no HeyGen — parte por
            parte.
            <br />
            <span className="text-white/65">
              Você dorme. Acorda. Tudo já tá pronto pra revisar.
            </span>
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-3">
            <Link
              href="/login"
              className="group/btn relative inline-flex items-center gap-2 overflow-hidden rounded-full px-7 py-3.5 text-[14px] font-bold text-black"
              style={{
                background:
                  'linear-gradient(135deg, #c8ff00 0%, #a3e635 100%)',
                boxShadow:
                  'inset 0 1px 0 rgba(255,255,255,0.5), 0 14px 36px -8px rgba(200,255,0,0.6)',
              }}
            >
              <span className="relative z-10">Ver o Pilot em ação</span>
              <span className="relative z-10 transition-transform duration-300 group-hover/btn:translate-x-1">
                →
              </span>
              <span
                aria-hidden
                className="absolute inset-0 -translate-x-[120%] bg-gradient-to-r from-transparent via-white/40 to-transparent transition-transform duration-700 group-hover/btn:translate-x-[120%]"
              />
            </Link>
            <a
              href="#pilot-passos"
              className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-6 py-3.5 text-[13.5px] font-bold text-white backdrop-blur-md transition-all duration-300 hover:-translate-y-[1px] hover:border-white/35 hover:bg-white/10"
            >
              Ver como funciona
            </a>
          </div>
        </div>

        <style jsx>{`
          @keyframes promo-pulse-a {
            0%, 100% { opacity: 0.55; transform: scale(1); }
            50% { opacity: 0.9; transform: scale(1.05); }
          }
          @keyframes promo-pulse-b {
            0%, 100% { opacity: 0.55; transform: scale(1.03); }
            50% { opacity: 0.9; transform: scale(0.97); }
          }
        `}</style>
      </div>
    </section>
  );
}

/* ─────────────────── AUTO B-ROLL SHOWCASE ─────────────────── */

function AutoBrollShowcase() {
  return (
    <section id="auto-broll" className="mx-auto mt-20 max-w-[1200px] px-5 md:px-8">
      <div
        className="relative overflow-hidden rounded-[32px] border border-violet/35 fade-in-up"
        style={{
          background:
            'linear-gradient(120deg, rgba(167,139,250,0.22) 0%, rgba(240,171,252,0.18) 50%, rgba(200,255,0,0.10) 100%), linear-gradient(180deg, #15151a, #08080a)',
        }}
      >
        {/* Pulsos */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(55% 90% at 100% 50%, rgba(167,139,250,0.40), transparent 58%)',
            animation: 'promo-pulse-a 6.5s ease-in-out infinite',
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(55% 90% at 0% 50%, rgba(200,255,0,0.22), transparent 58%)',
            animation: 'promo-pulse-b 7.5s ease-in-out infinite',
          }}
        />
        {/* Grid */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              'linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)',
            backgroundSize: '46px 46px',
          }}
        />
        <SparkleFloat className="absolute top-10 left-[30%]" delay={0} />
        <SparkleFloat className="absolute top-[55%] left-[20%]" delay={900} />
        <SparkleFloat className="absolute top-[28%] left-[10%]" delay={1800} />
        <SparkleFloat className="absolute bottom-12 right-[18%]" delay={2400} />

        {/* Mockup grid de B-rolls à esquerda */}
        <div
          aria-hidden
          className="pointer-events-none absolute left-3 top-1/2 hidden -translate-y-1/2 lg:block"
        >
          <BrollShowcaseGrid />
        </div>

        {/* Conteúdo direita */}
        <div className="relative flex flex-col items-end gap-7 px-7 py-14 text-right md:px-14 md:py-24">
          <div
            className="flex items-baseline gap-3 text-white/35"
            style={{ fontFamily: 'var(--font-mono)' }}
          >
            <span
              className="text-[10.5px] uppercase tracking-[0.28em] text-violet"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              VÍDEOS EM ESCALA
            </span>
            <span className="h-px w-10 bg-white/25" />
            <span className="text-[10.5px] tracking-[0.32em]">002</span>
          </div>

          <h2
            className="max-w-[820px] text-[36px] font-extrabold leading-[1] tracking-tight text-white md:text-[64px]"
            style={{ fontFamily: 'var(--font-tech)', letterSpacing: '-0.03em' }}
          >
            <SmokeText text="Sua lista de prompts." className="block" />
            <span
              className="block"
              style={{
                background:
                  'linear-gradient(135deg, #a78bfa 0%, #f0abfc 50%, #c8ff00 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              <SmokeText text="10 B-rolls em paralelo." />
            </span>
          </h2>

          <p className="max-w-[560px] text-[15.5px] leading-relaxed text-white/85">
            Cole o JSON. Dispare. Vá fazer outra coisa.
            <br />
            <span className="text-white/65">
              Cada take é renderizado em Kling 2.5 720p sobre frame Nano Banana 1K
              — qualidade Magnific, zero crédito.
            </span>
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-3">
            <Link
              href="/login"
              className="group/btn relative inline-flex items-center gap-2 overflow-hidden rounded-full px-7 py-3.5 text-[14px] font-bold text-white"
              style={{
                background:
                  'linear-gradient(135deg, #a78bfa 0%, #6d4ee8 60%, #4f3ddb 100%)',
                boxShadow:
                  'inset 0 1px 0 rgba(255,255,255,0.4), 0 14px 36px -10px rgba(167,139,250,0.65)',
              }}
            >
              <span className="relative z-10">Disparar B-rolls</span>
              <span className="relative z-10 transition-transform duration-300 group-hover/btn:translate-x-1">
                →
              </span>
              <span
                aria-hidden
                className="absolute inset-0 -translate-x-[120%] bg-gradient-to-r from-transparent via-white/40 to-transparent transition-transform duration-700 group-hover/btn:translate-x-[120%]"
              />
            </Link>
            <a
              href="#broll-passos"
              className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-6 py-3.5 text-[13.5px] font-bold text-white backdrop-blur-md transition-all duration-300 hover:-translate-y-[1px] hover:border-white/35 hover:bg-white/10"
            >
              Ver como funciona
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

/** CINEMATIC B-roll generation showcase — grid with real visual storytelling */
function BrollShowcaseGrid() {
  // 6 cards in a 3x2 layout (larger than before). Different states cycle:
  // ready (with scene gradient + play overlay), rendering (color sweep
  // + bunny pulse), composing (image stage with scanner line).
  const states: Array<'ready' | 'rendering' | 'composing'> = [
    'ready',
    'rendering',
    'ready',
    'composing',
    'ready',
    'rendering',
  ];
  const scenePalettes = [
    ['#c8ff00', '#a78bfa', '#0a0a0c'],  // 01 lime → violet
    ['#67e8f9', '#a78bfa', '#0a0a0c'],  // 02 cyan → violet
    ['#f0abfc', '#c8ff00', '#0a0a0c'],  // 03 pink → lime
    ['#a78bfa', '#6d4ee8', '#0a0a0c'],  // 04 violet
    ['#fbbf24', '#a78bfa', '#0a0a0c'],  // 05 amber → violet
    ['#a3e635', '#67e8f9', '#0a0a0c'],  // 06 lime → cyan
  ];

  return (
    <div
      className="relative grid grid-cols-3 gap-3"
      style={{
        width: 420,
        perspective: '1200px',
      }}
    >
      {states.map((state, i) => {
        const [c1, c2, c3] = scenePalettes[i];
        const isReady = state === 'ready';
        const isRendering = state === 'rendering';
        const tilt = i % 2 === 0 ? 'rotateY(-6deg)' : 'rotateY(6deg)';
        return (
          <div
            key={i}
            className="cinemaCard relative overflow-hidden rounded-[12px] border"
            style={{
              aspectRatio: '9/16',
              transform: tilt,
              transformStyle: 'preserve-3d',
              borderColor: isReady
                ? 'rgba(200,255,0,0.55)'
                : 'rgba(167,139,250,0.5)',
              background: `linear-gradient(135deg, ${c1}20 0%, ${c2}25 50%, ${c3} 100%)`,
              boxShadow: isReady
                ? `0 10px 30px -8px ${c1}66, 0 0 40px -10px ${c1}55, inset 0 1px 0 rgba(255,255,255,0.08)`
                : `0 10px 30px -10px ${c2}55, inset 0 1px 0 rgba(255,255,255,0.05)`,
              animation: `cardEntrance 0.8s ease-out ${i * 0.14}s backwards`,
            }}
          >
            {/* ── Background scene (animated gradient mesh per card) ── */}
            <div
              aria-hidden
              className="absolute inset-0 opacity-90"
              style={{
                background: `radial-gradient(60% 60% at ${30 + i * 7}% ${20 + i * 8}%, ${c1}99, transparent 60%), radial-gradient(50% 50% at ${70 - i * 5}% ${80 - i * 6}%, ${c2}88, transparent 65%)`,
                animation: `meshDrift 8s ease-in-out ${i * 0.5}s infinite alternate`,
                mixBlendMode: 'screen',
              }}
            />

            {/* Film grain overlay */}
            <div
              aria-hidden
              className="absolute inset-0 opacity-25"
              style={{
                backgroundImage:
                  'url("data:image/svg+xml;utf8,<svg xmlns=\\"http://www.w3.org/2000/svg\\" width=\\"60\\" height=\\"60\\"><filter id=\\"n\\"><feTurbulence type=\\"fractalNoise\\" baseFrequency=\\"0.9\\"/></filter><rect width=\\"60\\" height=\\"60\\" filter=\\"url(%23n)\\" opacity=\\"0.5\\"/></svg>")',
                mixBlendMode: 'overlay',
              }}
            />

            {/* ── Rendering: vertical scanner line + color sweep ── */}
            {isRendering && (
              <>
                <div
                  aria-hidden
                  className="absolute inset-0"
                  style={{
                    background: `linear-gradient(180deg, transparent 0%, ${c1}66 50%, transparent 100%)`,
                    transform: 'translateY(-100%)',
                    animation: `scanLine 2.4s ease-in-out ${i * 0.2}s infinite`,
                    filter: 'blur(2px)',
                  }}
                />
                {/* Color burst from center */}
                <div
                  aria-hidden
                  className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
                  style={{
                    width: 80,
                    height: 80,
                    background: `radial-gradient(circle, ${c1}88, transparent 70%)`,
                    filter: 'blur(20px)',
                    animation: `burstPulse 3s ease-in-out ${i * 0.3}s infinite`,
                  }}
                />
              </>
            )}

            {/* ── Composing: pixel grid build-up effect ── */}
            {state === 'composing' && (
              <div
                aria-hidden
                className="absolute inset-0 opacity-60"
                style={{
                  backgroundImage:
                    'linear-gradient(to right, rgba(167,139,250,0.4) 1px, transparent 1px), linear-gradient(to bottom, rgba(167,139,250,0.4) 1px, transparent 1px)',
                  backgroundSize: '8px 8px',
                  animation: 'pixelBuild 4s linear infinite',
                }}
              />
            )}

            {/* Glow halo for ready */}
            {isReady && (
              <div
                aria-hidden
                className="absolute inset-0"
                style={{
                  background: `radial-gradient(circle at 50% 60%, ${c1}33, transparent 60%)`,
                  animation: `readyGlow 3s ease-in-out infinite`,
                }}
              />
            )}

            {/* ── Top label ── */}
            <div
              className="absolute left-1.5 top-1.5 z-10 flex items-center gap-1 rounded bg-black/65 px-1.5 py-0.5 backdrop-blur-sm"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              <span
                className="text-[8px] font-bold uppercase tracking-widest"
                style={{ color: isReady ? '#c8ff00' : '#a78bfa' }}
              >
                TAKE
              </span>
              <span className="text-[8px] font-black text-white">
                {String(i + 1).padStart(2, '0')}
              </span>
            </div>

            {/* ── Status pill top-right ── */}
            <div
              className="absolute right-1.5 top-1.5 z-10 rounded-full bg-black/65 px-1.5 py-0.5 backdrop-blur-sm"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              {isReady ? (
                <span className="flex items-center gap-1 text-[7.5px] font-bold uppercase tracking-widest text-lime">
                  <svg width="6" height="6" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="12" cy="12" r="6" />
                  </svg>
                  PRONTO
                </span>
              ) : (
                <span className="flex items-center gap-1 text-[7.5px] font-bold uppercase tracking-widest text-violet">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet opacity-70" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-violet" />
                  </span>
                  {state === 'composing' ? 'FRAME' : 'VIDEO'}
                </span>
              )}
            </div>

            {/* ── Centerpiece ── */}
            <div className="absolute inset-0 z-[5] flex items-center justify-center">
              {isReady ? (
                /* Play icon big */
                <div
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-black/40 backdrop-blur-md transition-transform"
                  style={{
                    boxShadow: `0 0 20px ${c1}88, inset 0 0 0 1px ${c1}99`,
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="white">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </div>
              ) : (
                /* Bunny dot/icon with aura */
                <div className="relative flex items-center justify-center">
                  <div
                    aria-hidden
                    className="absolute h-16 w-16 rounded-full"
                    style={{
                      background: `radial-gradient(circle, ${c1}aa, transparent 60%)`,
                      filter: 'blur(8px)',
                      animation: `bunnyAura 2s ease-in-out infinite`,
                    }}
                  />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="/auto-edit-logo@64.png"
                    alt=""
                    width={28}
                    height={28}
                    className="relative z-10 drop-shadow-[0_0_12px_rgba(167,139,250,0.9)]"
                    style={{
                      animation: 'bunnyMini 1.4s ease-in-out infinite',
                    }}
                  />
                </div>
              )}
            </div>

            {/* ── Bottom bar: progress (loading) ou MB (ready) ── */}
            {isReady ? (
              <div className="absolute bottom-0 left-0 right-0 px-1.5 pb-1">
                <div
                  className="flex items-center justify-between text-[7px] font-bold uppercase tracking-widest"
                  style={{ fontFamily: 'var(--font-tech)' }}
                >
                  <span className="text-white/80">10s · 720p</span>
                  <span className="text-lime">5.2 MB</span>
                </div>
              </div>
            ) : (
              <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/40">
                <div
                  className="h-full"
                  style={{
                    background: `linear-gradient(90deg, ${c1}, ${c2})`,
                    animation: `progressFill 3.5s ease-in-out ${i * 0.3}s infinite`,
                    boxShadow: `0 0 8px ${c1}99`,
                  }}
                />
              </div>
            )}

            {/* Subtle border glow ring */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 rounded-[12px]"
              style={{
                boxShadow: isReady
                  ? `inset 0 0 0 1px ${c1}44`
                  : `inset 0 0 0 1px ${c1}33`,
              }}
            />
          </div>
        );
      })}

      {/* Floating particles between cards */}
      {Array.from({ length: 12 }).map((_, i) => (
        <span
          key={`p${i}`}
          aria-hidden
          className="pointer-events-none absolute h-1 w-1 rounded-full"
          style={{
            left: `${10 + (i * 23) % 80}%`,
            top: `${(i * 17) % 100}%`,
            background: i % 2 ? '#c8ff00' : '#a78bfa',
            boxShadow: `0 0 8px ${i % 2 ? '#c8ff00' : '#a78bfa'}cc`,
            animation: `floatParticle ${4 + (i % 3)}s ease-in-out ${i * 0.4}s infinite`,
            opacity: 0.6,
          }}
        />
      ))}

      <style jsx>{`
        .cinemaCard {
          will-change: transform;
        }
        @keyframes cardEntrance {
          from {
            opacity: 0;
            transform: scale(0.85) translateY(20px) rotateY(var(--rY, 0));
          }
          to {
            opacity: 1;
          }
        }
        @keyframes meshDrift {
          0% { transform: translate(0, 0); }
          50% { transform: translate(6px, -8px); }
          100% { transform: translate(-4px, 6px); }
        }
        @keyframes scanLine {
          0% { transform: translateY(-100%); opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { transform: translateY(200%); opacity: 0; }
        }
        @keyframes burstPulse {
          0%, 100% { opacity: 0.5; transform: translate(-50%, -50%) scale(0.8); }
          50% { opacity: 1; transform: translate(-50%, -50%) scale(1.3); }
        }
        @keyframes pixelBuild {
          0% { opacity: 0.2; transform: scale(1); }
          50% { opacity: 0.7; transform: scale(1.02); }
          100% { opacity: 0.2; transform: scale(1); }
        }
        @keyframes readyGlow {
          0%, 100% { opacity: 0.7; }
          50% { opacity: 1; }
        }
        @keyframes bunnyAura {
          0%, 100% { transform: scale(0.85); opacity: 0.7; }
          50% { transform: scale(1.15); opacity: 1; }
        }
        @keyframes bunnyMini {
          0%, 100% { transform: translateY(0) rotate(-3deg) scale(1); }
          50% { transform: translateY(-4px) rotate(3deg) scale(1.08); }
        }
        @keyframes progressFill {
          0% { width: 8%; }
          70% { width: 88%; }
          100% { width: 96%; }
        }
        @keyframes floatParticle {
          0%, 100% { transform: translate(0, 0); opacity: 0.3; }
          50% { transform: translate(8px, -14px); opacity: 0.9; }
        }
      `}</style>
    </div>
  );
}

/**
 * Mockup HUD do Pilot — placa "Em execução" + linha de progresso + cards
 * com avatares simulados subindo na fila. Decorativo, mostra que tem fluxo.
 */
function PilotMockup() {
  return (
    <div
      className="relative w-[320px] xl:w-[380px]"
      style={{
        filter:
          'drop-shadow(0 30px 60px rgba(0,0,0,0.55)) drop-shadow(0 0 40px rgba(167,139,250,0.4))',
      }}
    >
      {/* Janela principal */}
      <div
        className="relative overflow-hidden rounded-[18px] border border-white/12 bg-black/55 backdrop-blur-xl"
        style={{
          animation: 'pilot-window-float 6.5s ease-in-out infinite',
        }}
      >
        {/* Top bar fake */}
        <div className="flex items-center gap-1.5 border-b border-white/8 px-3.5 py-2.5">
          <span className="h-2 w-2 rounded-full bg-red-400/70" />
          <span className="h-2 w-2 rounded-full bg-amber-400/70" />
          <span className="h-2 w-2 rounded-full bg-emerald-400/70" />
          <span
            className="ml-2 text-[9.5px] font-bold uppercase tracking-[0.18em] text-lime"
            style={{ fontFamily: 'var(--font-tech)' }}
          >
            · Pilot · em execução
          </span>
        </div>

        {/* Linha de progresso */}
        <div className="px-4 pt-4">
          <div className="flex items-center justify-between">
            <span
              className="text-[10px] uppercase tracking-[0.18em] text-white/55"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              Fila do dia
            </span>
            <span
              className="text-[11px] text-lime"
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              12 / 18
            </span>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full"
              style={{
                width: '66%',
                background: 'linear-gradient(90deg, #c8ff00, #a78bfa, #67e8f9)',
                boxShadow: '0 0 12px rgba(200,255,0,0.6)',
                animation: 'pilot-bar-glow 2.4s ease-in-out infinite',
              }}
            />
          </div>
        </div>

        {/* Lista de tasks fake */}
        <div className="space-y-2 px-4 py-4">
          {[
            { name: 'Lipsync · ADS04', state: 'done' },
            { name: 'Lipsync · ADS05', state: 'done' },
            { name: 'Lipsync · ADS06', state: 'running' },
            { name: 'Lipsync · ADS07', state: 'queued' },
            { name: 'Lipsync · ADS08', state: 'queued' },
          ].map((t, i) => (
            <div
              key={i}
              className="flex items-center justify-between rounded-[10px] border border-white/8 bg-white/[0.03] px-3 py-2"
            >
              <div className="flex items-center gap-2.5">
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{
                    background:
                      t.state === 'done'
                        ? '#c8ff00'
                        : t.state === 'running'
                          ? '#a78bfa'
                          : '#3a3a44',
                    boxShadow:
                      t.state !== 'queued'
                        ? `0 0 8px ${t.state === 'done' ? '#c8ff00' : '#a78bfa'}`
                        : 'none',
                    animation:
                      t.state === 'running'
                        ? 'pilot-pulse 1.2s ease-in-out infinite'
                        : undefined,
                  }}
                />
                <span className="text-[11.5px] font-medium text-white/90">
                  {t.name}
                </span>
              </div>
              <span
                className="text-[9px] font-bold uppercase tracking-[0.14em]"
                style={{
                  fontFamily: 'var(--font-tech)',
                  color:
                    t.state === 'done'
                      ? '#c8ff00'
                      : t.state === 'running'
                        ? '#c084fc'
                        : '#5a5a64',
                }}
              >
                {t.state === 'done'
                  ? 'pronto'
                  : t.state === 'running'
                    ? 'rodando'
                    : 'fila'}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Card flutuante secundário */}
      <div
        className="absolute -bottom-6 -left-6 rounded-[12px] border border-white/12 bg-black/65 px-3 py-2 backdrop-blur-xl"
        style={{
          animation: 'pilot-card-bob 7s ease-in-out infinite',
          boxShadow: '0 16px 32px -10px rgba(0,0,0,0.6)',
        }}
      >
        <div
          className="text-[9px] font-bold uppercase tracking-[0.2em] text-lime"
          style={{ fontFamily: 'var(--font-tech)' }}
        >
          ÚLTIMO DISPARO
        </div>
        <div
          className="mt-0.5 text-[11px] text-white/85"
          style={{ fontFamily: 'var(--font-mono)' }}
        >
          AD15VN_PRPB06.mp4
        </div>
      </div>

      <style jsx>{`
        @keyframes pilot-window-float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-10px); }
        }
        @keyframes pilot-card-bob {
          0%, 100% { transform: translate(0, 0); }
          50% { transform: translate(-4px, 8px); }
        }
        @keyframes pilot-bar-glow {
          0%, 100% { box-shadow: 0 0 12px rgba(200,255,0,0.5); }
          50% { box-shadow: 0 0 22px rgba(167,139,250,0.7); }
        }
        @keyframes pilot-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}

/* ────────────────────── PILOT — COMO FUNCIONA ────────────────────── */

export function PilotHowItWorks() {
  const steps = [
    {
      n: '01',
      title: 'Conecta seu ClickUp',
      desc:
        'Em meio minuto você vincula sua workspace ao Auto Edit. Tudo continua na sua conta — o Pilot só lê o que precisa.',
      tint: 'rgba(200,255,0,0.45)',
    },
    {
      n: '02',
      title: 'Puxa as tasks do dia',
      desc:
        'Escolhe a data, o Pilot lista todas as tasks daquele dia. Cada uma já vem com a copy do briefing carregada.',
      tint: 'rgba(167,139,250,0.5)',
    },
    {
      n: '03',
      title: 'Revisa task por task',
      desc:
        'Preview limpo de cada uma: roteiro + avatar identificado pelo link na copy. Se o avatar já tá na sua biblioteca do HeyGen, o Pilot usa direto.',
      tint: 'rgba(244,114,182,0.45)',
    },
    {
      n: '04',
      title: 'Confirma e desliga o monitor',
      desc:
        'O Pilot dispara os lipsyncs no HeyGen, parte por parte. Quando você volta, tá tudo montado, pronto pra ir pra edição final.',
      tint: 'rgba(103,232,249,0.5)',
    },
  ];

  return (
    <section
      id="pilot-passos"
      className="mx-auto mt-32 max-w-[1200px] px-5 md:px-8"
    >
      {/* Cabeçalho */}
      <div className="mb-12 max-w-[780px] fade-in-up">
        <div
          className="mb-3 inline-flex items-baseline gap-3 text-white/35"
          style={{ fontFamily: 'var(--font-mono)' }}
        >
          <span className="text-[10.5px] tracking-[0.32em]">002</span>
          <span className="h-px w-10 bg-white/25" />
          <span
            className="text-[10.5px] uppercase tracking-[0.28em] text-violet"
            style={{ fontFamily: 'var(--font-tech)' }}
          >
            COMO FUNCIONA
          </span>
        </div>
        <h2
          className="section-title text-[36px] md:text-[52px]"
          style={{ lineHeight: 1.05 }}
        >
          <SmokeText text="Em 4 passos." className="block" />
          <span className="display-subtle block">
            <SmokeText text="Sem volta pro fluxo manual." />
          </span>
        </h2>
      </div>

      {/* Grid 4 passos */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {steps.map((s, i) => (
          <div
            key={s.n}
            className="step-card group relative overflow-hidden rounded-[20px] border border-line/60 p-6 fade-in-up"
            style={{
              animationDelay: `${i * 90}ms`,
              background:
                'linear-gradient(180deg, rgba(255,255,255,0.02), rgba(0,0,0,0.20)), linear-gradient(180deg, #15151a, #0c0c10)',
            }}
          >
            <div
              aria-hidden
              className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full opacity-50 blur-3xl transition-opacity duration-500 group-hover:opacity-100"
              style={{ background: s.tint }}
            />
            <div className="relative">
              <div
                className="text-[40px] font-extrabold leading-none"
                style={{
                  fontFamily: 'var(--font-tech)',
                  letterSpacing: '-0.03em',
                  background:
                    'linear-gradient(135deg, #fff 0%, rgba(255,255,255,0.3) 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
              >
                {s.n}
              </div>
              <h3
                className="mt-4 text-[17px] font-bold leading-snug tracking-tight text-white"
                style={{ fontFamily: 'var(--font-tech)' }}
              >
                {s.title}
              </h3>
              <p className="mt-2 text-[13.5px] leading-relaxed text-text-muted">
                {s.desc}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Briefing — card de atenção */}
      <div
        className="mt-10 overflow-hidden rounded-[22px] border border-violet/35 fade-in-up"
        style={{
          animationDelay: '380ms',
          background:
            'linear-gradient(135deg, rgba(167,139,250,0.16) 0%, rgba(103,232,249,0.10) 100%), linear-gradient(180deg, #15151a, #0c0c10)',
        }}
      >
        <div className="grid grid-cols-1 gap-8 px-7 py-8 md:grid-cols-[auto_1fr] md:px-10 md:py-10">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[18px] border border-violet/40 bg-violet/10">
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#c084fc"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
              <path d="M14 2v6h6" />
              <path d="M9 13h6M9 17h4" />
            </svg>
          </div>
          <div>
            <div
              className="mb-2 inline-flex items-center gap-2 rounded-full border border-violet/50 bg-black/40 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-violet backdrop-blur-md"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              <span className="inline-block h-1.5 w-1.5 animate-pulse-soft rounded-full bg-violet shadow-[0_0_8px_rgba(167,139,250,0.85)]" />
              ATENÇÃO · BRIEFING
            </div>
            <h3
              className="text-[22px] font-extrabold leading-tight tracking-tight text-white md:text-[26px]"
              style={{ fontFamily: 'var(--font-tech)', letterSpacing: '-0.02em' }}
            >
              <SmokeText text="O briefing precisa estar no nosso formato." />
            </h3>
            <p className="mt-3 max-w-[640px] text-[14.5px] leading-relaxed text-white/85">
              Você recebe um manual simples de como estruturar a copy de cada
              task no ClickUp. O Pilot só consegue trabalhar com 100% de
              assertividade quando o briefing segue esse padrão.
              <br />
              <span className="text-white/65">
                Menos revisão. Menos retrabalho. Mais entrega.
              </span>
            </p>
          </div>
        </div>
      </div>

      {/* Pra quem é */}
      <div className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div
          className="audience-card group relative overflow-hidden rounded-[22px] border border-lime/30 p-7 fade-in-up md:p-9"
          style={{
            animationDelay: '480ms',
            background:
              'linear-gradient(135deg, rgba(200,255,0,0.10), rgba(0,0,0,0.18)), linear-gradient(180deg, #15151a, #0c0c10)',
          }}
        >
          <div
            aria-hidden
            className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full opacity-50 blur-3xl transition-opacity duration-500 group-hover:opacity-90"
            style={{ background: 'rgba(200,255,0,0.45)' }}
          />
          <div className="relative">
            <div
              className="mb-3 text-[10.5px] font-bold uppercase tracking-[0.22em] text-lime"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              SE VOCÊ É DONO DA OPERAÇÃO
            </div>
            <h3
              className="text-[26px] font-extrabold leading-tight tracking-tight text-white md:text-[32px]"
              style={{ fontFamily: 'var(--font-tech)', letterSpacing: '-0.02em' }}
            >
              <SmokeText text="Você virou o editor." className="block" />
              <span className="block text-lime">
                <SmokeText text="Sem editar nada." />
              </span>
            </h3>
            <p className="mt-3 text-[14px] leading-relaxed text-white/80">
              Valida formato full UGC todo dia? Liga o Pilot e ele monta o dia
              inteiro pra você. Você só aprova.
            </p>
          </div>
        </div>

        <div
          className="audience-card group relative overflow-hidden rounded-[22px] border border-violet/35 p-7 fade-in-up md:p-9"
          style={{
            animationDelay: '560ms',
            background:
              'linear-gradient(135deg, rgba(167,139,250,0.14), rgba(0,0,0,0.18)), linear-gradient(180deg, #15151a, #0c0c10)',
          }}
        >
          <div
            aria-hidden
            className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full opacity-50 blur-3xl transition-opacity duration-500 group-hover:opacity-90"
            style={{ background: 'rgba(167,139,250,0.5)' }}
          />
          <div className="relative">
            <div
              className="mb-3 text-[10.5px] font-bold uppercase tracking-[0.22em] text-violet"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              SE VOCÊ TEM EDITOR
            </div>
            <h3
              className="text-[26px] font-extrabold leading-tight tracking-tight text-white md:text-[32px]"
              style={{ fontFamily: 'var(--font-tech)', letterSpacing: '-0.02em' }}
            >
              <SmokeText text="Ele entrega 5× mais." className="block" />
              <span className="block text-violet">
                <SmokeText text="Sem suar." />
              </span>
            </h3>
            <p className="mt-3 text-[14px] leading-relaxed text-white/80">
              O Pilot tira o trabalho repetitivo da frente dele. Sobra tempo
              pra criatividade, pra polish, pra entregar mais. Sua operação
              dobra de tamanho com a mesma equipe.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ────────────── AUTO B-ROLL · HOW IT WORKS ────────────── */
export function AutoBrollHowItWorks() {
  const steps = [
    {
      n: '01',
      title: 'Cola sua lista de prompts',
      desc:
        'JSON do Claude ou texto numerado — qualquer formato funciona. O parser entende ambos e já mostra quantos takes vai gerar.',
      tint: 'rgba(167,139,250,0.5)',
    },
    {
      n: '02',
      title: 'Aperta o play',
      desc:
        '12 imagens e 6 vídeos em paralelo. Nano Banana compõe o frame inicial, Kling 2.5 renderiza o movimento. Tudo na sua conta Magnific Unlimited.',
      tint: 'rgba(200,255,0,0.45)',
    },
    {
      n: '03',
      title: 'Acompanha em tempo real',
      desc:
        'Cada take vira um card 9:16 ao vivo: vê o vídeo nascer, expande pra tela cheia, baixa o MP4 individual antes mesmo dos outros terminarem.',
      tint: 'rgba(240,171,252,0.45)',
    },
    {
      n: '04',
      title: 'Pega o ZIP organizado',
      desc:
        'Quando o último take termina, sai um ZIP nomeado com todos os MP4s prontos pra timeline. Sem renomear, sem organizar.',
      tint: 'rgba(103,232,249,0.5)',
    },
  ];

  return (
    <section
      id="broll-passos"
      className="mx-auto mt-32 max-w-[1200px] px-5 md:px-8"
    >
      {/* Cabeçalho */}
      <div className="mb-12 max-w-[780px] fade-in-up">
        <div
          className="mb-3 inline-flex items-baseline gap-3 text-white/35"
          style={{ fontFamily: 'var(--font-mono)' }}
        >
          <span className="text-[10.5px] tracking-[0.32em]">004</span>
          <span className="h-px w-10 bg-white/25" />
          <span
            className="text-[10.5px] uppercase tracking-[0.28em] text-violet"
            style={{ fontFamily: 'var(--font-tech)' }}
          >
            COMO O AUTO B-ROLL FUNCIONA
          </span>
        </div>
        <h2
          className="section-title text-[36px] md:text-[52px]"
          style={{ lineHeight: 1.05 }}
        >
          <SmokeText text="4 passos." className="block" />
          <span className="display-subtle block">
            <SmokeText text="Do JSON à pasta pronta." />
          </span>
        </h2>
      </div>

      {/* Grid 4 passos */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {steps.map((s, i) => (
          <div
            key={s.n}
            className="step-card group relative overflow-hidden rounded-[20px] border border-line/60 p-6 fade-in-up"
            style={{
              animationDelay: `${i * 90}ms`,
              background:
                'linear-gradient(180deg, rgba(255,255,255,0.02), rgba(0,0,0,0.20)), linear-gradient(180deg, #15151a, #0c0c10)',
            }}
          >
            <div
              aria-hidden
              className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full opacity-50 blur-3xl transition-opacity duration-500 group-hover:opacity-100"
              style={{ background: s.tint }}
            />
            <div className="relative">
              <div
                className="text-[40px] font-extrabold leading-none"
                style={{
                  fontFamily: 'var(--font-tech)',
                  letterSpacing: '-0.03em',
                  background:
                    'linear-gradient(135deg, #fff 0%, rgba(255,255,255,0.3) 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
              >
                {s.n}
              </div>
              <h3
                className="mt-4 text-[17px] font-bold leading-snug tracking-tight text-white"
                style={{ fontFamily: 'var(--font-tech)' }}
              >
                {s.title}
              </h3>
              <p className="mt-2 text-[13.5px] leading-relaxed text-text-muted">
                {s.desc}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* REQUISITO — Freepik Premium+ */}
      <div
        className="mt-10 overflow-hidden rounded-[22px] border border-amber-400/40 fade-in-up"
        style={{
          animationDelay: '380ms',
          background:
            'linear-gradient(135deg, rgba(251,191,36,0.10) 0%, rgba(167,139,250,0.08) 100%), linear-gradient(180deg, #15151a, #0c0c10)',
        }}
      >
        <div className="grid grid-cols-1 gap-8 px-7 py-8 md:grid-cols-[auto_1fr] md:px-10 md:py-10">
          <div
            className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[18px] border border-amber-400/50 bg-amber-400/10"
            style={{ boxShadow: '0 0 30px -8px rgba(251,191,36,0.4)' }}
          >
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#fbbf24"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 2L9 9H2l5.5 4-2 7L12 16l6.5 4-2-7L22 9h-7z" />
            </svg>
          </div>
          <div>
            <div
              className="mb-2 inline-flex items-center gap-2 rounded-full border border-amber-400/55 bg-black/40 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-amber-300 backdrop-blur-md"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              <span className="inline-block h-1.5 w-1.5 animate-pulse-soft rounded-full bg-amber-300 shadow-[0_0_8px_rgba(251,191,36,0.85)]" />
              PRÉ-REQUISITO
            </div>
            <h3
              className="text-[22px] font-extrabold leading-tight tracking-tight text-white md:text-[26px]"
              style={{ fontFamily: 'var(--font-tech)', letterSpacing: '-0.02em' }}
            >
              <SmokeText text="Precisa de Freepik Premium+ ativa." />
            </h3>
            <p className="mt-3 max-w-[640px] text-[14.5px] leading-relaxed text-white/85">
              O Auto B-roll usa o <strong className="text-white">seu</strong>{' '}
              acesso ao Magnific (Freepik Premium+). Cada take roda na sua
              conta, no modo Unlimited — você não paga crédito nenhum por
              vídeo, só a mensalidade do Freepik.
              <br />
              <span className="text-white/65">
                Sem Premium+ ativa não tem como gerar. É a única dependência
                externa da ferramenta.
              </span>
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <a
                href="https://www.freepik.com/pricing"
                target="_blank"
                rel="noopener noreferrer"
                className="mono inline-flex items-center gap-1.5 rounded-full border border-amber-400/50 bg-amber-400/10 px-3 py-1.5 text-[10.5px] font-bold uppercase tracking-widest text-amber-300 transition-all hover:bg-amber-400/20 hover:-translate-y-px"
                style={{ fontFamily: 'var(--font-tech)' }}
              >
                Ver planos Freepik
                <span>↗</span>
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* QUALIDADE + ZERO CRÉDITO callout */}
      <div
        className="mt-6 overflow-hidden rounded-[22px] border border-lime/35 fade-in-up"
        style={{
          animationDelay: '440ms',
          background:
            'linear-gradient(135deg, rgba(200,255,0,0.10) 0%, rgba(167,139,250,0.10) 100%), linear-gradient(180deg, #15151a, #0c0c10)',
        }}
      >
        <div className="grid grid-cols-1 gap-8 px-7 py-8 md:grid-cols-[auto_1fr] md:px-10 md:py-10">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[18px] border border-lime/40 bg-lime/10">
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#c8ff00"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
          </div>
          <div>
            <div
              className="mb-2 inline-flex items-center gap-2 rounded-full border border-lime/50 bg-black/40 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-lime backdrop-blur-md"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              <span className="inline-block h-1.5 w-1.5 animate-pulse-soft rounded-full bg-lime shadow-[0_0_8px_rgba(200,255,0,0.85)]" />
              FLUXO RÁPIDO · ZERO CRÉDITO
            </div>
            <h3
              className="text-[22px] font-extrabold leading-tight tracking-tight text-white md:text-[26px]"
              style={{ fontFamily: 'var(--font-tech)', letterSpacing: '-0.02em' }}
            >
              <SmokeText text="Cola, dispara, vai fazer outra coisa." />
            </h3>
            <p className="mt-3 max-w-[640px] text-[14.5px] leading-relaxed text-white/85">
              12 imagens e 6 vídeos em paralelo, qualidade Magnific travada
              em Nano Banana 1K + Kling 2.5 720p · 10s · 9:16. Sem
              configuração, sem janela aberta no Magnific, sem clicar
              &ldquo;Generate&rdquo; um por um.
              <br />
              <span className="text-white/65">
                Acabou o lote? O ZIP cai pronto, nomeado, pronto pra
                timeline.
              </span>
            </p>
          </div>
        </div>
      </div>

      {/* Pra quem é */}
      <div className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div
          className="audience-card group relative overflow-hidden rounded-[22px] border border-violet/35 p-7 fade-in-up md:p-9"
          style={{
            animationDelay: '480ms',
            background:
              'linear-gradient(135deg, rgba(167,139,250,0.14), rgba(0,0,0,0.18)), linear-gradient(180deg, #15151a, #0c0c10)',
          }}
        >
          <div
            aria-hidden
            className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full opacity-50 blur-3xl transition-opacity duration-500 group-hover:opacity-90"
            style={{ background: 'rgba(167,139,250,0.5)' }}
          />
          <div className="relative">
            <div
              className="mb-3 text-[10.5px] font-bold uppercase tracking-[0.22em] text-violet"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              SE VOCÊ EDITA UGC EM ESCALA
            </div>
            <h3
              className="text-[26px] font-extrabold leading-tight tracking-tight text-white md:text-[32px]"
              style={{ fontFamily: 'var(--font-tech)', letterSpacing: '-0.02em' }}
            >
              <SmokeText text="50 B-rolls num dia." className="block" />
              <span className="block text-violet">
                <SmokeText text="Sem abrir Magnific." />
              </span>
            </h3>
            <p className="mt-3 text-[14px] leading-relaxed text-white/80">
              Cola a lista de cada ad e dispara em lote. Vai almoçar e volta
              com a pasta pronta. Nunca mais clica em &ldquo;Generate&rdquo; um por um.
            </p>
          </div>
        </div>

        <div
          className="audience-card group relative overflow-hidden rounded-[22px] border border-lime/30 p-7 fade-in-up md:p-9"
          style={{
            animationDelay: '560ms',
            background:
              'linear-gradient(135deg, rgba(200,255,0,0.10), rgba(0,0,0,0.18)), linear-gradient(180deg, #15151a, #0c0c10)',
          }}
        >
          <div
            aria-hidden
            className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full opacity-50 blur-3xl transition-opacity duration-500 group-hover:opacity-90"
            style={{ background: 'rgba(200,255,0,0.45)' }}
          />
          <div className="relative">
            <div
              className="mb-3 text-[10.5px] font-bold uppercase tracking-[0.22em] text-lime"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              SE VOCÊ É AGÊNCIA / ESCRITÓRIO
            </div>
            <h3
              className="text-[26px] font-extrabold leading-tight tracking-tight text-white md:text-[32px]"
              style={{ fontFamily: 'var(--font-tech)', letterSpacing: '-0.02em' }}
            >
              <SmokeText text="Cliente recebe a pasta." className="block" />
              <span className="block text-lime">
                <SmokeText text="Você nem tocou no Magnific." />
              </span>
            </h3>
            <p className="mt-3 text-[14px] leading-relaxed text-white/80">
              Equipe pequena entregando como agência grande. Cada conta usa
              seu próprio Freepik — escala sem comprometer qualidade nem custo.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function SparkleFloat({ className, delay = 0 }: { className?: string; delay?: number }) {
  return (
    <span
      aria-hidden
      className={'pointer-events-none ' + (className || '')}
      style={{ animation: `sparkle-twinkle 2.6s ease-in-out infinite`, animationDelay: `${delay}ms` }}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M7 0l1.2 4.8L13 6l-4.8 1.2L7 12l-1.2-4.8L0 6l4.8-1.2L7 0z" fill="#fff" opacity="0.9" />
      </svg>
      <style jsx>{`
        @keyframes sparkle-twinkle {
          0%, 100% { opacity: 0; transform: scale(0.6) rotate(0); }
          40% { opacity: 1; transform: scale(1) rotate(90deg); }
          60% { opacity: 1; transform: scale(1) rotate(120deg); }
        }
      `}</style>
    </span>
  );
}

/* ────────────────────── CAPACIDADES ────────────────────── */

function CapabilitiesSection() {
  const items = [
    {
      icon: <IconAutoBroll size={32} />,
      hue: 'rgba(240,171,252,0.55)',
      title: 'Disparar B-roll do dia inteiro',
      desc: 'Cola o JSON, liga a fila, faz outra coisa. Volta com a pasta cheia de cortes.',
    },
    {
      icon: <IconTrocaProduto size={32} />,
      hue: 'rgba(244,114,182,0.5)',
      title: 'Trocar produto sem regravar',
      desc: 'Mudou a marca? Substitui no áudio em segundos. A voz original continua intacta.',
    },
    {
      icon: <IconHeyGenAuto size={32} />,
      hue: 'rgba(103,232,249,0.5)',
      title: 'Lipsync do dia em 1 clique',
      desc: 'Dispara todos os avatares de uma vez. Vá dormir e acorde com os vídeos prontos.',
    },
    {
      icon: <IconRemoverElementos size={32} />,
      hue: 'rgba(167,139,250,0.5)',
      title: 'Remover legenda em massa',
      desc: 'Passa o batch, a IA limpa todas. Marca d’água, legenda gravada — tudo no lixo.',
    },
    {
      icon: <IconDecupagem size={32} />,
      hue: 'rgba(163,230,53,0.45)',
      title: 'Decupagem instantânea',
      desc: 'Silêncios somem sozinhos. O que demorava 1 hora vira 30 segundos.',
    },
    {
      icon: <IconClickUpPilot size={32} />,
      hue: 'rgba(200,255,0,0.5)',
      title: 'Pipeline ClickUp → entrega',
      desc: 'O Pilot puxa o briefing, identifica o avatar, dispara o lipsync. Sem clique manual.',
    },
  ];

  return (
    <section id="capacidades" className="mx-auto mt-32 max-w-[1200px] px-5 md:px-8">
      <div className="mb-12 max-w-[720px] fade-in-up">
        <div
          className="mb-3 text-[10.5px] font-semibold uppercase tracking-[0.22em] text-text-dim"
          style={{ fontFamily: 'var(--font-tech)' }}
        >
          O QUE AUTOMATIZA
        </div>
        <h2 className="section-title text-[36px] md:text-[48px]" style={{ lineHeight: 1.05 }}>
          <SmokeText text="O fluxo todo." className="block" />
          <span className="display-subtle block">
            <SmokeText text="Sem você no monitor." />
          </span>
        </h2>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {items.map((it, i) => (
          <CapabilityCard key={i} {...it} delay={i * 70} />
        ))}
      </div>
    </section>
  );
}

function CapabilityCard({
  icon,
  hue,
  title,
  desc,
  delay,
}: {
  icon: React.ReactNode;
  hue: string;
  title: string;
  desc: string;
  delay: number;
}) {
  return (
    <div
      className="cap-card fade-in-up group relative overflow-hidden rounded-[20px] border border-line/60 p-6 transition-all duration-500 hover:-translate-y-1 hover:border-violet/40 md:p-7"
      style={{
        animationDelay: `${delay}ms`,
        background:
          'linear-gradient(180deg, rgba(255,255,255,0.025), rgba(0,0,0,0.18)), linear-gradient(180deg, #15151a, #0e0e10)',
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-12 -top-12 h-44 w-44 rounded-full opacity-50 blur-3xl transition-opacity duration-500 group-hover:opacity-90"
        style={{ background: hue }}
      />
      <div className="relative">
        <span
          className="mb-5 inline-flex h-14 w-14 items-center justify-center rounded-[16px] border border-white/10 bg-black/40 backdrop-blur-md transition-transform duration-500 group-hover:scale-110 group-hover:-rotate-6"
          style={{ boxShadow: `0 0 32px -4px ${hue}, inset 0 1px 0 rgba(255,255,255,0.12)` }}
        >
          {icon}
        </span>
        <h3
          className="text-[18px] font-bold tracking-tight text-white"
          style={{ fontFamily: 'var(--font-tech)', letterSpacing: '-0.01em' }}
        >
          {title}
        </h3>
        <p className="mt-2 text-[14px] leading-relaxed text-text-muted">
          {desc}
        </p>
      </div>
    </div>
  );
}

/* ────────────────────── SHOWCASE ────────────────────── */

function ShowcaseSection() {
  return (
    <section className="mx-auto mt-32 max-w-[1200px] px-5 md:px-8">
      <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2">
        <div className="fade-in-up">
          <div
            className="mb-3 text-[10.5px] font-semibold uppercase tracking-[0.22em] text-text-dim"
            style={{ fontFamily: 'var(--font-tech)' }}
          >
            COMO FUNCIONA
          </div>
          <h2 className="section-title text-[34px] md:text-[44px]" style={{ lineHeight: 1.08 }}>
            <SmokeText text="Liga a automação." className="block" />
            <span className="display-subtle block">
              <SmokeText text="O resto é fila." />
            </span>
          </h2>
          <p className="mt-5 max-w-[480px] text-[15px] leading-relaxed text-text-muted">
            A fila roda em segundo plano enquanto você faz outra coisa.
            <br />
            Você só volta pra revisar.
          </p>
          <ul className="mt-7 space-y-3">
            {[
              'Tudo roda no seu computador. Sem servidor remoto.',
              'Os arquivos nunca saem da sua máquina.',
              'Você usa suas próprias chaves de IA, em ambiente seguro.',
              'Sem assinatura escondida. Sem letra miúda.',
            ].map((line, i) => (
              <li
                key={i}
                className="flex items-start gap-3 fade-in-up"
                style={{ animationDelay: `${i * 80}ms` }}
              >
                <CheckMark />
                <span className="text-[14.5px] text-white">{line}</span>
              </li>
            ))}
          </ul>
          <div className="mt-8">
            <Link href="/login" className="btn-primary group">
              <span>Começar agora</span>
              <span className="transition-transform duration-300 group-hover:translate-x-1">→</span>
            </Link>
          </div>
        </div>

        <ShowcaseVisual />
      </div>
    </section>
  );
}

function CheckMark() {
  return (
    <span
      className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
      style={{
        background: 'linear-gradient(135deg, #a78bfa 0%, #6366f1 100%)',
        boxShadow: '0 0 12px -2px rgba(167,139,250,0.6)',
      }}
    >
      <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
        <path d="M2.5 6.5l2.5 2.5 5-5.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

function ShowcaseVisual() {
  return (
    <div
      className="relative h-[440px] overflow-hidden rounded-[24px] border border-line/60 fade-in-up md:h-[520px]"
      style={{
        animationDelay: '150ms',
        background:
          'linear-gradient(150deg, rgba(167,139,250,0.16), rgba(0,0,0,0)) , linear-gradient(180deg, #15151a, #0a0a0c)',
      }}
    >
      <div
        aria-hidden
        className="absolute inset-0 opacity-40"
        style={{
          background:
            'radial-gradient(40% 30% at 30% 20%, rgba(167,139,250,0.4), transparent 70%),' +
            'radial-gradient(35% 30% at 80% 80%, rgba(103,232,249,0.25), transparent 70%)',
        }}
      />

      <div className="absolute left-6 top-6 w-[58%] rounded-[14px] border border-white/10 bg-black/45 p-4 backdrop-blur-xl float-y-card">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-red-400" />
          <span className="h-2 w-2 rounded-full bg-amber-400" />
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
        </div>
        <div className="mt-3 h-2.5 w-24 rounded-full bg-violet/40" />
        <div className="mt-2 h-1.5 w-32 rounded-full bg-white/15" />
        <div className="mt-1 h-1.5 w-20 rounded-full bg-white/10" />
        <div className="mt-4 grid grid-cols-3 gap-2">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-10 rounded-md bg-white/5 border border-white/8" />
          ))}
        </div>
      </div>

      <div className="absolute bottom-8 right-6 w-[60%] rounded-[14px] border border-white/10 bg-black/55 p-4 backdrop-blur-xl float-y-card-2">
        <div
          className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-lime"
          style={{ fontFamily: 'var(--font-tech)' }}
        >
          Em execução
        </div>
        <div className="mt-3 h-1.5 w-full rounded-full bg-white/8 overflow-hidden">
          <div className="h-full w-2/3 rounded-full" style={{ background: 'linear-gradient(90deg, #c8ff00, #a78bfa)' }} />
        </div>
        <div className="mt-3 text-[12.5px] text-white/80">
          Fila do Pilot · 12 de 18 prontos
        </div>
      </div>

      <div className="absolute right-4 top-1/2 -translate-y-1/2 opacity-70 mix-blend-screen">
        <DarkoLogo size={180} />
      </div>

      <style jsx>{`
        .float-y-card { animation: fyc 6s ease-in-out infinite; }
        .float-y-card-2 { animation: fyc 7s ease-in-out infinite reverse; }
        @keyframes fyc {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-10px); }
        }
      `}</style>
    </div>
  );
}

/* ────────────────────── FINAL CTA ────────────────────── */

function FinalCTA() {
  return (
    <section className="mx-auto mt-32 max-w-[1100px] px-5 md:px-8">
      <div
        className="relative overflow-hidden rounded-[28px] border border-line/60 px-6 py-14 text-center md:px-12 md:py-20"
        style={{
          background:
            'linear-gradient(135deg, rgba(167,139,250,0.18) 0%, rgba(244,114,182,0.10) 50%, rgba(103,232,249,0.08) 100%), linear-gradient(180deg, #15151a, #0a0a0c)',
        }}
      >
        <div
          aria-hidden
          className="absolute inset-0 opacity-60"
          style={{
            background:
              'radial-gradient(45% 60% at 0% 50%, rgba(167,139,250,0.4), transparent 60%),' +
              'radial-gradient(45% 60% at 100% 50%, rgba(244,114,182,0.3), transparent 60%)',
          }}
        />

        <div className="relative">
          <h2
            className="text-[40px] font-extrabold tracking-tight text-white md:text-[56px]"
            style={{ fontFamily: 'var(--font-tech)', letterSpacing: '-0.03em', lineHeight: 1.05 }}
          >
            <SmokeText text="Pronto pra automatizar?" />
          </h2>
          <p className="mx-auto mt-4 max-w-[540px] text-[15.5px] leading-relaxed text-white/75">
            Cria a conta, liga a fila e vai viver. Resto é robô.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href="/login" className="btn-primary group text-base">
              <span>Começar grátis</span>
              <span className="transition-transform duration-300 group-hover:translate-x-1">→</span>
            </Link>
            <Link href="/planos" className="btn-silver group text-base">
              <span>Ver planos</span>
              <span className="transition-transform duration-300 group-hover:translate-x-1">→</span>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ────────────────────── FOOTER ────────────────────── */

function LandingFooter() {
  return (
    <footer className="mx-auto mt-20 max-w-[1200px] px-5 pb-12 md:px-8">
      <div className="flex flex-col items-start justify-between gap-6 border-t border-line/60 pt-8 md:flex-row md:items-center">
        <div className="flex items-center gap-3">
          <DarkoLogo size={26} />
          <span
            className="text-[13px] font-semibold tracking-[0.18em] text-white/80"
            style={{ fontFamily: 'var(--font-tech)' }}
          >
            AUTO EDIT
          </span>
        </div>
        <p className="text-[12.5px] text-text-muted">
          Auto Edit · © {new Date().getFullYear()}
        </p>
      </div>
    </footer>
  );
}
