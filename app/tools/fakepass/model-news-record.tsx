'use client';

/**
 * FakePass — NOTÍCIAS · RECORD NEWS (Brasil).
 * Chyron: (1) etiqueta de canto inf. esquerdo com a EDITORIA ("Mundo") + caixa
 * azul "RECORD NEWS"; (2) tag AZUL (#1b3a8c) com o assunto; (3) faixa
 * AZUL-ESCURA (#0a2a6b) com a manchete BRANCA bold (FitText), com pequeno
 * acento vermelho; (4) ticker opcional.
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
  LiveTag,
  Clock,
  type NewsBg,
} from './news-kit';

type S = NewsBg & {
  section: string;
  tag: string;
  headline: string;
  live: string;
  time: string;
  ticker: string;
};

/* Cores Record News */
const REC_TAG = '#1b3a8c'; // azul da tag do assunto
const REC_BAND = '#0a2a6b'; // azul-escuro da faixa da manchete
const REC_RED = '#e2231a'; // acento vermelho
const REC_BOX = '#123a8a'; // caixa azul do rótulo "RECORD NEWS"

function RecordLogo({ k }: { k: number }) {
  // Logo aproximado: "RECORD" + "NEWS" em caixa azul, com um traço vermelho.
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5 * k, flexShrink: 0 }}>
      <span style={{ display: 'inline-block', width: 3 * k, height: 15 * k, background: REC_RED, borderRadius: 1 * k }} />
      <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4 * k, lineHeight: 1 }}>
        <span style={{ color: '#fff', fontWeight: 800, fontSize: 14 * k, letterSpacing: 0.4 * k }}>RECORD</span>
        <span style={{ color: '#cdddff', fontWeight: 700, fontSize: 11.5 * k, letterSpacing: 1.2 * k }}>NEWS</span>
      </span>
    </div>
  );
}

function RecordChyron({ s }: { s: S }) {
  const { k } = stageMetrics(s.orient);
  const items = parseItems(s.ticker);
  return (
    <>
      {/* Hora + LIVE no canto superior direito */}
      {(s.live.trim() || s.time.trim()) ? (
        <div style={{ position: 'absolute', top: 12 * k, right: 12 * k, display: 'flex', alignItems: 'center', gap: 6 * k }}>
          {s.live.trim() ? <LiveTag text={s.live} bg={REC_RED} k={k} /> : null}
          {s.time.trim() ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', background: 'rgba(10,20,45,0.85)', padding: `${4 * k}px ${8 * k}px` }}>
              <Clock text={s.time} k={k} />
            </span>
          ) : null}
        </div>
      ) : null}

      {/* Chyron inferior */}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, width: '100%' }}>
        {/* faixa 1: editoria + tag do assunto (fica acima da faixa da manchete) */}
        <div style={{ display: 'flex', alignItems: 'stretch', height: 24 * k, paddingLeft: 8 * k }}>
          {/* Rótulo de canto: EDITORIA + caixa RECORD NEWS */}
          <div style={{ display: 'flex', alignItems: 'stretch' }}>
            {s.section.trim() ? (
              <div style={{ display: 'flex', alignItems: 'center', background: '#fff', color: REC_BAND, fontWeight: 800, fontSize: 12.5 * k, letterSpacing: 0.2 * k, padding: `0 ${10 * k}px` }}>
                {s.section}
              </div>
            ) : null}
            <div style={{ display: 'flex', alignItems: 'center', background: REC_BOX, padding: `0 ${10 * k}px` }}>
              <RecordLogo k={k} />
            </div>
          </div>

          {/* Tag azul do assunto */}
          {s.tag.trim() ? (
            <div style={{ display: 'flex', alignItems: 'center', background: REC_TAG, color: '#fff', fontWeight: 800, fontSize: 12.5 * k, letterSpacing: 0.3 * k, padding: `0 ${12 * k}px`, textTransform: 'uppercase', marginLeft: 6 * k }}>
              {s.tag}
            </div>
          ) : null}
        </div>

        {/* faixa 2: manchete branca sobre azul-escuro + acento vermelho */}
        <div style={{ display: 'flex', alignItems: 'stretch', background: REC_BAND, minHeight: 48 * k }}>
          {/* acento vermelho */}
          <div style={{ width: 5 * k, background: REC_RED, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', padding: `${7 * k}px ${14 * k}px` }}>
            <FitText
              maxPx={24 * k}
              minPx={12 * k}
              maxHeight={42 * k}
              style={{ color: '#fff', fontWeight: 800, lineHeight: 1.06, textTransform: 'uppercase', letterSpacing: -0.2 * k }}
            >
              {s.headline}
            </FitText>
          </div>
        </div>

        {/* faixa 3: ticker azul (opcional) */}
        {items.length ? (
          <div data-fp-anim="ticker" style={{ display: 'flex', alignItems: 'center', gap: 8 * k, height: 26 * k, background: REC_TAG, color: '#fff', padding: `0 ${12 * k}px`, fontSize: 12 * k, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden' }}>
            {items.map((it, i) => (
              <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 * k }}>
                {i > 0 ? <span style={{ color: REC_RED, fontWeight: 900 }}>▪</span> : null}
                <span>{it}</span>
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </>
  );
}

const RECORD: FakeModel<S> = {
  id: 'news-record',
  label: 'Breaking / Lower-third',
  category: 'news',
  group: 'Record News',
  hue: 'rgba(27,58,140,0.4)',
  stageW: 640,
  ratio: 9 / 16,
  exportW: 1920,
  usesPhone: false,
  // tem relógio/ticker/bolinha AO VIVO animáveis → shell mostra 'Exportar vídeo'
  anim: true,
  dims: (s) => newsDims(s.orient),
  defaultState: {
    ...defaultNewsBg,
    section: 'Mundo',
    tag: '34 DIAS DE GUERRA',
    headline: 'AGORA: LÍDERES SE REÚNEM PARA NEGOCIAR ACORDO',
    live: 'AO VIVO',
    time: '21:34',
    ticker: 'Confira as últimas atualizações da cobertura completa',
  },
  Controls: ({ s, set }) => (
    <div className="flex flex-col gap-4">
      <NewsBgControls bg={s} set={set} />
      <Field label="Editoria (canto)"><TextField value={s.section} onChange={(v) => set({ section: v })} placeholder="Mundo" maxLength={24} /></Field>
      <Field label="Assunto (tag azul)"><TextField value={s.tag} onChange={(v) => set({ tag: v })} placeholder="34 DIAS DE GUERRA" maxLength={40} /></Field>
      <Field label="Manchete"><TextArea value={s.headline} onChange={(v) => set({ headline: v })} placeholder="AGORA: manchete principal" rows={2} maxLength={140} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Ao vivo"><TextField value={s.live} onChange={(v) => set({ live: v })} placeholder="AO VIVO" maxLength={12} /></Field>
        <Field label="Hora"><TextField value={s.time} onChange={(v) => set({ time: v })} placeholder="21:34" maxLength={12} /></Field>
      </div>
      <Field label="Ticker" hint="Um card por item — botão + pra adicionar, setas pra ordenar.">
        <LineBuilder value={s.ticker} onChange={(v) => set({ ticker: v })} placeholder="Notícia 1" addLabel="Item" pipe />
      </Field>
    </div>
  ),
  Preview: ({ s }) => (
    <NewsStage bg={s}>
      <RecordChyron s={s} />
    </NewsStage>
  ),
};

export default [RECORD];
