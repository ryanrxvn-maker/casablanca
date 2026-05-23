'use client';

import { ToolShell } from '@/components/ToolShell';
import { useToolState } from '@/components/ToolsStateProvider';
import { formatBRL } from '@/lib/utils';

const VPM_PRESETS = [50, 80, 100, 150, 200, 300] as const;

export default function CalculadoraPage() {
  const [valorPorMinuto, setValorPorMinuto] = useToolState<string>(
    'calculadora:vpm',
    '',
  );
  const [minutagem, setMinutagem] = useToolState<string>(
    'calculadora:min',
    '',
  );
  const [descontoPct, setDescontoPct] = useToolState<string>(
    'calculadora:desconto',
    '0',
  );

  const vpm = parseFloat(valorPorMinuto.replace(',', '.')) || 0;
  const min = parseFloat(minutagem.replace(',', '.')) || 0;
  const desconto = Math.max(0, Math.min(100, parseFloat(descontoPct.replace(',', '.')) || 0));

  const subtotal = vpm * min;
  const valorDesconto = subtotal * (desconto / 100);
  const total = subtotal - valorDesconto;

  return (
    <ToolShell
      title="Calculadora"
      eyebrow="OPERACIONAL"
      description="Quanto cobrar pelo projeto? Coloca os minutos, o valor e a gente fecha a conta."
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
            <div className="mt-2 flex flex-wrap gap-1.5">
              {VPM_PRESETS.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setValorPorMinuto(String(v))}
                  className="mono rounded-full border border-line-strong px-2.5 py-0.5 text-[11px] text-text-muted transition-all duration-200 hover:border-lime hover:text-lime active:scale-[0.95]"
                >
                  R${v}
                </button>
              ))}
            </div>
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

        <div>
          <div className="flex items-center justify-between">
            <label className="label-field !mb-0" htmlFor="desconto">
              Desconto (%)
            </label>
            <span className="mono text-xs text-lime">{desconto}%</span>
          </div>
          <input
            id="desconto"
            type="range"
            min={0}
            max={50}
            step={1}
            value={desconto}
            onChange={(e) => setDescontoPct(e.target.value)}
            className="mt-3"
          />
        </div>

        <div className="card-3d card-pad tech-frame">
          <div className="label-field">Total do orcamento</div>
          <div
            className="font-display font-black tracking-tight text-lime"
            style={{ fontSize: 40, lineHeight: 1.05 }}
          >
            {formatBRL(total)}
          </div>
          <div className="mono mt-3 grid gap-1 text-xs text-text-muted">
            <div>
              <span className="mono text-white">{formatBRL(vpm)}</span>{' '}
              ×{' '}
              <span className="mono text-white">
                {min.toLocaleString('pt-BR')} min
              </span>{' '}
              ={' '}
              <span className="mono text-white">{formatBRL(subtotal)}</span>
            </div>
            {desconto > 0 ? (
              <div>
                Desconto{' '}
                <span className="mono text-red-300">{desconto}%</span>{' '}
                ={' '}
                <span className="mono text-red-300">
                  -{formatBRL(valorDesconto)}
                </span>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </ToolShell>
  );
}
