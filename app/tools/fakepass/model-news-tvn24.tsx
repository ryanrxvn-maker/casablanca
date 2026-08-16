'use client';

/**
 * FakePass — NOTÍCIAS · TVN24 (Polônia) — "pasek" do Fakty po południu.
 *
 * O gráfico polonês tem uma anatomia bem própria (e é ela que dá a fidelidade):
 *  • coluna ESQUERDA fixa: caixinha do PRÓXIMO programa ("20:30 / W TVN24") e,
 *    abaixo, o rótulo do bloco ("TELESERWIS" / "POLSKA I ŚWIAT");
 *  • linha 1: tile do logo tvn24 HD + faixa AMARELA com a manchete em azul-marinho
 *    (a variante "branca" também existe no ar) + selo "PILNE" no fim da faixa;
 *  • linha 2: relógio + faixa AZUL com a segunda manchete + "WIĘCEJ W tvn24";
 *  • bloco "FAKTY / PO POŁUDNIU" à direita, ATRAVESSANDO as duas linhas;
 *  • linha 3: rótulo do caderno (KRAJ/ŚWIAT) + TVN24+ + ticker BRANCO com texto
 *    correndo (na TV ele entra cortado pela direita — aqui idem, e no vídeo anda).
 *
 * Animação (export .webm): as DUAS faixas de texto correm (data-fp-anim="ticker")
 * e o relógio vira o minuto (data-fp-anim="clock"). Tudo escala por `k` pra
 * 16:9 / 9:16 / 4:5 saírem proporcionais. No 9:16 o bloco FAKTY sobe pra linha
 * de cima (senão ele espremeria a manchete numa tela estreita).
 */

import { Field, TextField, TextArea, Segmented, FitText, type FakeModel } from './shared';
import {
  NewsStage,
  NewsBgControls,
  newsDims,
  stageMetrics,
  parseItems,
  defaultNewsBg,
  type NewsBg,
} from './news-kit';

/* Paleta TVN24: marinho profundo, azul de faixa, amarelo do "pasek". */
const NAVY = '#0b2a63';
const NAVY_DEEP = '#071c47';
const BLUE = '#134a9e';
const BLUE_BAND = 'linear-gradient(180deg,#2364c4 0%,#0f3f92 100%)';
const YELLOW_BAND = 'linear-gradient(180deg,#ffe251 0%,#f2bf00 100%)';
const WHITE_BAND = 'linear-gradient(180deg,#ffffff 0%,#e4ecf7 100%)';
const YELLOW = '#ffd400';

type S = NewsBg & {
  band: 'amarela' | 'branca';
  headline: string;
  pilne: string;
  sub: string;
  more: string;
  ticker: string;
  kicker: string;
  plus: string;
  time: string;
  nextTime: string;
  nextLabel: string;
  section: string;
  program: string;
  programSub: string;
};

/** Logo tvn24 HD (tile azul da ponta esquerda da faixa principal). */
function TvnTile({ k, w }: { k: number; w: number }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 1.5 * k,
        width: w,
        flexShrink: 0,
        background: 'linear-gradient(180deg,#2a6ccc 0%,#0c3178 100%)',
        borderRight: `${1 * k}px solid rgba(255,255,255,0.18)`,
      }}
    >
      <span style={{ color: '#fff', fontWeight: 900, fontSize: 16 * k, letterSpacing: -0.9 * k, lineHeight: 1, whiteSpace: 'nowrap' }}>
        tvn24
      </span>
      <span style={{ color: 'rgba(255,255,255,0.75)', fontWeight: 800, fontSize: 6.5 * k, letterSpacing: 1.2 * k, lineHeight: 1 }}>
        HD
      </span>
    </div>
  );
}

/** Mini-wordmark "tvn24" usado dentro do "WIĘCEJ W tvn24". */
function TvnMini({ k }: { k: number }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        background: '#fff',
        color: BLUE,
        fontWeight: 900,
        fontSize: 8 * k,
        letterSpacing: -0.4 * k,
        lineHeight: 1,
        padding: `${2 * k}px ${4 * k}px`,
        borderRadius: 2 * k,
        // a marca é minúscula — não pode herdar o uppercase da faixa
        textTransform: 'none',
      }}
    >
      tvn24
    </span>
  );
}

