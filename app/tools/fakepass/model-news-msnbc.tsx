'use client';

/**
 * FakePass — NOTÍCIAS · MSNBC (EUA).
 * Chyron de 3 faixas: (1) tag VERMELHA "BREAKING NEWS"; (2) faixa BRANCA com a
 * manchete PRETA bold UPPERCASE (FitText) + logo do "pavão" NBC aproximado
 * (leque de 6 pétalas coloridas) e "msnbc" minúsculo; (3) faixa VERMELHA com o
 * programa/assunto UPPERCASE. "LIVE  7:12 PM" opcional perto do logo.
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
  tag: string;
  headline: string;
  showbar: string;
  live: string;
  time: string;
};

/** Pavão NBC aproximado: leque de 6 pétalas coloridas abrindo pra direita. */
function PeacockLogo({ k }: { k: number }) {
  const size = 26 * k;
  const cx = size / 2;
  const cy = size / 2;
  // 6 pétalas (amarelo, laranja, vermelho, roxo, azul, verde) em leque.
  const petals: { color: string; angle: number }[] = [
    { color: '#f7c800', angle: -72 }, // amarelo (topo)
    { color: '#f37021', angle: -40 }, // laranja
    { color: '#cc0000', angle: -8 }, // vermelho
    { color: '#6d2077', angle: 24 }, // roxo
    { color: '#0089d0', angle: 56 }, // azul
    { color: '#00a94f', angle: 88 }, // verde (base)
  ];
  const r = size * 0.42; // comprimento da pétala
  const w = size * 0.19; // meia-largura da pétala na ponta
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0, display: 'block' }}>
      {petals.map((p, i) => {
        const a = (p.angle * Math.PI) / 180;
        const tipX = cx + r * Math.cos(a);
        const tipY = cy + r * Math.sin(a);
        // vetor perpendicular pra dar a gota/pétala
        const px = Math.cos(a + Math.PI / 2);
        const py = Math.sin(a + Math.PI / 2);
        const c1x = cx + r * 0.55 * Math.cos(a) + w * px;
        const c1y = cy + r * 0.55 * Math.sin(a) + w * py;
        const c2x = cx + r * 0.55 * Math.cos(a) - w * px;
        const c2y = cy + r * 0.55 * Math.sin(a) - w * py;
        return (
          <path
            key={i}
            d={`M ${cx} ${cy} Q ${c1x} ${c1y} ${tipX} ${tipY} Q ${c2x} ${c2y} ${cx} ${cy} Z`}
            fill={p.color}
          />
        );
      })}
    </svg>
  );
}

function MsnbcLogo({ k }: { k: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 * k, flexShrink: 0 }}>
      <PeacockLogo k={k} />
      <span
        style={{
          color: '#111',
          fontWeight: 700,
          fontSize: 18 * k,
          letterSpacing: -0.5 * k,
          lineHeight: 1,
        }}
      >
        msnbc
      </span>
    </div>
  );
}

function MsnbcChyron({ s }: { s: S }) {
  const { k } = stageMetrics(s.orient);
  const liveLabel = [s.live.trim(), s.time.trim()].filter(Boolean).join('  ');
  return (
    <>
      {/* Chyron inferior */}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, width: '100%' }}>
        {/* faixa 1: tag vermelha BREAKING NEWS */}
        {s.tag.trim() ? (
          <div style={{ display: 'flex', alignItems: 'stretch', height: 26 * k, paddingLeft: 10 * k }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                background: '#d31f26',
                color: '#fff',
                fontWeight: 800,
                fontSize: 14 * k,
                letterSpacing: 0.6 * k,
                padding: `0 ${12 * k}px`,
                textTransform: 'uppercase',
              }}
            >
              {s.tag}
            </div>
          </div>
        ) : null}

        {/* faixa 2: manchete branca + logo msnbc */}
        <div style={{ display: 'flex', alignItems: 'stretch', background: '#ffffff', minHeight: 48 * k }}>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', padding: `${7 * k}px ${14 * k}px` }}>
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
              gap: 3 * k,
              padding: `0 ${14 * k}px`,
              borderLeft: `${1 * k}px solid #e2e2e2`,
            }}
          >
            <MsnbcLogo k={k} />
            {liveLabel ? (
              <span style={{ color: '#d31f26', fontWeight: 800, fontSize: 10.5 * k, letterSpacing: 0.8 * k, fontVariantNumeric: 'tabular-nums' }}>
                {liveLabel}
              </span>
            ) : null}
          </div>
        </div>

        {/* faixa 3: faixa vermelha com programa/assunto */}
        {s.showbar.trim() ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              height: 28 * k,
              background: '#d31f26',
              color: '#fff',
              padding: `0 ${14 * k}px`,
              fontSize: 13 * k,
              fontWeight: 800,
              letterSpacing: 0.5 * k,
              textTransform: 'uppercase',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
            }}
          >
            {s.showbar}
          </div>
        ) : null}
      </div>
    </>
  );
}

const MSNBC: FakeModel<S> = {
  id: 'news-msnbc',
  label: 'Breaking / Lower-third',
  category: 'news',
  group: 'MSNBC',
  hue: 'rgba(211,31,38,0.4)',
  stageW: 640,
  ratio: 9 / 16,
  exportW: 1920,
  usesPhone: false,
  dims: (s) => newsDims(s.orient),
  defaultState: {
    ...defaultNewsBg,
    tag: 'BREAKING NEWS',
    headline: 'Major decision expected from court today',
    showbar: 'REPUBLICAN NATIONAL CONVENTION',
    live: 'LIVE',
    time: '7:12 PM',
  },
  Controls: ({ s, set }) => (
    <div className="flex flex-col gap-4">
      <NewsBgControls bg={s} set={set} />
      <Field label="Tag (faixa vermelha de cima)"><TextField value={s.tag} onChange={(v) => set({ tag: v })} placeholder="BREAKING NEWS" maxLength={30} /></Field>
      <Field label="Manchete"><TextArea value={s.headline} onChange={(v) => set({ headline: v })} placeholder="MAJOR DECISION EXPECTED FROM COURT TODAY" rows={2} maxLength={140} /></Field>
      <Field label="Programa / assunto (faixa vermelha de baixo)"><TextField value={s.showbar} onChange={(v) => set({ showbar: v })} placeholder="REPUBLICAN NATIONAL CONVENTION" maxLength={50} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="LIVE"><TextField value={s.live} onChange={(v) => set({ live: v })} placeholder="LIVE" maxLength={12} /></Field>
        <Field label="Hora"><TextField value={s.time} onChange={(v) => set({ time: v })} placeholder="7:12 PM" maxLength={12} /></Field>
      </div>
    </div>
  ),
  Preview: ({ s }) => (
    <NewsStage bg={s}>
      <MsnbcChyron s={s} />
    </NewsStage>
  ),
};

export default [MSNBC];
