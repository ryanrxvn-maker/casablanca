'use client';

/**
 * Kit visual do painel admin. Uma escala de raio só (22 casca / 17 núcleo /
 * 12 interno / pílula), contorno por hairline (inset 1px) em vez de borda
 * cinza, sombra difusa, curva de mola. Rótulo em SENTENÇA (.field-label),
 * nada de caixa alta espaçada. Texto secundário nunca abaixo de text-muted
 * (o text-dim dá contraste 2,3 no escuro: ilegível).
 *
 * Cor só por token (accent()), então o modo claro funciona sozinho.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { accent, type Accent } from './model';

export const SPRING = 'cubic-bezier(.32,.72,0,1)';

/* ───────────── Casca dupla (bisel) ───────────── */

export function Shell({
  children,
  className = '',
  coreClassName = '',
  tone,
}: {
  children: React.ReactNode;
  className?: string;
  coreClassName?: string;
  tone?: Accent;
}) {
  return (
    <div
      className={'rounded-[22px] p-[5px] ' + className}
      style={{
        background: tone ? accent(tone, 0.05) : 'rgb(var(--text) / 0.025)',
        boxShadow: `inset 0 0 0 1px ${tone ? accent(tone, 0.16) : 'rgb(var(--text) / 0.06)'}, 0 28px 56px -40px rgb(0 0 0 / 0.55)`,
      }}
    >
      <div
        className={'h-full rounded-[17px] bg-bg-soft ' + coreClassName}
        style={{ boxShadow: 'inset 0 1px 0 rgb(var(--text) / 0.045), inset 0 0 0 1px rgb(var(--text) / 0.05)' }}
      >
        {children}
      </div>
    </div>
  );
}

export function Panel({
  title,
  hint,
  right,
  children,
  className = '',
  tone,
  pad = 'p-5',
}: {
  title: React.ReactNode;
  hint?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  tone?: Accent;
  pad?: string;
}) {
  return (
    <Shell className={className} tone={tone}>
      <section className={pad}>
        <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-tech text-[15.5px] font-semibold tracking-[-0.01em] text-text">{title}</h2>
            {hint ? <p className="field-label mt-0.5 text-[12.5px] text-text-muted">{hint}</p> : null}
          </div>
          {right}
        </header>
        {children}
      </section>
    </Shell>
  );
}

/* ───────────── Marcadores ───────────── */

export function Dot({ a, ring, size = 7 }: { a: Accent; ring?: boolean; size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-block shrink-0 rounded-full"
      style={{
        width: size,
        height: size,
        background: accent(a),
        boxShadow: ring ? `0 0 0 3px ${accent(a, 0.2)}` : undefined,
      }}
    />
  );
}

/** Selo de estado: quadrado suave, sentença, cor só no texto e no fundo leve. */
export function Tag({
  a,
  children,
  title,
  dot,
  onClick,
}: {
  a: Accent;
  children: React.ReactNode;
  title?: string;
  dot?: boolean;
  onClick?: () => void;
}) {
  const Comp = onClick ? 'button' : 'span';
  return (
    <Comp
      onClick={onClick}
      title={title}
      className={
        'field-label inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[7px] px-2 py-[3px] text-[11.5px] font-semibold leading-none ' +
        (onClick ? 'transition-opacity hover:opacity-80' : '')
      }
      style={{
        color: a === 'neutral' ? 'rgb(var(--text-muted))' : accent(a),
        background: a === 'neutral' ? 'rgb(var(--text) / 0.06)' : accent(a, 0.1),
        boxShadow: `inset 0 0 0 1px ${a === 'neutral' ? 'rgb(var(--text) / 0.08)' : accent(a, 0.22)}`,
      }}
    >
      {dot ? <Dot a={a} size={6} /> : null}
      {children}
    </Comp>
  );
}

/* ───────────── Botões ───────────── */

type BtnTone = 'ghost' | Accent;

export function Btn({
  tone = 'ghost',
  onClick,
  disabled,
  title,
  children,
  className = '',
  size = 'md',
  solid,
  type = 'button',
  href,
}: {
  tone?: BtnTone;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  children: React.ReactNode;
  className?: string;
  size?: 'sm' | 'md';
  solid?: boolean;
  type?: 'button' | 'submit';
  href?: string;
}) {
  const ghost = tone === 'ghost' || tone === 'neutral';
  const cls =
    'field-label inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full font-semibold transition-[transform,background-color,opacity,box-shadow] duration-300 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40 ' +
    (size === 'sm' ? 'h-8 px-3 text-[12.5px] ' : 'h-9 px-4 text-[13px] ') +
    (ghost ? 'text-text hover:bg-[rgb(var(--text)/0.07)] ' : 'hover:brightness-110 ') +
    className;
  const style: React.CSSProperties = ghost
    ? { boxShadow: 'inset 0 0 0 1px rgb(var(--text) / 0.1)', transitionTimingFunction: SPRING }
    : {
        color: accent(tone as Accent),
        background: accent(tone as Accent, solid ? 0.18 : 0.1),
        boxShadow: `inset 0 0 0 1px ${accent(tone as Accent, 0.3)}`,
        transitionTimingFunction: SPRING,
      };
  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" title={title} className={cls} style={style}>
        {children}
      </a>
    );
  }
  return (
    <button type={type} onClick={onClick} disabled={disabled} title={title} className={cls} style={style}>
      {children}
    </button>
  );
}

