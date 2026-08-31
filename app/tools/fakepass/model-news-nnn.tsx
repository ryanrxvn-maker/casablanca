'use client';

/**
 * FakePass — NOTÍCIAS · NNN (emissora fictícia genérica).
 * Canto superior esquerdo: caixa NAVY "NNN / NEWS LIVE" + caixinha vermelha "● LIVE".
 * Chyron de 4 faixas no rodapé:
 *   (1) tag VERMELHA "BREAKING";
 *   (2) faixa BRANCA com a manchete PRETA bold uppercase (FitText);
 *   (3) faixa VERMELHA com a sub-manchete branca (ex.: ordens de evacuação);
 *   (4) ticker PRETO com hora+data à esquerda + itens.
 * Recria o GRÁFICO do telejornal; todo texto é editável (placeholder fake).
 */

import { Field, TextField, TextArea, FitText, type FakeModel } from './shared';
import { LineBuilder } from './builder';
import {
  NewsStage,
  NewsBgControls,
  newsDims,
  stageMetrics,
  parseItems,
  defaultNewsBg,
  type NewsBg,
} from './news-kit';

type S = NewsBg & {
  tag: string;
  headline: string;
  sub: string;
  live: string;
  time: string;
  date: string;
  ticker: string;
};

const NAVY = '#12294d';
const RED = '#c8102e';

function NnnBug({ s, k }: { s: S; k: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', gap: 6 * k, flexShrink: 0 }}>
      {/* Caixa navy: NNN grande + NEWS LIVE */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 7 * k,
          background: NAVY,
          padding: `${6 * k}px ${10 * k}px`,
          borderRadius: 2 * k,
        }}
      >
        <span
          style={{
            color: '#fff',
            fontWeight: 900,
            fontSize: 24 * k,
            letterSpacing: 1 * k,
            lineHeight: 1,
          }}
        >
          NNN
        </span>
        <span
          style={{
            color: 'rgba(255,255,255,0.85)',
            fontWeight: 700,
            fontSize: 9 * k,
            letterSpacing: 1.5 * k,
            lineHeight: 1.1,
            textTransform: 'uppercase',
          }}
        >
          News
          <br />
          Live
        </span>
      </div>

      {/* Caixinha vermelha ● LIVE */}
      {s.live.trim() ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5 * k,
            background: RED,
            padding: `0 ${9 * k}px`,
            borderRadius: 2 * k,
          }}
        >
          <span data-fp-anim="livedot" style={{ width: 7 * k, height: 7 * k, borderRadius: '50%', background: '#fff', display: 'inline-block' }} />
          <span style={{ color: '#fff', fontWeight: 800, fontSize: 12 * k, letterSpacing: 0.8 * k }}>{s.live}</span>
        </div>
      ) : null}
    </div>
  );
}

