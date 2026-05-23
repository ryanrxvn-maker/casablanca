'use client';

import { ToolShell } from '@/components/ToolShell';
import { useToolState } from '@/components/ToolsStateProvider';
import { formatBRL } from '@/lib/utils';
import { ToolStep, ToolSlider, ToolMetric, ToolResultCard } from '@/components/tool-kit';
import { IconCalculadora } from '@/components/ToolIcons';

const HUE = 'rgba(148,163,184,0.4)';

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
      hue={HUE}
      icon={<IconCalculadora size={56} />}
    >
      <div className="flex flex-col gap-5">
        <ToolStep n={1} title="Tabela de preço" hint="Quanto custa cada minuto entregue" hue={HUE}>
          <label className="block">
            <span
              className="text-[10.5px] font-bold uppercase tracking-[0.18em] text-text-muted"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              Valor por minuto (R$)
            </span>
            <input
              id="vpm"
              inputMode="decimal"
              placeholder="0,00"
              className="input-field mt-2"
              value={valorPorMinuto}
              onChange={(e) => setValorPorMinuto(e.target.value)}
            />
          </label>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {VPM_PRESETS.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setValorPorMinuto(String(v))}
                className={
                  'mono rounded-full border px-3 py-1 text-[11px] transition-all duration-200 active:scale-[0.95] ' +
                  (Math.abs(vpm - v) < 0.001
                    ? 'border-violet/65 bg-violet/15 text-white'
                    : 'border-line-strong text-text-muted hover:border-violet hover:text-white')
                }
              >
                R${v}
              </button>
            ))}
          </div>
        </ToolStep>

        <ToolStep n={2} title="Minutagem" hint="Quantos minutos finais o projeto entrega" hue={HUE}>
          <input
            id="min"
            inputMode="decimal"
            placeholder="0"
            className="input-field"
            value={minutagem}
            onChange={(e) => setMinutagem(e.target.value)}
          />
        </ToolStep>

        <ToolStep n={3} title="Desconto" hint="Pra cliente recorrente ou pacote fechado" hue={HUE}>
          <ToolSlider
            label="Desconto"
            min={0}
            max={50}
            step={1}
            value={desconto}
            onChange={(v) => setDescontoPct(String(v))}
            display={(v) => v + '%'}
          />
        </ToolStep>

        <ToolResultCard
          title="Orçamento"
          meta={vpm > 0 && min > 0 ? `${min.toLocaleString('pt-BR')} min × ${formatBRL(vpm)}` : undefined}
          hue={HUE}
        >
          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3">
            <ToolMetric value={formatBRL(subtotal)} label="Subtotal" />
            <ToolMetric
              value={desconto > 0 ? `-${formatBRL(valorDesconto)}` : '—'}
              label={desconto > 0 ? `Desconto ${desconto}%` : 'Sem desconto'}
              accent="rose"
            />
            <ToolMetric value={formatBRL(total)} label="Total" accent="lime" />
          </div>
        </ToolResultCard>
      </div>
    </ToolShell>
  );
}
