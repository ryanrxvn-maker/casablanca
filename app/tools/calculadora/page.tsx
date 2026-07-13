'use client';

import { useEffect, useState } from 'react';
import { ToolShell } from '@/components/ToolShell';
import { useToolState } from '@/components/ToolsStateProvider';
import { formatBRL } from '@/lib/utils';
import { ToolStep, ToolSlider, ToolMetric, ToolResultCard } from '@/components/tool-kit';
import { IconCalculadora, IconStepMoney, IconStepClock, IconStepTag } from '@/components/ToolIcons';
import { downloadBudgetReport } from './report';

const HUE = 'rgba(148,163,184,0.4)';

const VPM_PRESETS = [50, 80, 100, 150, 200, 300] as const;

type AdRow = { id: string; time: string; label?: string; vpm?: string };

type SavedPix = { id: string; key: string };

const PIX_STORE_KEY = 'calculadora:pixSaved';

let _adSeq = 0;
function newAd(time = ''): AdRow {
  _adSeq += 1;
  return { id: `ad_${_adSeq}`, time };
}

/**
 * Nome exibido de um AD: o apelido que o usuário digitou (se houver) ou o
 * padrão sequencial `AD1`, `AD2`… baseado na posição. O `sep` controla o
 * espaço do fallback — sem espaço na UI compacta ("AD1"), com espaço no PDF
 * ("AD 1"), onde respira melhor.
 */
function adLabel(ad: AdRow, i: number, sep = ''): string {
  return (ad.label || '').trim() || `AD${sep}${i + 1}`;
}

