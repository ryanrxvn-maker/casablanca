'use client';

/**
 * PilotShell — a casca do Pilot (08.10): atmosfera + herói + palco.
 *
 * Troca SÓ a pele do ToolShell que o Pilot usava: mesmo título, mesmo texto,
 * mesmo ícone, o conteúdo continua exatamente na mesma ordem. O que muda:
 *
 *  • ATMOSFERA: a fumaça WebGL da landing (PilotSmoke) fixa atrás de tudo,
 *    começando abaixo da barra do topo e ao lado do menu — nenhum blur de
 *    vidro fica por cima dela (blur sobre canvas animado = GPU refazendo o
 *    desfoque a cada quadro).
 *  • HERÓI: título editorial, a frase de abertura em serifada, selo do ícone
 *    em bisel duplo que inclina na direção do mouse e a régua do fluxo
 *    (copy, avatar e voz, HeyGen, montado).
 *  • LUZ DE BORDA: o painel debaixo do cursor acende a borda onde o mouse
 *    está. Um listener só, no palco; as variáveis vão no PRÓPRIO elemento da
 *    luz (folha da árvore), nunca no :root nem no painel (lição de 05.10:
 *    variável herdada por milhares de nós = recálculo a cada movimento).
 *
 * Os componentes daqui ficam no topo do módulo, puros (componente definido
 * dentro de outro remonta a cada render — ver o PainelDeMontagem de 03.09).
 */

import { useEffect, useRef, type ReactNode } from 'react';
import { PilotSmoke } from './PilotSmoke';

/** Luz de borda de um painel. O painel precisa de `data-pl-spot` e
 *  `position: relative`; a luz herda o raio dele. */
export function PlSpot() {
  return (
    <span className="pl-spot" aria-hidden>
      <i className="pl-spot__glow" />
      <i className="pl-spot__ring" />
    </span>
  );
}

function prefersPointerFx(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}

/** Um listener só pro palco inteiro: acha o painel sob o mouse e move a luz
 *  dele. rAF segura no máximo um ajuste por quadro. */
function useSpotlight(rootRef: React.RefObject<HTMLElement>) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !prefersPointerFx()) return;
    let current: HTMLElement | null = null;
    let raf = 0;
    let lastX = 0;
    let lastY = 0;
    let lastTarget: Element | null = null;

    const spotOf = (host: HTMLElement | null) =>
      host ? (host.querySelector(':scope > .pl-spot') as HTMLElement | null) : null;

    const apply = () => {
      raf = 0;
      const host = (lastTarget?.closest?.('[data-pl-spot]') as HTMLElement | null) || null;
      if (host !== current) {
        const old = spotOf(current);
        if (old) old.removeAttribute('data-on');
        current = host;
      }
      const spot = spotOf(current);
      if (!current || !spot) return;
      const r = current.getBoundingClientRect();
      spot.style.setProperty('--x', `${lastX - r.left}px`);
      spot.style.setProperty('--y', `${lastY - r.top}px`);
      spot.setAttribute('data-on', '1');
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      lastX = e.clientX;
      lastY = e.clientY;
      lastTarget = e.target as Element | null;
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const onLeave = () => {
      const old = spotOf(current);
      if (old) old.removeAttribute('data-on');
      current = null;
    };
    root.addEventListener('pointermove', onMove, { passive: true });
    root.addEventListener('pointerleave', onLeave);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      root.removeEventListener('pointermove', onMove);
      root.removeEventListener('pointerleave', onLeave);
    };
  }, [rootRef]);
}

