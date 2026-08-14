/**
 * TIPOGRAFIA AUTOMÁTICA — engine de letterings animados em canvas 2D.
 *
 * Regras de ouro:
 *  - Tempo SEMPRE em ms e SEMPRE derivado do tempo do vídeo (t). Nada de
 *    Date.now()/Math.random() no desenho — o frame N do preview e o frame N
 *    do export precisam ser IDÊNTICOS (WYSIWYG). Aleatoriedade (glitch,
 *    flicker) vem de PRNG determinístico semeado por (bloco, unidade, t).
 *  - Tamanhos relativos à LARGURA do canvas — preview pequeno e export
 *    full-res renderizam a mesma composição em proporção.
 *  - Um preset é DATA (recipe); o engine implementa as primitivas. Preview,
 *    galeria de modelos e export final usam exatamente este drawCaptions.
 */

import { fontCss, type FontKey } from './fonts';

// ─── Tipos base ─────────────────────────────────────────────────────────────

export type TWord = { text: string; start: number; end: number };
export type Block = { id: string; words: TWord[]; start: number; end: number };

export type EaseName =
  | 'linear'
  | 'outQuad'
  | 'outCubic'
  | 'outQuint'
  | 'outExpo'
  | 'outBack'
  | 'outBackSoft'
  | 'elastic'
  | 'bounce'
  | 'inOutCubic';

export type Unit = 'block' | 'word' | 'char';

export type AnimKind =
  | 'none'
  | 'fade'
  | 'pop'
  | 'zoom-out'
  | 'rise'
  | 'drop'
  | 'slide-left'
  | 'slide-right'
  | 'blur'
  | 'blur-zoom'
  | 'typewriter'
  | 'glitch'
  | 'flip'
  | 'stretch-x'
  | 'mask-up'
  | 'wipe'
  | 'rotate-in'
  | 'skew-slide'
  | 'tracking-in'
  | 'squash';

export type OutKind = 'none' | 'fade' | 'zoom' | 'blur' | 'drop';

export type AnimSpec = {
  kind: AnimKind;
  dur: number;
  ease?: EaseName;
  stagger?: number;
  /** magnitude — deslocamentos em frações do fontSize, escalas em fator */
  amp?: number;
};

export type LoopKind = 'none' | 'wave' | 'shake' | 'pulse' | 'float' | 'flicker';
export type LoopSpec = { kind: LoopKind; amp: number; freq: number };

export type KaraokeMode =
  | 'none'
  | 'fill'
  | 'word-color'
  | 'word-box'
  | 'word-zoom'
  | 'word-underline'
  | 'solo';

export type BoxMode = 'none' | 'block' | 'line' | 'word';
export type PresetColor = string; // literal ou os tokens 'primary' / 'accent'

export type TypoPreset = {
  id: string;
  name: string;
  cat: string;
  font: FontKey;
  /** altura da fonte como fração da largura do canvas */
  size: number;
  uppercase?: boolean;
  /** letter-spacing extra em frações do fontSize */
  spacing?: number;
  lineHeight?: number;
  fill: PresetColor | 'gradient';
  gradient?: [string, string];
  stroke?: { color: PresetColor; width: number };
  shadow?: { color: string; blur: number; x: number; y: number };
  glow?: { color: PresetColor; blur: number };
  box?: { mode: BoxMode; fill: PresetColor; radius: number; padX: number; padY: number };
  karaoke?: KaraokeMode;
  /** como palavras destacadas manualmente aparecem */
  highlightStyle?: 'color' | 'box' | 'underline';
  unit: Unit;
  in: AnimSpec;
  out: { kind: OutKind; dur: number; ease?: EaseName };
  loop?: LoopSpec;
  caret?: 'bar' | 'block';
  defaultPrimary: string;
  defaultAccent: string;
};

export type StyleState = {
  presetId: string;
  fontScale: number;
  posY: number;
  primary: string | null;
  accent: string | null;
  uppercase: boolean | null;
  /** blockId → índices de palavras destacadas na cor de destaque */
  highlights: Record<string, number[]>;
};

export const DEFAULT_STYLE: Omit<StyleState, 'presetId'> = {
  fontScale: 1,
  posY: 0.76,
  primary: null,
  accent: null,
  uppercase: null,
  highlights: {},
};

// ─── Easings ────────────────────────────────────────────────────────────────

