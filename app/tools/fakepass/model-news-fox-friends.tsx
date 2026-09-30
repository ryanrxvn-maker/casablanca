'use client';

/**
 * FakePass — NOTÍCIAS · Fox News "Fox & Friends" (moldura de programa matinal).
 *
 * Recria o PACOTE GRÁFICO do programa (o print de referência):
 *  • moldura clara em volta da cena, com as janelas (1, 2 ou 3 quadros) e
 *    borda BRANCA em cada uma — as janelas são BURACOS: a cena do palco
 *    (imagem / vídeo / tela verde) aparece por elas;
 *  • faixa superior LARANJA com as diagonais (cunha ciano + risquinhos);
 *  • caixinha vermelha "LIVE" pousada logo acima da janela;
 *  • faixa da MANCHETE branca com texto PRETO bold uppercase (FitText);
 *  • bloco do logo "FOX NEWS" (azul-marinho + holofote) com a HORA vermelha
 *    embaixo, encavalado entre a manchete e a faixa do programa;
 *  • faixa LARANJA do programa com o nome ("FOX & FRIENDS") no centro;
 *  • tira de baixo com as diagonais (ou um TICKER, quando o rodapé é
 *    preenchido) e a cunha AZUL na direita.
 *
 * Tudo escala por `k` (16:9, 9:16 e 4:5) e todo texto é editável.
 * As decorações são SVG SEM id/gradiente (fill sólido + opacity) pra sair
 * igualzinho no PNG do html2canvas e no export de vídeo.
 */

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Field, TextField, TextArea, type FakeModel } from './shared';
import { LineBuilder } from './builder';
import {
  NewsStage,
  NewsBgControls,
  newsDims,
  stageMetrics,
  parseItems,
  defaultNewsBg,
  type NewsBg,
} from './news-kit';

/* ─────────────────────────── Paleta do programa ─────────────────────────── */

const FF_ORANGE = '#f6a01c';
const FF_ORANGE_DEEP = '#ee8f0c';
const FF_ORANGE_LIGHT = '#ffc734';
const FF_CYAN = '#45c8ee';
const FF_BLUE = '#1b2fa8';
const FF_MATTE = '#f2f3f5';
const FOX_NAVY = '#17348c';
const FOX_TIME_RED = '#9d0f1c';
const LIVE_RED = '#c5170b';

/**
 * Fonte da MANCHETE: o chyron da Fox é uma gothic CONDENSADA — uma manchete
 * longa entra numa linha só. Pegamos a condensada do sistema quando existe e
 * caímos na stack normal quando não existe (o FitLine ajusta o corpo nos dois
 * casos, então nunca estoura nem vaza no PNG).
 */
const COND_FONT =
  "'Arial Narrow', 'Liberation Sans Narrow', 'Helvetica Neue Condensed', 'Roboto Condensed', Inter, Arial, sans-serif";

type S = NewsBg & {
  live: string;
  headline: string;
  hora: string;
  programa: string;
  ticker: string;
};

const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/**
 * Manchete do chyron: tenta UMA LINHA encolhendo pela LARGURA (o FitText do
 * shared mede só ALTURA, então ele deixaria a manchete quebrar em duas linhas
 * com corpo minúsculo). Se nem no corpo mínimo a linha única couber — caso do
 * 9:16, que é estreito —, cai pra DUAS LINHAS e aí ajusta pela ALTURA, que é
 * o que o chyron vertical faz de verdade.
 */
