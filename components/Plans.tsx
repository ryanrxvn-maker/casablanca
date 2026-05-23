'use client';

import Link from 'next/link';
import { Brand } from './Brand';
import { SmokeText } from './SmokeText';

/**
 * Plans — página de vitrine /planos com 3 cards estilo neon.
 *
 * Cada card tem:
 *  - Borda colorida (violet/pink/violet-cyan)
 *  - Nome do plano + preço grande
 *  - Coelho neon centralizado com tom próprio
 *  - Lista de inclusos (check verde)
 *  - Lista de bloqueados (cadeado violeta) — só nos planos limitados
 *  - CTA no rodapé
 *
 * Fundo: dots/stars pattern + glow ambient violet + ícones flutuantes
 * de ferramentas como decoração.
 */

type Feature = { label: string; locked?: boolean };

type Plan = {
  id: 'free' | 'basic' | 'pro';
  name: string;
  price: string;
  period?: string;
  cta: { label: string; href: string };
  borderHue: string;
  rabbitHue: string;
  glowHue: string;
  features: Feature[];
  highlight?: boolean;
};

const PLANS: Plan[] = [
  {
    id: 'free',
    name: 'Plano Free',
    price: 'R$ 0',
    period: '/sempre',
    cta: { label: 'Criar conta', href: '/register' },
    borderHue: 'rgba(167,139,250,0.55)',
    rabbitHue: 'rgba(167,139,250,0.85)',
    glowHue: 'rgba(167,139,250,0.45)',
    features: [
      { label: 'Downloader' },
      { label: 'Decupagem de áudio' },
      { label: 'Decupagem de vídeo', locked: true },
      { label: 'Remover legenda', locked: true },
      { label: 'SRT Generator', locked: true },
      { label: 'Mixer de Velocidade', locked: true },
      { label: 'Normalizador de Volume', locked: true },
      { label: 'Separar áudios', locked: true },
      { label: 'Auto B-roll', locked: true },
      { label: 'Troca de produto', locked: true },
      { label: 'HeyGen Auto', locked: true },
      { label: 'ClickUp Pilot', locked: true },
    ],
  },
  {
    id: 'basic',
    name: 'Plano Basic',
    price: 'R$ 99',
    period: '/mês',
    cta: { label: 'Começar agora', href: '/register' },
    borderHue: 'rgba(244,114,182,0.65)',
    rabbitHue: 'rgba(244,114,182,0.9)',
    glowHue: 'rgba(244,114,182,0.5)',
    highlight: true,
    features: [
      { label: 'Downloader' },
      { label: 'Decupagem de áudio e vídeo' },
      { label: 'Remover legenda' },
      { label: 'SRT Generator' },
      { label: 'Mixer de Velocidade' },
      { label: 'Normalizador de Volume' },
      { label: 'Separar áudios' },
      { label: 'Separar takes' },
      { label: 'Compressor' },
      { label: 'Camuflagem' },
      { label: 'Auto B-roll', locked: true },
      { label: 'Troca de produto', locked: true },
      { label: 'HeyGen Auto', locked: true },
      { label: 'ClickUp Pilot', locked: true },
    ],
  },
  {
    id: 'pro',
    name: 'Plano Pro',
    price: 'Sob consulta',
    cta: { label: 'Falar com vendas', href: 'https://wa.me/5531991262437' },
    borderHue: 'rgba(192,132,252,0.7)',
    rabbitHue: 'rgba(192,132,252,1)',
    glowHue: 'rgba(192,132,252,0.55)',
    features: [
      { label: 'Tudo do Basic' },
      { label: 'Auto B-roll' },
      { label: 'Troca de produto' },
      { label: 'HeyGen Auto' },
      { label: 'ClickUp Pilot' },
      { label: 'Smart Decup' },
      { label: 'Smart Remover' },
      { label: 'Pipeline ClickUp → entrega' },
      { label: 'Suporte prioritário' },
      { label: 'Integrações personalizadas' },
      { label: 'Onboarding com o time' },
    ],
  },
];