/** Botão com o ícone no próprio círculo, encostado na borda interna. */
export function NestedBtn({
  onClick,
  children,
  icon,
  title,
  disabled,
}: {
  onClick: () => void;
  children: React.ReactNode;
  icon: React.ReactNode;
  title?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      className="group field-label inline-flex h-9 shrink-0 items-center gap-2 rounded-full bg-[rgb(var(--text)/0.06)] pl-4 pr-1 text-[13px] font-semibold text-text transition-[transform,background-color] duration-300 hover:bg-[rgb(var(--text)/0.1)] active:scale-[0.97] disabled:opacity-40"
      style={{ boxShadow: 'inset 0 0 0 1px rgb(var(--text) / 0.1)', transitionTimingFunction: SPRING }}
    >
      {children}
      <span
        className="flex h-7 w-7 items-center justify-center rounded-full bg-[rgb(var(--text)/0.1)] transition-transform duration-300 group-hover:-translate-y-[1px] group-hover:translate-x-[1px]"
        style={{ transitionTimingFunction: SPRING }}
      >
        {icon}
      </span>
    </button>
  );
}

export function IconOnly({
  onClick,
  title,
  children,
  disabled,
  tone,
  btnRef,
}: {
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  title: string;
  children: React.ReactNode;
  disabled?: boolean;
  tone?: Accent;
  btnRef?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={btnRef}
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      disabled={disabled}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-text-muted transition-[transform,background-color,color] duration-300 hover:bg-[rgb(var(--text)/0.07)] hover:text-text active:scale-[0.94] disabled:opacity-40"
      style={{
        boxShadow: `inset 0 0 0 1px ${tone ? accent(tone, 0.3) : 'rgb(var(--text) / 0.1)'}`,
        color: tone ? accent(tone) : undefined,
        transitionTimingFunction: SPRING,
      }}
    >
      {children}
    </button>
  );
}

/** Seletor segmentado (Free | Premium, períodos, abas). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  disabled,
  size = 'md',
  activeTone,
}: {
  value: T;
  options: Array<{ value: T; label: React.ReactNode; title?: string; tone?: Accent; disabled?: boolean }>;
  onChange: (v: T) => void;
  disabled?: boolean;
  size?: 'sm' | 'md';
  activeTone?: Accent;
}) {
  return (
    <div
      className="inline-flex shrink-0 items-center gap-0.5 rounded-full p-[3px]"
      style={{ background: 'rgb(var(--text) / 0.04)', boxShadow: 'inset 0 0 0 1px rgb(var(--text) / 0.08)' }}
      role="tablist"
    >
      {options.map((o) => {
        const on = o.value === value;
        const tone = o.tone ?? activeTone;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={on}
            title={o.title}
            disabled={disabled || o.disabled}
            onClick={() => !on && onChange(o.value)}
            className={
              'field-label whitespace-nowrap rounded-full font-semibold transition-[background-color,color,box-shadow] duration-300 disabled:cursor-default ' +
              (size === 'sm' ? 'h-7 px-3 text-[12px] ' : 'h-8 px-3.5 text-[12.5px] ') +
              (on ? '' : 'text-text-muted hover:text-text')
            }
            style={
              on
                ? {
                    color: tone && tone !== 'neutral' ? accent(tone) : 'rgb(var(--text))',
                    background: tone && tone !== 'neutral' ? accent(tone, 0.14) : 'rgb(var(--text) / 0.1)',
                    boxShadow: `inset 0 0 0 1px ${tone && tone !== 'neutral' ? accent(tone, 0.28) : 'rgb(var(--text) / 0.12)'}`,
                    transitionTimingFunction: SPRING,
                  }
                : { transitionTimingFunction: SPRING }
            }
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ───────────── Avatar ───────────── */

