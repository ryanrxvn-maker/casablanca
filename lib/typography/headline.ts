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
  /**
   * null = o alinhamento do MODELO.
   * ⚠ Isto era `HeadlineAlign` puro com default 'left', e por isso o
   * alinhamento do modelo NUNCA valia: o estilo sempre trazia um valor
   * concreto que ganhava do preset. A cartela de citação, que é centralizada,
   * saía à esquerda.
   */
  align: HeadlineAlign | null;
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
  /** rotação em graus (0 = reta) — a alça de girar do preview escreve aqui */
  rotation?: number;
  /** animação de ENTRADA (0.35s) — 'nenhuma' = aparece seca */
  animIn?: HeadlineAnim;
  /** animação de SAÍDA (0.3s) */
  animOut?: HeadlineAnim;
};

/** Animações da headline — poucas e sóbrias (headline é texto PARADO). */
export type HeadlineAnim = 'nenhuma' | 'fade' | 'sobe' | 'zoom' | 'varre';

export const HEADLINE_ANIMS: Array<{ kind: HeadlineAnim; label: string }> = [
  { kind: 'nenhuma', label: 'Nenhuma' },
  { kind: 'fade', label: 'Fade' },
  { kind: 'sobe', label: 'Sobe' },
  { kind: 'zoom', label: 'Zoom' },
  { kind: 'varre', label: 'Varredura' },
];

const ANIM_IN_MS = 350;
const ANIM_OUT_MS = 300;

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
  /**
   * COMO o painel e desenhado. Cada referencia do Silas pedia um desenho que
   * um retangulo com raio nao faz:
   *  - 'rasgado': papel rasgado — a borda e um polígono serrilhado
   *    deterministico (semente = id da headline, entao nao formiga entre
   *    frames nem muda entre preview e export)
   *  - 'news': barra de plantao de jornal — gradiente vertical + brilho
   *    de vidro na metade de cima + filete de luz na borda
   *  - 'padrao': retangulo (com ou sem raio) de sempre
   */
  kind: 'padrao' | 'rasgado' | 'news';
  /** gradiente VERTICAL do painel (stops 0..1) — quando presente, vence panelColor */
  panelGrad: Array<[number, string]> | null;
  /**
   * Aspas como SELO: um quadradinho arredondado na cor quoteColor montado
   * SOBRE a borda de cima do painel (metade pra fora), com as aspas brancas
   * dentro — como na cartela de citacao da referencia. false = aspas soltas
   * desenhadas dentro do painel (estilo antigo).
   */
  quoteBadge: boolean;
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
  /** tamanho das aspas, fração do corpo da fonte */
  quoteSize: number;
  /** cor das aspas; null = a mesma do texto */
  quoteColor: string | null;
  /**
   * Painel de BORDA A BORDA: ignora a largura do texto e ocupa o quadro
   * inteiro na horizontal (cartela de citação). O texto continua respeitando
   * a largura escolhida pra quebra de linha.
   */
  fullBleed: boolean;
  /** letter-spacing, fração do corpo */
  spacing: number;
  /** barra de acento na esquerda (fração do corpo) — 0 = sem barra */
  accentBar: number;
  accentColor: string;
  align: HeadlineAlign;
  /** sombra do texto (fração do corpo) */
  shadow: number;
};

const base = (p: Partial<HeadlinePreset> & Pick<HeadlinePreset, 'id' | 'name'>): HeadlinePreset => ({
  kind: 'padrao',
  panelGrad: null,
  quoteBadge: false,
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
  quoteSize: 1.9,
  quoteColor: null,
  fullBleed: false,
  accentBar: 0,
  accentColor: '#ffd60a',
  align: 'left',
  shadow: 0.06,
  spacing: 0,
  ...p,
});

/**
 * Modelos — cada um copia UMA referência real que o Silas mandou em print
 * (02.09), e o pedido foi fidelidade máxima: "0 diferenças". Por isso os
 * comentários citam a referência, não gosto meu.
 */