export function Plans() {
  return (
    <main className="relative min-h-screen overflow-hidden">
      {/* Background mesh */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          background:
            'radial-gradient(45% 35% at 18% 12%, rgba(167,139,250,0.18), transparent 65%),' +
            'radial-gradient(40% 30% at 84% 90%, rgba(244,114,182,0.12), transparent 65%),' +
            'radial-gradient(60% 40% at 50% 100%, rgba(103,232,249,0.06), transparent 70%)',
        }}
      />
      {/* Dots/stars */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0 opacity-[0.35]"
        style={{
          backgroundImage:
            'radial-gradient(circle at center, rgba(192,132,252,0.5) 1.2px, transparent 1.4px)',
          backgroundSize: '46px 46px',
        }}
      />

      {/* Header */}
      <header className="relative z-10 border-b border-line/50 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-[1280px] items-center justify-between px-5 md:px-8">
          <Brand href="/" />
          <Link href="/login" className="btn-ghost">
            Entrar
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="relative z-10 px-5 pt-16 text-center md:px-8 md:pt-24">
        <div
          className="mx-auto mb-4 inline-flex items-center gap-2 rounded-full border border-violet/35 bg-violet/10 px-3 py-1 text-[10.5px] font-semibold uppercase tracking-[0.20em] text-violet"
          style={{ fontFamily: 'var(--font-tech)' }}
        >
          <span className="inline-block h-1.5 w-1.5 animate-pulse-soft rounded-full bg-violet shadow-[0_0_10px_rgba(167,139,250,0.9)]" />
          PLANOS
        </div>
        <h1 className="hero-title" style={{ fontSize: 'clamp(2.5rem, 5vw, 4rem)' }}>
          <SmokeText text="Escolha seu plano." className="block" />
          <span className="display-subtle block">
            <SmokeText text="A automação te espera." />
          </span>
        </h1>
        <p className="mx-auto mt-5 max-w-[540px] text-[15px] leading-relaxed text-text-muted">
          Comece grátis hoje. Quando estiver pronto pra automatizar o dia
          inteiro, sobe pro Basic ou Pro.
        </p>
      </section>

      {/* Cards */}
      <section className="relative z-10 mx-auto mt-16 max-w-[1280px] px-5 pb-16 md:px-8 md:pb-24">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {PLANS.map((plan, i) => (
            <PlanCard key={plan.id} plan={plan} delay={i * 120} />
          ))}
        </div>

        {/* Rodapé editorial */}
        <p className="mt-14 text-center text-[13px] text-text-muted">
          Todos os planos rodam no seu computador. Seus arquivos nunca saem da
          sua máquina.
        </p>
      </section>
    </main>
  );
}

/* ─────────────────────────────────────────────────────────────── */