function FitHead({
  children,
  maxPx,
  minPx,
  maxHeight,
  style,
}: {
  children: ReactNode;
  maxPx: number;
  minPx: number;
  maxHeight: number;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [st, setSt] = useState<{ px: number; wrap: boolean }>({ px: maxPx, wrap: false });
  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const passo = Math.max(0.25, maxPx / 60);
    // 1) linha única
    el.style.whiteSpace = 'nowrap';
    let size = maxPx;
    el.style.fontSize = `${size}px`;
    let guard = 0;
    while (size > minPx && el.scrollWidth > el.clientWidth + 0.5 && guard < 240) {
      size -= passo;
      el.style.fontSize = `${size}px`;
      guard += 1;
    }
    if (el.scrollWidth <= el.clientWidth + 0.5) {
      setSt({ px: size, wrap: false });
      return;
    }
    // 2) não coube com corpo legível → duas linhas, ajuste pela altura
    el.style.whiteSpace = 'normal';
    size = maxPx;
    el.style.fontSize = `${size}px`;
    guard = 0;
    while (size > 6 && el.scrollHeight > maxHeight && guard < 240) {
      size -= passo;
      el.style.fontSize = `${size}px`;
      guard += 1;
    }
    setSt({ px: size, wrap: true });
  }, [children, maxPx, minPx, maxHeight]);
  return (
    <div
      ref={ref}
      data-fp-fit=""
      style={{
        ...style,
        fontSize: st.px,
        whiteSpace: st.wrap ? 'normal' : 'nowrap',
        overflow: 'hidden',
        width: '100%',
      }}
    >
      {children}
    </div>
  );
}

/* ─────────────────────────── Geometria ─────────────────────────── */

/** Medidas do pacote gráfico (tudo em px de palco, já multiplicado por k). */
function geo(s: S) {
  const { W, k } = stageMetrics(s.orient);
  const videoMode = s.bgMode === 'video' && !!s.bgVideo;
  // espelha a decisão do NewsStage: com vídeo, a cena é 1 quadro só.
  const layout = videoMode ? (s.layout === 'pip' ? 'pip' : 'single') : (s.layout ?? 'single');
  const cols = layout === 'duplo' ? 2 : layout === 'triplo' ? 3 : 1;
  const padX = 15 * k;
  const winTop = 30 * k;
  const gapW = 9 * k;
  const spacer = 4 * k;
  const headH = 40 * k;
  const bandH = 20 * k;
  const stripH = 15 * k;
  const bottomH = spacer + headH + bandH + stripH;
  return {
    W,
    k,
    cols,
    padX,
    winTop,
    gapW,
    spacer,
    headH,
    bandH,
    stripH,
    bottomH,
    chevW: 34 * k,
    logoW: 60 * k,
    borda: Math.max(1, 2.4 * k),
  };
}

/** left/right (CSS) de cada janela — casa com os quadros do NewsStage. */
function colunas(cols: number, padX: number, gapW: number) {
  if (cols <= 1) return [{ left: `${padX}px`, right: `${padX}px` }];
  const out: { left: string; right: string }[] = [];
  for (let i = 0; i < cols; i += 1) {
    const ini = (i * 100) / cols;
    const fim = ((i + 1) * 100) / cols;
    out.push({
      left: i === 0 ? `${padX}px` : `calc(${ini.toFixed(4)}% + ${gapW / 2}px)`,
      right: i === cols - 1 ? `${padX}px` : `calc(${(100 - fim).toFixed(4)}% + ${gapW / 2}px)`,
    });
  }
  return out;
}

/* ─────────────────────────── Peças gráficas ─────────────────────────── */

/**
 * Paralelogramo inclinado (o "risco" do pacote da Fox): o topo fica DESLOCADO
 * PRA DIREITA em relação à base, igual às diagonais do programa.
 */
function Risco({
  x,
  w,
  h,
  fill,
  opacity = 1,
}: {
  x: number;
  w: number;
  h: number;
  fill: string;
  opacity?: number;
}) {
  const sl = h * 0.55;
  return (
    <polygon
      points={`${x + sl},0 ${x + sl + w},0 ${x + w},${h} ${x},${h}`}
      fill={fill}
      opacity={opacity}
    />
  );
}