function NnnChyron({ s }: { s: S }) {
  const { k } = stageMetrics(s.orient);
  const items = parseItems(s.ticker);
  return (
    <>
      {/* Bug NNN / NEWS LIVE + LIVE no canto superior esquerdo */}
      <div style={{ position: 'absolute', top: 12 * k, left: 12 * k }}>
        <NnnBug s={s} k={k} />
      </div>

      {/* Chyron inferior */}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, width: '100%' }}>
        {/* faixa 1: tag vermelha BREAKING */}
        {s.tag.trim() ? (
          <div style={{ display: 'flex', paddingLeft: 12 * k }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                background: RED,
                color: '#fff',
                fontWeight: 900,
                fontSize: 13 * k,
                letterSpacing: 1.2 * k,
                padding: `${4 * k}px ${12 * k}px`,
                textTransform: 'uppercase',
              }}
            >
              {s.tag}
            </div>
          </div>
        ) : null}

        {/* faixa 2: manchete branca / preto bold */}
        <div style={{ display: 'flex', alignItems: 'center', background: '#ffffff', minHeight: 50 * k, padding: `${8 * k}px ${14 * k}px` }}>
          <FitText
            maxPx={26 * k}
            minPx={13 * k}
            maxHeight={44 * k}
            style={{ color: '#0a0a0a', fontWeight: 900, lineHeight: 1.04, textTransform: 'uppercase', letterSpacing: -0.3 * k }}
          >
            {s.headline}
          </FitText>
        </div>

        {/* faixa 3: sub-manchete vermelha / branco */}
        {s.sub.trim() ? (
          <div style={{ display: 'flex', alignItems: 'center', background: RED, minHeight: 28 * k, padding: `${5 * k}px ${14 * k}px` }}>
            <span style={{ color: '#fff', fontWeight: 700, fontSize: 14 * k, lineHeight: 1.15, letterSpacing: 0.2 * k }}>{s.sub}</span>
          </div>
        ) : null}

        {/* faixa 4: ticker preto com hora+data à esquerda + itens */}
        <div style={{ display: 'flex', alignItems: 'stretch', height: 28 * k, background: '#0a0a0a', color: '#fff', overflow: 'hidden' }}>
          {(s.time.trim() || s.date.trim()) ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6 * k,
                background: NAVY,
                padding: `0 ${12 * k}px`,
                fontWeight: 800,
                fontSize: 12 * k,
                letterSpacing: 0.4 * k,
                whiteSpace: 'nowrap',
                /* tabular-nums REMOVIDO: h2c posiciona segmentos com métrica tabular do DOM mas desenha proporcional → vão no meio do texto (11 :20) */
                textTransform: 'uppercase',
              }}
            >
              {s.time.trim() ? <span data-fp-anim="clock">{s.time}</span> : null}
              {s.time.trim() && s.date.trim() ? <span style={{ color: 'rgba(255,255,255,0.5)' }}>/</span> : null}
              {s.date.trim() ? <span>{s.date}</span> : null}
            </div>
          ) : null}
          {items.length ? (
            <div data-fp-anim="ticker" style={{ display: 'flex', alignItems: 'center', gap: 8 * k, padding: `0 ${12 * k}px`, fontSize: 12 * k, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', flex: 1 }}>
              {items.map((it, i) => (
                <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 * k }}>
                  {i > 0 ? <span style={{ color: RED, fontWeight: 900 }}>▪</span> : null}
                  <span>{it}</span>
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}

const NNN: FakeModel<S> = {
  id: 'news-nnn',
  label: 'Breaking / Lower-third',
  category: 'news',
  group: 'NNN',
  hue: 'rgba(18,41,77,0.4)',
  stageW: 640,
  ratio: 9 / 16,
  exportW: 1920,
  usesPhone: false,
  // tem relógio/ticker/bolinha AO VIVO animáveis → shell mostra 'Exportar vídeo'
  anim: true,
  dims: (s) => newsDims(s.orient),
  defaultState: {
    ...defaultNewsBg,
    tag: 'BREAKING',
    headline: 'NATURAL DISASTER PROMPTS EMERGENCY RESPONSE',
    sub: 'Evacuation orders issued as authorities urge residents to leave the area',
    live: 'LIVE',
    time: '8:02 AM PT',
    date: 'MAY 18, 2025',
    ticker: 'Rescue crews deployed to affected regions | Shelters open for displaced families',
  },
  Controls: ({ s, set }) => (
    <div className="flex flex-col gap-4">
      <NewsBgControls bg={s} set={set} />
      <Field label="Tag (faixa vermelha)"><TextField value={s.tag} onChange={(v) => set({ tag: v })} placeholder="BREAKING" maxLength={24} /></Field>
      <Field label="Manchete"><TextArea value={s.headline} onChange={(v) => set({ headline: v })} placeholder="Manchete principal" rows={2} maxLength={140} /></Field>
      <Field label="Sub-manchete (faixa vermelha)"><TextArea value={s.sub} onChange={(v) => set({ sub: v })} placeholder="Ordens de evacuação…" rows={2} maxLength={140} /></Field>
      <Field label="LIVE (canto)"><TextField value={s.live} onChange={(v) => set({ live: v })} placeholder="LIVE" maxLength={12} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Hora (ticker)"><TextField value={s.time} onChange={(v) => set({ time: v })} placeholder="8:02 AM PT" maxLength={16} /></Field>
        <Field label="Data (ticker)"><TextField value={s.date} onChange={(v) => set({ date: v })} placeholder="MAY 18, 2025" maxLength={20} /></Field>
      </div>
      <Field label="Ticker" hint="Um card por item — botão + pra adicionar, setas pra ordenar.">
        <LineBuilder value={s.ticker} onChange={(v) => set({ ticker: v })} placeholder="Notícia 1" addLabel="Item" pipe />
      </Field>
    </div>
  ),
  Preview: ({ s }) => (
    <NewsStage bg={s}>
      <NnnChyron s={s} />
    </NewsStage>
  ),
};

export default [NNN];
