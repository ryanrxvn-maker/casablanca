'use client';

/**
 * FakePass — NOTÍCIAS · Fox News (EUA).
 * Chyron de 3 faixas: (1) tag VERMELHA "BREAKING NEWS" (NEWS em amarelo),
 * (2) faixa BRANCA com manchete PRETA bold UPPERCASE (FitText),
 * (3) tira VERMELHA "FOX NEWS ALERT" (ALERT em amarelo).
 * Canto sup. esquerdo: caixinha vermelha "● LIVE". Logo Fox no canto inf.
 * esquerdo: caixa azul-marinho "FOX NEWS" + "channel".
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

const FOX_RED = '#c8102e';
const FOX_YELLOW = '#ffd200';
const FOX_NAVY = '#0a2342';

type S = NewsBg & {
  tag: string;
  headline: string;
  alert: string;
  live: string;
};

/** Logo aproximado da Fox: caixa azul-marinho com "FOX NEWS" + "channel". */
function FoxLogo({ k }: { k: number }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: FOX_NAVY,
        color: '#fff',
        padding: `${5 * k}px ${9 * k}px`,
        borderRadius: 2 * k,
        lineHeight: 1,
        flexShrink: 0,
      }}
    >
      <span style={{ fontWeight: 900, fontSize: 17 * k, letterSpacing: -0.4 * k, fontStyle: 'italic' }}>
        FOX NEWS
      </span>
      <span style={{ fontWeight: 600, fontSize: 6.5 * k, letterSpacing: 3 * k, marginTop: 2 * k, textTransform: 'lowercase', opacity: 0.92 }}>
        channel
      </span>
    </div>
  );
}

function FoxChyron({ s }: { s: S }) {
  const { k } = stageMetrics(s.orient);
  return (
    <>
      {/* Caixinha "● LIVE" no canto superior esquerdo */}
      {s.live.trim() ? (
        <div
          style={{
            position: 'absolute',
            top: 12 * k,
            left: 12 * k,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5 * k,
            background: FOX_RED,
            color: '#fff',
            fontWeight: 900,
            fontSize: 12.5 * k,
            letterSpacing: 0.6 * k,
            padding: `${4 * k}px ${9 * k}px`,
            borderRadius: 2 * k,
            lineHeight: 1,
          }}
        >
          <span data-fp-anim="livedot" style={{ width: 7 * k, height: 7 * k, borderRadius: '50%', background: '#fff', display: 'inline-block' }} />
          {s.live}
        </div>
      ) : null}

      {/* Chyron inferior */}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, width: '100%' }}>
        {/* faixa 1: tag vermelha "BREAKING NEWS" (NEWS amarelo) */}
        {s.tag.trim() ? (
          <div style={{ display: 'flex', alignItems: 'stretch', height: 26 * k, paddingLeft: 10 * k }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6 * k,
                background: FOX_RED,
                color: '#fff',
                fontWeight: 900,
                fontSize: 14 * k,
                letterSpacing: 0.6 * k,
                padding: `0 ${12 * k}px`,
                textTransform: 'uppercase',
              }}
            >
              {(() => {
                const words = s.tag.trim().split(/\s+/);
                const last = words.length > 1 ? words.pop() : '';
                const head = words.join(' ');
                return (
                  <>
                    {head ? <span>{head}</span> : null}
                    {last ? <span style={{ color: FOX_YELLOW }}>{last}</span> : null}
                    {!head && !last ? <span style={{ color: FOX_YELLOW }}>{s.tag}</span> : null}
                  </>
                );
              })()}
            </div>
          </div>
        ) : null}

        {/* faixa 2: manchete branca (preto bold uppercase) */}
        <div style={{ display: 'flex', alignItems: 'stretch', background: '#ffffff', minHeight: 50 * k, borderTop: `${2 * k}px solid ${FOX_RED}` }}>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', padding: `${7 * k}px ${14 * k}px` }}>
            <FitText
              maxPx={24 * k}
              minPx={12 * k}
              maxHeight={42 * k}
              style={{ color: '#0a0a0a', fontWeight: 900, lineHeight: 1.04, textTransform: 'uppercase', letterSpacing: -0.2 * k }}
            >
              {s.headline}
            </FitText>
          </div>
        </div>

        {/* faixa 3: tira vermelha "FOX NEWS ALERT" (ALERT amarelo) + logo */}
        <div style={{ display: 'flex', alignItems: 'stretch', height: 34 * k, background: FOX_RED }}>
          <div style={{ display: 'flex', alignItems: 'center', paddingLeft: 8 * k, paddingRight: 10 * k }}>
            <FoxLogo k={k} />
          </div>
          {s.alert.trim() ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6 * k,
                color: '#fff',
                fontWeight: 900,
                fontSize: 15 * k,
                letterSpacing: 0.8 * k,
                textTransform: 'uppercase',
                whiteSpace: 'nowrap',
              }}
            >
              {(() => {
                const words = s.alert.trim().split(/\s+/);
                const last = words.length > 1 ? words.pop() : '';
                const head = words.join(' ');
                return (
                  <>
                    {head ? <span>{head}</span> : null}
                    {last ? <span style={{ color: FOX_YELLOW }}>{last}</span> : null}
                    {!head && !last ? <span style={{ color: FOX_YELLOW }}>{s.alert}</span> : null}
                  </>
                );
              })()}
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}

const FOX: FakeModel<S> = {
  id: 'news-fox',
  label: 'Breaking / Lower-third',
  category: 'news',
  group: 'Fox News',
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
    tag: 'BREAKING NEWS',
    headline: 'Officials respond to developing situation',
    alert: 'FOX NEWS ALERT',
    live: 'LIVE',
  },
  Controls: ({ s, set }) => (
    <div className="flex flex-col gap-4">
      <NewsBgControls bg={s} set={set} />
      <Field label="Tag (vermelha — última palavra fica amarela)"><TextField value={s.tag} onChange={(v) => set({ tag: v })} placeholder="BREAKING NEWS" maxLength={40} /></Field>
      <Field label="Manchete"><TextArea value={s.headline} onChange={(v) => set({ headline: v })} placeholder="OFFICIALS RESPOND TO DEVELOPING SITUATION" rows={2} maxLength={140} /></Field>
      <Field label="Alerta (tira vermelha — última palavra amarela)"><TextField value={s.alert} onChange={(v) => set({ alert: v })} placeholder="FOX NEWS ALERT" maxLength={40} /></Field>
      <Field label="LIVE (canto sup. esquerdo)"><TextField value={s.live} onChange={(v) => set({ live: v })} placeholder="LIVE" maxLength={12} /></Field>
    </div>
  ),
  Preview: ({ s }) => (
    <NewsStage bg={s}>
      <FoxChyron s={s} />
    </NewsStage>
  ),
};

export default [FOX];
