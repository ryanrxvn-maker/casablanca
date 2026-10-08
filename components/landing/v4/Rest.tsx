'use client';

/**
 * O resto da edição: a suíte inteira (com o plano REAL de cada ferramenta),
 * como funciona, planos, perguntas, chamada final e expediente.
 *
 * Só ferramenta que o cliente usa hoje. Nada de admin, Beta Pro ou automação
 * interna aqui — a lista bate com TIER_PATHS (lib/use-tier.ts).
 */

import Link from 'next/link';
import { useRef, type ReactNode } from 'react';
import { FAQ } from '@/lib/faq';
import { DarkoLogo } from '../../DarkoLogo';
import {
  IconAcelerador,
  IconAudioSplit,
  IconCalculadora,
  IconCamuflagem,
  IconCompressor,
  IconCopySRT,
  IconDecupagem,
  IconDownloader,
  IconFakePass,
  IconLipsync,
  IconNormalizador,
  IconTipografia,
} from '../../ToolIcons';
import { Reveal } from '../v3/kit';
import { useMagnetic, useSpotlight } from './fx';
import { Smoke } from './Smoke';
import { SectionHead } from './ui';

const RED = '#e0483f';
const VIOLET = '#c4b5fd';
const LIME = '#c8d684';

/* ══════════════════════ A SUÍTE ══════════════════════ */

type Tool = { name: string; desc: string; plan: 'free' | 'premium'; icon: ReactNode };
type Group = { title: string; tools: Tool[] };

const GROUPS: Group[] = [
  {
    title: 'Legenda e texto',
    tools: [
      {
        name: 'Legendas Automáticas',
        desc: 'Legenda animada no tempo da fala, corrigida pela copy. Usa a sua chave Groq ou AssemblyAI.',
        plan: 'premium',
        icon: <IconTipografia size={20} />,
      },
      {
        name: 'Gerador de SRT',
        desc: 'Áudio e copy entram, o .srt sai alinhado palavra por palavra. Usa a sua chave Groq ou AssemblyAI.',
        plan: 'premium',
        icon: <IconCopySRT size={20} />,
      },
      {
        name: 'FakePrint',
        desc: 'Prints de redes sociais grátis. Telejornais e sites de notícia no Premium.',
        plan: 'free',
        icon: <IconFakePass size={20} />,
      },
    ],
  },
  {
    title: 'Corte e áudio',
    tools: [
      {
        name: 'Remover Silêncios',
        desc: 'Tira silêncio e respiro em lote. Exporta áudio no Free e áudio ou vídeo no Premium.',
        plan: 'free',
        icon: <IconDecupagem size={20} />,
      },
      {
        name: 'Normalizador de Áudio',
        desc: 'Iguala o volume da voz e limpa o chiado, com relatório de antes e depois.',
        plan: 'premium',
        icon: <IconNormalizador size={20} />,
      },
      {
        name: 'Camuflagem de Áudio',
        desc: 'Duas trilhas no mesmo arquivo, com selo por plataforma.',
        plan: 'premium',
        icon: <IconCamuflagem size={20} />,
      },
      {
        name: 'Dividir Voz',
        desc: 'Quebra o áudio em pedaços pelas pausas, sem cortar fala.',
        plan: 'premium',
        icon: <IconAudioSplit size={20} />,
      },
      {
        name: 'Mixer de Velocidade',
        desc: 'Acelera ou desacelera sem deixar a voz robótica.',
        plan: 'premium',
        icon: <IconAcelerador size={20} />,
      },
    ],
  },
  {
    title: 'Vídeo, arquivo e cliente',
    tools: [
      {
        name: 'Lipsync Video to Video',
        desc: 'O rosto do seu vídeo falando um áudio novo, com a boca encaixada.',
        plan: 'premium',
        icon: <IconLipsync size={20} />,
      },
      {
        name: 'Compressor',
        desc: 'Diminui o peso do arquivo sem perder qualidade visível.',
        plan: 'free',
        icon: <IconCompressor size={20} />,
      },
      {
        name: 'Downloader',
        desc: 'Baixa vídeo e áudio de YouTube, TikTok, Instagram, Pinterest e sites +18 compatíveis. Pede a extensão do navegador e o Motor no computador (Windows; Mac em teste).',
        plan: 'free',
        icon: <IconDownloader size={20} />,
      },
      {
        name: 'Calculadora',
        desc: 'Monta o orçamento do cliente e gera o relatório pronto pra mandar.',
        plan: 'premium',
        icon: <IconCalculadora size={20} />,
      },
    ],
  },
];