/** Preço digitado ("80", "99,90") → número. Vazio/inválido = 0. */
function parseMoney(s: string): number {
  return parseFloat((s || '').trim().replace(',', '.')) || 0;
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

/**
 * Máscara de TEMPO estilo ODÔMETRO: o usuário SÓ digita números e eles entram
 * pela DIREITA, subindo de segundos → minutos → horas, sempre normalizado pra
 * fazer sentido (60s vira 1min, 60min vira 1h). Nunca precisa digitar `:`.
 *
 *   1 → 00:01   ·   11 → 00:11   ·   111 → 01:11   ·   1111 → 11:11
 *   5 → 00:05   ·   55 → 00:55   ·   555 → 05:55   ·   5555 → 55:55
 *   14000 → 1:40:00   (140 min já aparecem como 2h20 — sempre "faz sentido")
 *
 * Como `fmtDur` agrupa em HH:MM:SS e este parser lê os dígitos no MESMO
 * agrupamento (2 seg / 2 min / resto horas), a máscara faz round-trip perfeito:
 * reprocessar o próprio texto formatado devolve o mesmo tempo.
 */
function maskTime(raw: string): string {
  // Só os dígitos, sem zeros à esquerda inúteis; teto de 6 (até 99:99:99).
  const digits = (raw || '').replace(/\D/g, '').replace(/^0+/, '').slice(0, 6);
  if (!digits) return '';
  const sec = parseInt(digits.slice(-2), 10) || 0;
  const min = digits.length > 2 ? parseInt(digits.slice(-4, -2), 10) || 0 : 0;
  const hr = digits.length > 4 ? parseInt(digits.slice(0, -4), 10) || 0 : 0;
  return fmtDur(hr * 3600 + min * 60 + sec);
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

  const vpm = parseMoney(valorPorMinuto);
  const desconto = Math.max(0, Math.min(100, parseFloat(descontoPct.replace(',', '.')) || 0));

  // Preço efetivo do AD: o próprio (se preenchido) ou o da tabela.
  const adRate = (ad: AdRow) => {
    const own = parseMoney(ad.vpm ?? '');
    return own > 0 ? own : vpm;
  };

  const totalSeconds = ads.reduce((acc, ad) => acc + parseDur(ad.time), 0);
  const min = totalSeconds / 60;
  const adsFilled = ads.filter((ad) => parseDur(ad.time) > 0);
  const adsPreenchidos = adsFilled.length;
  // Preço único valendo pra todos os ADs preenchidos? null = misto (por AD).
  const rates = adsFilled.map(adRate);
  const uniformRate =
    rates.length > 0 && rates.every((r) => Math.abs(r - rates[0]) < 0.001)
      ? rates[0]
      : null;

  const updateAd = (id: string, time: string) =>
    setAds((prev) => prev.map((ad) => (ad.id === id ? { ...ad, time } : ad)));
  const renameAd = (id: string, label: string) =>
    setAds((prev) => prev.map((ad) => (ad.id === id ? { ...ad, label } : ad)));
  const priceAd = (id: string, price: string) =>
    setAds((prev) => prev.map((ad) => (ad.id === id ? { ...ad, vpm: price } : ad)));
  const addAd = () => setAds((prev) => [...prev, newAd()]);
  const removeAd = (id: string) =>
    setAds((prev) => (prev.length > 1 ? prev.filter((ad) => ad.id !== id) : prev));

  const subtotal = ads.reduce(
    (acc, ad) => acc + adRate(ad) * (parseDur(ad.time) / 60),
    0,
  );
  const valorDesconto = subtotal * (desconto / 100);
  const total = subtotal - valorDesconto;

  const canPrint = adsPreenchidos > 0 && rates.every((r) => r > 0);
  const [gerando, setGerando] = useState(false);

  // Chaves PIX salvas no navegador (localStorage) — reuso com 1 clique.
  const [savedPix, setSavedPix] = useState<SavedPix[]>([]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PIX_STORE_KEY);
      if (raw) setSavedPix(JSON.parse(raw) as SavedPix[]);
    } catch {
      /* localStorage indisponível — segue sem chaves salvas */
    }
  }, []);

  const persistSaved = (list: SavedPix[]) => {
    setSavedPix(list);
    try {
      localStorage.setItem(PIX_STORE_KEY, JSON.stringify(list));
    } catch {
      /* ignora falha de escrita (modo privado etc.) */
    }
  };

  const pixKeySaved = savedPix.some(
    (e) => e.key.toLowerCase() === pixKey.trim().toLowerCase(),
  );

  const salvarChavePix = () => {
    const key = pixKey.trim();
    if (!key) return;
    const entry: SavedPix = { id: `pix_${Date.now()}`, key };
    // Dedupe por chave.
    const without = savedPix.filter(
      (e) => e.key.toLowerCase() !== key.toLowerCase(),
    );
    persistSaved([entry, ...without].slice(0, 12));
  };

  const aplicarChavePix = (e: SavedPix) => setPixKey(e.key);

  const removerChavePix = (id: string) =>
    persistSaved(savedPix.filter((e) => e.id !== id));

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

    // Preços mistos → cada item do PDF mostra o próprio R$/min.
    const misto = uniformRate === null;
    const items = ads
      .map((ad, i) => ({ ad, i }))
      .filter(({ ad }) => parseDur(ad.time) > 0)
      .map(({ ad, i }) => {
        const sec = parseDur(ad.time);
        const rate = adRate(ad);
        return {
          nome: adLabel(ad, i, ' '),
          sub: misto ? `Vídeo editado · ${formatBRL(rate)}/min` : 'Vídeo editado',
          duracao: fmtDur(sec),
          valor: formatBRL(rate * (sec / 60)),
        };
      });

    setGerando(true);
    try {
      await downloadBudgetReport({
        docNumber,
        dateLabel,
        cliente: cliente.trim(),
        vpmLabel: uniformRate !== null ? formatBRL(uniformRate) : 'Por item',
        duracaoTotalLabel: fmtDur(totalSeconds),
        qtdAds: items.length,
        items,
        subtotalLabel: formatBRL(subtotal),
        descontoPct: desconto,
        descontoLabel: `-${formatBRL(valorDesconto)}`,
        totalLabel: formatBRL(total),
        pix:
          pixOn && pixKey.trim()
            ? { key: pixKey.trim(), name: '', city: '', amount: total }
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
      description="Quanto cobrar pelo projeto? Coloca a duração de cada AD, o valor por minuto — geral ou próprio de cada AD — e a gente fecha a conta."
      hue={HUE}
      icon={<IconCalculadora size={56} />}
    >
      <div className="flex flex-col gap-5">
        <ToolStep n={1} icon={<IconStepMoney size={18} />} title="Tabela de preço" hint="O valor padrão do minuto — vale pra todo AD que não tiver preço próprio" hue={HUE}>
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

        <ToolStep n={2} icon={<IconStepClock size={18} />} title="Serviço" hint="Nomeie cada item, digite os minutos (619 → 06:19) e, se quiser, um R$/min próprio — vazio usa a tabela" hue={HUE}>
          <div className="flex flex-col gap-2">
            {ads.map((ad, i) => {
              const sec = parseDur(ad.time);
              const ownRate = parseMoney(ad.vpm ?? '');
              const valorAd = adRate(ad) * (sec / 60);
              return (
                <div key={ad.id} className="flex items-center gap-2">
                  <span className="adlabel" data-value={ad.label || `AD${i + 1}`}>
                    <input
                      type="text"
                      value={ad.label ?? ''}
                      onChange={(e) => renameAd(ad.id, e.target.value)}
                      placeholder={`AD${i + 1}`}
                      aria-label={`Nome do item ${i + 1} — clique pra renomear`}
                      title="Clique pra renomear este item"
                      maxLength={28}
                      size={1}
                      spellCheck={false}
                      autoComplete="off"
                    />
                  </span>
                  <input
                    inputMode="numeric"
                    placeholder="00:00"
                    className="input-field flex-1"
                    value={ad.time}
                    onChange={(e) => updateAd(ad.id, maskTime(e.target.value))}
                  />
                  <span
                    className={'advpm' + (ownRate > 0 ? ' advpm-set' : '')}
                    title={
                      ownRate > 0
                        ? `${adLabel(ad, i)} usa preço próprio: ${formatBRL(ownRate)}/min`
                        : 'Valor por minuto SÓ deste AD — vazio usa a tabela'
                    }
                  >
                    <span aria-hidden>R$</span>
                    <input
                      inputMode="decimal"
                      placeholder={vpm > 0 ? valorPorMinuto.trim() : '0,00'}
                      value={ad.vpm ?? ''}
                      onChange={(e) =>
                        priceAd(ad.id, e.target.value.replace(/[^\d.,]/g, '').slice(0, 9))
                      }
                      aria-label={`Valor por minuto de ${adLabel(ad, i)} — vazio usa o valor da tabela`}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </span>
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
                    aria-label={`Remover ${adLabel(ad, i)}`}
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
              {savedPix.length > 0 ? (
                <div>
                  <span
                    className="text-[10.5px] font-bold uppercase tracking-[0.18em] text-text-muted"
                    style={{ fontFamily: 'var(--font-tech)' }}
                  >
                    Chaves salvas
                  </span>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {savedPix.map((e) => {
                      const active =
                        e.key.toLowerCase() === pixKey.trim().toLowerCase();
                      return (
                        <span
                          key={e.id}
                          className={
                            'group inline-flex items-center gap-1.5 rounded-full border py-1 pl-3 pr-1.5 text-[11.5px] transition-all duration-200 ' +
                            (active
                              ? 'border-violet/65 bg-violet/15 text-white'
                              : 'border-line-strong text-text-muted hover:border-violet hover:text-white')
                          }
                        >
                          <button
                            type="button"
                            onClick={() => aplicarChavePix(e)}
                            className="max-w-[180px] truncate"
                            title={e.key}
                          >
                            {e.key}
                          </button>
                          <button
                            type="button"
                            onClick={() => removerChavePix(e.id)}
                            aria-label={`Remover chave ${e.key}`}
                            className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-text-muted/70 transition hover:bg-red-500/20 hover:text-red-300"
                          >
                            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                              <path d="M6 6l12 12M18 6L6 18" />
                            </svg>
                          </button>
                        </span>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              <label className="block">
                <span
                  className="text-[10.5px] font-bold uppercase tracking-[0.18em] text-text-muted"
                  style={{ fontFamily: 'var(--font-tech)' }}
                >
                  Chave PIX
                </span>
                <div className="mt-2 flex gap-2">
                  <input
                    inputMode="text"
                    placeholder="e-mail, telefone, CPF/CNPJ ou aleatória"
                    className="input-field flex-1"
                    value={pixKey}
                    onChange={(e) => setPixKey(e.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    onClick={salvarChavePix}
                    disabled={!pixKey.trim() || pixKeySaved}
                    title={pixKeySaved ? 'Chave já salva' : 'Salvar chave pra reusar'}
                    className="shrink-0 whitespace-nowrap rounded-[12px] border border-line-strong px-3.5 text-[12px] font-bold text-text-muted transition hover:border-violet/55 hover:text-white active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line-strong disabled:hover:text-text-muted"
                    style={{ fontFamily: 'var(--font-tech)' }}
                  >
                    {pixKeySaved ? '✓ Salva' : 'Salvar'}
                  </button>
                </div>
              </label>
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
            subtotal > 0 && min > 0
              ? `${adsPreenchidos} AD${adsPreenchidos === 1 ? '' : 's'} · ${fmtDur(totalSeconds)}${
                  uniformRate !== null
                    ? ` × ${formatBRL(uniformRate)}`
                    : ' · preço por AD'
                }`
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
        /* Rótulo editável do item (AD1, "upsell ME"…) que CRESCE com o texto.
           Truque: inline-grid onde o ::after (cópia invisível do texto via
           data-value) e o input ocupam a MESMA célula — o ::after define a
           largura, o input preenche. Sem JS, cross-browser. */
        .adlabel {
          display: inline-grid;
          align-items: center;
          box-sizing: border-box;
          height: 36px;
          flex: 0 0 auto;
          border: 1px solid rgb(var(--line-strong));
          border-radius: 10px;
          background: rgb(var(--bg-soft) / 0.6);
          transition: border-color 0.18s ease, background-color 0.18s ease;
        }
        .adlabel::after,
        .adlabel input {
          grid-area: 1 / 1 / 2 / 2;
          min-width: 2.5ch;
          max-width: 210px;
          padding: 0 10px;
          font-family: var(--font-tech);
          font-weight: 700;
          font-size: 12px;
          letter-spacing: 0.01em;
          text-align: center;
          white-space: pre;
          overflow: hidden;
        }
        .adlabel::after {
          content: attr(data-value) ' ';
          visibility: hidden;
          height: 0;
        }
        .adlabel input {
          width: 100%;
          height: 100%;
          appearance: none;
          border: 0;
          outline: 0;
          background: transparent;
          color: rgb(var(--text-muted));
          cursor: text;
          text-overflow: ellipsis;
        }
        .adlabel input::placeholder {
          color: rgb(var(--text-muted));
          opacity: 0.7;
        }
        .adlabel:hover {
          border-color: rgb(var(--violet) / 0.4);
        }
        .adlabel:focus-within {
          border-color: rgb(var(--violet) / 0.6);
          background: rgb(var(--violet) / 0.1);
        }
        .adlabel:focus-within input {
          color: #fff;
        }
        /* Preço por minuto PRÓPRIO do AD ("R$ [150]"): compacto, mesma cara do
           input-field. Vazio = herda a tabela (placeholder mostra o valor
           herdado); preenchido ganha borda violeta pra sinalizar o override. */
        .advpm {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          box-sizing: border-box;
          height: 46px;
          flex: 0 0 auto;
          padding: 0 11px;
          border: 1px solid rgb(var(--line-strong));
          border-radius: 14px;
          background: rgb(var(--bg-soft) / 0.6);
          box-shadow:
            0 1px 0 rgba(255, 255, 255, 0.03) inset,
            0 2px 6px -4px rgba(0, 0, 0, 0.6);
          transition: border-color 0.18s ease, background-color 0.18s ease;
        }
        .advpm > span {
          font-family: var(--font-mono);
          font-size: 10.5px;
          font-weight: 700;
          color: rgb(var(--text-muted));
        }
        .advpm input {
          width: 5.5ch;
          appearance: none;
          border: 0;
          outline: 0;
          background: transparent;
          font-family: var(--font-mono);
          font-size: 13px;
          color: #fff;
          text-align: right;
        }
        .advpm input::placeholder {
          color: rgb(var(--text-dim));
        }
        .advpm:hover {
          border-color: rgb(var(--violet) / 0.4);
        }
        .advpm:focus-within {
          border-color: rgb(var(--violet) / 0.6);
          background: rgb(var(--violet) / 0.08);
        }
        .advpm-set {
          border-color: rgb(var(--violet) / 0.45);
        }
        .advpm-set > span {
          color: rgb(var(--violet));
        }
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
