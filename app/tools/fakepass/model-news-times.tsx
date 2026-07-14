'use client';

/**
 * FakePass — NOTÍCIAS · TIMES BRASIL (licenciada CNBC).
 * Chyron de 3 faixas:
 *  (1) tag "BREAKING NEWS" dividida em duas cores (vermelho + navy) à esquerda;
 *  (2) faixa NAVY com a manchete BRANCA bold (FitText, pode ser citação entre
 *      aspas) + sub-linha menor; canto inf. esquerdo "TIMES BRASIL" + data/hora;
 *      canto inf. direito pavão CNBC + "CNBC" + caixinha "● LIVE" vermelha;
 *  (3) ticker estilo cripto (verde) com itens tipo "Bitcoin 117633.00  0.00%".
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
  type NewsBg,
} from './news-kit';

const NAVY = '#0a1a3c';
const RED = '#c8102e';
const TICKER_GREEN = '#16c784';

type S = NewsBg & {
  tag: string;
  headline: string;
  sub: string;
  brand: string;
  date: string;
  time: string;
  live: string;
  ticker: string;
};

/** Pavão CNBC aproximado em vetor (leque de pétalas coloridas). */
function PeacockLogo({ k }: { k: number }) {
  const petals = [
    { rot: -75, fill: '#f0641e' },
    { rot: -50, fill: '#f5a623' },
    { rot: -25, fill: '#f6e500' },
    { rot: 0, fill: '#6dbe45' },
    { rot: 25, fill: '#00a0d8' },
    { rot: 50, fill: '#7b4b9c' },
    { rot: 75, fill: '#e5007e' },
  ];
  const size = 20 * k;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ display: 'block', flexShrink: 0 }} aria-hidden>
      <g transform="translate(50,58)">
        {petals.map((p, i) => (
          <ellipse key={i} cx={0} cy={-30} rx={9} ry={26} fill={p.fill} transform={`rotate(${p.rot})`} />
        ))}
        <circle cx={0} cy={0} r={9} fill="#fff" />
      </g>
    </svg>
  );
}

