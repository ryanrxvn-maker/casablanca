'use client';

/**
 * LandingKit — primitivas de movimento da landing v2 do Auto Edit.
 *
 * Tudo é 100% CSS + requestAnimationFrame (zero dependência nova, zero WebGL).
 * Todo efeito respeita `prefers-reduced-motion`: quando ativo, os componentes
 * degradam pra estado estático (conteúdo sempre visível e legível).
 *
 *  Reveal    — revela ao entrar no viewport (IntersectionObserver).
 *  Parallax  — escreve --px/--py (-1..1) seguindo o ponteiro; filhos leem via calc().
 *  Magnetic  — botão/elemento que "puxa" levemente pro cursor.
 *  Marquee   — esteira infinita horizontal.
 *  CountUp    — número que sobe quando entra na tela.
 *
 * SSR: no primeiro paint tudo é VISÍVEL (sem JS o conteúdo aparece normal — bom
 * pra SEO/crawlers de IA). Os efeitos "armam" só depois do mount no cliente.
 */

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ElementType,
  type ReactNode,
} from 'react';

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  );
}

/* ────────────────────────── Reveal ────────────────────────── */

type RevealProps = {
  children: ReactNode;
  className?: string;
  /** deslocamento inicial no eixo Y (px). Default 22. */
  y?: number;
  /** atraso da transição (ms). Default 0. */
  delay?: number;
  /** duração (ms). Default 720. */
  duration?: number;
  /** blur inicial (px) — dá aquele "assentar" premium. Default 6. */
  blur?: number;
  as?: ElementType;
  style?: CSSProperties;
};

/**
 * Revela o filho quando ele entra no viewport. Antes de "armar" (mount) o
 * conteúdo fica visível — então crawlers sem JS leem tudo.
 */
export function Reveal({
  children,
  className = '',
  y = 22,
  delay = 0,
  duration = 720,
  blur = 6,
  as,
  style,
}: RevealProps) {
  const Tag = (as ?? 'div') as ElementType;
  const ref = useRef<HTMLElement | null>(null);
  const [armed, setArmed] = useState(false);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prefersReducedMotion()) {
      setInView(true);
      return;
    }
    setArmed(true);
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setInView(true);
            io.disconnect();
            break;
          }
        }
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.08 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const hidden = armed && !inView;
  const revealStyle: CSSProperties = {
    transition: `opacity ${duration}ms cubic-bezier(.2,.8,.2,1) ${delay}ms, transform ${duration}ms cubic-bezier(.2,.8,.2,1) ${delay}ms, filter ${duration}ms cubic-bezier(.2,.8,.2,1) ${delay}ms`,
    opacity: hidden ? 0 : 1,
    transform: hidden ? `translate3d(0, ${y}px, 0)` : 'translate3d(0,0,0)',
    filter: hidden ? `blur(${blur}px)` : 'blur(0px)',
    willChange: 'opacity, transform, filter',
    ...style,
  };

  return (
    <Tag ref={ref as never} className={className} style={revealStyle}>
      {children}
    </Tag>
  );
}

/* ────────────────────────── Parallax ────────────────────────── */

type ParallaxProps = {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** força do easing (0..1). Menor = mais suave/preguiçoso. Default 0.12. */
  ease?: number;
};

/**
 * Container que segue o ponteiro e publica --px/--py (-1..1) nas próprias CSS
 * vars, com easing por rAF. Filhos criam profundidade lendo essas vars, ex.:
 *   transform: translate3d(calc(var(--px) * 20px), calc(var(--py) * 14px), 0)
 * Em touch/reduced-motion as vars ficam em 0 (cena estática).
 */
export function Parallax({ children, className = '', style, ease = 0.12 }: ParallaxProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const target = useRef({ x: 0, y: 0 });
  const cur = useRef({ x: 0, y: 0 });
  const raf = useRef<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion()) return;

    const loop = () => {
      cur.current.x += (target.current.x - cur.current.x) * ease;
      cur.current.y += (target.current.y - cur.current.y) * ease;
      el.style.setProperty('--px', cur.current.x.toFixed(4));
      el.style.setProperty('--py', cur.current.y.toFixed(4));
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);

    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
      const y = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
      target.current.x = Math.max(-1, Math.min(1, x));
      target.current.y = Math.max(-1, Math.min(1, y));
    };
    const onLeave = () => {
      target.current.x = 0;
      target.current.y = 0;
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    el.addEventListener('pointerleave', onLeave);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      window.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
    };
  }, [ease]);

  return (
    <div
      ref={ref}
      className={className}
      style={{ ['--px' as string]: 0, ['--py' as string]: 0, ...style }}
    >
      {children}
    </div>
  );
}

