'use client';

/**
 * sections — corpo da landing v3.
 *
 *   01 EM DESTAQUE  → os três blocos-herói (Camuflagem, Decupagem, FakePrint),
 *                     cada um com paleta, cena e copy próprias.
 *   02 A SUÍTE      → grade de programação: toda ferramenta com o PLANO REAL.
 *   03 COMO FUNCIONA
 *   04 PLANOS       → Free e Premium (os dois planos que existem).
 *   05 PERGUNTAS    → mesma fonte do JSON-LD (lib/faq.ts), em <details> pro SSR.
 *
 * Copy: só o que o cliente usa hoje, sem absoluto e sem promessa que a
 * ferramenta não cumpre. O selo da Camuflagem é apresentado como verificação —
 * porque é exatamente isso que ele é.
 */

import Link from 'next/link';
import type { ReactNode } from 'react';
import { FAQ } from '@/lib/faq';
import { DarkoLogo } from '../../DarkoLogo';
import {
  IconAcelerador,
  IconAudioSplit,
  IconCalculadora,
  IconCamuflagem,
  IconCompressor,
  IconCopySRT,
  IconDecupageCopy,
  IconDecupagem,
  IconDownloader,
  IconFakePass,
  IconLipsync,
} from '../../ToolIcons';
import { Kicker, Reveal, Ticker } from './kit';
import { CamuflagemScene, DecupagemScene, MiniPrints, NewspaperCard } from './scenes';

const RED = '#e0483f';

/* ══════════════════════ 01 · EM DESTAQUE ══════════════════════ */

type Highlight = {
  tag: string;
  tone: string;
  title: ReactNode;
  lead: string;
  bullets: string[];
  note?: string;
  scene: ReactNode;
  /** cena à direita (default) ou à esquerda */
  flip?: boolean;
};

const HIGHLIGHTS: Highlight[] = [
  {
    tag: 'Camuflagem de áudio',
    tone: '#3ec7bb',
    title: (
      <>
        Duas trilhas no <span className="text-editorial">mesmo arquivo</span>.
      </>
    ),
    lead:
      'Quem assiste ouve o seu áudio normalmente. A transcrição automática das plataformas lê a trilha que você deixou por baixo — você escolhe qual é, ou usa o modo mudo e deixa a IA ouvir silêncio.',
    bullets: [
      'Sobe original + escondido, ajusta a intensidade e baixa em MP4, MP3 ou WAV',
      'Até 10 pares por vez, com o vídeo saindo com a trilha já trocada',
      'Descamuflar devolve qualquer camada — e dá pra trocar o escondido sem regravar',
    ],
    note:
      'No fim, a ferramenta escuta o arquivo pronto do mesmo jeito que a plataforma escuta e mostra o selo por plataforma. Sem selo verde, não publique.',
    scene: <CamuflagemScene />,
  },
  {
    tag: 'Decupagem automática',
    tone: '#c8d684',
    title: (
      <>
        O silêncio sai. <span className="text-editorial">A fala fica.</span>
      </>
    ),
    lead:
      'Sobe o bruto — vídeo ou áudio — e ele volta sem tempo morto, sem respiro no meio da frase e com a voz já nivelada. Você decide quanta pausa quer manter: corte seco de anúncio ou respiro natural.',
    bullets: [
      'Fila em lote: vários arquivos de uma vez, um atrás do outro',
      'Volume nivelado antes do corte — dois locutores no mesmo patamar',
      'O ataque das palavras é preservado: nenhuma sílaba comida na entrada',
    ],
    note:
      'Roda no seu navegador. Arquivo grande é dividido em partes e remontado num arquivo só no final.',
    scene: <DecupagemScene />,
    flip: true,
  },
  {
    tag: 'FakePrint',
    tone: RED,
    title: (
      <>
        A manchete do seu criativo, <span className="text-editorial">pronta pra ilha</span>.
      </>
    ),
    lead:
      'Telejornal, site de notícia, conversa de WhatsApp, chamada de vídeo, post e story do Instagram, notificação de celular e live. São 40 modelos: você preenche os campos e a manchete é sua.',
    bullets: [
      'Prévia ao vivo: o print muda a cada tecla, e o que você vê é o PNG que baixa',
      'Tela verde em tudo que é cena — telejornal, site e live prontos pro chroma key',
      'Telejornais e lives exportam .webm animado: relógio andando, reações subindo',
    ],
    note:
      'A barra de status do celular é editável até a bateria: 63% às 21:47 conta uma história, 100% às 9:00 conta outra.',
    scene: (
      <div>
        <NewspaperCard />
        <MiniPrints className="mt-7" />
      </div>
    ),
  },
];

