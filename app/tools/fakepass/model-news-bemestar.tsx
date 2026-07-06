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
  const mid = Math.round(H / 2);
  const seam = 2 * k; // linha branca entre os quadros
  const barW = 11 * k;
  const barH = 46 * k;

  return (
    <div
      style={{
        position: 'relative',
        width: W,
        height: H,
        overflow: 'hidden',
        background: '#0e0e0e',
        fontFamily: FONT_STACK,
        WebkitFontSmoothing: 'antialiased',
      }}
    >
      {/* ── Quadro de cima (avatar 1) ── */}
      <div style={{ position: 'absolute', top: 0, left: 0, width: W, height: mid - seam / 2, background: panelBg(s.topImg, green) }} />
      {/* ── Quadro de baixo (avatar 2) ── */}
      <div style={{ position: 'absolute', top: mid + seam / 2, left: 0, width: W, height: H - mid - seam / 2, background: panelBg(s.bottomImg, green) }} />
      {/* emenda branca */}
      <div style={{ position: 'absolute', top: mid - seam / 2, left: 0, width: W, height: seam, background: '#ffffff' }} />

      {/* ── Acentos coloridos da marca na emenda ── */}
      {/* esquerda: verde (em cima) + amarelo (embaixo) */}
      <div style={{ position: 'absolute', left: 0, top: mid - barH - 2 * k, width: barW, height: barH, background: A_GREEN, borderRadius: `0 ${4 * k}px ${4 * k}px 0` }} />
      <div style={{ position: 'absolute', left: 0, top: mid + 2 * k, width: barW, height: barH, background: A_YELLOW, borderRadius: `0 ${4 * k}px ${4 * k}px 0` }} />
      {/* direita: teal (em cima) + laranja (embaixo) */}
      <div style={{ position: 'absolute', right: 0, top: mid - barH - 2 * k, width: barW, height: barH, background: A_TEAL, borderRadius: `${4 * k}px 0 0 ${4 * k}px` }} />
      <div style={{ position: 'absolute', right: 0, top: mid + 2 * k, width: barW, height: barH, background: A_ORANGE, borderRadius: `${4 * k}px 0 0 ${4 * k}px` }} />

      {/* ── Onda verde no rodapé ── */}
      <svg
        width={W}
        height={72 * k}
        viewBox={`0 0 ${W} 72`}
        preserveAspectRatio="none"
        style={{ position: 'absolute', left: 0, bottom: 0, display: 'block' }}
      >
        <path d={`M0,72 L0,34 Q${W * 0.32},2 ${W * 0.6},26 T${W},20 L${W},72 Z`} fill={A_GREEN} />
      </svg>

      {/* ── Selo bem estar + g1 ── */}
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
