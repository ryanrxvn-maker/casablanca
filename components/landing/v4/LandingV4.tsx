'use client';

/**
 * LandingV4 — landing pública do Auto Edit (`/`), 07.10.2026.
 *
 * Continua "A Redação" (a direção jornalística que o Silas aprovou na v3),
 * maior e mais viva:
 *   • herói ocupando a tela, com um estúdio em 3D que segue o mouse — monitor
 *     de telejornal do FakePrint (a manchete é editável pelo visitante) e um
 *     celular 9:16 rodando legenda no motor real;
 *   • Legendas Automáticas como seção-estrela: vitrine curada Dinâmicas ×
 *     Simples trocando a legenda de um vídeo ao vivo, e o "Corrigir pela
 *     copy" encenado em 3D com o resultado da função de verdade;
 *   • FakePrint com prints REAIS exportados pela ferramenta;
 *   • Remover Silêncios e Camuflagem num bento; suíte agrupada; planos; FAQ.
 *
 * Copy: só o que o cliente usa hoje (nada de ferramenta admin/Beta Pro), sem
 * absolutos, plano real escrito, contagens vindas de lib/numeros-do-site.
 * Zero travessão em texto visível (regra da taste-skill que o Silas adotou).
 */

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { FAKEPRINT_MODELOS } from '@/lib/numeros-do-site';
import { DarkoLogo } from '../../DarkoLogo';
import { Ticker, useClock, useToday } from '../v3/kit';
import { AudioSection } from './Audio';
import { FakePrintSection } from './FakePrint';
import { Hero } from './Hero';
import { CopyFixSection, LegendasSection, preloadLegendaFonts } from './Legendas';
import { FaqSection, FinalCta, HowSection, LandingFooter, PricingSection, SuiteSection } from './Rest';

const RED = '#e0483f';

export function LandingV4() {
  useEffect(() => {
    // as fontes das legendas descem com folga, enquanto a pessoa lê o herói
    const id = window.setTimeout(preloadLegendaFonts, 1200);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <main className="landing-v4 relative min-h-screen overflow-x-clip">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[1100px]"
        style={{
          background:
            'radial-gradient(40% 34% at 8% 6%, rgba(224,72,63,0.09), transparent 65%),' +
            'radial-gradient(38% 30% at 92% 12%, rgba(167,139,250,0.1), transparent 65%)',
        }}
      />
      <EditionBar />
      <Masthead />
      <Hero />

      {/* Cada manchete assinada pela sua editoria. Única esteira da página. */}
      <Ticker
        tag="Plantão"
        speed={46}
        items={[
          'Legendas Automáticas: a copy corrige a legenda',
          'Remover Silêncios: o silêncio sai, a fala fica',
          `FakePrint: ${FAKEPRINT_MODELOS} modelos de print`,
          'Camuflagem: duas trilhas no mesmo arquivo',
          'Gerador de SRT: legenda palavra por palavra',
          'FakePrint: tela verde pronta pro chroma',
          'Grátis pra começar, sem cartão',
        ]}
      />

      <LegendasSection />
      <CopyFixSection />
      <FakePrintSection />
      <AudioSection />
      <SuiteSection />
      <HowSection />
      <PricingSection />
      <FaqSection />
      <FinalCta />
      <LandingFooter />

      <style jsx global>{`
        .landing-v4 section[id] {
          scroll-margin-top: 88px;
        }
        /* luz ambiente de cada seção, na cor da ferramenta (gradiente parado, sem blur) */
        .landing-v4 .sec-glow {
          position: absolute;
          left: -12%;
          right: -12%;
          top: -180px;
          height: 960px;
          z-index: -1;
          pointer-events: none;
          background: radial-gradient(46% 42% at 50% 34%, var(--g), transparent 72%);
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
    <div className="border-b border-white/[0.08] bg-black/30">
      <div className="mx-auto flex h-8 max-w-[1360px] items-center justify-between px-5 text-[11px] text-white/40 md:px-8" style={{ fontFamily: 'var(--font-label)', fontWeight: 500 }}>
        <span className="truncate first-letter:uppercase">{today || 'Edição digital'}</span>
        <span className="hidden md:inline">Feito pra quem entrega 10x mais.</span>
        <span className="num tabular-nums" style={{ fontFamily: 'var(--font-mono)' }}>
          {clock}
        </span>
      </div>
    </div>
  );
}

/* ────────────────────── cabeçalho ────────────────────── */

const NAV = [
  { href: '#legendas', label: 'Legendas' },
  { href: '#fakeprint', label: 'FakePrint' },
  { href: '#suite', label: 'Ferramentas' },
  { href: '#planos', label: 'Planos' },
  { href: '#faq', label: 'Dúvidas' },
];

function Masthead() {
  // "rolou?" sem listener de scroll: um sentinela no topo, observado.
  const sentinelRef = useRef<HTMLSpanElement | null>(null);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setScrolled(!e.isIntersecting), { rootMargin: '0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <>
      <span ref={sentinelRef} aria-hidden className="block h-0" />
      <header
        className={
          'sticky top-0 z-40 border-b transition-[background-color,border-color] duration-300 ' +
          (scrolled ? 'border-white/10 bg-[#0b0b0e]/[0.82] backdrop-blur-xl' : 'border-transparent bg-transparent')
        }
      >
        <div className="mx-auto flex h-[62px] max-w-[1360px] items-center justify-between gap-4 px-5 md:px-8">
          <Link href="/" className="group flex items-center gap-2.5" aria-label="Auto Edit">
            <span className="transition-transform duration-500 group-hover:-rotate-6 group-hover:scale-105">
              <DarkoLogo size={30} />
            </span>
            <span className="text-[21px] leading-none text-white" style={{ fontFamily: 'var(--font-serif)', letterSpacing: '0.01em' }}>
              Auto Edit
            </span>
          </Link>

          <nav className="hidden items-center gap-1 lg:flex">
            {NAV.map((n) => (
              <a
                key={n.href}
                href={n.href}
                className="rounded-[10px] px-3.5 py-2 text-[14px] font-medium text-white/[0.62] transition-colors duration-200 hover:bg-white/[0.06] hover:text-white"
                style={{ fontFamily: 'var(--font-label)' }}
              >
                {n.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <Link href="/login" className="hidden rounded-[10px] px-3 py-2 text-[14px] font-semibold text-white/70 transition-colors hover:text-white sm:inline-flex">
              Entrar
            </Link>
            <Link href="/register" className="btn-primary !min-h-[42px] !rounded-[11px] !px-4 !text-[13.5px]">
              Criar conta grátis
            </Link>
          </div>
        </div>
        {/* progresso de leitura: animação ligada à rolagem (CSS puro, só onde existe) */}
        <span aria-hidden className="mh-progress pointer-events-none absolute inset-x-0 bottom-[-1px] h-[2px] origin-left" style={{ background: RED, opacity: scrolled ? 1 : 0 }} />
        <style jsx>{`
          .mh-progress {
            transform: scaleX(0);
            transition: opacity 0.3s ease;
          }
          @supports (animation-timeline: scroll()) {
            .mh-progress {
              animation: mh-grow linear both;
              animation-timeline: scroll(root block);
            }
          }
          @keyframes mh-grow {
            from {
              transform: scaleX(0);
            }
            to {
              transform: scaleX(1);
            }
          }
        `}</style>
      </header>
    </>
  );
}
