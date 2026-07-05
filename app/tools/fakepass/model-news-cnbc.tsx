'use client';

/**
 * FakePass — NOTÍCIAS · CNBC (EUA, mercado/finanças).
 * Chyron: (1) caixa AZUL (#0033a0) com o rótulo do programa branco bold,
 * (2) faixa BRANCA com a manchete NAVY bold UPPERCASE (FitText) + logo CNBC
 * (pavão colorido + "CNBC" navy) no canto, (3) ticker escuro com cotações.
 * Recria o GRÁFICO do telejornal; todo texto é editável (placeholder fake).
 */

import { Field, TextField, TextArea, FitText, type FakeModel } from './shared';
import {
  NewsStage,
  NewsBgControls,
  newsDims,
  stageMetrics,
  parseItems,
  defaultNewsBg,
  LiveTag,
  type NewsBg,
} from './news-kit';

type S = NewsBg & {
  showLabel: string;
  headline: string;
  live: string;
  ticker: string;
};

const CNBC_NAVY = '#10233f';
const CNBC_BLUE = '#0033a0';

/** Logo CNBC aproximado: pavão em vetor (cores certas) + "CNBC" navy bold. */
function CnbcLogo({ k }: { k: number }) {
  // Leque do pavão NBC: 6 penas com as cores oficiais.
  const feathers = ['#f7c800', '#e77817', '#cc0000', '#a1258f', '#0089d0', '#6ab023'];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 * k, flexShrink: 0 }}>
      <svg width={20 * k} height={20 * k} viewBox="0 0 100 100" style={{ display: 'block' }} aria-hidden>
        {feathers.map((c, i) => {
          // 6 pétalas radiais partindo do centro-baixo, abrindo em leque.
          const a0 = -140 + i * 45;
          const a1 = a0 + 40;
          const cx = 50;
          const cy = 55;
          const r = 46;
          const p0x = cx + r * Math.cos((a0 * Math.PI) / 180);
          const p0y = cy + r * Math.sin((a0 * Math.PI) / 180);
          const p1x = cx + r * Math.cos((a1 * Math.PI) / 180);
          const p1y = cy + r * Math.sin((a1 * Math.PI) / 180);
          return (
            <path
              key={i}
              d={`M${cx} ${cy} L${p0x.toFixed(1)} ${p0y.toFixed(1)} A${r} ${r} 0 0 1 ${p1x.toFixed(1)} ${p1y.toFixed(1)} Z`}
              fill={c}
            />
          );
        })}
        <circle cx="50" cy="55" r="10" fill="#fff" />
      </svg>
      <span style={{ color: CNBC_NAVY, fontWeight: 900, fontSize: 17 * k, letterSpacing: -0.6 * k, lineHeight: 1 }}>CNBC</span>
    </div>
  );
}

function CnbcChyron({ s }: { s: S }) {
  const { k } = stageMetrics(s.orient);
  const items = parseItems(s.ticker);
  return (
    <>
      {/* Chyron inferior */}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, width: '100%' }}>
        {/* faixa 1: caixa azul do programa + LIVE opcional */}
        {(s.showLabel.trim() || s.live.trim()) ? (
          <div style={{ display: 'flex', alignItems: 'stretch', height: 26 * k, paddingLeft: 8 * k }}>
            {s.showLabel.trim() ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  background: CNBC_BLUE,
                  color: '#fff',
                  fontWeight: 800,
                  fontSize: 13 * k,
                  letterSpacing: 0.4 * k,
                  padding: `0 ${12 * k}px`,
                  textTransform: 'uppercase',
                }}
              >
                {s.showLabel}
              </div>
            ) : null}
            {s.live.trim() ? (
              <LiveTag text={s.live} bg="#cc0000" k={k} style={{ alignSelf: 'stretch', fontSize: 12 * k }} />
            ) : null}
          </div>
        ) : null}

        {/* faixa 2: manchete branca navy + logo CNBC */}
        <div style={{ display: 'flex', alignItems: 'stretch', background: '#ffffff', minHeight: 48 * k, borderTop: `${3 * k}px solid ${CNBC_BLUE}` }}>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', padding: `${6 * k}px ${12 * k}px` }}>
            <FitText
              maxPx={23 * k}
              minPx={12 * k}
              maxHeight={40 * k}
              style={{ color: CNBC_NAVY, fontWeight: 800, lineHeight: 1.05, textTransform: 'uppercase', letterSpacing: -0.2 * k }}
            >
              {s.headline}
            </FitText>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: `0 ${12 * k}px`, borderLeft: `${1 * k}px solid #e2e2e2` }}>
            <CnbcLogo k={k} />
          </div>
        </div>

        {/* faixa 3: ticker escuro com cotações */}
        {items.length ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 * k, height: 26 * k, background: CNBC_NAVY, color: '#fff', padding: `0 ${12 * k}px`, fontSize: 12 * k, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', fontVariantNumeric: 'tabular-nums' }}>
            {items.map((it, i) => (
              <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 * k }}>
                {i > 0 ? <span style={{ color: 'rgba(255,255,255,0.35)', fontWeight: 900 }}>|</span> : null}
                <span>{it}</span>
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </>
  );
}

const CNBC: FakeModel<S> = {
  id: 'news-cnbc',
  label: 'Markets / Lower-third',
  category: 'news',
  group: 'CNBC',
  hue: 'rgba(0,51,160,0.4)',
  stageW: 640,
  ratio: 9 / 16,
  exportW: 1920,
  usesPhone: false,
  dims: (s) => newsDims(s.orient),
  defaultState: {
    ...defaultNewsBg,
    showLabel: 'SQUAWK BOX',
    headline: 'Markets react to latest economic data',
    live: 'LIVE',
    ticker: 'DOW +312.44 | NASDAQ +1.28% | S&P 500 +0.94% | GOLD 2,041.30',
  },
  Controls: ({ s, set }) => (
    <div className="flex flex-col gap-4">
      <NewsBgControls bg={s} set={set} />
      <Field label="Programa (caixa azul)"><TextField value={s.showLabel} onChange={(v) => set({ showLabel: v })} placeholder="SQUAWK BOX" maxLength={40} /></Field>
      <Field label="Manchete"><TextArea value={s.headline} onChange={(v) => set({ headline: v })} placeholder="MARKETS REACT TO LATEST ECONOMIC DATA" rows={2} maxLength={140} /></Field>
      <Field label="LIVE"><TextField value={s.live} onChange={(v) => set({ live: v })} placeholder="LIVE" maxLength={12} /></Field>
      <Field label="Ticker (um por linha ou separado por |)"><TextArea value={s.ticker} onChange={(v) => set({ ticker: v })} placeholder="DOW +312.44 | NASDAQ +1.28%" rows={2} maxLength={200} /></Field>
    </div>
  ),
  Preview: ({ s }) => (
    <NewsStage bg={s}>
      <CnbcChyron s={s} />
    </NewsStage>
  ),
};

export default [CNBC];
