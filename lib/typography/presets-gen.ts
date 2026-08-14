/**
 * GERADOR de variantes curadas da Tipografia Automática.
 *
 * REGRA DE AUDITORIA (pedido do user): variante só existe se muda a
 * ESTRUTURA do lettering — fonte com personalidade própria, composição,
 * efeito. Cor NUNCA gera variante (o accent é editável no painel); cada
 * modelo apenas ESTREIA com uma cor padrão diferente pra galeria mostrar
 * variedade sem duplicar lettering.
 */

import type { TypoPreset } from './engine';
import { TYPO_FONTS, type FontKey } from './fonts';

const WHITE = '#ffffff';
const INK = '#0f0f10';

// cores padrão rotativas (só o DEFAULT de estreia — user troca no painel)
const ACC = ['#ffd60a', '#ff2d55', '#22d3ee', '#f472b6', '#2eff4f', '#ff9f0a', '#a78bfa'];
const DARK: Record<string, string> = {
  '#ffd60a': '#6b5200',
  '#ff2d55': '#5c0a1c',
  '#22d3ee': '#064a5c',
  '#f472b6': '#5c1440',
  '#2eff4f': '#0b6b1d',
  '#ff9f0a': '#6b3a00',
  '#a78bfa': '#3a2470',
};
const GRAD: Record<string, Array<[number, string]>> = {
  '#ffd60a': [[0, '#fff3c4'], [0.42, '#ffcd3c'], [0.62, '#a06b00'], [1, '#e2a52e']],
  '#ff2d55': [[0, '#ffb3ba'], [0.42, '#ff2d55'], [0.62, '#a30f2d'], [1, '#e0244a']],
  '#22d3ee': [[0, '#c8f4ff'], [0.42, '#22d3ee'], [0.62, '#0b6b85'], [1, '#1fb6d0']],
  '#f472b6': [[0, '#ffd6ec'], [0.42, '#f472b6'], [0.62, '#98276a'], [1, '#e05aa4']],
  '#2eff4f': [[0, '#d8ffde'], [0.42, '#2eff4f'], [0.62, '#0e8a26'], [1, '#25e045']],
  '#ff9f0a': [[0, '#ffe9c4'], [0.42, '#ff9f0a'], [0.62, '#9c5a00'], [1, '#e58e09']],
  '#a78bfa': [[0, '#e7d9ff'], [0.42, '#a78bfa'], [0.62, '#5b3ac2'], [1, '#8f6be0']],
};
const acc = (i: number) => ACC[i % ACC.length];
const flabel = (f: FontKey) => TYPO_FONTS[f].label;

const OUT: TypoPreset[] = [];
function g(t: Partial<TypoPreset> & Pick<TypoPreset, 'id' | 'name' | 'cat' | 'font' | 'in'>): void {
  OUT.push({
    size: 0.062,
    uppercase: true,
    lineHeight: 1.16,
    fill: 'primary',
    unit: 'word',
    out: { kind: 'none', dur: 0 },
    highlightStyle: 'color',
    defaultPrimary: WHITE,
    defaultAccent: '#ffd60a',
    ...t,
  } as TypoPreset);
}

/* ── Título Viral: 1 por fonte (fonte+apoio mudam a cara) — 8 ───────────── */
const V1: Array<[FontKey, FontKey]> = [
  ['anton', 'playfair900i'],
  ['archivo', 'caveat700'],
  ['passion700', 'dancing700'],
  ['luckiest', 'playfair900i'],
  ['bebas', 'caveat700'],
  ['fjalla', 'oswald600'],
  ['bowlbysc', 'dancing700'],
  ['montserrat900', 'playfair900i'],
];
V1.forEach(([f, sup], i) =>
  g({
    id: `g-titulo-${f}`,
    name: `Título · ${flabel(f)}`,
    cat: 'Viral',
    font: f,
    size: 0.078,
    lineHeight: 1.0,
    fill: 'accent',
    stroke: { color: '#ffffff', width: 0.045 },
    hardShadow: { color: 'rgba(0,0,0,0.45)', x: 0.045, y: 0.06 },
    mix: { font: sup, scale: 0.44, lowercase: true },
    emphasisBreak: true,
    autoEmphasis: true,
    in: { kind: 'rise', dur: 300, ease: 'outQuint', stagger: 90, amp: 0.6 },
    defaultAccent: acc(i),
  }),
);