/* ────────────────────────── Magnetic ────────────────────────── */

type MagneticProps = {
  children: ReactNode;
  className?: string;
  /** deslocamento máximo (px). Default 10. */
  strength?: number;
  style?: CSSProperties;
};

/** Envolve um elemento e o "puxa" levemente na direção do cursor no hover. */
export function Magnetic({ children, className = '', strength = 10, style }: MagneticProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el || prefersReducedMotion()) return;
    const r = el.getBoundingClientRect();
    const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
    const dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    el.style.transform = `translate(${(dx * strength).toFixed(1)}px, ${(dy * strength).toFixed(1)}px)`;
  };
  const onLeave = () => {
    const el = ref.current;
    if (el) el.style.transform = 'translate(0,0)';
  };

  return (
    <div
      ref={ref}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      className={className}
      style={{ transition: 'transform 0.35s cubic-bezier(.2,.8,.2,1)', willChange: 'transform', ...style }}
    >
      {children}
    </div>
  );
}

/* ────────────────────────── Marquee ────────────────────────── */

type MarqueeProps = {
  children: ReactNode;
  /** segundos por volta. Default 26. */
  speed?: number;
  reverse?: boolean;
  className?: string;
};

/** Esteira infinita — duplica o conteúdo e translada -50% em loop. */
export function Marquee({ children, speed = 26, reverse = false, className = '' }: MarqueeProps) {
  return (
    <div className={'lk-marquee ' + className} aria-hidden>
      <div
        className="lk-marquee-track"
        style={{ animationDuration: `${speed}s`, animationDirection: reverse ? 'reverse' : 'normal' }}
      >
        <div className="lk-marquee-group">{children}</div>
        <div className="lk-marquee-group">{children}</div>
      </div>
      <style jsx>{`
        .lk-marquee {
          position: relative;
          overflow: hidden;
          -webkit-mask-image: linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent);
          mask-image: linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent);
        }
        .lk-marquee-track {
          display: flex;
          width: max-content;
          animation-name: lk-marquee-scroll;
          animation-timing-function: linear;
          animation-iteration-count: infinite;
        }
        .lk-marquee:hover .lk-marquee-track {
          animation-play-state: paused;
        }
        .lk-marquee-group {
          display: flex;
          align-items: center;
        }
        @keyframes lk-marquee-scroll {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
        @media (prefers-reduced-motion: reduce) {
          .lk-marquee-track { animation: none; }
        }
      `}</style>
    </div>
  );
}

/* ────────────────────────── CountUp ────────────────────────── */

type CountUpProps = {
  to: number;
  /** casas decimais. Default 0. */
  decimals?: number;
  suffix?: string;
  prefix?: string;
  /** duração (ms). Default 1400. */
  duration?: number;
  className?: string;
  style?: CSSProperties;
};

/** Número que sobe de 0 até `to` quando entra no viewport (uma vez). */
export function CountUp({
  to,
  decimals = 0,
  suffix = '',
  prefix = '',
  duration = 1400,
  className = '',
  style,
}: CountUpProps) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [val, setVal] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prefersReducedMotion()) {
      setVal(to);
      return;
    }
    let raf = 0;
    let start = 0;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        io.disconnect();
        const step = (t: number) => {
          if (!start) start = t;
          const p = Math.min(1, (t - start) / duration);
          const eased = 1 - Math.pow(1 - p, 3);
          setVal(to * eased);
          if (p < 1) raf = requestAnimationFrame(step);
          else setVal(to);
        };
        raf = requestAnimationFrame(step);
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [to, duration]);

  const formatted = val.toLocaleString('pt-BR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  return (
    <span ref={ref} className={className} style={style}>
      {prefix}
      {formatted}
      {suffix}
    </span>
  );
}