export function Avatar({
  text,
  a,
  online,
  size = 40,
}: {
  text: string;
  a: Accent;
  online?: boolean;
  size?: number;
}) {
  return (
    <span
      className="font-tech relative flex shrink-0 items-center justify-center rounded-[12px] font-semibold"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.36),
        color: a === 'neutral' ? 'rgb(var(--text))' : accent(a),
        background: a === 'neutral' ? 'rgb(var(--text) / 0.07)' : accent(a, 0.12),
        boxShadow: `inset 0 0 0 1px ${a === 'neutral' ? 'rgb(var(--text) / 0.1)' : accent(a, 0.25)}`,
      }}
    >
      {text}
      {online ? (
        <span
          className="absolute -bottom-[3px] -right-[3px] h-3 w-3 rounded-full"
          style={{ background: accent('lime'), boxShadow: '0 0 0 2.5px rgb(var(--bg-soft))' }}
          title="Online agora"
        />
      ) : null}
    </span>
  );
}

/* ───────────── Número de destaque ───────────── */

export function Stat({
  label,
  value,
  hint,
  a,
  onClick,
  live,
  alert,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  a?: Accent;
  onClick?: () => void;
  live?: boolean;
  alert?: boolean;
}) {
  const Comp = onClick ? 'button' : 'div';
  return (
    <Shell tone={alert ? 'danger' : undefined} className="h-full">
      <Comp
        onClick={onClick}
        className={
          'flex h-full w-full flex-col justify-between gap-3 rounded-[17px] p-4 text-left transition-colors duration-300 ' +
          (onClick ? 'cursor-pointer hover:bg-[rgb(var(--text)/0.03)]' : '')
        }
      >
        <span className="field-label flex items-center gap-2 text-[12.5px] text-text-muted">
          {a ? <Dot a={a} ring={live} /> : null}
          {label}
        </span>
        <span>
          <span
            className="font-tech block text-[28px] font-semibold leading-none tracking-[-0.03em] text-text"
            style={{ fontVariantNumeric: 'tabular-nums', color: alert ? accent('danger') : undefined }}
          >
            {value}
          </span>
          {hint ? <span className="field-label mt-1.5 block text-[12px] text-text-muted">{hint}</span> : null}
        </span>
      </Comp>
    </Shell>
  );
}

/* ───────────── Esqueleto ───────────── */

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={'rounded-[12px] bg-[rgb(var(--text)/0.05)] ' + className} />;
}

/* ───────────── Menu (portal: as linhas usam content-visibility e cortariam) ───────────── */

export function Menu({
  anchor,
  onClose,
  children,
  width = 240,
}: {
  anchor: HTMLElement;
  onClose: () => void;
  children: React.ReactNode;
  width?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const h = ref.current?.offsetHeight ?? 0;
    const below = r.bottom + 6 + h <= window.innerHeight - 8;
    setPos({
      top: below ? r.bottom + 6 : Math.max(8, r.top - 6 - h),
      left: Math.min(Math.max(8, r.right - width), window.innerWidth - width - 8),
    });
  }, [anchor, width]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node) || anchor.contains(e.target as Node)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const onMove = () => onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div
      ref={ref}
      role="menu"
      className="dropdown-pop fixed z-[70] rounded-[16px] bg-bg-elev p-1.5"
      style={{
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        width,
        boxShadow: 'inset 0 0 0 1px rgb(var(--text) / 0.1), 0 24px 48px -16px rgb(0 0 0 / 0.6)',
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

export function MenuItem({
  onClick,
  icon,
  children,
  tone,
  disabled,
  href,
  hint,
}: {
  onClick?: () => void;
  icon?: React.ReactNode;
  children: React.ReactNode;
  tone?: Accent;
  disabled?: boolean;
  href?: string;
  hint?: string;
}) {
  const cls =
    'field-label flex w-full items-center gap-2.5 rounded-[11px] px-3 py-2 text-left text-[13px] font-medium transition-colors duration-200 hover:bg-[rgb(var(--text)/0.07)] disabled:opacity-40';
  const style = { color: tone ? accent(tone) : 'rgb(var(--text))' };
  const inner = (
    <>
      <span className="flex w-4 shrink-0 justify-center opacity-80">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate">{children}</span>
        {hint ? <span className="block truncate text-[11.5px] font-normal text-text-muted">{hint}</span> : null}
      </span>
    </>
  );
  if (href) {
    return (
      <a role="menuitem" href={href} target="_blank" rel="noopener noreferrer" className={cls} style={style}>
        {inner}
      </a>
    );
  }
  return (
    <button role="menuitem" type="button" onClick={onClick} disabled={disabled} className={cls} style={style}>
      {inner}
    </button>
  );
}

export function MenuSep() {
  return <div className="mx-2 my-1 h-px bg-[rgb(var(--text)/0.08)]" />;
}

/* ───────────── Janela de confirmação ───────────── */

export function Modal({
  onClose,
  tone,
  wide,
  children,
}: {
  onClose: () => void;
  tone: Accent;
  wide?: boolean;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div className={'dropdown-pop w-full ' + (wide ? 'max-w-[540px]' : 'max-w-[440px]')} onClick={(e) => e.stopPropagation()}>
        <Shell tone={tone}>
          <div className="p-6">{children}</div>
        </Shell>
      </div>
    </div>,
    document.body,
  );
}

/* ───────────── Copiar ───────────── */

export function CopyBtn({ value, label = 'Copiar' }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(value).then(
          () => {
            setDone(true);
            setTimeout(() => setDone(false), 1400);
          },
          () => {},
        );
      }}
      title={label}
      aria-label={label}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-text-muted transition-colors duration-200 hover:bg-[rgb(var(--text)/0.08)] hover:text-text"
    >
      {done ? <I.check size={13} /> : <I.copy size={13} />}
    </button>
  );
}