/* ── Número 3D: 1 por fonte — 5 ─────────────────────────────────────────── */
(['anton', 'archivo', 'passion700', 'squada', 'changa'] as FontKey[]).forEach((f, i) => {
  const a = acc(i + 4); // estreia variada (verde, laranja, roxo, amarelo, vermelho)
  g({
    id: `g-num3d-${f}`,
    name: `Número 3D · ${flabel(f)}`,
    cat: 'Viral',
    font: f,
    size: 0.08,
    lineHeight: 1.0,
    fill: 'accent',
    extrude: { color: DARK[a], x: 0.05, y: 0.06, steps: 6 },
    stroke: { color: 'rgba(0,0,0,0.5)', width: 0.05 },
    glow: { color: 'accent', blur: 0.14 },
    hardShadow: { color: 'rgba(0,0,0,0.5)', x: 0.05, y: 0.07 },
    highlightScale: 1.24,
    mix: { font: 'oswald600', scale: 0.42 },
    emphasisBreak: true,
    autoEmphasis: true,
    in: { kind: 'drop', dur: 300, ease: 'bounce', stagger: 100, amp: 1.1 },
    defaultAccent: a,
  });
});

/* ── Cromo + destaque em gradiente: 1 por fonte — 4 ─────────────────────── */
(['archivo', 'montserrat900', 'bowlbysc', 'anton'] as FontKey[]).forEach((f, i) => {
  const a = acc(i * 2);
  g({
    id: `g-grad-${f}`,
    name: `Cromo Destaque · ${flabel(f)}`,
    cat: 'Viral',
    font: f,
    size: 0.072,
    lineHeight: 0.98,
    fill: 'gradient',
    gradientStops: [[0, '#ffffff'], [0.45, '#dde3ea'], [0.55, '#9aa5b1'], [1, '#cfd6de']],
    extrude: { color: '#33333c', x: 0.05, y: 0.055, steps: 6 },
    highlightGradient: GRAD[a],
    highlightScale: 1.22,
    emphasisBreak: true,
    autoEmphasis: true,
    unit: 'block',
    in: { kind: 'zoom-out', dur: 300, ease: 'outQuint', amp: 1.1 },
    defaultAccent: a,
  });
});

/* ── Neon misto: 1 por fonte — 4 ────────────────────────────────────────── */
(['bebas', 'bigshoulders800', 'leaguegothic', 'staatliches'] as FontKey[]).forEach((f, i) =>
  g({
    id: `g-neonmix-${f}`,
    name: `Neon Misto · ${flabel(f)}`,
    cat: 'Viral',
    font: f,
    size: 0.084,
    lineHeight: 1.0,
    spacing: 0.02,
    glow: { color: 'accent', blur: 0.4 },
    hardShadow: { color: 'rgba(0,0,0,0.4)', x: 0.03, y: 0.04 },
    mix: { font: 'playfair900i', scale: 0.42, lowercase: true },
    emphasisBreak: true,
    autoEmphasis: true,
    in: { kind: 'fade', dur: 260, ease: 'outQuad', stagger: 90 },
    defaultAccent: acc(i * 2 + 2),
  }),
);