/** Quantas ferramentas o cliente tem hoje. O número da página sai desta lista. */
export const FERRAMENTAS_NO_AR = GROUPS.reduce((n, g) => n + g.tools.length, 0);

export function SuiteSection() {
  return (
    <section id="suite" className="relative mx-auto mt-28 max-w-[1360px] px-5 md:mt-40 md:px-8">
      <div aria-hidden className="sec-glow" style={{ ['--g' as string]: 'rgba(167,139,250,0.09)' }} />
      <SectionHead
        tone={VIOLET}
        ask="E o resto do trabalho?"
        answer={['Uma ferramenta pra', { mark: 'cada etapa' }, 'da edição.']}
        lead="Do download da referência ao orçamento do cliente. Cada uma mostra o plano de hoje: se está aqui, está no ar."
      />

      <div className="mt-12 grid grid-cols-1 gap-x-10 gap-y-12 lg:grid-cols-3">
        {GROUPS.map((g, gi) => (
          <Reveal key={g.title} delay={gi * 70}>
            <div>
              <div className="flex items-center gap-3 border-b-2 pb-3" style={{ borderColor: 'rgba(255,255,255,0.85)' }}>
                <h3 className="text-[19px] font-bold tracking-[-0.01em] text-white" style={{ fontFamily: 'var(--font-tech)' }}>
                  {g.title}
                </h3>
                <span className="ml-auto text-[12px] text-white/40 tabular-nums" style={{ fontFamily: 'var(--font-mono)' }}>
                  {g.tools.length}
                </span>
              </div>
              <div className="flex flex-col">
                {g.tools.map((t) => (
                  <ToolRow key={t.name} {...t} />
                ))}
              </div>
            </div>
          </Reveal>
        ))}
      </div>

      <Reveal>
        <p className="mt-10 text-[14px] text-white/55">
          Todo mundo tem o Histórico das últimas entregas.{' '}
          <Link href="/planos" className="font-semibold text-white underline-offset-4 hover:underline">
            Ver o comparativo completo dos planos →
          </Link>
        </p>
      </Reveal>
    </section>
  );
}

function ToolRow({ name, desc, plan, icon }: Tool) {
  return (
    <Link href="/register" className="tr group relative flex items-start gap-3.5 border-b border-white/[0.08] py-4">
      <span className="mt-[2px] shrink-0 text-white/65 transition-all duration-300 group-hover:-translate-y-0.5 group-hover:text-white">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-[15.5px] font-bold tracking-[-0.01em] text-white" style={{ fontFamily: 'var(--font-tech)' }}>
            {name}
          </span>
          <PlanChip plan={plan} />
        </span>
        <span className="mt-1 block text-[13.5px] leading-relaxed text-white/55">{desc}</span>
      </span>
      <span aria-hidden className="pointer-events-none absolute bottom-[-1px] left-0 h-[2px] w-0 transition-all duration-500 group-hover:w-full" style={{ background: RED }} />
    </Link>
  );
}

function PlanChip({ plan }: { plan: 'free' | 'premium' }) {
  const free = plan === 'free';
  return (
    <span
      className="rounded-full border px-2 py-[1px] text-[11px] font-semibold"
      style={{
        fontFamily: 'var(--font-label)',
        color: free ? LIME : VIOLET,
        borderColor: free ? 'rgba(200,214,132,0.4)' : 'rgba(196,181,253,0.4)',
        background: free ? 'rgba(200,214,132,0.08)' : 'rgba(196,181,253,0.08)',
      }}
    >
      {free ? 'Grátis' : 'Premium'}
    </span>
  );
}

/* ══════════════════════ COMO FUNCIONA ══════════════════════ */