function PlanCard({ plan, delay }: { plan: Plan; delay: number }) {
  return (
    <div
      className={
        'plan-card relative overflow-hidden rounded-[28px] fade-in-up ' +
        (plan.highlight ? 'plan-highlight' : '')
      }
      style={{
        animationDelay: `${delay}ms`,
      }}
    >
      {/* Borda gradient pulsante */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[28px]"
        style={{
          padding: '1.5px',
          background: `linear-gradient(180deg, ${plan.borderHue} 0%, rgba(255,255,255,0.05) 50%, ${plan.borderHue} 100%)`,
          WebkitMask:
            'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
          WebkitMaskComposite: 'xor',
          maskComposite: 'exclude',
        }}
      />
      {/* Glow externo (mais forte no destaque) */}
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-1 rounded-[30px] opacity-50 blur-2xl"
        style={{
          background: `radial-gradient(60% 100% at 50% 50%, ${plan.glowHue}, transparent 70%)`,
          animation: plan.highlight ? 'plan-glow-pulse 3.5s ease-in-out infinite' : undefined,
        }}
      />

      {/* Corpo */}
      <div
        className="relative flex h-full flex-col px-6 py-8 md:px-7 md:py-10"
        style={{
          background:
            'linear-gradient(180deg, rgba(255,255,255,0.025), rgba(0,0,0,0.20)), linear-gradient(180deg, #15151a, #0a0a0c)',
          borderRadius: '28px',
        }}
      >
        {/* Header — nome + preço */}
        <div className="text-center">
          <div
            className="text-[14px] font-bold uppercase tracking-[0.18em]"
            style={{
              fontFamily: 'var(--font-tech)',
              color: plan.rabbitHue.replace('0.85', '1').replace('0.9', '1').replace('1)', '1)'),
            }}
          >
            {plan.name}
          </div>
          <div className="mt-3 flex items-baseline justify-center gap-1">
            <span
              className="text-[42px] font-extrabold tracking-tight text-white md:text-[48px]"
              style={{ fontFamily: 'var(--font-tech)', letterSpacing: '-0.03em' }}
            >
              {plan.price}
            </span>
            {plan.period ? (
              <span className="text-[15px] text-text-muted">{plan.period}</span>
            ) : null}
          </div>
        </div>

        {/* Coelho centralizado */}
        <div className="mt-6 flex justify-center">
          <div
            className="rabbit-img relative"
            style={{
              filter: `drop-shadow(0 0 28px ${plan.glowHue}) drop-shadow(0 0 12px ${plan.rabbitHue})`,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/auto-edit-logo@256.png"
              alt=""
              aria-hidden
              width={120}
              height={120}
            />
          </div>
        </div>

        {/* Features */}
        <ul className="mt-7 flex flex-1 flex-col gap-2.5">
          {plan.features.map((f, i) => (
            <li
              key={i}
              className={
                'flex items-start gap-2.5 text-[13.5px] ' +
                (f.locked ? 'text-text-dim' : 'text-white')
              }
            >
              {f.locked ? (
                <span
                  className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-line"
                  style={{ background: 'rgba(255,255,255,0.02)' }}
                  aria-hidden
                >
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#5a5a64" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="4" y="11" width="16" height="10" rx="2" />
                    <path d="M8 11V7a4 4 0 018 0v4" />
                  </svg>
                </span>
              ) : (
                <span
                  className="mt-0.5 inline-block h-4 w-4 shrink-0 rounded-full"
                  style={{
                    background:
                      'radial-gradient(circle, ' +
                      plan.rabbitHue +
                      ', transparent 70%)',
                  }}
                  aria-hidden
                >
                  <span
                    className="block h-4 w-4 rounded-full"
                    style={{
                      background: plan.rabbitHue,
                      boxShadow: `0 0 10px ${plan.rabbitHue}`,
                    }}
                  />
                </span>
              )}
              <span className={f.locked ? 'line-through opacity-70' : ''}>
                {f.label}
              </span>
            </li>
          ))}
        </ul>

        {/* CTA */}
        <div className="mt-8">
          {plan.cta.href.startsWith('http') ? (
            <a
              href={plan.cta.href}
              target="_blank"
              rel="noopener noreferrer"
              className="plan-cta block w-full rounded-full border px-5 py-3.5 text-center text-[13.5px] font-bold transition-all duration-300 hover:-translate-y-[1px]"
              style={{
                borderColor: plan.borderHue,
                color: '#fff',
                background:
                  'linear-gradient(135deg, ' + plan.glowHue + ', transparent 70%), rgba(0,0,0,0.4)',
              }}
            >
              {plan.cta.label}
            </a>
          ) : (
            <Link
              href={plan.cta.href}
              className="plan-cta block w-full rounded-full border px-5 py-3.5 text-center text-[13.5px] font-bold transition-all duration-300 hover:-translate-y-[1px]"
              style={{
                borderColor: plan.borderHue,
                color: '#fff',
                background:
                  'linear-gradient(135deg, ' + plan.glowHue + ', transparent 70%), rgba(0,0,0,0.4)',
              }}
            >
              {plan.cta.label}
            </Link>
          )}
        </div>

        {plan.highlight ? (
          <div
            className="pointer-events-none absolute -top-3 left-1/2 -translate-x-1/2 rounded-full border border-white/20 bg-black/70 px-3 py-1 text-[9.5px] font-bold uppercase tracking-[0.22em] backdrop-blur-md"
            style={{
              fontFamily: 'var(--font-tech)',
              color: plan.rabbitHue,
              boxShadow: `0 0 18px -4px ${plan.glowHue}`,
            }}
          >
            mais popular
          </div>
        ) : null}
      </div>

      <style jsx>{`
        .plan-card {
          transition: transform 0.4s cubic-bezier(0.22, 1, 0.36, 1);
        }
        .plan-card:hover {
          transform: translateY(-6px);
        }
        .plan-highlight {
          transform: scale(1.03);
        }
        .plan-highlight:hover {
          transform: scale(1.03) translateY(-6px);
        }
        .rabbit-img {
          animation: rabbit-float 4.8s ease-in-out infinite;
        }
        @keyframes rabbit-float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-6px); }
        }
        @keyframes plan-glow-pulse {
          0%, 100% { opacity: 0.5; }
          50% { opacity: 0.85; }
        }
      `}</style>
    </div>
  );
}
