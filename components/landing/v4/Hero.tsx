'use client';

/**
 * Herói da landing v4 — a capa.
 *
 * Lettering no estilo das legendas virais que a ferramenta faz ("Já imaginou
 * editar 10x mais com muito menos esforço?", com a promessa numa tarja), a
 * resposta logo embaixo e o monitor de telejornal do FakePrint grande, em
 * perspectiva, endireitando conforme a pessoa rola. Por trás de tudo, fumaça
 * de estúdio em WebGL que reage ao mouse (Smoke.tsx).
 *
 * O monitor NÃO reage ao mouse (pedido de 08.10): a única animação dele é a
 * tela verde saindo pra mostrar o vídeo por trás. Clicando na tarja a pessoa
 * ainda pode escrever a própria manchete, que é o que o FakePrint faz.
 */

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useClock, useInView, useReduced, useTypewriter } from '../v3/kit';
import { useCalm, useMagnetic } from './fx';
import { Smoke } from './Smoke';

const RED = '#e0483f';
const PAPER = '#f2efe6';
const INK = '#14140f';
const CHROMA = '#00b140';

/* ══════════════════════ HERÓI ══════════════════════ */

export function Hero() {
  const ctaRef = useRef<HTMLAnchorElement | null>(null);
  useMagnetic(ctaRef, 0.18);

  return (
    <section className="hero relative isolate">
      <Smoke className="hero-smoke absolute inset-x-0 top-[-94px] -z-10 h-[calc(100%+94px)] w-full" />

      <div className="mx-auto max-w-[1360px] px-5 pt-12 md:px-8 md:pt-16">
        <div className="mx-auto max-w-[1280px] text-center">
          <h1 className="hero-h1 text-white">
            <span className="hero-ask block" style={{ fontFamily: 'var(--font-serif)' }}>
              <span className="hw" style={{ ['--i' as string]: 0 }}>
                Já imaginou
              </span>
            </span>
            <span className="hero-big inline md:block" style={{ fontFamily: 'var(--font-tech)' }}>
              <span className="hw" style={{ ['--i' as string]: 1 }}>
                {'editar '}
              </span>
              <span className="hero-mark hw" style={{ ['--i' as string]: 2 }}>
                <span aria-hidden className="hero-mark-box" />
                <span className="relative">10x mais</span>
              </span>
            </span>
            {/* espaço entre as linhas quando elas fluem juntas (celular), no tamanho da manchete */}
            <span className="hero-big md:hidden" style={{ fontFamily: 'var(--font-tech)' }}>
              {' '}
            </span>
            <span className="hero-big inline md:block" style={{ fontFamily: 'var(--font-tech)' }}>
              {['com', 'muito', 'menos', 'esforço?'].map((w, i, arr) => (
                <span key={w} className="hw" style={{ ['--i' as string]: i + 3 }}>
                  {w + (i < arr.length - 1 ? ' ' : '')}
                </span>
              ))}
            </span>
          </h1>

          <p className="hero-sub mx-auto mt-7 max-w-[60ch] text-[17px] leading-[1.65] text-white/[0.68] md:text-[19px]">
            Legenda animada corrigida pela copy, silêncio cortado sozinho e manchete de
            telejornal pronta pro chroma. Você só revisa e entrega.
          </p>

          <div className="hero-cta mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link
              ref={ctaRef}
              href="/register"
              className="btn-primary hero-btn !rounded-[12px] !py-0 !pl-6 !pr-2 !text-[15.5px]"
            >
              Criar conta grátis
              <span aria-hidden className="hero-btn-ico">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path
                    d="M3 7h8m0 0L7.5 3.5M11 7l-3.5 3.5"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
            </Link>
            <a href="#legendas" className="btn-secondary !rounded-[12px] !px-6 !text-[15px]">
              Ver as ferramentas
            </a>
          </div>
          <p className="hero-note mt-5 text-[13.5px] text-white/50">Grátis pra começar. Não pede cartão.</p>
        </div>

        <Screen />
      </div>

      <style jsx>{`
        .hero-h1 {
          letter-spacing: -0.035em;
        }
        .hero-ask {
          font-style: italic;
          font-weight: 400;
          font-size: clamp(30px, 3.6vw, 54px);
          line-height: 1.1;
          letter-spacing: -0.01em;
          color: rgba(255, 255, 255, 0.72);
          padding-bottom: 0.1em;
        }
        .hero-big {
          font-weight: 800;
          font-size: clamp(40px, 5.6vw, 88px);
          line-height: 1.02;
        }
        .hw {
          display: inline-block;
          white-space: pre;
          animation: hw-in 1s cubic-bezier(0.16, 1, 0.3, 1) both;
          animation-delay: calc(80ms + var(--i) * 80ms);
        }
        .hero-mark {
          position: relative;
          padding: 0 0.16em;
          margin-left: 0.04em;
          color: #fff;
        }
        .hero-mark-box {
          position: absolute;
          inset: 0.06em -0.02em 0.02em;
          border-radius: 0.12em;
          background: linear-gradient(180deg, #ef5a4f, ${RED} 60%, #c9372f);
          box-shadow: 0 0.16em 0 rgba(120, 18, 12, 0.55), 0 18px 50px -12px rgba(224, 72, 63, 0.75);
          transform-origin: 0 50%;
          transform: rotate(-2deg) scaleX(0);
          animation: mark-in 0.7s 0.55s cubic-bezier(0.32, 0.72, 0, 1) forwards;
        }
        @keyframes mark-in {
          to {
            transform: rotate(-2deg) scaleX(1);
          }
        }
        .hero-sub,
        .hero-cta,
        .hero-note {
          animation: hw-fade 0.9s cubic-bezier(0.16, 1, 0.3, 1) both;
        }
        .hero-sub {
          animation-delay: 0.75s;
        }
        .hero-cta {
          animation-delay: 0.88s;
        }
        .hero-note {
          animation-delay: 1s;
        }
        @keyframes hw-in {
          from {
            opacity: 0;
            transform: translate3d(0, 0.5em, 0) rotate(2deg);
            filter: blur(6px);
          }
          to {
            opacity: 1;
            transform: none;
            filter: blur(0);
          }
        }
        @keyframes hw-fade {
          from {
            opacity: 0;
            transform: translate3d(0, 14px, 0);
          }
          to {
            opacity: 1;
            transform: none;
          }
        }
        .hero-btn {
          min-height: 56px;
          gap: 14px;
        }
        .hero-btn-ico {
          display: grid;
          place-items: center;
          width: 40px;
          height: 40px;
          border-radius: 9px;
          background: rgba(33, 20, 51, 0.12);
          box-shadow: inset 0 0 0 1px rgba(33, 20, 51, 0.16);
          transition: transform 0.35s cubic-bezier(0.32, 0.72, 0, 1);
        }
        :global(.hero-btn:hover) .hero-btn-ico {
          transform: translateX(3px);
        }
        :global(.hero-smoke) {
          -webkit-mask-image: linear-gradient(to bottom, #000 0%, #000 70%, transparent 100%);
          mask-image: linear-gradient(to bottom, #000 0%, #000 70%, transparent 100%);
        }
        @media (prefers-reduced-motion: reduce) {
          .hw,
          .hero-sub,
          .hero-cta,
          .hero-note {
            animation: none;
          }
          .hero-mark-box {
            animation: none;
            transform: rotate(-2deg);
          }
        }
      `}</style>
    </section>
  );
}