export function HighlightsSection() {
  return (
    <section id="destaques" className="mx-auto mt-20 max-w-[1200px] px-5 md:mt-28 md:px-8">
      <Reveal>
        <div className="max-w-[760px]">
          <Kicker index="01" label="Em destaque" />
          <h2 className="section-title mt-5 text-[36px] md:text-[52px]">
            Três ferramentas que resolvem
            <br />
            <span className="text-editorial text-white/70">o gargalo do dia.</span>
          </h2>
          <p className="mt-4 text-[15.5px] leading-relaxed text-text-muted">
            O resto da suíte você conhece na seção seguinte. Estas três são as que mudam
            o tamanho da sua entrega.
          </p>
        </div>
      </Reveal>

      <div className="mt-14 flex flex-col gap-16 md:mt-20 md:gap-24">
        {HIGHLIGHTS.map((h, i) => (
          <HighlightBlock key={h.tag} {...h} index={i + 1} />
        ))}
      </div>
    </section>
  );
}

function HighlightBlock({
  tag,
  tone,
  title,
  lead,
  bullets,
  note,
  scene,
  flip,
  index,
}: Highlight & { index: number }) {
  return (
    <Reveal>
      <div className="grid grid-cols-1 items-center gap-9 lg:grid-cols-2 lg:gap-14">
        {/* texto */}
        <div className={flip ? 'lg:order-2' : ''}>
          <div className="flex items-center gap-3">
            <span
              className="inline-flex items-center rounded-[4px] px-2 py-1 text-[9.5px] font-bold uppercase tracking-[0.2em]"
              style={{
                fontFamily: 'var(--font-label)',
                color: tone,
                border: `1px solid ${tone}55`,
                background: `${tone}14`,
              }}
            >
              {tag}
            </span>
            <span
              className="num text-[11px] tracking-[0.24em] text-white/25"
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              0{index}
            </span>
          </div>

          <h3
            className="mt-4 text-[30px] font-extrabold leading-[1.04] tracking-[-0.02em] text-white md:text-[40px]"
            style={{ fontFamily: 'var(--font-tech)' }}
          >
            {title}
          </h3>

          <p className="mt-4 max-w-[54ch] text-[15px] leading-relaxed text-text-muted">{lead}</p>

          <ul className="mt-6 flex flex-col gap-3">
            {bullets.map((b) => (
              <li key={b} className="flex items-start gap-3">
                <span
                  aria-hidden
                  className="mt-[7px] block h-[5px] w-[5px] shrink-0 rounded-full"
                  style={{ background: tone, boxShadow: `0 0 10px -1px ${tone}` }}
                />
                <span className="text-[14px] leading-relaxed text-white/85">{b}</span>
              </li>
            ))}
          </ul>

          {note && (
            <p
              className="mt-6 border-l-2 pl-4 text-[13px] leading-relaxed text-text-muted"
              style={{ borderColor: `${tone}66` }}
            >
              {note}
            </p>
          )}
        </div>

        {/* cena */}
        <div className={flip ? 'lg:order-1' : ''}>{scene}</div>
      </div>
    </Reveal>
  );
}

/* ══════════════════════ 02 · A SUÍTE ══════════════════════ */

type Tool = {
  name: string;
  desc: string;
  plan: 'free' | 'premium';
  icon: ReactNode;
};