const STEPS = [
  {
    title: 'Cria a conta grátis',
    desc: 'Sem cartão. Você cai direto no hub e já usa Remover Silêncios em áudio, Compressor, Downloader e os modelos sociais do FakePrint.',
  },
  {
    title: 'Escolhe a ferramenta e sobe o arquivo',
    desc: 'Remover Silêncios, compressão e camuflagem processam no seu navegador. Dá pra mandar vários arquivos de uma vez e acompanhar cada um ao vivo.',
  },
  {
    title: 'Baixa pronto e publica',
    desc: 'Áudio cortado, legenda queimada no MP4, PNG em alta ou vídeo animado. Você revisa e publica.',
  },
];

const CHECKS = [
  'Remover Silêncios, compressão e camuflagem rodam no navegador: o arquivo nem sobe.',
  'No Remover Silêncios, a fila segue rodando com a aba em segundo plano.',
  'Lote em Remover Silêncios, Compressor, Camuflagem, Normalizador, Mixer e Downloader.',
  'Assinatura no cartão, cancelamento na própria conta. Sem letra miúda.',
];

export function HowSection() {
  return (
    <section id="como" className="relative mx-auto mt-28 max-w-[1360px] px-5 md:mt-40 md:px-8">
      <SectionHead
        tone={LIME}
        ask="Como eu começo?"
        answer={[{ mark: 'Três passos' }, 'e você já está editando.']}
      />

      <div className="relative mt-12">
        <span aria-hidden className="absolute left-0 right-0 top-[34px] hidden h-px bg-gradient-to-r from-white/25 via-white/10 to-transparent md:block" />
        <ol className="grid grid-cols-1 gap-10 md:grid-cols-3 md:gap-8">
          {STEPS.map((s, i) => (
            <Reveal key={s.title} delay={i * 90} as="li">
              <div className="relative">
                <span
                  className="relative z-10 grid h-[68px] w-[68px] place-items-center rounded-full border border-white/15 bg-bg text-[34px] leading-none text-white"
                  style={{ fontFamily: 'var(--font-serif)' }}
                >
                  {i + 1}
                </span>
                <h3 className="mt-5 text-[19px] font-bold leading-snug tracking-[-0.01em] text-white" style={{ fontFamily: 'var(--font-tech)' }}>
                  {s.title}
                </h3>
                <p className="mt-2 max-w-[40ch] text-[14.5px] leading-relaxed text-white/[0.58]">{s.desc}</p>
              </div>
            </Reveal>
          ))}
        </ol>
      </div>

      <Reveal delay={120}>
        <ul className="mt-12 grid grid-cols-1 gap-x-10 gap-y-3 border-t border-white/10 pt-7 sm:grid-cols-2">
          {CHECKS.map((c) => (
            <li key={c} className="flex items-start gap-3">
              <Check tone={LIME} />
              <span className="text-[14px] leading-relaxed text-white/[0.78]">{c}</span>
            </li>
          ))}
        </ul>
      </Reveal>
    </section>
  );
}

