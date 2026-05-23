'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Brand } from './Brand';
import { DarkoLogo } from './DarkoLogo';
import {
  IconAutoBroll,
  IconDecupagem,
  IconHeyGenAuto,
  IconRemoverElementos,
  IconTrocaProduto,
} from './ToolIcons';

/**
 * Landing — página pública em `/`.
 *
 * Estrutura cinematográfica:
 *  1. Top-bar minimalista com brand + CTA entrar
 *  2. Hero massivo com headline animada + visual 3D do coelho gigante
 *  3. Faixa de números (social proof)
 *  4. Grade de capacidades com ícones coloridos + descrições curtas
 *  5. Showcase em duas colunas (texto editorial + visual)
 *  6. CTA final
 *  7. Footer fino
 *
 * Copy em PT-BR perfeito, sem termos técnicos, escrita pra encantar editor.
 */
export function Landing() {
  return (
    <main className="relative min-h-screen overflow-hidden">
      {/* Background mesh extra cinematográfico */}
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
            Começar
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
        {/* TEXTO */}
        <div className="relative z-10">
          <div
            className="mb-5 inline-flex items-center gap-2 rounded-full border border-violet/35 bg-violet/10 px-3 py-1 text-[10.5px] font-semibold uppercase tracking-[0.20em] text-violet animate-fade-in"
            style={{ fontFamily: 'var(--font-tech)' }}
          >
            <span className="inline-block h-1.5 w-1.5 animate-pulse-soft rounded-full bg-violet shadow-[0_0_10px_rgba(167,139,250,0.9)]" />
            Suite criativa pra editores
          </div>

          <h1 className="hero-title" style={{ fontSize: 'clamp(2.5rem, 6vw, 4.5rem)' }}>
            <KineticLine text="Edição rápida," delay={0} />
            <br />
            <KineticLine text="entrega no prazo." delay={140} />
            <br />
            <span className="display-subtle" style={{ fontSize: 'clamp(1.8rem, 4vw, 3rem)', lineHeight: '1.1' }}>
              <KineticLine text="Pra quem vive do corte." delay={320} color="var(--violet)" />
            </span>
          </h1>

          <p
            className="mt-6 max-w-[520px] text-[16px] leading-relaxed text-text-muted fade-in-up"
            style={{ animationDelay: '500ms' }}
          >
            B-roll automático, troca de produto, avatar que fala, legenda em segundos.
            Tudo no mesmo lugar — sem trocar de programa.
          </p>

          <div
            className="mt-8 flex flex-wrap items-center gap-3 fade-in-up"
            style={{ animationDelay: '600ms' }}
          >
            <Link href="/login" className="btn-primary group">
              <span>Entrar no estúdio</span>
              <span className="transition-transform duration-300 group-hover:translate-x-1">→</span>
            </Link>
            <a href="#capacidades" className="btn-secondary">
              Ver o que faz
            </a>
          </div>

          <div className="mt-8 flex items-center gap-4 fade-in-up" style={{ animationDelay: '720ms' }}>
            <AvatarStack />
            <p className="text-[12.5px] leading-tight text-text-muted">
              <span className="font-semibold text-white">Editores em produção</span>
              <br />
              já estão entregando mais com menos.
            </p>
          </div>
        </div>

        {/* VISUAL */}
        <HeroVisual />
      </div>
    </section>
  );
}

