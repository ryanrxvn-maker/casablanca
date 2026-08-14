/**
 * GERADOR de variantes curadas da Tipografia Automática.
 *
 * Cada RECEITA é um template estrutural validado visualmente (as mesmas
 * composições das referências do user); o gerador cruza receita × paleta ×
 * fonte com combinações CURADAS (nada de produto cartesiano cego) — é assim
 * que a galeria chega a 200+ virais e 40+ modelos por categoria sem nenhum
 * preset "quebrado".
 */

import type { TypoPreset } from './engine';
import { TYPO_FONTS, type FontKey } from './fonts';

const WHITE = '#ffffff';
const INK = '#0f0f10';

type Pal = {
  id: string;
  nome: string;
  accent: string;
  dark: string;
  grad: Array<[number, string]>;
};

const PALS: Pal[] = [
  { id: 'amarelo', nome: 'Amarelo', accent: '#ffd60a', dark: '#6b5200', grad: [[0, '#fff3c4'], [0.42, '#ffcd3c'], [0.62, '#a06b00'], [1, '#e2a52e']] },
  { id: 'vermelho', nome: 'Vermelho', accent: '#ff2d55', dark: '#5c0a1c', grad: [[0, '#ffb3ba'], [0.42, '#ff2d55'], [0.62, '#a30f2d'], [1, '#e0244a']] },
  { id: 'ciano', nome: 'Ciano', accent: '#22d3ee', dark: '#064a5c', grad: [[0, '#c8f4ff'], [0.42, '#22d3ee'], [0.62, '#0b6b85'], [1, '#1fb6d0']] },
  { id: 'rosa', nome: 'Rosa', accent: '#f472b6', dark: '#5c1440', grad: [[0, '#ffd6ec'], [0.42, '#f472b6'], [0.62, '#98276a'], [1, '#e05aa4']] },
  { id: 'verde', nome: 'Verde', accent: '#2eff4f', dark: '#0b6b1d', grad: [[0, '#d8ffde'], [0.42, '#2eff4f'], [0.62, '#0e8a26'], [1, '#25e045']] },
  { id: 'laranja', nome: 'Laranja', accent: '#ff9f0a', dark: '#6b3a00', grad: [[0, '#ffe9c4'], [0.42, '#ff9f0a'], [0.62, '#9c5a00'], [1, '#e58e09']] },
  { id: 'roxo', nome: 'Roxo', accent: '#a78bfa', dark: '#3a2470', grad: [[0, '#e7d9ff'], [0.42, '#a78bfa'], [0.62, '#5b3ac2'], [1, '#8f6be0']] },
  { id: 'branco', nome: 'Branco', accent: '#ffffff', dark: '#3a3a44', grad: [[0, '#ffffff'], [0.45, '#dfe3ea'], [0.55, '#9aa3af'], [1, '#cfd5dd']] },
];

const pal = (id: string): Pal => PALS.find((p) => p.id === id)!;
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

/* ── V1 · Título Viral (mix empilhado) — 64 ─────────────────────────────── */
const V1_MAIN: FontKey[] = ['anton', 'archivo', 'passion700', 'luckiest', 'bebas', 'fjalla', 'bowlbysc', 'montserrat900'];
const V1_SUP: FontKey[] = ['playfair900i', 'caveat700', 'dancing700', 'oswald600'];
V1_MAIN.forEach((f, fi) =>
  PALS.forEach((p) =>
    g({
      id: `g-titulo-${f}-${p.id}`,
      name: `Título ${p.nome} · ${flabel(f)}`,
      cat: 'Viral',
      font: f,
      size: 0.078,
      lineHeight: 1.0,
      fill: 'accent',
      stroke: p.id === 'branco' ? { color: '#111111', width: 0.05 } : { color: '#ffffff', width: 0.045 },
      hardShadow: { color: 'rgba(0,0,0,0.45)', x: 0.045, y: 0.06 },
      mix: { font: V1_SUP[fi % V1_SUP.length], scale: 0.44, lowercase: true },
      emphasisBreak: true,
      autoEmphasis: true,
      in: { kind: 'rise', dur: 300, ease: 'outQuint', stagger: 90, amp: 0.6 },
      defaultAccent: p.accent,
    }),
  ),
);