/** Bloco "FAKTY / PO POŁUDNIU" (marinho + barra amarela + faixa azul embaixo). */
function FaktyBlock({ k, title, sub, minW }: { k: number; title: string; sub: string; minW: number }) {
  if (!title.trim() && !sub.trim()) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flexShrink: 0, minWidth: minW }}>
      <div
        style={{
          flex: 1,
          background: NAVY_DEEP,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 3 * k,
          padding: `${6 * k}px ${10 * k}px`,
        }}
      >
        <span style={{ color: '#fff', fontWeight: 900, fontSize: 19 * k, letterSpacing: 1.6 * k, lineHeight: 1, whiteSpace: 'nowrap' }}>
          {title}
        </span>
        <span style={{ display: 'block', width: '100%', height: 2 * k, background: YELLOW }} />
      </div>
      {sub.trim() ? (
        <div
          style={{
            background: BLUE,
            color: '#fff',
            fontWeight: 700,
            fontSize: 8 * k,
            letterSpacing: 1.5 * k,
            lineHeight: 1,
            textAlign: 'center',
            whiteSpace: 'nowrap',
            padding: `${5 * k}px ${8 * k}px`,
          }}
        >
          {sub}
        </div>
      ) : null}
    </div>
  );
}

/** Uma faixa que CORRE no vídeo (itens separados por ▪), com clip próprio. */
function RunningBand({
  items,
  k,
  color,
  sepColor,
  fontSize,
}: {
  items: string[];
  k: number;
  color: string;
  sepColor: string;
  fontSize: number;
}) {
  return (
    <div
      data-fp-anim="ticker"
      style={{
        flex: 1,
        minWidth: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 8 * k,
        padding: `0 ${10 * k}px`,
        color,
        fontWeight: 700,
        fontSize,
        letterSpacing: -0.1 * k,
        lineHeight: 1,
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
      }}
    >
      {items.map((it, i) => (
        <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 * k }}>
          {i > 0 ? <span style={{ color: sepColor, fontWeight: 900 }}>▪</span> : null}
          <span>{it}</span>
        </span>
      ))}
    </div>
  );
}

