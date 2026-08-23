'use client';

/**
 * AUTO CORTES — peças visuais pequenas compartilhadas pelos componentes da
 * ferramenta. Nada de lógica de pipeline aqui: só rótulo, relógio, chip,
 * caixa de erro e barra de progresso, no padrão visual do resto do app.
 */

import type { ReactNode } from 'react';
import type { AspectRatio } from '@/lib/auto-cortes/types';

/** Rosa-coral da tool (não colide com o âmbar da Tipografia nem o índigo do Compressor). */
export const AC_HUE = 'rgba(244,114,182,0.42)';

/** Relevo 3D dos botões pequenos (mesmo do editor da Tipografia). */
export const T3D =
  ' shadow-[0_2px_0_rgba(0,0,0,0.16),0_6px_12px_-6px_rgba(0,0,0,0.25)] hover:-translate-y-[1.5px] hover:shadow-[0_3.5px_0_rgba(0,0,0,0.16),0_10px_18px_-8px_rgba(0,0,0,0.3)] active:translate-y-[1px] active:shadow-[inset_0_2px_5px_rgba(0,0,0,0.28)] transition-all duration-150 will-change-transform';

/** Proporção CSS de cada formato de saída (pro card do corte). */
export const ASPECT_CSS: Record<AspectRatio, string> = {
  '9:16': '9 / 16',
  '4:5': '4 / 5',
  '1:1': '1 / 1',
  '16:9': '16 / 9',
};

/** `h:mm:ss` quando passa de 1 h; `m:ss` no resto (formatTime só faz m:ss). */
export function fmtClock(totalSec: number): string {
  if (!isFinite(totalSec) || totalSec < 0) return '0:00';
  const s = Math.floor(totalSec % 60);
  const m = Math.floor((totalSec / 60) % 60);
  const h = Math.floor(totalSec / 3600);
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

/** Aceita `90`, `1:30` ou `1:02:03`; devolve segundos, ou null se não der. */
export function parseClock(raw: string): number | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  if (!/^\d{1,2}(:\d{1,2}){0,2}$|^\d+$/.test(s)) return null;
  const parts = s.split(':').map((n) => parseInt(n, 10));
  if (parts.some((n) => !isFinite(n))) return null;
  let sec = 0;
  for (const p of parts) sec = sec * 60 + p;
  return sec;
}

/** Rótulo pequeno em caixa alta — o padrão dos campos das ferramentas. */
export function FieldLabel({
  children,
  hint,
}: {
  children: ReactNode;
  hint?: string;
}) {
  return (
    <div className="mb-1.5 flex items-baseline gap-2">
      <span
        className="text-[10.5px] font-bold uppercase tracking-[0.18em] text-text-muted"
        style={{ fontFamily: 'var(--font-tech)' }}
      >
        {children}
      </span>
      {hint ? <span className="text-[11px] text-text-dim">{hint}</span> : null}
    </div>
  );
}

/** Erro inline — nunca stack cru (o texto já vem do toFriendlyMessage). */
export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p
      role="alert"
      className="rounded-[12px] border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-red-300"
    >
      {children}
    </p>
  );
}

/** Barra de progresso fina (0..1). */
export function ProgressBar({
  ratio,
  color = 'rgb(244,114,182)',
  height = 6,
}: {
  ratio: number;
  color?: string;
  height?: number;
}) {
  const pct = Math.max(0, Math.min(1, isFinite(ratio) ? ratio : 0)) * 100;
  return (
    <div
      className="w-full overflow-hidden rounded-full bg-black/30"
      style={{ height }}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full rounded-full transition-[width] duration-300"
        style={{ width: `${pct}%`, background: color, boxShadow: `0 0 12px -2px ${color}` }}
      />
    </div>
  );
}

/** Chip informativo (status da extensão, avisos, etc.). */
export function Chip({
  tone,
  children,
  title,
}: {
  tone: 'ok' | 'warn' | 'neutral';
  children: ReactNode;
  title?: string;
}) {
  const cls =
    tone === 'ok'
      ? 'border-lime/45 bg-lime/10 text-lime'
      : tone === 'warn'
        ? 'border-yellow-500/45 bg-yellow-500/10 text-yellow-300'
        : 'border-line text-text-muted';
  return (
    <span
      title={title}
      className={
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ' +
        cls
      }
      style={{ fontFamily: 'var(--font-tech)' }}
    >
      <span
        aria-hidden
        className={
          'inline-block h-1.5 w-1.5 rounded-full ' +
          (tone === 'ok' ? 'bg-lime' : tone === 'warn' ? 'bg-yellow-400' : 'bg-text-dim')
        }
      />
      {children}
    </span>
  );
}

/** Botão pequeno de ação secundária (usado nos cards e barras). */
export function MiniButton({
  children,
  onClick,
  disabled,
  title,
  tone = 'neutral',
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  tone?: 'neutral' | 'pink' | 'lime' | 'danger';
}) {
  const cls =
    tone === 'pink'
      ? 'border-pink-400/45 bg-pink-400/10 text-pink-300 hover:border-pink-400/70'
      : tone === 'lime'
        ? 'border-lime/45 bg-lime/10 text-lime hover:border-lime/70'
        : tone === 'danger'
          ? 'border-red-500/40 bg-red-500/5 text-red-300 hover:border-red-500/70'
          : 'border-line-strong bg-bg-soft/60 text-text-muted hover:border-violet/45 hover:text-text';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={
        'inline-flex items-center gap-1.5 rounded-[10px] border px-2.5 py-1.5 text-[11.5px] font-bold disabled:cursor-not-allowed disabled:opacity-40 ' +
        cls +
        T3D
      }
      style={{ fontFamily: 'var(--font-tech)' }}
    >
      {children}
    </button>
  );
}
