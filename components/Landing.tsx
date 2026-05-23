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
          <Link href="/login" className="btn-ghost">
            Entrar
          </Link>
          <Link href="/login" className="btn-primary">
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

          <div
            className="mt-6 max-w-[540px] text-[16px] leading-relaxed text-text-muted fade-in-up"
            style={{ animationDelay: '500ms' }}
          >
            <SmokeText text="Ligue a automação, fache o notebook e vá viver." className="block" />
            <span className="mt-1 block">
              <SmokeText text="Acorde com B-roll, lipsync e legenda prontos." />
            </span>
          </div>

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
              <SmokeText text="Estúdios automatizados" className="font-semibold text-white" />
              <br />
              <SmokeText text="entregando 20× mais com a mesma equipe." />
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
    { value: '–95%', label: 'do tempo no trabalho repetitivo' },
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
              <SmokeText text={s.label} />
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
    <section className="mx-auto mt-32 max-w-[1200px] px-5 md:px-8">
      <div
        className="relative overflow-hidden rounded-[28px] border border-line/70 fade-in-up"
        style={{
          background:
            'linear-gradient(120deg, rgba(200,255,0,0.16) 0%, rgba(167,139,250,0.20) 50%, rgba(34,211,238,0.12) 100%), linear-gradient(180deg, #15151a, #0a0a0c)',
        }}
      >
        {/* Pulsos animados */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background: 'radial-gradient(60% 90% at 0% 50%, rgba(200,255,0,0.28), transparent 60%)',
            animation: 'promo-pulse-a 6s ease-in-out infinite',
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background: 'radial-gradient(60% 90% at 100% 50%, rgba(167,139,250,0.34), transparent 60%)',
            animation: 'promo-pulse-b 7s ease-in-out infinite',
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage: 'linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)',
            backgroundSize: '44px 44px',
          }}
        />
        <SparkleFloat className="absolute top-8 right-[28%]" delay={0} />
        <SparkleFloat className="absolute top-[60%] right-[18%]" delay={900} />
        <SparkleFloat className="absolute top-[25%] right-[8%]" delay={1800} />

        <div
          aria-hidden
          className="pointer-events-none absolute right-4 top-1/2 hidden -translate-y-1/2 lg:block"
          style={{
            filter: 'drop-shadow(0 0 38px rgba(200,255,0,0.42)) drop-shadow(0 0 20px rgba(167,139,250,0.38))',
            animation: 'promo-icon-float 5.5s ease-in-out infinite',
          }}
        >
          <div className="opacity-35">
            <IconClickUpPilot size={280} strokeWidth={1.2} />
          </div>
        </div>

        <div className="relative flex flex-col items-start gap-6 px-7 py-12 md:px-14 md:py-20">
          <div
            className="inline-flex items-center gap-2 rounded-full border border-lime/50 bg-black/50 px-3.5 py-1.5 text-[10.5px] font-bold uppercase tracking-[0.22em] text-lime backdrop-blur-md"
            style={{
              fontFamily: 'var(--font-tech)',
              boxShadow: '0 0 22px -6px rgba(200,255,0,0.55), inset 0 1px 0 rgba(255,255,255,0.08)',
            }}
          >
            <span
              className="inline-block h-2 w-2 animate-pulse-soft rounded-full bg-lime"
              style={{ boxShadow: '0 0 10px rgba(200,255,0,0.95)' }}
            />
            ClickUp Pilot
          </div>

          <h2
            className="max-w-[760px] text-[34px] font-extrabold leading-[1.05] tracking-tight text-white md:text-[56px]"
            style={{ fontFamily: 'var(--font-tech)', letterSpacing: '-0.025em' }}
          >
            <SmokeText text="Você sai do escritório." className="block" />
            <span className="block" style={{ background: 'linear-gradient(135deg, #c8ff00 0%, #a78bfa 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              <SmokeText text="Ele continua editando." />
            </span>
          </h2>

          <p className="max-w-[560px] text-[15px] leading-relaxed text-white/80">
            <SmokeText text="O Pilot lê os briefings no ClickUp e dispara os avatares por conta própria." className="block" />
            <span className="block mt-2">
              <SmokeText text="Você acorda no outro dia com tudo pronto pra revisar." />
            </span>
          </p>

          <Link
            href="/login"
            className="group/btn relative inline-flex items-center gap-2 overflow-hidden rounded-full px-7 py-3.5 text-[14px] font-bold text-black"
            style={{
              background: 'linear-gradient(135deg, #c8ff00 0%, #a3e635 100%)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.5), 0 14px 36px -8px rgba(200,255,0,0.6)',
            }}
          >
            <span className="relative z-10">Ver o Pilot em ação</span>
            <span className="relative z-10 transition-transform duration-300 group-hover/btn:translate-x-1">→</span>
            <span aria-hidden className="absolute inset-0 -translate-x-[120%] bg-gradient-to-r from-transparent via-white/40 to-transparent transition-transform duration-700 group-hover/btn:translate-x-[120%]" />
          </Link>
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
          @keyframes promo-icon-float {
            0%, 100% { transform: translateY(-50%) translateX(0) rotate(0); }
            50% { transform: translateY(calc(-50% - 8px)) translateX(-4px) rotate(-3deg); }
          }
        `}</style>
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
          <SmokeText text={title} />
        </h3>
        <p className="mt-2 text-[14px] leading-relaxed text-text-muted">
          <SmokeText text={desc} />
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
            <SmokeText text="A fila roda em segundo plano enquanto você faz outra coisa." className="block" />
            <span className="mt-2 block">
              <SmokeText text="Você só volta pra revisar." />
            </span>
          </p>
          <ul className="mt-7 space-y-3">
            {[
              'Tudo roda no seu computador. Sem servidor remoto.',
              'Os arquivos nunca saem da sua máquina.',
              'Você usa suas próprias chaves de IA, no seu ritmo.',
              'Sem assinatura escondida. Sem letra miúda.',
            ].map((line, i) => (
              <li
                key={i}
                className="flex items-start gap-3 fade-in-up"
                style={{ animationDelay: `${i * 80}ms` }}
              >
                <CheckMark />
                <span className="text-[14.5px] text-white">
                  <SmokeText text={line} />
                </span>
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
            <SmokeText text="Cria a conta, liga a fila e vai viver. Resto é robô." />
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href="/login" className="btn-primary group text-base">
              <span>Começar grátis</span>
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