/** Série de risquinhos finos (hachura) entre x0 e x1. */
function Hachura({
  x0,
  x1,
  h,
  fill,
  opacity,
  passo,
}: {
  x0: number;
  x1: number;
  h: number;
  fill: string;
  opacity: number;
  passo: number;
}) {
  const out = [];
  for (let x = x0; x < x1; x += passo) {
    out.push(<Risco key={x} x={x} w={passo * 0.34} h={h} fill={fill} opacity={opacity} />);
  }
  return <>{out}</>;
}

/** Faixa de cima: laranja com a cunha ciano à esquerda e as diagonais. */
function FaixaTopo({ W, h }: { W: number; h: number }) {
  return (
    <svg width={W} height={h} viewBox={`0 0 ${W} ${h}`} aria-hidden style={{ display: 'block' }}>
      <rect x="0" y="0" width={W} height={h} fill={FF_ORANGE} />
      <Risco x={W * 0.4} w={W * 0.22} h={h} fill={FF_ORANGE_DEEP} />
      <Risco x={W * 0.66} w={W * 0.4} h={h} fill={FF_ORANGE_LIGHT} />
      <Hachura x0={W * 0.66} x1={W * 1.02} h={h} fill="#ffffff" opacity={0.22} passo={h * 0.42} />
      <Risco x={-h} w={W * 0.1 + h} h={h} fill={FF_CYAN} />
      <Hachura x0={-h} x1={W * 0.09} h={h} fill="#ffffff" opacity={0.34} passo={h * 0.4} />
      <Risco x={W * 0.1} w={W * 0.025} h={h} fill="#ffffff" />
    </svg>
  );
}

/** Faixa do programa: laranja com diagonais (o nome vai por cima, em HTML). */
function FaixaPrograma({ W, h }: { W: number; h: number }) {
  return (
    <svg width={W} height={h} viewBox={`0 0 ${W} ${h}`} aria-hidden style={{ display: 'block' }}>
      <rect x="0" y="0" width={W} height={h} fill={FF_ORANGE} />
      {/* as diagonais ficam FORA do miolo (0.30–0.66), onde entra o nome */}
      <Risco x={W * 0.02} w={W * 0.1} h={h} fill={FF_ORANGE_DEEP} opacity={0.7} />
      <Risco x={W * 0.14} w={W * 0.14} h={h} fill={FF_ORANGE_LIGHT} opacity={0.75} />
      <Risco x={W * 0.67} w={W * 0.07} h={h} fill={FF_ORANGE_LIGHT} />
      <Risco x={W * 0.76} w={W * 0.05} h={h} fill={FF_CYAN} />
      <Risco x={W * 0.83} w={W * 0.1} h={h} fill={FF_ORANGE_DEEP} opacity={0.8} />
      <Hachura x0={W * 0.86} x1={W} h={h} fill="#ffffff" opacity={0.18} passo={h * 0.5} />
    </svg>
  );
}

/** Tira de baixo: clara com as diagonais ciano/laranja. */
function FaixaBase({ W, h }: { W: number; h: number }) {
  return (
    <svg width={W} height={h} viewBox={`0 0 ${W} ${h}`} aria-hidden style={{ display: 'block' }}>
      <rect x="0" y="0" width={W} height={h} fill="#ffffff" />
      <Risco x={W * 0.03} w={W * 0.1} h={h} fill={FF_ORANGE_LIGHT} opacity={0.85} />
      <Risco x={W * 0.17} w={W * 0.16} h={h} fill={FF_CYAN} />
      <Risco x={W * 0.36} w={W * 0.12} h={h} fill={FF_ORANGE} />
      <Risco x={W * 0.5} w={W * 0.08} h={h} fill={FF_ORANGE_LIGHT} />
      <Risco x={W * 0.62} w={W * 0.1} h={h} fill={FF_CYAN} opacity={0.85} />
    </svg>
  );
}