/* ── Fumaça: 1 por fonte — 3 ────────────────────────────────────────────── */
(['anton', 'cinzel800', 'archivo'] as FontKey[]).forEach((f, i) =>
  g({
    id: `g-fumaca-${f}`,
    name: `Fumaça · ${flabel(f)}`,
    cat: 'Viral',
    font: f,
    size: 0.076,
    smoke: { alpha: 0.45 },
    hardShadow: { color: 'rgba(0,0,0,0.55)', x: 0.04, y: 0.06 },
    loop: { kind: 'float', amp: 0.035, freq: 0.7 },
    unit: 'block',
    highlightColor: 'accent',
    highlightScale: 1.15,
    autoEmphasis: true,
    in: { kind: 'zoom-out', dur: 380, ease: 'outQuint', amp: 0.7 },
    defaultAccent: acc(i * 3),
  }),
);

/* ── Mix de fontes no destaque: cada combinação É outro lettering — 16 ──── */
const V6_MAIN: FontKey[] = ['inter800', 'montserrat900', 'poppins800', 'roboto900'];
const V6_HL: FontKey[] = ['luckiest', 'shrikhand', 'lobster', 'bangers'];
V6_MAIN.forEach((mf, mi) =>
  V6_HL.forEach((hf, hi) =>
    g({
      id: `g-mixfonte-${mf}-${hf}`,
      name: `Mix ${flabel(hf)} + ${flabel(mf)}`,
      cat: 'Viral',
      font: mf,
      size: 0.06,
      highlightFont: hf,
      highlightScale: 1.5,
      emphasisBreak: true,
      autoEmphasis: true,
      hardShadow: { color: 'rgba(0,0,0,0.45)', x: 0.04, y: 0.06 },
      in: { kind: 'pop', dur: 260, ease: 'outBack', stagger: 80 },
      defaultAccent: acc(mi * 4 + hi),
    }),
  ),
);

/* ── Máscara: 1 por fonte (dim varia junto) — 3 ─────────────────────────── */
(['anton', 'archivo', 'bebas'] as FontKey[]).forEach((f, i) =>
  g({
    id: `g-mascara-${f}`,
    name: `Máscara · ${flabel(f)}`,
    cat: 'Viral',
    font: f,
    size: 0.08,
    knockout: { dim: [0.45, 0.62, 0.55][i], pad: 0.55 },
    unit: 'block',
    in: { kind: 'zoom-out', dur: 320, ease: 'outQuint', amp: 0.6 },
    autoEmphasis: false,
    defaultAccent: WHITE,
  }),
);

/* ── Impacto · Punch: 1 por fonte — 8 ───────────────────────────────────── */
(['anton', 'archivo', 'montserrat900', 'passion700', 'ultra', 'alfaslab', 'bevan', 'sigmar'] as FontKey[]).forEach((f, i) =>
  g({
    id: `g-punch-${f}`,
    name: `Punch · ${flabel(f)}`,
    cat: 'Impacto',
    font: f,
    size: 0.066,
    stroke: { color: INK, width: 0.12 },
    hardShadow: { color: 'rgba(0,0,0,0.5)', x: 0.05, y: 0.07 },
    autoEmphasis: true,
    in: { kind: 'pop', dur: 240, ease: 'outBack', stagger: 75 },
    defaultAccent: acc(i),
  }),
);

/* ── Karaokê: os 4 modos (cor é editável) — 4 ───────────────────────────── */
(['fill', 'word-color', 'word-box', 'word-zoom'] as const).forEach((mode, mi) =>
  g({
    id: `g-karaoke-${mode}`,
    name: `Karaokê ${mode === 'fill' ? 'Fill' : mode === 'word-color' ? 'Cor' : mode === 'word-box' ? 'Box' : 'Zoom'} Alt`,
    cat: 'Karaokê',
    font: (['archivo', 'poppins800', 'montserrat900', 'inter800'] as FontKey[])[mi],
    size: 0.06,
    karaoke: mode,
    unit: 'block',
    stroke: mode === 'word-box' ? undefined : { color: INK, width: 0.13 },
    hardShadow: { color: 'rgba(0,0,0,0.4)', x: 0, y: 0.06 },
    in: { kind: mode === 'fill' ? 'fade' : 'rise', dur: 200, ease: 'outCubic', amp: 0.45 },
    defaultAccent: acc(mi * 2),
  }),
);

