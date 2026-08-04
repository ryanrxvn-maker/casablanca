'use client';

/**
 * kit — primitivas da landing v3 ("A Redação").
 *
 * Direção nova: nada de aurora/glow difuso. Aqui o vocabulário é EDITORIAL —
 * fio de régua, chapéu numerado, ticker de plantão, serifada de manchete.
 * Tudo CSS + rAF/timers, zero dependência nova, tudo respeitando
 * `prefers-reduced-motion` (com motion reduzido o conteúdo fica no estado
 * final, legível e parado).
 *
 * SSR: o primeiro paint mostra o conteúdo COMPLETO (bom pra SEO e pra
 * crawler de IA que não roda JS). As animações só "armam" depois do mount.
 */

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ElementType,
  type ReactNode,
} from 'react';

/* ────────────────────────── motion guards ────────────────────────── */

export function reducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  );
}

/** `true` quando o usuário pediu menos movimento (só depois do mount). */
export function useReduced(): boolean {
  const [v, setV] = useState(false);
  useEffect(() => setV(reducedMotion()), []);
  return v;
}

/**
 * Avisa UMA vez quando o elemento aparece na tela.
 *
 * Blindagem: além do IntersectionObserver, mede o retângulo no mount, no
 * scroll e no resize. Em contexto onde o IO não dispara (aba em segundo plano,
 * automação, WebView antigo) o conteúdo NUNCA fica preso invisível.
 */
function watchVisible(el: HTMLElement, onVisible: () => void, margin = 0.94): () => void {
  let done = false;
  let raf = 0;

  const finish = () => {
    if (done) return;
    done = true;
    cleanup();
    onVisible();
  };
  const check = () => {
    const r = el.getBoundingClientRect();
    if (r.top < window.innerHeight * margin && r.bottom > 0) finish();
  };
  const onScroll = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(check);
  };

  const io =
    typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver(
          (entries) => {
            for (const e of entries) if (e.isIntersecting) finish();
          },
          { rootMargin: '0px 0px -6% 0px', threshold: 0.05 },
        )
      : null;
  io?.observe(el);

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  const t = setTimeout(check, 80);

  function cleanup() {
    io?.disconnect();
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onScroll);
    clearTimeout(t);
    cancelAnimationFrame(raf);
  }
  return cleanup;
}

/** `true` a partir do momento em que o elemento entra na tela (não volta atrás). */
export function useInView<T extends HTMLElement>(_threshold = 0.25) {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || inView) return;
    return watchVisible(el, () => setInView(true));
  }, [inView]);

  return { ref, inView };
}

/* ────────────────────────── Reveal ────────────────────────── */

type RevealProps = {
  children: ReactNode;
  className?: string;
  delay?: number;
  /** deslocamento inicial (px). Default 18. */
  y?: number;
  as?: ElementType;
  style?: CSSProperties;
};

/**
 * Entrada "de jornal": o bloco sobe com um wipe curto (clip-path), sem blur —
 * mais seco e editorial que o fade difuso da v2.
 */
export function Reveal({
  children,
  className = '',
  delay = 0,
  y = 18,
  as,
  style,
}: RevealProps) {
  const Tag = (as ?? 'div') as ElementType;
  const ref = useRef<HTMLElement | null>(null);
  const [armed, setArmed] = useState(false);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || shown) return;
    if (reducedMotion()) {
      setShown(true);
      return;
    }
    setArmed(true);
    return watchVisible(el, () => setShown(true));
  }, [shown]);

  const hidden = armed && !shown;

  return (
    <Tag
      ref={ref as never}
      className={className}
      style={{
        transition: `opacity 620ms cubic-bezier(.16,.84,.28,1) ${delay}ms, transform 720ms cubic-bezier(.16,.84,.28,1) ${delay}ms, clip-path 820ms cubic-bezier(.16,.84,.28,1) ${delay}ms`,
        opacity: hidden ? 0 : 1,
        transform: hidden ? `translate3d(0, ${y}px, 0)` : 'none',
        clipPath: hidden ? 'inset(0 0 14% 0)' : 'inset(0 0 0 0)',
        ...style,
      }}
    >
      {children}
    </Tag>
  );
}

/* ────────────────────────── Kicker (chapéu de seção) ────────────────────────── */

/**
 * Chapéu numerado — "02 │ A SUÍTE INTEIRA". A régua vermelha à esquerda é a
 * assinatura visual das seções desta landing.
 */
export function Kicker({
  index,
  label,
  tone = '#e0483f',
}: {
  index: string;
  label: string;
  tone?: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span
        aria-hidden
        className="block h-[15px] w-[3px] rounded-[1px]"
        style={{ background: tone, boxShadow: `0 0 14px -2px ${tone}` }}
      />
      <span
        className="num text-[11px] tracking-[0.28em] text-white/40"
        style={{ fontFamily: 'var(--font-mono)' }}
      >
        {index}
      </span>
      <span
        className="text-[10.5px] uppercase tracking-[0.26em] text-white/60"
        style={{ fontFamily: 'var(--font-label)', fontWeight: 600 }}
      >
        {label}
      </span>
    </div>
  );
}

/* ────────────────────────── Ticker (esteira de plantão) ────────────────────────── */

/**
 * Faixa de notícia: etiqueta fixa à esquerda + esteira infinita. Duplicamos o
 * grupo e transladamos -50% — sem JS, pausa no hover, para com reduced-motion.
 */
