'use client';

/**
 * SuiteSections — vitrine da suíte (vídeos reais do produto), como funciona,
 * preços honestos (só o Basic vende hoje; Pro = em breve), FAQ (mesma fonte
 * do JSON-LD) e CTA final.
 *
 * Regra de ouro: cada card carrega o chip do PLANO REAL (Free / Basic /
 * Pro·em breve), espelhando lib/use-tier.ts. Nada admin-only aparece.
 */

import Link from 'next/link';
import { useRef } from 'react';
import { FAQ } from '@/lib/faq';
import { DarkoLogo } from '../DarkoLogo';
import { SmokeText } from '../SmokeText';
import {
  IconAcelerador,
  IconAudioSplit,
  IconCompressor,
  IconDecupagem,
  IconDownloader,
  IconFakePass,
} from '../ToolIcons';
import { Magnetic, Reveal } from './LandingKit';
import { ProSoonChip, SectionKicker } from './FlagshipSections';

/* ────────────────────── chip de plano ────────────────────── */

type PlanTag = 'free' | 'basic' | 'pro';

function PlanChip({ plan }: { plan: PlanTag }) {
  if (plan === 'pro') return <ProSoonChip />;
  const cfg =
    plan === 'free'
      ? { label: 'Grátis', color: '#c9c9d2', border: 'rgba(201,201,210,0.35)', bg: 'rgba(201,201,210,0.08)' }
      : { label: 'Basic', color: '#f472b6', border: 'rgba(244,114,182,0.4)', bg: 'rgba(244,114,182,0.08)' };
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.18em] backdrop-blur-md"
      style={{
        fontFamily: 'var(--font-tech)',
        color: cfg.color,
        borderColor: cfg.border,
        background: cfg.bg,
      }}
    >
      {cfg.label}
    </span>
  );
}

/* ────────────────────── SUÍTE ────────────────────── */

const VIDEO_TOOLS: Array<{
  title: string;
  desc: string;
  video: string;
  poster: string;
  plan: PlanTag;
  hue: string;
}> = [
  {
    title: 'Gerador de SRT',
    desc: 'Áudio + copy entram. A legenda sai alinhada palavra por palavra, pronta pro CapCut.',
    video: '/cards/gerador-srt.mp4',
    poster: '/cards/gerador-srt.jpg',
    plan: 'basic',
    hue: 'rgba(196,181,253,0.5)',
  },
  {
    title: 'Decupagem Inteligente',
    desc: 'A IA lê a copy e escolhe o melhor take de cada frase do seu bruto.',
    video: '/cards/decupagem-inteligente.mp4',
    poster: '/cards/decupagem-inteligente.jpg',
    plan: 'pro',
    hue: 'rgba(232,121,249,0.45)',
  },
  {
    title: 'Hey Auto',
    desc: 'Lipsync em lote na sua conta do HeyGen — a fila inteira num clique, sem abrir o HeyGen.',
    video: '/cards/hey-auto.mp4',
    poster: '/cards/hey-auto.jpg',
    plan: 'pro',
    hue: 'rgba(103,232,249,0.45)',
  },
  {
    title: 'Lipsync Video to Video',
    desc: 'O rosto do seu vídeo falando qualquer áudio novo, com a boca encaixada.',
    video: '/cards/lipsync.mp4',
    poster: '/cards/lipsync.jpg',
    plan: 'pro',
    hue: 'rgba(232,121,249,0.4)',
  },
];

const ICON_TOOLS: Array<{
  title: string;
  desc: string;
  icon: React.ReactNode;
  plan: PlanTag;
  hue: string;
}> = [
  {
    title: 'Decupagem',
    desc: 'Vídeo ou áudio: o silêncio some, a fala fica. Em lote, no navegador.',
    icon: <IconDecupagem size={26} />,
    plan: 'free',
    hue: 'rgba(163,230,53,0.4)',
  },
  {
    title: 'Compressor',
    desc: 'Reduz o peso do vídeo sem perder qualidade visível.',
    icon: <IconCompressor size={26} />,
    plan: 'free',
    hue: 'rgba(129,140,248,0.4)',
  },
  {
    title: 'Downloader',
    desc: 'Baixa vídeo, áudio e imagem do YouTube, TikTok, Insta e Pinterest.',
    icon: <IconDownloader size={26} />,
    plan: 'free',
    hue: 'rgba(96,165,250,0.4)',
  },
  {
    title: 'Mixer de Velocidade',
    desc: 'Acelera ou desacelera sem ficar robótico.',
    icon: <IconAcelerador size={26} />,
    plan: 'basic',
    hue: 'rgba(251,191,36,0.4)',
  },
  {
    title: 'Dividir Áudios',
    desc: 'Divide o áudio em pedaços pelas pausas, sem cortar falas.',
    icon: <IconAudioSplit size={26} />,
    plan: 'basic',
    hue: 'rgba(34,211,238,0.4)',
  },
  {
    title: 'FakePrint',
    desc: 'Prints e stickers de redes sociais fiéis aos originais.',
    icon: <IconFakePass size={26} />,
    plan: 'free',
    hue: 'rgba(167,139,250,0.4)',
  },
];