const EASE: Record<EaseName, (t: number) => number> = {
  linear: (t) => t,
  outQuad: (t) => 1 - (1 - t) * (1 - t),
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  outQuint: (t) => 1 - Math.pow(1 - t, 5),
  outExpo: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  outBack: (t) => {
    const c1 = 1.70158 * 1.35;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  outBackSoft: (t) => {
    const c1 = 1.70158 * 0.7;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  elastic: (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    const c4 = (2 * Math.PI) / 3.2;
    return Math.pow(2, -9 * t) * Math.sin((t * 9 - 0.75) * c4) + 1;
  },
  bounce: (t) => {
    const n1 = 7.5625;
    const d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
};

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

// PRNG determinístico (mulberry32 de passada única).
function prand(seed: number): number {
  let s = (seed | 0) + 0x6d2b79f5;
  s = Math.imul(s ^ (s >>> 15), s | 1);
  s ^= s + Math.imul(s ^ (s >>> 7), s | 61);
  return ((s ^ (s >>> 14)) >>> 0) / 4294967296;
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h | 0;
}

// ─── Layout ─────────────────────────────────────────────────────────────────

type CharLayout = { ch: string; x: number; w: number };
type WordLayout = {
  text: string;
  line: number;
  /** x do início da palavra, relativo ao início da LINHA */
  x: number;
  w: number;
  chars: CharLayout[];
};
type LineLayout = { wordIdx: number[]; width: number; scale: number };
type BlockLayout = {
  words: WordLayout[];
  lines: LineLayout[];
  fontPx: number;
  lineH: number;
  totalChars: number;
};

const layoutCache = new Map<string, BlockLayout>();

function measureLayout(
  ctx: CanvasRenderingContext2D,
  block: Block,
  preset: TypoPreset,
  style: StyleState,
  W: number,
): BlockLayout {
  const upper = style.uppercase ?? preset.uppercase ?? false;
  const key = `${block.id}|${block.words.length}|${blockTextKey(block)}|${preset.id}|${style.fontScale}|${upper}|${W}`;
  const hit = layoutCache.get(key);
  if (hit) return hit;
  if (layoutCache.size > 300) layoutCache.clear();

  const fontPx = preset.size * W * style.fontScale;
  const sp = (preset.spacing ?? 0) * fontPx;
  const lineH = fontPx * (preset.lineHeight ?? 1.16);
  ctx.font = fontCss(preset.font, fontPx);

  const spaceW = ctx.measureText(' ').width + sp;
  const maxLineW = W * 0.86;

  const words: WordLayout[] = block.words.map((w) => {
    const text = upper ? w.text.toUpperCase() : w.text;
    const chars: CharLayout[] = [];
    let x = 0;
    for (const ch of Array.from(text)) {
      const cw = ctx.measureText(ch).width;
      chars.push({ ch, x, w: cw });
      x += cw + sp;
    }
    const w0 = chars.length > 0 ? x - sp : 0;
    return { text, line: 0, x: 0, w: w0, chars };
  });

  // Wrap greedy
  const lines: LineLayout[] = [];
  let cur: number[] = [];
  let curW = 0;
  words.forEach((w, i) => {
    const tryW = cur.length === 0 ? w.w : curW + spaceW + w.w;
    if (cur.length > 0 && tryW > maxLineW) {
      lines.push({ wordIdx: cur, width: curW, scale: 1 });
      cur = [];
      curW = 0;
    }
    w.line = lines.length;
    w.x = cur.length === 0 ? 0 : curW + spaceW;
    curW = cur.length === 0 ? w.w : curW + spaceW + w.w;
    cur.push(i);
  });
  if (cur.length > 0) lines.push({ wordIdx: cur, width: curW, scale: 1 });

  // Linha com uma palavra gigante: encolhe só aquela linha
  for (const line of lines) {
    if (line.width > maxLineW) line.scale = maxLineW / line.width;
  }

  const totalChars = words.reduce((s, w) => s + w.chars.length, 0);
  const layout: BlockLayout = { words, lines, fontPx, lineH, totalChars };
  layoutCache.set(key, layout);
  return layout;
}

function blockTextKey(b: Block): string {
  let h = 0;
  for (const w of b.words) h = (h * 31 + hashStr(w.text)) | 0;
  return (h >>> 0).toString(36);
}

// ─── Resolução de cores ─────────────────────────────────────────────────────

function resolveColor(c: PresetColor, primary: string, accent: string): string {
  if (c === 'primary') return primary;
  if (c === 'accent') return accent;
  return c;
}

// ─── Transform por unidade ──────────────────────────────────────────────────

type UnitFx = {
  alpha: number;
  dx: number;
  dy: number;
  sx: number;
  sy: number;
  rot: number;
  skew: number;
  blur: number;
  /** progresso 0..1 da entrada (pra wipes/masks) */
  p: number;
  e: number;
};

function computeInFx(
  spec: AnimSpec,
  i: number,
  t: number,
  blockStart: number,
  fontPx: number,
  seedBase: number,
): UnitFx {
  const stagger = spec.stagger ?? 0;
  const inStart = blockStart + i * stagger;
  const p = spec.dur <= 0 ? 1 : clamp01((t - inStart) / spec.dur);
  const e = EASE[spec.ease ?? 'outCubic'](p);
  const amp = spec.amp ?? 1;
  const fx: UnitFx = { alpha: 1, dx: 0, dy: 0, sx: 1, sy: 1, rot: 0, skew: 0, blur: 0, p, e };
  const inv = 1 - e;

  switch (spec.kind) {
    case 'none':
      break;
    case 'fade':
      fx.alpha = e;
      break;
    case 'pop':
      fx.sx = fx.sy = Math.max(0.0001, e);
      fx.alpha = clamp01(p * 3);
      break;
    case 'zoom-out':
      fx.sx = fx.sy = 1 + amp * inv;
      fx.alpha = clamp01(p * 2.2);
      break;
    case 'rise':
      fx.dy = inv * amp * fontPx;
      fx.alpha = clamp01(p * 2.4);
      break;
    case 'drop':
      fx.dy = -inv * amp * fontPx;
      fx.alpha = clamp01(p * 2.4);
      break;
    case 'slide-left':
      fx.dx = inv * amp * fontPx * 2.4;
      fx.alpha = clamp01(p * 2.2);
      break;
    case 'slide-right':
      fx.dx = -inv * amp * fontPx * 2.4;
      fx.alpha = clamp01(p * 2.2);
      break;
    case 'blur':
      fx.blur = inv * amp * fontPx * 0.32;
      fx.alpha = clamp01(p * 1.8);
      break;
    case 'blur-zoom':
      fx.blur = inv * amp * fontPx * 0.26;
      fx.sx = fx.sy = 1 + 0.22 * inv;
      fx.alpha = clamp01(p * 1.8);
      break;
    case 'glitch': {
      fx.alpha = p > 0.05 ? 1 : clamp01(p * 12);
      const m = inv * amp;
      if (m > 0.02) {
        const step = Math.floor(t / 45);
        fx.dx = (prand(seedBase + i * 131 + step * 7) - 0.5) * m * fontPx * 0.7;
        fx.dy = (prand(seedBase + i * 197 + step * 13) - 0.5) * m * fontPx * 0.28;
      }
      break;
    }
    case 'flip':
      fx.sy = Math.max(0.0001, e);
      fx.alpha = clamp01(p * 2.6);
      break;
    case 'stretch-x':
      fx.sx = 1 + amp * inv;
      fx.alpha = clamp01(p * 2.6);
      break;
    case 'rotate-in':
      fx.rot = inv * amp * -0.22;
      fx.sx = fx.sy = 0.86 + 0.14 * e;
      fx.alpha = clamp01(p * 2.4);
      break;
    case 'skew-slide':
      fx.skew = inv * -0.42;
      fx.dx = inv * fontPx * 1.4;
      fx.alpha = clamp01(p * 2.2);
      break;
    case 'squash':
      fx.sy = 1 + 0.7 * inv;
      fx.sx = 1 - 0.32 * inv;
      fx.alpha = clamp01(p * 3);
      break;
    case 'tracking-in':
    case 'typewriter':
    case 'mask-up':
    case 'wipe':
      // Tratados em caminho próprio no draw (mexem em layout/clip).
      fx.alpha = spec.kind === 'tracking-in' ? e : 1;
      break;
  }
  return fx;
}

function computeLoopFx(
  loop: LoopSpec | undefined,
  i: number,
  t: number,
  inDone: number,
  fontPx: number,
  seedBase: number,
): { dx: number; dy: number; s: number; rot: number; alphaMul: number; glowMul: number } {
  const out = { dx: 0, dy: 0, s: 1, rot: 0, alphaMul: 1, glowMul: 1 };
  if (!loop || loop.kind === 'none') return out;
  const ramp = clamp01(inDone);
  const w = (2 * Math.PI * loop.freq * t) / 1000;
  switch (loop.kind) {
    case 'wave':
      out.dy = Math.sin(w + i * 0.62) * loop.amp * fontPx * ramp;
      break;
    case 'shake': {
      const n1 = Math.sin(w) + Math.sin(w * 1.618 + 1.3);
      const n2 = Math.sin(w * 1.21 + 0.7) + Math.sin(w * 2.03 + 2.1);
      out.dx = n1 * 0.5 * loop.amp * fontPx * ramp;
      out.dy = n2 * 0.35 * loop.amp * fontPx * ramp;
      out.rot = n1 * 0.008 * ramp;
      break;
    }
    case 'pulse':
      out.s = 1 + Math.sin(w) * loop.amp * 0.5 * ramp;
      break;
    case 'float':
      out.dy = Math.sin(w + i * 0.9) * loop.amp * fontPx * ramp;
      break;
    case 'flicker': {
      const step = Math.floor((t * loop.freq) / 1000);
      const r = prand(seedBase + step * 17);
      const dim = r < 0.12 ? 0.35 + r : 1;
      out.alphaMul = 1 - (1 - dim) * loop.amp;
      out.glowMul = out.alphaMul;
      break;
    }
  }
  return out;
}

// ─── Draw ───────────────────────────────────────────────────────────────────

type DrawCtx = {
  ctx: CanvasRenderingContext2D;
  preset: TypoPreset;
  primary: string;
  accent: string;
  fontPx: number;
  glowPx: number;
};

function applyTextStyle(d: DrawCtx, fill: string) {
  const { ctx, preset } = d;
  ctx.font = fontCss(preset.font, d.fontPx);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = fill;
  if (preset.shadow) {
    ctx.shadowColor = preset.shadow.color;
    ctx.shadowBlur = preset.shadow.blur * d.fontPx;
    ctx.shadowOffsetX = preset.shadow.x * d.fontPx;
    ctx.shadowOffsetY = preset.shadow.y * d.fontPx;
  } else if (preset.glow) {
    ctx.shadowColor = resolveColor(preset.glow.color, d.primary, d.accent);
    ctx.shadowBlur = d.glowPx;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  } else {
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  }
}

function fillWordText(d: DrawCtx, text: string, x: number, y: number, fill: string) {
  const { ctx, preset } = d;
  applyTextStyle(d, fill);
  if (preset.stroke) {
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.lineWidth = preset.stroke.width * d.fontPx;
    ctx.strokeStyle = resolveColor(preset.stroke.color, d.primary, d.accent);
    ctx.strokeText(text, x, y);
  }
  if (preset.glow) {
    // Passada dupla engrossa o glow (canvas soma shadows por draw).
    ctx.fillText(text, x, y);
  }
  ctx.fillText(text, x, y);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/**
 * Desenha as legendas do tempo `tMs` sobre o canvas (W×H = pixels do canvas).
 * O canvas deve chegar limpo (ou com o frame do vídeo já desenhado).
 */
export function drawCaptions(
  ctx: CanvasRenderingContext2D,
  blocks: Block[],
  preset: TypoPreset,
  style: StyleState,
  tMs: number,
  W: number,
  H: number,
): void {
  // Busca linear é ok (blocos ordenados, poucos ativos); early-out barato.
  let block: Block | null = null;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (tMs >= b.start && tMs < b.end) {
      block = b;
      break;
    }
    if (b.start > tMs) break;
  }
  if (!block || block.words.length === 0) return;

  const primary = style.primary ?? preset.defaultPrimary;
  const accent = style.accent ?? preset.defaultAccent;
  const layout = measureLayout(ctx, block, preset, style, W);
  const { fontPx, lineH } = layout;
  const seedBase = hashStr(block.id);

  const d: DrawCtx = {
    ctx,
    preset,
    primary,
    accent,
    fontPx,
    glowPx: (preset.glow?.blur ?? 0) * fontPx,
  };

  // Progresso do bloco (pra caixas e saída)
  const pBlock = preset.in.dur <= 0 ? 1 : clamp01((tMs - block.start) / preset.in.dur);
  const eBlock = EASE[preset.in.ease ?? 'outCubic'](Math.min(1, pBlock));

  // Saída
  let outAlpha = 1;
  let outDy = 0;
  let outScale = 1;
  let outBlur = 0;
  if (preset.out.kind !== 'none' && preset.out.dur > 0) {
    const po = clamp01((block.end - tMs) / preset.out.dur);
    const eo = EASE[preset.out.ease ?? 'outQuad'](po);
    switch (preset.out.kind) {
      case 'fade':
        outAlpha = eo;
        break;
      case 'zoom':
        outAlpha = eo;
        outScale = 1 + (1 - eo) * 0.35;
        break;
      case 'blur':
        outAlpha = eo;
        outBlur = (1 - eo) * fontPx * 0.25;
        break;
      case 'drop':
        outAlpha = eo;
        outDy = (1 - eo) * fontPx * 0.9;
        break;
    }
  }
  if (outAlpha <= 0.01) return;

  // Geometria do bloco
  const karaoke = preset.karaoke ?? 'none';
  const isSolo = karaoke === 'solo';
  const nLines = isSolo ? 1 : layout.lines.length;
  const blockH = nLines * lineH;
  let topY = style.posY * H - blockH / 2;
  topY = Math.min(Math.max(topY, H * 0.04), H * 0.96 - blockH);
  const cx = W / 2;

  // Palavra ativa (karaokê)
  let activeIdx = -1;
  for (let i = 0; i < block.words.length; i++) {
    const w = block.words[i];
    if (tMs >= w.start && (tMs < w.end || i === block.words.length - 1)) activeIdx = i;
    if (tMs >= w.end && i < block.words.length - 1) activeIdx = i + 1;
  }
  if (activeIdx < 0) activeIdx = 0;
  // corrige: última palavra segura o ativo até o fim do bloco
  for (let i = block.words.length - 1; i >= 0; i--) {
    if (tMs >= block.words[i].start) {
      activeIdx = i;
      break;
    }
  }

  ctx.save();
  ctx.globalAlpha = outAlpha;
  if (outScale !== 1 || outDy !== 0) {
    ctx.translate(cx, topY + blockH / 2 + outDy);
    ctx.scale(outScale, outScale);
    ctx.translate(-cx, -(topY + blockH / 2));
  }
  if (outBlur > 0.4) ctx.filter = `blur(${outBlur.toFixed(1)}px)`;

  const highlights = new Set(style.highlights[block.id] ?? []);
  const loopSpec = preset.loop;

  // Helpers de geometria por palavra/linha
  const lineOriginX = (li: number) => {
    const line = layout.lines[li];
    return cx - (line.width * line.scale) / 2;
  };
  const lineBaseY = (li: number) => topY + li * lineH + lineH * 0.78;
  const wordAbsX = (wi: number) => {
    const w = layout.words[wi];
    const line = layout.lines[w.line];
    return lineOriginX(w.line) + w.x * line.scale;
  };

  // ── modo SOLO (uma palavra por vez, estilo viral) ──
  if (isSolo) {
    const w = block.words[activeIdx];
    const text = layout.words[activeIdx].text;
    ctx.font = fontCss(preset.font, fontPx);
    const ww = layout.words[activeIdx].w;
    const fitScale = Math.min(1, (W * 0.82) / Math.max(ww, 1));
    const fx = computeInFx(preset.in, 0, tMs, w.start, fontPx, seedBase + activeIdx * 977);
    const loop = computeLoopFx(loopSpec, 0, tMs, fx.p, fontPx, seedBase);
    const y = topY + lineH * 0.78;
    const isHi = highlights.has(activeIdx);

    ctx.save();
    ctx.globalAlpha = outAlpha * fx.alpha * loop.alphaMul;
    ctx.translate(cx + fx.dx + loop.dx, y - lineH * 0.3 + fx.dy + loop.dy);
    ctx.scale(fx.sx * loop.s * fitScale, fx.sy * loop.s * fitScale);
    if (fx.rot || loop.rot) ctx.rotate(fx.rot + loop.rot);
    if (fx.skew) ctx.transform(1, 0, Math.tan(fx.skew), 1, 0, 0);
    if (fx.blur > 0.4) ctx.filter = `blur(${fx.blur.toFixed(1)}px)`;
    if (preset.box && preset.box.mode !== 'none') {
      const padX = preset.box.padX * fontPx;
      const padY = preset.box.padY * fontPx;
      ctx.fillStyle = resolveColor(preset.box.fill, primary, accent);
      const bs = ctx.shadowBlur;
      ctx.shadowBlur = 0;
      roundRect(ctx, -ww / 2 - padX, -lineH * 0.48 - padY, ww + padX * 2, lineH * 0.96 + padY * 2, preset.box.radius * fontPx);
      ctx.fill();
      ctx.shadowBlur = bs;
    }
    fillWordText(d, text, -ww / 2, lineH * 0.3, isHi ? accent : resolveFill(d, ww, lineH));
    ctx.restore();
    ctx.restore();
    return;
  }

  // ── caixas de fundo (block/line) ──
  const blockBox = preset.box;
  if (blockBox && (blockBox.mode === 'block' || blockBox.mode === 'line')) {
    const padX = blockBox.padX * fontPx;
    const padY = blockBox.padY * fontPx;
    ctx.save();
    ctx.globalAlpha = outAlpha * clamp01(pBlock * 2.5);
    ctx.fillStyle = resolveColor(blockBox.fill, primary, accent);
    const s = 0.85 + 0.15 * Math.min(eBlock, 1.12);
    if (blockBox.mode === 'block') {
      let minX = Infinity;
      let maxX = -Infinity;
      layout.lines.forEach((line, li) => {
        const x0 = lineOriginX(li);
        minX = Math.min(minX, x0);
        maxX = Math.max(maxX, x0 + line.width * line.scale);
      });
      const bx = minX - padX;
      const by = topY - padY;
      const bw = maxX - minX + padX * 2;
      const bh = blockH + padY * 2;
      ctx.translate(bx + bw / 2, by + bh / 2);
      ctx.scale(s, s);
      roundRect(ctx, -bw / 2, -bh / 2, bw, bh, blockBox.radius * fontPx);
      ctx.fill();
    } else {
      layout.lines.forEach((line, li) => {
        const x0 = lineOriginX(li) - padX;
        const y0 = topY + li * lineH + lineH * 0.06 - padY;
        const bw = line.width * line.scale + padX * 2;
        const bh = lineH * 0.92 + padY * 2;
        ctx.save();
        ctx.translate(x0 + bw / 2, y0 + bh / 2);
        ctx.scale(s, s);
        roundRect(ctx, -bw / 2, -bh / 2, bw, bh, blockBox.radius * fontPx);
        ctx.fill();
        ctx.restore();
      });
    }
    ctx.restore();
  }

  // ── typewriter (caminho próprio) ──
  if (preset.in.kind === 'typewriter') {
    drawTypewriter(d, block, layout, tMs, cx, topY, highlights, outAlpha);
    ctx.restore();
    return;
  }

  // ── mask-up / wipe (clip por linha) ──
  const isMask = preset.in.kind === 'mask-up';
  const isWipe = preset.in.kind === 'wipe';

  // ── karaokê 'fill' precisa de 2 passadas ──
  const isFill = karaoke === 'fill';

  const drawPass = (pass: 'base' | 'accent') => {
    layout.lines.forEach((line, li) => {
      const x0 = lineOriginX(li);
      const baseY = lineBaseY(li);
      const lscale = line.scale;

      ctx.save();
      if (lscale !== 1) {
        ctx.translate(cx, baseY);
        ctx.scale(lscale, lscale);
        ctx.translate(-cx, -baseY);
      }

      if (isMask || isWipe) {
        const lp =
          preset.in.dur <= 0
            ? 1
            : clamp01((tMs - (block.start + li * (preset.in.stagger ?? 90))) / preset.in.dur);
        const le = EASE[preset.in.ease ?? 'outCubic'](lp);
        ctx.beginPath();
        if (isMask) {
          ctx.rect(x0 - fontPx, topY + li * lineH - lineH * 0.12, line.width + fontPx * 2, lineH * 1.18);
        } else {
          ctx.rect(x0 - fontPx * 0.2, topY + li * lineH - lineH * 0.3, (line.width + fontPx * 0.4) * le, lineH * 1.5);
        }
        ctx.clip();
        if (isMask) {
          const dyLine = (1 - le) * lineH;
          ctx.translate(0, dyLine);
        }
      }

      for (const wi of line.wordIdx) {
        const wl = layout.words[wi];
        const word = block.words[wi];
        const unitIdx = unitIndexFor(preset.unit, layout, wi);
        const wx = x0 + wl.x;
        const isHi = highlights.has(wi);
        const isActive = wi === activeIdx;

        // fx por unidade (word/block); char tratado dentro
        const timeRef =
          karaoke === 'word-color' || karaoke === 'word-box' || karaoke === 'word-zoom'
            ? block.start
            : block.start;
        const fx =
          preset.unit === 'char'
            ? null
            : computeInFx(
                preset.in,
                preset.unit === 'word' ? wi : 0,
                tMs,
                timeRef,
                fontPx,
                seedBase + wi * 977,
              );

        // cor da palavra nesta passada
        let fill = resolveFill(d, wl.w, lineH);
        if (isHi) fill = accent;
        if (karaoke === 'word-color' && isActive) fill = accent;
        if (isFill) fill = pass === 'base' ? fill : accent;

        // karaokê box/zoom/underline na palavra ativa
        let extraS = 1;
        let extraDy = 0;
        if (isActive && (karaoke === 'word-zoom' || karaoke === 'word-box')) {
          const wp = clamp01((tMs - word.start) / 160);
          const we = EASE.outBack(wp);
          if (karaoke === 'word-zoom') extraS = 1 + 0.14 * we;
          if (karaoke === 'word-box') extraS = 1 + 0.06 * we;
        }

        if (pass === 'base' && isActive && karaoke === 'word-box') {
          const wp = clamp01((tMs - word.start) / 160);
          const we = EASE.outBack(wp);
          const padX = fontPx * 0.22;
          const padY = fontPx * 0.14;
          ctx.save();
          ctx.globalAlpha = outAlpha * clamp01(wp * 3) * (fx?.alpha ?? 1);
          ctx.fillStyle = accent;
          ctx.shadowBlur = 0;
          const bw = wl.w + padX * 2;
          const bh = lineH * 0.82 + padY * 2;
          const bxc = wx + wl.w / 2;
          const byc = baseY - lineH * 0.3;
          ctx.translate(bxc, byc);
          ctx.scale(0.7 + 0.3 * we, 0.7 + 0.3 * we);
          roundRect(ctx, -bw / 2, -bh / 2, bw, bh, fontPx * 0.18);
          ctx.fill();
          ctx.restore();
          // texto da ativa em cor de contraste sobre a caixa
          fill = contrastColor(accent);
        }
        if (karaoke === 'word-box' && isActive && pass !== 'base') fill = contrastColor(accent);

        // caixa por palavra (preset.box mode word)
        if (pass === 'base' && preset.box && preset.box.mode === 'word') {
          const bp = fx ? fx.p : pBlock;
          const be = fx ? fx.e : eBlock;
          if (bp > 0) {
            const padX = preset.box.padX * fontPx;
            const padY = preset.box.padY * fontPx;
            ctx.save();
            ctx.globalAlpha = outAlpha * clamp01(bp * 3);
            ctx.fillStyle = isHi ? accent : resolveColor(preset.box.fill, primary, accent);
            ctx.shadowBlur = 0;
            const bw = wl.w + padX * 2;
            const bh = lineH * 0.8 + padY * 2;
            const bxc = wx + wl.w / 2 + (fx?.dx ?? 0);
            const byc = baseY - lineH * 0.3 + (fx?.dy ?? 0);
            ctx.translate(bxc, byc);
            ctx.scale(Math.min(be, 1.15) * extraS, Math.min(be, 1.15) * extraS);
            roundRect(ctx, -bw / 2, -bh / 2, bw, bh, preset.box.radius * fontPx);
            ctx.fill();
            ctx.restore();
          }
        }

        // highlight manual estilo box/underline
        if (pass === 'base' && isHi && preset.highlightStyle === 'box' && !preset.box) {
          const padX = fontPx * 0.18;
          ctx.save();
          ctx.globalAlpha = outAlpha * (fx?.alpha ?? 1);
          ctx.fillStyle = accent;
          ctx.shadowBlur = 0;
          roundRect(ctx, wx - padX, baseY - lineH * 0.68, wl.w + padX * 2, lineH * 0.86, fontPx * 0.14);
          ctx.fill();
          ctx.restore();
          fill = contrastColor(accent);
        }

        drawWord(d, block, layout, wi, wx, baseY, fill, fx, loopSpec, tMs, seedBase, outAlpha, unitIdx, extraS, extraDy);

        // sublinhados
        if (pass === 'base') {
          const wantUnderline =
            (isHi && preset.highlightStyle === 'underline') ||
            (karaoke === 'word-underline' && isActive);
          if (wantUnderline) {
            const up = karaoke === 'word-underline' && isActive ? clamp01((tMs - word.start) / 140) : 1;
            ctx.save();
            ctx.globalAlpha = outAlpha * (fx?.alpha ?? 1);
            ctx.fillStyle = accent;
            ctx.shadowBlur = 0;
            const uw = wl.w * EASE.outCubic(up);
            ctx.fillRect(wx + (wl.w - uw) / 2, baseY + lineH * 0.1, uw, Math.max(2, fontPx * 0.07));
            ctx.restore();
          }
        }
      }
      ctx.restore();
    });
  };

  if (isFill) {
    drawPass('base');
    // clip até o ponto de preenchimento e repassa em accent
    const aw = layout.words[activeIdx];
    const word = block.words[activeIdx];
    const wp = clamp01((tMs - word.start) / Math.max(1, word.end - word.start));
    const fillX = wordAbsX(activeIdx) + aw.w * layout.lines[aw.line].scale * wp;
    ctx.save();
    ctx.beginPath();
    layout.lines.forEach((line, li) => {
      const y0 = topY + li * lineH - lineH * 0.2;
      if (li < aw.line) {
        ctx.rect(0, y0, W, lineH * 1.4);
      } else if (li === aw.line) {
        ctx.rect(0, y0, fillX, lineH * 1.4);
      }
    });
    ctx.clip();
    drawPass('accent');
    ctx.restore();
  } else {
    drawPass('base');
  }

  ctx.restore();
}

function resolveFill(d: DrawCtx, wordW: number, lineH: number): string {
  const { preset, ctx } = d;
  if (preset.fill === 'gradient' && preset.gradient) {
    const g = ctx.createLinearGradient(0, -lineH, 0, lineH * 0.4);
    g.addColorStop(0, preset.gradient[0]);
    g.addColorStop(1, preset.gradient[1]);
    return g as unknown as string;
  }
  return resolveColor(preset.fill, d.primary, d.accent);
}

function contrastColor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '#0a0a0a';
  const v = parseInt(m[1], 16);
  const r = (v >> 16) & 255;
  const g = (v >> 8) & 255;
  const b = v & 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 150 ? '#0a0a0a' : '#ffffff';
}

function unitIndexFor(unit: Unit, layout: BlockLayout, wi: number): number {
  if (unit !== 'char') return wi;
  let idx = 0;
  for (let i = 0; i < wi; i++) idx += layout.words[i].chars.length;
  return idx;
}

function drawWord(
  d: DrawCtx,
  block: Block,
  layout: BlockLayout,
  wi: number,
  wx: number,
  baseY: number,
  fill: string,
  fxWord: UnitFx | null,
  loopSpec: LoopSpec | undefined,
  tMs: number,
  seedBase: number,
  outAlpha: number,
  charBase: number,
  extraS: number,
  extraDy: number,
) {
  const { ctx, preset, fontPx } = d;
  const wl = layout.words[wi];
  const lineH = layout.lineH;

  if (preset.unit === 'char' || preset.in.kind === 'tracking-in' || loopSpec?.kind === 'wave') {
    // por CARACTERE
    const isTracking = preset.in.kind === 'tracking-in';
    for (let ci = 0; ci < wl.chars.length; ci++) {
      const cl = wl.chars[ci];
      const gi = charBase + ci;
      const fx =
        preset.unit === 'char'
          ? computeInFx(preset.in, gi, tMs, block.start, fontPx, seedBase + gi * 53)
          : (fxWord ?? computeInFx(preset.in, wi, tMs, block.start, fontPx, seedBase + wi * 977));
      const loop = computeLoopFx(loopSpec, gi, tMs, fx.p, fontPx, seedBase);
      let cxx = wx + cl.x;
      if (isTracking) {
        const spread = 1 + (preset.in.amp ?? 0.6) * (1 - fx.e);
        const lineCenter = wx + wl.w / 2;
        cxx = lineCenter + (wx + cl.x - lineCenter) * spread;
      }
      ctx.save();
      ctx.globalAlpha = outAlpha * fx.alpha * loop.alphaMul;
      ctx.translate(cxx + cl.w / 2 + fx.dx + loop.dx, baseY - lineH * 0.3 + fx.dy + loop.dy + extraDy);
      ctx.scale(fx.sx * loop.s * extraS, fx.sy * loop.s * extraS);
      if (fx.rot || loop.rot) ctx.rotate(fx.rot + loop.rot);
      if (fx.skew) ctx.transform(1, 0, Math.tan(fx.skew), 1, 0, 0);
      if (fx.blur > 0.4) ctx.filter = `blur(${fx.blur.toFixed(1)}px)`;
      fillWordText(d, cl.ch, -cl.w / 2, lineH * 0.3, fill);
      ctx.restore();
    }
    return;
  }

  // por PALAVRA (ou bloco)
  const fx = fxWord ?? computeInFx(preset.in, 0, tMs, block.start, fontPx, seedBase);
  const loop = computeLoopFx(loopSpec, wi, tMs, fx.p, fontPx, seedBase);
  ctx.save();
  ctx.globalAlpha = outAlpha * fx.alpha * loop.alphaMul;
  ctx.translate(wx + wl.w / 2 + fx.dx + loop.dx, baseY - lineH * 0.3 + fx.dy + loop.dy + extraDy);
  ctx.scale(fx.sx * loop.s * extraS, fx.sy * loop.s * extraS);
  if (fx.rot || loop.rot) ctx.rotate(fx.rot + loop.rot);
  if (fx.skew) ctx.transform(1, 0, Math.tan(fx.skew), 1, 0, 0);
  if (fx.blur > 0.4) ctx.filter = `blur(${fx.blur.toFixed(1)}px)`;

  if (preset.in.kind === 'glitch' && fx.p < 1) {
    // fantasmas RGB determinísticos
    const m = (1 - fx.e) * (preset.in.amp ?? 1) * fontPx * 0.4;
    if (m > 0.5) {
      const step = Math.floor(tMs / 45);
      const ox = (prand(seedBase + wi * 311 + step * 3) - 0.5) * m * 2;
      ctx.save();
      ctx.globalAlpha *= 0.55;
      applyTextStyle(d, 'rgba(255,45,85,0.9)');
      ctx.fillText(wl.text, -wl.w / 2 + ox, lineH * 0.3);
      applyTextStyle(d, 'rgba(0,229,255,0.9)');
      ctx.fillText(wl.text, -wl.w / 2 - ox, lineH * 0.3);
      ctx.restore();
    }
  }

  fillWordText(d, wl.text, -wl.w / 2, lineH * 0.3, fill);
  ctx.restore();
}

function drawTypewriter(
  d: DrawCtx,
  block: Block,
  layout: BlockLayout,
  tMs: number,
  cx: number,
  topY: number,
  highlights: Set<number>,
  outAlpha: number,
) {
  const { ctx, preset, fontPx } = d;
  const lineH = layout.lineH;
  const typeDur = Math.min(preset.in.dur, (block.end - block.start) * 0.65);
  const p = clamp01((tMs - block.start) / Math.max(1, typeDur));
  const visible = Math.floor(p * layout.totalChars);

  let drawn = 0;
  let caretX = 0;
  let caretY = 0;
  layout.lines.forEach((line, li) => {
    const x0 = cx - (line.width * line.scale) / 2;
    const baseY = topY + li * lineH + lineH * 0.78;
    ctx.save();
    if (line.scale !== 1) {
      ctx.translate(cx, baseY);
      ctx.scale(line.scale, line.scale);
      ctx.translate(-cx, -baseY);
    }
    for (const wi of line.wordIdx) {
      const wl = layout.words[wi];
      const isHi = highlights.has(wi);
      const fill = isHi ? d.accent : resolveFill(d, wl.w, lineH);
      for (let ci = 0; ci < wl.chars.length; ci++) {
        if (drawn >= visible) {
          caretX = x0 + wl.x + wl.chars[ci].x;
          caretY = baseY;
          ctx.restore();
          drawCaret(d, caretX, caretY, lineH, tMs, true, outAlpha);
          return;
        }
        const cl = wl.chars[ci];
        ctx.globalAlpha = outAlpha;
        fillWordText(d, cl.ch, x0 + wl.x + cl.x, baseY, fill);
        drawn++;
        caretX = x0 + wl.x + cl.x + cl.w;
        caretY = baseY;
      }
    }
    ctx.restore();
  });
  // terminou de digitar: caret piscando
  drawCaret(d, caretX + fontPx * 0.12, caretY, lineH, tMs, false, outAlpha);
}

function drawCaret(
  d: DrawCtx,
  x: number,
  y: number,
  lineH: number,
  tMs: number,
  typing: boolean,
  outAlpha: number,
) {
  const { ctx, preset, fontPx } = d;
  if (!preset.caret) return;
  const on = typing || Math.floor(tMs / 420) % 2 === 0;
  if (!on) return;
  ctx.save();
  ctx.globalAlpha = outAlpha;
  ctx.fillStyle = d.accent;
  ctx.shadowBlur = 0;
  if (preset.caret === 'bar') {
    ctx.fillRect(x, y - lineH * 0.62, Math.max(2, fontPx * 0.06), lineH * 0.72);
  } else {
    ctx.fillRect(x, y - lineH * 0.62, fontPx * 0.52, lineH * 0.72);
  }
  ctx.restore();
}

// ─── Demo (galeria de modelos) ──────────────────────────────────────────────

const demoCache = new Map<string, Block>();

/**
 * Desenha um loop de demonstração do preset (pra galeria). `tLoop` em ms,
 * qualquer valor — o engine faz o módulo internamente.
 */
export function drawPresetDemo(
  ctx: CanvasRenderingContext2D,
  preset: TypoPreset,
  tLoop: number,
  W: number,
  H: number,
  demoText = 'SUA LEGENDA AQUI',
): void {
  const CYCLE = 2600;
  const t = tLoop % CYCLE;
  let demo = demoCache.get(preset.id + '|' + demoText);
  if (!demo) {
    const parts = demoText.split(' ');
    const per = 1500 / parts.length;
    demo = {
      id: 'demo-' + preset.id,
      words: parts.map((text, i) => ({
        text,
        start: Math.round(120 + i * per),
        end: Math.round(120 + (i + 1) * per),
      })),
      start: 100,
      end: 2350,
    };
    demoCache.set(preset.id + '|' + demoText, demo);
  }
  const style: StyleState = {
    presetId: preset.id,
    fontScale: 1.02,
    posY: 0.54,
    primary: null,
    accent: null,
    uppercase: null,
    highlights: {},
  };
  drawCaptions(ctx, [demo], preset, style, t, W, H);
}