/* ── V2 · Número 3D — 40 ────────────────────────────────────────────────── */
(['anton', 'archivo', 'passion700', 'squada', 'changa'] as FontKey[]).forEach((f) =>
  PALS.forEach((p) =>
    g({
      id: `g-num3d-${f}-${p.id}`,
      name: `Número 3D ${p.nome} · ${flabel(f)}`,
      cat: 'Viral',
      font: f,
      size: 0.08,
      lineHeight: 1.0,
      fill: p.accent,
      extrude: { color: p.dark, x: 0.05, y: 0.06, steps: 6 },
      stroke: { color: 'rgba(0,0,0,0.5)', width: 0.05 },
      glow: { color: p.accent, blur: 0.14 },
      hardShadow: { color: 'rgba(0,0,0,0.5)', x: 0.05, y: 0.07 },
      highlightScale: 1.24,
      mix: { font: 'oswald600', scale: 0.42 },
      emphasisBreak: true,
      autoEmphasis: true,
      in: { kind: 'drop', dur: 300, ease: 'bounce', stagger: 100, amp: 1.1 },
      defaultAccent: p.accent,
    }),
  ),
);

/* ── V3 · Cromo com destaque em gradiente — 32 ──────────────────────────── */
(['archivo', 'montserrat900', 'bowlbysc', 'anton'] as FontKey[]).forEach((f) =>
  PALS.forEach((p) =>
    g({
      id: `g-grad-${f}-${p.id}`,
      name: `Cromo ${p.nome} · ${flabel(f)}`,
      cat: 'Viral',
      font: f,
      size: 0.072,
      lineHeight: 0.98,
      fill: 'gradient',
      gradientStops: [[0, '#ffffff'], [0.45, '#dde3ea'], [0.55, '#9aa5b1'], [1, '#cfd6de']],
      extrude: { color: '#33333c', x: 0.05, y: 0.055, steps: 6 },
      highlightGradient: p.grad,
      highlightScale: 1.22,
      emphasisBreak: true,
      autoEmphasis: true,
      unit: 'block',
      in: { kind: 'zoom-out', dur: 300, ease: 'outQuint', amp: 1.1 },
      defaultAccent: p.accent,
    }),
  ),
);

/* ── V4 · Neon misto — 32 ───────────────────────────────────────────────── */
(['bebas', 'bigshoulders800', 'leaguegothic', 'staatliches'] as FontKey[]).forEach((f) =>
  PALS.forEach((p) =>
    g({
      id: `g-neonmix-${f}-${p.id}`,
      name: `Neon ${p.nome} · ${flabel(f)}`,
      cat: 'Viral',
      font: f,
      size: 0.084,
      lineHeight: 1.0,
      spacing: 0.02,
      glow: { color: p.accent, blur: 0.4 },
      hardShadow: { color: 'rgba(0,0,0,0.4)', x: 0.03, y: 0.04 },
      mix: { font: 'playfair900i', scale: 0.42, lowercase: true },
      emphasisBreak: true,
      autoEmphasis: true,
      in: { kind: 'fade', dur: 260, ease: 'outQuad', stagger: 90 },
      defaultAccent: p.accent,
    }),
  ),
);

/* ── V5 · Fumaça — 24 ───────────────────────────────────────────────────── */
(['anton', 'cinzel800', 'archivo'] as FontKey[]).forEach((f) =>
  PALS.forEach((p) =>
    g({
      id: `g-fumaca-${f}-${p.id}`,
      name: `Fumaça ${p.nome} · ${flabel(f)}`,
      cat: 'Viral',
      font: f,
      size: 0.076,
      smoke: { alpha: 0.45 },
      hardShadow: { color: 'rgba(0,0,0,0.55)', x: 0.04, y: 0.06 },
      loop: { kind: 'float', amp: 0.035, freq: 0.7 },
      unit: 'block',
      highlightColor: p.accent,
      highlightScale: 1.15,
      autoEmphasis: true,
      in: { kind: 'zoom-out', dur: 380, ease: 'outQuint', amp: 0.7 },
      defaultAccent: p.accent,
    }),
  ),
);

