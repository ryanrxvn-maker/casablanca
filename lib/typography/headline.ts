/**
 * HEADLINES — texto PARADO por cima do vídeo, irmão das legendas.
 *
 * A legenda é escrava do áudio: nasce da transcrição, é cronometrada palavra
 * por palavra e troca o tempo todo. A headline é o contrário: um texto fixo,
 * escrito na mão, que o user posiciona onde quiser e que dura o pedaço da
 * timeline que ele mandar. Vivem em faixas SEPARADAS e não sabem uma da
 * outra — dá pra ter headline sem legenda e legenda sem headline.
 *
 * O layout é puro (`layoutHeadline`) e testado em
 * `lib/typography/headline.test.ts`; `drawHeadline` só pinta o que o layout
 * já decidiu, no MESMO canvas do preview e do export (WYSIWYG).
 */

import { fontCss, type FontKey } from './fonts';

export type HeadlineAlign = 'left' | 'center' | 'right';

/** Fundo atrás do texto. */
export type HeadlinePanel = 'solido' | 'faixa' | 'nenhum';

export type HeadlineStyle = {
  /** modelo de aparência (ver HEADLINE_PRESETS) */
  presetId: string;
  /** multiplicador do corpo da fonte (1 = o do modelo) */
  fontScale: number;
  /** centro horizontal do bloco, 0..1 do frame */
  posX: number;
  /** centro vertical do bloco, 0..1 do frame */
  posY: number;
  /** largura MÁXIMA do bloco, fração do frame (a quebra de linha sai daqui) */
  width: number;
  align: HeadlineAlign;
  /** null = a cor do modelo */
  color: string | null;
  /** null = a cor do modelo */
  panelColor: string | null;
  /** 0..1; null = a do modelo */
  panelOpacity: number | null;
  panel: HeadlinePanel | null;
  /** null = o do modelo */
  font: FontKey | null;
  uppercase: boolean | null;
  /** aspas decorativas no canto (null = o do modelo) */
  quote: boolean | null;
};

export type Headline = {
  id: string;
  text: string;
  /** ms */
  start: number;
  /** ms */
  end: number;
  style: HeadlineStyle;
};

export type HeadlinePreset = {
  id: string;
  name: string;
  font: FontKey;
  /** corpo da fonte como fração da ALTURA do frame */
  size: number;
  lineHeight: number;
  uppercase: boolean;
  color: string;
  panel: HeadlinePanel;
  panelColor: string;
  panelOpacity: number;
  /** cantos do painel, fração do corpo da fonte */
  radius: number;
  /** respiro do painel, fração do corpo da fonte */
  padX: number;
  padY: number;
  quote: boolean;
  /** barra de acento na esquerda (fração do corpo) — 0 = sem barra */
  accentBar: number;
  accentColor: string;
  align: HeadlineAlign;
  /** sombra do texto (fração do corpo) */
  shadow: number;
};

const base = (p: Partial<HeadlinePreset> & Pick<HeadlinePreset, 'id' | 'name'>): HeadlinePreset => ({
  font: 'montserrat900',
  size: 0.052,
  lineHeight: 1.14,
  uppercase: true,
  color: '#ffffff',
  panel: 'solido',
  panelColor: '#101013',
  panelOpacity: 0.72,
  radius: 0.12,
  padX: 0.62,
  padY: 0.52,
  quote: false,
  accentBar: 0,
  accentColor: '#ffd60a',
  align: 'left',
  shadow: 0.06,
  ...p,
});

/**
 * O primeiro é o do print que o Silas mandou (31.08): painel escuro,
 * aspas grandes no topo, texto branco pesado em caixa alta alinhado à
 * esquerda.
 */
export const HEADLINE_PRESETS: HeadlinePreset[] = [
  base({ id: 'aspas-escura', name: 'Aspas', quote: true }),
  base({ id: 'faixa-escura', name: 'Painel', quote: false }),
  base({
    id: 'barra-acento',
    name: 'Barra',
    quote: false,
    accentBar: 0.16,
    padX: 0.7,
  }),
  base({
    id: 'faixa-linha',
    name: 'Faixa',
    panel: 'faixa',
    quote: false,
    padX: 0.42,
    padY: 0.3,
    radius: 0.06,
  }),
  base({
    id: 'limpa',
    name: 'Sem painel',
    panel: 'nenhum',
    quote: false,
    shadow: 0.14,
  }),
  base({
    id: 'aspas-clara',
    name: 'Aspas clara',
    quote: true,
    color: '#12131a',
    panelColor: '#f4f4f0',
    panelOpacity: 0.92,
  }),
  base({
    id: 'centro',
    name: 'Centro',
    align: 'center',
    quote: false,
    panelOpacity: 0.66,
  }),
];

export function getHeadlinePreset(id: string): HeadlinePreset {
  return HEADLINE_PRESETS.find((p) => p.id === id) ?? HEADLINE_PRESETS[0];
}

export const HEADLINE_STYLE_DEFAULT: HeadlineStyle = {
  presetId: 'aspas-escura',
  fontScale: 1,
  posX: 0.5,
  posY: 0.28,
  width: 0.82,
  align: 'left',
  color: null,
  panelColor: null,
  panelOpacity: null,
  panel: null,
  font: null,
  uppercase: null,
  quote: null,
};

