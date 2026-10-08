'use client';

/**
 * Herói da landing v4 — "a capa da edição".
 *
 * Esquerda: a manchete do site. Direita: o estúdio — um monitor de telejornal
 * do FakePrint (vídeo de verdade + gerador de caracteres + tela verde) e, na
 * frente dele, um celular com a versão 9:16 rodando legenda no MOTOR REAL das
 * Legendas Automáticas. Os dois formatos que o editor entrega, lado a lado.
 *
 * Interação (só com mouse; toque e reduced-motion ficam na pose de repouso):
 *   • o estúdio inteiro gira alguns graus seguindo o mouse (profundidade real:
 *     o celular está mais perto da câmera que o monitor);
 *   • passando o mouse no monitor, o divisor da tela verde segue o cursor;
 *   • clicando na tarja, a pessoa escreve a própria manchete — é exatamente o
 *     que o FakePrint faz.
 */

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useClock, useInView, useReduced, useTypewriter } from '../v3/kit';
import { useCalm, useMagnetic, usePointerField } from './fx';
import { makeBlocks, useLegendaCanvas, type LegendaProgram } from './legenda';
import { getPreset } from '@/lib/typography/presets';

const RED = '#e0483f';
const PAPER = '#f2efe6';
const INK = '#14140f';
const CHROMA = '#00b140';

/* ══════════════════════ HERÓI ══════════════════════ */

export function Hero() {
  const ctaRef = useRef<HTMLAnchorElement | null>(null);
  useMagnetic(ctaRef, 0.18);

  return (
    <section className="hero relative">
      {/* chão do estúdio: grade em perspectiva sumindo no fundo. Parada. */}
      <div aria-hidden className="hero-floor pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-[46%]" />

      <div className="mx-auto grid min-h-[calc(100dvh-94px)] max-w-[1360px] grid-cols-1 items-center gap-12 px-5 pb-16 pt-10 md:px-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-6 lg:pb-20 lg:pt-6">
        {/* manchete */}
        <div className="relative z-10 max-w-[640px]">
          <h1 className="hero-h1 text-white">
            <span className="hero-l1 block" style={{ fontFamily: 'var(--font-tech)' }}>
              {['Você', 'edita.'].map((w, i) => (
                <span key={w} className="hw" style={{ ['--i' as string]: i }}>
                  {w}
                  {i === 0 ? ' ' : ''}
                </span>
              ))}
            </span>
            <span className="hero-l2 block text-white/[0.72]" style={{ fontFamily: 'var(--font-serif)' }}>
              {[['A', 'gente', 'adianta'], ['o', 'resto.']].map((line, li) => (
                <span key={li} className="block">
                  {line.map((w, i) => (
                    <span key={w} className="hw" style={{ ['--i' as string]: 2 + li * 3 + i }}>
                      {w}
                      {i < line.length - 1 ? ' ' : ''}
                    </span>
                  ))}
                </span>
              ))}
            </span>
          </h1>

          <p className="hero-sub mt-7 max-w-[46ch] text-[16.5px] leading-[1.65] text-white/[0.62] md:text-[17.5px]">
            Legenda corrigida pela copy, silêncio cortado e manchete de telejornal
            pronta pro chroma. Ferramentas de edição que abrem no navegador.
          </p>

          <div className="hero-cta mt-9 flex flex-wrap items-center gap-3">
            <Link ref={ctaRef} href="/register" className="btn-primary hero-btn !rounded-[12px] !py-0 !pl-6 !pr-2 !text-[15px]">
              Criar conta grátis
              <span aria-hidden className="hero-btn-ico">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M3 7h8m0 0L7.5 3.5M11 7l-3.5 3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </Link>
            <a href="#legendas" className="btn-secondary !rounded-[12px] !px-6 !text-[14.5px]">
              Ver as ferramentas
            </a>
          </div>

          <p className="hero-note mt-5 text-[13px] text-white/45">
            Grátis pra começar. Não pede cartão.
          </p>
        </div>

        {/* estúdio */}
        <div className="hero-stage-wrap relative z-0">
          <Studio />
        </div>
      </div>

      <style jsx>{`
        .hero-h1 {
          font-size: clamp(46px, 6.1vw, 96px);
          line-height: 0.98;
          letter-spacing: -0.035em;
        }
        .hero-l1 {
          font-weight: 800;
        }
        .hero-l2 {
          font-style: italic;
          font-weight: 400;
          letter-spacing: -0.015em;
          line-height: 1.04;
          padding-bottom: 0.08em;
        }
        .hw {
          display: inline-block;
          white-space: pre;
          animation: hw-in 1s cubic-bezier(0.16, 1, 0.3, 1) both;
          animation-delay: calc(80ms + var(--i) * 75ms);
        }
        .hero-sub,
        .hero-cta,
        .hero-note {
          animation: hw-fade 0.9s cubic-bezier(0.16, 1, 0.3, 1) both;
        }
        .hero-sub {
          animation-delay: 0.55s;
        }
        .hero-cta {
          animation-delay: 0.68s;
        }
        .hero-note {
          animation-delay: 0.8s;
        }
        @keyframes hw-in {
          from {
            opacity: 0;
            transform: translate3d(0, 0.55em, 0) rotate(2deg);
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
          min-height: 54px;
          gap: 14px;
        }
        .hero-btn-ico {
          display: grid;
          place-items: center;
          width: 38px;
          height: 38px;
          border-radius: 9px;
          background: rgba(33, 20, 51, 0.12);
          box-shadow: inset 0 0 0 1px rgba(33, 20, 51, 0.16);
          transition: transform 0.35s cubic-bezier(0.32, 0.72, 0, 1);
        }
        :global(.hero-btn:hover) .hero-btn-ico {
          transform: translateX(3px);
        }
        .hero-floor {
          background-image: linear-gradient(rgba(255, 255, 255, 0.07) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255, 255, 255, 0.07) 1px, transparent 1px);
          background-size: 64px 64px;
          transform: perspective(700px) rotateX(62deg);
          transform-origin: 50% 100%;
          -webkit-mask-image: linear-gradient(to top, #000 0%, transparent 78%);
          mask-image: linear-gradient(to top, #000 0%, transparent 78%);
          opacity: 0.55;
        }
        @media (prefers-reduced-motion: reduce) {
          .hw,
          .hero-sub,
          .hero-cta,
          .hero-note {
            animation: none;
          }
        }
      `}</style>
    </section>
  );
}