function TimesChyron({ s }: { s: S }) {
  const { k } = stageMetrics(s.orient);
  const items = parseItems(s.ticker);
  return (
    <>
      {/* Chyron inferior */}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, width: '100%' }}>
        {/* faixa 1: tag BREAKING NEWS bicolor */}
        {s.tag.trim() ? (
          <div style={{ display: 'flex', alignItems: 'stretch', height: 26 * k, paddingLeft: 8 * k }}>
            <div style={{ display: 'flex', alignItems: 'center', background: RED, color: '#fff', fontWeight: 900, fontSize: 13 * k, letterSpacing: 0.4 * k, padding: `0 ${10 * k}px`, textTransform: 'uppercase' }}>
              {s.tag.trim().split(/\s+/)[0]}
            </div>
            {s.tag.trim().split(/\s+/).slice(1).length ? (
              <div style={{ display: 'flex', alignItems: 'center', background: NAVY, color: '#fff', fontWeight: 900, fontSize: 13 * k, letterSpacing: 0.4 * k, padding: `0 ${10 * k}px`, textTransform: 'uppercase' }}>
                {s.tag.trim().split(/\s+/).slice(1).join(' ')}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* faixa 2: manchete navy */}
        <div style={{ background: NAVY, padding: `${8 * k}px ${12 * k}px ${9 * k}px` }}>
          <FitText
            maxPx={25 * k}
            minPx={13 * k}
            maxHeight={64 * k}
            style={{ color: '#ffffff', fontWeight: 800, lineHeight: 1.08, textTransform: 'uppercase', letterSpacing: -0.2 * k }}
          >
            {s.headline}
          </FitText>
          {s.sub.trim() ? (
            <div style={{ color: 'rgba(255,255,255,0.82)', fontWeight: 600, fontSize: 12.5 * k, letterSpacing: 0.2 * k, marginTop: 5 * k, lineHeight: 1.2 }}>
              {s.sub}
            </div>
          ) : null}
        </div>

        {/* faixa 2b: rodapé de marca (brand + data/hora à esquerda, CNBC + LIVE à direita) */}
        {(s.brand.trim() || s.date.trim() || s.time.trim() || s.live.trim()) ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 24 * k, background: '#06132e', padding: `0 ${12 * k}px`, borderTop: `${1 * k}px solid rgba(255,255,255,0.12)` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 * k, minWidth: 0 }}>
              {s.brand.trim() ? (
                <span style={{ color: '#fff', fontWeight: 900, fontSize: 12 * k, letterSpacing: 0.6 * k, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{s.brand}</span>
              ) : null}
              {(s.date.trim() || s.time.trim()) ? (
                <span data-fp-anim="clock" style={{ color: 'rgba(255,255,255,0.7)', fontWeight: 700, fontSize: 11 * k, letterSpacing: 0.3 * k, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                  {[s.date.trim(), s.time.trim()].filter(Boolean).join('  ·  ')}
                </span>
              ) : null}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 * k, flexShrink: 0 }}>
              <PeacockLogo k={k} />
              <span style={{ color: '#fff', fontWeight: 800, fontSize: 12 * k, letterSpacing: 0.5 * k }}>CNBC</span>
              {s.live.trim() ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 * k, background: RED, color: '#fff', fontWeight: 800, fontSize: 10.5 * k, letterSpacing: 0.6 * k, padding: `${3 * k}px ${7 * k}px`, textTransform: 'uppercase' }}>
                  <span data-fp-anim="livedot" style={{ width: 6 * k, height: 6 * k, borderRadius: '50%', background: '#fff', display: 'inline-block' }} />
                  {s.live}
                </span>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* faixa 3: ticker cripto (verde) */}
        {items.length ? (
          <div data-fp-anim="ticker" style={{ display: 'flex', alignItems: 'center', gap: 0, height: 26 * k, background: '#050b1c', padding: `0 ${12 * k}px`, fontSize: 12 * k, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden' }}>
            {items.map((it, i) => (
              <span key={i} style={{ display: 'inline-flex', alignItems: 'center' }}>
                {i > 0 ? <span style={{ color: 'rgba(255,255,255,0.22)', margin: `0 ${12 * k}px` }}>|</span> : null}
                <span style={{ color: TICKER_GREEN, fontVariantNumeric: 'tabular-nums' }}>{it}</span>
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </>
  );
}

const TIMES: FakeModel<S> = {
  id: 'news-times',
  label: 'Breaking / Lower-third',
  category: 'news',
  group: 'Times Brasil',
  hue: 'rgba(10,26,60,0.45)',
  stageW: 640,
  ratio: 9 / 16,
  exportW: 1920,
  usesPhone: false,
  // tem relógio/ticker/bolinha AO VIVO animáveis → shell mostra 'Exportar vídeo'
  anim: true,
  dims: (s) => newsDims(s.orient),
  defaultState: {
    ...defaultNewsBg,
    bgColor: NAVY,
    tag: 'BREAKING NEWS',
    headline: '"ECONOMIA REGIONAL SENTE OS EFEITOS DA NOVA TARIFA"',
    sub: 'Analistas projetam impacto no varejo e no câmbio nas próximas semanas',
    brand: 'TIMES BRASIL',
    date: '12 JUL',
    time: '15:18',
    live: 'LIVE',
    ticker: 'Bitcoin 117633.00  0.00% | Ethereum 3542.10  +0.42% | Ibovespa 132540  -0.18% | Dólar 5.42  +0.31%',
  },
  Controls: ({ s, set }) => (
    <div className="flex flex-col gap-4">
      <NewsBgControls bg={s} set={set} />
      <Field label="Tag (bicolor — 1ª palavra vermelha, resto navy)"><TextField value={s.tag} onChange={(v) => set({ tag: v })} placeholder="BREAKING NEWS" maxLength={30} /></Field>
      <Field label="Manchete (pode ser citação entre aspas)"><TextArea value={s.headline} onChange={(v) => set({ headline: v })} placeholder="Manchete principal" rows={2} maxLength={160} /></Field>
      <Field label="Sub-linha"><TextField value={s.sub} onChange={(v) => set({ sub: v })} placeholder="Linha de apoio menor" maxLength={90} /></Field>
      <Field label="Marca (canto)"><TextField value={s.brand} onChange={(v) => set({ brand: v })} placeholder="TIMES BRASIL" maxLength={24} /></Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Data"><TextField value={s.date} onChange={(v) => set({ date: v })} placeholder="12 JUL" maxLength={12} /></Field>
        <Field label="Hora"><TextField value={s.time} onChange={(v) => set({ time: v })} placeholder="15:18" maxLength={12} /></Field>
        <Field label="LIVE"><TextField value={s.live} onChange={(v) => set({ live: v })} placeholder="LIVE" maxLength={10} /></Field>
      </div>
      <Field label="Ticker cripto (um por linha ou separado por |)"><TextArea value={s.ticker} onChange={(v) => set({ ticker: v })} placeholder="Bitcoin 117633.00  0.00% | Ethereum 3542.10  +0.42%" rows={3} maxLength={260} /></Field>
    </div>
  ),
  Preview: ({ s }) => (
    <NewsStage bg={s}>
      <TimesChyron s={s} />
    </NewsStage>
  ),
};

export default [TIMES];
