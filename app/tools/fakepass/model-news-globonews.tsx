'use client';

/**
 * FakePass — NOTÍCIAS · GloboNews (Brasil).
 * Wordmark "GloboNews" (ⓖ + "News") no canto sup. direito + caixinha vermelha
 * "AO VIVO / URGENTE". Rótulo VERTICAL vermelho à esquerda ("Conexão GloboNews"
 * + data + hora). Rodapé: tag vermelha do assunto acima de uma faixa PRETA
 * semi-transparente com manchete BRANCA bold (FitText) + sub-manchete cinza.
 * Ticker embaixo com caixinha "g1" vermelha + itens.
 * Recria o GRÁFICO do telejornal; todo texto é editável (placeholder fake).
 */

import { useState, useEffect, useRef } from 'react';
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

const RED = '#e30613';

/**
 * Rótulo VERTICAL vermelho da esquerda ("Conexão GloboNews · data · hora").
 *
 * O html2canvas EMBARALHA texto em `writing-mode: vertical` e renderiza texto
 * rotacionado com MÉTRICA errada (~0.84×) — ou seja, download ≠ prévia de
 * qualquer jeito com CSS. Solução à prova de bala (mesmo padrão do doodle do
 * WhatsApp): assamos o rótulo (fundo vermelho + texto BRANCO rotacionado −90°,
 * lendo de baixo pra cima) num `<canvas>` e renderizamos como `<img>` — o
 * html2canvas desenha `<img>` FIEL, então PRÉVIA === DOWNLOAD, pixel a pixel.
 * Usa a MESMA fonte carregada na página (pega a família resolvida de um probe).
 */
function GloboSideLabel({ label, dateTime, k }: { label: string; dateTime: string; k: number }) {
  const probe = useRef<HTMLSpanElement | null>(null);
  const [img, setImg] = useState<{ url: string; w: number; h: number } | null>(null);
  useEffect(() => {
    const el = probe.current;
    if (!el || typeof document === 'undefined') return;
    const family = getComputedStyle(el).fontFamily;
    const dpr = 3; // superamostragem p/ nitidez no export (que roda a ~3×)
    const padH = 8 * k;
    const padV = 5 * k;
    const gap = 6 * k;
    const fsA = 12 * k;
    const fsB = 10.5 * k;
    const lsA = 0.5 * k;
    const lsB = 0.3 * k;
    const mc = document.createElement('canvas').getContext('2d');
    if (!mc) return;
    const measure = (txt: string, fs: number, weight: number, ls: number) => {
      mc.font = `${weight} ${fs}px ${family}`;
      (mc as unknown as { letterSpacing: string }).letterSpacing = `${ls}px`;
      return mc.measureText(txt).width;
    };
    const wA = label ? measure(label, fsA, 800, lsA) : 0;
    const wB = dateTime ? measure(dateTime, fsB, 600, lsB) : 0;
    const inner = wA + (wA && wB ? gap : 0) + wB;
    const L = padH * 2 + inner; // comprimento → vira a ALTURA da barra vertical
    const T = padV * 2 + fsA; // espessura → vira a LARGURA da barra
    const cv = document.createElement('canvas');
    cv.width = Math.ceil(T * dpr);
    cv.height = Math.ceil(L * dpr);
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    // rotaciona −90° (leitura de baixo pra cima, glifos tombados p/ a esquerda)
    ctx.translate(0, L);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = RED;
    ctx.fillRect(0, 0, L, T);
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'middle';
    let x = padH;
    if (label) {
      ctx.font = `800 ${fsA}px ${family}`;
      (ctx as unknown as { letterSpacing: string }).letterSpacing = `${lsA}px`;
      ctx.fillText(label, x, T / 2);
      x += wA + gap;
    }
    if (dateTime) {
      ctx.font = `600 ${fsB}px ${family}`;
      (ctx as unknown as { letterSpacing: string }).letterSpacing = `${lsB}px`;
      ctx.globalAlpha = 0.92;
      ctx.fillText(dateTime, x, T / 2);
      ctx.globalAlpha = 1;
    }
    setImg({ url: cv.toDataURL('image/png'), w: T, h: L });
  }, [label, dateTime, k]);
  return (
    <>
      {/* probe invisível: só pra ler a família da fonte JÁ resolvida (Inter) */}
      <span ref={probe} aria-hidden style={{ position: 'absolute', visibility: 'hidden', fontSize: 0, lineHeight: 0 }}>
        .
      </span>
      {img ? (
        <img src={img.url} alt="" style={{ position: 'absolute', left: 0, bottom: 92 * k, width: img.w, height: img.h }} />
      ) : null}
    </>
  );
}