/* ── V6 · Destaque com OUTRA fonte — 32 ─────────────────────────────────── */
const V6_MAIN: FontKey[] = ['inter800', 'montserrat900', 'poppins800', 'roboto900'];
const V6_HL: FontKey[] = ['luckiest', 'shrikhand', 'lobster', 'bangers'];
V6_MAIN.forEach((mf) =>
  V6_HL.forEach((hf) =>
    (['amarelo', 'ciano'] as const).forEach((pid) => {
      const p = pal(pid);
      g({
        id: `g-mixfonte-${mf}-${hf}-${p.id}`,
        name: `Mix ${flabel(hf)} ${p.nome}`,
        cat: 'Viral',
        font: mf,
        size: 0.06,
        highlightFont: hf,
        highlightScale: 1.5,
        emphasisBreak: true,
        autoEmphasis: true,
        hardShadow: { color: 'rgba(0,0,0,0.45)', x: 0.04, y: 0.06 },
        in: { kind: 'pop', dur: 260, ease: 'outBack', stagger: 80 },
        defaultAccent: p.accent,
      });
    }),
  ),
);

/* ── V7 · Máscara (knockout) — 6 ────────────────────────────────────────── */
(['anton', 'archivo', 'bebas'] as FontKey[]).forEach((f) =>
  [0.45, 0.62].forEach((dim, di) =>
    g({
      id: `g-mascara-${f}-${di}`,
      name: `Máscara ${flabel(f)} ${di ? 'Escura' : 'Leve'}`,
      cat: 'Viral',
      font: f,
      size: 0.08,
      knockout: { dim, pad: 0.55 },
      unit: 'block',
      in: { kind: 'zoom-out', dur: 320, ease: 'outQuint', amp: 0.6 },
      autoEmphasis: false,
      defaultAccent: '#ffffff',
    }),
  ),
);

/* ── Impacto · Punch — 32 ───────────────────────────────────────────────── */
(['anton', 'archivo', 'montserrat900', 'passion700', 'ultra', 'alfaslab', 'bevan', 'sigmar'] as FontKey[]).forEach((f) =>
  (['amarelo', 'vermelho', 'ciano', 'branco'] as const).forEach((pid) => {
    const p = pal(pid);
    g({
      id: `g-punch-${f}-${p.id}`,
      name: `Punch ${p.nome} · ${flabel(f)}`,
      cat: 'Impacto',
      font: f,
      size: 0.066,
      stroke: { color: INK, width: 0.12 },
      hardShadow: { color: 'rgba(0,0,0,0.5)', x: 0.05, y: 0.07 },
      autoEmphasis: true,
      in: { kind: 'pop', dur: 240, ease: 'outBack', stagger: 75 },
      defaultAccent: p.accent,
    });
  }),
);

/* ── Karaokê — 32 ───────────────────────────────────────────────────────── */
(['fill', 'word-color', 'word-box', 'word-zoom'] as const).forEach((mode, mi) =>
  PALS.forEach((p) =>
    g({
      id: `g-karaoke-${mode}-${p.id}`,
      name: `Karaokê ${mode === 'fill' ? 'Fill' : mode === 'word-color' ? 'Cor' : mode === 'word-box' ? 'Box' : 'Zoom'} ${p.nome}`,
      cat: 'Karaokê',
      font: (['montserrat900', 'inter800', 'poppins800', 'archivo'] as FontKey[])[mi],
      size: 0.06,
      karaoke: mode,
      unit: 'block',
      stroke: mode === 'word-box' ? undefined : { color: INK, width: 0.13 },
      hardShadow: { color: 'rgba(0,0,0,0.4)', x: 0, y: 0.06 },
      in: { kind: mode === 'fill' ? 'fade' : 'rise', dur: 200, ease: 'outCubic', amp: 0.45 },
      defaultAccent: p.accent,
    }),
  ),
);

/* ── Glitch — 32 ────────────────────────────────────────────────────────── */
(['anton', 'archivo', 'orbitron800', 'russo'] as FontKey[]).forEach((f) =>
  PALS.forEach((p) =>
    g({
      id: `g-glitch-${f}-${p.id}`,
      name: `Glitch ${p.nome} · ${flabel(f)}`,
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
      defaultAccent: p.accent,
    }),
  ),
);

/* ── Destaque · caixas — 32 ─────────────────────────────────────────────── */
(['solida', 'linha', 'chip', 'tarja'] as const).forEach((estilo, ei) =>
  PALS.forEach((p) =>
    g({
      id: `g-caixa-${estilo}-${p.id}`,
      name: `Caixa ${estilo === 'solida' ? 'Sólida' : estilo === 'linha' ? 'Linha' : estilo === 'chip' ? 'Chip' : 'Tarja'} ${p.nome}`,
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
      defaultAccent: p.accent,
    }),
  ),
);