function Tvn24Chyron({ s }: { s: S }) {
  const { k, orient } = stageMetrics(s.orient);
  // 9:16 é estreito: o bloco FAKTY sobe pra linha de cima em vez de espremer a
  // manchete (mesma lógica de "não deixar o chyron furar o palco" dos outros).
  const stacked = orient === 'portrait';
  const colW = 72 * k; // coluna esquerda (próximo programa / tile / relógio)
  const subItems = parseItems(s.sub);
  const tickItems = parseItems(s.ticker);
  const hasNext = !!(s.nextTime.trim() || s.nextLabel.trim());
  const yellow = s.band !== 'branca';
  const fakty = <FaktyBlock k={k} title={s.program} sub={s.programSub} minW={84 * k} />;

  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, width: '100%' }}>
      {/* Coluna de cima: caixinha do próximo programa + rótulo do bloco.
          No 9:16 o bloco FAKTY vem junto, encostado à direita. */}
      {hasNext || s.section.trim() || stacked ? (
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8 * k }}>
          {/* alignItems flex-start: cada caixa tem a largura do SEU texto (com o
              piso da coluna) — é assim no ar, o "TELESERWIS" passa da caixa da
              hora — e nenhum rótulo longo quebra linha nem vaza. */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
            {hasNext ? (
              <div
                style={{
                  minWidth: colW,
                  background: NAVY_DEEP,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 2 * k,
                  padding: `${5 * k}px ${8 * k}px`,
                }}
              >
                {s.nextTime.trim() ? (
                  <span style={{ color: YELLOW, fontWeight: 900, fontSize: 13 * k, letterSpacing: -0.3 * k, lineHeight: 1, whiteSpace: 'nowrap' }}>
                    {s.nextTime}
                  </span>
                ) : null}
                {s.nextLabel.trim() ? (
                  <span style={{ color: '#fff', fontWeight: 700, fontSize: 8 * k, letterSpacing: 0.6 * k, lineHeight: 1, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                    {s.nextLabel}
                  </span>
                ) : null}
              </div>
            ) : null}
            {s.section.trim() ? (
              <div
                style={{
                  minWidth: colW,
                  boxSizing: 'border-box',
                  background: BLUE,
                  color: '#fff',
                  fontWeight: 800,
                  fontSize: 8.5 * k,
                  letterSpacing: 0.6 * k,
                  lineHeight: 1,
                  textAlign: 'center',
                  textTransform: 'uppercase',
                  whiteSpace: 'nowrap',
                  padding: `${5 * k}px ${8 * k}px`,
                  borderTop: `${1 * k}px solid rgba(255,255,255,0.2)`,
                }}
              >
                {s.section}
              </div>
            ) : null}
          </div>
          {stacked ? fakty : null}
        </div>
      ) : null}

      {/* Miolo: linha da manchete + linha azul, com o bloco FAKTY atravessando. */}
      <div style={{ display: 'flex', alignItems: 'stretch' }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          {/* linha 1 — tile tvn24 + manchete (amarela ou branca) + PILNE */}
          <div style={{ display: 'flex', alignItems: 'stretch', minHeight: 44 * k }}>
            <TvnTile k={k} w={colW} />
            {/* A faixa é pintada UMA vez: manchete e PILNE dividem o MESMO
                gradiente (dois fundos separados saem com tons diferentes). */}
            <div
              style={{
                flex: 1,
                minWidth: 0,
                display: 'flex',
                alignItems: 'stretch',
                background: yellow ? YELLOW_BAND : WHITE_BAND,
              }}
            >
              <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', padding: `${6 * k}px ${11 * k}px` }}>
                {/* o pasek do TVN24 é de UMA linha: o FitText encolhe até caber
                    (só cai pra 2 linhas em manchete muito longa). No 9:16, onde
                    a faixa é bem mais estreita, liberamos altura pra 2-3 linhas —
                    senão a manchete encolheria a ponto de não dar pra ler. */}
                <FitText
                  maxPx={20 * k}
                  minPx={9 * k}
                  maxHeight={(stacked ? 40 : 27) * k}
                  style={{ color: NAVY, fontWeight: 800, lineHeight: 1.06, textTransform: 'uppercase', letterSpacing: -0.3 * k, width: '100%' }}
                >
                  {s.headline}
                </FitText>
              </div>
              {s.pilne.trim() ? (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    flexShrink: 0,
                    borderLeft: `${1.5 * k}px solid rgba(11,42,99,0.3)`,
                    color: NAVY,
                    fontWeight: 900,
                    fontSize: 12 * k,
                    letterSpacing: 0.5 * k,
                    lineHeight: 1,
                    textTransform: 'uppercase',
                    whiteSpace: 'nowrap',
                    padding: `0 ${9 * k}px`,
                  }}
                >
                  {s.pilne}
                </div>
              ) : null}
            </div>
          </div>

          {/* linha 2 — relógio + segunda manchete correndo + "WIĘCEJ W tvn24" */}
          {subItems.length || s.time.trim() ? (
            <div style={{ display: 'flex', alignItems: 'stretch', height: 25 * k, background: BLUE_BAND }}>
              {s.time.trim() ? (
                <div
                  style={{
                    width: colW,
                    flexShrink: 0,
                    background: NAVY_DEEP,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <span data-fp-anim="clock" style={{ color: '#fff', fontWeight: 800, fontSize: 13 * k, letterSpacing: -0.2 * k, lineHeight: 1, whiteSpace: 'nowrap' }}>
                    {s.time}
                  </span>
                </div>
              ) : null}
              <RunningBand items={subItems} k={k} color="#fff" sepColor={YELLOW} fontSize={11 * k} />
              {s.more.trim() ? (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5 * k,
                    flexShrink: 0,
                    padding: `0 ${9 * k}px`,
                    background: 'rgba(7,28,71,0.55)',
                    color: '#fff',
                    fontWeight: 800,
                    fontSize: 8.5 * k,
                    letterSpacing: 0.5 * k,
                    lineHeight: 1,
                    textTransform: 'uppercase',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {s.more}
                  <TvnMini k={k} />
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        {stacked ? null : fakty}
      </div>

      {/* linha 3 — caderno + TVN24+ + ticker branco correndo */}
      {tickItems.length ? (
        <div style={{ display: 'flex', alignItems: 'stretch', height: 24 * k, background: WHITE_BAND }}>
          {s.kicker.trim() ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                minWidth: colW,
                background: NAVY_DEEP,
                color: '#fff',
                fontWeight: 800,
                fontSize: 10 * k,
                letterSpacing: 0.6 * k,
                lineHeight: 1,
                textTransform: 'uppercase',
                whiteSpace: 'nowrap',
                padding: `0 ${7 * k}px`,
              }}
            >
              {s.kicker}
            </div>
          ) : null}
          {s.plus.trim() ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                flexShrink: 0,
                background: BLUE,
                color: '#fff',
                fontWeight: 900,
                fontSize: 10 * k,
                letterSpacing: -0.2 * k,
                lineHeight: 1,
                whiteSpace: 'nowrap',
                padding: `0 ${8 * k}px`,
              }}
            >
              {s.plus}
            </div>
          ) : null}
          <RunningBand items={tickItems} k={k} color={NAVY} sepColor="#c8102e" fontSize={11.5 * k} />
        </div>
      ) : null}
    </div>
  );
}