type S = NewsBg & {
  topTag: string;
  sectionTag: string;
  headline: string;
  sub: string;
  leftLabel: string;
  date: string;
  time: string;
  ticker: string;
};

/** Wordmark aproximado: ⓖ (círculo cinza) + "News" branco. */
function GloboNewsMark({ k }: { k: number }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 * k, flexShrink: 0 }}>
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 21 * k,
          height: 21 * k,
          borderRadius: '50%',
          background: 'linear-gradient(145deg,#c9c9c9,#8f8f8f)',
          color: '#1a1a1a',
          fontWeight: 900,
          fontSize: 14 * k,
          fontStyle: 'italic',
          lineHeight: 1,
          boxShadow: `inset 0 ${1 * k}px ${1 * k}px rgba(255,255,255,0.4)`,
        }}
      >
        g
      </span>
      <span style={{ color: '#fff', fontWeight: 800, fontSize: 17 * k, letterSpacing: -0.3 * k, lineHeight: 1 }}>
        News
      </span>
    </div>
  );
}

function GloboNewsChyron({ s }: { s: S }) {
  const { W, k } = stageMetrics(s.orient);
  const items = parseItems(s.ticker);
  const hasLeft = s.leftLabel.trim() || s.date.trim() || s.time.trim();

  return (
    <>
      {/* Canto superior direito: wordmark + caixinha vermelha AO VIVO/URGENTE */}
      <div
        style={{
          position: 'absolute',
          top: 12 * k,
          right: 12 * k,
          display: 'flex',
          alignItems: 'center',
          gap: 8 * k,
        }}
      >
        <GloboNewsMark k={k} />
        {s.topTag.trim() ? (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              background: RED,
              color: '#fff',
              fontWeight: 800,
              fontSize: 12 * k,
              letterSpacing: 0.5 * k,
              padding: `${4 * k}px ${8 * k}px`,
              lineHeight: 1,
              textTransform: 'uppercase',
            }}
          >
            {s.topTag}
          </span>
        ) : null}
      </div>

      {/* Rótulo VERTICAL vermelho à esquerda — ASSADO como <img> (ver GloboSideLabel):
          o html2canvas não desenha writing-mode:vertical nem texto rotacionado fiel,
          então prévia === download só com imagem. */}
      {hasLeft ? (
        <GloboSideLabel
          label={s.leftLabel.trim()}
          dateTime={[s.date.trim(), s.time.trim()].filter(Boolean).join('  ')}
          k={k}
        />
      ) : null}

      {/* Chyron inferior */}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, width: '100%' }}>
        {/* tag vermelha do assunto (acima da faixa) */}
        {s.sectionTag.trim() ? (
          <div style={{ paddingLeft: 14 * k }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                background: RED,
                color: '#fff',
                fontWeight: 800,
                fontSize: 13 * k,
                letterSpacing: 0.4 * k,
                padding: `${5 * k}px ${11 * k}px`,
                lineHeight: 1,
                textTransform: 'uppercase',
              }}
            >
              {s.sectionTag}
            </span>
          </div>
        ) : null}

        {/* faixa preta semi-transparente: manchete + sub */}
        <div
          style={{
            background: 'rgba(0,0,0,0.82)',
            padding: `${11 * k}px ${14 * k}px ${12 * k}px`,
            display: 'flex',
            flexDirection: 'column',
            gap: 4 * k,
          }}
        >
          <FitText
            maxPx={26 * k}
            minPx={14 * k}
            maxHeight={72 * k}
            style={{ color: '#fff', fontWeight: 800, lineHeight: 1.08, textTransform: 'uppercase', letterSpacing: -0.2 * k }}
          >
            {s.headline}
          </FitText>
          {s.sub.trim() ? (
            <span style={{ color: 'rgba(230,230,230,0.85)', fontWeight: 500, fontSize: 13 * k, lineHeight: 1.2 }}>
              {s.sub}
            </span>
          ) : null}
        </div>

        {/* ticker: caixinha g1 vermelha + itens */}
        {items.length ? (
          <div style={{ display: 'flex', alignItems: 'stretch', height: 28 * k, background: '#111', color: '#fff', overflow: 'hidden' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                background: RED,
                color: '#fff',
                fontWeight: 900,
                fontStyle: 'italic',
                fontSize: 15 * k,
                letterSpacing: -0.5 * k,
                padding: `0 ${11 * k}px`,
                flexShrink: 0,
              }}
            >
              g1
            </div>
            <div data-fp-anim="ticker" style={{ display: 'flex', alignItems: 'center', gap: 8 * k, padding: `0 ${12 * k}px`, fontSize: 12 * k, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden' }}>
              {items.map((it, i) => (
                <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 * k }}>
                  {i > 0 ? <span style={{ color: RED, fontWeight: 900 }}>▪</span> : null}
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

const GLOBONEWS: FakeModel<S> = {
  id: 'news-globonews',
  label: 'Breaking / Lower-third',
  category: 'news',
  group: 'GloboNews',
  hue: 'rgba(227,6,19,0.4)',
  stageW: 640,
  ratio: 9 / 16,
  exportW: 1920,
  usesPhone: false,
  // tem relógio/ticker/bolinha AO VIVO animáveis → shell mostra 'Exportar vídeo'
  anim: true,
  dims: (s) => newsDims(s.orient),
  defaultState: {
    ...defaultNewsBg,
    topTag: 'AO VIVO',
    sectionTag: 'FOME NO BRASIL',
    headline: 'Investigação aponta novos desdobramentos no caso',
    sub: 'Autoridades detalham as próximas etapas da apuração',
    leftLabel: 'Conexão GloboNews',
    date: '8 FEV',
    time: '11:07',
    ticker: 'Novo relatório revela dados inéditos sobre o setor | Mercado reage à decisão',
  },
  Controls: ({ s, set }) => (
    <div className="flex flex-col gap-4">
      <NewsBgControls bg={s} set={set} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Selo (canto)"><TextField value={s.topTag} onChange={(v) => set({ topTag: v })} placeholder="AO VIVO" maxLength={14} /></Field>
        <Field label="Assunto (tag vermelha)"><TextField value={s.sectionTag} onChange={(v) => set({ sectionTag: v })} placeholder="FOME NO BRASIL" maxLength={32} /></Field>
      </div>
      <Field label="Manchete"><TextArea value={s.headline} onChange={(v) => set({ headline: v })} placeholder="Manchete principal" rows={2} maxLength={140} /></Field>
      <Field label="Sub-manchete"><TextField value={s.sub} onChange={(v) => set({ sub: v })} placeholder="Linha de apoio" maxLength={90} /></Field>
      <Field label="Rótulo vertical (esquerda)"><TextField value={s.leftLabel} onChange={(v) => set({ leftLabel: v })} placeholder="Conexão GloboNews" maxLength={28} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Data"><TextField value={s.date} onChange={(v) => set({ date: v })} placeholder="8 FEV" maxLength={12} /></Field>
        <Field label="Hora"><TextField value={s.time} onChange={(v) => set({ time: v })} placeholder="11:07" maxLength={8} /></Field>
      </div>
      <Field label="Ticker (um por linha ou separado por |)"><TextArea value={s.ticker} onChange={(v) => set({ ticker: v })} placeholder="Notícia 1 | Notícia 2" rows={2} maxLength={200} /></Field>
    </div>
  ),
  Preview: ({ s }) => (
    <NewsStage bg={s}>
      <GloboNewsChyron s={s} />
    </NewsStage>
  ),
};

export default [GLOBONEWS];
