'use client';

import { useState } from 'react';
import { ToolShell } from '@/components/ToolShell';
import { formatBRL } from '@/lib/utils';

export default function CalculadoraPage() {
  const [valorPorMinuto, setValorPorMinuto] = useState('');
  const [minutagem, setMinutagem] = useState('');

  const vpm = parseFloat(valorPorMinuto.replace(',', '.')) || 0;
  const min = parseFloat(minutagem.replace(',', '.')) || 0;
  const total = vpm * min;

  return (
    <ToolShell
      title="Calculadora de minutos"
      description="Calcule o orçamento do projeto a partir do valor por minuto e da minutagem."
    >
      <div className="flex flex-col gap-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label-field" htmlFor="vpm">
              Valor por minuto (R$)
            </label>
            <input
              id="vpm"
              inputMode="decimal"
              placeholder="0,00"
              className="input-field"
              value={valorPorMinuto}
              onChange={(e) => setValorPorMinuto(e.target.value)}
            />
          </div>
          <div>
            <label className="label-field" htmlFor="min">
              Minutagem do projeto
            </label>
            <input
              id="min"
              inputMode="decimal"
              placeholder="0"
              className="input-field"
              value={minutagem}
              onChange={(e) => setMinutagem(e.target.value)}
            />
          </div>
        </div>

        <div className="rounded-[16px] border border-line bg-bg p-6">
          <div className="label-field">Total do orçamento</div>
          <div
            className="font-display font-black tracking-tight text-lime"
            style={{ fontSize: 36, lineHeight: 1.1 }}
          >
            {formatBRL(total)}
          </div>
          <div className="mono mt-2 text-xs text-text-muted">
            {formatBRL(vpm)} × {min.toLocaleString('pt-BR')} min
          </div>
        </div>
      </div>
    </ToolShell>
  );
}