export function SuiteSection() {
  return (
    <section id="suite" className="mx-auto mt-24 max-w-[1240px] px-5 md:mt-32 md:px-8">
      <Reveal>
        <div className="mb-12 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div className="max-w-[720px]">
            <div className="mb-4">
              <SectionKicker index="003" label="A suíte completa" />
            </div>
            <h2 className="section-title text-[38px] md:text-[54px]" style={{ lineHeight: 1.02 }}>
              <SmokeText text="Uma ferramenta" className="block" />
              <span className="block">
                <SmokeText text="pra cada gargalo." />
              </span>
            </h2>
            <p className="display-subtle mt-4 text-[18px] md:text-[20px]">
              Do bruto ao corte final — cada card mostra o plano real.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2 pb-1">
            <PlanChip plan="free" />
            <PlanChip plan="basic" />
            <PlanChip plan="pro" />
          </div>
        </div>
      </Reveal>

      {/* linha 1 — cards de vídeo (hover dá play no produto real) */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {VIDEO_TOOLS.map((t, i) => (
          <Reveal key={t.title} delay={i * 90}>
            <VideoToolCard {...t} />
          </Reveal>
        ))}
      </div>

      {/* linha 2 — utilitárias */}
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {ICON_TOOLS.map((t, i) => (
          <Reveal key={t.title} delay={i * 70}>
            <IconToolCard {...t} />
          </Reveal>
        ))}
      </div>

      <Reveal delay={120}>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center text-[13px] text-text-muted">
          <span>E ainda:</span>
          <span className="text-white/80">Camuflagem, Caixinha de Pergunta, Calculadora e Histórico.</span>
          <Link href="/planos" className="font-semibold text-violet transition-colors hover:text-white">
            Ver tudo nos planos →
          </Link>
        </div>
      </Reveal>
    </section>
  );
}

/** Card com vídeo real do produto — poster parado, play no hover. */
function VideoToolCard({
  title,
  desc,
  video,
  poster,
  plan,
  hue,
}: (typeof VIDEO_TOOLS)[number]) {
  const ref = useRef<HTMLVideoElement | null>(null);

  const play = () => {
    ref.current?.play().catch(() => {});
  };
  const stop = () => {
    const v = ref.current;
    if (!v) return;
    v.pause();
    v.currentTime = 0;
  };

  return (
    <Link
      href="/register"
      onMouseEnter={play}
      onMouseLeave={stop}
      className="group relative block overflow-hidden rounded-[20px] border border-line/60 transition-all duration-500 hover:-translate-y-1.5 hover:border-violet/50"
      style={{ boxShadow: '0 14px 30px -18px rgba(0,0,0,0.85)' }}
    >
      <div className="relative aspect-[4/5] overflow-hidden">
        <video
          ref={ref}
          src={video}
          poster={poster}
          muted
          loop
          playsInline
          preload="none"
          className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.05]"
        />
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, rgba(7,7,8,0.10) 25%, rgba(7,7,8,0.55) 62%, rgba(7,7,8,0.96) 100%)',
          }}
        />
        <div
          aria-hidden
          className="absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
          style={{
            background: `radial-gradient(70% 55% at 50% 100%, ${hue}, transparent 72%)`,
          }}
        />
        {/* chip do plano */}
        <div className="absolute left-3 top-3">
          <PlanChip plan={plan} />
        </div>
        {/* indicador de play */}
        <span
          aria-hidden
          className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full border border-white/15 bg-black/45 text-white/80 backdrop-blur-md transition-all duration-300 group-hover:border-violet/60 group-hover:bg-violet/20 group-hover:text-white"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        </span>

        <div className="absolute inset-x-0 bottom-0 p-5">
          <h3
            className="text-[19px] font-bold tracking-tight text-white"
            style={{ fontFamily: 'var(--font-tech)', letterSpacing: '-0.01em' }}
          >
            {title}
          </h3>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-white/70">{desc}</p>
        </div>
      </div>
    </Link>
  );
}

