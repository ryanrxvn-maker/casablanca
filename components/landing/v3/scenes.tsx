'use client';

/**
 * scenes — as peças visuais da landing v3.
 *
 * Cada cena tem IDENTIDADE PRÓPRIA (paleta, tipografia e movimento) e mostra a
 * ferramenta trabalhando, não um ícone bonito:
 *
 *   BreakingCard    — gerador de caracteres de telejornal (FakePrint), com
 *                     relógio ao vivo, chyron digitando e modo TELA VERDE.
 *   NewspaperCard   — capa de jornal impresso; a manchete troca sozinha e cada
 *                     edição fala de uma ferramenta. Reusada no login.
 *   CamuflagemScene — duas trilhas no mesmo arquivo + leitura da transcrição.
 *   DecupagemScene  — o silêncio saindo da timeline, em loop.
 *   MiniPrints      — chamada de vídeo, post e live, os outros modelos.
 *
 * Nota de implementação: o app inteiro roda com `main { filter: saturate(.72) }`
 * (site propositalmente menos colorido). As peças de "imprensa" reaplicam
 * `saturate(1.39)` pra voltar ao normal — é o contraste que faz o vermelho de
 * plantão e o verde de chroma existirem.
 */

import { useEffect, useState } from 'react';
import { useClock, useCycle, useInView, useReduced, useToday, useTypewriter, waveBars } from './kit';

const UNSATURATE_FIX = 'saturate(1.39)';

const RED = '#e0483f';
const PAPER = '#f2efe6';
const INK = '#14140f';
const CHROMA = '#00b140';

/* ══════════════════════════ 1. BREAKING (telejornal) ══════════════════════════ */

const CHYRON = [
  'EDITOR ENTREGA 12 CRIATIVOS ANTES DO ALMOÇO',
  'MANCHETE SAI EM TELA VERDE, PRONTA PRO CHROMA',
  'RELÓGIO E TICKER CONTINUAM RODANDO NO .WEBM',
];