const TVN24: FakeModel<S> = {
  id: 'news-tvn24',
  label: 'Pasek / Fakty (Polônia)',
  category: 'news',
  group: 'TVN24',
  hue: 'rgba(19,74,158,0.4)',
  stageW: 640,
  ratio: 9 / 16,
  exportW: 1920,
  usesPhone: false,
  // duas faixas correndo + relógio virando → shell mostra 'Exportar vídeo'
  anim: true,
  vidHint:
    'O vídeo sai com as DUAS faixas correndo (a azul e a branca de baixo) e o relógio virando o minuto — com o cenário em tela verde, é só sobrepor no editor.',
  dims: (s) => newsDims(s.orient),
  defaultState: {
    ...defaultNewsBg,
    band: 'amarela',
    headline: 'NOWE PRZEPISY WCHODZĄ W ŻYCIE OD PONIEDZIAŁKU',
    pilne: 'PILNE',
    sub: 'EKSPERCI: TO NAJWIĘKSZA ZMIANA OD LAT | RESORT ZAPOWIADA KOLEJNE KONSULTACJE',
    more: 'WIĘCEJ W',
    ticker: 'SEJM PRZYJĄŁ USTAWĘ W NOCNYM GŁOSOWANIU | CENY PALIW ZNÓW W DÓŁ | SYNOPTYCY OSTRZEGAJĄ PRZED BURZAMI',
    kicker: 'KRAJ',
    plus: 'TVN24+',
    time: '16:16',
    nextTime: '20:30',
    nextLabel: 'W TVN24',
    section: 'TELESERWIS',
    program: 'FAKTY',
    programSub: 'PO POŁUDNIU',
  },
  Controls: ({ s, set }) => (
    <div className="flex flex-col gap-4">
      <NewsBgControls bg={s} set={set} />
      <Field label="Faixa da manchete" hint="As duas variantes vão ao ar: amarela (urgente) e branca.">
        <Segmented
          value={s.band}
          options={[
            { value: 'amarela', label: 'Amarela' },
            { value: 'branca', label: 'Branca' },
          ]}
          onChange={(v) => set({ band: v })}
        />
      </Field>
      <Field label="Manchete (faixa principal)">
        <TextArea value={s.headline} onChange={(v) => set({ headline: v })} placeholder="NOWE PRZEPISY WCHODZĄ W ŻYCIE" rows={2} maxLength={140} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Selo urgente"><TextField value={s.pilne} onChange={(v) => set({ pilne: v })} placeholder="PILNE" maxLength={14} /></Field>
        <Field label="Hora (roda no vídeo)"><TextField value={s.time} onChange={(v) => set({ time: v })} placeholder="16:16" maxLength={8} /></Field>
      </div>
      <Field label="Faixa azul (passa no vídeo — um por linha ou separado por |)">
        <TextArea value={s.sub} onChange={(v) => set({ sub: v })} placeholder="Segunda manchete" rows={2} maxLength={200} />
      </Field>
      <Field label="Ticker branco (passa no vídeo — um por linha ou separado por |)">
        <TextArea value={s.ticker} onChange={(v) => set({ ticker: v })} placeholder="Notícia 1 | Notícia 2" rows={2} maxLength={240} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Caderno (canto)"><TextField value={s.kicker} onChange={(v) => set({ kicker: v })} placeholder="KRAJ" maxLength={12} /></Field>
        <Field label="Selo do app"><TextField value={s.plus} onChange={(v) => set({ plus: v })} placeholder="TVN24+" maxLength={10} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Próximo programa (hora)"><TextField value={s.nextTime} onChange={(v) => set({ nextTime: v })} placeholder="20:30" maxLength={8} /></Field>
        <Field label="Próximo programa (canal)"><TextField value={s.nextLabel} onChange={(v) => set({ nextLabel: v })} placeholder="W TVN24" maxLength={14} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Rótulo do bloco"><TextField value={s.section} onChange={(v) => set({ section: v })} placeholder="TELESERWIS" maxLength={16} /></Field>
        <Field label="Chamada 'mais em'"><TextField value={s.more} onChange={(v) => set({ more: v })} placeholder="WIĘCEJ W" maxLength={16} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Programa"><TextField value={s.program} onChange={(v) => set({ program: v })} placeholder="FAKTY" maxLength={12} /></Field>
        <Field label="Programa (linha 2)"><TextField value={s.programSub} onChange={(v) => set({ programSub: v })} placeholder="PO POŁUDNIU" maxLength={18} /></Field>
      </div>
    </div>
  ),
  Preview: ({ s }) => (
    <NewsStage bg={s}>
      <Tvn24Chyron s={s} />
    </NewsStage>
  ),
};

export default [TVN24];