/* ══════════════════════ a tela (monitor em perspectiva) ══════════════════════ */

function Screen() {
  return (
    <div className="screen-wrap relative mx-auto mt-14 max-w-[1120px] md:mt-20">
      <div className="screen-scroll">
        <div className="screen-tilt">
          <Monitor />
        </div>
      </div>
      <p className="mt-5 text-center text-[12.5px] text-white/45">
        Telejornal do FakePrint, no Premium: o gráfico sai em tela verde e, na edição, o seu vídeo entra por trás.
      </p>
      <style jsx>{`
        /* entrada: sobe e aparece (uma vez) */
        .screen-tilt {
          animation: screen-in 1.4s 0.35s cubic-bezier(0.16, 1, 0.3, 1) both;
        }
        @keyframes screen-in {
          from {
            opacity: 0;
            transform: translate3d(0, 70px, 0) scale(0.96);
          }
          to {
            opacity: 1;
            transform: none;
          }
        }
        /* inclinada pra trás; endireita conforme a pessoa rola (onde o
           navegador tem animação ligada à rolagem; nos outros fica levemente
           inclinada, parada) */
        .screen-scroll {
          transform-origin: 50% 0%;
          transform: perspective(1800px) rotateX(5deg);
        }
        @supports (animation-timeline: view()) {
          .screen-scroll {
            animation: screen-flat linear both;
            animation-timeline: view();
            animation-range: entry 5% cover 40%;
          }
        }
        @keyframes screen-flat {
          from {
            transform: perspective(1800px) rotateX(10deg) scale(0.96);
          }
          to {
            transform: perspective(1800px) rotateX(0deg) scale(1);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .screen-tilt,
          .screen-scroll {
            animation: none;
            transform: none;
          }
        }
      `}</style>
    </div>
  );
}

