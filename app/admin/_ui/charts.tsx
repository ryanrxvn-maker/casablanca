'use client';

import { memo, useState } from 'react';
import { accent, type Accent } from './model';

/**
 * Barras verticais (série diária). Leve: divs com altura em %, sem
 * biblioteca, sem animação contínua. O hover só re-renderiza o gráfico.
 */
export const BarSeries = memo(function BarSeries({
  points,
  a,
  format,
  height = 112,
  ariaLabel,
  emptyText = 'Nada no período.',
}: {
  points: Array<{ key: string; label: string; value: number }>;
  a: Accent;
  format: (v: number) => string;
  height?: number;
  ariaLabel: string;
  emptyText?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...points.map((p) => p.value), 0);
  const total = points.reduce((s, p) => s + p.value, 0);
  const shown = hover != null ? points[hover] : null;

  return (
    <div>
      <div className="field-label mb-2 flex h-5 items-baseline justify-between gap-3 text-[12.5px]">
        <span className="text-text-muted">{shown ? shown.label : `${points.length} dias`}</span>
        <span className="font-semibold text-text" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {shown ? format(shown.value) : `${format(total)} no total`}
        </span>
      </div>
      <div
        role="img"
        aria-label={ariaLabel}
        className="relative flex items-end gap-[3px]"
        style={{ height }}
        onMouseLeave={() => setHover(null)}
      >
        {max === 0 ? (
          <div className="field-label absolute inset-0 flex items-center justify-center text-[12.5px] text-text-muted">
            {emptyText}
          </div>
        ) : null}
        {points.map((p, i) => {
          const h = p.value > 0 ? Math.max((p.value / Math.max(max, 1)) * 100, 4) : 0;
          const on = hover === i;
          return (
            <div
              key={p.key}
              className="flex h-full flex-1 items-end justify-center"
              onMouseEnter={() => setHover(i)}
            >
              <div
                className="w-[64%] max-w-[22px] rounded-b-[2px] rounded-t-[5px] transition-[background-color] duration-200"
                style={{
                  height: h ? `${h}%` : 2,
                  background: h
                    ? accent(a, on ? 0.95 : hover == null ? 0.7 : 0.4)
                    : 'rgb(var(--text) / 0.08)',
                }}
              />
            </div>
          );
        })}
      </div>
      <div className="field-label mt-2 flex justify-between text-[11.5px] text-text-muted">
        <span>{points[0]?.label}</span>
        <span>{points[Math.floor(points.length / 2)]?.label}</span>
        <span>hoje</span>
      </div>
    </div>
  );
});

/** Ranking horizontal (ferramentas, origem). */
export const RankList = memo(function RankList({
  items,
  a,
  limit = 8,
  numbered,
  emptyText,
}: {
  items: Array<{ key: string; label: string; value: number; sub?: string }>;
  a: Accent;
  limit?: number;
  numbered?: boolean;
  emptyText: string;
}) {
  if (!items.length) {
    return <p className="field-label py-3 text-center text-[13px] text-text-muted">{emptyText}</p>;
  }
  const max = items[0]?.value || 1;
  return (
    <ul className="flex flex-col gap-2.5">
      {items.slice(0, limit).map((t, i) => (
        <li key={t.key} className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3">
          {numbered ? (
            <span className="font-tech w-4 text-right text-[12px] font-semibold text-text-muted" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {i + 1}
            </span>
          ) : (
            <span />
          )}
          <span className="min-w-0">
            <span className="field-label flex items-baseline justify-between gap-2 text-[13px]">
              <span className="truncate text-text">{t.label}</span>
              {t.sub ? <span className="shrink-0 text-[11.5px] text-text-muted">{t.sub}</span> : null}
            </span>
            <span className="mt-1.5 block h-[5px] overflow-hidden rounded-full bg-[rgb(var(--text)/0.06)]">
              <span
                className="block h-full rounded-full"
                style={{ width: `${Math.max((t.value / max) * 100, 4)}%`, background: accent(a, 0.75) }}
              />
            </span>
          </span>
          <span className="font-tech w-9 text-right text-[13px] font-semibold text-text" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {t.value}
          </span>
        </li>
      ))}
    </ul>
  );
});