export function Ticker({
  tag,
  items,
  speed = 42,
  tone = '#e0483f',
  className = '',
}: {
  tag: string;
  items: string[];
  speed?: number;
  tone?: string;
  className?: string;
}) {
  const group = (
    <div className="tk-group flex shrink-0 items-center">
      {items.map((t, i) => (
        <span key={i} className="flex items-center">
          <span className="whitespace-nowrap px-5 text-[11.5px] uppercase tracking-[0.18em] text-white/55">
            {t}
          </span>
          <span
            aria-hidden
            className="h-[3px] w-[3px] shrink-0 rounded-full"
            style={{ background: tone }}
          />
        </span>
      ))}
    </div>
  );

  return (
    <div
      className={
        'tk relative flex items-stretch overflow-hidden border-y border-white/10 bg-black/40 ' +
        className
      }
      style={{ fontFamily: 'var(--font-label)', fontWeight: 600 }}
    >
      <span
        className="relative z-10 flex shrink-0 items-center px-4 text-[10.5px] font-bold uppercase tracking-[0.22em] text-white"
        style={{ background: tone }}
      >
        {tag}
      </span>
      <div className="tk-mask relative flex-1 overflow-hidden">
        <div className="tk-track flex w-max items-center" style={{ animationDuration: `${speed}s` }}>
          {group}
          {group}
        </div>
      </div>

      <style jsx>{`
        .tk-mask {
          -webkit-mask-image: linear-gradient(90deg, transparent, #000 3%, #000 94%, transparent);
          mask-image: linear-gradient(90deg, transparent, #000 3%, #000 94%, transparent);
        }
        .tk-track {
          animation-name: tk-scroll;
          animation-timing-function: linear;
          animation-iteration-count: infinite;
        }
        .tk:hover .tk-track {
          animation-play-state: paused;
        }
        @keyframes tk-scroll {
          from {
            transform: translate3d(0, 0, 0);
          }
          to {
            transform: translate3d(-50%, 0, 0);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .tk-track {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}

/* ────────────────────────── texto que digita (chyron) ────────────────────────── */

/**
 * Máquina de escrever pro gerador de caracteres: digita, segura, apaga e passa
 * pra próxima. Com reduced-motion devolve a primeira linha, parada.
 */
export function useTypewriter(
  lines: string[],
  { type = 38, erase = 18, hold = 2600, active = true } = {},
): { text: string; index: number; typing: boolean } {
  const [text, setText] = useState(lines[0] ?? '');
  const [index, setIndex] = useState(0);
  const [typing, setTyping] = useState(false);

  useEffect(() => {
    if (!active || reducedMotion() || lines.length === 0) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let i = 0;
    let n = lines[0]?.length ?? 0;
    let dir: 1 | -1 = -1; // começa apagando a linha que veio do SSR

    const tick = () => {
      if (cancelled) return;
      const line = lines[i] ?? '';

      if (dir === -1) {
        n -= 1;
        if (n <= 0) {
          n = 0;
          dir = 1;
          i = (i + 1) % lines.length;
          setIndex(i);
        }
      } else {
        n += 1;
        if (n >= line.length) {
          n = line.length;
          dir = -1;
        }
      }

      const next = (lines[i] ?? '').slice(0, n);
      setText(next);
      setTyping(dir === 1);

      const atEnd = dir === -1 && n === (lines[i] ?? '').length;
      timer = setTimeout(tick, atEnd ? hold : dir === 1 ? type : erase);
    };

    timer = setTimeout(tick, hold);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, lines.join('|'), type, erase, hold]);

  return { text, index, typing };
}

/** Índice que roda de 0..len-1 a cada `ms`. Parado com reduced-motion. */
export function useCycle(len: number, ms: number, active = true): number {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!active || len <= 1 || reducedMotion()) return;
    const id = setInterval(() => setI((v) => (v + 1) % len), ms);
    return () => clearInterval(id);
  }, [len, ms, active]);
  return i;
}

/* ────────────────────────── relógio / data ────────────────────────── */

/**
 * Relógio ao vivo (HH:MM:SS). Renderiza placeholder no servidor pra não dar
 * mismatch de hidratação — a hora só entra depois do mount.
 */
export function useClock(): string {
  const [t, setT] = useState('--:--:--');
  useEffect(() => {
    const fmt = () =>
      new Date().toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    setT(fmt());
    const id = setInterval(() => setT(fmt()), 1000);
    return () => clearInterval(id);
  }, []);
  return t;
}

/** Data por extenso ("segunda-feira, 4 de agosto de 2026"), só no cliente. */
export function useToday(): string {
  const [d, setD] = useState('');
  useEffect(() => {
    setD(
      new Date().toLocaleDateString('pt-BR', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }),
    );
  }, []);
  return d;
}

/* ────────────────────────── waveform determinística ────────────────────────── */

/**
 * Alturas de onda estáveis (mesmo valor no servidor e no cliente) — nada de
 * Math.random, que quebraria a hidratação.
 */
export function waveBars(count: number, seed = 7): number[] {
  const out: number[] = [];
  let s = seed * 9301 + 49297;
  for (let i = 0; i < count; i += 1) {
    s = (s * 9301 + 49297) % 233280;
    const r = s / 233280;
    const env = 0.42 + 0.58 * Math.abs(Math.sin(i / 5.5 + seed));
    out.push(Math.max(0.12, Math.min(1, env * (0.55 + r * 0.75))));
  }
  return out;
}