/* ── Minimal — 36 ───────────────────────────────────────────────────────── */
(['inter800', 'poppins800', 'dmsans900', 'outfit800', 'manrope800', 'worksans800', 'lato900', 'raleway900', 'josefin700'] as FontKey[]).forEach((f) =>
  (['fade', 'rise', 'blur', 'tracking-in'] as const).forEach((anim) =>
    g({
      id: `g-min-${f}-${anim}`,
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
      defaultAccent: '#ffd60a',
    }),
  ),
);

/* ── Bounce — 36 ────────────────────────────────────────────────────────── */
(['nunito900', 'baloo800', 'fredoka600', 'titan', 'lilita', 'chewy'] as FontKey[]).forEach((f) =>
  (['amarelo', 'ciano', 'rosa', 'verde', 'laranja', 'roxo'] as const).forEach((pid) => {
    const p = pal(pid);
    g({
      id: `g-bounce-${f}-${p.id}`,
      name: `Bounce ${p.nome} · ${flabel(f)}`,
      cat: 'Bounce',
      font: f,
      size: 0.062,
      stroke: { color: INK, width: 0.13 },
      hardShadow: { color: 'rgba(0,0,0,0.4)', x: 0, y: 0.06 },
      autoEmphasis: true,
      in: { kind: 'pop', dur: 520, ease: 'elastic', stagger: 90 },
      defaultAccent: p.accent,
    });
  }),
);

/* ── Máquina — 36 ───────────────────────────────────────────────────────── */
(['jetbrains700', 'specialelite', 'vt323', 'silkscreen700', 'majormono', 'dotgothic'] as FontKey[]).forEach((f) =>
  (['amarelo', 'verde', 'ciano', 'branco', 'rosa', 'laranja'] as const).forEach((pid) => {
    const p = pal(pid);
    g({
      id: `g-maquina-${f}-${p.id}`,
      name: `Máquina ${p.nome} · ${flabel(f)}`,
      cat: 'Máquina',
      font: f,
      size: 0.05,
      uppercase: false,
      unit: 'block',
      caret: 'bar',
      shadow: { color: 'rgba(0,0,0,0.5)', blur: 0.1, x: 0, y: 0.03 },
      in: { kind: 'typewriter', dur: 800 },
      defaultAccent: p.accent,
    });
  }),
);

/* ── Foco — 36 ──────────────────────────────────────────────────────────── */
(['poppins800', 'playfair900', 'inter800', 'abril', 'oswald600', 'lora700'] as FontKey[]).forEach((f) =>
  (['blur', 'blur-zoom'] as const).forEach((anim) =>
    (['amarelo', 'branco', 'ciano'] as const).forEach((pid) => {
      const p = pal(pid);
      g({
        id: `g-foco-${f}-${anim}-${p.id}`,
        name: `Foco ${anim === 'blur' ? 'Reveal' : 'Cine'} ${p.nome} · ${flabel(f)}`,
        cat: 'Foco',
        font: f,
        size: 0.058,
        uppercase: false,
        unit: anim === 'blur-zoom' ? 'block' : 'word',
        shadow: { color: 'rgba(0,0,0,0.5)', blur: 0.14, x: 0, y: 0.04 },
        out: { kind: 'blur', dur: 220 },
        autoEmphasis: true,
        in: { kind: anim, dur: 420, ease: 'outQuint', stagger: 80, amp: 1 },
        defaultAccent: p.accent,
      });
    }),
  ),
);

/* ── Reveal — 36 ────────────────────────────────────────────────────────── */
(['mask-up', 'wipe', 'flip'] as const).forEach((anim, ai) =>
  (['montserrat900', 'anton', 'archivo', 'staatliches'] as FontKey[]).forEach((f) =>
    (['amarelo', 'branco', 'ciano'] as const).forEach((pid) => {
      const p = pal(pid);
      g({
        id: `g-reveal-${anim}-${f}-${p.id}`,
        name: `${anim === 'mask-up' ? 'Mask' : anim === 'wipe' ? 'Cortina' : 'Flip'} ${p.nome} · ${flabel(f)}`,
        cat: 'Reveal',
        font: f,
        size: 0.062,
        unit: anim === 'flip' ? 'word' : 'block',
        hardShadow: { color: 'rgba(0,0,0,0.45)', x: 0.03, y: 0.05 },
        autoEmphasis: true,
        in: { kind: anim, dur: 360, ease: ai === 2 ? 'outBack' : 'outQuint', stagger: 100 },
        out: { kind: 'fade', dur: 160 },
        defaultAccent: p.accent,
      });
    }),
  ),
);

