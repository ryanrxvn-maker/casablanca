'use client';

/**
 * Herói da landing v4 — a capa.
 *
 * Lettering no estilo das legendas virais que a ferramenta faz (a pergunta que
 * dá o gatilho, a palavra-chave numa tarja), a resposta logo embaixo e o
 * monitor de telejornal do FakePrint grande, em perspectiva, endireitando
 * conforme a pessoa rola. Por trás de tudo, fumaça de estúdio em WebGL que
 * reage ao mouse (Smoke.tsx).
 *
 * No monitor (só com mouse; toque e reduced-motion ficam parados e legíveis):
 *   • o divisor da tela verde segue o cursor;
 *   • clicando na tarja, a pessoa escreve a própria manchete, que é o que o
 *     FakePrint faz.
 */

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useClock, useInView, useReduced, useTypewriter } from '../v3/kit';
import { useCalm, useMagnetic, usePointerField } from './fx';
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
        <div className="mx-auto max-w-[1180px] text-center">
          <h1 className="hero-h1 text-white">
            <span className="hero-ask block" style={{ fontFamily: 'var(--font-serif)' }}>
              <span className="hw" style={{ ['--i' as string]: 0 }}>
                Já imaginou
              </span>
            </span>
            <span className="hero-big inline md:block" style={{ fontFamily: 'var(--font-tech)' }}>
              {['entregar', 'o', 'criativo'].map((w, i) => (
                <span key={w} className="hw" style={{ ['--i' as string]: i + 1 }}>
                  {w}
                  {i < 2 ? ' ' : ''}
                </span>
              ))}
            </span>
            {/* espaço entre as linhas quando elas fluem juntas (celular), no tamanho da manchete */}
            <span className="hero-big md:hidden" style={{ fontFamily: 'var(--font-tech)' }}>
              {' '}
            </span>
            <span className="hero-big inline md:block" style={{ fontFamily: 'var(--font-tech)' }}>
              {['antes', 'do', 'cliente'].map((w, i) => (
                <span key={w} className="hw" style={{ ['--i' as string]: i + 4 }}>
                  {w + ' '}
                </span>
              ))}
              <span className="hero-mark hw" style={{ ['--i' as string]: 7 }}>
                <span aria-hidden className="hero-mark-box" />
                <span className="relative">cobrar?</span>
              </span>
            </span>
          </h1>

          <p className="hero-sub mx-auto mt-7 max-w-[60ch] text-[17px] leading-[1.65] text-white/[0.68] md:text-[19px]">
            O Auto Edit faz a parte chata por você: corta o silêncio, cria legenda
            animada corrigida pela copy e deixa a manchete de telejornal pronta pro chroma.
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
          font-size: clamp(40px, 6.4vw, 100px);
          line-height: 1;
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
          animation: mark-in 0.7s 1.05s cubic-bezier(0.32, 0.72, 0, 1) forwards;
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
  const zoneRef = useRef<HTMLDivElement | null>(null);
  const rigRef = useRef<HTMLDivElement | null>(null);

  // gira alguns graus seguindo o mouse em qualquer ponto da janela
  const onFrame = useCallback((x: number, y: number) => {
    const rig = rigRef.current;
    if (!rig) return;
    rig.style.transform = `rotateY(${(x * 4).toFixed(3)}deg) rotateX(${(-y * 3).toFixed(3)}deg)`;
  }, []);
  usePointerField(zoneRef, onFrame, { global: true, ease: 0.07 });

  return (
    <div ref={zoneRef} className="screen-wrap relative mx-auto mt-14 max-w-[1120px] md:mt-20">
      <div className="screen-scroll">
        <div className="screen-tilt">
          <div ref={rigRef} className="screen-rig">
            <Monitor />
          </div>
        </div>
      </div>
      <p className="mt-5 text-center text-[12.5px] text-white/45">
        Telejornal do FakePrint, no Premium. Passa o mouse na tela e clica na tarja pra testar.
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
          transform: perspective(1800px) rotateX(7deg);
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
            transform: perspective(1800px) rotateX(16deg) scale(0.95);
          }
          to {
            transform: perspective(1800px) rotateX(0deg) scale(1);
          }
        }
        .screen-rig {
          transform-style: preserve-3d;
          will-change: transform;
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
  const winRef = useRef<HTMLDivElement | null>(null);
  const greenRef = useRef<HTMLDivElement | null>(null);
  const lineRef = useRef<HTMLDivElement | null>(null);
  const glareRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

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

  // Divisor da tela verde: anda sozinho (CSS, só transform) e, com o mouse
  // em cima do monitor, segue o cursor. Ao sair, volta pro ponto de partida
  // da animação e só então ela é religada — sem pulo.
  const autoRef = useRef(true);
  const setWipe = (pct: number) => {
    const p = pct.toFixed(2) + '%';
    if (winRef.current) winRef.current.style.transform = `translateX(${p})`;
    if (lineRef.current) lineRef.current.style.transform = `translateX(${p})`;
    if (greenRef.current) greenRef.current.style.transform = `translateX(-${p})`;
  };
  const setAuto = (on: boolean) => {
    if (autoRef.current === on) return;
    autoRef.current = on;
    for (const el of [winRef.current, lineRef.current, greenRef.current]) {
      if (!el) continue;
      el.classList.toggle('mw-auto', on);
      if (on) el.style.transform = '';
    }
  };
  const monRef = useRef<HTMLDivElement | null>(null);
  const leaveRef = useRef<{ x: number; p: number } | null>(null);
  const lastPRef = useRef(58);
  const onMonFrame = useCallback((x: number, y: number, inside: boolean) => {
    const g = glareRef.current;
    if (g) {
      g.style.transform = `translate3d(${(x * 34).toFixed(1)}%, ${(y * 30).toFixed(1)}%, 0)`;
      g.style.opacity = inside ? '1' : '0';
    }
    if (inside) {
      leaveRef.current = null;
      setAuto(false);
      const p = Math.max(6, Math.min(94, ((x + 1) / 2) * 100));
      lastPRef.current = p;
      setWipe(p);
    } else if (!autoRef.current) {
      // Saiu: o campo volta pro centro (x → 0); a gente usa essa mesma curva
      // pra levar o divisor até 26%, onde a animação automática começa.
      if (!leaveRef.current) leaveRef.current = { x, p: lastPRef.current };
      const { x: x0, p: p0 } = leaveRef.current;
      const k = Math.abs(x0) > 0.001 ? Math.max(0, Math.min(1, x / x0)) : 0;
      setWipe(26 + (p0 - 26) * k);
      if (k < 0.02) {
        leaveRef.current = null;
        setAuto(true);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  usePointerField(monRef, onMonFrame, { ease: 0.16 });

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
        ref={monRef}
        className="mon relative aspect-[16/10] w-full overflow-hidden rounded-[16px]"
        style={{ background: '#0b0d10' }}
      >
        <video
          ref={vidRef}
          src="/hero/fakeprint-landing.mp4"
          poster="/hero/fakeprint-landing.jpg"
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
              'linear-gradient(to top, rgba(2,2,6,0.82) 0%, rgba(2,2,6,0.25) 25%, transparent 46%),' +
              'linear-gradient(to bottom, rgba(2,2,6,0.5) 0%, transparent 20%)',
          }}
        />

        {/* tela verde: a janela anda pra direita e o verde o mesmo tanto pra
            esquerda (fica parado; só a borda desliza). Só transform. */}
        <div
          ref={winRef}
          aria-hidden
          className={'ae-ambient absolute inset-0 overflow-hidden ' + (inView && !reduced ? 'mw-auto' : '')}
          style={{ transform: 'translateX(58%)' }}
        >
          <div
            ref={greenRef}
            className={'ae-ambient absolute inset-0 ' + (inView && !reduced ? 'mw-auto mw-in' : '')}
            style={{
              transform: 'translateX(-58%)',
              background: `radial-gradient(75% 70% at 50% 40%, #14c559 0%, ${CHROMA} 62%, #009439 100%)`,
            }}
          />
        </div>
        <div
          ref={lineRef}
          aria-hidden
          className={'ae-ambient pointer-events-none absolute inset-0 ' + (inView && !reduced ? 'mw-auto' : '')}
          style={{ transform: 'translateX(58%)' }}
        >
          <span className="mw-handle">
            <span className="mw-knob">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M4.2 3L1.5 6l2.7 3M7.8 3l2.7 3-2.7 3" stroke="#0b0d10" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </span>
        </div>

        {/* varredura + reflexo que segue o mouse */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.13]"
          style={{
            backgroundImage:
              'repeating-linear-gradient(0deg, rgba(255,255,255,0.5) 0px, rgba(255,255,255,0.5) 1px, transparent 1px, transparent 3px)',
          }}
        />
        <div ref={glareRef} aria-hidden className="mon-glare pointer-events-none absolute -inset-[30%]" />

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

        <div className="absolute inset-x-3.5 top-14 hidden items-center justify-between sm:flex md:inset-x-4 md:top-16">
          <span
            className="rounded-[4px] border border-white/15 bg-black/45 px-2 py-1 text-[9px] font-bold uppercase tracking-[0.18em] text-white/70"
            style={{ fontFamily: 'var(--font-label)' }}
          >
            Seu vídeo por trás
          </span>
          <span
            className="rounded-[4px] border border-white/50 bg-black/35 px-2 py-1 text-[9px] font-bold uppercase tracking-[0.18em] text-white"
            style={{ fontFamily: 'var(--font-label)' }}
          >
            Como sai: tela verde
          </span>
        </div>

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
        .mw-handle {
          position: absolute;
          top: 0;
          bottom: 0;
          left: 0;
          width: 1px;
          background: rgba(255, 255, 255, 0.8);
          box-shadow: 0 0 14px rgba(255, 255, 255, 0.55);
        }
        .mw-knob {
          position: absolute;
          top: 44%;
          left: 0;
          display: grid;
          place-items: center;
          width: 26px;
          height: 26px;
          margin-left: -13px;
          border-radius: 999px;
          background: #fff;
          box-shadow: 0 6px 16px -4px rgba(0, 0, 0, 0.6);
        }
        .mw-auto {
          animation: mw-wipe 9s cubic-bezier(0.45, 0, 0.55, 1) infinite alternate;
        }
        .mw-in.mw-auto {
          animation-name: mw-wipe-in;
        }
        @keyframes mw-wipe {
          from {
            transform: translateX(26%);
          }
          to {
            transform: translateX(82%);
          }
        }
        @keyframes mw-wipe-in {
          from {
            transform: translateX(-26%);
          }
          to {
            transform: translateX(-82%);
          }
        }
        .mon-glare {
          opacity: 0;
          transition: opacity 0.5s ease;
          background: radial-gradient(28% 28% at 50% 50%, rgba(255, 255, 255, 0.14), transparent 70%);
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
