'use client';

import { useState } from 'react';
import { ToolShell } from '@/components/ToolShell';
import { useToolState } from '@/components/ToolsStateProvider';
import { formatBRL } from '@/lib/utils';
import { ToolStep, ToolSlider, ToolMetric, ToolResultCard } from '@/components/tool-kit';
import { IconCalculadora, IconStepMoney, IconStepClock, IconStepTag } from '@/components/ToolIcons';
import { downloadBudgetReport } from './report';

const HUE = 'rgba(148,163,184,0.4)';

const VPM_PRESETS = [50, 80, 100, 150, 200, 300] as const;

type AdRow = { id: string; time: string };

let _adSeq = 0;
function newAd(time = ''): AdRow {
  _adSeq += 1;
  return { id: `ad_${_adSeq}`, time };
}

/**
 * Converte a duração de um AD em SEGUNDOS, SEMPRE interpretando como
 * minutos e segundos — não importa o separador. `06:19`, `06,19` e
 * `06.19` são todos 6 min 19 seg. Sem separador (`6`) = 6 minutos.
 * Três partes (`1:06:19`) = horas:minutos:segundos.
 */
function parseDur(s: string): number {
  const t = (s || '').trim();
  if (!t) return 0;
  const parts = t.split(/[.,:]/).map((p) => parseInt(p.replace(/\D/g, ''), 10) || 0);
  if (parts.length === 1) return parts[0] * 60; // só minutos
  if (parts.length >= 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return parts[0] * 60 + parts[1]; // minutos : segundos
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
  const [cliente, setCliente] = useToolState<string>(
    'calculadora:cliente',
    '',
  );
  const [pixOn, setPixOn] = useToolState<boolean>('calculadora:pixOn', false);
  const [pixKey, setPixKey] = useToolState<string>('calculadora:pixKey', '');
  const [pixNome, setPixNome] = useToolState<string>('calculadora:pixNome', '');
  const [pixCidade, setPixCidade] = useToolState<string>('calculadora:pixCidade', '');

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

  const canPrint = vpm > 0 && totalSeconds > 0;
  const [gerando, setGerando] = useState(false);

  const gerarRelatorio = async () => {
    if (!canPrint || gerando) return;
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const docNumber = `ORC-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
    const dateLabel = now.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });

    const items = ads
      .filter((ad) => parseDur(ad.time) > 0)
      .map((ad, i) => {
        const sec = parseDur(ad.time);
        return {
          nome: `AD ${i + 1}`,
          sub: 'Vídeo editado',
          duracao: fmtDur(sec),
          valor: formatBRL(vpm * (sec / 60)),
        };
      });

    setGerando(true);
    try {
      await downloadBudgetReport({
        docNumber,
        dateLabel,
        validadeLabel: '7 dias',
        cliente: cliente.trim(),
        vpmLabel: formatBRL(vpm),
        duracaoTotalLabel: fmtDur(totalSeconds),
        qtdAds: items.length,
        items,
        subtotalLabel: formatBRL(subtotal),
        descontoPct: desconto,
        descontoLabel: `-${formatBRL(valorDesconto)}`,
        totalLabel: formatBRL(total),
        logoUrl: `${window.location.origin}/auto-edit-logo@256.png`,
        pix:
          pixOn && pixKey.trim()
            ? {
                key: pixKey.trim(),
                name: pixNome.trim(),
                city: pixCidade.trim(),
                amount: total,
              }
            : undefined,
      });
    } catch (err) {
      console.error('[calculadora] falha ao gerar PDF', err);
      alert('Não consegui gerar o PDF agora. Tenta de novo em instantes.');
    } finally {
      setGerando(false);
    }
  };

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

        <ToolStep n={2} icon={<IconStepClock size={18} />} title="ADs" hint="Duração de cada AD em minutos e segundos — pode usar : , ou . (ex: 06:19)" hue={HUE}>
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
              {fmtDur(totalSeconds)}
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

        <ToolStep n={4} icon={<IconStepMoney size={18} />} title="Pagamento (PIX)" hint="Opcional — gera QR Code de PIX no relatório" hue={HUE}>
          <button
            type="button"
            role="switch"
            aria-checked={pixOn}
            onClick={() => setPixOn(!pixOn)}
            className="flex w-full items-center justify-between rounded-[12px] border border-line-strong bg-bg-soft/40 px-4 py-3 transition hover:border-violet/40"
          >
            <span className="text-[13px] font-semibold text-white">
              Incluir PIX no relatório
            </span>
            <span
              className={
                'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 ' +
                (pixOn ? 'bg-violet' : 'bg-line-strong')
              }
            >
              <span
                className={
                  'inline-block h-4.5 w-4.5 transform rounded-full bg-white shadow transition-transform duration-200 ' +
                  (pixOn ? 'translate-x-[22px]' : 'translate-x-[3px]')
                }
                style={{ height: 18, width: 18 }}
              />
            </span>
          </button>

          {pixOn ? (
            <div className="mt-3 flex flex-col gap-3">
              <label className="block">
                <span
                  className="text-[10.5px] font-bold uppercase tracking-[0.18em] text-text-muted"
                  style={{ fontFamily: 'var(--font-tech)' }}
                >
                  Chave PIX
                </span>
                <input
                  inputMode="text"
                  placeholder="e-mail, telefone, CPF/CNPJ ou aleatória"
                  className="input-field mt-2"
                  value={pixKey}
                  onChange={(e) => setPixKey(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block">
                  <span
                    className="text-[10.5px] font-bold uppercase tracking-[0.18em] text-text-muted"
                    style={{ fontFamily: 'var(--font-tech)' }}
                  >
                    Nome do recebedor <span className="opacity-50">(opcional)</span>
                  </span>
                  <input
                    inputMode="text"
                    placeholder="Ex: Pedro Souza"
                    className="input-field mt-2"
                    value={pixNome}
                    onChange={(e) => setPixNome(e.target.value)}
                    autoComplete="off"
                  />
                </label>
                <label className="block">
                  <span
                    className="text-[10.5px] font-bold uppercase tracking-[0.18em] text-text-muted"
                    style={{ fontFamily: 'var(--font-tech)' }}
                  >
                    Cidade <span className="opacity-50">(opcional)</span>
                  </span>
                  <input
                    inputMode="text"
                    placeholder="Ex: São Paulo"
                    className="input-field mt-2"
                    value={pixCidade}
                    onChange={(e) => setPixCidade(e.target.value)}
                    autoComplete="off"
                  />
                </label>
              </div>
              <p className="text-[11px] text-text-muted">
                O QR já vem com o valor total ({formatBRL(total)}) preenchido. A chave fica
                só no seu navegador — nada é enviado pra servidor.
              </p>
            </div>
          ) : null}
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

          {/* Emissão do relatório PDF pro cliente */}
          <div className="mt-5 border-t border-line pt-4">
            <label className="block">
              <span
                className="text-[10.5px] font-bold uppercase tracking-[0.18em] text-text-muted"
                style={{ fontFamily: 'var(--font-tech)' }}
              >
                Cliente / Projeto <span className="opacity-50">(opcional)</span>
              </span>
              <input
                inputMode="text"
                placeholder="Ex: João Silva — Campanha Junho"
                className="input-field mt-2"
                value={cliente}
                onChange={(e) => setCliente(e.target.value)}
              />
            </label>

            <button
              type="button"
              onClick={gerarRelatorio}
              disabled={!canPrint || gerando}
              aria-label="Baixar relatório do orçamento em PDF"
              className="report3d mt-3.5"
            >
              <span className="report3d-ico" aria-hidden>
                {gerando ? (
                  <svg className="report3d-spin" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                    <path d="M12 3a9 9 0 1 0 9 9" />
                  </svg>
                ) : (
                  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
                    <path d="M14 3v5h5" />
                    <path d="M8.5 17v-3" />
                    <path d="M12 17v-5" />
                    <path d="M15.5 17v-2" />
                  </svg>
                )}
              </span>
              <span>{gerando ? 'Gerando PDF…' : 'Baixar Relatório (PDF)'}</span>
            </button>
            <p className="mt-2 text-center text-[11px] text-text-muted">
              Baixa um PDF profissional do orçamento na hora — é só mandar pro cliente.
            </p>
          </div>
        </ToolResultCard>
      </div>

      <style jsx>{`
        .report3d {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          width: 100%;
          padding: 15px 22px;
          border-radius: 16px;
          font-family: var(--font-tech);
          font-weight: 800;
          font-size: 14.5px;
          letter-spacing: 0.01em;
          color: #fff;
          background: linear-gradient(180deg, #9173f8 0%, #6d4ee8 58%, #5a3fd6 100%);
          border: 1px solid rgba(255, 255, 255, 0.22);
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.4),
            inset 0 -3px 0 rgba(0, 0, 0, 0.16),
            0 7px 0 #4127a6,
            0 12px 24px -8px rgba(109, 78, 232, 0.7);
          transform: translateY(0);
          transition: transform 0.12s ease, box-shadow 0.12s ease, filter 0.2s ease;
          cursor: pointer;
        }
        .report3d:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.45),
            inset 0 -3px 0 rgba(0, 0, 0, 0.16),
            0 8px 0 #4127a6,
            0 18px 30px -8px rgba(109, 78, 232, 0.8);
        }
        .report3d:active:not(:disabled) {
          transform: translateY(6px);
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.35),
            inset 0 -2px 0 rgba(0, 0, 0, 0.18),
            0 1px 0 #4127a6,
            0 5px 12px -8px rgba(109, 78, 232, 0.6);
        }
        .report3d:disabled {
          cursor: not-allowed;
          filter: grayscale(0.45) brightness(0.9);
          opacity: 0.5;
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.25),
            0 6px 0 #4127a6;
        }
        .report3d-ico {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 30px;
          height: 30px;
          border-radius: 9px;
          background: rgba(255, 255, 255, 0.16);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.25);
        }
        .report3d-spin {
          animation: report3d-rot 0.7s linear infinite;
        }
        @keyframes report3d-rot {
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </ToolShell>
  );
}
