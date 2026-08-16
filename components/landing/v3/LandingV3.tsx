'use client';

/**
 * LandingV3 — landing pública do Auto Edit (`/`), redesign 2026-08.
 *
 * Direção: "A REDAÇÃO". A página é uma edição fechando — tarja de edição no
 * topo, cabeçalho de jornal, manchete de plantão no herói, esteira de ticker,
 * seções numeradas como retranca (01…05) e expediente no rodapé. Serifada
 * (Instrument Serif) pra manchete, Bricolage pra títulos, Inter pros rótulos.
 *
 * O que mudou em relação à v2 (além do visual): as três ferramentas que mais
 * pesam na entrega — Camuflagem, Decupagem e FakePrint — ganharam bloco-herói
 * próprio, com cena animada e copy específica, em vez de virarem mais um card
 * numa grade.
 *
 * Copy: honesta e sem agressividade. Só ferramenta que o cliente usa hoje,
 * nenhum absoluto, e a Camuflagem é vendida junto com o selo de verificação —
 * que é o que a ferramenta realmente entrega.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { DarkoLogo } from '../../DarkoLogo';
import { Kicker, Reveal, Ticker, useClock, useToday } from './kit';
import { BreakingCard } from './scenes';
import {
  FaqSection,
  FinalCta,
  HighlightsSection,
  HowSection,
  LandingFooter,
  PricingSection,
  SuiteSection,
} from './sections';

const RED = '#e0483f';

export function LandingV3() {
  return (
    <main className="relative min-h-screen overflow-x-clip">
      {/* calor ambiente da redação — vermelho de plantão à esquerda, violeta da
          marca à direita. Bem sutil; só tira o fundo do preto chapado. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[820px]"
        style={{
          background:
            'radial-gradient(42% 32% at 10% 4%, rgba(224,72,63,0.07), transparent 65%),' +
            'radial-gradient(36% 28% at 88% 8%, rgba(167,139,250,0.07), transparent 65%)',
        }}
      />
      <EditionBar />
      <Masthead />
      <Hero />

      {/* Cada manchete assinada pela sua editoria — nada de claim solto. */}
      <Ticker
        className="mt-14 md:mt-20"
        tag="Plantão"
        items={[
          'Decupagem — o silêncio sai sozinho',
          'Camuflagem — duas trilhas no mesmo arquivo',
          'FakePrint — 41 modelos de print',
          'Gerador de SRT — legenda palavra por palavra',
          'Fila — segue rodando em segundo plano',
          'FakePrint — tela verde pronta pro chroma',
          'Lote — vários arquivos de uma vez',
          'Grátis — sem cartão pra começar',
        ]}
      />

      <HighlightsSection />
      <SuiteSection />
      <HowSection />
      <PricingSection />
      <FaqSection />
      <FinalCta />
      <LandingFooter />

      <style jsx global>{`
        section[id] {
          scroll-margin-top: 96px;
        }
      `}</style>
    </main>
  );
}

/* ────────────────────── tarja de edição ────────────────────── */

function EditionBar() {
  const today = useToday();
  const clock = useClock();

  return (
    <div className="border-b border-white/8 bg-black/30">
      <div
        className="mx-auto flex h-8 max-w-[1200px] items-center justify-between px-5 text-[9.5px] uppercase tracking-[0.22em] text-white/35 md:px-8"
        style={{ fontFamily: 'var(--font-label)', fontWeight: 600 }}
      >
        <span className="truncate">{today || 'Edição digital'}</span>
        <span className="hidden md:inline">Suíte de edição · roda no navegador</span>
        <span className="num tracking-[0.16em]" style={{ fontFamily: 'var(--font-mono)' }}>
          {clock}
        </span>
      </div>
    </div>
  );
}

/* ────────────────────── cabeçalho ────────────────────── */

const NAV = [
  { href: '#destaques', label: 'Destaques' },
  { href: '#suite', label: 'A suíte' },
  { href: '#como', label: 'Como funciona' },
  { href: '#planos', label: 'Planos' },
  { href: '#faq', label: 'FAQ' },
];

