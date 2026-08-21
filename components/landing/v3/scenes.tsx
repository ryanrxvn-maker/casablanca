'use client';

/**
 * scenes — as peças visuais da landing v3.
 *
 * Cada cena tem IDENTIDADE PRÓPRIA (paleta, tipografia e movimento) e mostra a
 * ferramenta trabalhando, não um ícone bonito:
 *
 *   BreakingCard    — gerador de caracteres de telejornal (FakePrint), com
 *                     relógio ao vivo, chyron digitando e modo TELA VERDE.
 *   TelejornalCard  — plantão estilo CNN sem vídeo: lower third digitando,
 *                     ticker rolando e o campo chroma esperando o vídeo do
 *                     cliente. Usada na seção FakePrint e no login.
 *   LegendasScene   — o ENGINE REAL das Legendas Automáticas ciclando
 *                     modelos num canvas. Usada no destaque e no login.
 *   CamuflagemScene — duas trilhas no mesmo arquivo + leitura da transcrição.
 *   DecupagemScene  — o silêncio saindo da timeline, em loop.
 *   MiniPrints      — chamada de vídeo, post e live, os outros modelos.
 *
 * Nota de implementação: o app inteiro roda com `main { filter: saturate(.72) }`
 * (site propositalmente menos colorido). As peças de "imprensa" reaplicam
 * `saturate(1.39)` pra voltar ao normal — é o contraste que faz o vermelho de
 * plantão e o verde de chroma existirem.
 */

import { useEffect, useRef, useState } from 'react';
import { TipoShowcase } from '../../TipoShowcase';
import { useClock, useInView, useReduced, useTypewriter, waveBars } from './kit';

const UNSATURATE_FIX = 'saturate(1.39)';

const RED = '#e0483f';
const PAPER = '#f2efe6';
const INK = '#14140f';
const CHROMA = '#00b140';

/* ══════════════════════════ 1. BREAKING (telejornal) ══════════════════════════ */

/**
 * Chyron do gerador — copy SÓ de FakePrint (o card É um FakePrint).
 * Frases curtas de propósito: precisam caber no gerador sem truncar.
 */
const CHYRON = [
  'VOCÊ ESCREVE A MANCHETE DO DIA',
  'SÓ O GRÁFICO FICA DE PÉ NO CHROMA',
  'PNG EM ALTA OU .WEBM ANIMADO',
];