/* ── Neon — 36 ──────────────────────────────────────────────────────────── */
(['pulse', 'aura', 'flicker'] as const).forEach((estilo) =>
  (['bebas', 'monoton', 'mrdafoe', 'bigshoulders800'] as FontKey[]).forEach((f) =>
    (['ciano', 'rosa', 'roxo'] as const).forEach((pid) => {
      const p = pal(pid);
      g({
        id: `g-neon-${estilo}-${f}-${p.id}`,
        name: `Neon ${estilo === 'pulse' ? 'Pulse' : estilo === 'aura' ? 'Aura' : 'Flicker'} ${p.nome} · ${flabel(f)}`,
        cat: 'Neon',
        font: f,
        size: f === 'mrdafoe' ? 0.078 : 0.074,
        uppercase: f !== 'mrdafoe',
        spacing: 0.02,
        unit: 'block',
        glow: { color: p.accent, blur: 0.42 },
        aura: estilo === 'aura' ? { color: p.accent, count: 4, width: 0.22, alpha: 0.5, pulse: true } : undefined,
        loop:
          estilo === 'pulse'
            ? { kind: 'pulse', amp: 0.05, freq: 1.5 }
            : estilo === 'flicker'
              ? { kind: 'flicker', amp: 0.45, freq: 11 }
              : undefined,
        in: { kind: 'fade', dur: 260, ease: 'outQuad' },
        autoEmphasis: false,
        defaultAccent: p.accent,
      });
    }),
  ),
);

/* ── Kinetic — 36 ───────────────────────────────────────────────────────── */
(['wave', 'shake', 'slide'] as const).forEach((estilo) =>
  (['nunito900', 'archivo', 'montserrat900', 'fugaz'] as FontKey[]).forEach((f) =>
    (['amarelo', 'ciano', 'vermelho'] as const).forEach((pid) => {
      const p = pal(pid);
      g({
        id: `g-kin-${estilo}-${f}-${p.id}`,
        name: `${estilo === 'wave' ? 'Onda' : estilo === 'shake' ? 'Shake' : 'Slide'} ${p.nome} · ${flabel(f)}`,
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
        defaultAccent: p.accent,
      });
    }),
  ),
);

/* ── Editorial — 32 ─────────────────────────────────────────────────────── */
(['playfair900', 'abril', 'dmserif', 'fraunces900', 'rozha', 'yeseva', 'bodoni800', 'librebaskerville700'] as FontKey[]).forEach((f) =>
  (['fade', 'mask-up'] as const).forEach((anim) =>
    (['branco', 'amarelo'] as const).forEach((pid) => {
      const p = pal(pid);
      g({
        id: `g-edit-${f}-${anim}-${p.id}`,
        name: `Editorial ${p.nome === 'Branco' ? '' : p.nome + ' '}· ${flabel(f)}`,
        cat: 'Editorial',
        font: f,
        size: 0.058,
        uppercase: false,
        unit: 'block',
        shadow: { color: 'rgba(0,0,0,0.5)', blur: 0.14, x: 0, y: 0.04 },
        out: { kind: 'fade', dur: 240 },
        autoEmphasis: true,
        in: { kind: anim, dur: 420, ease: 'outQuint', stagger: 110 },
        defaultAccent: p.accent === '#ffffff' ? '#e8c66b' : p.accent,
      });
    }),
  ),
);

