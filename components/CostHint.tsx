'use client';

import { useState } from 'react';
import {
  formatBRL,
  formatUSD,
  type CostEstimate,
} from '@/lib/cost-estimator';

/**
 * Banner pequeno mostrando estimativa de custo da chamada de IA.
 * Click pra abrir o detalhamento por servico.
 */
export function CostHint({ estimate }: { estimate: CostEstimate }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-[12px] border border-line bg-bg-soft/30 px-4 py-3 text-xs">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="flex items-center gap-2 text-text-muted">
          <span className="mono uppercase tracking-widest">
            Estimativa de custo
          </span>
          <span className="mono text-lime">
            ~{formatBRL(estimate.brl)}
          </span>
          <span className="mono text-text-dim">
            ({formatUSD(estimate.usd)})
          </span>
          {estimate.approximate ? (
            <span className="rounded-full border border-line-strong px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-text-dim">
              ~aprox
            </span>
          ) : null}
        </span>
        <span
          className={
            'h-3 w-3 transition-transform duration-200 ' +
            (open ? 'rotate-180' : '')
          }
          aria-hidden
        >
          <svg viewBox="0 0 12 12" fill="none">
            <path
              d="M2 4l4 4 4-4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>

      {open ? (
        <div className="mt-3 grid gap-1.5 border-t border-line pt-3">
          {estimate.breakdown.map((b, i) => (
            <div
              key={i}
              className="flex items-center justify-between gap-2 text-[11px]"
            >
              <span className="text-text-muted">
                {b.service}{' '}
                <span className="mono text-text-dim">· {b.quantity}</span>
              </span>
              <span className="mono text-lime">{formatUSD(b.usd)}</span>
            </div>
          ))}
          <p className="mt-2 text-[10px] text-text-dim">
            Cotacao USD-BRL fixa em 5,20. Use como referencia — o custo
            real depende do uso de tokens reportado pelo provedor.
          </p>
        </div>
      ) : null}
    </div>
  );
}