/** Cunha azul da direita — cobre a ponta das três faixas de baixo. */
function CunhaAzul({ w, h }: { w: number; h: number }) {
  const sl = w * 0.3;
  const passo = h * 0.16;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden style={{ display: 'block' }}>
      <polygon points={`${sl},0 ${w},0 ${w},${h} 0,${h}`} fill={FF_BLUE} />
      {Array.from({ length: 7 }).map((_, i) => (
        <Risco key={i} x={sl + passo * (i + 0.4)} w={passo * 0.3} h={h} fill="#ffffff" opacity={0.2} />
      ))}
    </svg>
  );
}

/** Holofote do logo da Fox (recriação simples, em branco). */
function Holofote({ w, h }: { w: number; h: number }) {
  return (
    <svg width={w} height={h} viewBox="0 0 40 30" aria-hidden style={{ display: 'block' }}>
      <polygon points="6,29 16,3 20,3 11,29" fill="#ffffff" />
      <polygon points="13,29 21,7 23,7 17,29" fill="#ffffff" opacity="0.55" />
      <path d="M2 12 C 12 2, 28 2, 38 12" stroke="#ffffff" strokeWidth="2" fill="none" opacity="0.85" />
    </svg>
  );
}

/* ─────────────────────────── Moldura ─────────────────────────── */