export function BreakingCard({ className = '' }: { className?: string }) {
  const { ref, inView } = useInView<HTMLDivElement>(0.2);
  const reduced = useReduced();
  const clock = useClock();
  const { text } = useTypewriter(CHYRON, { active: inView });
  const wiping = inView && !reduced;
  const vidRef = useRef<HTMLVideoElement | null>(null);

  // O vídeo do repórter só roda quando o card está na tela (e sem
  // reduced-motion). Fora disso fica no poster — 4 MB não descem à toa.
  useEffect(() => {
    const v = vidRef.current;
    if (!v) return;
    if (inView && !reduced) {
      const p = v.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } else {
      v.pause();
    }
  }, [inView, reduced]);

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
        {/* a transmissão — o repórter de verdade, com o gráfico por cima */}
        <video
          ref={vidRef}
          src="/hero/fakeprint-reporter.mp4"
          poster="/hero/fakeprint-reporter.jpg"
          muted
          loop
          playsInline
          preload="none"
          aria-hidden
          className="absolute inset-0 h-full w-full object-cover"
          style={{ objectPosition: '50% 26%' }}
        />
        {/* vinheta broadcast — legibilidade do gerador de caracteres */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(to top, rgba(2,2,6,0.82) 0%, rgba(2,2,6,0.28) 24%, transparent 46%),' +
              'linear-gradient(to bottom, rgba(2,2,6,0.5) 0%, transparent 20%)',
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

        {/* etiquetas dos dois lados do divisor */}
        <div className="absolute inset-x-3.5 top-14 flex items-center justify-between md:inset-x-4 md:top-16">
          <span
            className="rounded-[4px] border border-white/15 bg-black/45 px-2 py-1 text-[9px] font-bold uppercase tracking-[0.18em] text-white/70 backdrop-blur-sm"
            style={{ fontFamily: 'var(--font-label)' }}
          >
            Seu vídeo por trás
          </span>
          <span
            className="rounded-[4px] border border-white/50 bg-black/35 px-2 py-1 text-[9px] font-bold uppercase tracking-[0.18em] text-white backdrop-blur-sm"
            style={{ fontFamily: 'var(--font-label)' }}
          >
            Como sai · tela verde
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
              Manchete, hora, local e ticker editáveis
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
        {['PNG em alta', '.webm animado', '16:9 e 9:16', '14 emissoras'].map((c) => (
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
        — o gráfico sai em tela verde; na ilha, você solta o seu vídeo por trás e o
        plantão é seu.
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

/* ══════════════════════════ 2. TELEJORNAL (plantão CNN) ══════════════════════════ */

/**
 * Manchetes do lower third — cada linha é uma verdade do FakePrint.
 * Curtas de propósito: precisam caber na faixa sem quebrar.
 */
const TJ_HEADLINES = [
  'VOCÊ ESCREVE A MANCHETE DO JORNAL',
  'O CENÁRIO INTEIRO SAI EM TELA VERDE',
  'EXPORTA PNG EM ALTA OU .WEBM ANIMADO',
];

const TJ_TICKER = [
  'Manchete, tag, hora e local editáveis',
  '14 emissoras',
  'Relógio andando no .webm',
  '16:9 e 9:16',
  'Pronto pro chroma key',
  'O que você vê é o que baixa',
];

/**
 * Plantão de TV sem vídeo nenhum: o estúdio é CSS, o lower third digita as
 * manchetes e o ticker roda embaixo — tudo no vocabulário do que o FakePrint
 * exporta de verdade. O campo central tracejado é o convite: ali entra o
 * vídeo do cliente, por trás do gerador de caracteres.
 */
export function TelejornalCard({ className = '' }: { className?: string }) {
  const { ref, inView } = useInView<HTMLDivElement>(0.2);
  const reduced = useReduced();
  const clock = useClock();
  const { text } = useTypewriter(TJ_HEADLINES, { active: inView });
  const live = inView && !reduced;

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
            'radial-gradient(45% 45% at 22% 18%, rgba(224,72,63,0.22), transparent 70%),' +
            'radial-gradient(45% 45% at 82% 78%, rgba(0,177,64,0.14), transparent 70%)',
        }}
      />

      <div
        className="relative aspect-[16/10] w-full overflow-hidden rounded-[14px] border border-white/12"
        style={{
          background:
            'radial-gradient(90% 70% at 30% 10%, #101725 0%, #0a0f1a 55%, #060911 100%)',
          boxShadow:
            '0 40px 90px -32px rgba(0,0,0,0.95), 0 0 0 1px rgba(255,255,255,0.04) inset',
        }}
      >
        {/* varredura de luz do estúdio */}
        {live && (
          <span
            aria-hidden
            className="tj-sweep pointer-events-none absolute inset-y-0 w-[30%]"
            style={{
              background:
                'linear-gradient(105deg, transparent, rgba(255,255,255,0.06), transparent)',
            }}
          />
        )}
        {/* linhas de varredura broadcast */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.12]"
          style={{
            backgroundImage:
              'repeating-linear-gradient(0deg, rgba(255,255,255,0.5) 0px, rgba(255,255,255,0.5) 1px, transparent 1px, transparent 3px)',
          }}
        />
        {/* marcas de enquadramento */}
        {[
          'left-3 top-3 border-l border-t',
          'right-3 top-3 border-r border-t',
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
                className="tj-dot inline-block h-[6px] w-[6px] rounded-full"
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

        {/* campo chroma — onde entra o vídeo do cliente */}
        <div className="absolute inset-x-0 top-[26%] bottom-[34%] flex items-center justify-center px-8">
          <div
            className="tj-chroma relative flex h-full w-full max-w-[62%] flex-col items-center justify-center gap-1.5 rounded-[10px] border border-dashed"
            style={{
              borderColor: 'rgba(255,255,255,0.35)',
              background: `radial-gradient(80% 80% at 50% 45%, rgba(20,197,89,0.22) 0%, rgba(0,177,64,0.12) 55%, rgba(0,148,57,0.06) 100%)`,
            }}
          >
            <span
              className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/85"
              style={{ fontFamily: 'var(--font-label)' }}
            >
              Seu vídeo entra aqui
            </span>
            <span
              className="text-[8.5px] uppercase tracking-[0.2em]"
              style={{ fontFamily: 'var(--font-label)', color: CHROMA }}
            >
              tela verde · chroma key
            </span>
          </div>
        </div>

        {/* lower third */}
        <div className="absolute inset-x-0 bottom-0">
          <div className="flex items-stretch px-3.5 md:px-4">
            <span
              className="flex shrink-0 items-center px-2.5 text-[11px] font-extrabold uppercase tracking-[0.14em] text-white md:px-3 md:text-[12.5px]"
              style={{ background: RED, fontFamily: 'var(--font-tech)' }}
            >
              Urgente
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
                <span className="tj-caret" style={{ background: RED }} />
              </div>
            </div>
          </div>
          {/* ticker rolando */}
          <div
            className="flex items-stretch overflow-hidden"
            style={{ background: 'rgba(9,13,22,0.95)' }}
          >
            <div className="tj-mask relative flex-1 overflow-hidden py-1.5">
              <div className={'flex w-max items-center ' + (live ? 'tj-ticker' : '')}>
                {[false, true].map((hidden) => (
                  <div
                    key={String(hidden)}
                    className="flex shrink-0 items-center"
                    aria-hidden={hidden || undefined}
                  >
                    {TJ_TICKER.map((t, i) => (
                      <span key={i} className="flex items-center">
                        <span
                          className="whitespace-nowrap px-4 text-[9px] uppercase tracking-[0.2em] text-white/55"
                          style={{ fontFamily: 'var(--font-label)', fontWeight: 600 }}
                        >
                          {t}
                        </span>
                        <span
                          aria-hidden
                          className="h-[3px] w-[3px] shrink-0 rounded-full"
                          style={{ background: RED }}
                        />
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            </div>
            <span
              className="num flex shrink-0 items-center px-2.5 text-[9px] tracking-[0.2em] text-white/40"
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              16:9 · 9:16
            </span>
          </div>
        </div>
      </div>

      <style jsx>{`
        .tj-dot {
          animation: tj-pulse 1.6s ease-in-out infinite;
        }
        .tj-chroma {
          animation: tj-breathe 4.5s ease-in-out infinite;
        }
        .tj-caret {
          display: inline-block;
          width: 2px;
          height: 0.86em;
          margin-left: 3px;
          vertical-align: -0.08em;
          animation: tj-blink 1s steps(2, end) infinite;
        }
        .tj-sweep {
          animation: tj-sweep 7s linear infinite;
        }
        .tj-mask {
          -webkit-mask-image: linear-gradient(90deg, transparent, #000 4%, #000 94%, transparent);
          mask-image: linear-gradient(90deg, transparent, #000 4%, #000 94%, transparent);
        }
        .tj-ticker {
          animation: tj-scroll 22s linear infinite;
        }
        @keyframes tj-scroll {
          from {
            transform: translate3d(0, 0, 0);
          }
          to {
            transform: translate3d(-50%, 0, 0);
          }
        }
        @keyframes tj-sweep {
          from {
            transform: translateX(-140%);
          }
          to {
            transform: translateX(480%);
          }
        }
        @keyframes tj-breathe {
          0%,
          100% {
            box-shadow: 0 0 0 0 rgba(0, 177, 64, 0.0);
          }
          50% {
            box-shadow: 0 0 34px -6px rgba(0, 177, 64, 0.45);
          }
        }
        @keyframes tj-pulse {
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
        @keyframes tj-blink {
          50% {
            opacity: 0;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .tj-dot,
          .tj-caret,
          .tj-chroma,
          .tj-sweep,
          .tj-ticker {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}

/* ══════════════════════ 2b. LEGENDAS AUTOMÁTICAS (engine ao vivo) ══════════════════════ */

/**
 * O ENGINE REAL das Legendas Automáticas ciclando modelos num canvas — o que
 * aparece é exatamente o que a ferramenta queima no MP4, não um vídeo gravado.
 */
export function LegendasScene({ className = '' }: { className?: string }) {
  return (
    <div
      className={'relative overflow-hidden rounded-[18px] border border-white/10 ' + className}
      style={{
        aspectRatio: '16/10',
        background:
          'radial-gradient(120% 90% at 18% 0%, rgba(109,78,232,0.3), transparent 55%), radial-gradient(110% 80% at 88% 100%, rgba(255,214,10,0.12), transparent 50%), linear-gradient(165deg, #0b0a12 0%, #060509 55%, #0d0a14 100%)',
        boxShadow: '0 30px 70px -30px rgba(0,0,0,0.9)',
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />
      <TipoShowcase variant="hero" />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'linear-gradient(to top, rgba(2,2,6,0.55) 0%, transparent 26%)',
        }}
      />
      <span
        className="absolute bottom-3 left-3 rounded-[5px] bg-black/60 px-2 py-1 text-[9.5px] font-bold uppercase tracking-[0.18em] text-white/80 backdrop-blur-sm"
        style={{ fontFamily: 'var(--font-label)' }}
      >
        Motor real · 491 modelos
      </span>
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

        {/* a fila em lote — o resto dos arquivos esperando a vez */}
        <div className="mt-4">
          <div
            className="mb-1.5 text-[8.5px] uppercase tracking-[0.22em] text-white/35"
            style={{ fontFamily: 'var(--font-label)' }}
          >
            Fila do lote
          </div>
          <div className="flex flex-col gap-1.5">
            {QUEUE.map((q) => (
              <div
                key={q.name}
                className="flex items-center gap-2.5 rounded-[8px] border border-white/8 bg-black/25 px-2.5 py-1.5"
              >
                <span
                  className="num shrink-0 text-[9.5px] text-white/60"
                  style={{ fontFamily: 'var(--font-mono)' }}
                >
                  {q.name}
                </span>
                <span className="relative h-[3px] flex-1 overflow-hidden rounded-full bg-white/8">
                  <span
                    className="absolute inset-y-0 left-0 rounded-full"
                    style={{
                      width: `${q.pct}%`,
                      background: q.pct === 100 ? LIME : 'rgba(255,255,255,0.45)',
                    }}
                  />
                </span>
                <span
                  className="shrink-0 text-[8px] font-bold uppercase tracking-[0.14em]"
                  style={{
                    fontFamily: 'var(--font-label)',
                    color: q.pct === 100 ? LIME : q.pct > 0 ? 'rgba(255,255,255,0.65)' : 'rgba(255,255,255,0.3)',
                  }}
                >
                  {q.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Estado fixo da fila — a timeline acima é quem anima. */
const QUEUE = [
  { name: 'ad-hook-01.mp4', status: 'pronto · −28%', pct: 100 },
  { name: 'ad-hook-02.mp4', status: 'cortando silêncios…', pct: 64 },
  { name: 'ad-hook-03.mp4', status: 'na fila', pct: 0 },
];

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