export function BreakingCard({ className = '' }: { className?: string }) {
  const { ref, inView } = useInView<HTMLDivElement>(0.2);
  const reduced = useReduced();
  const clock = useClock();
  const { text } = useTypewriter(CHYRON, { active: inView });
  const wiping = inView && !reduced;

  return (
    <div
      ref={ref}
      className={'relative isolate ' + className}
      style={{ filter: UNSATURATE_FIX }}
    >
      {/* luz por trás — tira o card do preto chapado */}
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-10 -z-10 opacity-70 blur-3xl"
        style={{
          background:
            'radial-gradient(45% 45% at 25% 20%, rgba(224,72,63,0.20), transparent 70%),' +
            'radial-gradient(45% 45% at 80% 80%, rgba(167,139,250,0.18), transparent 70%)',
        }}
      />

      <div
        className="bc-frame relative aspect-[16/10] w-full overflow-hidden rounded-[14px] border border-white/12"
        style={{
          background: '#0b0d10',
          boxShadow:
            '0 40px 90px -32px rgba(0,0,0,0.95), 0 0 0 1px rgba(255,255,255,0.04) inset',
        }}
      >
        {/* cenário do estúdio */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(90% 70% at 50% 8%, #1d2836 0%, #0e131a 55%, #07090c 100%),' +
              'radial-gradient(28% 40% at 22% 78%, rgba(96,165,250,0.22), transparent 70%)',
          }}
        />
        {/* tela verde entrando por cima, com o divisor deslizando */}
        <div
          aria-hidden
          className={'absolute inset-0 ' + (wiping ? 'bc-wipe' : '')}
          style={{
            clipPath: 'inset(0 0 0 58%)',
            background: `radial-gradient(75% 70% at 50% 40%, #14c559 0%, ${CHROMA} 62%, #009439 100%)`,
          }}
        />
        <span
          aria-hidden
          className={'absolute inset-y-0 w-px ' + (wiping ? 'bc-line' : '')}
          style={{
            left: '58%',
            background: 'rgba(255,255,255,0.75)',
            boxShadow: '0 0 12px rgba(255,255,255,0.5)',
          }}
        />
        {/* linhas de varredura */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.14]"
          style={{
            backgroundImage:
              'repeating-linear-gradient(0deg, rgba(255,255,255,0.5) 0px, rgba(255,255,255,0.5) 1px, transparent 1px, transparent 3px)',
          }}
        />
        {/* marcas de enquadramento */}
        {[
          'left-3 top-3 border-l border-t',
          'right-3 top-3 border-r border-t',
          'left-3 bottom-3 border-l border-b',
          'right-3 bottom-3 border-r border-b',
        ].map((pos) => (
          <span
            key={pos}
            aria-hidden
            className={'pointer-events-none absolute h-3.5 w-3.5 border-white/25 ' + pos}
          />
        ))}

        {/* topo */}
        <div className="absolute inset-x-0 top-0 flex items-start justify-between p-3.5 md:p-4">
          <span
            className="inline-flex items-center gap-2 rounded-[4px] px-2 py-1 text-[10.5px] font-extrabold uppercase tracking-[0.2em] text-white"
            style={{ background: RED, fontFamily: 'var(--font-tech)' }}
          >
            AE NEWS
          </span>
          <div className="flex items-center gap-2">
            <span
              className="inline-flex items-center gap-1.5 rounded-[4px] border border-white/20 bg-black/45 px-2 py-1 text-[9.5px] font-bold uppercase tracking-[0.2em] text-white backdrop-blur-sm"
              style={{ fontFamily: 'var(--font-label)' }}
            >
              <i
                className="bc-dot inline-block h-[6px] w-[6px] rounded-full"
                style={{ background: RED }}
              />
              Ao vivo
            </span>
            <span
              className="num rounded-[4px] border border-white/15 bg-black/45 px-2 py-1 text-[10.5px] text-white/85 backdrop-blur-sm"
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              {clock}
            </span>
          </div>
        </div>

        {/* etiquetas dos dois fundos */}
        <div className="absolute inset-x-3.5 top-14 flex items-center justify-between md:inset-x-4 md:top-16">
          <span
            className="rounded-[4px] border border-white/15 bg-black/45 px-2 py-1 text-[9px] font-bold uppercase tracking-[0.18em] text-white/60 backdrop-blur-sm"
            style={{ fontFamily: 'var(--font-label)' }}
          >
            Fundo estúdio
          </span>
          <span
            className="rounded-[4px] border border-white/50 bg-black/35 px-2 py-1 text-[9px] font-bold uppercase tracking-[0.18em] text-white backdrop-blur-sm"
            style={{ fontFamily: 'var(--font-label)' }}
          >
            Tela verde
          </span>
        </div>

        {/* gerador de caracteres */}
        <div className="absolute inset-x-0 bottom-0">
          <div className="flex items-stretch px-3.5 md:px-4">
            <span
              className="flex shrink-0 items-center px-2.5 text-[11px] font-extrabold uppercase tracking-[0.14em] text-white md:px-3 md:text-[12.5px]"
              style={{ background: RED, fontFamily: 'var(--font-tech)' }}
            >
              Plantão
            </span>
            <div
              className="min-w-0 flex-1 px-3 py-2 md:px-3.5 md:py-2.5"
              style={{ background: PAPER }}
            >
              <div
                className="truncate text-[13px] font-extrabold uppercase leading-tight tracking-[-0.01em] md:text-[16.5px]"
                style={{ color: INK, fontFamily: 'var(--font-tech)' }}
              >
                {text}
                <span className="bc-caret" style={{ background: RED }} />
              </div>
            </div>
          </div>
          <div
            className="flex items-center gap-2 px-3.5 py-1.5 md:px-4"
            style={{ background: 'rgba(10,12,15,0.9)' }}
          >
            <span
              className="text-[9px] font-bold uppercase tracking-[0.22em] text-white/45"
              style={{ fontFamily: 'var(--font-label)' }}
            >
              Agora · da ilha de edição
            </span>
            <span className="h-px flex-1 bg-white/10" />
            <span
              className="num text-[9px] tracking-[0.2em] text-white/35"
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              16:9 · 9:16
            </span>
          </div>
        </div>
      </div>

      {/* legenda do card */}
      <div className="mt-3.5 flex flex-wrap items-center gap-1.5 px-0.5">
        {['PNG em alta', '.webm animado', '16:9 e 9:16', '13 emissoras'].map((c) => (
          <span
            key={c}
            className="rounded-[4px] border border-white/12 bg-white/[0.03] px-2 py-1 text-[9.5px] uppercase tracking-[0.14em] text-white/50"
            style={{ fontFamily: 'var(--font-label)', fontWeight: 600 }}
          >
            {c}
          </span>
        ))}
      </div>
      <p className="mt-2.5 px-0.5 text-[12.5px] leading-relaxed text-white/45">
        <span className="font-semibold" style={{ color: RED }}>
          FakePrint · telejornal
        </span>{' '}
        — o mesmo gráfico com fundo de estúdio ou em chroma key, pra você encaixar o
        vídeo por trás.
      </p>

      <style jsx>{`
        .bc-wipe {
          animation: bc-wipe 9s cubic-bezier(0.45, 0, 0.55, 1) infinite alternate;
        }
        .bc-line {
          animation: bc-line 9s cubic-bezier(0.45, 0, 0.55, 1) infinite alternate;
        }
        @keyframes bc-wipe {
          from {
            clip-path: inset(0 0 0 26%);
          }
          to {
            clip-path: inset(0 0 0 82%);
          }
        }
        @keyframes bc-line {
          from {
            left: 26%;
          }
          to {
            left: 82%;
          }
        }
        .bc-dot {
          animation: bc-pulse 1.6s ease-in-out infinite;
        }
        .bc-caret {
          display: inline-block;
          width: 2px;
          height: 0.86em;
          margin-left: 3px;
          vertical-align: -0.08em;
          animation: bc-blink 1s steps(2, end) infinite;
        }
        @keyframes bc-pulse {
          0%,
          100% {
            opacity: 1;
            transform: scale(1);
          }
          50% {
            opacity: 0.35;
            transform: scale(0.8);
          }
        }
        @keyframes bc-blink {
          50% {
            opacity: 0;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .bc-dot,
          .bc-caret,
          .bc-wipe,
          .bc-line {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}

/* ══════════════════════════ 2. JORNAL IMPRESSO ══════════════════════════ */

type Edition = {
  tag: string;
  headline: string;
  deck: string;
  lede: string;
  tone: string;
};

const EDITIONS: Edition[] = [
  {
    tag: 'Decupagem',
    headline: 'Silêncio é cortado sozinho e ninguém dá falta',
    deck:
      'Bruto de 12 minutos volta com 8. Pausa morta, respiro no meio da frase e “deixa eu começar de novo” ficam de fora — a voz sai nivelada.',
    lede:
      'O editor subiu o arquivo, escolheu quanto de pausa queria manter e foi tomar café. Voltou com a fila inteira decupada e nomeada.',
    tone: '#7f9c2f',
  },
  {
    tag: 'Camuflagem',
    headline: 'Um áudio pro público, outro pra transcrição',
    deck:
      'As duas trilhas viajam no mesmo arquivo. Quem assiste ouve a sua; a transcrição automática lê a que você deixou por baixo.',
    lede:
      'Depois de processar, a própria ferramenta escuta o resultado do jeito que as plataformas escutam e devolve o selo por plataforma.',
    tone: '#2f8f86',
  },
  {
    tag: 'FakePrint',
    headline: 'Manchete chega à ilha de edição já em tela verde',
    deck:
      'Telejornal, site de notícia, conversa, chamada de vídeo, post, story e live: 40 modelos com prévia ao vivo e download em alta.',
    lede:
      'No modo chroma key o cenário sai verde e só os gráficos ficam de pé — é arrastar pra cima do criativo e tirar o verde.',
    tone: '#b4413a',
  },
];

/**
 * Capa de jornal. Compacta = versão do login (uma coluna a menos, sem folha
 * de baixo). A manchete troca de edição sozinha, e cada edição é uma
 * ferramenta.
 */
export function NewspaperCard({
  compact = false,
  className = '',
}: {
  compact?: boolean;
  className?: string;
}) {
  const { ref, inView } = useInView<HTMLDivElement>(0.15);
  const i = useCycle(EDITIONS.length, 6400, inView);
  const ed = EDITIONS[i] ?? EDITIONS[0]!;
  const today = useToday();

  return (
    <div ref={ref} className={'relative ' + className} style={{ filter: UNSATURATE_FIX }}>
      {/* folha de baixo — dá espessura de pilha */}
      {!compact && (
        <div
          aria-hidden
          className="absolute inset-x-3 -bottom-2 top-3 rounded-[3px]"
          style={{
            background: '#cfcabb',
            transform: 'rotate(1.4deg)',
            boxShadow: '0 24px 50px -26px rgba(0,0,0,0.9)',
          }}
        />
      )}

      <article
        className="relative overflow-hidden rounded-[4px] px-5 pb-5 pt-4 md:px-7 md:pb-7 md:pt-6"
        style={{
          background: PAPER,
          color: INK,
          transform: compact ? 'rotate(-0.5deg)' : 'rotate(-0.9deg)',
          boxShadow:
            '0 36px 80px -30px rgba(0,0,0,0.95), 0 2px 0 rgba(255,255,255,0.5) inset',
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><filter id='p'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/></filter><rect width='100%' height='100%' filter='url(%23p)' opacity='0.05'/></svg>\")",
        }}
      >
        {/* cabeçalho */}
        <div className="border-b-[3px]" style={{ borderColor: INK }}>
          <div
            className="flex items-center justify-between pb-1 text-[8.5px] uppercase tracking-[0.24em]"
            style={{ fontFamily: 'var(--font-label)', color: 'rgba(20,20,15,0.55)' }}
          >
            <span>Edição de hoje</span>
            <span className="truncate px-2 text-center">{today || '—'}</span>
            <span>Sem cartão</span>
          </div>
          <h3
            className="pb-1.5 text-center leading-[0.86]"
            style={{
              fontFamily: 'var(--font-serif)',
              fontSize: compact ? 'clamp(30px, 7vw, 44px)' : 'clamp(34px, 6vw, 60px)',
              letterSpacing: '0.01em',
            }}
          >
            Auto Edit
          </h3>
        </div>
        <div className="mt-[3px] h-px" style={{ background: INK, opacity: 0.55 }} />

        {/* manchete */}
        <div className="mt-4">
          <span
            className="inline-block rounded-[2px] px-1.5 py-[3px] text-[9px] font-bold uppercase tracking-[0.2em] text-white transition-colors duration-500"
            style={{ background: ed.tone, fontFamily: 'var(--font-label)' }}
          >
            {ed.tag}
          </span>
          <h4
            key={ed.headline}
            className="np-in mt-2.5"
            style={{
              fontFamily: 'var(--font-serif)',
              fontSize: compact ? 'clamp(24px, 5.2vw, 34px)' : 'clamp(27px, 3.6vw, 46px)',
              lineHeight: 0.98,
              letterSpacing: '-0.005em',
            }}
          >
            {ed.headline}
          </h4>
          <p
            key={ed.deck}
            className="np-in mt-2.5 max-w-[52ch] text-[12.5px] leading-[1.45]"
            style={{ color: 'rgba(20,20,15,0.68)', animationDelay: '90ms' }}
          >
            {ed.deck}
          </p>
        </div>

        <div className="mt-4 h-px" style={{ background: 'rgba(20,20,15,0.22)' }} />

        {/* corpo em colunas */}
        <div
          className={
            'mt-4 grid gap-4 ' +
            (compact ? 'grid-cols-[1.2fr_1fr]' : 'grid-cols-[1.1fr_1fr] sm:grid-cols-[1.1fr_1fr_0.9fr]')
          }
        >
          <div>
            <p
              key={ed.lede}
              className="np-in text-[11.5px] leading-[1.5]"
              style={{ color: 'rgba(20,20,15,0.75)', animationDelay: '150ms' }}
            >
              <span
                className="float-left mr-1.5 leading-[0.78]"
                style={{ fontFamily: 'var(--font-serif)', fontSize: '2.7em' }}
              >
                {ed.lede.charAt(0)}
              </span>
              {ed.lede.slice(1)}
            </p>
            <TextBars lines={compact ? 3 : 5} />
          </div>

          <div>
            <div
              className="relative mb-2 aspect-[4/3] overflow-hidden rounded-[2px] transition-colors duration-700"
              style={{ background: ed.tone }}
            >
              <div
                aria-hidden
                className="absolute inset-0 opacity-30"
                style={{
                  backgroundImage:
                    'repeating-linear-gradient(45deg, rgba(255,255,255,0.35) 0 2px, transparent 2px 5px)',
                }}
              />
              <span
                className="absolute bottom-1 left-1.5 text-[8px] font-bold uppercase tracking-[0.18em] text-white/90"
                style={{ fontFamily: 'var(--font-label)' }}
              >
                Foto · chroma
              </span>
            </div>
            <TextBars lines={compact ? 4 : 6} />
          </div>

          {!compact && (
            <div className="hidden sm:block">
              <div
                className="mb-2 border-y py-1 text-[8.5px] font-bold uppercase tracking-[0.18em]"
                style={{ borderColor: 'rgba(20,20,15,0.25)', color: 'rgba(20,20,15,0.6)', fontFamily: 'var(--font-label)' }}
              >
                Também nesta edição
              </div>
              <TextBars lines={9} />
            </div>
          )}
        </div>

        {/* rodapé */}
        <div
          className="mt-4 flex items-center justify-between border-t pt-2 text-[8.5px] uppercase tracking-[0.2em]"
          style={{ borderColor: 'rgba(20,20,15,0.3)', color: 'rgba(20,20,15,0.5)', fontFamily: 'var(--font-label)' }}
        >
          <span>FakePrint · modelo de impresso</span>
          <span className="num" style={{ fontFamily: 'var(--font-mono)' }}>
            {String(i + 1).padStart(2, '0')} / {String(EDITIONS.length).padStart(2, '0')}
          </span>
        </div>
      </article>

      <style jsx>{`
        .np-in {
          animation: np-in 620ms cubic-bezier(0.16, 0.84, 0.28, 1) both;
        }
        @keyframes np-in {
          from {
            opacity: 0;
            transform: translateY(9px);
          }
          to {
            opacity: 1;
            transform: none;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .np-in {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}

/** Linhas "de texto" do jornal — barras, pra não inventar notícia nenhuma. */
function TextBars({ lines }: { lines: number }) {
  const widths = ['100%', '96%', '99%', '88%', '100%', '93%', '97%', '84%', '100%', '91%'];
  return (
    <div className="mt-2 flex flex-col gap-[5px]">
      {Array.from({ length: lines }).map((_, i) => (
        <span
          key={i}
          className="block h-[4px] rounded-[1px]"
          style={{ width: widths[i % widths.length], background: 'rgba(20,20,15,0.16)' }}
        />
      ))}
    </div>
  );
}

/* ══════════════════════════ 3. CAMUFLAGEM ══════════════════════════ */

const TEAL = '#3ec7bb';
const HIDDEN_TEXT =
  'receita de bolo de cenoura com cobertura de chocolate — bata os ovos, a cenoura e o óleo…';

export function CamuflagemScene() {
  const { ref, inView } = useInView<HTMLDivElement>(0.25);
  const reduced = useReduced();
  const [n, setN] = useState(HIDDEN_TEXT.length);
  const [round, setRound] = useState(0);
  const publicBars = waveBars(46, 3);
  const hiddenBars = waveBars(46, 11);

  // A transcrição "escuta" o arquivo e escreve o que leu. `round` reinicia o
  // ciclo depois de segurar a frase completa por um tempo.
  useEffect(() => {
    if (reduced || !inView) return;
    setN(0);
    let i = 0;
    let hold: ReturnType<typeof setTimeout>;
    const id = setInterval(() => {
      i += 1;
      setN(i);
      if (i >= HIDDEN_TEXT.length) {
        clearInterval(id);
        hold = setTimeout(() => setRound((r) => r + 1), 2800);
      }
    }, 34);
    return () => {
      clearInterval(id);
      clearTimeout(hold);
    };
  }, [reduced, inView, round]);

  return (
    <div
      ref={ref}
      className="relative overflow-hidden rounded-[16px] border p-4 md:p-5"
      style={{
        borderColor: 'rgba(62,199,187,0.22)',
        background:
          'linear-gradient(180deg, rgba(62,199,187,0.07), rgba(0,0,0,0.25)), linear-gradient(180deg, rgb(var(--bg-softer)), rgb(var(--bg-soft)))',
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full blur-3xl"
        style={{ background: 'rgba(62,199,187,0.18)' }}
      />

      <div className="relative">
        <Lane
          label="O que o público ouve"
          tag="Seu áudio"
          color="rgba(255,255,255,0.72)"
          bars={publicBars}
          sweep={inView && !reduced}
        />
        <div className="my-3 flex items-center gap-3">
          <span className="h-px flex-1 bg-white/10" />
          <span
            className="text-[8.5px] uppercase tracking-[0.22em] text-white/35"
            style={{ fontFamily: 'var(--font-label)' }}
          >
            mesmo arquivo · estéreo
          </span>
          <span className="h-px flex-1 bg-white/10" />
        </div>
        <Lane
          label="O que a transcrição lê"
          tag="Áudio escondido"
          color={TEAL}
          bars={hiddenBars}
          sweep={inView && !reduced}
        />

        {/* leitura da transcrição */}
        <div
          className="mt-4 rounded-[10px] border px-3 py-2.5"
          style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(0,0,0,0.35)' }}
        >
          <div
            className="mb-1.5 text-[8.5px] uppercase tracking-[0.22em] text-white/35"
            style={{ fontFamily: 'var(--font-label)' }}
          >
            Transcrição automática devolveu
          </div>
          <p
            className="min-h-[34px] text-[11.5px] leading-relaxed"
            style={{ fontFamily: 'var(--font-mono)', color: TEAL }}
          >
            {HIDDEN_TEXT.slice(0, n)}
            <span className="cm-caret" style={{ background: TEAL }} />
          </p>
        </div>

        {/* selo */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span
            className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[9.5px] font-bold uppercase tracking-[0.16em]"
            style={{
              fontFamily: 'var(--font-label)',
              borderColor: 'rgba(62,199,187,0.5)',
              background: 'rgba(62,199,187,0.12)',
              color: TEAL,
            }}
          >
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
              <path d="M2.5 6.4l2.4 2.4L9.6 3.4" stroke={TEAL} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Camuflado · TikTok · Kwai · YouTube · Meta
          </span>
          <span className="text-[11px] text-white/40">selo medido no arquivo pronto</span>
        </div>
      </div>

      <style jsx>{`
        .cm-caret {
          display: inline-block;
          width: 6px;
          height: 2px;
          margin-left: 3px;
          vertical-align: 2px;
          animation: cm-blink 1s steps(2, end) infinite;
        }
        @keyframes cm-blink {
          50% {
            opacity: 0;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .cm-caret {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}

function Lane({
  label,
  tag,
  color,
  bars,
  sweep,
}: {
  label: string;
  tag: string;
  color: string;
  bars: number[];
  sweep: boolean;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span
          className="text-[9px] uppercase tracking-[0.2em] text-white/45"
          style={{ fontFamily: 'var(--font-label)' }}
        >
          {label}
        </span>
        <span
          className="rounded-[4px] border px-1.5 py-[2px] text-[8.5px] uppercase tracking-[0.14em]"
          style={{
            fontFamily: 'var(--font-label)',
            borderColor: 'rgba(255,255,255,0.12)',
            color: 'rgba(255,255,255,0.55)',
          }}
        >
          {tag}
        </span>
      </div>
      <div className="lane relative flex h-[52px] items-center gap-[2px] overflow-hidden rounded-[8px] border border-white/8 bg-black/30 px-2">
        {bars.map((h, i) => (
          <span
            key={i}
            className="block flex-1 rounded-[1px]"
            style={{ height: `${Math.round(h * 100)}%`, background: color, opacity: 0.85 }}
          />
        ))}
        {sweep && (
          <span
            aria-hidden
            className="lane-sweep pointer-events-none absolute inset-y-0 w-[26%]"
            style={{
              background:
                'linear-gradient(90deg, transparent, rgba(255,255,255,0.14), transparent)',
            }}
          />
        )}
      </div>

      <style jsx>{`
        .lane-sweep {
          animation: lane-sweep 4.4s linear infinite;
        }
        @keyframes lane-sweep {
          from {
            transform: translateX(-120%);
          }
          to {
            transform: translateX(460%);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .lane-sweep {
            animation: none;
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
}

/* ══════════════════════════ 4. DECUPAGEM ══════════════════════════ */

const LIME = '#c8d684';

/** blocos da timeline: fala (peso) x silêncio (peso) */
const TRACK: Array<{ speech: boolean; w: number; kind?: string }> = [
  { speech: true, w: 14 },
  { speech: false, w: 6, kind: 'respiro' },
  { speech: true, w: 18 },
  { speech: false, w: 9, kind: 'silêncio' },
  { speech: true, w: 11 },
  { speech: false, w: 5, kind: 'respiro' },
  { speech: true, w: 16 },
  { speech: false, w: 8, kind: 'silêncio' },
  { speech: true, w: 13 },
];

export function DecupagemScene() {
  const { ref, inView } = useInView<HTMLDivElement>(0.25);
  const reduced = useReduced();
  // 0 = bruto · 1 = marcando · 2 = cortado
  const [phase, setPhase] = useState<0 | 1 | 2>(reduced ? 2 : 0);

  useEffect(() => {
    if (reduced || !inView) return;
    let t1: ReturnType<typeof setTimeout>;
    let t2: ReturnType<typeof setTimeout>;
    let t3: ReturnType<typeof setTimeout>;
    const run = () => {
      setPhase(0);
      t1 = setTimeout(() => setPhase(1), 900);
      t2 = setTimeout(() => setPhase(2), 2000);
      t3 = setTimeout(run, 6200);
    };
    run();
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [reduced, inView]);

  const cut = phase === 2;

  return (
    <div
      ref={ref}
      className="relative overflow-hidden rounded-[16px] border p-4 md:p-5"
      style={{
        borderColor: 'rgba(200,214,132,0.22)',
        background:
          'linear-gradient(180deg, rgba(200,214,132,0.06), rgba(0,0,0,0.25)), linear-gradient(180deg, rgb(var(--bg-softer)), rgb(var(--bg-soft)))',
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -left-16 -top-16 h-48 w-48 rounded-full blur-3xl"
        style={{ background: 'rgba(200,214,132,0.16)' }}
      />

      <div className="relative">
        <div className="mb-3 flex items-center justify-between">
          <span
            className="text-[9px] uppercase tracking-[0.2em] text-white/45"
            style={{ fontFamily: 'var(--font-label)' }}
          >
            {cut ? 'Depois' : 'Bruto'}
          </span>
          <span
            className="num text-[11px] tabular-nums transition-colors duration-500"
            style={{ fontFamily: 'var(--font-mono)', color: cut ? LIME : 'rgba(255,255,255,0.5)' }}
          >
            {cut ? '08:52' : '12:40'}
          </span>
        </div>

        {/* timeline */}
        <div className="flex h-[64px] items-stretch gap-[3px] overflow-hidden rounded-[8px] border border-white/8 bg-black/30 p-2">
          {TRACK.map((b, i) =>
            b.speech ? (
              <span
                key={i}
                className="relative flex items-center justify-center overflow-hidden rounded-[3px] transition-[flex-grow] duration-[900ms] ease-[cubic-bezier(.16,.84,.28,1)]"
                style={{
                  flexGrow: b.w,
                  flexBasis: 0,
                  background: `linear-gradient(180deg, ${LIME}, #97a659)`,
                }}
              >
                <MiniWave seed={i} />
              </span>
            ) : (
              <span
                key={i}
                className="relative flex items-center justify-center overflow-hidden rounded-[3px] transition-all duration-[900ms] ease-[cubic-bezier(.16,.84,.28,1)]"
                style={{
                  flexGrow: cut ? 0.0001 : b.w,
                  flexBasis: 0,
                  opacity: cut ? 0 : 1,
                  border: `1px dashed ${phase === 1 ? 'rgba(224,72,63,0.85)' : 'rgba(255,255,255,0.18)'}`,
                  background:
                    phase === 1 ? 'rgba(224,72,63,0.16)' : 'rgba(255,255,255,0.035)',
                }}
              >
                <span
                  className="whitespace-nowrap text-[7.5px] uppercase tracking-[0.1em] transition-opacity duration-300"
                  style={{
                    fontFamily: 'var(--font-label)',
                    color: phase === 1 ? '#e0483f' : 'rgba(255,255,255,0.35)',
                    opacity: cut ? 0 : 1,
                  }}
                >
                  {b.kind}
                </span>
              </span>
            ),
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span
            className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[9.5px] font-bold uppercase tracking-[0.16em] transition-all duration-500"
            style={{
              fontFamily: 'var(--font-label)',
              borderColor: cut ? 'rgba(200,214,132,0.5)' : 'rgba(255,255,255,0.14)',
              background: cut ? 'rgba(200,214,132,0.12)' : 'transparent',
              color: cut ? LIME : 'rgba(255,255,255,0.45)',
            }}
          >
            {cut ? '−31% de duração' : 'analisando a fala…'}
          </span>
          <span className="text-[11px] text-white/40">
            {cut ? 'voz nivelada, ataque das palavras preservado' : 'marcando pausa morta e respiro'}
          </span>
        </div>
      </div>
    </div>
  );
}

function MiniWave({ seed }: { seed: number }) {
  const bars = waveBars(9, seed + 2);
  return (
    <span className="flex h-full w-full items-center justify-center gap-[2px] px-1">
      {bars.map((h, i) => (
        <span
          key={i}
          className="block w-[2px] rounded-full"
          style={{ height: `${Math.round(h * 62)}%`, background: 'rgba(12,14,8,0.45)' }}
        />
      ))}
    </span>
  );
}

/* ══════════════════════════ 5. MINI PRINTS ══════════════════════════ */

/** Os outros modelos do FakePrint, em miniatura fiel. */
export function MiniPrints({ className = '' }: { className?: string }) {
  return (
    <div className={'grid grid-cols-3 gap-3 ' + className} style={{ filter: UNSATURATE_FIX }}>
      <MiniCall />
      <MiniPost />
      <MiniLive />
    </div>
  );
}

function MiniShell({
  children,
  label,
  bg,
}: {
  children: React.ReactNode;
  label: string;
  bg: string;
}) {
  return (
    <div>
      <div
        className="relative aspect-[9/13] overflow-hidden rounded-[10px] border border-white/12"
        style={{ background: bg, boxShadow: '0 18px 34px -20px rgba(0,0,0,0.9)' }}
      >
        {children}
      </div>
      <div
        className="mt-1.5 text-center text-[8.5px] uppercase tracking-[0.16em] text-white/35"
        style={{ fontFamily: 'var(--font-label)' }}
      >
        {label}
      </div>
    </div>
  );
}

function MiniCall() {
  return (
    <MiniShell label="Chamada de vídeo" bg="linear-gradient(180deg,#0f2a21,#07130f)">
      <div className="flex h-full flex-col items-center justify-between py-3">
        <span
          className="num text-[7px] tracking-[0.1em] text-white/60"
          style={{ fontFamily: 'var(--font-mono)' }}
        >
          00:12
        </span>
        <div className="flex flex-col items-center gap-1.5">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-white/12 text-[11px] text-white/80">
            H
          </span>
          <span className="text-[8px] font-semibold text-white/85">Dra. Helena</span>
          <span className="text-[6.5px] uppercase tracking-[0.14em] text-white/40">
            chamando…
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-5 w-5 rounded-full bg-white/12" />
          <span className="h-5 w-5 rounded-full bg-white/12" />
          <span className="h-5 w-5 rounded-full" style={{ background: '#e0483f' }} />
        </div>
      </div>
    </MiniShell>
  );
}

function MiniPost() {
  return (
    <MiniShell label="Post do Instagram" bg="#fff">
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-1.5 px-2 py-1.5">
          <span className="h-4 w-4 rounded-full bg-neutral-300" />
          <span className="h-[4px] w-9 rounded-full bg-neutral-300" />
        </div>
        <div className="flex-1" style={{ background: 'linear-gradient(160deg,#dcd6ea,#c7d6e4)' }} />
        <div className="flex flex-col gap-[4px] px-2 py-2">
          <div className="flex gap-1.5">
            <span className="h-[7px] w-[7px] rounded-full" style={{ background: '#e0483f' }} />
            <span className="h-[7px] w-[7px] rounded-full bg-neutral-300" />
            <span className="h-[7px] w-[7px] rounded-full bg-neutral-300" />
          </div>
          <span className="h-[4px] w-full rounded-full bg-neutral-200" />
          <span className="h-[4px] w-3/4 rounded-full bg-neutral-200" />
        </div>
      </div>
    </MiniShell>
  );
}

function MiniLive() {
  return (
    <MiniShell label="Live · .webm" bg="linear-gradient(180deg,#1b1524,#0a070f)">
      <div className="flex h-full flex-col justify-between p-2">
        <div className="flex items-center gap-1">
          <span
            className="rounded-[3px] px-1 py-[1px] text-[6px] font-bold uppercase tracking-[0.12em] text-white"
            style={{ background: '#e0483f' }}
          >
            Ao vivo
          </span>
          <span className="rounded-[3px] bg-black/50 px-1 py-[1px] text-[6px] text-white/70">
            2,4 mil
          </span>
        </div>
        <div className="flex flex-col gap-[3px]">
          <span className="h-[4px] w-4/5 rounded-full bg-white/25" />
          <span className="h-[4px] w-3/5 rounded-full bg-white/18" />
          <span className="h-[4px] w-2/3 rounded-full bg-white/12" />
        </div>
        <span
          aria-hidden
          className="absolute bottom-6 right-2 text-[10px]"
          style={{ color: '#ff5d8f' }}
        >
          ♥
        </span>
      </div>
    </MiniShell>
  );
}