/* ── Glitch: 1 por fonte — 4 ────────────────────────────────────────────── */
(['anton', 'archivo', 'orbitron800', 'russo'] as FontKey[]).forEach((f, i) =>
  g({
    id: `g-glitch-${f}`,
    name: `Glitch · ${flabel(f)}`,
    cat: 'Glitch',
    font: f,
    size: 0.07,
    chroma: { amp: 0.035, flicker: true },
    glitchBands: true,
    loop: { kind: 'glitch', amp: 1, freq: 1 },
    hardShadow: { color: 'rgba(0,0,0,0.5)', x: 0.04, y: 0.05 },
    autoEmphasis: true,
    unit: 'block',
    in: { kind: 'glitch', dur: 400, ease: 'outCubic', amp: 1.4 },
    defaultAccent: acc(i * 2 + 2),
  }),
);

/* ── Destaque · 4 estruturas de caixa — 4 ───────────────────────────────── */
(['solida', 'linha', 'chip', 'tarja'] as const).forEach((estilo, ei) =>
  g({
    id: `g-caixa-${estilo}`,
    name: `Caixa ${estilo === 'solida' ? 'Sólida Skew' : estilo === 'linha' ? 'Linha Auto' : estilo === 'chip' ? 'Chip Alt' : 'Tarja Alt'}`,
    cat: 'Destaque',
    font: (['montserrat900', 'inter800', 'poppins800', 'oswald600'] as FontKey[])[ei],
    size: 0.056,
    unit: estilo === 'chip' ? 'word' : 'block',
    box:
      estilo === 'solida'
        ? { mode: 'block', fill: 'accent', radius: 0.2, padX: 0.5, padY: 0.3, skew: -4, autoText: true, shadow: { color: 'rgba(0,0,0,0.5)', x: 0.09, y: 0.1 } }
        : estilo === 'linha'
          ? { mode: 'line', fill: 'accent', radius: 0.16, padX: 0.4, padY: 0.18, autoText: true, shadow: { color: 'rgba(0,0,0,0.4)', x: 0, y: 0.08 } }
          : estilo === 'chip'
            ? { mode: 'word', fill: 'rgba(0,0,0,0.8)', radius: 0.3, padX: 0.3, padY: 0.2 }
            : { mode: 'line', fill: 'rgba(0,0,0,0.84)', radius: 0.05, padX: 0.42, padY: 0.15, skew: -4 },
    in: { kind: estilo === 'tarja' ? 'wipe' : 'pop', dur: 280, ease: 'outBack', stagger: estilo === 'chip' ? 90 : 0 },
    autoEmphasis: estilo === 'chip' || estilo === 'tarja',
    defaultAccent: acc(ei * 2 + 1),
  }),
);

/* ── Minimal: 4 animações × 3 fontes com personalidade — 12 ─────────────── */
(['fade', 'rise', 'blur', 'tracking-in'] as const).forEach((anim, ai) =>
  (['dmsans900', 'josefin700', 'comfortaa700'] as FontKey[]).forEach((f) =>
    g({
      id: `g-min-${anim}-${f}`,
      name: `${anim === 'fade' ? 'Fade' : anim === 'rise' ? 'Sobe' : anim === 'blur' ? 'Blur' : 'Tracking'} · ${flabel(f)}`,
      cat: 'Minimal',
      font: f,
      size: 0.054,
      uppercase: false,
      unit: anim === 'tracking-in' ? 'block' : 'word',
      spacing: anim === 'tracking-in' ? 0.05 : undefined,
      shadow: { color: 'rgba(0,0,0,0.5)', blur: 0.12, x: 0, y: 0.04 },
      out: { kind: 'fade', dur: 180 },
      autoEmphasis: true,
      in: { kind: anim, dur: 320, ease: 'outQuint', stagger: 60, amp: 0.7 },
      defaultAccent: acc(ai),
    }),
  ),
);