function IconToolCard({ title, desc, icon, plan, hue }: (typeof ICON_TOOLS)[number]) {
  return (
    <Link
      href="/register"
      className="group relative flex items-start gap-4 overflow-hidden rounded-[18px] border border-line/60 p-5 transition-all duration-500 hover:-translate-y-1 hover:border-violet/45"
      style={{
        background:
          'linear-gradient(180deg, rgba(255,255,255,0.025), rgba(0,0,0,0.18)), linear-gradient(180deg, rgb(var(--bg-softer)), rgb(var(--bg-soft)))',
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full opacity-40 blur-3xl transition-opacity duration-500 group-hover:opacity-90"
        style={{ background: hue }}
      />
      <span
        className="relative grid h-12 w-12 shrink-0 place-items-center rounded-[14px] border border-white/10 bg-black/40 backdrop-blur-md transition-transform duration-500 group-hover:scale-110 group-hover:-rotate-6"
        style={{ boxShadow: `0 0 28px -6px ${hue}, inset 0 1px 0 rgba(255,255,255,0.1)` }}
      >
        {icon}
      </span>
      <div className="relative min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3
            className="text-[15.5px] font-bold tracking-tight text-white"
            style={{ fontFamily: 'var(--font-tech)' }}
          >
            {title}
          </h3>
          <PlanChip plan={plan} />
        </div>
        <p className="mt-1 text-[12.5px] leading-relaxed text-text-muted">{desc}</p>
      </div>
    </Link>
  );
}

/* ────────────────────── COMO FUNCIONA ────────────────────── */

export function HowSection() {
  const steps = [
    {
      n: '01',
      title: 'Crie a conta grátis',
      desc: 'Sem cartão. Você cai direto no hub e já pode usar as ferramentas do plano grátis.',
      tint: 'rgba(200,214,132,0.4)',
    },
    {
      n: '02',
      title: 'Suba o arquivo, ligue a fila',
      desc: 'O processamento pesado de vídeo e áudio roda no seu navegador. A fila segue em segundo plano — você acompanha em tempo real.',
      tint: 'rgba(167,139,250,0.5)',
    },
    {
      n: '03',
      title: 'Volte e baixe pronto',
      desc: 'Arquivo limpo, legenda alinhada, ZIP nomeado. Você só revisa e publica.',
      tint: 'rgba(126,213,226,0.45)',
    },
  ];
  const checks = [
    'O processamento pesado de vídeo e áudio roda no seu navegador.',
    'HeyGen e Magnific rodam no seu próprio login — suas contas, suas regras.',
    'A fila continua em segundo plano e você acompanha tudo em tempo real.',
    'Sem taxa escondida, sem letra miúda. Cancela quando quiser.',
  ];

  return (
    <section className="mx-auto mt-24 max-w-[1240px] px-5 md:mt-32 md:px-8">
      <Reveal>
        <div className="mb-12 max-w-[720px]">
          <div className="mb-4">
            <SectionKicker index="004" label="Como funciona" accent="#7ed5e2" />
          </div>
          <h2 className="section-title text-[38px] md:text-[54px]" style={{ lineHeight: 1.02 }}>
            <SmokeText text="Liga a fila." className="block" />
            <span className="display-subtle block">
              <SmokeText text="O resto acontece sozinho." />
            </span>
          </h2>
        </div>
      </Reveal>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {steps.map((s, i) => (
          <Reveal key={s.n} delay={i * 110}>
            <div
              className="group relative h-full overflow-hidden rounded-[22px] border border-line/60 p-7"
              style={{
                background:
                  'linear-gradient(180deg, rgba(255,255,255,0.02), rgba(0,0,0,0.2)), linear-gradient(180deg, rgb(var(--bg-softer)), rgb(var(--bg-soft)))',
              }}
            >
              <div
                aria-hidden
                className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full opacity-50 blur-3xl transition-opacity duration-500 group-hover:opacity-100"
                style={{ background: s.tint }}
              />
              <div className="relative">
                <div
                  className="text-[46px] font-extrabold leading-none"
                  style={{
                    fontFamily: 'var(--font-tech)',
                    letterSpacing: '-0.03em',
                    background: 'linear-gradient(135deg, #fff 0%, rgba(255,255,255,0.28) 100%)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                  }}
                >
                  {s.n}
                </div>
                <h3
                  className="mt-4 text-[18px] font-bold leading-snug tracking-tight text-white"
                  style={{ fontFamily: 'var(--font-tech)' }}
                >
                  {s.title}
                </h3>
                <p className="mt-2 text-[13.5px] leading-relaxed text-text-muted">{s.desc}</p>
              </div>
            </div>
          </Reveal>
        ))}
      </div>

      <Reveal delay={160}>
        <div className="mt-6 grid grid-cols-1 gap-3 rounded-[22px] border border-line/60 bg-bg-soft/40 px-6 py-6 backdrop-blur-md sm:grid-cols-2 md:px-8">
          {checks.map((c, i) => (
            <div key={i} className="flex items-start gap-3">
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
              <span className="text-[14px] leading-relaxed text-white/90">{c}</span>
            </div>
          ))}
        </div>
      </Reveal>
    </section>
  );
}

/* ────────────────────── PREÇOS ────────────────────── */

export function PricingSection() {
  return (
    <section id="precos" className="mx-auto mt-24 max-w-[1240px] px-5 md:mt-32 md:px-8">
      <Reveal>
        <div className="mb-12 max-w-[720px]">
          <div className="mb-4">
            <SectionKicker index="005" label="Planos" accent="#f472b6" />
          </div>
          <h2 className="section-title text-[38px] md:text-[54px]" style={{ lineHeight: 1.02 }}>
            <SmokeText text="Comece grátis." className="block" />
            <span className="display-subtle block">
              <SmokeText text="Escale quando fizer sentido." />
            </span>
          </h2>
        </div>
      </Reveal>

      <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-3">
        {/* FREE */}
        <Reveal delay={0}>
          <div className="flex h-full flex-col rounded-[24px] border border-line/70 bg-bg-soft/40 p-7 backdrop-blur-md md:p-8">
            <div
              className="text-[11px] font-bold uppercase tracking-[0.22em] text-text-muted"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              Free
            </div>
            <div className="mt-4 flex items-baseline gap-1.5">
              <span
                className="num text-[42px] font-extrabold leading-none text-white"
                style={{ fontFamily: 'var(--font-tech)', letterSpacing: '-0.03em' }}
              >
                R$ 0
              </span>
            </div>
            <p className="mt-2 text-[13px] leading-relaxed text-text-muted">
              Pra sentir o corte. Sem cartão.
            </p>
            <ul className="mt-6 flex-1 space-y-2.5">
              {['Decupagem', 'Compressor', 'Downloader', 'FakePrint', 'Caixinha de Pergunta', 'Histórico'].map(
                (f) => (
                  <PriceLi key={f} text={f} tone="#c9c9d2" />
                ),
              )}
            </ul>
            <Link href="/register" className="btn-secondary mt-7 w-full !py-3 text-center">
              Criar conta grátis
            </Link>
          </div>
        </Reveal>

        {/* BASIC — destaque */}
        <Reveal delay={110}>
          <div
            className="relative flex h-full flex-col overflow-hidden rounded-[24px] border p-7 md:p-8"
            style={{
              borderColor: 'rgba(244,114,182,0.45)',
              background:
                'linear-gradient(160deg, rgba(244,114,182,0.10) 0%, rgba(167,139,250,0.10) 55%, rgba(0,0,0,0.2) 100%), linear-gradient(180deg, rgb(var(--bg-softer)), rgb(var(--bg-soft)))',
              boxShadow:
                '0 30px 60px -28px rgba(0,0,0,0.9), 0 0 54px -22px rgba(244,114,182,0.45), inset 0 1px 0 rgba(255,255,255,0.07)',
            }}
          >
            <div
              aria-hidden
              className="pointer-events-none absolute -right-14 -top-14 h-44 w-44 rounded-full opacity-60 blur-3xl"
              style={{ background: 'rgba(244,114,182,0.35)' }}
            />
            <div className="flex items-center justify-between">
              <div
                className="text-[11px] font-bold uppercase tracking-[0.22em] text-pink-300"
                style={{ fontFamily: 'var(--font-tech)', color: '#f472b6' }}
              >
                Basic
              </div>
              <span
                className="rounded-full border border-pink-400/50 bg-pink-400/10 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.18em]"
                style={{ fontFamily: 'var(--font-tech)', color: '#f9a8d4' }}
              >
                Disponível hoje
              </span>
            </div>
            <div className="mt-4 flex items-baseline gap-1.5">
              <span
                className="num text-[42px] font-extrabold leading-none text-white"
                style={{ fontFamily: 'var(--font-tech)', letterSpacing: '-0.03em' }}
              >
                R$ 57
              </span>
              <span className="text-[14px] text-text-muted">/mês</span>
            </div>
            <p className="mt-2 text-[13px] leading-relaxed text-text-muted">
              Ou R$ 540/ano, em até 12× no cartão.
            </p>
            <ul className="mt-6 flex-1 space-y-2.5">
              <PriceLi text="Tudo do Free" tone="#f472b6" strong />
              {['Gerador de SRT (legenda pela copy)', 'Camuflagem', 'Mixer de Velocidade', 'Dividir Áudios', 'Calculadora'].map(
                (f) => (
                  <PriceLi key={f} text={f} tone="#f472b6" />
                ),
              )}
            </ul>
            <Magnetic strength={6} className="mt-7">
              <Link href="/planos" className="btn-primary w-full !py-3 text-center">
                Assinar o Basic →
              </Link>
            </Magnetic>
          </div>
        </Reveal>

        {/* PRO — em breve */}
        <Reveal delay={220}>
          <div
            className="relative flex h-full flex-col overflow-hidden rounded-[24px] border border-violet/40 p-7 md:p-8"
            style={{
              background:
                'linear-gradient(160deg, rgba(167,139,250,0.12) 0%, rgba(0,0,0,0.22) 100%), linear-gradient(180deg, rgb(var(--bg-softer)), rgb(var(--bg-soft)))',
            }}
          >
            <div
              aria-hidden
              className="pointer-events-none absolute -left-14 -top-14 h-44 w-44 rounded-full opacity-50 blur-3xl"
              style={{ background: 'rgba(167,139,250,0.4)' }}
            />
            <div className="flex items-center justify-between">
              <div
                className="text-[11px] font-bold uppercase tracking-[0.22em]"
                style={{ fontFamily: 'var(--font-tech)', color: '#c4b5fd' }}
              >
                Pro
              </div>
              <ProSoonChip />
            </div>
            <div className="mt-4 flex items-baseline gap-1.5">
              <span
                className="text-[34px] font-extrabold leading-none text-white"
                style={{ fontFamily: 'var(--font-tech)', letterSpacing: '-0.02em' }}
              >
                Em breve
              </span>
            </div>
            <p className="mt-2 text-[13px] leading-relaxed text-text-muted">
              As automações completas, em fase final de lançamento.
            </p>
            <ul className="mt-6 flex-1 space-y-2.5">
              <PriceLi text="Tudo do Basic" tone="#a78bfa" strong />
              {['ClickUp Pilot', 'Auto B-roll', 'Hey Auto (lipsync em lote)', 'Lipsync Video to Video', 'Decupagem Inteligente'].map(
                (f) => (
                  <PriceLi key={f} text={f} tone="#a78bfa" />
                ),
              )}
            </ul>
            <Link
              href="/register"
              className="mt-7 inline-flex w-full items-center justify-center gap-2 rounded-full border border-violet/45 bg-violet/10 px-5 py-3 text-[13px] font-bold text-violet backdrop-blur-md transition-all duration-300 hover:-translate-y-[1px] hover:border-violet/70 hover:bg-violet/20 hover:text-white"
            >
              Criar conta e acompanhar
            </Link>
          </div>
        </Reveal>
      </div>

      <Reveal delay={150}>
        <p className="mt-6 text-center text-[12.5px] text-text-dim">
          Assinatura recorrente no cartão · gerencie e cancele direto na sua conta, sem falar com ninguém.
        </p>
      </Reveal>
    </section>
  );
}

function PriceLi({ text, tone, strong }: { text: string; tone: string; strong?: boolean }) {
  return (
    <li className="flex items-start gap-2.5">
      <svg
        width="13"
        height="13"
        viewBox="0 0 12 12"
        fill="none"
        className="mt-1 shrink-0"
        aria-hidden
      >
        <path d="M2.5 6.5l2.5 2.5 5-5.5" stroke={tone} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className={'text-[13.5px] leading-relaxed ' + (strong ? 'font-semibold text-white' : 'text-white/80')}>
        {text}
      </span>
    </li>
  );
}

/* ────────────────────── FAQ ────────────────────── */

/**
 * FAQ em <details> nativo — o conteúdo fica no HTML do SSR (crawlers de IA
 * leem sem JS) e é IDÊNTICO ao FAQPage JSON-LD montado em app/page.tsx.
 */
export function FaqSection() {
  return (
    <section id="faq" className="mx-auto mt-24 max-w-[880px] px-5 md:mt-32 md:px-8">
      <Reveal>
        <div className="mb-10 max-w-[720px]">
          <div className="mb-4">
            <SectionKicker index="006" label="Perguntas frequentes" accent="#ebc860" />
          </div>
          <h2 className="section-title text-[38px] md:text-[48px]" style={{ lineHeight: 1.02 }}>
            <SmokeText text="Tira a dúvida." className="block" />
            <span className="display-subtle block">
              <SmokeText text="Depois liga a fila." />
            </span>
          </h2>
        </div>
      </Reveal>

      <div className="flex flex-col gap-3">
        {FAQ.map((item, i) => (
          <Reveal key={i} delay={i * 50}>
            <details
              className="group overflow-hidden rounded-[16px] border border-line/60 transition-colors duration-300 hover:border-violet/40"
              style={{
                background:
                  'linear-gradient(180deg, rgba(255,255,255,0.022), rgba(0,0,0,0.16)), linear-gradient(180deg, rgb(var(--bg-softer)), rgb(var(--bg-soft)))',
              }}
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 md:px-6 md:py-5">
                <h3
                  className="text-[15px] font-semibold tracking-tight text-white md:text-[16.5px]"
                  style={{ fontFamily: 'var(--font-tech)', letterSpacing: '-0.01em' }}
                >
                  {item.q}
                </h3>
                <span
                  aria-hidden
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-white/10 bg-black/40 text-text-muted transition-transform duration-300 group-open:rotate-45"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </span>
              </summary>
              <p className="px-5 pb-5 text-[14px] leading-relaxed text-text-muted md:px-6 md:pb-6">
                {item.a}
              </p>
            </details>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/* ────────────────────── CTA FINAL ────────────────────── */

export function FinalCta() {
  return (
    <section className="mx-auto mt-24 max-w-[1140px] px-5 md:mt-32 md:px-8">
      <Reveal>
        <div
          className="relative overflow-hidden rounded-[32px] border border-line/60 px-6 py-16 text-center md:px-12 md:py-24"
          style={{
            background:
              'linear-gradient(135deg, rgba(167,139,250,0.18) 0%, rgba(224,132,176,0.10) 50%, rgba(126,213,226,0.08) 100%), linear-gradient(180deg, rgb(var(--bg-softer)), #0a0a0c)',
          }}
        >
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-60"
            style={{
              background:
                'radial-gradient(45% 60% at 0% 50%, rgba(167,139,250,0.38), transparent 60%), radial-gradient(45% 60% at 100% 50%, rgba(224,132,176,0.28), transparent 60%)',
            }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.05]"
            style={{
              backgroundImage:
                'linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)',
              backgroundSize: '46px 46px',
            }}
          />

          <div className="relative">
            <div className="fc-bunny mx-auto mb-8 w-fit">
              <div className="relative">
                <div
                  aria-hidden
                  className="absolute inset-0 -m-8 rounded-full opacity-70 blur-2xl"
                  style={{ background: 'radial-gradient(circle, rgba(167,139,250,0.55), transparent 65%)' }}
                />
                <DarkoLogo size={92} />
              </div>
            </div>

            <h2
              className="text-[42px] font-extrabold tracking-tight text-white md:text-[60px]"
              style={{ fontFamily: 'var(--font-tech)', letterSpacing: '-0.03em', lineHeight: 1.02 }}
            >
              <SmokeText text="Liga a fila." className="block" />
              <span className="display-subtle block text-[26px] md:text-[34px]">
                <SmokeText text="O resto é com o estúdio." />
              </span>
            </h2>

            <p className="mx-auto mt-5 max-w-[520px] text-[15.5px] leading-relaxed text-white/75">
              Crie a conta, ligue a primeira ferramenta e veja o dia render sem
              você no monitor.
            </p>

            <div className="mt-9 flex flex-wrap items-center justify-center gap-3.5">
              <Magnetic strength={9}>
                <Link href="/register" className="btn-primary group !px-8 !py-4 !text-[15px]">
                  <span>Começar grátis</span>
                  <span className="transition-transform duration-300 group-hover:translate-x-1">→</span>
                </Link>
              </Magnetic>
              <Magnetic strength={7}>
                <Link href="/planos" className="btn-silver !px-7 !py-4 !text-[14px]">
                  Ver planos
                </Link>
              </Magnetic>
            </div>

            <p
              className="mt-7 text-[10.5px] uppercase tracking-[0.18em] text-text-dim"
              style={{ fontFamily: 'var(--font-label), var(--font-display)', fontWeight: 600 }}
            >
              Sem cartão pra começar · roda no navegador · cancela quando quiser
            </p>
          </div>

          <style jsx>{`
            .fc-bunny {
              animation: fc-bunny-float 5.5s ease-in-out infinite;
            }
            @keyframes fc-bunny-float {
              0%, 100% { transform: translateY(0) rotate(0deg); }
              50% { transform: translateY(-10px) rotate(-2.5deg); }
            }
            @media (prefers-reduced-motion: reduce) {
              .fc-bunny { animation: none; }
            }
          `}</style>
        </div>
      </Reveal>
    </section>
  );
}

/* ────────────────────── FOOTER ────────────────────── */

export function LandingFooter() {
  return (
    <footer className="relative mx-auto mt-24 max-w-[1240px] overflow-hidden px-5 pb-10 md:px-8">
      <div className="grid grid-cols-1 gap-10 border-t border-line/60 pt-10 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-3">
            <DarkoLogo size={30} />
            <span
              className="text-[14px] font-extrabold tracking-[0.18em] text-white/90"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              AUTO EDIT
            </span>
          </div>
          <p className="mt-4 max-w-[340px] text-[13px] leading-relaxed text-text-muted">
            Suíte de automação de edição de vídeo, direto no navegador. Feita
            pra editores e agências que entregam todo dia.
          </p>
        </div>
        <div>
          <div
            className="mb-4 text-[10.5px] font-bold uppercase tracking-[0.2em] text-text-dim"
            style={{ fontFamily: 'var(--font-tech)' }}
          >
            Produto
          </div>
          <nav className="flex flex-col gap-2.5 text-[13.5px] text-text-muted">
            <a href="#suite" className="w-fit transition-colors hover:text-white">A suíte</a>
            <a href="#precos" className="w-fit transition-colors hover:text-white">Planos e preços</a>
            <Link href="/recursos" className="w-fit transition-colors hover:text-white">Recursos</Link>
            <Link href="/login" className="w-fit transition-colors hover:text-white">Entrar</Link>
          </nav>
        </div>
        <div>
          <div
            className="mb-4 text-[10.5px] font-bold uppercase tracking-[0.2em] text-text-dim"
            style={{ fontFamily: 'var(--font-tech)' }}
          >
            Legal
          </div>
          <nav className="flex flex-col gap-2.5 text-[13.5px] text-text-muted">
            <Link href="/termos" className="w-fit transition-colors hover:text-white">Termos de uso</Link>
            <Link href="/politica" className="w-fit transition-colors hover:text-white">Política de privacidade</Link>
          </nav>
        </div>
      </div>

      <div className="mt-10 flex flex-col items-start justify-between gap-3 border-t border-line/40 pt-6 md:flex-row md:items-center">
        <p className="text-[12px] text-text-dim">Auto Edit · © {new Date().getFullYear()}</p>
        <p
          className="text-[10px] uppercase tracking-[0.2em] text-text-dim"
          style={{ fontFamily: 'var(--font-label), var(--font-display)', fontWeight: 600 }}
        >
          Você dorme · o estúdio entrega
        </p>
      </div>

      {/* watermark gigante */}
      <div
        aria-hidden
        className="pointer-events-none mt-8 select-none text-center leading-none"
        style={{
          fontFamily: 'var(--font-tech)',
          fontWeight: 800,
          letterSpacing: '-0.03em',
          fontSize: 'clamp(64px, 12.5vw, 168px)',
          background: 'linear-gradient(180deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.012) 90%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
        }}
      >
        AUTO EDIT
      </div>
    </footer>
  );
}