export const HEADLINE_PRESETS: HeadlinePreset[] = [
  // ⭐ REF 1 — cartela de citação: faixa verde-sálvia de borda a borda, texto
  // branco pesado CENTRALIZADO em caixa alta, e um SELO quadradinho verde-
  // claro com aspas brancas montado sobre a borda de cima, à esquerda.
  base({
    id: 'cartela-citacao',
    name: 'Citação',
    panelColor: '#587568',
    panelOpacity: 1,
    fullBleed: true,
    radius: 0,
    align: 'center',
    quote: true,
    quoteBadge: true,
    quoteSize: 1.5,
    quoteColor: '#7fa693',
    size: 0.038,
    lineHeight: 1.32,
    padX: 0.9,
    padY: 0.8,
    spacing: 0.004,
    shadow: 0,
  }),
  // ⭐ REF 2 — papel RASGADO vermelho: retalho de papel de borda serrilhada,
  // texto branco arredondado em caixa BAIXA, centralizado. O rasgo é o
  // desenho inteiro — retângulo arredondado não parece papel.
  base({
    id: 'rasgado-vermelho',
    name: 'Rasgado',
    kind: 'rasgado',
    font: 'poppins800',
    uppercase: false,
    panelColor: '#c0111c',
    panelGrad: [
      [0, '#d31420'],
      [1, '#a90d18'],
    ],
    panelOpacity: 1,
    align: 'center',
    quote: false,
    size: 0.044,
    lineHeight: 1.3,
    padX: 0.85,
    padY: 0.55,
    radius: 0,
    shadow: 0.05,
  }),
  // ⭐ REF 3 — TARJA vermelha inteira: banda sólida de borda a borda, canto
  // RETO, texto branco em caixa baixa alinhado à ESQUERDA com respiro grande.
  base({
    id: 'tarja-vermelha',
    name: 'Tarja',
    font: 'poppins800',
    uppercase: false,
    panelColor: '#b31217',
    panelGrad: [
      [0, '#c2151b'],
      [1, '#8f0e13'],
    ],
    panelOpacity: 1,
    fullBleed: true,
    radius: 0,
    align: 'left',
    quote: false,
    size: 0.042,
    lineHeight: 1.32,
    padX: 1.1,
    padY: 0.62,
    shadow: 0,
  }),
  // ⭐ REF 4 — barra NEWS azul: gradiente azul-claro→azul-fundo com brilho de
  // vidro em cima e filete de luz na borda, de ponta a ponta, texto branco
  // pesado à esquerda — a cartela de plantão de telejornal.
  base({
    id: 'news-azul',
    name: 'News',
    kind: 'news',
    font: 'archivo',
    uppercase: false,
    panelColor: '#2f6fd6',
    panelGrad: [
      [0, '#6fb0f5'],
      [0.45, '#2f6fd6'],
      [1, '#173f96'],
    ],
    panelOpacity: 1,
    fullBleed: true,
    radius: 0.3,
    align: 'left',
    quote: false,
    size: 0.04,
    lineHeight: 1.25,
    padX: 1.0,
    padY: 0.6,
    shadow: 0,
  }),
  // cartela escura de canto arredondado com aspas grandes soltas — pra
  // depoimento em vídeo escuro
  base({
    id: 'aspas-escura',
    name: 'Aspas',
    quote: true,
    quoteSize: 2.6,
    panelColor: '#15161a',
    panelOpacity: 0.88,
    radius: 0.05,
    padX: 0.78,
    padY: 0.62,
    size: 0.05,
    lineHeight: 1.08,
    spacing: 0.005,
    shadow: 0,
  }),
  // cartela CLARA (texto escuro em papel claro) — vídeo escuro demais pro resto
  base({
    id: 'aspas-clara',
    name: 'Clara',
    quote: true,
    color: '#12131a',
    panelColor: '#f4f4f0',
    panelOpacity: 0.92,
  }),
  // uma faixinha POR LINHA, colada no texto — legenda de jornal
  base({
    id: 'faixa-linha',
    name: 'Faixa',
    panel: 'faixa',
    quote: false,
    padX: 0.42,
    padY: 0.3,
    radius: 0.06,
  }),
  // só o texto com sombra — pra quando o vídeo já é o fundo
  base({
    id: 'limpa',
    name: 'Sem fundo',
    panel: 'nenhum',
    quote: false,
    shadow: 0.14,
  }),
];