/* ───────────── Ícones (traço fino, herdam a cor) ───────────── */

function svg(path: React.ReactNode, defaultSize = 15) {
  return function Icon({ size = defaultSize }: { size?: number }) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {path}
      </svg>
    );
  };
}

export const I = {
  search: svg(<><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4-4" /></>),
  arrow: svg(<path d="M7 17 17 7M9 7h8v8" />, 13),
  dots: svg(<><circle cx="5" cy="12" r="1.1" fill="currentColor" /><circle cx="12" cy="12" r="1.1" fill="currentColor" /><circle cx="19" cy="12" r="1.1" fill="currentColor" /></>),
  close: svg(<path d="M6 6l12 12M18 6 6 18" />),
  copy: svg(<><rect x="8.5" y="8.5" width="11" height="11" rx="2.5" /><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" /></>),
  check: svg(<path d="m5 12.5 4.5 4.5L19 7.5" />),
  receipt: svg(<><path d="M6 3.5h12v17l-2.4-1.4-2.4 1.4-2.2-1.4-2.4 1.4L6 20.5v-17Z" /><path d="M9 8.5h6M9 12h6M9 15.5h3.5" /></>),
  bolt: svg(<path d="M13 3 5 13.5h6L10 21l8-10.5h-6L13 3Z" />),
  key: svg(<><circle cx="8" cy="15" r="4" /><path d="m11 12 8.5-8.5M16.5 6.5l2.5 2.5M14 9l2 2" /></>),
  power: svg(<><path d="M12 3.5v8" /><path d="M7 6.5a7.5 7.5 0 1 0 10 0" /></>),
  trash: svg(<path d="M4.5 7h15M10 7V4.5h4V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5" />),
  sync: svg(<><path d="M20 11a8 8 0 0 0-14.3-4.6L4 8.5" /><path d="M4 4v4.5h4.5" /><path d="M4 13a8 8 0 0 0 14.3 4.6L20 15.5" /><path d="M20 20v-4.5h-4.5" /></>),
  phone: svg(<path d="M6.5 3.5h3l1.5 4.5-2 1.5a11 11 0 0 0 5.5 5.5l1.5-2 4.5 1.5v3a2 2 0 0 1-2 2A16 16 0 0 1 4.5 5.5a2 2 0 0 1 2-2Z" />),
  mail: svg(<><rect x="3.5" y="5.5" width="17" height="13" rx="2.5" /><path d="m4.5 7 7.5 6 7.5-6" /></>),
  chat: svg(<path d="M4.5 19.5 6 15.5A7.5 7.5 0 1 1 9 18.5l-4.5 1Z" />),
  pin: svg(<><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 1 1 13 0c0 5.4-6.5 11-6.5 11Z" /><circle cx="12" cy="10" r="2.3" /></>),
  monitor: svg(<><rect x="3.5" y="4.5" width="17" height="11.5" rx="2" /><path d="M9 20h6M12 16v4" /></>),
  mobile: svg(<><rect x="7" y="3" width="10" height="18" rx="2.5" /><path d="M11 17.5h2" /></>),
  alert: svg(<><path d="M12 4 2.8 19.5h18.4L12 4Z" /><path d="M12 10v4.5M12 17.3v.2" /></>),
  clock: svg(<><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>),
  globe: svg(<><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.5 2.6 3.6 5.5 3.6 8.5s-1.1 5.9-3.6 8.5c-2.5-2.6-3.6-5.5-3.6-8.5S9.5 6.1 12 3.5Z" /></>),
  user: svg(<><circle cx="12" cy="8.5" r="3.8" /><path d="M4.5 20a7.5 7.5 0 0 1 15 0" /></>),
  plus: svg(<path d="M12 5v14M5 12h14" />),
  shield: svg(<path d="M12 3.5 5 6v5.5c0 4.3 2.9 7.8 7 9 4.1-1.2 7-4.7 7-9V6l-7-2.5Z" />),
  chevron: svg(<path d="m9 6 6 6-6 6" />, 14),
  spark: svg(<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" />),
};