const TOOLS: Tool[] = [
  {
    name: 'Decupagem',
    desc: 'Corta silêncio e respiro de vídeo ou áudio, em lote.',
    plan: 'free',
    icon: <IconDecupagem size={20} />,
  },
  {
    name: 'FakePrint',
    desc: '40 modelos de print: telejornal, site, conversa, post, story e live.',
    plan: 'free',
    icon: <IconFakePass size={20} />,
  },
  {
    name: 'Compressor',
    desc: 'Reduz o peso do arquivo sem perder qualidade visível.',
    plan: 'free',
    icon: <IconCompressor size={20} />,
  },
  {
    name: 'Downloader',
    desc: 'Baixa vídeo, áudio e imagem de YouTube, TikTok, Insta e Pinterest.',
    plan: 'free',
    icon: <IconDownloader size={20} />,
  },
  {
    name: 'Camuflagem',
    desc: 'Duas trilhas no mesmo arquivo, com selo por plataforma.',
    plan: 'premium',
    icon: <IconCamuflagem size={20} />,
  },
  {
    name: 'Lipsync Video to Video',
    desc: 'O rosto do seu vídeo falando um áudio novo, com a boca encaixada.',
    plan: 'premium',
    icon: <IconLipsync size={20} />,
  },
  {
    name: 'Decupagem Inteligente',
    desc: 'A IA lê a copy e escolhe o melhor take de cada frase do bruto.',
    plan: 'premium',
    icon: <IconDecupageCopy size={20} />,
  },
  {
    name: 'Gerador de SRT',
    desc: 'Áudio + copy entram; a legenda sai alinhada palavra por palavra.',
    plan: 'premium',
    icon: <IconCopySRT size={20} />,
  },
  {
    name: 'Mixer de Velocidade',
    desc: 'Acelera ou desacelera sem deixar a voz robótica.',
    plan: 'premium',
    icon: <IconAcelerador size={20} />,
  },
  {
    name: 'Dividir Áudios',
    desc: 'Quebra o áudio em pedaços pelas pausas, sem cortar fala.',
    plan: 'premium',
    icon: <IconAudioSplit size={20} />,
  },
  {
    name: 'Calculadora',
    desc: 'Faz a conta de duração, peso e entrega antes de você começar.',
    plan: 'premium',
    icon: <IconCalculadora size={20} />,
  },
];

export function SuiteSection() {
  return (
    <section id="suite" className="mx-auto mt-24 max-w-[1200px] px-5 md:mt-32 md:px-8">
      <Reveal>
        <div className="flex flex-col gap-5 border-b border-white/10 pb-7 md:flex-row md:items-end md:justify-between">
          <div className="max-w-[640px]">
            <Kicker index="02" label="A suíte inteira" />
            <h2 className="section-title mt-5 text-[36px] md:text-[52px]">
              Uma ferramenta
              <br />
              <span className="text-editorial text-white/70">pra cada gargalo.</span>
            </h2>
          </div>
          <p className="max-w-[340px] text-[13.5px] leading-relaxed text-text-muted">
            Cada linha mostra o plano real de hoje. Nada de “em breve”: se está na
            lista, está no ar.
          </p>
        </div>
      </Reveal>

      <div className="grid grid-cols-1 md:grid-cols-2">
        {TOOLS.map((t, i) => (
          <Reveal key={t.name} delay={(i % 2) * 60}>
            <ToolRow {...t} index={i + 1} />
          </Reveal>
        ))}
      </div>

      <Reveal>
        <p className="mt-8 text-[13.5px] text-text-muted">
          Todo mundo tem Histórico das últimas entregas.{' '}
          <Link href="/planos" className="font-semibold text-white underline-offset-4 hover:underline">
            Ver o comparativo completo dos planos →
          </Link>
        </p>
      </Reveal>
    </section>
  );
}

function ToolRow({ name, desc, plan, icon, index }: Tool & { index: number }) {
  return (
    <Link
      href="/register"
      className="tr group relative flex items-start gap-4 border-b border-white/8 py-5 pr-3 transition-colors duration-300 hover:bg-white/[0.025] md:py-6"
    >
      <span
        className="num mt-[3px] w-6 shrink-0 text-[10.5px] tracking-[0.16em] text-white/25 transition-colors duration-300 group-hover:text-white/50"
        style={{ fontFamily: 'var(--font-mono)' }}
      >
        {String(index).padStart(2, '0')}
      </span>
      <span className="mt-[1px] shrink-0 text-white/70 transition-colors duration-300 group-hover:text-white">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span
            className="text-[16px] font-bold tracking-[-0.01em] text-white"
            style={{ fontFamily: 'var(--font-tech)' }}
          >
            {name}
          </span>
          <PlanChip plan={plan} />
        </span>
        <span className="mt-1 block text-[13px] leading-relaxed text-text-muted">{desc}</span>
      </span>
      <span
        aria-hidden
        className="mt-1 translate-x-[-4px] text-[14px] text-white/0 transition-all duration-300 group-hover:translate-x-0 group-hover:text-white/50"
      >
        →
      </span>
      <span
        aria-hidden
        className="pointer-events-none absolute bottom-[-1px] left-0 h-[2px] w-0 transition-all duration-500 group-hover:w-full"
        style={{ background: RED }}
      />
    </Link>
  );
}

