'use client';

/**
 * FakePass — NOTÍCIAS · Global News (Canadá).
 * Topo: banner "BREAKING NEWS" (paralelogramo vermelho no dark / faixa branca no
 * light) à esquerda; logo "Global News" + caixinha "LIVE" à direita. Rodapé:
 * faixa da manchete (branca no dark / vermelha no light) com texto bold uppercase
 * + caixa "LIVE" vinho + hora; ticker embaixo (vermelho no dark / azul-marinho no
 * light) com itens separados por "•" e rótulo opcional à esquerda.
 * Recria o GRÁFICO do telejornal; todo texto é editável (placeholder fake).
 */

import { Field, TextField, TextArea, FitText, Segmented, type FakeModel } from './shared';
import {
  NewsStage,
  NewsBgControls,
  newsDims,
  stageMetrics,
  parseItems,
  defaultNewsBg,
  type NewsBg,
} from './news-kit';

type GlobalVariant = 'dark' | 'light';

type S = NewsBg & {
  variant: GlobalVariant;
  headline: string;
  live: string;
  time: string;
  ticker: string;
  tickerLabel: string;
};

/** Cores por variante. */
function palette(variant: GlobalVariant) {
  const dark = variant === 'dark';
  return {
    dark,
    // Banner BREAKING NEWS (topo esq.)
    breakingBg: dark ? '#c8102e' : '#ffffff',
    breakingText: dark ? '#ffffff' : '#c8102e',
    // Logo (topo dir.)
    logoColor: dark ? '#ffffff' : '#111111',
    // Faixa da manchete (rodapé)
    hlBg: dark ? '#ffffff' : '#c8102e',
    hlText: dark ? '#141414' : '#ffffff',
    // Ticker (rodapé baixo)
    tickerBg: dark ? '#a71d1d' : '#0a1a4a',
  };
}

/** Logo aproximado "Global" (bloco) + "News". Cores conforme fundo. */
function GlobalLogo({ k, color }: { k: number; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 * k, flexShrink: 0, lineHeight: 1 }}>
      <span style={{ color, fontWeight: 800, fontSize: 20 * k, letterSpacing: -0.5 * k }}>Global</span>
      <span
        style={{
          color,
          fontWeight: 400,
          fontSize: 20 * k,
          letterSpacing: -0.3 * k,
          borderLeft: `${1.5 * k}px solid ${color}`,
          paddingLeft: 6 * k,
        }}
      >
        News
      </span>
    </div>
  );
}