/** O selo do ícone inclina na direção do mouse (transform direto, sem state). */
function useBadgeTilt(heroRef: React.RefObject<HTMLElement>, badgeRef: React.RefObject<HTMLElement>) {
  useEffect(() => {
    const hero = heroRef.current;
    const badge = badgeRef.current;
    if (!hero || !badge || !prefersPointerFx()) return;
    let raf = 0;
    let tx = 0, ty = 0, cx = 0, cy = 0;
    const step = () => {
      cx += (tx - cx) * 0.14;
      cy += (ty - cy) * 0.14;
      badge.style.transform = `perspective(700px) rotateX(${cy.toFixed(2)}deg) rotateY(${cx.toFixed(2)}deg)`;
      raf = Math.abs(tx - cx) > 0.02 || Math.abs(ty - cy) > 0.02 ? requestAnimationFrame(step) : 0;
    };
    const kick = () => {
      if (!raf) raf = requestAnimationFrame(step);
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const r = badge.getBoundingClientRect();
      const dx = (e.clientX - (r.left + r.width / 2)) / Math.max(320, r.width * 4);
      const dy = (e.clientY - (r.top + r.height / 2)) / Math.max(220, r.height * 3);
      tx = Math.max(-1, Math.min(1, dx)) * 14;
      ty = Math.max(-1, Math.min(1, dy)) * -12;
      kick();
    };
    const onLeave = () => {
      tx = 0;
      ty = 0;
      kick();
    };
    hero.addEventListener('pointermove', onMove, { passive: true });
    hero.addEventListener('pointerleave', onLeave);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      hero.removeEventListener('pointermove', onMove);
      hero.removeEventListener('pointerleave', onLeave);
    };
  }, [heroRef, badgeRef]);
}

const FLUXO: Array<{ rotulo: string; icone: ReactNode }> = [
  {
    rotulo: 'Copy',
    icone: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
        <path d="M14 3v5h5M9 13h6M9 17h4" />
      </svg>
    ),
  },
  {
    rotulo: 'Avatar e voz',
    icone: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <circle cx="12" cy="8" r="4" />
        <path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" />
      </svg>
    ),
  },
  {
    rotulo: 'HeyGen',
    icone: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H12z" />
      </svg>
    ),
  },
  {
    rotulo: 'Montado',
    icone: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect x="3" y="5" width="18" height="14" rx="3" />
        <path d="m10.5 9.5 4 2.5-4 2.5z" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
];

function PilotHero({
  title,
  eyebrow,
  lead,
  description,
  icon,
}: {
  title: string;
  eyebrow?: string;
  lead?: string;
  description?: string;
  icon?: ReactNode;
}) {
  const heroRef = useRef<HTMLElement | null>(null);
  const badgeRef = useRef<HTMLDivElement | null>(null);
  useBadgeTilt(heroRef, badgeRef);
  return (
    <header ref={heroRef} className="pl-hero pl-rise" data-pl-spot style={{ ['--i' as string]: 0 }}>
      <PlSpot />
      <span className="pl-hero__light" aria-hidden />
      <div className="pl-hero__in">
        <div className="pl-hero__copy">
          {eyebrow ? (
            <span className="pl-hero__eyebrow">
              <i className="pl-livedot" aria-hidden />
              {eyebrow}
            </span>
          ) : null}
          <h1 className="pl-hero__title">{title}</h1>
          {lead ? <p className="pl-hero__lead">{lead}</p> : null}
          {description ? <p className="pl-hero__desc">{description}</p> : null}
        </div>
        {icon ? (
          <div className="pl-hero__badge-wrap" aria-hidden>
            <span className="pl-hero__halo" />
            <div ref={badgeRef} className="pl-hero__badge">
              <span className="pl-hero__badge-core">{icon}</span>
            </div>
          </div>
        ) : null}
      </div>
      <ol className="pl-flow" aria-label="Como o Pilot trabalha">
        {FLUXO.map((f, i) => (
          <li key={f.rotulo} className="pl-flow__step" style={{ ['--i' as string]: i }}>
            <span className="pl-flow__ico">{f.icone}</span>
            <span className="pl-flow__txt">{f.rotulo}</span>
            {i < FLUXO.length - 1 ? (
              <span className="pl-flow__link" aria-hidden>
                <i className="ae-ambient" />
              </span>
            ) : null}
          </li>
        ))}
      </ol>
    </header>
  );
}

export function PilotShell({
  title,
  eyebrow,
  lead,
  description,
  icon,
  children,
}: {
  title: string;
  eyebrow?: string;
  /** Frase de abertura (serifada, logo abaixo do título). */
  lead?: string;
  description?: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  useSpotlight(stageRef);
  return (
    <div className="pilot-skin">
      <div className="pl-atmos" aria-hidden>
        <PilotSmoke className="pl-atmos__smoke" />
      </div>
      <div ref={stageRef} className="pl-stage mx-auto w-full max-w-[1080px] px-5 md:px-8">
        <PilotHero title={title} eyebrow={eyebrow} lead={lead} description={description} icon={icon} />
        <div className="pl-body">{children}</div>
      </div>
    </div>
  );
}