function PlanChip({ plan }: { plan: 'free' | 'premium' }) {
  const free = plan === 'free';
  return (
    <span
      className="rounded-[3px] border px-1.5 py-[2px] text-[8.5px] font-bold uppercase tracking-[0.18em]"
      style={{
        fontFamily: 'var(--font-label)',
        color: free ? '#c8d684' : '#c4b5fd',
        borderColor: free ? 'rgba(200,214,132,0.4)' : 'rgba(196,181,253,0.4)',
        background: free ? 'rgba(200,214,132,0.08)' : 'rgba(196,181,253,0.08)',
      }}
    >
      {free ? 'Grátis' : 'Premium'}
    </span>
  );
}

/* ══════════════════════ 03 · COMO FUNCIONA ══════════════════════ */

const STEPS = [
  {
    n: '01',
    title: 'Cria a conta grátis',
    desc: 'Sem cartão. Você cai direto no hub e já usa as ferramentas do plano grátis — inclusive o FakePrint inteiro.',
  },
  {
    n: '02',
    title: 'Sobe o arquivo e liga a fila',
    desc: 'Decupagem, compressão e camuflagem processam no seu navegador. A fila segue em segundo plano e mostra a fase de cada item ao vivo.',
  },
  {
    n: '03',
    title: 'Volta e baixa pronto',
    desc: 'Arquivo cortado, legenda alinhada, ZIP nomeado, PNG em alta ou .webm animado. Você revisa e publica.',
  },
];

const CHECKS = [
  'Decupagem, compressão e camuflagem rodam no navegador — o arquivo nem sobe.',
  'A fila continua em segundo plano enquanto você faz outra coisa.',
  'Lote em todas as ferramentas de arquivo: vários itens na mesma fila.',
  'Assinatura no cartão, cancelamento na própria conta. Sem letra miúda.',
];

export function HowSection() {
  return (
    <section id="como" className="mx-auto mt-24 max-w-[1200px] px-5 md:mt-32 md:px-8">
      <Reveal>
        <div className="max-w-[680px]">
          <Kicker index="03" label="Como funciona" tone="#c8d684" />
          <h2 className="section-title mt-5 text-[36px] md:text-[52px]">
            Liga a fila.
            <br />
            <span className="text-editorial text-white/70">Volta pra baixar.</span>
          </h2>
        </div>
      </Reveal>

      <div className="mt-12 grid grid-cols-1 gap-px overflow-hidden rounded-[14px] border border-white/10 bg-white/10 md:grid-cols-3">
        {STEPS.map((s, i) => (
          <Reveal key={s.n} delay={i * 90}>
            <div className="hs h-full bg-bg-soft/80 p-7 transition-colors duration-500 hover:bg-bg-soft md:p-8">
              <span
                className="block text-[44px] leading-none text-white/15"
                style={{ fontFamily: 'var(--font-serif)' }}
              >
                {s.n}
              </span>
              <h3
                className="mt-4 text-[17.5px] font-bold leading-snug tracking-[-0.01em] text-white"
                style={{ fontFamily: 'var(--font-tech)' }}
              >
                {s.title}
              </h3>
              <p className="mt-2 text-[13.5px] leading-relaxed text-text-muted">{s.desc}</p>
            </div>
          </Reveal>
        ))}
      </div>

      <Reveal delay={120}>
        <div className="mt-4 grid grid-cols-1 gap-x-8 gap-y-3 rounded-[14px] border border-white/10 px-6 py-6 sm:grid-cols-2 md:px-8">
          {CHECKS.map((c) => (
            <div key={c} className="flex items-start gap-3">
              <svg width="13" height="13" viewBox="0 0 12 12" fill="none" className="mt-[5px] shrink-0" aria-hidden>
                <path d="M2.5 6.4l2.4 2.4L9.6 3.4" stroke="#c8d684" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="text-[13.5px] leading-relaxed text-white/85">{c}</span>
            </div>
          ))}
        </div>
      </Reveal>
    </section>
  );
}

