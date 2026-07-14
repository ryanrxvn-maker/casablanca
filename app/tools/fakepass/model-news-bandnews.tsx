'use client';

/**
 * FakePass — NOTÍCIAS · Band News (Brasil).
 * Canto sup. esquerdo: hora grande + caixinha vermelha "AO VIVO" + cidade.
 * Canto sup. direito: logo "BandNEWS" (caixa azul).
 * Rodapé: (1) tag vermelha pequena (assunto) + (2) faixa azul com a manchete
 * branca bold (FitText, até 2 linhas) e um subtítulo branco menor opcional.
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

const BAND_BLUE = '#0b2e6e';
const BAND_RED = '#e2001a';

type S = NewsBg & {
  topTag: string;
  headline: string;
  sub: string;
  time: string;
  city: string;
  live: string;
};

function BandNewsLogo({ k }: { k: number }) {
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'baseline',
        gap: 2 * k,
        background: BAND_BLUE,
        color: '#fff',
        padding: `${5 * k}px ${9 * k}px`,
        borderRadius: 3 * k,
        lineHeight: 1,
        flexShrink: 0,
      }}
    >
      <span style={{ fontWeight: 800, fontSize: 20 * k, letterSpacing: -0.5 * k, fontStyle: 'italic' }}>Band</span>
      <span style={{ fontWeight: 800, fontSize: 20 * k, letterSpacing: 0.5 * k, color: '#8fb4ff' }}>NEWS</span>
    </div>
  );
}

function BandNewsChyron({ s }: { s: S }) {
  const { k } = stageMetrics(s.orient);
  return (
    <>
      {/* Canto superior esquerdo: hora + AO VIVO + cidade */}
      {(s.time.trim() || s.live.trim() || s.city.trim()) ? (
        <div
          style={{
            position: 'absolute',
            top: 12 * k,
            left: 12 * k,
            display: 'flex',
            alignItems: 'center',
            gap: 8 * k,
          }}
        >
          {s.time.trim() ? (
            <span
              data-fp-anim="clock"
              style={{
                color: '#fff',
                fontWeight: 800,
                fontSize: 30 * k,
                lineHeight: 1,
                fontVariantNumeric: 'tabular-nums',
                letterSpacing: -0.5 * k,
                textShadow: `0 ${1 * k}px ${3 * k}px rgba(0,0,0,0.55)`,
              }}
            >
              {s.time}
            </span>
          ) : null}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 3 * k }}>
            {s.live.trim() ? (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4 * k,
                  background: BAND_RED,
                  color: '#fff',
                  fontWeight: 800,
                  fontSize: 11 * k,
                  letterSpacing: 0.5 * k,
                  padding: `${3 * k}px ${7 * k}px`,
                  lineHeight: 1,
                  borderRadius: 2 * k,
                  textTransform: 'uppercase',
                }}
              >
                <span data-fp-anim="livedot" style={{ width: 6 * k, height: 6 * k, borderRadius: '50%', background: '#fff', display: 'inline-block' }} />
                {s.live}
              </span>
            ) : null}
            {s.city.trim() ? (
              <span
                style={{
                  color: '#fff',
                  fontWeight: 700,
                  fontSize: 11 * k,
                  letterSpacing: 0.4 * k,
                  textTransform: 'uppercase',
                  textShadow: `0 ${1 * k}px ${2 * k}px rgba(0,0,0,0.6)`,
                }}
              >
                {s.city}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Canto superior direito: logo BandNEWS */}
      <div style={{ position: 'absolute', top: 12 * k, right: 12 * k }}>
        <BandNewsLogo k={k} />
      </div>

      {/* Chyron inferior */}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, width: '100%' }}>
        {/* faixa 1: tag vermelha (assunto) */}
        {s.topTag.trim() ? (
          <div style={{ display: 'flex', paddingLeft: 12 * k }}>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                background: BAND_RED,
                color: '#fff',
                fontWeight: 800,
                fontSize: 12 * k,
                letterSpacing: 0.4 * k,
                padding: `${4 * k}px ${11 * k}px`,
                textTransform: 'uppercase',
                lineHeight: 1,
              }}
            >
              {s.topTag}
            </div>
          </div>
        ) : null}

        {/* faixa 2: manchete + sub sobre azul */}
        <div
          style={{
            background: BAND_BLUE,
            padding: `${9 * k}px ${14 * k}px ${11 * k}px`,
            display: 'flex',
            flexDirection: 'column',
            gap: 4 * k,
          }}
        >
          <FitText
            maxPx={25 * k}
            minPx={13 * k}
            maxHeight={64 * k}
            style={{ color: '#fff', fontWeight: 800, lineHeight: 1.08, textTransform: 'uppercase', letterSpacing: -0.2 * k }}
          >
            {s.headline}
          </FitText>
          {s.sub.trim() ? (
            <span style={{ color: 'rgba(255,255,255,0.9)', fontWeight: 600, fontSize: 13 * k, lineHeight: 1.2 }}>
              {s.sub}
            </span>
          ) : null}
        </div>
      </div>
    </>
  );
}

const BANDNEWS: FakeModel<S> = {
  id: 'news-bandnews',
  label: 'Breaking / Lower-third',
  category: 'news',
  group: 'Band News',
  hue: 'rgba(11,46,110,0.4)',
  stageW: 640,
  ratio: 9 / 16,
  exportW: 1920,
  usesPhone: false,
  // tem relógio/ticker/bolinha AO VIVO animáveis → shell mostra 'Exportar vídeo'
  anim: true,
  dims: (s) => newsDims(s.orient),
  defaultState: {
    ...defaultNewsBg,
    topTag: 'MANHÃ DE NOTÍCIAS',
    headline: 'OS DESTAQUES DE HOJE NO JORNAL',
    sub: 'Acompanhe a cobertura completa ao vivo',
    time: '6:02',
    city: 'C. GRANDE',
    live: 'AO VIVO',
  },
  Controls: ({ s, set }) => (
    <div className="flex flex-col gap-4">
      <NewsBgControls bg={s} set={set} />
      <Field label="Tag do assunto (faixa vermelha)"><TextField value={s.topTag} onChange={(v) => set({ topTag: v })} placeholder="MANHÃ DE NOTÍCIAS" maxLength={40} /></Field>
      <Field label="Manchete (faixa azul)"><TextArea value={s.headline} onChange={(v) => set({ headline: v })} placeholder="OS DESTAQUES DE HOJE NO JORNAL" rows={2} maxLength={140} /></Field>
      <Field label="Subtítulo (opcional)"><TextField value={s.sub} onChange={(v) => set({ sub: v })} placeholder="Acompanhe ao vivo" maxLength={80} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Hora"><TextField value={s.time} onChange={(v) => set({ time: v })} placeholder="6:02" maxLength={8} /></Field>
        <Field label="AO VIVO"><TextField value={s.live} onChange={(v) => set({ live: v })} placeholder="AO VIVO" maxLength={12} /></Field>
      </div>
      <Field label="Cidade (canto)"><TextField value={s.city} onChange={(v) => set({ city: v })} placeholder="C. GRANDE" maxLength={24} /></Field>
    </div>
  ),
  Preview: ({ s }) => (
    <NewsStage bg={s}>
      <BandNewsChyron s={s} />
    </NewsStage>
  ),
};

export default [BANDNEWS];
