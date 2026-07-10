'use client';

import { useEffect, useRef, useState } from 'react';
import { ToolShell } from '@/components/ToolShell';
import { useToolState } from '@/components/ToolsStateProvider';
import { logHistory } from '@/lib/history';
import {
  uiFont,
  downloadNodeAsPng,
  Segmented,
  Toggle,
  RangeField,
  TextField,
  Field,
  defaultStatus,
  type StatusCfg,
} from './shared';
import { MODELS, CATEGORIES } from './models';
import { BrandMark, brandForModel } from './brand-logos';

const HUE = 'rgba(167,139,250,0.42)';

// Categorias agrupadas em seções (organização premium do seletor).
const SECTIONS: { label: string; ids: string[] }[] = [
  { label: 'Redes sociais', ids: ['story', 'chat', 'post', 'notif'] },
  { label: 'Notícias & TV', ids: ['news', 'sites'] },
];

function CatIcon({ id }: { id: string }) {
  const p = { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (id) {
    case 'story':
      return (<svg {...p}><rect x="4" y="3" width="16" height="18" rx="3" /><circle cx="12" cy="10" r="3" /><path d="M8 17h8" /></svg>);
    case 'chat':
      return (<svg {...p}><path d="M21 12a8 8 0 0 1-11.5 7.2L4 21l1.8-5.5A8 8 0 1 1 21 12z" /></svg>);
    case 'post':
      return (<svg {...p}><rect x="3" y="3" width="18" height="18" rx="3" /><path d="M3 15l4-4 5 5" /><circle cx="15" cy="9" r="1.4" /></svg>);
    case 'notif':
      return (<svg {...p}><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></svg>);
    case 'news':
      return (<svg {...p}><rect x="2.5" y="7" width="19" height="13" rx="2" /><path d="M8 7l4-4 4 4" /></svg>);
    case 'sites':
      return (<svg {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 8h18" /><circle cx="6" cy="6" r="0.6" fill="currentColor" /><circle cx="8.4" cy="6" r="0.6" fill="currentColor" /></svg>);
    default:
      return null;
  }
}

export default function FakePassPage() {
  const [modelId, setModelId] = useToolState<string>('fakepass:model', MODELS[0].id);
  const [cat, setCat] = useToolState<string>('fakepass:cat', 'story');
  const [status, setStatus] = useState<StatusCfg>(defaultStatus);
  // Estado de cada modelo, isolado por id (trocar de modelo não perde o que
  // você digitou no anterior).
  const [states, setStates] = useState<Record<string, any>>(() =>
    Object.fromEntries(MODELS.map((m) => [m.id, m.defaultState])),
  );
  const [gerando, setGerando] = useState(false);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const previewBoxRef = useRef<HTMLDivElement | null>(null);
  const [pscale, setPscale] = useState(1);

  const model = MODELS.find((m) => m.id === modelId) ?? MODELS[0];
  const s = states[model.id];
  const set = (patch: any) =>
    setStates((prev) => ({ ...prev, [model.id]: { ...prev[model.id], ...patch } }));
  const setStatusCfg = (patch: Partial<StatusCfg>) => setStatus((p) => ({ ...p, ...patch }));

  // Dimensões efetivas do palco: dinâmicas (dims(s), ex.: orientação 16:9↔9:16)
  // ou as fixas do modelo. O shell usa ISTO pra escalar e exportar.
  const dims = model.dims ? model.dims(s) : { stageW: model.stageW, ratio: model.ratio, exportW: model.exportW };

  const modelsInCat = MODELS.filter((m) => m.category === cat);

  // Auto-scale da prévia: se o palco for mais largo que a área disponível,
  // encolhe VISUALMENTE pra caber. O PNG continua em alta porque o export usa
  // dims.stageW como referência, não o tamanho escalado.
  useEffect(() => {
    const box = previewBoxRef.current;
    if (!box) return;
    const compute = () => {
      const avail = box.clientWidth;
      setPscale(avail > 0 ? Math.min(1, avail / dims.stageW) : 1);
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(box);
    return () => ro.disconnect();
  }, [dims.stageW, model.id]);

  const baixar = async () => {
    const node = stageRef.current;
    if (!node || gerando) return;
    setGerando(true);
    try {
      await downloadNodeAsPng(node, `fakepass-${model.id}.png`, dims.exportW, dims.stageW);
      logHistory({ tool: 'fakepass', kind: 'export', title: `Print ${model.id} exportado` });
    } catch (err) {
      console.error('[fakepass] export falhou', err);
      alert('Não consegui gerar a imagem agora. Tenta de novo em instantes.');
    } finally {
      setGerando(false);
    }
  };

  return (
    <ToolShell
      title="FakePrint"
      eyebrow="GERADOR DE PRINTS"
      description="Crie prints e stickers de redes sociais idênticos ao original — caixinha de pergunta, enquete, conversa, post e mais. Personaliza e baixa em alta."
      hue={HUE}
      icon={<IconFakePass size={56} />}
    >
      {/* ─── Seletor: seções de categoria + grade de cards ─── */}
      <div className="mb-7 flex flex-col gap-4">
        {/* categorias agrupadas em seções */}
        <div className="flex flex-col gap-2.5">
          {SECTIONS.map((sec) => (
            <div key={sec.label} className="flex flex-wrap items-center gap-2">
              <span className="mr-1 text-[9.5px] font-bold uppercase tracking-[0.2em] text-text-dim" style={{ fontFamily: 'var(--font-tech)' }}>
                {sec.label}
              </span>
              {CATEGORIES.filter((c) => sec.ids.includes(c.id)).map((c) => {
                const count = MODELS.filter((m) => m.category === c.id).length;
                const active = c.id === cat;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setCat(c.id)}
                    className={
                      'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] font-semibold transition-all duration-200 ' +
                      (active
                        ? 'border-violet/60 bg-gradient-to-b from-violet/25 to-violet/10 text-white shadow-[0_0_18px_-8px_rgba(167,139,250,0.9)]'
                        : 'border-line-strong/70 text-text-muted hover:border-violet/50 hover:text-white')
                    }
                  >
                    <CatIcon id={c.id} />
                    {c.label}
                    <span className={'ml-0.5 rounded-full px-1.5 py-px text-[10px] font-bold ' + (active ? 'bg-white/15 text-white' : 'bg-white/[0.05] text-text-dim')}>{count}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* grade de modelos (cards premium) */}
        {modelsInCat.length === 0 ? (
          <p className="text-[13px] text-text-dim">Em breve nesta categoria. 🚧</p>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
            {modelsInCat.map((m) => {
              const active = m.id === modelId;
              const primary = m.group ?? m.label;
              const secondary = m.group ? m.label : '';
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setModelId(m.id)}
                  className={
                    'group flex items-center gap-2.5 rounded-[13px] border p-2.5 text-left transition-all duration-200 active:scale-[0.98] ' +
                    (active
                      ? 'border-violet/70 bg-violet/12 shadow-[0_0_22px_-9px_rgba(167,139,250,0.9)]'
                      : 'border-line-strong/60 bg-bg-soft/20 hover:border-violet/45 hover:bg-bg-soft/40')
                  }
                >
                  <BrandMark brand={brandForModel(m)} size={26} />
                  <span className="flex min-w-0 flex-col">
                    <span className={'truncate text-[13px] font-semibold leading-tight ' + (active ? 'text-white' : 'text-text-muted group-hover:text-white')}>
                      {primary}
                    </span>
                    {secondary ? <span className="truncate text-[10.5px] leading-tight text-text-dim">{secondary}</span> : null}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ─── Controles + Preview ─── */}
      <div className={'grid grid-cols-1 gap-6 ' + (dims.ratio < 1 ? 'lg:grid-cols-[1fr_560px]' : 'lg:grid-cols-[1fr_360px]')}>
        <div className="flex flex-col gap-5">
          {model.Controls({ s, set })}

          {model.usesPhone ? (
            <div className="rounded-[16px] border border-line/60 bg-bg-soft/30 p-4">
              <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.16em] text-text-muted" style={{ fontFamily: 'var(--font-tech)' }}>
                Barra de status do celular
              </p>
              <div className="flex flex-col gap-3.5">
                <Segmented
                  value={status.os}
                  options={[{ value: 'ios', label: 'iPhone' }, { value: 'android', label: 'Android' }]}
                  onChange={(v) => setStatusCfg({ os: v })}
                />
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Hora">
                    <TextField value={status.time} onChange={(v) => setStatusCfg({ time: v })} placeholder="9:41" maxLength={8} />
                  </Field>
                  <Field label="Operadora">
                    <TextField value={status.carrier} onChange={(v) => setStatusCfg({ carrier: v })} placeholder="Vivo" maxLength={16} />
                  </Field>
                </div>
                <RangeField label="Bateria" value={status.battery} min={0} max={100} onChange={(v) => setStatusCfg({ battery: v })} display={(v) => v + '%'} />
                <RangeField label="Sinal" value={status.signal} min={0} max={4} onChange={(v) => setStatusCfg({ signal: v })} />
                <Segmented
                  value={status.network}
                  options={[{ value: '5G', label: '5G' }, { value: '4G', label: '4G' }, { value: 'LTE', label: 'LTE' }, { value: '', label: '—' }]}
                  onChange={(v) => setStatusCfg({ network: v })}
                />
                <div className="grid grid-cols-2 gap-2">
                  <Toggle on={status.wifi} onChange={(v) => setStatusCfg({ wifi: v })} label="Wi-Fi" />
                  <Toggle on={status.charging} onChange={(v) => setStatusCfg({ charging: v })} label="Carregando" />
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {/* Preview + export */}
        <div className="lg:sticky lg:top-6 lg:self-start">
          <div className="rounded-[20px] border border-line/60 bg-bg-soft/40 p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-text-muted" style={{ fontFamily: 'var(--font-tech)' }}>
                Prévia
              </span>
              <span className="text-[11px] text-text-dim" style={{ fontFamily: 'var(--font-mono)' }}>
                {dims.exportW}×{Math.round(dims.exportW * dims.ratio)}
              </span>
            </div>

            <div ref={previewBoxRef} className="flex justify-center overflow-hidden">
              {/* zoom (não transform:scale) reflui o palco no tamanho reduzido
                  com texto/vetores NÍTIDOS — sem a rasterização borrada do
                  scale. No export, downloadNodeAsPng zera este zoom pela marca
                  data-fp-zoom, então o PNG sai em alta e imune ao encolhimento. */}
              <div data-fp-zoom style={{ zoom: pscale }}>
                {/* `line-height: 0` no palco tira o vão do descender do inline-block
                    E — crucial — faz o texto SEM line-height próprio ter altura de
                    linha 0 IGUAL no navegador e no html2canvas (o `normal` os dois
                    renderiam com altura DIFERENTE → drift vertical que acumula no
                    download). Cada texto que precisa de altura (barra de status,
                    bolhas multi-linha) seta o SEU line-height. */}
                <div ref={stageRef} className={uiFont.variable} style={{ display: 'inline-block', lineHeight: 0 }}>
                  {model.Preview({ s, status })}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={baixar}
              disabled={gerando}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-[14px] border border-white/15 px-5 py-3.5 text-[14px] font-bold text-white transition-all duration-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
              style={{
                fontFamily: 'var(--font-tech)',
                background: 'linear-gradient(180deg,#a78bfa 0%,#6d4ee8 100%)',
                boxShadow: '0 8px 22px -8px rgba(167,139,250,0.7), inset 0 1px 0 rgba(255,255,255,0.3)',
              }}
            >
              {gerando ? (
                <>
                  <svg className="animate-spin" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 3a9 9 0 1 0 9 9" /></svg>
                  Gerando…
                </>
              ) : (
                <>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5" /><path d="M12 15V3" /></svg>
                  Baixar PNG
                </>
              )}
            </button>
            <p className="mt-2 text-center text-[11px] text-text-muted">
              Imagem em alta ({model.exportW}px) — pronta pra postar.
            </p>
          </div>
        </div>
      </div>
    </ToolShell>
  );
}

function IconFakePass({ size = 56 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <defs>
        <linearGradient id="fp-hero" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#c4b5fd" />
          <stop offset="100%" stopColor="#6d4ee8" />
        </linearGradient>
      </defs>
      <rect x="6" y="2.5" width="12" height="19" rx="2.6" stroke="url(#fp-hero)" strokeWidth="1.7" />
      <path d="M9 6h6" stroke="url(#fp-hero)" strokeWidth="1.6" strokeLinecap="round" />
      <rect x="8.4" y="9" width="7.2" height="4.4" rx="1.2" fill="url(#fp-hero)" opacity="0.9" />
      <path d="M9 16h6M9 18h3.5" stroke="url(#fp-hero)" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
    </svg>
  );
}