/* ══════════════════════ ESTÚDIO (monitor + celular) ══════════════════════ */

function Studio() {
  const zoneRef = useRef<HTMLDivElement | null>(null);
  const rigRef = useRef<HTMLDivElement | null>(null);

  // O estúdio gira com o mouse em QUALQUER ponto da janela (centrado nele):
  // a pessoa sente a profundidade antes mesmo de chegar no monitor.
  const onFrame = useCallback((x: number, y: number) => {
    const rig = rigRef.current;
    if (!rig) return;
    rig.style.transform = `rotateY(${(-7 + x * 5).toFixed(3)}deg) rotateX(${(3 - y * 3.2).toFixed(3)}deg)`;
  }, []);
  usePointerField(zoneRef, onFrame, { global: true, ease: 0.07 });

  return (
    <div ref={zoneRef} className="studio relative">
      <div className="studio-persp">
        <div ref={rigRef} className="studio-rig">
          <Monitor />
          <div className="studio-phone">
            <LegendaPhone />
          </div>
        </div>
      </div>

      <p className="studio-cap mt-6 max-w-[62%] text-[12.5px] leading-relaxed text-white/[0.42]">
        Na tela: telejornal do FakePrint e Legendas Automáticas, os dois no Premium.
      </p>

      <style jsx>{`
        .studio-persp {
          perspective: 1700px;
          perspective-origin: 30% 40%;
          animation: studio-in 1.4s 0.2s cubic-bezier(0.16, 1, 0.3, 1) both;
        }
        @keyframes studio-in {
          from {
            opacity: 0;
            transform: perspective(1400px) translate3d(0, 46px, 0) rotateX(14deg) scale(0.96);
          }
          to {
            opacity: 1;
            transform: none;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .studio-persp {
            animation: none;
          }
        }
        .studio-rig {
          position: relative;
          transform-style: preserve-3d;
          transform: rotateY(-7deg) rotateX(3deg);
          will-change: transform;
        }
        .studio-phone {
          position: absolute;
          right: 13%;
          bottom: -19%;
          width: 25%;
          transform: translateZ(120px) rotateY(-6deg) rotateZ(2deg);
          transform-style: preserve-3d;
        }
        @media (min-width: 1024px) {
          .studio {
            margin-right: -9%;
          }
        }
        @media (max-width: 1023px) {
          .studio-rig {
            transform: none;
          }
          .studio-phone {
            right: 3%;
            bottom: -22%;
            width: 31%;
            transform: none;
          }
          .studio-cap {
            margin-top: 22%;
          }
        }
      `}</style>
    </div>
  );
}