/* ══════════════════════ 04 · PLANOS ══════════════════════ */

export function PricingSection() {
  return (
    <section id="planos" className="mx-auto mt-24 max-w-[1200px] px-5 md:mt-32 md:px-8">
      <Reveal>
        <div className="max-w-[680px]">
          <Kicker index="04" label="Planos" tone="#c4b5fd" />
          <h2 className="section-title mt-5 text-[36px] md:text-[52px]">
            Começa grátis.
            <br />
            <span className="text-editorial text-white/70">Assina quando fizer sentido.</span>
          </h2>
        </div>
      </Reveal>

      <div className="mx-auto mt-12 grid max-w-[900px] grid-cols-1 items-stretch gap-4 md:grid-cols-2">
        <Reveal>
          <div className="flex h-full flex-col rounded-[16px] border border-white/12 bg-bg-soft/50 p-7 md:p-8">
            <span
              className="text-[10.5px] font-bold uppercase tracking-[0.24em] text-text-muted"
              style={{ fontFamily: 'var(--font-label)' }}
            >
              Free
            </span>
            <div className="mt-5 flex items-baseline gap-1.5">
              <span
                className="num text-[40px] font-extrabold leading-none text-white"
                style={{ fontFamily: 'var(--font-tech)', letterSpacing: '-0.03em' }}
              >
                R$ 0
              </span>
            </div>
            <p className="mt-2 text-[13px] leading-relaxed text-text-muted">
              Pra sentir o corte. Sem cartão, sem prazo.
            </p>
            <ul className="mt-7 flex-1 space-y-2.5">
              {['Decupagem', 'FakePrint (40 modelos, com Caixinha de Pergunta)', 'Compressor', 'Downloader', 'Histórico'].map(
                (f) => (
                  <Feat key={f} text={f} tone="#c8d684" />
                ),
              )}
            </ul>
            <Link href="/register" className="btn-secondary mt-8 w-full !py-3 text-center">
              Criar conta grátis
            </Link>
          </div>
        </Reveal>

        <Reveal delay={90}>
          <div
            className="relative flex h-full flex-col overflow-hidden rounded-[16px] border p-7 md:p-8"
            style={{
              borderColor: 'rgba(196,181,253,0.4)',
              background:
                'linear-gradient(165deg, rgba(167,139,250,0.12) 0%, rgba(0,0,0,0.25) 70%), linear-gradient(180deg, rgb(var(--bg-softer)), rgb(var(--bg-soft)))',
              boxShadow: '0 30px 70px -34px rgba(0,0,0,0.95)',
            }}
          >
            <div className="flex items-center justify-between">
              <span
                className="text-[10.5px] font-bold uppercase tracking-[0.24em]"
                style={{ fontFamily: 'var(--font-label)', color: '#c4b5fd' }}
              >
                Premium
              </span>
              <span
                className="rounded-[3px] border px-2 py-1 text-[8.5px] font-bold uppercase tracking-[0.18em]"
                style={{
                  fontFamily: 'var(--font-label)',
                  color: '#c4b5fd',
                  borderColor: 'rgba(196,181,253,0.4)',
                }}
              >
                Suíte completa
              </span>
            </div>
            <div className="mt-5 flex items-baseline gap-1.5">
              <span
                className="num text-[40px] font-extrabold leading-none text-white"
                style={{ fontFamily: 'var(--font-tech)', letterSpacing: '-0.03em' }}
              >
                R$ 57
              </span>
              <span className="text-[14px] text-text-muted">/mês</span>
            </div>
            <p className="mt-2 text-[13px] leading-relaxed text-text-muted">
              Ou R$ 540/ano, em até 12× no cartão.
            </p>
            <ul className="mt-7 flex-1 space-y-2.5">
              <Feat text="Tudo do Free" tone="#c4b5fd" strong />
              {[
                'Camuflagem (com selo por plataforma)',
                'Lipsync Video to Video',
                'Decupagem Inteligente',
                'Gerador de SRT pela copy',
                'Mixer de Velocidade',
                'Dividir Áudios',
                'Calculadora',
              ].map((f) => (
                <Feat key={f} text={f} tone="#c4b5fd" />
              ))}
            </ul>
            <Link href="/planos" className="btn-primary mt-8 w-full !py-3 text-center">
              Assinar o Premium →
            </Link>
          </div>
        </Reveal>
      </div>

      <Reveal delay={120}>
        <p className="mt-6 text-center text-[12.5px] text-text-dim">
          Assinatura recorrente no cartão · você gerencia e cancela direto na sua conta,
          sem falar com ninguém.
        </p>
      </Reveal>
    </section>
  );
}