/* ── Bounce: 1 por fonte cartoon — 6 ────────────────────────────────────── */
(['nunito900', 'baloo800', 'fredoka600', 'titan', 'lilita', 'chewy'] as FontKey[]).forEach((f, i) =>
  g({
    id: `g-bounce-${f}`,
    name: `Bounce · ${flabel(f)}`,
    cat: 'Bounce',
    font: f,
    size: 0.062,
    stroke: { color: INK, width: 0.13 },
    hardShadow: { color: 'rgba(0,0,0,0.4)', x: 0, y: 0.06 },
    autoEmphasis: true,
    in: { kind: 'pop', dur: 520, ease: 'elastic', stagger: 90 },
    defaultAccent: acc(i),
  }),
);

/* ── Máquina: 1 por fonte mono — 6 ──────────────────────────────────────── */
(['jetbrains700', 'specialelite', 'vt323', 'silkscreen700', 'majormono', 'dotgothic'] as FontKey[]).forEach((f, i) =>
  g({
    id: `g-maquina-${f}`,
    name: `Máquina · ${flabel(f)}`,
    cat: 'Máquina',
    font: f,
    size: 0.05,
    uppercase: false,
    unit: 'block',
    caret: 'bar',
    shadow: { color: 'rgba(0,0,0,0.5)', blur: 0.1, x: 0, y: 0.03 },
    in: { kind: 'typewriter', dur: 800 },
    defaultAccent: acc(i),
  }),
);

/* ── Foco: 2 animações × 3 fontes — 6 ───────────────────────────────────── */
(['blur', 'blur-zoom'] as const).forEach((anim, ai) =>
  (['abril', 'oswald600', 'lora700'] as FontKey[]).forEach((f) =>
    g({
      id: `g-foco-${anim}-${f}`,
      name: `Foco ${anim === 'blur' ? 'Reveal' : 'Cine'} · ${flabel(f)}`,
      cat: 'Foco',
      font: f,
      size: 0.058,
      uppercase: false,
      unit: anim === 'blur-zoom' ? 'block' : 'word',
      shadow: { color: 'rgba(0,0,0,0.5)', blur: 0.14, x: 0, y: 0.04 },
      out: { kind: 'blur', dur: 220 },
      autoEmphasis: true,
      in: { kind: anim, dur: 420, ease: 'outQuint', stagger: 80, amp: 1 },
      defaultAccent: acc(ai * 3),
    }),
  ),
);

/* ── Reveal: 3 animações × 2 fontes — 6 ─────────────────────────────────── */
(['mask-up', 'wipe', 'flip'] as const).forEach((anim, ai) =>
  (['anton', 'staatliches'] as FontKey[]).forEach((f) =>
    g({
      id: `g-reveal-${anim}-${f}`,
      name: `${anim === 'mask-up' ? 'Mask' : anim === 'wipe' ? 'Cortina' : 'Flip'} · ${flabel(f)}`,
      cat: 'Reveal',
      font: f,
      size: 0.062,
      unit: anim === 'flip' ? 'word' : 'block',
      hardShadow: { color: 'rgba(0,0,0,0.45)', x: 0.03, y: 0.05 },
      autoEmphasis: true,
      in: { kind: anim, dur: 360, ease: anim === 'flip' ? 'outBack' : 'outQuint', stagger: 100 },
      out: { kind: 'fade', dur: 160 },
      defaultAccent: acc(ai * 2 + 1),
    }),
  ),
);

