'use client';

import { ToolShell } from '@/components/ToolShell';
import { useToolState } from '@/components/ToolsStateProvider';
import { formatBRL } from '@/lib/utils';
import { ToolStep, ToolSlider, ToolMetric, ToolResultCard } from '@/components/tool-kit';
import { IconCalculadora, IconStepMoney, IconStepClock, IconStepTag } from '@/components/ToolIcons';

const HUE = 'rgba(148,163,184,0.4)';

const VPM_PRESETS = [50, 80, 100, 150, 200, 300] as const;

type AdRow = { id: string; time: string };

let _adSeq = 0;
function newAd(time = ''): AdRow {
  _adSeq += 1;
  return { id: `ad_${_adSeq}`, time };
}

/** Converte "MM:SS" / "HH:MM:SS" / minutos decimais ("2,5") em SEGUNDOS. */
function parseDur(s: string): number {
  const t = (s || '').trim();
  if (!t) return 0;
  if (t.includes(':')) {
    const parts = t.split(':').map((p) => parseInt(p.replace(/\D/g, ''), 10) || 0);
    if (parts.length >= 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return parts[0] * 60 + (parts[1] || 0);
  }
  // Sem ":" → trata como minutos decimais
  return (parseFloat(t.replace(',', '.')) || 0) * 60;
}

/** Segundos → "MM:SS" (ou "HH:MM:SS" se passar de 1h). */
function fmtDur(totalSec: number): string {
  const s = Math.round(totalSec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(r)}` : `${pad(m)}:${pad(r)}`;
}

export default function CalculadoraPage() {
  const [valorPorMinuto, setValorPorMinuto] = useToolState<string>(
    'calculadora:vpm',
    '',
  );
  const [ads, setAds] = useToolState<AdRow[]>(
    'calculadora:ads',
    [newAd()],
  );
  const [descontoPct, setDescontoPct] = useToolState<string>(
    'calculadora:desconto',
    '0',
  );

  const vpm = parseFloat(valorPorMinuto.replace(',', '.')) || 0;
  const desconto = Math.max(0, Math.min(100, parseFloat(descontoPct.replace(',', '.')) || 0));

  const totalSeconds = ads.reduce((acc, ad) => acc + parseDur(ad.time), 0);
  const min = totalSeconds / 60;
  const adsPreenchidos = ads.filter((ad) => parseDur(ad.time) > 0).length;

  const updateAd = (id: string, time: string) =>
    setAds((prev) => prev.map((ad) => (ad.id === id ? { ...ad, time } : ad)));
  const addAd = () => setAds((prev) => [...prev, newAd()]);
  const removeAd = (id: string) =>
    setAds((prev) => (prev.length > 1 ? prev.filter((ad) => ad.id !== id) : prev));

  const subtotal = vpm * min;
  const valorDesconto = subtotal * (desconto / 100);
  const total = subtotal - valorDesconto;

  return (
    <ToolShell
      title="Calculadora"
      eyebrow="OPERACIONAL"
      description="Quanto cobrar pelo projeto? Coloca a duração de cada AD, o valor por minuto e a gente fecha a conta."
      hue={HUE}
      icon={<IconCalculadora size={56} />}
    >
      <div className="flex flex-col gap-5">
        <ToolStep n={1} icon={<IconStepMoney size={18} />} title="Tabela de preço" hint="Quanto custa cada minuto entregue" hue={HUE}>
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

        <ToolStep n={2} icon={<IconStepClock size={18} />} title="ADs" hint="Coloca a duração de cada AD (MM:SS) — a gente soma tudo" hue={HUE}>
          <div className="flex flex-col gap-2">
            {ads.map((ad, i) => {
              const sec = parseDur(ad.time);
              const valorAd = vpm * (sec / 60);
              return (
                <div key={ad.id} className="flex items-center gap-2">
                  <span
                    className="mono flex h-9 w-14 shrink-0 items-center justify-center rounded-[10px] border border-line-strong bg-bg-soft/60 text-[12px] font-bold text-text-muted"
                    style={{ fontFamily: 'var(--font-tech)' }}
                  >
                    AD{i + 1}
                  </span>
                  <input
                    inputMode="numeric"
                    placeholder="00:00"
                    className="input-field flex-1"
                    value={ad.time}
                    onChange={(e) => updateAd(ad.id, e.target.value)}
                  />
                  <span
                    className="mono w-24 shrink-0 text-right text-[12px] text-violet"
                    style={{ fontFamily: 'var(--font-mono)' }}
                  >
                    {sec > 0 ? formatBRL(valorAd) : '—'}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeAd(ad.id)}
                    disabled={ads.length <= 1}
                    aria-label={`Remover AD${i + 1}`}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-line-strong text-text-muted transition hover:border-red-500/45 hover:text-red-300 active:scale-[0.94] disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-line-strong disabled:hover:text-text-muted"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                      <path d="M5 12h14" />
                    </svg>
                  </button>
                </div>
              );
            })}
          </div>

          <button
            type="button"
            onClick={addAd}
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-[12px] border border-dashed border-line-strong py-2.5 text-[12.5px] font-bold text-text-muted transition hover:border-violet/45 hover:text-white active:scale-[0.99]"
            style={{ fontFamily: 'var(--font-tech)' }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Adicionar AD
          </button>

          <div className="mt-3 flex items-center justify-between rounded-[12px] border border-line bg-bg-soft/50 px-4 py-2.5">
            <span
              className="text-[10.5px] font-bold uppercase tracking-[0.18em] text-text-muted"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              Duração total
            </span>
            <span className="mono text-[13px] text-white" style={{ fontFamily: 'var(--font-mono)' }}>
              {fmtDur(totalSeconds)} · {min.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} min
            </span>
          </div>
        </ToolStep>

        <ToolStep n={3} icon={<IconStepTag size={18} />} title="Desconto" hint="Pra cliente recorrente ou pacote fechado" hue={HUE}>
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
          meta={
            vpm > 0 && min > 0
              ? `${adsPreenchidos} AD${adsPreenchidos === 1 ? '' : 's'} · ${fmtDur(totalSeconds)} × ${formatBRL(vpm)}`
              : undefined
          }
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