function Feat({ text, tone, strong }: { text: string; tone: string; strong?: boolean }) {
  return (
    <li className="flex items-start gap-2.5">
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="mt-[6px] shrink-0" aria-hidden>
        <path d="M2.5 6.4l2.4 2.4L9.6 3.4" stroke={tone} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className={'text-[13.5px] leading-relaxed ' + (strong ? 'font-semibold text-white' : 'text-white/80')}>
        {text}
      </span>
    </li>
  );
}

/* ══════════════════════ 05 · PERGUNTAS ══════════════════════ */

export function FaqSection() {
  return (
    <section id="faq" className="mx-auto mt-24 max-w-[900px] px-5 md:mt-32 md:px-8">
      <Reveal>
        <div className="max-w-[640px]">
          <Kicker index="05" label="Perguntas frequentes" tone="#ebc860" />
          <h2 className="section-title mt-5 text-[36px] md:text-[48px]">
            Tira a dúvida.
            <br />
            <span className="text-editorial text-white/70">Depois liga a fila.</span>
          </h2>
        </div>
      </Reveal>

      <div className="mt-10 border-t border-white/10">
        {FAQ.map((item, i) => (
          <details key={i} className="fq group border-b border-white/10">
            <summary className="flex cursor-pointer list-none items-start justify-between gap-5 py-5">
              <span className="flex items-start gap-4">
                <span
                  className="num mt-[3px] text-[10.5px] tracking-[0.16em] text-white/25"
                  style={{ fontFamily: 'var(--font-mono)' }}
                >
                  {String(i + 1).padStart(2, '0')}
                </span>
                <h3
                  className="text-[15.5px] font-bold tracking-[-0.01em] text-white md:text-[17px]"
                  style={{ fontFamily: 'var(--font-tech)' }}
                >
                  {item.q}
                </h3>
              </span>
              <span
                aria-hidden
                className="mt-1 shrink-0 text-[15px] leading-none text-white/40 transition-transform duration-300 group-open:rotate-45"
              >
                +
              </span>
            </summary>
            <p className="max-w-[70ch] pb-6 pl-10 text-[14px] leading-relaxed text-text-muted">
              {item.a}
            </p>
          </details>
        ))}
      </div>
    </section>
  );
}

/* ══════════════════════ CTA FINAL ══════════════════════ */