/* ── Neon: 3 estilos × fontes com cara própria — 12 ─────────────────────── */
(['pulse', 'aura', 'flicker'] as const).forEach((estilo, si) =>
  (['bebas', 'monoton', 'mrdafoe', 'bigshoulders800'] as FontKey[]).forEach((f, fi) =>
    g({
      id: `g-neon-${estilo}-${f}`,
      name: `Neon ${estilo === 'pulse' ? 'Pulse' : estilo === 'aura' ? 'Aura' : 'Flicker'} · ${flabel(f)}`,
      cat: 'Neon',
      font: f,
      size: f === 'mrdafoe' ? 0.078 : 0.074,
      uppercase: f !== 'mrdafoe',
      spacing: 0.02,
      unit: 'block',
      glow: { color: 'accent', blur: 0.42 },
      aura: estilo === 'aura' ? { color: 'accent', count: 4, width: 0.22, alpha: 0.5, pulse: true } : undefined,
      loop:
        estilo === 'pulse'
          ? { kind: 'pulse', amp: 0.05, freq: 1.5 }
          : estilo === 'flicker'
            ? { kind: 'flicker', amp: 0.45, freq: 11 }
            : undefined,
      in: { kind: 'fade', dur: 260, ease: 'outQuad' },
      autoEmphasis: false,
      defaultAccent: acc(si * 4 + fi),
    }),
  ),
);

/* ── Kinetic: 3 estilos × 3 fontes — 9 ──────────────────────────────────── */
(['wave', 'shake', 'slide'] as const).forEach((estilo, si) =>
  (['nunito900', 'archivo', 'fugaz'] as FontKey[]).forEach((f) =>
    g({
      id: `g-kin-${estilo}-${f}`,
      name: `${estilo === 'wave' ? 'Onda' : estilo === 'shake' ? 'Shake' : 'Slide'} · ${flabel(f)}`,
      cat: 'Kinetic',
      font: f,
      size: 0.06,
      unit: estilo === 'wave' ? 'char' : estilo === 'shake' ? 'block' : 'word',
      stroke: { color: INK, width: 0.12 },
      hardShadow: { color: 'rgba(0,0,0,0.4)', x: 0, y: 0.06 },
      loop:
        estilo === 'wave'
          ? { kind: 'wave', amp: 0.08, freq: 1.5 }
          : estilo === 'shake'
            ? { kind: 'shake', amp: 0.045, freq: 8 }
            : undefined,
      autoEmphasis: true,
      in:
        estilo === 'slide'
          ? { kind: 'slide-left', dur: 280, ease: 'outExpo', stagger: 55, amp: 1 }
          : { kind: 'rise', dur: 300, ease: 'outBackSoft', stagger: 24, amp: 0.8 },
      defaultAccent: acc(si * 2),
    }),
  ),
);

/* ── Editorial: 1 por fonte serifada — 8 ────────────────────────────────── */
(['playfair900', 'abril', 'dmserif', 'fraunces900', 'rozha', 'yeseva', 'bodoni800', 'librebaskerville700'] as FontKey[]).forEach((f, i) =>
  g({
    id: `g-edit-${f}`,
    name: `Editorial · ${flabel(f)}`,
    cat: 'Editorial',
    font: f,
    size: 0.058,
    uppercase: false,
    unit: 'block',
    shadow: { color: 'rgba(0,0,0,0.5)', blur: 0.14, x: 0, y: 0.04 },
    out: { kind: 'fade', dur: 240 },
    autoEmphasis: true,
    in: { kind: i % 2 === 0 ? 'fade' : 'mask-up', dur: 420, ease: 'outQuint', stagger: 110 },
    defaultAccent: '#e8c66b',
  }),
);

