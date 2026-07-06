'use client';

/**
 * FakePass — NOTÍCIAS · Bem Estar (g1 / Globo).
 * Layout de ENTREVISTA vertical (9:16) do programa Bem Estar: DOIS quadros de vídeo
 * empilhados (topo/baixo) — TELA VERDE por padrão (chroma) pra encaixar os avatares
 * (ou imagem enviada) — com a marca "bem estar" + "g1" no canto superior esquerdo,
 * os ACENTOS coloridos da marca (verde/amarelo/laranja/teal) na emenda entre os
 * quadros e uma ONDA verde no rodapé. Recria o GRÁFICO do programa (paródia/mockup).
 */

import { Field, ImageUpload, Swatches, FONT_STACK, type FakeModel } from './shared';

/** Verde de chroma key (broadcast). */
const CHROMA = '#00b140';
/** Cores da marca Bem Estar. */
const TEAL = '#15b3a6'; // caixa do logo
const A_GREEN = '#8cc63f';
const A_YELLOW = '#ffc20e';
const A_ORANGE = '#f5821f';
const A_TEAL = '#2bbdb2';

type S = {
  topImg: string; // dataURL (quadro de cima) — vazio = tela verde
  bottomImg: string; // dataURL (quadro de baixo)
  green: string; // tom do chroma
};

function panelBg(img: string, chroma: string): string {
  return img ? `url("${img}") center/cover no-repeat` : chroma;
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

function BemEstarStage({ s }: { s: S }) {
  const W = 360;
  const H = 640; // 9:16 no palco (exporta 1080×1920)
  const k = 1;
  const green = s.green || CHROMA;

  // Quadros REDUZIDOS e centralizados (não borda a borda): margem em volta + cantos
  // arredondados. Fundo branco da marca; os avatares ficam em duas janelas verdes.
  const M = 13 * k; // margem lateral e do topo
  const BM = 48 * k; // margem inferior (onda)
  const G = 9 * k; // vão entre os dois quadros
  const rad = 16 * k;
  const panelW = W - 2 * M;
  const panelH = (H - M - BM - G) / 2;
  const topY = M;
  const botY = M + panelH + G;
  const seamY = M + panelH + G / 2; // centro do vão
  const barW = 11 * k;
  const barH = 44 * k;

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
        // borda GERAL do card levemente arredondada + linha fina (não confundir com
        // o arredondado dos quadros verdes).
        borderRadius: 26 * k,
        border: `${1.5 * k}px solid #e8e8e8`,
        boxSizing: 'border-box',
      }}
    >
      {/* ── Quadro de cima (avatar 1) ── */}
      <div style={{ position: 'absolute', left: M, top: topY, width: panelW, height: panelH, background: panelBg(s.topImg, green), borderRadius: rad }} />
      {/* ── Quadro de baixo (avatar 2) ── */}
      <div style={{ position: 'absolute', left: M, top: botY, width: panelW, height: panelH, background: panelBg(s.bottomImg, green), borderRadius: rad }} />

      {/* ── Acentos coloridos da marca no vão, colados nas bordas ── */}
      {/* esquerda: verde (em cima) + amarelo (embaixo) */}
      <div style={{ position: 'absolute', left: 0, top: seamY - barH - 1 * k, width: barW, height: barH, background: A_GREEN, borderRadius: `0 ${4 * k}px ${4 * k}px 0` }} />
      <div style={{ position: 'absolute', left: 0, top: seamY + 1 * k, width: barW, height: barH, background: A_YELLOW, borderRadius: `0 ${4 * k}px ${4 * k}px 0` }} />
      {/* direita: teal (em cima) + laranja (embaixo) */}
      <div style={{ position: 'absolute', right: 0, top: seamY - barH - 1 * k, width: barW, height: barH, background: A_TEAL, borderRadius: `${4 * k}px 0 0 ${4 * k}px` }} />
      <div style={{ position: 'absolute', right: 0, top: seamY + 1 * k, width: barW, height: barH, background: A_ORANGE, borderRadius: `${4 * k}px 0 0 ${4 * k}px` }} />

      {/* ── Onda verde no rodapé ── */}
      <svg
        width={W}
        height={54 * k}
        viewBox={`0 0 ${W} 54`}
        preserveAspectRatio="none"
        style={{ position: 'absolute', left: 0, bottom: 0, display: 'block' }}
      >
        <path d={`M0,54 L0,26 Q${W * 0.3},0 ${W * 0.58},20 T${W},14 L${W},54 Z`} fill={A_GREEN} />
      </svg>

      {/* ── Selo bem estar + g1 (sobre o quadro de cima) ── */}
      <BemEstarMark k={k} />
    </div>
  );
}

const BEMESTAR: FakeModel<S> = {
  id: 'news-bemestar',
  label: 'Entrevista · 2 telas',
  category: 'news',
  group: 'Bem Estar',
  hue: 'rgba(21,179,166,0.4)',
  stageW: 360,
  ratio: 16 / 9, // vertical 9:16
  exportW: 1080,
  usesPhone: false,
  dims: () => ({ stageW: 360, ratio: 16 / 9, exportW: 1080 }),
  defaultState: {
    topImg: '',
    bottomImg: '',
    green: CHROMA,
  },
  Controls: ({ s, set }) => (
    <div className="flex flex-col gap-4">
      <Field label="Quadro de CIMA" hint="Onde entra o 1º avatar/vídeo. Vazio = tela verde (chroma).">
        <ImageUpload value={s.topImg} onChange={(v) => set({ topImg: v })} label="quadro de cima" />
      </Field>
      <Field label="Quadro de BAIXO" hint="Onde entra o 2º avatar/vídeo. Vazio = tela verde (chroma).">
        <ImageUpload value={s.bottomImg} onChange={(v) => set({ bottomImg: v })} label="quadro de baixo" />
      </Field>
      <Field label="Tom do verde (chroma)" hint="Padrão de chroma key broadcast.">
        <Swatches value={s.green} colors={[CHROMA, '#00ff00', '#009e3a', '#3cb043']} onChange={(v) => set({ green: v })} />
      </Field>
    </div>
  ),
  Preview: ({ s }) => <BemEstarStage s={s} />,
};

export default [BEMESTAR];
