'use client';

/**
 * FakePass — NOTÍCIAS · BBC (World News).
 * Faixa VERMELHA full-width no rodapé. De cima p/ baixo:
 *  (1) logo "BBC" (3 quadradinhos brancos com letras pretas) + "WORLD NEWS"
 *      branco + caixinha branca "BREAKING" em vermelho;
 *  (2) manchete branca GRANDE (sentence case) via FitText;
 *  (3) sub-manchete branca menor;
 *  (4) tira fininha (vermelho mais claro) com "▪ HEADLINES".
 * Recria o GRÁFICO do telejornal; todo texto é editável (placeholder fake).
 */

import { Field, TextField, TextArea, FitText, type FakeModel } from './shared';
import {
  NewsStage,
  NewsBgControls,
  newsDims,
  stageMetrics,
  defaultNewsBg,
  type NewsBg,
} from './news-kit';

type S = NewsBg & {
  section: string;
  tag: string;
  headline: string;
  sub: string;
  bottomLabel: string;
};

/** Vermelhos BBC. */
const BBC_RED = '#bb1919';
const BBC_RED_LT = '#d13636';

/** Logo BBC = 3 quadradinhos brancos, cada um com uma letra preta em bold. */
function BbcLogo({ k }: { k: number }) {
  const box = 20 * k;
  return (
    <div style={{ display: 'flex', gap: 2 * k, flexShrink: 0 }}>
      {['B', 'B', 'C'].map((ch, i) => (
        <span
          key={i}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: box,
            height: box,
            background: '#ffffff',
            color: '#111111',
            fontWeight: 800,
            fontSize: 14 * k,
            lineHeight: 1,
            letterSpacing: -0.5 * k,
          }}
        >
          {ch}
        </span>
      ))}
    </div>
  );
}

function BbcChyron({ s }: { s: S }) {
  const { k } = stageMetrics(s.orient);
  return (
    <>
      {/* Faixa vermelha inferior full-width */}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, width: '100%', background: BBC_RED }}>
        {/* linha do topo: logo + WORLD NEWS + BREAKING */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 9 * k,
            padding: `${9 * k}px ${14 * k}px ${5 * k}px`,
          }}
        >
          <BbcLogo k={k} />
          {s.section.trim() ? (
            <span
              style={{
                color: '#ffffff',
                fontWeight: 800,
                fontSize: 13 * k,
                letterSpacing: 0.6 * k,
                textTransform: 'uppercase',
                whiteSpace: 'nowrap',
              }}
            >
              {s.section}
            </span>
          ) : null}
          {s.tag.trim() ? (
            <span
              style={{
                background: '#ffffff',
                color: BBC_RED,
                fontWeight: 800,
                fontSize: 12 * k,
                letterSpacing: 0.4 * k,
                textTransform: 'uppercase',
                padding: `${3 * k}px ${8 * k}px`,
                lineHeight: 1,
                whiteSpace: 'nowrap',
              }}
            >
              {s.tag}
            </span>
          ) : null}
        </div>

        {/* manchete branca GRANDE (sentence case — NÃO uppercase) */}
        <div style={{ padding: `0 ${14 * k}px ${s.sub.trim() ? 2 * k : 9 * k}px` }}>
          <FitText
            maxPx={27 * k}
            minPx={14 * k}
            maxHeight={72 * k}
            style={{ color: '#ffffff', fontWeight: 800, lineHeight: 1.08, letterSpacing: -0.2 * k }}
          >
            {s.headline}
          </FitText>
        </div>

        {/* sub-manchete branca menor */}
        {s.sub.trim() ? (
          <div style={{ padding: `0 ${14 * k}px ${9 * k}px` }}>
            <div style={{ color: 'rgba(255,255,255,0.92)', fontWeight: 500, fontSize: 14 * k, lineHeight: 1.2 }}>
              {s.sub}
            </div>
          </div>
        ) : null}

        {/* tira fininha (vermelho mais claro) com o rótulo */}
        {s.bottomLabel.trim() ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6 * k,
              background: BBC_RED_LT,
              color: '#ffffff',
              fontWeight: 700,
              fontSize: 11.5 * k,
              letterSpacing: 0.5 * k,
              textTransform: 'uppercase',
              padding: `${4 * k}px ${14 * k}px`,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
            }}
          >
            <span style={{ color: '#ffffff', fontSize: 9 * k, lineHeight: 1 }}>▪</span>
            <span>{s.bottomLabel}</span>
          </div>
        ) : null}
      </div>
    </>
  );
}

const BBC: FakeModel<S> = {
  id: 'news-bbc',
  label: 'Breaking / Lower-third',
  category: 'news',
  group: 'BBC',
  hue: 'rgba(187,25,25,0.4)',
  stageW: 640,
  ratio: 9 / 16,
  exportW: 1920,
  usesPhone: false,
  dims: (s) => newsDims(s.orient),
  defaultState: {
    ...defaultNewsBg,
    section: 'BBC WORLD NEWS',
    tag: 'BREAKING',
    headline: 'Government announces new policy measures',
    sub: 'Officials say the plan will take effect within weeks',
    bottomLabel: 'HEADLINES',
  },
  Controls: ({ s, set }) => (
    <div className="flex flex-col gap-4">
      <NewsBgControls bg={s} set={set} />
      <Field label="Seção (faixa)"><TextField value={s.section} onChange={(v) => set({ section: v })} placeholder="BBC WORLD NEWS" maxLength={30} /></Field>
      <Field label="Tag (caixa branca)"><TextField value={s.tag} onChange={(v) => set({ tag: v })} placeholder="BREAKING" maxLength={20} /></Field>
      <Field label="Manchete"><TextArea value={s.headline} onChange={(v) => set({ headline: v })} placeholder="Manchete principal" rows={2} maxLength={140} /></Field>
      <Field label="Sub-manchete"><TextField value={s.sub} onChange={(v) => set({ sub: v })} placeholder="Linha de apoio" maxLength={90} /></Field>
      <Field label="Rótulo da tira"><TextField value={s.bottomLabel} onChange={(v) => set({ bottomLabel: v })} placeholder="HEADLINES" maxLength={30} /></Field>
    </div>
  ),
  Preview: ({ s }) => (
    <NewsStage bg={s}>
      <BbcChyron s={s} />
    </NewsStage>
  ),
};

export default [BBC];
