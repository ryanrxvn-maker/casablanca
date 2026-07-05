'use client';

/**
 * FakePass — NOTÍCIAS · CNN Brasil.
 * Chyron de 3 faixas: (1) tag vermelha do assunto (UPPERCASE) OU "BREAKING NEWS",
 * (2) faixa branca com a manchete preta bold UPPERCASE (FitText),
 * (3) sub-faixa cinza-escura (#2b2b2b) com a sub-manchete branca.
 * Canto inferior direito: logo "CNN" vermelho + "BRASIL" preto pequeno, com uma
 * caixinha vermelha "VIVO" em cima. Ticker escuro opcional.
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
  tag: string;
  headline: string;
  sub: string;
  live: string;
  logoSub: string;
  time: string;
  ticker: string;
};

/** Logo aproximado da CNN Brasil: "CNN" vermelho + sub-texto preto pequeno. */
function CnnBrLogo({ k, sub }: { k: number; sub: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5 * k, flexShrink: 0 }}>
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
      {sub.trim() ? (
        <div style={{ color: '#111', fontWeight: 800, fontSize: 9 * k, letterSpacing: 2 * k, lineHeight: 1 }}>
          {sub}
        </div>
      ) : null}
    </div>
  );
}

function CnnBrChyron({ s }: { s: S }) {
  const { k } = stageMetrics(s.orient);
  const items = parseItems(s.ticker);
  return (
    <>
      {/* Hora no canto superior direito */}
      {s.time.trim() ? (
        <div
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            fontWeight: 700,
          }}
        >
          <span
            style={{
              background: 'rgba(20,20,20,0.85)',
              color: '#fff',
              fontSize: 12 * k,
              padding: `${4 * k}px ${9 * k}px`,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {s.time}
          </span>
        </div>
      ) : null}

      {/* Chyron inferior */}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, width: '100%' }}>
        {/* faixa 1: tag vermelha do assunto / BREAKING NEWS */}
        {s.tag.trim() ? (
          <div style={{ display: 'flex', alignItems: 'stretch', height: 24 * k, paddingLeft: 8 * k }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                background: '#cc0000',
                color: '#fff',
                fontWeight: 800,
                fontSize: 12.5 * k,
                letterSpacing: 0.4 * k,
                padding: `0 ${10 * k}px`,
                textTransform: 'uppercase',
              }}
            >
              {s.tag}
            </div>
          </div>
        ) : null}

        {/* faixa 2: manchete branca + logo CNN BRASIL / VIVO */}
        <div style={{ display: 'flex', alignItems: 'stretch', background: '#ffffff', minHeight: 48 * k }}>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', padding: `${6 * k}px ${12 * k}px` }}>
            <FitText
              maxPx={24 * k}
              minPx={12 * k}
              maxHeight={42 * k}
              style={{ color: '#111', fontWeight: 800, lineHeight: 1.05, textTransform: 'uppercase', letterSpacing: -0.2 * k }}
            >
              {s.headline}
            </FitText>
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4 * k,
              padding: `${5 * k}px ${12 * k}px`,
              borderLeft: `${1 * k}px solid #e2e2e2`,
            }}
          >
            {s.live.trim() ? (
              <span
                style={{
                  background: '#cc0000',
                  color: '#fff',
                  fontWeight: 800,
                  fontSize: 10 * k,
                  letterSpacing: 1 * k,
                  padding: `${2 * k}px ${6 * k}px`,
                  borderRadius: 2 * k,
                  lineHeight: 1,
                }}
              >
                {s.live}
              </span>
            ) : null}
            <CnnBrLogo k={k} sub={s.logoSub} />
          </div>
        </div>

        {/* faixa 3: sub-faixa cinza-escura com sub-manchete branca */}
        {s.sub.trim() ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              background: '#2b2b2b',
              color: '#fff',
              minHeight: 26 * k,
              padding: `${5 * k}px ${12 * k}px`,
              fontSize: 13 * k,
              fontWeight: 600,
              lineHeight: 1.15,
              textTransform: 'uppercase',
              letterSpacing: 0.2 * k,
            }}
          >
            {s.sub}
          </div>
        ) : null}

        {/* faixa 4: ticker escuro opcional */}
        {items.length ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8 * k,
              height: 26 * k,
              background: '#111',
              color: '#fff',
              padding: `0 ${12 * k}px`,
              fontSize: 12 * k,
              fontWeight: 600,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
            }}
          >
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

const CNNBR: FakeModel<S> = {
  id: 'news-cnnbr',
  label: 'Breaking / Lower-third',
  category: 'news',
  group: 'CNN Brasil',
  hue: 'rgba(204,0,0,0.4)',
  stageW: 640,
  ratio: 9 / 16,
  exportW: 1920,
  usesPhone: false,
  dims: (s) => newsDims(s.orient),
  defaultState: {
    ...defaultNewsBg,
    tag: 'VACINAÇÃO NO BRASIL',
    headline: 'GOVERNO ANUNCIA NOVAS MEDIDAS ECONÔMICAS',
    sub: 'Pacote deve impactar milhões de brasileiros nos próximos meses',
    live: 'VIVO',
    logoSub: 'BRASIL',
    time: '14:21',
    ticker: 'Mercado reage à decisão | Dólar fecha em queda | Câmara vota projeto amanhã',
  },
  Controls: ({ s, set }) => (
    <div className="flex flex-col gap-4">
      <NewsBgControls bg={s} set={set} />
      <Field label="Assunto (tag vermelha)"><TextField value={s.tag} onChange={(v) => set({ tag: v })} placeholder="VACINAÇÃO NO BRASIL" maxLength={44} /></Field>
      <Field label="Manchete"><TextArea value={s.headline} onChange={(v) => set({ headline: v })} placeholder="GOVERNO ANUNCIA NOVAS MEDIDAS ECONÔMICAS" rows={2} maxLength={140} /></Field>
      <Field label="Sub-manchete (faixa cinza)"><TextArea value={s.sub} onChange={(v) => set({ sub: v })} placeholder="Detalhe da notícia" rows={2} maxLength={120} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="VIVO"><TextField value={s.live} onChange={(v) => set({ live: v })} placeholder="VIVO" maxLength={12} /></Field>
        <Field label="Hora"><TextField value={s.time} onChange={(v) => set({ time: v })} placeholder="14:21" maxLength={12} /></Field>
      </div>
      <Field label="Ticker (um por linha ou separado por |)"><TextArea value={s.ticker} onChange={(v) => set({ ticker: v })} placeholder="Notícia 1 | Notícia 2" rows={2} maxLength={200} /></Field>
    </div>
  ),
  Preview: ({ s }) => (
    <NewsStage bg={s}>
      <CnnBrChyron s={s} />
    </NewsStage>
  ),
};

export default [CNNBR];
