'use client';

/**
 * FakePass — NOTÍCIAS · Bem Estar (g1 / Globo).
 * Layout de ENTREVISTA vertical (9:16) do programa Bem Estar. DOIS modos:
 *  • 2 pessoas → DOIS quadros de vídeo empilhados (topo/baixo);
 *  • 1 pessoa  → UM quadro grande centralizado.
 * TELA VERDE por padrão (chroma) pra encaixar os avatares (ou imagem enviada), com a
 * marca "bem estar" + "g1" no canto superior esquerdo, os ACENTOS coloridos da marca
 * (verde/amarelo/laranja/teal) e uma ONDA verde no rodapé. Recria o GRÁFICO do
 * programa (paródia/mockup).
 *
 * ⚠️ A ONDA é ASSADA num <canvas> e vira <img>: o html2canvas NÃO desenha `<svg>` com
 * path curvo (Q/T + preserveAspectRatio) — sumia no download. Como <img> ela sai fiel.
 */

import { useState, useEffect, type ReactNode } from 'react';
import { Field, ImageUpload, Swatches, Segmented, FONT_STACK, type FakeModel } from './shared';

/** Verde de chroma key (broadcast). */
const CHROMA = '#00b140';
/** Cores da marca Bem Estar. */
const TEAL = '#15b3a6'; // caixa do logo
const A_GREEN = '#8cc63f';
const A_YELLOW = '#ffc20e';
const A_ORANGE = '#f5821f';
const A_TEAL = '#2bbdb2';

type S = {
  layout: 'single' | 'double'; // 1 pessoa (1 tela) ou 2 pessoas (2 telas)
  topImg: string; // dataURL (quadro de cima / único) — vazio = tela verde
  bottomImg: string; // dataURL (quadro de baixo) — só no modo 2 telas
  green: string; // tom do chroma
};

function panelBg(img: string, chroma: string): string {
  return img ? `url("${img}") center/cover no-repeat` : chroma;
}

/**
 * Onda verde do rodapé ASSADA num canvas (o html2canvas não desenha o <svg> path).
 * Mesma curva do original (M0,54 L0,26 Q.3W,0 .58W,20 T W,14 L W,54 Z) em proporção h/54.
 */
function BemWave({ W, h, color }: { W: number; h: number; color: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const dpr = 3;
    const cv = document.createElement('canvas');
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(h * dpr);
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, h);
    ctx.lineTo(0, 0.481 * h); // 26/54
    ctx.quadraticCurveTo(0.3 * W, 0, 0.58 * W, 0.37 * h); // Q .3W,0 .58W,20
    ctx.quadraticCurveTo(0.86 * W, 0.74 * h, W, 0.259 * h); // T W,14 (controle refletido)
    ctx.lineTo(W, h);
    ctx.closePath();
    ctx.fill();
    setUrl(cv.toDataURL('image/png'));
  }, [W, h, color]);
  if (!url) return null;
  return <img src={url} alt="" style={{ position: 'absolute', left: 0, bottom: 0, width: W, height: h, display: 'block' }} />;
}

/** Selo "bem estar" (caixa teal arredondada) + "g1" branco embaixo. */
function BemEstarMark({ k }: { k: number }) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 15 * k,
        left: 15 * k,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 6 * k,
      }}
    >
      <div
        style={{
          background: TEAL,
          borderRadius: 15 * k,
          padding: `${7 * k}px ${11 * k}px ${8 * k}px`,
          lineHeight: 1.02,
        }}
      >
        <div style={{ color: '#fff', fontWeight: 800, fontSize: 16 * k, letterSpacing: -0.3 * k }}>bem</div>
        <div style={{ color: '#fff', fontWeight: 800, fontSize: 16 * k, letterSpacing: -0.3 * k }}>estar</div>
      </div>
      <span
        style={{
          color: '#fff',
          fontWeight: 800,
          fontSize: 23 * k,
          letterSpacing: -0.5 * k,
          lineHeight: 1,
          textShadow: `0 ${1 * k}px ${3 * k}px rgba(0,0,0,0.45)`,
        }}
      >
        g1
      </span>
    </div>
  );
}

/** Acentos coloridos da marca (verde+amarelo à esquerda, teal+laranja à direita). */
function Accents({ midY, k }: { midY: number; k: number }) {
  const barW = 11 * k;
  const barH = 44 * k;
  return (
    <>
      <div style={{ position: 'absolute', left: 0, top: midY - barH - 1 * k, width: barW, height: barH, background: A_GREEN, borderRadius: `0 ${4 * k}px ${4 * k}px 0` }} />
      <div style={{ position: 'absolute', left: 0, top: midY + 1 * k, width: barW, height: barH, background: A_YELLOW, borderRadius: `0 ${4 * k}px ${4 * k}px 0` }} />
      <div style={{ position: 'absolute', right: 0, top: midY - barH - 1 * k, width: barW, height: barH, background: A_TEAL, borderRadius: `${4 * k}px 0 0 ${4 * k}px` }} />
      <div style={{ position: 'absolute', right: 0, top: midY + 1 * k, width: barW, height: barH, background: A_ORANGE, borderRadius: `${4 * k}px 0 0 ${4 * k}px` }} />
    </>
  );
}