export function FinalCta() {
  return (
    <section className="mt-24 md:mt-32">
      <Reveal>
        <div className="mx-auto max-w-[1200px] px-5 md:px-8">
          <div
            className="relative overflow-hidden rounded-[20px] border border-white/10 px-6 py-16 md:px-14 md:py-20"
            style={{
              background:
                'linear-gradient(160deg, rgba(167,139,250,0.12), rgba(0,0,0,0.3) 60%), linear-gradient(180deg, rgb(var(--bg-softer)), #08080a)',
            }}
          >
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 opacity-[0.05]"
              style={{
                backgroundImage:
                  'linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)',
                backgroundSize: '52px 52px',
              }}
            />
            <div className="relative grid grid-cols-1 items-center gap-10 lg:grid-cols-[1.3fr_0.7fr]">
              <div>
                <Kicker index="—" label="Última chamada da edição" />
                <h2 className="section-title mt-5 text-[38px] md:text-[56px]">
                  Cria a conta e sobe
                  <br />
                  <span className="text-editorial text-white/70">o primeiro arquivo.</span>
                </h2>
                <p className="mt-5 max-w-[52ch] text-[15px] leading-relaxed text-text-muted">
                  Leva menos tempo do que exportar um vídeo. Você começa pelo plano
                  grátis e decide o resto depois.
                </p>
                <div className="mt-8 flex flex-wrap items-center gap-3">
                  <Link href="/register" className="btn-primary !px-7 !py-3.5 !text-[14px]">
                    Criar conta grátis →
                  </Link>
                  <Link href="/login" className="btn-secondary !px-6 !py-3.5 !text-[14px]">
                    Já tenho conta
                  </Link>
                </div>
                <p
                  className="mt-6 text-[10px] uppercase tracking-[0.2em] text-text-dim"
                  style={{ fontFamily: 'var(--font-label)', fontWeight: 600 }}
                >
                  Sem cartão pra começar · roda no navegador · cancela quando quiser
                </p>
              </div>

              <div className="hidden justify-center lg:flex">
                <div className="relative">
                  <div
                    aria-hidden
                    className="absolute inset-0 -m-10 rounded-full opacity-60 blur-3xl"
                    style={{ background: 'radial-gradient(circle, rgba(167,139,250,0.45), transparent 65%)' }}
                  />
                  <div className="fc-float relative">
                    <DarkoLogo size={112} />
                  </div>
                </div>
              </div>
            </div>

            <style jsx>{`
              .fc-float {
                animation: fc-float 6s ease-in-out infinite;
              }
              @keyframes fc-float {
                0%,
                100% {
                  transform: translateY(0) rotate(0deg);
                }
                50% {
                  transform: translateY(-12px) rotate(-3deg);
                }
              }
              @media (prefers-reduced-motion: reduce) {
                .fc-float {
                  animation: none;
                }
              }
            `}</style>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

/* ══════════════════════ RODAPÉ (expediente) ══════════════════════ */

export function LandingFooter() {
  return (
    <footer className="mt-20 md:mt-28">
      <Ticker
        tag="Expediente"
        tone="#2a2a32"
        speed={54}
        items={[
          'Decupagem automática',
          'Camuflagem de áudio',
          'FakePrint · 40 modelos',
          'Gerador de SRT',
          'Lipsync Video to Video',
          'Compressor',
          'Downloader',
          'Mixer de velocidade',
        ]}
      />

      <div className="mx-auto max-w-[1200px] px-5 pb-10 pt-12 md:px-8">
        <div className="grid grid-cols-1 gap-10 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-3">
              <DarkoLogo size={28} />
              <span
                className="text-[13.5px] font-extrabold tracking-[0.18em] text-white/90"
                style={{ fontFamily: 'var(--font-tech)' }}
              >
                AUTO EDIT
              </span>
            </div>
            <p className="mt-4 max-w-[320px] text-[13px] leading-relaxed text-text-muted">
              Suíte de automação de edição de vídeo, direto no navegador. Feita pra
              editores e agências que entregam todo dia.
            </p>
          </div>

          <FooterCol
            title="Produto"
            links={[
              { label: 'Em destaque', href: '#destaques' },
              { label: 'A suíte', href: '#suite' },
              { label: 'Como funciona', href: '#como' },
              { label: 'Planos', href: '#planos' },
            ]}
          />
          <FooterCol
            title="Conta"
            links={[
              { label: 'Entrar', href: '/login' },
              { label: 'Criar conta grátis', href: '/register' },
              { label: 'Recursos', href: '/recursos' },
              { label: 'Perguntas', href: '#faq' },
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

        <div className="mt-12 flex flex-col items-start justify-between gap-3 border-t border-white/10 pt-6 md:flex-row md:items-center">
          <p className="text-[12px] text-text-dim">Auto Edit · © {new Date().getFullYear()}</p>
          <p
            className="text-[10px] uppercase tracking-[0.2em] text-text-dim"
            style={{ fontFamily: 'var(--font-label)', fontWeight: 600 }}
          >
            Feito pra quem entrega todo dia
          </p>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({
  title,
  links,
}: {
  title: string;
  links: Array<{ label: string; href: string }>;
}) {
  return (
    <div>
      <div
        className="mb-4 text-[10px] font-bold uppercase tracking-[0.22em] text-text-dim"
        style={{ fontFamily: 'var(--font-label)' }}
      >
        {title}
      </div>
      <nav className="flex flex-col gap-2.5 text-[13.5px] text-text-muted">
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