export function getHeadlinePreset(id: string): HeadlinePreset {
  return HEADLINE_PRESETS.find((p) => p.id === id) ?? HEADLINE_PRESETS[0];
}

export const HEADLINE_STYLE_DEFAULT: HeadlineStyle = {
  presetId: 'cartela-citacao',
  fontScale: 1,
  posX: 0.5,
  posY: 0.34,
  width: 0.9,
  align: null,
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
  // selo: metade dele mora FORA do painel, então a folga interna é menor
  const quotePx = quote ? fontPx * preset.quoteSize * (preset.quoteBadge ? 0.4 : 0.62) : 0;

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
  // fullBleed: o PAINEL vai de borda a borda do quadro (tarja, news,
  // cartela). Antes o flag so mexia nas aspas e a "tarja" saia caixinha
  // solta no meio — nada a ver com a referencia.
  const bleed = preset.fullBleed && painel !== 'nenhum';
  const boxW = bleed ? W : painel === 'nenhum' ? textW : textW + padX * 2;
  const boxH = (painel === 'nenhum' ? textH : textH + padY * 2) + quotePx;

  // âncora: posX/posY é o CENTRO do bloco, com a mesma promessa do arrasto da
  // legenda — dá pra pendurar pra fora, mas nunca some inteiro
  const restoX = Math.max(8, Math.min(boxW, W) * 0.14);
  const restoY = Math.max(8, Math.min(boxH, H) * 0.14);
  const cx = bleed
    ? W / 2 // borda a borda: so a ALTURA e do user
    : Math.min(
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

/* ── papel rasgado ──
 * A borda serrilhada nasce de um PRNG semeado pelo id da headline: o rasgo é
 * sempre o MESMO em todo frame, no preview e no export — rasgo que formiga
 * entre frames vira ruído, não papel. */
function prngDe(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 15), h | 1);
    h ^= h + Math.imul(h ^ (h >>> 7), h | 61);
    return ((h ^ (h >>> 14)) >>> 0) / 4294967296;
  };
}

/** Polígono de papel rasgado ao redor da caixa (dente ~fração do corpo). */
function tornPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  dente: number,
  seed: string,
) {
  const rnd = prngDe(seed);
  // ondas LARGAS e suaves (a referência é papel rasgado de verdade, não
  // selo picotado): poucos dentes, amplitude irregular, e o contorno passa
  // por curvas quadráticas em vez de retas — rasgo tem fibra, não vértice.
  const passo = dente * 2.6;
  const pts: Array<[number, number]> = [];
  const nTop = Math.max(3, Math.round(w / passo));
  const nSide = Math.max(2, Math.round(h / passo));
  const amp = () => (rnd() - 0.5) * dente * (0.9 + rnd() * 1.6);
  for (let i = 0; i <= nTop; i++)
    pts.push([x + (w * i) / nTop, y + amp() * (i === 0 || i === nTop ? 0.5 : 1)]);
  for (let i = 1; i <= nSide; i++)
    pts.push([x + w + amp(), y + (h * i) / nSide]);
  for (let i = 1; i <= nTop; i++)
    pts.push([x + w - (w * i) / nTop, y + h + amp() * (i === nTop ? 0.5 : 1)]);
  for (let i = 1; i < nSide; i++)
    pts.push([x + amp(), y + h - (h * i) / nSide]);
  // metade dos vértices é PONTA (lineTo), metade é fibra (curva) — tudo
  // curva vira balão, tudo reta vira serra de picote; o rasgo real mistura.
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i];
    if (rnd() < 0.5) {
      ctx.lineTo(a[0], a[1]);
    } else {
      const b = pts[(i + 1) % pts.length];
      ctx.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    }
  }
  ctx.closePath();
}

/** Preenchimento do painel: gradiente vertical quando o modelo pede. */
function panelPaint(
  ctx: CanvasRenderingContext2D,
  preset: HeadlinePreset,
  corPainel: string,
  opac: number,
  y: number,
  h: number,
): string | CanvasGradient {
  if (preset.panelGrad && preset.panelGrad.length > 1) {
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    for (const [o, c] of preset.panelGrad) g.addColorStop(o, comAlpha(c, opac));
    return g;
  }
  return comAlpha(corPainel, opac);
}