function GlobalChyron({ s }: { s: S }) {
  const { k } = stageMetrics(s.orient);
  const c = palette(s.variant);
  const items = parseItems(s.ticker);

  return (
    <>
      {/* ── Topo esquerdo: banner BREAKING NEWS (paralelogramo) ── */}
      <div
        style={{
          position: 'absolute',
          top: 14 * k,
          left: 0,
          display: 'flex',
          alignItems: 'center',
          background: c.breakingBg,
          color: c.breakingText,
          fontWeight: 800,
          fontSize: 15 * k,
          letterSpacing: 1 * k,
          padding: `${7 * k}px ${18 * k}px ${7 * k}px ${14 * k}px`,
          textTransform: 'uppercase',
          transform: `skewX(-12deg)`,
          boxShadow: `0 ${2 * k}px ${6 * k}px rgba(0,0,0,0.25)`,
        }}
      >
        <span style={{ display: 'inline-block', transform: 'skewX(12deg)' }}>Breaking News</span>
      </div>

      {/* ── Topo direito: logo Global News + LIVE ── */}
      <div
        style={{
          position: 'absolute',
          top: 14 * k,
          right: 14 * k,
          display: 'flex',
          alignItems: 'center',
          gap: 9 * k,
        }}
      >
        <GlobalLogo k={k} color={c.logoColor} />
        {s.live.trim() ? (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5 * k,
              background: '#c8102e',
              color: '#fff',
              fontWeight: 800,
              fontSize: 12 * k,
              letterSpacing: 0.6 * k,
              padding: `${4 * k}px ${8 * k}px`,
              lineHeight: 1,
            }}
          >
            <span data-fp-anim="livedot" style={{ width: 6 * k, height: 6 * k, borderRadius: '50%', background: '#fff', display: 'inline-block' }} />
            {s.live}
          </span>
        ) : null}
      </div>

      {/* ── Chyron inferior ── */}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, width: '100%' }}>
        {/* faixa da manchete + LIVE vinho + hora */}
        <div style={{ display: 'flex', alignItems: 'stretch', background: c.hlBg, minHeight: 58 * k }}>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', padding: `${8 * k}px ${16 * k}px` }}>
            <FitText
              maxPx={26 * k}
              minPx={13 * k}
              maxHeight={52 * k}
              style={{ color: c.hlText, fontWeight: 800, lineHeight: 1.05, textTransform: 'uppercase', letterSpacing: -0.2 * k }}
            >
              {s.headline}
            </FitText>
          </div>
          {(s.live.trim() || s.time.trim()) ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 3 * k,
                background: '#8b1a1a',
                color: '#fff',
                padding: `0 ${14 * k}px`,
                flexShrink: 0,
              }}
            >
              {s.live.trim() ? (
                <span style={{ fontWeight: 800, fontSize: 15 * k, letterSpacing: 1 * k }}>{s.live}</span>
              ) : null}
              {s.time.trim() ? (
                <span data-fp-anim="clock" style={{ fontWeight: 600, fontSize: 10.5 * k, letterSpacing: 0.3 * k, opacity: 0.92 }}>{s.time}</span>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* ticker */}
        {items.length ? (
          <div style={{ display: 'flex', alignItems: 'stretch', height: 28 * k, background: c.tickerBg, color: '#fff', width: '100%', overflow: 'hidden' }}>
            {s.tickerLabel.trim() ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  background: 'rgba(0,0,0,0.28)',
                  padding: `0 ${11 * k}px`,
                  fontWeight: 800,
                  fontSize: 11.5 * k,
                  letterSpacing: 0.5 * k,
                  whiteSpace: 'nowrap',
                  textTransform: 'uppercase',
                }}
              >
                {s.tickerLabel}
              </div>
            ) : null}
            <div data-fp-anim="ticker" style={{ display: 'flex', alignItems: 'center', gap: 8 * k, padding: `0 ${12 * k}px`, fontSize: 12 * k, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', flex: 1 }}>
              {items.map((it, i) => (
                <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 * k }}>
                  {i > 0 ? <span style={{ color: 'rgba(255,255,255,0.6)', fontWeight: 900 }}>•</span> : null}
                  <span>{it}</span>
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}

const GLOBAL: FakeModel<S> = {
  id: 'news-global',
  label: 'Breaking / Lower-third',
  category: 'news',
  group: 'Global News',
  hue: 'rgba(200,16,46,0.4)',
  stageW: 640,
  ratio: 9 / 16,
  exportW: 1920,
  usesPhone: false,
  // tem relógio/ticker/bolinha AO VIVO animáveis → shell mostra 'Exportar vídeo'
  anim: true,
  dims: (s) => newsDims(s.orient),
  defaultState: {
    ...defaultNewsBg,
    variant: 'dark',
    headline: 'Authorities issue statement on unfolding events',
    live: 'LIVE',
    time: '12:17 PM ET',
    ticker: 'Officials confirm response is underway | Residents urged to stay informed | Updates to follow',
    tickerLabel: 'URGENT UPDATES',
  },
  Controls: ({ s, set }) => (
    <div className="flex flex-col gap-4">
      <NewsBgControls bg={s} set={set} />
      <Field label="Estilo do gráfico">
        <Segmented
          value={s.variant}
          options={[
            { value: 'dark', label: 'Escuro' },
            { value: 'light', label: 'Claro' },
          ]}
          onChange={(v) => set({ variant: v })}
        />
      </Field>
      <Field label="Manchete"><TextArea value={s.headline} onChange={(v) => set({ headline: v })} placeholder="Authorities issue statement on unfolding events" rows={2} maxLength={140} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="LIVE"><TextField value={s.live} onChange={(v) => set({ live: v })} placeholder="LIVE" maxLength={12} /></Field>
        <Field label="Hora"><TextField value={s.time} onChange={(v) => set({ time: v })} placeholder="12:17 PM ET" maxLength={16} /></Field>
      </div>
      <Field label="Rótulo do ticker (caixa à esquerda)"><TextField value={s.tickerLabel} onChange={(v) => set({ tickerLabel: v })} placeholder="URGENT UPDATES" maxLength={28} /></Field>
      <Field label="Ticker (um por linha ou separado por |)"><TextArea value={s.ticker} onChange={(v) => set({ ticker: v })} placeholder="Notícia 1 | Notícia 2" rows={2} maxLength={200} /></Field>
    </div>
  ),
  Preview: ({ s }) => (
    <NewsStage bg={s}>
      <GlobalChyron s={s} />
    </NewsStage>
  ),
};

export default [GLOBAL];