/* ── Premium — 32 ───────────────────────────────────────────────────────── */
(['ouro', 'chrome', 'duotone', 'longshadow'] as const).forEach((estilo) =>
  PALS.forEach((p) =>
    g({
      id: `g-prem-${estilo}-${p.id}`,
      name: `${estilo === 'ouro' ? 'Ouro' : estilo === 'chrome' ? 'Chrome' : estilo === 'duotone' ? 'Duotone' : 'Long Shadow'} ${p.nome}`,
      cat: 'Premium',
      font: (['anton', 'archivo', 'anton', 'montserrat900'] as FontKey[])[['ouro', 'chrome', 'duotone', 'longshadow'].indexOf(estilo)],
      size: 0.07,
      fill: estilo === 'duotone' ? 'gradient' : estilo === 'longshadow' ? 'primary' : 'gradient',
      gradientStops:
        estilo === 'duotone'
          ? [[0, 'primary'], [0.5, 'primary'], [0.505, 'accent'], [1, 'accent']]
          : estilo === 'chrome'
            ? [[0, '#ffffff'], [0.45, '#dde3ea'], [0.55, '#9aa5b1'], [1, '#cfd6de']]
            : p.grad,
      shine: estilo === 'longshadow' ? undefined : { period: 2400, alpha: 0.75 },
      extrude: estilo === 'longshadow' ? { color: 'rgba(0,0,0,0.4)', x: 0.09, y: 0.09, steps: 12, fade: true } : undefined,
      hardShadow: { color: 'rgba(0,0,0,0.5)', x: 0.05, y: 0.06 },
      unit: 'block',
      autoEmphasis: estilo === 'longshadow',
      in: { kind: 'zoom-out', dur: 300, ease: 'outQuint', amp: 1 },
      defaultAccent: p.accent,
    }),
  ),
);

/* ── Cor — 36 ───────────────────────────────────────────────────────────── */
const GRADS: Array<{ id: string; nome: string; stops: Array<[number, string]> }> = [
  { id: 'fogo', nome: 'Fogo', stops: [[0, '#fff3b0'], [0.4, '#ffb703'], [0.75, '#fb5607'], [1, '#d00000']] },
  { id: 'gelo', nome: 'Gelo', stops: [[0, '#ffffff'], [0.55, '#bde0fe'], [1, '#4cc9f0']] },
  { id: 'sunset', nome: 'Sunset', stops: [[0, '#ffd6ff'], [0.5, '#ff8fab'], [1, '#ff5d8f']] },
  { id: 'floresta', nome: 'Floresta', stops: [[0, '#d8ffde'], [0.5, '#3ddc64'], [1, '#0b6b1d']] },
  { id: 'oceano', nome: 'Oceano', stops: [[0, '#c8f4ff'], [0.5, '#22a6ee'], [1, '#0b3a85']] },
  { id: 'uva', nome: 'Uva', stops: [[0, '#e7d9ff'], [0.5, '#a05ae0'], [1, '#3a1470']] },
];
GRADS.forEach((gr) =>
  (['anton', 'archivo', 'nunito900', 'passion700', 'montserrat900', 'bowlbysc'] as FontKey[]).forEach((f) =>
    g({
      id: `g-cor-${gr.id}-${f}`,
      name: `${gr.nome} · ${flabel(f)}`,
      cat: 'Cor',
      font: f,
      size: 0.068,
      fill: 'gradient',
      gradientStops: gr.stops,
      stroke: { color: 'rgba(0,0,0,0.55)', width: 0.07 },
      hardShadow: { color: 'rgba(0,0,0,0.45)', x: 0.04, y: 0.06 },
      autoEmphasis: false,
      in: { kind: 'pop', dur: 280, ease: 'outBack', stagger: 90 },
      defaultAccent: gr.stops[1][1],
    }),
  ),
);

/* ── Cartoon — 33 ───────────────────────────────────────────────────────── */
(['luckiest', 'bangers', 'titan', 'lilita', 'modak', 'sigmar', 'chewy', 'ranchers', 'londrina', 'shrikhand', 'concert'] as FontKey[]).forEach((f) =>
  (['amarelo', 'ciano', 'rosa'] as const).forEach((pid) => {
    const p = pal(pid);
    g({
      id: `g-cartoon-${f}-${p.id}`,
      name: `Cartoon ${p.nome} · ${flabel(f)}`,
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
      defaultAccent: p.accent,
    });
  }),
);

/* ── Estilo (scripts premium) — 33 ──────────────────────────────────────── */
(['greatvibes', 'allura', 'parisienne', 'sacramento', 'alexbrush', 'cookie', 'berkshire', 'norican', 'grandhotel', 'oleo700', 'kaushan'] as FontKey[]).forEach((f, fi) =>
  (['glow', 'shine', 'clean'] as const).forEach((look) =>
    g({
      id: `g-script-${f}-${look}`,
      name: `${flabel(f)} ${look === 'glow' ? 'Neon' : look === 'shine' ? 'Brilho' : ''}`.trim(),
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
    }),
  ),
);

export const GENERATED_PRESETS: TypoPreset[] = OUT;