function Masthead() {
  const [scrolled, setScrolled] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        setScrolled(window.scrollY > 10);
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

  return (
    <header
      className={
        'sticky top-0 z-40 border-b transition-all duration-300 ' +
        (scrolled
          ? 'border-white/10 bg-bg/85 backdrop-blur-xl'
          : 'border-white/8 bg-transparent')
      }
    >
      <div className="mx-auto flex h-[62px] max-w-[1200px] items-center justify-between gap-4 px-5 md:px-8">
        <Link href="/" className="group flex items-center gap-2.5" aria-label="Auto Edit">
          <span className="transition-transform duration-500 group-hover:-rotate-6 group-hover:scale-105">
            <DarkoLogo size={30} />
          </span>
          <span
            className="text-[19px] leading-none text-white"
            style={{ fontFamily: 'var(--font-serif)', letterSpacing: '0.01em' }}
          >
            Auto Edit
          </span>
        </Link>

        <nav className="hidden items-center gap-1 lg:flex">
          {NAV.map((n) => (
            <a
              key={n.href}
              href={n.href}
              className="rounded-[6px] px-3 py-1.5 text-[11px] uppercase tracking-[0.16em] text-white/50 transition-colors duration-200 hover:bg-white/[0.06] hover:text-white"
              style={{ fontFamily: 'var(--font-label)', fontWeight: 600 }}
            >
              {n.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Link
            href="/login"
            className="hidden rounded-[8px] px-3 py-2 text-[12.5px] font-semibold text-white/70 transition-colors hover:text-white sm:inline-flex"
          >
            Entrar
          </Link>
          <Link href="/register" className="btn-primary !rounded-[10px]">
            Criar conta grátis
          </Link>
        </div>
      </div>

      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-[-1px] h-[2px] origin-left"
        style={{
          transform: `scaleX(${progress})`,
          background: RED,
          opacity: scrolled ? 1 : 0,
          transition: 'opacity .3s ease',
        }}
      />
    </header>
  );
}

/* ────────────────────── herói ────────────────────── */

const STATS = [
  { n: '11', label: 'ferramentas no ar' },
  { n: '41', label: 'modelos de print' },
  { n: 'R$ 0', label: 'pra começar' },
];

function Hero() {
  return (
    <section className="mx-auto max-w-[1200px] px-5 pt-12 md:px-8 md:pt-20">
      <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-[1.02fr_0.98fr] lg:gap-16">
        {/* manchete */}
        <Reveal>
          <div>
            <Kicker index="—" label="Suíte de edição de vídeo" />

            <h1
              className="mt-6 text-[42px] font-extrabold leading-[0.98] tracking-[-0.03em] text-white sm:text-[54px] lg:text-[62px]"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              Menos horas
              <br />
              na timeline.
              <span className="mt-1 block text-editorial font-normal tracking-[-0.01em] text-white/70">
                Mais criativo no ar.
              </span>
            </h1>

            <p className="mt-6 max-w-[54ch] text-[16px] leading-relaxed text-text-muted">
              O silêncio do bruto some sozinho, o áudio do vídeo engana a transcrição
              das plataformas e a manchete do telejornal sai do jeito que você
              escreveu — tudo no navegador, sem instalar nada.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href="/register" className="btn-primary !rounded-[10px] !px-6 !py-3.5 !text-[14px]">
                Criar conta grátis →
              </Link>
              <a href="#destaques" className="btn-secondary !rounded-[10px] !px-5 !py-3.5 !text-[13.5px]">
                Ver as ferramentas
              </a>
            </div>

            <p
              className="mt-5 text-[10px] uppercase tracking-[0.2em] text-text-dim"
              style={{ fontFamily: 'var(--font-label)', fontWeight: 600 }}
            >
              Sem cartão pra começar · cancela quando quiser
            </p>

            <div className="mt-9 flex flex-wrap items-center gap-x-8 gap-y-4 border-t border-white/8 pt-6">
              {STATS.map((s) => (
                <div key={s.label}>
                  <div
                    className="num text-[22px] font-bold leading-none text-white"
                    style={{ fontFamily: 'var(--font-tech)', letterSpacing: '-0.02em' }}
                  >
                    {s.n}
                  </div>
                  <div
                    className="mt-1.5 text-[9.5px] uppercase tracking-[0.18em] text-white/35"
                    style={{ fontFamily: 'var(--font-label)', fontWeight: 600 }}
                  >
                    {s.label}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Reveal>

        {/* card de destaque */}
        <Reveal delay={120}>
          <BreakingCard />
        </Reveal>
      </div>
    </section>
  );
}