function Check({ tone }: { tone: string }) {
  return (
    <svg width="13" height="13" viewBox="0 0 12 12" fill="none" className="mt-[6px] shrink-0" aria-hidden>
      <path d="M2.5 6.4l2.4 2.4L9.6 3.4" stroke={tone} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ══════════════════════ PLANOS ══════════════════════ */

const FREE_FEATS = ['Remover Silêncios (áudio)', 'FakePrint (redes sociais)', 'Compressor', 'Downloader (inclui sites +18 compatíveis)'];
const PREMIUM_FEATS = [
  'Legendas Automáticas, com correção pela copy',
  'Remover Silêncios (áudio e vídeo)',
  'FakePrint (telejornais e sites de notícia)',
  'Camuflagem de Áudio (com selo por plataforma)',
  'Lipsync Video to Video',
  'Gerador de SRT pela copy',
  'Mixer de Velocidade (voz sem efeito robótico)',
  'Dividir Voz (sem cortar no meio da fala)',
  'Normalizador de Áudio',
  'Calculadora',
];

export function PricingSection() {
  const freeRef = useRef<HTMLDivElement | null>(null);
  const premRef = useRef<HTMLDivElement | null>(null);
  useSpotlight(freeRef);
  useSpotlight(premRef);

  return (
    <section id="planos" className="relative mx-auto mt-28 max-w-[1360px] px-5 md:mt-40 md:px-8">
      <div aria-hidden className="sec-glow" style={{ ['--g' as string]: 'rgba(167,139,250,0.10)' }} />
      <SectionHead
        tone={VIOLET}
        align="center"
        ask="Quanto custa?"
        answer={['Começa', { mark: 'grátis.' }, 'Assina quando fizer sentido.']}
      />

      <div className="mx-auto mt-12 grid max-w-[960px] grid-cols-1 items-stretch gap-4 md:grid-cols-2">
        <Reveal>
          <div ref={freeRef} className="plan relative flex h-full flex-col rounded-[16px] p-7 md:p-9" style={{ ['--tone' as string]: 'rgba(255,255,255,0.55)' }}>
            <span className="text-[15px] font-bold text-white/70" style={{ fontFamily: 'var(--font-tech)' }}>
              Free
            </span>
            <div className="mt-4 flex items-baseline gap-1.5">
              <span className="num text-[52px] font-extrabold leading-none text-white" style={{ fontFamily: 'var(--font-tech)', letterSpacing: '-0.03em' }}>
                R$ 0
              </span>
            </div>
            <p className="mt-2 text-[14px] text-white/55">Pra sentir o corte. Sem cartão, sem prazo.</p>
            <ul className="mt-7 flex-1 space-y-2.5">
              {FREE_FEATS.map((f) => (
                <Feat key={f} text={f} tone={LIME} />
              ))}
            </ul>
            <Link href="/register" className="btn-secondary mt-8 w-full !rounded-[12px] text-center">
              Criar conta grátis
            </Link>
          </div>
        </Reveal>

        <Reveal delay={90}>
          <div ref={premRef} className="plan plan-premium relative flex h-full flex-col rounded-[16px] p-7 md:p-9" style={{ ['--tone' as string]: VIOLET }}>
            <div className="flex items-center justify-between">
              <span className="text-[15px] font-bold" style={{ fontFamily: 'var(--font-tech)', color: VIOLET }}>
                Premium
              </span>
              <span className="rounded-full border px-2.5 py-0.5 text-[11.5px] font-semibold" style={{ fontFamily: 'var(--font-label)', color: VIOLET, borderColor: 'rgba(196,181,253,0.4)' }}>
                Suíte completa
              </span>
            </div>
            <div className="mt-4 flex items-baseline gap-1.5">
              <span className="num text-[52px] font-extrabold leading-none text-white" style={{ fontFamily: 'var(--font-tech)', letterSpacing: '-0.03em' }}>
                R$ 57
              </span>
              <span className="text-[15px] text-white/55">/mês</span>
            </div>
            <p className="mt-2 text-[14px] text-white/55">Ou R$ 540/ano, em até 12× no cartão.</p>
            <ul className="mt-7 flex-1 space-y-2.5">
              <Feat text="Tudo do Free" tone={VIOLET} strong />
              {PREMIUM_FEATS.map((f) => (
                <Feat key={f} text={f} tone={VIOLET} />
              ))}
            </ul>
            <Link href="/planos" className="btn-primary mt-8 w-full !rounded-[12px] text-center">
              Assinar o Premium →
            </Link>
          </div>
        </Reveal>
      </div>

      <Reveal delay={120}>
        <p className="mx-auto mt-6 max-w-[760px] text-center text-[13px] leading-relaxed text-white/45">
          Mensal: assinatura recorrente no cartão, que você cancela direto na sua conta, sem
          falar com ninguém. Anual: pagamento único no cartão, em até 12×.
        </p>
      </Reveal>

      <style jsx>{`
        .plan {
          background: linear-gradient(180deg, rgb(var(--bg-softer)), rgb(var(--bg-soft)));
          box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1);
        }
        .plan-premium {
          background: radial-gradient(120% 70% at 100% 0%, rgba(167, 139, 250, 0.16), transparent 60%),
            linear-gradient(180deg, rgb(var(--bg-softer)), rgb(var(--bg-soft)));
          box-shadow: inset 0 0 0 1px rgba(196, 181, 253, 0.32), 0 40px 90px -40px rgba(109, 78, 232, 0.45);
        }
        .plan::before {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: inherit;
          padding: 1px;
          background: radial-gradient(300px circle at var(--sx, -40%) var(--sy, -40%), var(--tone), transparent 70%);
          -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
          -webkit-mask-composite: xor;
          mask-composite: exclude;
          pointer-events: none;
        }
      `}</style>
    </section>
  );
}

function Feat({ text, tone, strong }: { text: string; tone: string; strong?: boolean }) {
  return (
    <li className="flex items-start gap-2.5">
      <Check tone={tone} />
      <span className={'text-[14.5px] leading-relaxed ' + (strong ? 'font-semibold text-white' : 'text-white/80')}>{text}</span>
    </li>
  );
}

/* ══════════════════════ PERGUNTAS ══════════════════════ */

export function FaqSection() {
  return (
    <section id="faq" className="relative mx-auto mt-28 max-w-[1360px] px-5 md:mt-40 md:px-8">
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)] lg:gap-16">
        <div className="lg:sticky lg:top-28 lg:self-start">
            <SectionHead
              tone="#ebc860"
              ask="Ficou alguma dúvida?"
              answer={['Respostas', { mark: 'rápidas' }, 'pras perguntas de sempre.']}
              lead="Não achou o que procurava? O botão de ajuda, no canto da tela, fala direto com o suporte."
            />
        </div>

        <div className="border-t border-white/10">
          {FAQ.map((item, i) => (
            <details key={i} className="fq group border-b border-white/10">
              <summary className="flex cursor-pointer list-none items-start justify-between gap-5 py-5">
                <h3 className="text-[16.5px] font-bold tracking-[-0.01em] text-white md:text-[18px]" style={{ fontFamily: 'var(--font-tech)' }}>
                  {item.q}
                </h3>
                <span
                  aria-hidden
                  className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full border border-white/15 text-[16px] leading-none text-white/60 transition-transform duration-300 group-open:rotate-45"
                >
                  +
                </span>
              </summary>
              <p className="max-w-[70ch] pb-6 pr-10 text-[15px] leading-[1.7] text-white/60">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ══════════════════════ CHAMADA FINAL ══════════════════════ */

export function FinalCta() {
  const ctaRef = useRef<HTMLAnchorElement | null>(null);
  useMagnetic(ctaRef, 0.2);
  return (
    <section className="mt-28 md:mt-40">
      <Reveal>
        <div className="mx-auto max-w-[1360px] px-5 md:px-8">
          <div className="fc relative overflow-hidden rounded-[20px] px-6 py-16 md:px-16 md:py-24">
            <Smoke className="absolute inset-0 h-full w-full opacity-90" />
            <div aria-hidden className="fc-grid pointer-events-none absolute inset-0" />
            <div className="relative grid grid-cols-1 items-center gap-10 lg:grid-cols-[1.4fr_0.6fr]">
              <div>
                <SectionHead
                  tone={RED}
                  size="xl"
                  ask="Bora parar de editar no braço?"
                  answer={['Cria a sua conta', { mark: 'grátis' }, 'agora.']}
                  lead="Não pede cartão. Você começa pelo plano grátis e decide o resto depois."
                />
                <div className="mt-9 flex flex-wrap items-center gap-3">
                  <Link ref={ctaRef} href="/register" className="btn-primary !rounded-[12px] !px-7 !text-[15px]">
                    Criar conta grátis →
                  </Link>
                  <Link href="/login" className="btn-secondary !rounded-[12px] !px-6 !text-[14.5px]">
                    Já tenho conta
                  </Link>
                </div>
              </div>
              <div className="hidden justify-center lg:flex">
                <div className="relative">
                  <div aria-hidden className="absolute inset-0 -m-12 rounded-full opacity-60 blur-3xl" style={{ background: 'radial-gradient(circle, rgba(167,139,250,0.45), transparent 65%)' }} />
                  <div className="fc-float ae-ambient relative">
                    <DarkoLogo size={150} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Reveal>
      <style jsx>{`
        .fc {
          background: radial-gradient(80% 90% at 0% 0%, rgba(224, 72, 63, 0.12), transparent 55%),
            radial-gradient(70% 90% at 100% 100%, rgba(167, 139, 250, 0.18), transparent 60%),
            linear-gradient(180deg, rgb(var(--bg-softer)), #08080a);
          box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1);
        }
        .fc-grid {
          opacity: 0.05;
          background-image: linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px);
          background-size: 56px 56px;
          -webkit-mask-image: radial-gradient(80% 80% at 70% 50%, #000, transparent);
          mask-image: radial-gradient(80% 80% at 70% 50%, #000, transparent);
        }
        .fc-float {
          animation: fc-float 6s ease-in-out infinite;
        }
        @keyframes fc-float {
          0%,
          100% {
            transform: translateY(0) rotate(0deg);
          }
          50% {
            transform: translateY(-14px) rotate(-3deg);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .fc-float {
            animation: none;
          }
        }
      `}</style>
    </section>
  );
}

/* ══════════════════════ RODAPÉ ══════════════════════ */

export function LandingFooter() {
  const litRef = useRef<HTMLSpanElement | null>(null);
  useSpotlight(litRef);
  const toTop = () => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
  };

  return (
    <footer className="lf relative isolate mt-24 overflow-hidden md:mt-32">
      {/* fio de luz no topo, nas cores da página */}
      <span aria-hidden className="lf-line absolute inset-x-0 top-0 h-px" />
      {/* fumaça curta subindo da base, atrás do nome gigante */}
      <Smoke band className="lf-smoke absolute inset-x-0 bottom-0 -z-10 h-[86%] w-full" />

      <div className="relative mx-auto max-w-[1360px] px-5 pt-16 md:px-8 md:pt-20">
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 md:grid-cols-[1.6fr_1fr_1fr_1fr] md:gap-12">
          <div className="col-span-2 md:col-span-1">
            <div className="flex items-center gap-3">
              <DarkoLogo size={34} />
              <span className="text-[24px] leading-none text-white" style={{ fontFamily: 'var(--font-serif)' }}>
                Auto Edit
              </span>
            </div>
            <p className="mt-5 max-w-[36ch] text-[15px] leading-relaxed text-white/60">
              Legenda, corte de silêncio e manchete de telejornal num lugar só, abrindo no
              navegador. Feito pra editores e agências que entregam criativo todo dia.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link href="/register" className="btn-primary !min-h-[44px] !rounded-[11px] !px-5 !text-[14px]">
                Criar conta grátis
              </Link>
              <a
                href="https://www.instagram.com/darkoautoedit/"
                target="_blank"
                rel="noopener noreferrer"
                className="lf-ig group inline-flex min-h-[44px] items-center gap-2.5 rounded-[11px] px-4 text-[14px] font-semibold text-white/80 transition-colors hover:text-white"
                style={{ fontFamily: 'var(--font-label)' }}
              >
                <span aria-hidden className="lf-ig-ico grid h-6 w-6 place-items-center rounded-[7px]">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2">
                    <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
                    <circle cx="12" cy="12" r="4" />
                    <circle cx="17.4" cy="6.6" r="1.1" fill="#fff" stroke="none" />
                  </svg>
                </span>
                @darkoautoedit
              </a>
            </div>
          </div>
          <FooterCol
            title="Produto"
            links={[
              { label: 'Legendas', href: '#legendas' },
              { label: 'Corrigir pela copy', href: '#corrigir' },
              { label: 'FakePrint', href: '#fakeprint' },
              { label: 'Ferramentas', href: '#suite' },
              { label: 'Planos', href: '#planos' },
            ]}
          />
          <FooterCol
            title="Conta"
            links={[
              { label: 'Entrar', href: '/login' },
              { label: 'Criar conta grátis', href: '/register' },
              { label: 'Recursos', href: '/recursos' },
              { label: 'Dúvidas', href: '#faq' },
            ]}
          />
          <FooterCol
            title="Legal"
            links={[
              { label: 'Termos de uso', href: '/termos' },
              { label: 'Assinatura e cancelamento', href: '/politica' },
            ]}
          />
        </div>
      </div>

      {/* o nome gigante, cortado pela borda de baixo; acende onde o mouse passa */}
      <div aria-hidden className="lf-mark relative mt-14 select-none md:mt-20">
        <span className="lf-word lf-word-base">Auto Edit</span>
        <span ref={litRef} className="lf-word lf-word-lit">Auto Edit</span>
      </div>

      <div className="relative border-t border-white/10 bg-[#08080a]/80">
        <div className="mx-auto flex max-w-[1360px] flex-col items-start justify-between gap-3 px-5 py-5 pr-24 md:flex-row md:items-center md:px-8 md:pr-28">
          <p className="text-[12.5px] text-white/45">Auto Edit © {new Date().getFullYear()}. Feito pra quem entrega 10x mais.</p>
          <button
            type="button"
            onClick={toTop}
            className="group inline-flex items-center gap-2 text-[12.5px] font-semibold text-white/55 transition-colors hover:text-white"
            style={{ fontFamily: 'var(--font-label)' }}
          >
            Voltar ao topo
            <span
              aria-hidden
              className="grid h-6 w-6 place-items-center rounded-full border border-white/15 transition-transform duration-300 group-hover:-translate-y-0.5"
            >
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                <path d="M6 10V2m0 0L2.5 5.5M6 2l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </button>
        </div>
      </div>

      <style jsx>{`
        .lf {
          background: radial-gradient(70% 60% at 50% 110%, rgba(167, 139, 250, 0.1), transparent 70%), #09090b;
        }
        .lf-line {
          background: linear-gradient(90deg, transparent, rgba(224, 72, 63, 0.7) 25%, rgba(196, 181, 253, 0.8) 60%, transparent);
          box-shadow: 0 0 22px 1px rgba(196, 181, 253, 0.25);
        }
        :global(.lf-smoke) {
          -webkit-mask-image: linear-gradient(to bottom, transparent 0%, #000 45%);
          mask-image: linear-gradient(to bottom, transparent 0%, #000 45%);
        }
        .lf-ig {
          box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.14);
          background: rgba(255, 255, 255, 0.03);
        }
        .lf-ig:hover {
          box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.3);
        }
        .lf-ig-ico {
          background: linear-gradient(45deg, #feda75, #fa7e1e 30%, #d62976 55%, #962fbf 80%, #4f5bd5);
        }
        .lf-mark {
          height: clamp(86px, 15.5vw, 236px);
          overflow: hidden;
        }
        .lf-word {
          position: absolute;
          left: 50%;
          top: 0;
          transform: translateX(-50%);
          white-space: nowrap;
          font-family: var(--font-serif);
          font-size: clamp(120px, 22vw, 340px);
          line-height: 0.86;
          letter-spacing: -0.03em;
        }
        /* o nome em vidro: quase apagado, some pra baixo */
        .lf-word-base {
          color: rgba(255, 255, 255, 0.1);
          -webkit-mask-image: linear-gradient(to bottom, #000 30%, transparent 92%);
          mask-image: linear-gradient(to bottom, #000 30%, transparent 92%);
        }
        /* a cópia acesa só aparece num círculo em volta do mouse (variável no PRÓPRIO elemento) */
        .lf-word-lit {
          color: #f4edff;
          text-shadow: 0 0 40px rgba(196, 181, 253, 0.55), 0 0 90px rgba(224, 72, 63, 0.35);
          -webkit-mask-image: radial-gradient(280px circle at var(--sx, -40%) var(--sy, -40%), #000 0%, rgba(0, 0, 0, 0.35) 45%, transparent 72%);
          mask-image: radial-gradient(280px circle at var(--sx, -40%) var(--sy, -40%), #000 0%, rgba(0, 0, 0, 0.35) 45%, transparent 72%);
          opacity: 0;
          transition: opacity 0.45s ease;
        }
        .lf-mark:hover .lf-word-lit {
          opacity: 1;
        }
      `}</style>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: Array<{ label: string; href: string }> }) {
  return (
    <div>
      <div className="mb-4 text-[13px] font-semibold text-white/45" style={{ fontFamily: 'var(--font-label)' }}>
        {title}
      </div>
      <nav className="flex flex-col gap-2.5 text-[14px] text-white/65">
        {links.map((l) =>
          l.href.startsWith('#') ? (
            <a key={l.label} href={l.href} className="w-fit transition-colors hover:text-white">
              {l.label}
            </a>
          ) : (
            <Link key={l.label} href={l.href} className="w-fit transition-colors hover:text-white">
              {l.label}
            </Link>
          ),
        )}
      </nav>
    </div>
  );
}
