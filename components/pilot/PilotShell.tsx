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
 *  • HERÓI (design system "Pilot Control", v2): sem caixa, o título fica na
 *    fumaça como na landing; faixa de topo igual à barra da landing (online,
 *    data, relógio ao vivo), cantos de visor e o espelho (rundown) 01–04 do
 *    fluxo: copy, avatar e voz, HeyGen, montado.
 *  • LUZ DE BORDA: o painel debaixo do cursor acende a borda onde o mouse
 *    está. Um listener só, no palco; as variáveis vão no PRÓPRIO elemento da
 *    luz (folha da árvore), nunca no :root nem no painel (lição de 05.10:
 *    variável herdada por milhares de nós = recálculo a cada movimento).
 *
 * Os componentes daqui ficam no topo do módulo, puros (componente definido
 * dentro de outro remonta a cada render — ver o PainelDeMontagem de 03.09).
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
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

/** Relógio da faixa do herói: componente folha (só ele re-renderiza por
 *  segundo) e só depois de montar — o servidor não sabe a hora do usuário. */
function HeroClock() {
  const [agora, setAgora] = useState<Date | null>(null);
  useEffect(() => {
    setAgora(new Date());
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') setAgora(new Date());
    }, 1000);
    return () => window.clearInterval(id);
  }, []);
  if (!agora) return null;
  const dia = agora.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  const hora = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return (
    <>
      <span className="pl-hero__date">{dia}</span>
      <span className="pl-clock">{hora}</span>
    </>
  );
}

const RUNDOWN = ['Copy', 'Avatar e voz', 'HeyGen', 'Montado'];

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
  return (
    <header className="pl-hero pl-rise" style={{ ['--i' as string]: 0 }}>
      <div className="pl-hero__strip">
        <span className="pl-hero__on">
          <i className="pl-led" data-c="ok" aria-hidden />
          Online
        </span>
        {eyebrow ? (
          <>
            <span className="pl-hero__sep" aria-hidden />
            <span>{eyebrow}</span>
          </>
        ) : null}
        <span className="ml-auto inline-flex items-center gap-3">
          <HeroClock />
        </span>
      </div>
      <div className="pl-hero__main">
        <h1 className="pl-hero__title">{title}</h1>
        <div className="pl-hero__copy">
          {lead ? <p className="pl-hero__lead">{lead}</p> : null}
          {description ? <p className="pl-hero__desc">{description}</p> : null}
        </div>
        {icon ? (
          <div className="pl-hero__icon" aria-hidden>
            {icon}
          </div>
        ) : null}
      </div>
      <ol className="pl-rundown" aria-label="Como o Pilot trabalha">
        {RUNDOWN.map((r, i) => (
          <li key={r}>
            <span className="pl-rundown__n">{String(i + 1).padStart(2, '0')}</span>
            {r}
            {i === RUNDOWN.length - 1 ? <i className="pl-led" data-c="ok" aria-hidden /> : null}
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
