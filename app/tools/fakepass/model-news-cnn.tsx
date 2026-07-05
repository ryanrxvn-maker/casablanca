'use client';

/**
 * FakePass — NOTÍCIAS · CNN (EUA).
 * Chyron de 3 faixas: (1) tag vermelha do assunto + caixa cinza do programa,
 * (2) faixa branca com a manchete preta + bloco vermelho "CNN / LIVE",
 * (3) ticker preto. Rótulo de local/hora no canto superior direito.
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

type S = NewsBg & {
  kicker: string;
  show: string;
  headline: string;
  live: string;
  time: string;
  location: string;
  ticker: string;
};

function CnnLogo({ k }: { k: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 * k, flexShrink: 0 }}>
      <div
        style={{
          background: '#cc0000',
          color: '#fff',
          fontWeight: 800,
          fontSize: 22 * k,
          letterSpacing: -0.5 * k,
          lineHeight: 1,
          padding: `${5 * k}px ${7 * k}px`,
          borderRadius: 3 * k,
          fontStyle: 'italic',
        }}
      >
        CNN
      </div>
    </div>
  );
}

function CnnChyron({ s }: { s: S }) {
  const { W, k } = stageMetrics(s.orient);
  const items = parseItems(s.ticker);
  return (
    <>
      {/* Local + hora no canto superior direito */}
      {(s.location.trim() || s.time.trim()) ? (
        <div
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            fontWeight: 700,
            lineHeight: 1.25,
          }}
        >
          {s.location.trim() ? (
            <span style={{ background: 'rgba(20,20,20,0.85)', color: '#fff', fontSize: 12 * k, padding: `${4 * k}px ${9 * k}px` }}>{s.location}</span>
          ) : null}
          {s.time.trim() ? (
            <span style={{ background: 'rgba(20,20,20,0.85)', color: '#fff', fontSize: 12 * k, padding: `${4 * k}px ${9 * k}px`, fontVariantNumeric: 'tabular-nums' }}>{s.time}</span>
          ) : null}
        </div>
      ) : null}

      {/* Chyron inferior */}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, width: '100%' }}>
        {/* faixa 1: tag + programa */}
        <div style={{ display: 'flex', alignItems: 'stretch', gap: 0, height: 24 * k, paddingLeft: 8 * k }}>
          {s.kicker.trim() ? (
            <div style={{ display: 'flex', alignItems: 'center', background: '#cc0000', color: '#fff', fontWeight: 800, fontSize: 12.5 * k, letterSpacing: 0.3 * k, padding: `0 ${10 * k}px`, textTransform: 'uppercase' }}>
              {s.kicker}
            </div>
          ) : null}
          {s.show.trim() ? (
            <div style={{ display: 'flex', alignItems: 'center', background: '#2b2b2b', color: '#fff', fontWeight: 600, fontSize: 12.5 * k, padding: `0 ${10 * k}px` }}>
              {s.show}
            </div>
          ) : null}
        </div>

        {/* faixa 2: manchete branca + CNN/LIVE */}
        <div style={{ display: 'flex', alignItems: 'stretch', background: '#ffffff', minHeight: 46 * k }}>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', padding: `${6 * k}px ${12 * k}px` }}>
            <FitText
              maxPx={23 * k}
              minPx={12 * k}
              maxHeight={40 * k}
              style={{ color: '#111', fontWeight: 800, lineHeight: 1.05, textTransform: 'uppercase', letterSpacing: -0.2 * k }}
            >
              {s.headline}
            </FitText>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2 * k, padding: `0 ${12 * k}px`, borderLeft: `${1 * k}px solid #e2e2e2` }}>
            <CnnLogo k={k} />
            {s.live.trim() ? (
              <span style={{ color: '#cc0000', fontWeight: 800, fontSize: 10.5 * k, letterSpacing: 1 * k }}>{s.live}</span>
            ) : null}
          </div>
        </div>

        {/* faixa 3: ticker preto */}
        {items.length ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 * k, height: 26 * k, background: '#111', color: '#fff', padding: `0 ${12 * k}px`, fontSize: 12 * k, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden' }}>
            {items.map((it, i) => (
              <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 * k }}>
                {i > 0 ? <span style={{ color: '#cc0000', fontWeight: 900 }}>▪</span> : null}
                <span>{it}</span>
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </>
  );
}

const CNN: FakeModel<S> = {
  id: 'news-cnn',
  label: 'Breaking / Lower-third',
  category: 'news',
  group: 'CNN',
  hue: 'rgba(204,0,0,0.4)',
  stageW: 640,
  ratio: 9 / 16,
  exportW: 1920,
  usesPhone: false,
  dims: (s) => newsDims(s.orient),
  defaultState: {
    ...defaultNewsBg,
    kicker: 'REVOLT IN RUSSIA',
    show: 'CNN THIS MORNING',
    headline: 'Breaking developments unfold as officials respond to the crisis',
    live: 'LIVE',
    time: '1:21 PM',
    location: 'Berlin',
    ticker: 'Local teams win championship with record-breaking performance',
  },
  Controls: ({ s, set }) => (
    <div className="flex flex-col gap-4">
      <NewsBgControls bg={s} set={set} />
      <Field label="Assunto (tag vermelha)"><TextField value={s.kicker} onChange={(v) => set({ kicker: v })} placeholder="REVOLT IN RUSSIA" maxLength={40} /></Field>
      <Field label="Programa (caixa cinza)"><TextField value={s.show} onChange={(v) => set({ show: v })} placeholder="CNN THIS MORNING" maxLength={40} /></Field>
      <Field label="Manchete"><TextArea value={s.headline} onChange={(v) => set({ headline: v })} placeholder="Manchete principal" rows={2} maxLength={140} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="LIVE"><TextField value={s.live} onChange={(v) => set({ live: v })} placeholder="LIVE" maxLength={12} /></Field>
        <Field label="Hora"><TextField value={s.time} onChange={(v) => set({ time: v })} placeholder="1:21 PM" maxLength={12} /></Field>
      </div>
      <Field label="Local (canto)"><TextField value={s.location} onChange={(v) => set({ location: v })} placeholder="Berlin" maxLength={24} /></Field>
      <Field label="Ticker (um por linha ou separado por |)"><TextArea value={s.ticker} onChange={(v) => set({ ticker: v })} placeholder="Notícia 1 | Notícia 2" rows={2} maxLength={200} /></Field>
    </div>
  ),
  Preview: ({ s }) => (
    <NewsStage bg={s}>
      <CnnChyron s={s} />
    </NewsStage>
  ),
};

export default [CNN];