function FoxFriends({ s }: { s: S }) {
  const g = geo(s);
  const { W, k } = g;
  const cols = colunas(g.cols, g.padX, g.gapW);
  const itens = parseItems(s.ticker);
  const temTicker = itens.length > 0;

  return (
    <>
      {/* ── MOLDURA: as peças opacas em volta das janelas ── */}
      {/* faixa de cima (laranja com as diagonais) */}
      <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: g.winTop, overflow: 'hidden' }}>
        <FaixaTopo W={W} h={g.winTop} />
      </div>
      {/* laterais */}
      <div style={{ position: 'absolute', left: 0, top: g.winTop, bottom: g.bottomH, width: g.padX, background: FF_MATTE }} />
      <div style={{ position: 'absolute', right: 0, top: g.winTop, bottom: g.bottomH, width: g.padX, background: FF_MATTE }} />
      {/* vãos entre as janelas (tampam o divisor preto do palco) */}
      {Array.from({ length: Math.max(0, g.cols - 1) }).map((_, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            top: g.winTop,
            bottom: g.bottomH,
            left: `calc(${(((i + 1) * 100) / g.cols).toFixed(4)}% - ${g.gapW / 2}px)`,
            width: g.gapW,
            background: FF_MATTE,
          }}
        />
      ))}
      {/* borda branca de cada janela (a cena aparece POR DENTRO) */}
      {cols.map((c, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            top: g.winTop,
            bottom: g.bottomH,
            left: c.left,
            right: c.right,
            border: `${g.borda}px solid #ffffff`,
            boxSizing: 'border-box',
            pointerEvents: 'none',
          }}
        />
      ))}

      {/* ── Caixinha LIVE, pousada logo acima da janela ── */}
      {s.live.trim() ? (
        <div
          style={{
            position: 'absolute',
            left: g.padX + 10 * k,
            top: g.winTop - 22 * k,
            height: 19.5 * k,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5 * k,
            background: LIVE_RED,
            border: `${Math.max(1, 1.4 * k)}px solid #ffffff`,
            boxSizing: 'border-box',
            color: '#ffffff',
            fontWeight: 900,
            fontSize: 13 * k,
            letterSpacing: 1.2 * k,
            padding: `0 ${10 * k}px`,
            lineHeight: 1,
          }}
        >
          <span
            data-fp-anim="livedot"
            style={{ width: 6.5 * k, height: 6.5 * k, borderRadius: '50%', background: '#ffffff', display: 'inline-block' }}
          />
          {s.live}
        </div>
      ) : null}

      {/* ── Rodapé: manchete + faixa do programa + tira de baixo ── */}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
        {/* respiro claro entre a janela e a manchete */}
        <div style={{ height: g.spacer, background: FF_MATTE }} />

        {/* faixa da MANCHETE */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            height: g.headH,
            // cor CHAPADA (nada de gradiente): o html2canvas desenha gradiente
            // em caixa larga com banda diagonal — no PNG virava sujeira.
            background: '#fbfbfc',
            borderBottom: `${Math.max(1, 1.2 * k)}px solid #d6d7db`,
            paddingLeft: g.logoW + 13 * k,
            paddingRight: g.chevW + 8 * k,
            boxSizing: 'border-box',
            overflow: 'hidden',
          }}
        >
          <FitHead
            maxPx={26 * k}
            minPx={12 * k}
            maxHeight={g.headH - 9 * k}
            style={{
              color: '#101010',
              fontFamily: COND_FONT,
              fontWeight: 700,
              lineHeight: 1.06,
              textTransform: 'uppercase',
              letterSpacing: -0.1 * k,
            }}
          >
            {s.headline}
          </FitHead>
        </div>

        {/* faixa do PROGRAMA */}
        <div style={{ position: 'relative', height: g.bandH, overflow: 'hidden' }}>
          <div style={{ position: 'absolute', inset: 0 }}>
            <FaixaPrograma W={W} h={g.bandH} />
          </div>
          {s.programa.trim() ? (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                paddingLeft: g.logoW,
                paddingRight: g.chevW,
                boxSizing: 'border-box',
              }}
            >
              <span
                style={{
                  color: '#ffffff',
                  fontWeight: 900,
                  fontStyle: 'italic',
                  fontSize: 13 * k,
                  letterSpacing: 0.4 * k,
                  lineHeight: 1,
                  whiteSpace: 'nowrap',
                  textShadow: `0 ${1 * k}px ${2 * k}px rgba(120,60,0,0.35)`,
                }}
              >
                {s.programa}
              </span>
            </div>
          ) : null}
        </div>

        {/* tira de baixo: diagonais OU ticker */}
        <div
          style={{
            position: 'relative',
            height: g.stripH,
            overflow: 'hidden',
            background: temTicker ? '#0f1c4d' : '#ffffff',
          }}
        >
          {temTicker ? (
            <div
              data-fp-anim="ticker"
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                gap: 14 * k,
                paddingLeft: g.logoW + 18 * k,
                paddingRight: g.chevW + 12 * k,
                boxSizing: 'border-box',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
              }}
            >
              {itens.map((it, i) => (
                <span
                  key={i}
                  style={{
                    color: '#ffffff',
                    fontWeight: 800,
                    fontSize: 9.5 * k,
                    letterSpacing: 0.4 * k,
                    textTransform: 'uppercase',
                    lineHeight: 1,
                  }}
                >
                  {it}
                </span>
              ))}
            </div>
          ) : (
            <div style={{ position: 'absolute', inset: 0 }}>
              <FaixaBase W={W} h={g.stripH} />
            </div>
          )}
        </div>

        {/* cunha AZUL na direita, por cima das três faixas */}
        <div
          style={{
            position: 'absolute',
            right: 0,
            top: g.spacer,
            height: g.bottomH - g.spacer,
            width: g.chevW,
            overflow: 'hidden',
          }}
        >
          <CunhaAzul w={g.chevW} h={g.bottomH - g.spacer} />
        </div>

        {/* bloco do LOGO + HORA (encavalado na manchete e na faixa do programa) */}
        <div
          style={{
            position: 'absolute',
            left: 9 * k,
            top: g.spacer + 1 * k,
            width: g.logoW,
            height: g.headH + g.bandH - 2 * k,
            display: 'flex',
            flexDirection: 'column',
            border: `${Math.max(1, 1.2 * k)}px solid #f3e2bf`,
            boxSizing: 'border-box',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              position: 'relative',
              // alturas TRAVADAS: sem isso o texto do logo empurrava a faixa da
              // hora pra fora da caixa (o "6:34 CT" saía cortado no PNG).
              flex: s.hora.trim() ? '0 0 72%' : '1 1 100%',
              minHeight: 0,
              background: FOX_NAVY,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
            }}
          >
            <div style={{ position: 'absolute', left: 1.5 * k, top: 1.5 * k, opacity: 0.95 }}>
              <Holofote w={26 * k} h={20 * k} />
            </div>
            <span
              style={{
                position: 'relative',
                color: '#ffffff',
                fontFamily: COND_FONT,
                fontWeight: 700,
                fontSize: 15.5 * k,
                letterSpacing: 0,
                lineHeight: 1,
                paddingLeft: 11 * k,
              }}
            >
              FOX
            </span>
            <span
              style={{
                position: 'relative',
                color: '#ffffff',
                fontFamily: COND_FONT,
                fontWeight: 700,
                fontSize: 15.5 * k,
                letterSpacing: 0,
                lineHeight: 1.08,
              }}
            >
              NEWS
            </span>
          </div>
          {s.hora.trim() ? (
            <div
              style={{
                flex: '0 0 28%',
                minHeight: 0,
                background: FOX_TIME_RED,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <span
                data-fp-anim="clock"
                style={{ color: '#ffffff', fontWeight: 900, fontSize: 10.5 * k, letterSpacing: 0.4 * k, lineHeight: 1 }}
              >
                {s.hora}
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}

/* ─────────────────────────── Modelo ─────────────────────────── */

const FOX_FRIENDS: FakeModel<S> = {
  id: 'news-fox-friends',
  label: 'Fox & Friends / Split',
  category: 'news',
  group: 'Fox News',
  hue: 'rgba(246,160,28,0.42)',
  stageW: 640,
  ratio: 9 / 16,
  exportW: 1920,
  usesPhone: false,
  anim: true,
  vidHint: 'Relógio, bolinha do LIVE e rodapé correndo.',
  dims: (s) => newsDims(s.orient),
  defaultState: {
    ...defaultNewsBg,
    layout: 'duplo',
    live: 'LIVE',
    headline: 'Officials announce new plan in morning briefing',
    hora: '6:34 CT',
    programa: 'FOX & FRIENDS',
    ticker: '',
  },
  Controls: ({ s, set }) => (
    <div className="flex flex-col gap-4">
      <NewsBgControls bg={s} set={set} />
      <Field label="Manchete (faixa branca)">
        <TextArea
          value={s.headline}
          onChange={(v) => set({ headline: v })}
          placeholder="OFFICIALS ANNOUNCE NEW PLAN IN MORNING BRIEFING"
          rows={2}
          maxLength={140}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="LIVE (caixinha vermelha)">
          <TextField value={s.live} onChange={(v) => set({ live: v })} placeholder="LIVE" maxLength={12} />
        </Field>
        <Field label="Hora (embaixo do logo)">
          <TextField value={s.hora} onChange={(v) => set({ hora: v })} placeholder="6:34 CT" maxLength={12} />
        </Field>
      </div>
      <Field label="Nome do programa (faixa laranja)">
        <TextField value={s.programa} onChange={(v) => set({ programa: v })} placeholder="FOX & FRIENDS" maxLength={30} />
      </Field>
      <Field label="Rodapé (opcional)" hint="Vazio = as diagonais do programa. Preenchido = ticker azul correndo.">
        <LineBuilder value={s.ticker} onChange={(v) => set({ ticker: v })} placeholder="Manchete do rodapé" addLabel="Item" pipe />
      </Field>
    </div>
  ),
  Preview: ({ s }) => {
    const { H, orient } = stageMetrics(s.orient);
    // O NewsStage reserva 5% abaixo do chyron no 9:16. Esta moldura é um
    // pacote de tela inteira: estendê-la até a base mantém janelas e rodapé
    // alinhados sem alterar o comportamento dos outros telejornais.
    const lift = orient === 'portrait' ? Math.round(H * 0.05) : 0;
    return (
      <NewsStage bg={s}>
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: -lift, left: 0 }}>
          <FoxFriends s={s} />
        </div>
      </NewsStage>
    );
  },
};

export default [FOX_FRIENDS];