/* ──────────────────────────────── layout ──────────────────────────────── */

export type HeadlineLine = { text: string; width: number };

export type HeadlineLayout = {
  lines: HeadlineLine[];
  fontPx: number;
  lineH: number;
  /** largura do maior texto (sem o respiro do painel) */
  textW: number;
  textH: number;
  /** caixa do PAINEL, em pixels do canvas */
  box: { x: number; y: number; w: number; h: number };
  padX: number;
  padY: number;
  quotePx: number;
};

/** Mede o texto usando o ctx (a fonte já tem que estar carregada). */
export type Measurer = (text: string, font: string) => number;

export function measurerFromCtx(ctx: CanvasRenderingContext2D): Measurer {
  return (text, font) => {
    ctx.font = font;
    return ctx.measureText(text).width;
  };
}

/**
 * Quebra o texto em linhas que cabem em `maxW`.
 *
 * Respeita a quebra que o USER escreveu (Enter) e, dentro de cada parágrafo,
 * quebra por palavra. Palavra sozinha maior que a linha fica sozinha na linha
 * (não parte no meio — nome de remédio partido no meio é pior que estourar).
 */
export function wrapHeadline(
  text: string,
  maxW: number,
  measure: (s: string) => number,
): string[] {
  const out: string[] = [];
  for (const paragrafo of text.split(/\r?\n/)) {
    const palavras = paragrafo.split(/\s+/).filter((w) => w.length > 0);
    if (palavras.length === 0) {
      out.push('');
      continue;
    }
    let linha = '';
    for (const p of palavras) {
      const tentativa = linha ? `${linha} ${p}` : p;
      if (linha && measure(tentativa) > maxW) {
        out.push(linha);
        linha = p;
      } else {
        linha = tentativa;
      }
    }
    if (linha) out.push(linha);
  }
  return out.length > 0 ? out : [''];
}

export function layoutHeadline(
  measure: Measurer,
  h: Headline,
  W: number,
  H: number,
): HeadlineLayout {
  const preset = getHeadlinePreset(h.style.presetId);
  const fontKey = h.style.font ?? preset.font;
  const fontPx = Math.max(6, preset.size * H * (h.style.fontScale || 1));
  const lineH = fontPx * preset.lineHeight;
  const padX = preset.padX * fontPx;
  const padY = preset.padY * fontPx;
  const painel = h.style.panel ?? preset.panel;
  const quote = h.style.quote ?? preset.quote;
  const quotePx = quote ? fontPx * 1.5 : 0;

  const upper = h.style.uppercase ?? preset.uppercase;
  const texto = upper ? h.text.toUpperCase() : h.text;
  const css = fontCss(fontKey, fontPx);
  const maxTexto = Math.max(fontPx, h.style.width * W - padX * 2);
  const lines = wrapHeadline(texto, maxTexto, (s) => measure(s, css)).map((t) => ({
    text: t,
    width: measure(t, css),
  }));

  const textW = Math.max(1, ...lines.map((l) => l.width));
  const textH = lines.length * lineH;
  const boxW = painel === 'nenhum' ? textW : textW + padX * 2;
  const boxH = (painel === 'nenhum' ? textH : textH + padY * 2) + quotePx;

  // âncora: posX/posY é o CENTRO do bloco, com a mesma promessa do arrasto da
  // legenda — dá pra pendurar pra fora, mas nunca some inteiro
  const restoX = Math.max(8, Math.min(boxW, W) * 0.14);
  const restoY = Math.max(8, Math.min(boxH, H) * 0.14);
  const cx = Math.min(
    W - restoX + boxW / 2,
    Math.max(restoX - boxW / 2, h.style.posX * W),
  );
  const cy = Math.min(
    H - restoY + boxH / 2,
    Math.max(restoY - boxH / 2, h.style.posY * H),
  );

  return {
    lines,
    fontPx,
    lineH,
    textW,
    textH,
    box: { x: cx - boxW / 2, y: cy - boxH / 2, w: boxW, h: boxH },
    padX,
    padY,
    quotePx,
  };
}

/** Limites de posX/posY desta headline (o arrasto usa exatamente estes). */
export function headlinePosBounds(
  boxW: number,
  boxH: number,
  W: number,
  H: number,
): { minX: number; maxX: number; minY: number; maxY: number } {
  const restoX = Math.max(8, Math.min(boxW, W) * 0.14);
  const restoY = Math.max(8, Math.min(boxH, H) * 0.14);
  return {
    minX: (restoX - boxW / 2) / W,
    maxX: (W - restoX + boxW / 2) / W,
    minY: (restoY - boxH / 2) / H,
    maxY: (H - restoY + boxH / 2) / H,
  };
}

/** As headlines vivas neste instante (ordem estável: a de cima é a última). */
export function headlinesAt(list: Headline[], tMs: number): Headline[] {
  return list.filter((h) => tMs >= h.start && tMs < h.end && h.text.trim().length > 0);
}