function BemEstarStage({ s }: { s: S }) {
  const W = 360;
  const H = 640; // 9:16 no palco (exporta 1080×1920)
  const k = 1;
  const green = s.green || CHROMA;
  const isSingle = s.layout === 'single';

  // Quadros REDUZIDOS e centralizados (não borda a borda). Fundo branco da marca.
  const M = 12 * k; // margem lateral/topo
  const BM = 44 * k; // margem inferior (espaço da onda)
  const waveH = 54 * k;
  const rad = 16 * k;
  const panelW = W - 2 * M;

  let panels: ReactNode;
  let accentY: number;
  if (isSingle) {
    // UM quadro grande, centralizado verticalmente entre o topo e a onda.
    const panelH = Math.round(panelW * 1.35); // grande, levemente retrato
    const panelTop = Math.round((M + (H - BM)) / 2 - panelH / 2);
    accentY = panelTop + panelH / 2;
    panels = (
      <div style={{ position: 'absolute', left: M, top: panelTop, width: panelW, height: panelH, background: panelBg(s.topImg, green), borderRadius: rad }} />
    );
  } else {
    // DOIS quadros empilhados.
    const G = 10 * k; // vão entre os quadros
    const panelH = (H - M - BM - G) / 2;
    const topY = M;
    const botY = M + panelH + G;
    accentY = M + panelH + G / 2;
    panels = (
      <>
        <div style={{ position: 'absolute', left: M, top: topY, width: panelW, height: panelH, background: panelBg(s.topImg, green), borderRadius: rad }} />
        <div style={{ position: 'absolute', left: M, top: botY, width: panelW, height: panelH, background: panelBg(s.bottomImg, green), borderRadius: rad }} />
      </>
    );
  }

  return (
    <div
      style={{
        position: 'relative',
        width: W,
        height: H,
        overflow: 'hidden',
        background: '#ffffff',
        fontFamily: FONT_STACK,
        WebkitFontSmoothing: 'antialiased',
        borderRadius: 26 * k,
        border: `${1.5 * k}px solid #e8e8e8`,
        boxSizing: 'border-box',
      }}
    >
      {panels}
      <Accents midY={accentY} k={k} />
      <BemWave W={W} h={waveH} color={A_GREEN} />
      <BemEstarMark k={k} />
    </div>
  );
}

const BEMESTAR: FakeModel<S> = {
  id: 'news-bemestar',
  label: 'Entrevista',
  category: 'news',
  group: 'Bem Estar',
  hue: 'rgba(21,179,166,0.4)',
  stageW: 360,
  ratio: 16 / 9, // vertical 9:16
  exportW: 1080,
  usesPhone: false,
  dims: () => ({ stageW: 360, ratio: 16 / 9, exportW: 1080 }),
  defaultState: {
    layout: 'double',
    topImg: '',
    bottomImg: '',
    green: CHROMA,
  },
  Controls: ({ s, set }) => {
    const single = s.layout === 'single';
    return (
      <div className="flex flex-col gap-4">
        <Field label="Quantas pessoas" hint="1 pessoa = uma tela grande; 2 pessoas = duas telas empilhadas.">
          <Segmented
            value={s.layout || 'double'}
            options={[
              { value: 'single', label: '1 pessoa' },
              { value: 'double', label: '2 pessoas' },
            ]}
            onChange={(v) => set({ layout: v })}
          />
        </Field>
        <Field label={single ? 'Quadro (avatar/vídeo)' : 'Quadro de CIMA'} hint="Vazio = tela verde (chroma) pra encaixar o avatar.">
          <ImageUpload value={s.topImg} onChange={(v) => set({ topImg: v })} label={single ? 'quadro' : 'quadro de cima'} />
        </Field>
        {!single ? (
          <Field label="Quadro de BAIXO" hint="Onde entra o 2º avatar/vídeo. Vazio = tela verde (chroma).">
            <ImageUpload value={s.bottomImg} onChange={(v) => set({ bottomImg: v })} label="quadro de baixo" />
          </Field>
        ) : null}
        <Field label="Tom do verde (chroma)" hint="Padrão de chroma key broadcast.">
          <Swatches value={s.green} colors={[CHROMA, '#00ff00', '#009e3a', '#3cb043']} onChange={(v) => set({ green: v })} />
        </Field>
      </div>
    );
  },
  Preview: ({ s }) => <BemEstarStage s={s} />,
};

export default [BEMESTAR];
