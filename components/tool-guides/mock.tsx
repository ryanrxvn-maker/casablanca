import type { ReactNode } from 'react';

/**
 * Primitivos visuais dos guias — "prints" estilizados da UI real.
 *
 * Cada Shot é uma janelinha escura (sempre dark, via .dark-island) que imita
 * o trecho relevante da ferramenta, com os MESMOS labels da UI. Sem
 * marcadores sobrepostos: o print fala por si (pedido do dono em 10.07.26).
 */

/* Janela fake de app: header com 3 dots + label, corpo relativo. */
export function Shot({
  label,
  children,
}: {
  label?: string;
  children: ReactNode;
}) {
  return (
    <div className="dark-island relative rounded-[14px] border border-line-strong bg-[#0b0b0f] shadow-depth-1">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className="flex gap-1.5" aria-hidden>
          <i className="h-2 w-2 rounded-full bg-white/10" />
          <i className="h-2 w-2 rounded-full bg-white/10" />
          <i className="h-2 w-2 rounded-full bg-white/10" />
        </span>
        {label ? (
          <span className="mono text-[10px] uppercase tracking-[0.14em] text-white/35">
            {label}
          </span>
        ) : null}
      </div>
      <div className="relative p-3.5">{children}</div>
    </div>
  );
}

export function MRow({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

export function MStack({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-2">{children}</div>;
}

/* Botão fake — labels idênticos aos da ferramenta real. */
export function MBtn({
  children,
  tone = 'primary',
}: {
  children: ReactNode;
  tone?: 'primary' | 'lime' | 'ghost' | 'dark';
}) {
  const tones: Record<string, string> = {
    primary:
      'border-violet/60 bg-gradient-to-b from-[#7c5cf0] to-[#5b3fd4] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_6px_14px_-6px_rgba(124,58,237,0.8)]',
    lime: 'border-lime/50 bg-gradient-to-b from-[#c6d48a] to-[#aab868] text-black shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_6px_14px_-6px_rgba(170,190,90,0.6)]',
    ghost:
      'border-white/12 bg-white/[0.04] text-white/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]',
    dark: 'border-white/10 bg-[#17171d] text-white/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.05),inset_0_-3px_6px_rgba(0,0,0,0.5)]',
  };
  return (
    <span
      className={
        'relative inline-flex items-center gap-1.5 whitespace-nowrap rounded-[10px] border px-3 py-1.5 text-[11px] font-bold ' +
        tones[tone]
      }
      style={{ fontFamily: 'var(--font-tech)' }}
    >
      {children}
    </span>
  );
}

/* Dropzone tracejada */
export function MDrop({
  label,
  sub,
}: { label: string; sub?: string }) {
  return (
    <div className="relative flex flex-col items-center justify-center gap-1 rounded-[12px] border border-dashed border-violet/40 bg-violet/[0.05] px-4 py-5 text-center">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M12 16V5m0 0l-4 4m4-4l4 4M4 19h16"
          stroke="rgba(196,181,253,0.8)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="text-[11.5px] font-semibold text-white/80">{label}</span>
      {sub ? <span className="text-[10px] text-white/40">{sub}</span> : null}
    </div>
  );
}

/* Campo fake */
export function MField({
  label,
  value,
  grow,
}: {
  label?: string;
  value: string;
  grow?: boolean;
}) {
  return (
    <div className={'flex flex-col gap-1 ' + (grow ? 'flex-1 min-w-[120px]' : '')}>
      {label ? (
        <span className="text-[9.5px] font-bold uppercase tracking-[0.12em] text-white/35">
          {label}
        </span>
      ) : null}
      <span className="relative block rounded-[9px] border border-white/10 bg-black/40 px-2.5 py-1.5 text-[11px] text-white/65">
        <span className="block truncate">{value}</span>
      </span>
    </div>
  );
}

/* Slider fake — o marcador ancora NO THUMB (aponta o controle exato). */
export function MSlider({
  label,
  pct,
  val,
}: { label: string; pct: number; val: string }) {
  return (
    <div className="flex w-full flex-col gap-1.5 pt-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-white/40">
          {label}
        </span>
        <span className="mono text-[10.5px] text-[#c4b5fd]">{val}</span>
      </div>
      <div className="relative mt-1 h-1.5 rounded-full bg-white/10">
        <span
          className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-[#8b5cf6] to-[#c4b5fd]"
          style={{ width: `${pct}%` }}
        />
        <span
          className="absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full bg-white shadow-[0_2px_6px_rgba(0,0,0,0.5)]"
          style={{ left: `calc(${pct}% - 7px)` }}
        >
        </span>
      </div>
    </div>
  );
}

/* Toggle fake */
export function MToggle({
  on,
  label,
}: { on: boolean; label: string }) {
  return (
    <span className="relative inline-flex items-center gap-2 rounded-[10px] border border-white/10 bg-white/[0.03] px-2.5 py-1.5">
      <span
        className={
          'relative h-4 w-7 rounded-full transition-colors ' +
          (on ? 'bg-[#8b5cf6]' : 'bg-white/15')
        }
      >
        <span
          className={
            'absolute top-0.5 h-3 w-3 rounded-full bg-white shadow ' +
            (on ? 'right-0.5' : 'left-0.5')
          }
        />
      </span>
      <span className="text-[10.5px] font-semibold text-white/65">{label}</span>
    </span>
  );
}

/* Chip/etiqueta */
export function MChip({
  children,
  tone = 'violet',
}: {
  children: ReactNode;
  tone?: 'violet' | 'lime' | 'amber' | 'dim';
}) {
  const tones: Record<string, string> = {
    violet: 'border-violet/40 bg-violet/10 text-[#c4b5fd]',
    lime: 'border-lime/40 bg-lime/10 text-[#d3e39a]',
    amber: 'border-amber/40 bg-amber/10 text-[#ecd490]',
    dim: 'border-white/10 bg-white/[0.04] text-white/45',
  };
  return (
    <span
      className={
        'relative inline-flex items-center rounded-full border px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.1em] ' +
        tones[tone]
      }
    >
      {children}
    </span>
  );
}

/* Item de fila com barra de progresso — imita os cards de job. */
export function MQueueItem({
  name,
  status,
  pct,
  tone = 'violet',
}: {
  name: string;
  status: string;
  pct: number;
  tone?: 'violet' | 'lime' | 'amber';
}) {
  const bar =
    tone === 'lime'
      ? 'from-[#aab868] to-[#d3e39a]'
      : tone === 'amber'
        ? 'from-[#caa64d] to-[#ecd490]'
        : 'from-[#7c3aed] to-[#c4b5fd]';
  return (
    <div className="relative rounded-[11px] border border-white/10 bg-black/30 px-3 py-2">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="mono truncate text-[10.5px] text-white/75">{name}</span>
        <span className="whitespace-nowrap text-[9.5px] font-bold uppercase tracking-[0.1em] text-white/40">
          {status}
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-white/10">
        <span
          className={'block h-full rounded-full bg-gradient-to-r ' + bar}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