/* ──────────────────────────────── desenho ─────────────────────────────── */

function comAlpha(hex: string, a: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

/** Desenha UMA headline. Não mexe em nada fora do próprio save/restore. */
export function drawHeadline(
  ctx: CanvasRenderingContext2D,
  h: Headline,
  W: number,
  H: number,
  layoutPronto?: HeadlineLayout,
): void {
  const preset = getHeadlinePreset(h.style.presetId);
  const L = layoutPronto ?? layoutHeadline(measurerFromCtx(ctx), h, W, H);
  if (L.lines.length === 0) return;

  const painel = h.style.panel ?? preset.panel;
  const cor = h.style.color ?? preset.color;
  const corPainel = h.style.panelColor ?? preset.panelColor;
  const opac = h.style.panelOpacity ?? preset.panelOpacity;
  const align = h.style.align ?? preset.align;
  const fontKey = h.style.font ?? preset.font;
  const quote = h.style.quote ?? preset.quote;

  ctx.save();
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  // painel
  if (painel !== 'nenhum') {
    ctx.fillStyle = comAlpha(corPainel, opac);
    if (painel === 'faixa') {
      // uma faixa por LINHA, colada no texto (estilo legenda de jornal)
      for (let i = 0; i < L.lines.length; i++) {
        const w = L.lines[i].width + L.padX * 2;
        const x =
          align === 'center'
            ? L.box.x + L.box.w / 2 - w / 2
            : align === 'right'
              ? L.box.x + L.box.w - w
              : L.box.x;
        const y = L.box.y + L.quotePx + i * L.lineH;
        roundRectPath(ctx, x, y, w, L.lineH, preset.radius * L.fontPx);
        ctx.fill();
      }
    } else {
      roundRectPath(ctx, L.box.x, L.box.y, L.box.w, L.box.h, preset.radius * L.fontPx);
      ctx.fill();
    }
  }

  // barra de acento na esquerda
  if (preset.accentBar > 0 && painel !== 'nenhum') {
    ctx.fillStyle = preset.accentColor;
    const bw = preset.accentBar * L.fontPx;
    roundRectPath(ctx, L.box.x, L.box.y, bw, L.box.h, bw / 2);
    ctx.fill();
  }

  // aspas decorativas
  if (quote) {
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = cor;
    ctx.font = fontCss('playfair900i', L.fontPx * 1.9);
    ctx.fillText('“', L.box.x + L.padX, L.box.y + L.quotePx + L.fontPx * 0.32);
    ctx.restore();
  }

  // texto
  ctx.font = fontCss(fontKey, L.fontPx);
  ctx.fillStyle = cor;
  if (preset.shadow > 0) {
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = preset.shadow * L.fontPx;
    ctx.shadowOffsetY = preset.shadow * L.fontPx * 0.35;
  }
  const interno = painel === 'nenhum' ? 0 : L.padX;
  const topo = L.box.y + L.quotePx + (painel === 'nenhum' ? 0 : L.padY);
  for (let i = 0; i < L.lines.length; i++) {
    const ln = L.lines[i];
    const faixa = L.box.w - interno * 2;
    const x =
      align === 'center'
        ? L.box.x + interno + (faixa - ln.width) / 2
        : align === 'right'
          ? L.box.x + interno + (faixa - ln.width)
          : L.box.x + interno;
    // 0.76 põe a baseline dentro da caixa da linha (mesma proporção da legenda)
    ctx.fillText(ln.text, x, topo + i * L.lineH + L.lineH * 0.76);
  }
  ctx.restore();
}

/** Desenha todas as headlines vivas no instante `tMs`. */
export function drawHeadlines(
  ctx: CanvasRenderingContext2D,
  list: Headline[],
  tMs: number,
  W: number,
  H: number,
): void {
  for (const h of headlinesAt(list, tMs)) drawHeadline(ctx, h, W, H);
}

/** Qual headline está sob o ponto (canvas px)? A de cima ganha. */
export function headlineAtPoint(
  measure: Measurer,
  list: Headline[],
  tMs: number,
  px: number,
  py: number,
  W: number,
  H: number,
): { headline: Headline; layout: HeadlineLayout } | null {
  const vivas = headlinesAt(list, tMs);
  for (let i = vivas.length - 1; i >= 0; i--) {
    const L = layoutHeadline(measure, vivas[i], W, H);
    if (px >= L.box.x && px <= L.box.x + L.box.w && py >= L.box.y && py <= L.box.y + L.box.h) {
      return { headline: vivas[i], layout: L };
    }
  }
  return null;
}

let hSeq = 0;
export function newHeadlineId(): string {
  hSeq += 1;
  return `h${hSeq.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

/** Headline nova, já posicionada e com uma janela de tempo razoável. */
export function makeHeadline(startMs: number, durationMs: number, texto = ''): Headline {
  const dur = Math.max(600, Math.min(4000, durationMs || 4000));
  return {
    id: newHeadlineId(),
    text: texto,
    start: Math.max(0, Math.round(startMs)),
    end: Math.max(0, Math.round(startMs)) + dur,
    style: { ...HEADLINE_STYLE_DEFAULT },
  };
}