/* ────────────── monitor do telejornal (FakePrint) ────────────── */

/** Tarja — só FakePrint: o monitor É um FakePrint. Curtas pra caber sem truncar. */
const CHYRON = [
  'VOCÊ ESCREVE A MANCHETE DO DIA',
  'SÓ O GRÁFICO FICA DE PÉ NO CHROMA',
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

/* ────────────── celular 9:16 com o motor de legenda ────────────── */

/** Os favoritos do Silas (21.08), um por volta do roteiro. */
const PHONE_PRESETS = ['vermelho-sangue', 'titulo-ouro', 'verde-dinheiro', 'glitch-viral', 'extensao-script', 'empilhado'];
const PHONE_BLOCKS = makeBlocks(['SUA FALA', 'VIRA LEGENDA', 'PALAVRA POR PALAVRA', 'NO TEMPO DO ÁUDIO'], { per: 1500 });

function LegendaPhone() {
  const { ref, inView } = useInView<HTMLDivElement>(0.1);
  const reduced = useReduced();
  const calm = useCalm();
  const vidRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [idx, setIdx] = useState(0);
  const progRef = useRef<LegendaProgram>({
    presetId: PHONE_PRESETS[0],
    blocks: PHONE_BLOCKS,
    fontScale: 1.5,
    posY: 0.7,
  });

  useLegendaCanvas(canvasRef, progRef, {
    playing: inView,
    stillAt: 160 + 1500 + 1200,
    fontIds: PHONE_PRESETS,
    onLoop: () => {
      setIdx((i) => {
        const n = (i + 1) % PHONE_PRESETS.length;
        progRef.current = { ...progRef.current, presetId: PHONE_PRESETS[n] };
        return n;
      });
    },
  });

  useEffect(() => {
    const v = vidRef.current;
    if (!v) return;
    if (inView && !reduced && !calm) {
      const p = v.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } else v.pause();
  }, [inView, reduced, calm]);

  return (
    <div ref={ref} className="phone relative">
      <div className="phone-body relative overflow-hidden" style={{ filter: 'saturate(1.39)' }}>
        <div className="phone-screen relative overflow-hidden">
          <video
            ref={vidRef}
            src="/landing/hero-phone.mp4"
            poster="/landing/hero-phone.jpg"
            muted
            loop
            playsInline
            preload="none"
            aria-hidden
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div aria-hidden className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.35), transparent 45%)' }} />
          <canvas ref={canvasRef} aria-hidden className="absolute inset-0 h-full w-full" />
          <span aria-hidden className="phone-island absolute left-1/2 top-[2.2%] h-[3.4%] w-[30%] -translate-x-1/2 rounded-full bg-black" />
        </div>
      </div>
      <div
        className="phone-tag absolute -bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full border border-white/15 bg-[#121216]/95 px-2.5 py-1 text-[10.5px] font-semibold text-white/85 shadow-[0_10px_24px_-10px_rgba(0,0,0,0.9)]"
        style={{ fontFamily: 'var(--font-label)' }}
      >
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: '#ffd60a' }} />
        {getPreset(PHONE_PRESETS[idx]).name}
      </div>

      <style jsx>{`
        .phone-body {
          padding: 5%;
          border-radius: 18% / 8.5%;
          background: linear-gradient(160deg, #2a2a30, #0d0d10 40%, #1a1a1f);
          box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.14), inset 0 1px 0 rgba(255, 255, 255, 0.16),
            0 40px 80px -30px rgba(0, 0, 0, 0.95), 0 0 60px -20px rgba(255, 214, 10, 0.18);
        }
        .phone-screen {
          aspect-ratio: 9 / 16;
          border-radius: 13% / 7.2%;
          background: #000;
        }
      `}</style>
    </div>
  );
}
