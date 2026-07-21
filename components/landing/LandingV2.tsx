'use client';

/**
 * LandingV2 — landing pública do Auto Edit (`/`), redesign 2026-07.
 *
 * Direção: "sobe o bruto, baixa o pronto" — a bancada de ferramentas do
 * editor. Cena 3D em CSS puro (parallax de ponteiro, piso em perspectiva,
 * aurora), painéis HUD com o produto REAL (mp4s de /cards) e copy 100% honesta:
 *  • só ferramentas que o cliente usa hoje (nada admin-only ou interno);
 *  • dois planos: Free e Premium — nada de "em breve";
 *  • sem absolutos ("ilimitado", "100%", etc).
 *
 * A Landing antiga (components/Landing.tsx) segue viva — /pilot (admin-only)
 * importa PilotHowItWorks de lá. Aqui é só a home.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Brand } from '../Brand';
import { HeroScene } from './HeroScene';
import {
  FaqSection,
  FinalCta,
  HowSection,
  LandingFooter,
  PricingSection,
  SuiteSection,
} from './SuiteSections';

export function LandingV2() {
  return (
    <main className="relative min-h-screen overflow-x-clip">
      {/* névoa de marca fixa no topo da página */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 z-0 h-[900px]"
        style={{
          background:
            'radial-gradient(46% 34% at 20% 8%, rgba(167,139,250,0.16), transparent 65%),' +
            'radial-gradient(38% 30% at 82% 2%, rgba(224,132,176,0.10), transparent 65%),' +
            'radial-gradient(52% 38% at 55% 30%, rgba(126,213,226,0.06), transparent 70%)',
        }}
      />

      <LandingHeader />

      <div className="relative z-[1]">
        <HeroScene />
        <SuiteSection />
        <HowSection />
        <PricingSection />
        <FaqSection />
        <FinalCta />
        <LandingFooter />
      </div>
    </main>
  );
}

/* ────────────────────── HEADER ────────────────────── */

function LandingHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        setScrolled(window.scrollY > 14);
        const max = document.documentElement.scrollHeight - window.innerHeight;
        setProgress(max > 0 ? Math.min(1, window.scrollY / max) : 0);
      });
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  const anchors = [
    { href: '#suite', label: 'Suíte' },
    { href: '#precos', label: 'Planos' },
    { href: '#faq', label: 'FAQ' },
  ];

  return (
    <header className="sticky top-0 z-40 px-3 pt-3 md:px-5">
      <div
        className={
          'mx-auto flex h-[58px] max-w-[1240px] items-center justify-between rounded-[18px] border px-4 transition-all duration-300 md:px-5 ' +
          (scrolled
            ? 'border-line/70 bg-bg/75 shadow-[0_18px_40px_-22px_rgba(0,0,0,0.9)] backdrop-blur-xl'
            : 'border-transparent bg-transparent')
        }
      >
        <Brand href="/" />

        <nav
          className="hidden items-center gap-1 lg:flex"
          style={{ fontFamily: 'var(--font-tech)' }}
        >
          {anchors.map((a) => (
            <a
              key={a.href}
              href={a.href}
              className="rounded-full px-3.5 py-1.5 text-[12px] font-semibold uppercase tracking-[0.12em] text-text-muted transition-all duration-200 hover:bg-white/[0.05] hover:text-white"
            >
              {a.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Link href="/login" className="btn-ghost hidden sm:inline-flex">
            Entrar
          </Link>
          <Link href="/register" className="btn-primary">
            Começar grátis
          </Link>
        </div>

        {/* progresso de leitura */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-4 bottom-0 h-px overflow-hidden rounded-full md:inset-x-5"
        >
          <span
            className="block h-full origin-left"
            style={{
              transform: `scaleX(${progress})`,
              background: 'linear-gradient(90deg, #a78bfa, #e084b0, #c8d684)',
              boxShadow: '0 0 10px rgba(167,139,250,0.7)',
              opacity: scrolled ? 1 : 0,
              transition: 'opacity 0.3s ease',
            }}
          />
        </span>
      </div>
    </header>
  );
}