/* ── Cor: 1 por gradiente (a paleta É o modelo aqui) — 6 ────────────────── */
const GRADS: Array<{ id: string; nome: string; stops: Array<[number, string]>; font: FontKey }> = [
  { id: 'fogo2', nome: 'Fogo Sólido', stops: [[0, '#fff3b0'], [0.4, '#ffb703'], [0.75, '#fb5607'], [1, '#d00000']], font: 'passion700' },
  { id: 'gelo2', nome: 'Gelo Sólido', stops: [[0, '#ffffff'], [0.55, '#bde0fe'], [1, '#4cc9f0']], font: 'bowlbysc' },
  { id: 'sunset2', nome: 'Sunset Sólido', stops: [[0, '#ffd6ff'], [0.5, '#ff8fab'], [1, '#ff5d8f']], font: 'nunito900' },
  { id: 'floresta', nome: 'Floresta', stops: [[0, '#d8ffde'], [0.5, '#3ddc64'], [1, '#0b6b1d']], font: 'archivo' },
  { id: 'oceano', nome: 'Oceano', stops: [[0, '#c8f4ff'], [0.5, '#22a6ee'], [1, '#0b3a85']], font: 'anton' },
  { id: 'uva', nome: 'Uva', stops: [[0, '#e7d9ff'], [0.5, '#a05ae0'], [1, '#3a1470']], font: 'montserrat900' },
];
GRADS.forEach((gr) =>
  g({
    id: `g-cor-${gr.id}`,
    name: `${gr.nome} · ${flabel(gr.font)}`,
    cat: 'Cor',
    font: gr.font,
    size: 0.068,
    fill: 'gradient',
    gradientStops: gr.stops,
    stroke: { color: 'rgba(0,0,0,0.55)', width: 0.07 },
    hardShadow: { color: 'rgba(0,0,0,0.45)', x: 0.04, y: 0.06 },
    autoEmphasis: false,
    in: { kind: 'pop', dur: 280, ease: 'outBack', stagger: 90 },
    defaultAccent: gr.stops[1][1],
  }),
);

/* ── Cartoon: 1 por fonte — 8 ───────────────────────────────────────────── */
(['sigmar', 'ranchers', 'londrina', 'concert', 'paytone', 'bowlbysc', 'comicneue700', 'baloo800'] as FontKey[]).forEach((f, i) =>
  g({
    id: `g-cartoon-${f}`,
    name: `Cartoon · ${flabel(f)}`,
    cat: 'Cartoon',
    font: f,
    size: 0.064,
    fill: 'accent',
    stroke: { color: INK, width: 0.14 },
    hardShadow: { color: 'rgba(0,0,0,0.45)', x: 0.05, y: 0.07 },
    wordRotateJitter: 2.5,
    autoEmphasis: true,
    highlightColor: '#ffffff',
    in: { kind: 'pop', dur: 380, ease: 'elastic', stagger: 95 },
    defaultAccent: acc(i),
  }),
);

/* ── Estilo: 1 por script (look alternando) — 11 ────────────────────────── */
(['greatvibes', 'allura', 'parisienne', 'sacramento', 'alexbrush', 'cookie', 'berkshire', 'norican', 'grandhotel', 'oleo700', 'kaushan'] as FontKey[]).forEach((f, fi) => {
  const look = (['glow', 'shine', 'clean'] as const)[fi % 3];
  g({
    id: `g-script-${f}`,
    name: `${flabel(f)}${look === 'glow' ? ' Neon' : look === 'shine' ? ' Brilho' : ''}`,
    cat: 'Estilo',
    font: f,
    size: 0.08,
    uppercase: false,
    glow: look === 'glow' ? { color: 'accent', blur: 0.38 } : undefined,
    shine: look === 'shine' ? { period: 2400, alpha: 0.7 } : undefined,
    shadow: look === 'clean' ? { color: 'rgba(0,0,0,0.5)', blur: 0.12, x: 0, y: 0.04 } : undefined,
    hardShadow: look !== 'clean' ? { color: 'rgba(0,0,0,0.4)', x: 0.03, y: 0.04 } : undefined,
    unit: 'block',
    in: { kind: 'rise', dur: 360, ease: 'outQuint', amp: 0.4 },
    out: { kind: 'fade', dur: 220 },
    autoEmphasis: false,
    defaultAccent: (['#f472b6', '#22d3ee', '#e8c66b'] as const)[fi % 3],
  });
});

export const GENERATED_PRESETS: TypoPreset[] = OUT;