/* ────────────── monitor do telejornal (FakePrint) ────────────── */

/** Tarja — só FakePrint: o monitor É um FakePrint. Curtas pra caber sem truncar. */
const CHYRON = [
  'SUA MANCHETE PRONTA EM SEGUNDOS',
  'O GRÁFICO SAI EM TELA VERDE',
  'PNG EM ALTA OU VÍDEO ANIMADO',
];

function Monitor() {
  const { ref, inView } = useInView<HTMLDivElement>(0.2);
  const reduced = useReduced();
  const calm = useCalm();
  const vidRef = useRef<HTMLVideoElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const live = inView && !reduced;
  const [custom, setCustom] = useState('');
  const [editing, setEditing] = useState(false);
  const [touched, setTouched] = useState(false);

  // vídeo só roda com o monitor na tela (e sem reduced-motion)
  useEffect(() => {
    const v = vidRef.current;
    if (!v) return;
    if (inView && !reduced && !calm) {
      const p = v.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } else v.pause();
  }, [inView, reduced, calm]);

  const commit = () => {
    setEditing(false);
    setCustom((c) => c.trim());
  };

  return (
    <div ref={ref} className="relative" style={{ filter: 'saturate(1.39)' }}>
      {/* luz por trás do monitor */}
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-16 -z-10 opacity-80 blur-3xl"
        style={{
          background:
            'radial-gradient(45% 45% at 28% 22%, rgba(224,72,63,0.22), transparent 70%),' +
            'radial-gradient(45% 45% at 82% 78%, rgba(167,139,250,0.2), transparent 70%)',
        }}
      />

      <div
        className="mon relative aspect-[16/10] w-full overflow-hidden rounded-[16px]"
        style={{ background: '#0b0d10' }}
      >
        <video
          ref={vidRef}
          src="/landing/hero-tv.mp4"
          poster="/landing/hero-tv.jpg"
          muted
          loop
          playsInline
          preload="none"
          aria-hidden
          className="absolute inset-0 h-full w-full object-cover"
          style={{ objectPosition: '50% 30%' }}
        />
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(to top, rgba(2,2,6,0.78) 0%, rgba(2,2,6,0.18) 22%, transparent 40%),' +
              'linear-gradient(to bottom, rgba(2,2,6,0.42) 0%, transparent 18%)',
          }}
        />

        {/* A única animação do card (pedido de 08.10, sem mouse): a tela
            verde sai e mostra o vídeo por trás, segura, e volta. A janela anda
            pra direita e o verde o mesmo tanto pra esquerda (fica parado; só a
            borda desliza). Só transform. */}
        <div
          aria-hidden
          className={'ae-ambient absolute inset-0 overflow-hidden ' + (live ? 'mw-auto' : '')}
          style={{ transform: 'translateX(58%)' }}
        >
          <div
            className={'ae-ambient absolute inset-0 ' + (live ? 'mw-auto mw-in' : '')}
            style={{
              transform: 'translateX(-58%)',
              background: `radial-gradient(75% 70% at 50% 40%, #14c559 0%, ${CHROMA} 62%, #009439 100%)`,
            }}
          />
        </div>
        <div
          aria-hidden
          className={'ae-ambient pointer-events-none absolute inset-0 ' + (live ? 'mw-auto' : '')}
          style={{ transform: 'translateX(58%)' }}
        >
          <span className="mw-line" />
        </div>

        {[
          'left-3 top-3 border-l border-t',
          'right-3 top-3 border-r border-t',
          'left-3 bottom-3 border-l border-b',
          'right-3 bottom-3 border-r border-b',
        ].map((pos) => (
          <span key={pos} aria-hidden className={'pointer-events-none absolute h-3.5 w-3.5 border-white/25 ' + pos} />
        ))}

        {/* topo */}
        <div className="absolute inset-x-0 top-0 flex items-start justify-between p-3.5 md:p-4">
          <span
            className="inline-flex items-center rounded-[4px] px-2 py-1 text-[10.5px] font-extrabold uppercase tracking-[0.2em] text-white"
            style={{ background: RED, fontFamily: 'var(--font-tech)' }}
          >
            AE NEWS
          </span>
          <div className="flex items-center gap-2">
            <span
              className="inline-flex items-center gap-1.5 rounded-[4px] border border-white/20 bg-black/45 px-2 py-1 text-[9.5px] font-bold uppercase tracking-[0.2em] text-white"
              style={{ fontFamily: 'var(--font-label)' }}
            >
              <i className="mon-dot ae-ambient inline-block h-[6px] w-[6px] rounded-full" style={{ background: RED }} />
              Ao vivo
            </span>
            <span
              className="num rounded-[4px] border border-white/15 bg-black/45 px-2 py-1 text-[10.5px] text-white/85"
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              <LiveClock />
            </span>
          </div>
        </div>

        {live ? (
          <div className="absolute left-3.5 top-14 hidden sm:block md:left-4 md:top-16">
            <span className="mw-lab mw-lab-green ae-ambient" style={{ fontFamily: 'var(--font-label)' }}>
              Como sai do FakePrint: tela verde
            </span>
            <span className="mw-lab mw-lab-video ae-ambient" style={{ fontFamily: 'var(--font-label)' }}>
              Na edição: o seu vídeo por trás
            </span>
          </div>
        ) : (
          <div className="absolute inset-x-3.5 top-14 hidden items-center justify-between sm:flex md:inset-x-4 md:top-16">
            <span className="mw-lab-static" style={{ fontFamily: 'var(--font-label)' }}>
              Seu vídeo por trás
            </span>
            <span className="mw-lab-static" style={{ fontFamily: 'var(--font-label)' }}>
              Como sai: tela verde
            </span>
          </div>
        )}

        {/* gerador de caracteres — editável de verdade */}
        <div className="absolute inset-x-0 bottom-0">
          {!touched && (
            <div className="mon-hint pointer-events-none absolute -top-9 left-4 hidden items-center gap-1.5 rounded-full border border-white/25 bg-black/60 px-2.5 py-1 text-[11px] font-semibold text-white/90 backdrop-blur-sm sm:flex">
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
                <path d="M7.6 2.2l2.2 2.2L4.2 10H2V7.8l5.6-5.6z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
              </svg>
              Clica na tarja e escreve a sua manchete
            </div>
          )}
          <div className="flex items-stretch px-3.5 md:px-4">
            <span
              className="flex shrink-0 items-center px-2.5 text-[11px] font-extrabold uppercase tracking-[0.14em] text-white md:px-3 md:text-[12.5px]"
              style={{ background: RED, fontFamily: 'var(--font-tech)' }}
            >
              Plantão
            </span>
            <label
              className="mon-chyron relative min-w-0 flex-1 cursor-text px-3 py-2 md:px-3.5 md:py-2.5"
              style={{ background: PAPER }}
            >
              <span className="sr-only">Escreva uma manchete de teste</span>
              <span
                aria-hidden
                className="block truncate text-[13px] font-extrabold uppercase leading-tight tracking-[-0.01em] md:text-[16.5px]"
                style={{ color: INK, fontFamily: 'var(--font-tech)' }}
              >
                {editing || custom ? custom || '' : <TypedChyron active={inView} />}
                <span className={'mon-caret ae-ambient ' + (editing ? 'is-edit' : '')} style={{ background: RED }} />
              </span>
              <input
                ref={inputRef}
                value={custom}
                maxLength={44}
                onFocus={() => {
                  setEditing(true);
                  setTouched(true);
                }}
                onBlur={commit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === 'Escape') inputRef.current?.blur();
                }}
                onChange={(e) => setCustom(e.target.value.toUpperCase())}
                className="absolute inset-0 h-full w-full cursor-text opacity-0"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
          </div>
          <div className="flex items-center gap-2 px-3.5 py-1.5 md:px-4" style={{ background: 'rgba(10,12,15,0.92)' }}>
            <span
              className="truncate text-[9px] font-bold uppercase tracking-[0.22em] text-white/45"
              style={{ fontFamily: 'var(--font-label)' }}
            >
              {custom ? 'Essa manchete é sua. No FakePrint, sai em PNG ou vídeo' : 'Manchete, hora, local e ticker editáveis'}
            </span>
            <span className="h-px flex-1 bg-white/10" />
            <span className="num text-[9px] tracking-[0.2em] text-white/35" style={{ fontFamily: 'var(--font-mono)' }}>
              16:9 · 9:16
            </span>
          </div>
        </div>
      </div>

      <style jsx>{`
        .mon {
          box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.12), 0 1px 0 rgba(255, 255, 255, 0.1) inset,
            0 50px 110px -40px rgba(0, 0, 0, 0.95), 0 30px 60px -30px rgba(224, 72, 63, 0.18);
        }
        .mw-line {
          position: absolute;
          top: 0;
          bottom: 0;
          left: 0;
          width: 2px;
          margin-left: -1px;
          background: rgba(255, 255, 255, 0.9);
          box-shadow: 0 0 16px rgba(255, 255, 255, 0.6);
        }
        /* verde cobre tudo → sai revelando o vídeo → segura → volta */
        .mw-auto {
          animation: mw-wipe 11s infinite;
        }
        .mw-in.mw-auto {
          animation-name: mw-wipe-in;
        }
        @keyframes mw-wipe {
          0%,
          14% {
            transform: translateX(0%);
            animation-timing-function: cubic-bezier(0.65, 0, 0.35, 1);
          }
          40%,
          82% {
            transform: translateX(101%);
            animation-timing-function: cubic-bezier(0.65, 0, 0.35, 1);
          }
          100% {
            transform: translateX(0%);
          }
        }
        @keyframes mw-wipe-in {
          0%,
          14% {
            transform: translateX(0%);
            animation-timing-function: cubic-bezier(0.65, 0, 0.35, 1);
          }
          40%,
          82% {
            transform: translateX(-101%);
            animation-timing-function: cubic-bezier(0.65, 0, 0.35, 1);
          }
          100% {
            transform: translateX(0%);
          }
        }
        .mw-lab,
        .mw-lab-static {
          display: inline-block;
          border-radius: 4px;
          padding: 4px 8px;
          font-size: 9.5px;
          font-weight: 700;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: #fff;
          background: rgba(0, 0, 0, 0.45);
          border: 1px solid rgba(255, 255, 255, 0.3);
          white-space: nowrap;
        }
        .mw-lab {
          position: absolute;
          left: 0;
          top: 0;
          animation-duration: 11s;
          animation-iteration-count: infinite;
        }
        .mw-lab-green {
          animation-name: mw-lab-green;
        }
        .mw-lab-video {
          animation-name: mw-lab-video;
          opacity: 0;
        }
        @keyframes mw-lab-green {
          0%,
          25% {
            opacity: 1;
          }
          29%,
          89% {
            opacity: 0;
          }
          93%,
          100% {
            opacity: 1;
          }
        }
        @keyframes mw-lab-video {
          0%,
          25% {
            opacity: 0;
          }
          29%,
          89% {
            opacity: 1;
          }
          93%,
          100% {
            opacity: 0;
          }
        }
        .mon-dot {
          animation: mon-pulse 1.6s ease-in-out infinite;
        }
        .mon-caret {
          display: inline-block;
          width: 2px;
          height: 0.86em;
          margin-left: 3px;
          vertical-align: -0.08em;
          animation: mon-blink 1s steps(2, end) infinite;
        }
        .mon-chyron:hover {
          box-shadow: inset 0 0 0 2px rgba(224, 72, 63, 0.55);
        }
        .mon-hint {
          animation: mon-hint 0.6s 1.6s cubic-bezier(0.16, 1, 0.3, 1) both;
        }
        @keyframes mon-hint {
          from {
            opacity: 0;
            transform: translateY(6px);
          }
          to {
            opacity: 1;
            transform: none;
          }
        }
        @keyframes mon-pulse {
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
        @keyframes mon-blink {
          50% {
            opacity: 0;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .mw-auto,
          .mw-lab,
          .mon-dot,
          .mon-caret,
          .mon-hint {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}

/** Relógio em componente-folha: o tique de 1 s não re-renderiza o monitor. */
function LiveClock() {
  return <>{useClock()}</>;
}

/** A tarja digitando sozinha, também folha: cada letra re-renderiza só ela. */
function TypedChyron({ active }: { active: boolean }) {
  const { text } = useTypewriter(CHYRON, { active });
  return <>{text || ' '}</>;
}