/**
 * Desenha UMA headline. Não mexe em nada fora do próprio save/restore.
 * `tMs` liga as animações de entrada/saída; sem ele, desenha parada (thumbs).
 */
export function drawHeadline(
  ctx: CanvasRenderingContext2D,
  h: Headline,
  W: number,
  H: number,
  layoutPronto?: HeadlineLayout,
  tMs?: number,
): void {
  const preset = getHeadlinePreset(h.style.presetId);
  const L = layoutPronto ?? layoutHeadline(measurerFromCtx(ctx), h, W, H);
  if (L.lines.length === 0) return;

  // progresso das animações (0..1); fora das janelas fica 1
  let pIn = 1;
  let pOut = 1;
  if (tMs !== undefined) {
    const ai = h.style.animIn ?? 'nenhuma';
    const ao = h.style.animOut ?? 'nenhuma';
    if (ai !== 'nenhuma') pIn = Math.min(1, Math.max(0, (tMs - h.start) / ANIM_IN_MS));
    if (ao !== 'nenhuma') pOut = Math.min(1, Math.max(0, (h.end - tMs) / ANIM_OUT_MS));
  }

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

  const cxB = L.box.x + L.box.w / 2;
  const cyB = L.box.y + L.box.h / 2;

  // rotação da alça de girar — o hit-test desfaz a mesma conta
  const rotDeg = h.style.rotation ?? 0;
  if (rotDeg !== 0) {
    ctx.translate(cxB, cyB);
    ctx.rotate((rotDeg * Math.PI) / 180);
    ctx.translate(-cxB, -cyB);
  }

  // entrada/saída: easing suave, transform em volta do centro
  if (pIn < 1 || pOut < 1) {
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);
    const eIn = ease(pIn);
    const eOut = ease(pOut);
    const modo = pIn < 1 ? (h.style.animIn ?? 'nenhuma') : (h.style.animOut ?? 'nenhuma');
    const e = pIn < 1 ? eIn : eOut;
    ctx.globalAlpha *= Math.min(eIn, eOut);
    if (modo === 'sobe') {
      ctx.translate(0, (1 - e) * L.fontPx * (pIn < 1 ? 1.2 : -1.2));
    } else if (modo === 'zoom') {
      const sc = 0.85 + 0.15 * e;
      ctx.translate(cxB, cyB);
      ctx.scale(sc, sc);
      ctx.translate(-cxB, -cyB);
    } else if (modo === 'varre') {
      // recorte que abre da esquerda pra direita (fecha na saída)
      ctx.beginPath();
      ctx.rect(L.box.x - L.fontPx, L.box.y - L.fontPx * 2, (L.box.w + L.fontPx * 2) * e, L.box.h + L.fontPx * 4);
      ctx.clip();
      ctx.globalAlpha = Math.min(1, ctx.globalAlpha * 3);
    }
  }

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
    } else if (preset.kind === 'rasgado') {
      // papel rasgado: sombra macia por baixo + polígono serrilhado estável
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.4)';
      ctx.shadowBlur = L.fontPx * 0.35;
      ctx.shadowOffsetY = L.fontPx * 0.16;
      tornPath(ctx, L.box.x, L.box.y, L.box.w, L.box.h, L.fontPx * 0.34, h.id);
      ctx.fillStyle = panelPaint(ctx, preset, corPainel, opac, L.box.y, L.box.h);
      ctx.fill();
      ctx.restore();
    } else if (preset.kind === 'news') {
      // barra de plantão: gradiente + BRILHO de vidro em cima + filete de luz
      const r = preset.radius * L.fontPx;
      roundRectPath(ctx, L.box.x, L.box.y, L.box.w, L.box.h, r);
      ctx.fillStyle = panelPaint(ctx, preset, corPainel, opac, L.box.y, L.box.h);
      ctx.fill();
      ctx.save();
      roundRectPath(ctx, L.box.x, L.box.y, L.box.w, L.box.h, r);
      ctx.clip();
      const gloss = ctx.createLinearGradient(0, L.box.y, 0, L.box.y + L.box.h * 0.52);
      gloss.addColorStop(0, 'rgba(255,255,255,0.34)');
      gloss.addColorStop(1, 'rgba(255,255,255,0.03)');
      ctx.fillStyle = gloss;
      ctx.fillRect(L.box.x, L.box.y, L.box.w, L.box.h * 0.52);
      // sombra interna no pé — dá o corpo 3D da cartela de TV
      const pe = ctx.createLinearGradient(0, L.box.y + L.box.h * 0.7, 0, L.box.y + L.box.h);
      pe.addColorStop(0, 'rgba(0,0,0,0)');
      pe.addColorStop(1, 'rgba(0,0,0,0.28)');
      ctx.fillStyle = pe;
      ctx.fillRect(L.box.x, L.box.y + L.box.h * 0.7, L.box.w, L.box.h * 0.3);
      ctx.restore();
      ctx.save();
      roundRectPath(
        ctx,
        L.box.x + 1,
        L.box.y + 1,
        L.box.w - 2,
        L.box.h - 2,
        Math.max(0, r - 1),
      );
      ctx.strokeStyle = 'rgba(190,220,255,0.55)';
      ctx.lineWidth = Math.max(1, L.fontPx * 0.035);
      ctx.stroke();
      ctx.restore();
    } else {
      roundRectPath(ctx, L.box.x, L.box.y, L.box.w, L.box.h, preset.radius * L.fontPx);
      ctx.fillStyle = panelPaint(ctx, preset, corPainel, opac, L.box.y, L.box.h);
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

  // Aspas decorativas — FORA do fluxo do texto: ficam no canto de cima a
  // esquerda mesmo com o texto centralizado (e assim na referencia), e com
  // cor propria (na referencia sao verdes, nao brancas).
  if (quote && preset.quoteBadge) {
    // SELO da referência: quadradinho arredondado verde-claro montado SOBRE a
    // borda de cima do painel (metade pra fora), aspas brancas dentro.
    ctx.save();
    const lado = L.fontPx * preset.quoteSize;
    const qx = L.box.x + (preset.fullBleed ? W * 0.06 : L.padX * 0.7);
    const qy = L.box.y - lado / 2;
    roundRectPath(ctx, qx, qy, lado, lado, lado * 0.22);
    ctx.fillStyle = preset.quoteColor ?? cor;
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = fontCss('playfair900i', lado * 1.05);
    ctx.textAlign = 'center';
    // o glifo “ mora acima da baseline — 1.18*lado centra o par no selo
    ctx.fillText('“', qx + lado / 2, qy + lado * 1.18);
    ctx.restore();
  } else if (quote) {
    ctx.save();
    ctx.fillStyle = preset.quoteColor ?? cor;
    ctx.font = fontCss('playfair900i', L.fontPx * preset.quoteSize);
    const qx = L.box.x + (preset.fullBleed ? W * 0.07 : L.padX * 0.7);
    ctx.fillText('“', qx, L.box.y + L.padY + L.quotePx * 0.82);
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
  const bleed = preset.fullBleed && painel !== 'nenhum';
  const interno = painel === 'nenhum' ? 0 : bleed ? Math.max(L.padX, W * 0.055) : L.padX;
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
  for (const h of headlinesAt(list, tMs)) drawHeadline(ctx, h, W, H, undefined, tMs);
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
    const rot = ((vivas[i].style.rotation ?? 0) * Math.PI) / 180;
    let lx = px;
    let ly = py;
    if (rot !== 0) {
      // a caixa é reta no espaço local; quem gira ao contrário é o ponto
      const cx = L.box.x + L.box.w / 2;
      const cy = L.box.y + L.box.h / 2;
      const cos = Math.cos(-rot);
      const sin = Math.sin(-rot);
      const dx = px - cx;
      const dy = py - cy;
      lx = cx + dx * cos - dy * sin;
      ly = cy + dx * sin + dy * cos;
    }
    if (lx >= L.box.x && lx <= L.box.x + L.box.w && ly >= L.box.y && ly <= L.box.y + L.box.h) {
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