function HeroVisual() {
  return (
    <div className="hero-visual relative mx-auto flex h-[460px] w-full max-w-[520px] items-center justify-center md:h-[560px]">
      {/* Orbita externa */}
      <div className="hv-orbit hv-orbit-1 absolute inset-0">
        <FloatIcon
          delay={0}
          className="absolute left-[8%] top-[12%]"
          hue="rgba(240,171,252,0.45)"
          icon={<IconAutoBroll size={28} />}
        />
        <FloatIcon
          delay={300}
          className="absolute right-[6%] top-[20%]"
          hue="rgba(103,232,249,0.45)"
          icon={<IconHeyGenAuto size={28} />}
        />
        <FloatIcon
          delay={600}
          className="absolute left-[5%] bottom-[18%]"
          hue="rgba(163,230,53,0.4)"
          icon={<IconDecupagem size={28} />}
        />
        <FloatIcon
          delay={900}
          className="absolute right-[8%] bottom-[10%]"
          hue="rgba(244,114,182,0.45)"
          icon={<IconTrocaProduto size={28} />}
        />
        <FloatIcon
          delay={1200}
          className="absolute right-[40%] top-[5%]"
          hue="rgba(167,139,250,0.45)"
          icon={<IconRemoverElementos size={28} />}
        />
      </div>

      {/* Logo central enorme */}
      <div className="hv-mark relative z-10">
        <div
          aria-hidden
          className="absolute inset-0 -m-12 rounded-full opacity-60 blur-3xl"
          style={{
            background:
              'radial-gradient(circle, rgba(167,139,250,0.5), transparent 65%)',
          }}
        />
        <div className="relative">
          <DarkoLogo size={220} />
        </div>
      </div>

      <style jsx>{`
        .hv-mark {
          animation: hv-mark-float 6s ease-in-out infinite;
        }
        @keyframes hv-mark-float {
          0%, 100% { transform: translateY(0) rotateZ(0); }
          50% { transform: translateY(-12px) rotateZ(-2deg); }
        }
        .hv-orbit {
          animation: hv-orbit-spin 30s linear infinite;
        }
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
    <div
      className={'float-icon ' + (className || '')}
      style={{ animationDelay: `${delay}ms` }}
    >
      <span
        className="float-icon-inner flex h-14 w-14 items-center justify-center rounded-[16px] border border-white/10 bg-black/40 backdrop-blur-md"
        style={{
          boxShadow: `0 0 32px -6px ${hue}, inset 0 1px 0 rgba(255,255,255,0.1)`,
        }}
      >
        {icon}
      </span>
      <style jsx>{`
        .float-icon {
          animation: fi-pop 600ms cubic-bezier(0.34, 1.56, 0.64, 1) both,
            fi-float 5s ease-in-out infinite;
        }
        .float-icon-inner {
          animation: fi-counterspin 30s linear infinite;
        }
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

function KineticLine({
  text,
  delay,
  color,
}: {
  text: string;
  delay: number;
  color?: string;
}) {
  const words = text.split(' ');
  let acc = delay;
  return (
    <span className="inline-block" style={color ? { color } : undefined}>
      {words.map((w, i) => {
        const d = acc;
        acc += 60;
        return (
          <span
            key={`${w}-${i}`}
            className="inline-block kl-word"
            style={{ animationDelay: `${d}ms` }}
          >
            {w}
            {i < words.length - 1 ? ' ' : ''}
            <style jsx>{`
              .kl-word {
                animation: kl-in 700ms cubic-bezier(0.2, 0.9, 0.3, 1.2) both;
              }
              @keyframes kl-in {
                0% { opacity: 0; transform: translateY(22px) rotateX(-30deg); }
                100% { opacity: 1; transform: translateY(0) rotateX(0); }
              }
            `}</style>
          </span>
        );
      })}
    </span>
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
    { value: '–80%', label: 'tempo no corte de silêncios' },
    { value: '< 30s', label: 'pra gerar um B-roll inteiro' },
    { value: '100%', label: 'no seu computador' },
    { value: '24/7', label: 'sem fila de espera' },
  ];
  return (
    <section className="mx-auto mt-24 max-w-[1200px] px-5 md:px-8">
      <div className="grid grid-cols-2 gap-6 rounded-[20px] border border-line/60 bg-bg-soft/50 px-6 py-7 backdrop-blur-md md:grid-cols-4 md:px-10">
        {stats.map((s, i) => (
          <div
            key={i}
            className="fade-in-up text-center"
            style={{ animationDelay: `${i * 80}ms` }}
          >
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

/* ────────────────────── CAPACIDADES ────────────────────── */

function CapabilitiesSection() {
  const items = [
    {
      icon: <IconAutoBroll size={32} />,
      hue: 'rgba(240,171,252,0.55)',
      title: 'B-roll no ritmo certo',
      desc: 'A IA escuta o que você fala e monta os cortes no tempo da edição. Você só revisa.',
    },
    {
      icon: <IconTrocaProduto size={32} />,
      hue: 'rgba(244,114,182,0.5)',
      title: 'Troca de produto sem regravar',
      desc: 'Mudou a marca? Troque o produto na cena. A pessoa continua falando como antes.',
    },
    {
      icon: <IconHeyGenAuto size={32} />,
      hue: 'rgba(103,232,249,0.5)',
      title: 'Avatar que fala por você',
      desc: 'Cola o roteiro, escolhe a voz, recebe o vídeo. Sem câmera, sem set, sem luz.',
    },
    {
      icon: <IconRemoverElementos size={32} />,
      hue: 'rgba(167,139,250,0.5)',
      title: 'Apaga legenda sem marca',
      desc: 'Esqueceu de tirar a legenda gravada? A IA reconstrói o fundo e ninguém percebe.',
    },
    {
      icon: <IconDecupagem size={32} />,
      hue: 'rgba(163,230,53,0.45)',
      title: 'Decupagem em um clique',
      desc: 'Os silêncios somem. O ritmo do vídeo melhora. Você ganha horas todo dia.',
    },
    {
      icon: <DonutIcon />,
      hue: 'rgba(245,200,66,0.5)',
      title: 'Ganhe pontos editando',
      desc: 'Cada projeto entregue rende pontos. Pontos viram medalhas. Medalhas viram conquistas.',
    },
  ];

  return (
    <section id="capacidades" className="mx-auto mt-32 max-w-[1200px] px-5 md:px-8">
      <div className="mb-12 max-w-[680px] fade-in-up">
        <div
          className="mb-3 text-[10.5px] font-semibold uppercase tracking-[0.22em] text-text-dim"
          style={{ fontFamily: 'var(--font-tech)' }}
        >
          O QUE FAZ
        </div>
        <h2 className="section-title text-[36px] md:text-[48px]" style={{ lineHeight: 1.05 }}>
          Tudo que você precisa pra fechar um projeto.
          <br />
          <span className="display-subtle">Em um só lugar.</span>
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

function DonutIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
      <defs>
        <linearGradient id="donut-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#fbbf24" />
          <stop offset="100%" stopColor="#f97316" />
        </linearGradient>
      </defs>
      <path d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z" stroke="url(#donut-grad)" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
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
      className="cap-card group relative overflow-hidden rounded-[20px] border border-line/60 p-6 transition-all duration-500 hover:-translate-y-1 hover:border-violet/40 md:p-7"
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
          style={{
            boxShadow: `0 0 32px -4px ${hue}, inset 0 1px 0 rgba(255,255,255,0.12)`,
          }}
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
      <style jsx>{`
        .cap-card {
          animation: fade-in-up 0.6s cubic-bezier(0.2, 0.8, 0.2, 1) both;
          animation-delay: var(--d, 0ms);
        }
      `}</style>
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
            FEITO PRA ENTREGAR
          </div>
          <h2 className="section-title text-[34px] md:text-[44px]" style={{ lineHeight: 1.08 }}>
            Você edita.<br />
            <span className="display-subtle">A gente cuida do resto.</span>
          </h2>
          <p className="mt-5 max-w-[480px] text-[15px] leading-relaxed text-text-muted">
            Esquece de ficar trocando entre dez programas pra fazer uma coisa simples.
            Aqui o atalho vem pronto.
          </p>
          <ul className="mt-7 space-y-3">
            {[
              'Tudo funciona direto do navegador.',
              'Os arquivos ficam no seu computador.',
              'Você usa as suas chaves de IA, no seu ritmo.',
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
              <span>Acessar agora</span>
              <span className="transition-transform duration-300 group-hover:translate-x-1">→</span>
            </Link>
          </div>
        </div>

        {/* Mock visual estilizado */}
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

      {/* Cards flutuantes simulando UI */}
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
          {[1,2,3,4,5,6].map((i) => (
            <div key={i} className="h-10 rounded-md bg-white/5 border border-white/8" />
          ))}
        </div>
      </div>

      <div className="absolute bottom-8 right-6 w-[60%] rounded-[14px] border border-white/10 bg-black/55 p-4 backdrop-blur-xl float-y-card-2">
        <div
          className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-violet"
          style={{ fontFamily: 'var(--font-tech)' }}
        >
          Carregando
        </div>
        <div className="mt-3 h-1.5 w-full rounded-full bg-white/8 overflow-hidden">
          <div className="h-full w-2/3 rounded-full" style={{ background: 'linear-gradient(90deg, #a78bfa, #67e8f9)' }} />
        </div>
        <div className="mt-3 text-[12.5px] text-white/80">
          B-roll sendo montado…
        </div>
      </div>

      {/* Coelho central */}
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
            Pronto pra editar diferente?
          </h2>
          <p className="mx-auto mt-4 max-w-[520px] text-[15.5px] leading-relaxed text-white/75">
            Cria a conta, entra, edita. É só isso.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href="/login" className="btn-primary group text-base">
              <span>Entrar no estúdio</span>
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
          Feito por quem edita. © {new Date().getFullYear()}
        </p>
      </div>
    </footer>
  );
}
