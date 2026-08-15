/**
 * TIPOGRAFIA AUTOMÁTICA — engine de letterings animados em canvas 2D.
 *
 * Regras de ouro:
 *  - Tempo SEMPRE em ms e SEMPRE derivado do tempo do vídeo (t). Nada de
 *    Date.now()/Math.random() no desenho — o frame N do preview e o frame N
 *    do export precisam ser IDÊNTICOS (WYSIWYG). Aleatoriedade (glitch,
 *    flicker, jitter) vem de PRNG determinístico semeado por (bloco, unidade,
 *    passo de tempo).
 *  - Tamanhos relativos à LARGURA do canvas — preview pequeno e export
 *    full-res renderizam a mesma composição em proporção.
 *  - Um preset é DATA (recipe); o engine implementa as primitivas. Preview,
 *    galeria de modelos e export final usam exatamente este drawCaptions.
 *
 * Primitivas "nível plugin": aberração cromática RGB persistente, glitch de
 * FATIAS deslocadas (composição via canvas offscreen — nunca fatia o vídeo,
 * só o lettering), extrude 3D, sombra dura de pôster, caixas/barras com
 * skew e sombra sólida, cores alternadas por palavra, rotação de bloco com
 * jitter carimbado, palavra destacada em escala maior.
 */

import { fontCss, type FontKey } from './fonts';

// Negrito/italico SINTETICOS do editor (setados por drawCaptions/captionBBoxAt
// a partir do estilo efetivo — o italic oblique o navegador sintetiza no
// canvas; o negrito e um stroke fino da propria cor no fillWordText).
let FAUX_ITALIC = false;
let FAUX_BOLD = false;
function fs(key: FontKey, px: number): string {
  const base = fontCss(key, px);
  return FAUX_ITALIC && !base.startsWith('italic') ? 'italic ' + base : base;
}

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

export type LoopKind =
  | 'none'
  | 'wave'
  | 'shake'
  | 'pulse'
  | 'float'
  | 'flicker'
  | 'glitch';
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
/** o que o canvas aceita como fillStyle */
type Paint = string | CanvasGradient | CanvasPattern;

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
  /** gradiente multi-stop (ouro/chrome/duotone) — offsets 0..1, aceita tokens */
  gradientStops?: Array<[number, PresetColor]>;
  /** direção do gradiente (diagonal = ref "BRAND DESIGN") */
  gradientDir?: 'vertical' | 'diagonal';
  stroke?: { color: PresetColor; width: number };
  /** sombra suave (blur) */
  shadow?: { color: string; blur: number; x: number; y: number };
  /** sombra DURA de pôster (cópia sólida deslocada, sem blur) */
  hardShadow?: { color: PresetColor; x: number; y: number };
  /** texto 3D: pilha de cópias deslocadas atrás do fill; fade esvanece a cauda */
  extrude?: { color: PresetColor; x: number; y: number; steps: number; fade?: boolean };
  glow?: { color: PresetColor; blur: number };
  /** brilho metálico varrendo o texto em loop (shine sweep) */
  shine?: { period: number; alpha: number };
  /** anéis de contorno atrás do texto (aura de neon) */
  aura?: { color: PresetColor; count: number; width: number; alpha: number; pulse?: boolean };
  /** aberração cromática RGB persistente (cores customizáveis; default red/cyan) */
  chroma?: { amp: number; flicker?: boolean; colors?: [string, string] };
  /** fatias horizontais deslocadas (durante a entrada e, com loop glitch, em bursts) */
  glitchBands?: boolean;
  /** cores do texto alternando por palavra */
  colorCycle?: PresetColor[];
  /** escala do texto alternando por palavra (variação de tamanho automática) */
  sizeCycle?: number[];
  /**
   * DESTAQUE AUTOMÁTICO: sem destaque manual no bloco, o engine escolhe a
   * palavra mais forte (mais longa) e aplica o tratamento de destaque do
   * preset (highlightStyle/Scale/Color). É o que faz cada bloco sair com
   * variação de cor e tamanho sem o user clicar em nada.
   */
  autoEmphasis?: boolean;
  /**
   * TIPOGRAFIA MISTA (estilo "hoje VOCÊ VAI aprender"): a palavra destacada
   * usa a fonte/estilo principal do preset em tamanho cheio; as DEMAIS usam
   * esta fonte de apoio (serif itálica/script) menor, renderizadas "limpas"
   * (sem stroke/glow/extrude). accentLast pinta a última palavra de apoio
   * na cor de destaque (ref "essa forma AQUI.").
   */
  mix?: {
    font: FontKey;
    scale: number;
    lowercase?: boolean;
    color?: PresetColor;
    accentLast?: boolean;
    /** offset vertical das palavras de apoio (fração do fontSize; script "sobreposto") */
    dy?: number;
    /** letter-spacing extra das palavras de apoio (ref subtítulo espaçadinho) */
    spacing?: number;
  };
  /** última LINHA inteira na cor de destaque (ref "não é mais um / CURSO DE COPY") */
  lineAccent?: 'last';
  /** linhas finas de moldura acima/abaixo do bloco (ref "poucos minutos") */
  frameLines?: { color: PresetColor; thickness: number; gap: number };
  /** risco desenhado atrás do texto (ref "na sua edição", swoosh vermelho) */
  swoosh?: { color: PresetColor; width: number };
  /** preenchimento animado dentro das letras (trippy/stripes/tijolos/grunge) */
  patternFill?: {
    colors: [string, string];
    scale: number;
    speed: number;
    style?: 'trippy' | 'stripes' | 'bricks' | 'grunge';
  };
  /** fumaça procedural atrás do bloco */
  smoke?: { alpha: number };
  /**
   * ECOS DO TEXTO: cópias da própria frase em outra escala/posição/estilo —
   * a base dos letterings "frase pequena branca + gigante colorida",
   * do fantasma vazado gigante atrás e do empilhado repetido.
   * Ecos 'above'/'below' empilham na ordem do array.
   */
  echoes?: Array<{
    pos: 'above' | 'below' | 'behind';
    scale: number;
    color: PresetColor;
    alpha?: number;
    /** só contorno (vazado) */
    outline?: boolean;
    /** risco atravessado (ref eco triplo) */
    strike?: boolean;
    dx?: number;
    gap?: number;
    glow?: number;
  }>;
  /** elipse desenhada ao redor do texto (ref "circulado dourado") */
  circle?: { color: PresetColor; width: number };
  /** rabiscos/faíscas desenhados ao redor (ref "Como FAZER ESSA LEGENDA") */
  doodles?: { color: PresetColor };
  /** barra VERTICAL à esquerda do bloco (ref "| HIGHLIGHT KEY PHRASES") */
  sideBar?: { color: PresetColor; width: number };
  /** palavras NÃO destacadas saem riscadas (ref "NEITHER ~FORGES NOR~ GRINDS") */
  strikeOthers?: boolean;
  /** alinhamento do bloco (esquerda = pôster tipográfico) */
  align?: 'left';
  /** post-it: retângulo sólido rotacionado atrás/abaixo do texto */
  sticky?: { color: string; rotate: number };
  /** cores do texto alternando por LETRA (ref "FUN TEXT") */
  charColorCycle?: PresetColor[];
  /** fração de letras renderizadas SÓ CONTORNO (ref "VIBRANT FLICKER") */
  charOutlineRatio?: number;
  /** rotação fixa da composição (graus) */
  blockRotate?: number;
  /** jitter de rotação POR BLOCO, carimbado (graus máx) */
  blockRotateJitter?: number;
  /** jitter de rotação POR PALAVRA, carimbado (graus máx) */
  wordRotateJitter?: number;
  /** barra sólida sob cada linha (estilo pôster) */
  bar?: { color: PresetColor; thickness: number; skew?: number };
  box?: {
    mode: BoxMode;
    fill: PresetColor;
    radius: number;
    padX: number;
    padY: number;
    /** skew horizontal em graus (caixa inclinada de pôster) */
    skew?: number;
    /** caixas por palavra alternando estas cores */
    cycle?: PresetColor[];
    /** texto ganha cor de contraste automático sobre a caixa */
    autoText?: boolean;
    /** sombra sólida da caixa (segunda caixa deslocada atrás) */
    shadow?: { color: PresetColor; x: number; y: number };
    /** borda fina (ref pílula dourada) */
    border?: { color: PresetColor; width: number };
    /** preenchimento em gradiente vertical (ref botão CTA laranja) */
    gradient?: Array<[number, PresetColor]>;
    /** caixa só na primeira linha (ref "Most Businesses") */
    firstLineOnly?: boolean;
    /** caixa de linha atravessando o frame inteiro (ref "REPRESENTA" verde) */
    fullBleed?: boolean;
    /** caixa só na(s) linha(s) com palavra destacada */
    emphasisLineOnly?: boolean;
  };
  karaoke?: KaraokeMode;
  /** karaokê: alpha das palavras INATIVAS (0.3 = holofote na ativa) */
  karaokeDim?: number;
  /** como palavras destacadas manualmente aparecem */
  highlightStyle?: 'color' | 'box' | 'underline';
  /** escala extra das palavras destacadas (1 = igual) */
  highlightScale?: number;
  /** cor do destaque manual quando 'accent' não contrasta (ex.: texto sobre caixa accent) */
  highlightColor?: PresetColor;
  /** gradiente PRÓPRIO da palavra destacada (ouro no "2026", roxo no "DINÂMICOS") */
  highlightGradient?: Array<[number, PresetColor]>;
  /** FONTE própria da palavra destacada (ex.: texto clean + destaque cartoon) */
  highlightFont?: FontKey;
  /** máscara: painel escurecido com o texto VAZADO mostrando o vídeo através das letras */
  knockout?: { dim: number; pad: number };
  /** a palavra destacada quebra pra PRÓPRIA linha ("hoje / VOCÊ VAI / aprender") */
  emphasisBreak?: boolean;
  /** pirâmide: CADA palavra na própria linha (ref "Comenta PACK") */
  stack?: boolean;
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
  /** desliga o destaque automático dos presets (default: ligado) */
  autoEmphasis?: boolean;
  /** troca a fonte PRINCIPAL do modelo (o apoio do mix mantém a dele) */
  fontOverride?: FontKey | null;
  /** posição horizontal do centro da legenda (0..1; default 0.5 = centro) */
  posX?: number;
  /** caixa estilo CapCut: TT (upper) / tt (lower) / Tt (original) / null = do modelo */
  textCase?: 'upper' | 'lower' | 'original' | null;
  /** negrito sintético (engrossa com stroke da própria cor) */
  bold?: boolean;
  /** itálico sintético (oblique do navegador) */
  italic?: boolean;
  /** sublinhado (linha sob cada palavra na cor do texto) */
  underline?: boolean;
  /** FX ajustáveis (multiplicadores sobre o que o modelo já tem; 1 = padrão, 0 = desliga) */
  fxStroke?: number;
  fxShadow?: number;
  fxGlow?: number;
  fxSmoke?: number;
  /**
   * "Aplicar a todas" DESLIGADO: overrides por bloco — o merge acontece
   * dentro do drawCaptions, então preview E export honram igual.
   */
  perBlock?: Record<string, PerBlockStyle>;
};

export type PerBlockStyle = Partial<
  Pick<
    StyleState,
    | 'fontScale'
    | 'primary'
    | 'accent'
    | 'posX'
    | 'posY'
    | 'textCase'
    | 'bold'
    | 'italic'
    | 'underline'
    | 'fontOverride'
    | 'fxStroke'
    | 'fxShadow'
    | 'fxGlow'
    | 'fxSmoke'
  >
>;

export const DEFAULT_STYLE: Omit<StyleState, 'presetId'> = {
  fontScale: 1,
  posY: 0.76,
  primary: null,
  accent: null,
  uppercase: null,
  highlights: {},
  autoEmphasis: true,
  fontOverride: null,
  posX: 0.5,
};

// Palavras vazias que NUNCA merecem destaque (PT/EN/ES). A palavra forte é
// conteúdo: substantivo, número, valor — não conectivo.
const STOPWORDS = new Set([
  // pt
  'de', 'da', 'do', 'das', 'dos', 'a', 'o', 'as', 'os', 'um', 'uma', 'uns',
  'umas', 'e', 'é', 'que', 'pra', 'pro', 'para', 'com', 'sem', 'em', 'na',
  'no', 'nas', 'nos', 'por', 'se', 'sua', 'seu', 'suas', 'seus', 'te', 'me',
  'nem', 'mas', 'ou', 'ja', 'já', 'ao', 'aos', 'à', 'às', 'como', 'mais',
  'menos', 'muito', 'muita', 'isso', 'isto', 'esse', 'essa', 'este', 'esta',
  'aqui', 'ali', 'la', 'lá', 'ela', 'ele', 'elas', 'eles', 'voce', 'você',
  'vai', 'ser', 'ter', 'foi', 'tem', 'uns', 'era', 'são', 'sao', 'está',
  'esta', 'tá', 'ta', 'não', 'nao', 'sim', 'dia', 'até', 'ate',
  // en
  'the', 'an', 'of', 'to', 'in', 'on', 'and', 'or', 'is', 'are', 'was',
  'for', 'with', 'your', 'you', 'this', 'that', 'it', 'at', 'be', 'so',
  'we', 'my', 'me', 'do', 'did', 'not', 'but', 'by', 'from', 'as', 'if',
  // es
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'y', 'es', 'en',
  'del', 'al', 'tu', 'su', 'lo', 'este', 'esta', 'eso', 'esa', 'con',
  'sin', 'por', 'para', 'que', 'como', 'muy',
]);

/**
 * Palavra "forte" do bloco — INTELIGÊNCIA do destaque automático:
 * stopword nunca ganha; número/dinheiro/percentual ganha bônus pesado
 * ("500", "20 MIL", "97%"); no empate vence a mais longa. Determinístico
 * e sempre editável (clique na lista substitui a escolha).
 */
export function autoEmphasisIndex(block: Block): number | null {
  let best = -1;
  let bestScore = -Infinity;
  let longest = -1;
  let longestLen = 0;
  for (let i = 0; i < block.words.length; i++) {
    const raw = block.words[i].text;
    const t = raw.toLowerCase();
    let score = t.length;
    if (/\d/.test(t)) score += 10;
    if (/[%$€]|^mil$|^milhão$|^milhao$|^milhões$|^k$/.test(t)) score += 6;
    if (STOPWORDS.has(t)) score -= 12;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
    if (t.length > longestLen) {
      longestLen = t.length;
      longest = i;
    }
  }
  // bloco só de stopwords: cai pra mais longa (melhor que nada)
  if (bestScore < 3) return longestLen >= 4 ? longest : null;
  return best >= 0 ? best : null;
}

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
const DEG = Math.PI / 180;

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
  /** fontPx desta palavra (highlightScale/sizeCycle/mix mudam por palavra) */
  fpx: number;
  /** fonte desta palavra (tipografia mista) */
  fk: FontKey;
  /** palavra de APOIO do mix (renderiza limpa, sem stroke/glow/extrude) */
  mixed: boolean;
  chars: CharLayout[];
};
type LineLayout = {
  wordIdx: number[];
  width: number;
  scale: number;
  /** offset do topo do bloco até o topo desta linha */
  y0: number;
  /** altura DESTA linha (maior palavra dela × lineHeight — o lineHeight <1
   *  dos presets empilhados dá o "tuck" de sobreposição leve das refs) */
  h: number;
};
type BlockLayout = {
  words: WordLayout[];
  lines: LineLayout[];
  fontPx: number;
  lineH: number;
  /** altura total do bloco (soma das linhas) */
  totalH: number;
  totalChars: number;
};

const layoutCache = new Map<string, BlockLayout>();

function measureLayout(
  ctx: CanvasRenderingContext2D,
  block: Block,
  preset: TypoPreset,
  style: StyleState,
  W: number,
  highlights: ReadonlySet<number>,
): BlockLayout {
  // caixa estilo CapCut: TT / tt / Tt(original) — null cai no modelo
  const tcase: 'upper' | 'lower' | 'original' =
    style.textCase === 'upper'
      ? 'upper'
      : style.textCase === 'lower'
        ? 'lower'
        : style.textCase === 'original'
          ? 'original'
          : (style.uppercase ?? preset.uppercase ?? false)
            ? 'upper'
            : 'original';
  const hlScale = preset.highlightScale ?? 1;
  const hlKey =
    hlScale !== 1 ||
    preset.sizeCycle ||
    preset.mix ||
    preset.emphasisBreak ||
    preset.stack ||
    preset.highlightFont
      ? Array.from(highlights).sort((a, b) => a - b).join('.')
      : '';
  const key = `${block.id}|${block.words.length}|${blockTextKey(block)}|${preset.id}|${preset.font}|${style.fontScale}|${tcase}|${style.bold ? 1 : 0}${style.italic ? 1 : 0}|${W}|${hlKey}`;
  const hit = layoutCache.get(key);
  if (hit) return hit;
  if (layoutCache.size > 300) layoutCache.clear();

  const fontPx = preset.size * W * style.fontScale;
  const lineH = fontPx * (preset.lineHeight ?? 1.16);
  const maxLineW = W * 0.86;
  const sizeCycle = preset.sizeCycle;

  const words: WordLayout[] = block.words.map((w, wi) => {
    const isHi = highlights.has(wi);
    const mixed = !!(preset.mix && !isHi);
    const fk = isHi
      ? (preset.highlightFont ?? preset.font)
      : mixed
        ? preset.mix!.font
        : preset.font;
    const cyc = sizeCycle ? sizeCycle[wi % sizeCycle.length] : 1;
    const fpx = mixed
      ? fontPx * preset.mix!.scale
      : fontPx * cyc * (isHi ? hlScale : 1);
    const sp = ((mixed ? preset.mix!.spacing ?? preset.spacing : preset.spacing) ?? 0) * fpx;
    ctx.font = fs(fk, fpx);
    const text =
      mixed && preset.mix!.lowercase
        ? w.text.toLowerCase()
        : tcase === 'upper'
          ? w.text.toUpperCase()
          : tcase === 'lower'
            ? w.text.toLowerCase()
            : w.text;
    const chars: CharLayout[] = [];
    let x = 0;
    for (const ch of Array.from(text)) {
      const cw = ctx.measureText(ch).width;
      chars.push({ ch, x, w: cw });
      x += cw + sp;
    }
    const w0 = chars.length > 0 ? x - sp : 0;
    return { text, line: 0, x: 0, w: w0, fpx, fk, mixed, chars };
  });

  ctx.font = fs(preset.font, fontPx);
  const spaceW = ctx.measureText(' ').width + (preset.spacing ?? 0) * fontPx;

  // Wrap greedy + quebras estruturais (stack = pirâmide; emphasisBreak = a
  // palavra forte ganha a PRÓPRIA linha, como nas composições de título)
  const lines: LineLayout[] = [];
  let cur: number[] = [];
  let curW = 0;
  const flushLine = () => {
    if (cur.length > 0) {
      lines.push({ wordIdx: cur, width: curW, scale: 1, y0: 0, h: 0 });
      cur = [];
      curW = 0;
    }
  };
  words.forEach((w, i) => {
    const ownLine =
      preset.stack || (preset.emphasisBreak && highlights.has(i));
    if (ownLine) {
      flushLine();
      w.line = lines.length;
      w.x = 0;
      lines.push({ wordIdx: [i], width: w.w, scale: 1, y0: 0, h: 0 });
      return;
    }
    const tryW = cur.length === 0 ? w.w : curW + spaceW + w.w;
    if (cur.length > 0 && tryW > maxLineW) flushLine();
    w.line = lines.length;
    w.x = cur.length === 0 ? 0 : curW + spaceW;
    curW = cur.length === 0 ? w.w : curW + spaceW + w.w;
    cur.push(i);
  });
  flushLine();

  // lineAccent precisa de 2+ linhas pra última linha colorida EXISTIR —
  // bloco de uma linha só é quebrado perto de 55% dos caracteres
  // (fix do "Linha Rosa não aparece o rosa")
  if (preset.lineAccent === 'last' && lines.length === 1 && words.length >= 2) {
    const totalW = lines[0].width;
    let cut = 1;
    let accW = 0;
    for (let i = 0; i < words.length - 1; i++) {
      accW += words[i].w + spaceW;
      if (accW >= totalW * 0.55) {
        cut = i + 1;
        break;
      }
      cut = i + 1;
    }
    lines.length = 0;
    const rebuild = (idxs: number[]) => {
      let x = 0;
      idxs.forEach((wi, k) => {
        words[wi].line = lines.length;
        words[wi].x = k === 0 ? 0 : x;
        x += (k === 0 ? 0 : 0) + words[wi].w + spaceW;
        if (k === 0) x = words[wi].w + spaceW;
      });
      const width = idxs.reduce((s, wi, k) => s + words[wi].w + (k > 0 ? spaceW : 0), 0);
      lines.push({ wordIdx: idxs, width, scale: 1, y0: 0, h: 0 });
    };
    rebuild(words.map((_, i) => i).slice(0, cut));
    rebuild(words.map((_, i) => i).slice(cut));
    for (const line of lines) {
      if (line.width > maxLineW) line.scale = maxLineW / line.width;
    }
  }

  // Linha com uma palavra gigante: encolhe só aquela linha
  for (const line of lines) {
    if (line.width > maxLineW) line.scale = maxLineW / line.width;
  }

  // Altura POR LINHA: maior palavra da linha × lineHeight. Palavra gigante
  // empurra a própria linha (sem engolir a de cima); presets empilhados com
  // lineHeight ~0.92-1.0 mantêm o "tuck" de sobreposição leve das refs.
  const lhFactor = preset.lineHeight ?? 1.16;
  let accY = 0;
  for (const line of lines) {
    const maxF = Math.max(...line.wordIdx.map((i) => words[i].fpx * line.scale));
    line.h = maxF * lhFactor;
    line.y0 = accY;
    accY += line.h;
  }

  const totalChars = words.reduce((s, w) => s + w.chars.length, 0);
  const layout: BlockLayout = { words, lines, fontPx, lineH, totalH: accY, totalChars };
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

function contrastColor(color: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return '#0a0a0a';
  const v = parseInt(m[1], 16);
  const r = (v >> 16) & 255;
  const g = (v >> 8) & 255;
  const b = v & 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 150 ? '#0a0a0a' : '#ffffff';
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
  if (!loop || loop.kind === 'none' || loop.kind === 'glitch') return out;
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

// ─── Draw context ───────────────────────────────────────────────────────────

type DrawCtx = {
  ctx: CanvasRenderingContext2D;
  preset: TypoPreset;
  primary: string;
  accent: string;
  fontPx: number;
  glowPx: number;
  tMs: number;
  seedBase: number;
  /** multiplicadores dos FX ajustáveis do editor (1 = padrão do modelo) */
  fx: { stroke: number; shadow: number; glow: number; smoke: number };
  underline: boolean;
};

function clearShadow(ctx: CanvasRenderingContext2D) {
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}

function applyTextStyle(
  d: DrawCtx,
  fill: Paint,
  fpx: number,
  fk: FontKey = d.preset.font,
  noGlow = false,
) {
  const { ctx, preset } = d;
  ctx.font = fs(fk, fpx);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = fill;
  if (preset.shadow && d.fx.shadow > 0) {
    ctx.shadowColor = preset.shadow.color;
    ctx.shadowBlur = preset.shadow.blur * fpx * d.fx.shadow;
    ctx.shadowOffsetX = preset.shadow.x * fpx * d.fx.shadow;
    ctx.shadowOffsetY = preset.shadow.y * fpx * d.fx.shadow;
  } else if (preset.glow && !noGlow && d.fx.glow > 0) {
    // palavra menor (apoio/mix) recebe glow proporcionalmente mais suave —
    // sem isso o brilho da grande "engole" o texto pequeno do lado
    const glowScale = Math.min(1, Math.max(0.45, fpx / d.fontPx));
    ctx.shadowColor = resolveColor(preset.glow.color, d.primary, d.accent);
    ctx.shadowBlur = (preset.glow.blur ?? 0) * fpx * glowScale * d.fx.glow;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  } else {
    clearShadow(ctx);
  }
}

/**
 * Desenha um texto com a pilha completa de FX do preset:
 * extrude 3D → sombra dura → fantasmas RGB (chroma) → stroke → glow → fill.
 */
function fillWordText(
  d: DrawCtx,
  text: string,
  x: number,
  y: number,
  fill: Paint,
  fpx = d.fontPx,
  fk: FontKey = d.preset.font,
  // palavra de apoio do mix: só sombra, sem stroke/glow/extrude/aura/chroma/shine
  plain = false,
) {
  const { ctx, preset } = d;
  ctx.font = fs(fk, fpx);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  const hasStroke = !!preset.stroke && d.fx.stroke > 0;
  const strokeSetup = () => {
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.lineWidth = (preset.stroke?.width ?? 0) * fpx * d.fx.stroke;
  };

  if (plain) {
    // sombra dura entra mesmo no plain (legibilidade sobre o vídeo)
    if (preset.hardShadow && d.fx.shadow > 0) {
      clearShadow(ctx);
      ctx.fillStyle = resolveColor(preset.hardShadow.color, d.primary, d.accent);
      ctx.fillText(
        text,
        x + preset.hardShadow.x * fpx * d.fx.shadow,
        y + preset.hardShadow.y * fpx * d.fx.shadow,
      );
    }
    applyTextStyle(d, fill, fpx, fk, true);
    ctx.fillText(text, x, y);
    if (FAUX_BOLD) {
      clearShadow(ctx);
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(1, fpx * 0.035);
      ctx.strokeStyle = fill;
      ctx.strokeText(text, x, y);
    }
    return;
  }

  // aura de neon (anéis de contorno atrás de tudo)
  if (preset.aura) {
    clearShadow(ctx);
    const col = resolveColor(preset.aura.color, d.primary, d.accent);
    const pulse = preset.aura.pulse
      ? 1 + 0.22 * Math.sin((2 * Math.PI * d.tMs) / 1400)
      : 1;
    const baseAlpha = ctx.globalAlpha;
    ctx.strokeStyle = col;
    ctx.lineJoin = 'round';
    for (let k = preset.aura.count; k >= 1; k--) {
      ctx.lineWidth = preset.aura.width * fpx * (k / preset.aura.count) * pulse;
      ctx.globalAlpha = baseAlpha * preset.aura.alpha * (1 - (k - 1) / (preset.aura.count + 1));
      ctx.strokeText(text, x, y);
    }
    ctx.globalAlpha = baseAlpha;
  }

  // extrude 3D (pilha de cópias — a mais funda primeiro; fade esvanece a cauda)
  if (preset.extrude) {
    clearShadow(ctx);
    const col = resolveColor(preset.extrude.color, d.primary, d.accent);
    const baseAlpha = ctx.globalAlpha;
    ctx.fillStyle = col;
    if (hasStroke) {
      strokeSetup();
      ctx.strokeStyle = col;
    }
    for (let i = preset.extrude.steps; i >= 1; i--) {
      const ox = (preset.extrude.x * fpx * i) / preset.extrude.steps;
      const oy = (preset.extrude.y * fpx * i) / preset.extrude.steps;
      if (preset.extrude.fade) {
        ctx.globalAlpha = baseAlpha * (1 - (i / (preset.extrude.steps + 1)) * 0.8);
      }
      if (hasStroke) ctx.strokeText(text, x + ox, y + oy);
      ctx.fillText(text, x + ox, y + oy);
    }
    ctx.globalAlpha = baseAlpha;
  }

  // sombra dura (silhueta sólida deslocada, inclui o contorno)
  if (preset.hardShadow && d.fx.shadow > 0) {
    clearShadow(ctx);
    const col = resolveColor(preset.hardShadow.color, d.primary, d.accent);
    const ox = preset.hardShadow.x * fpx * d.fx.shadow;
    const oy = preset.hardShadow.y * fpx * d.fx.shadow;
    ctx.fillStyle = col;
    if (hasStroke) {
      strokeSetup();
      ctx.strokeStyle = col;
      ctx.strokeText(text, x + ox, y + oy);
    }
    ctx.fillText(text, x + ox, y + oy);
  }

  // aberração cromática (fantasma red/cyan logo abaixo do fill principal)
  if (preset.chroma) {
    clearShadow(ctx);
    let dch = preset.chroma.amp * fpx;
    if (preset.chroma.flicker) {
      const st = Math.floor(d.tMs / 70);
      const rr = prand(d.seedBase + st * 37);
      dch *= rr < 0.16 ? 2.6 : 0.7 + rr * 0.5;
    }
    const prevAlpha = ctx.globalAlpha;
    ctx.globalAlpha = prevAlpha * 0.85;
    const [cA, cB] = preset.chroma.colors ?? ['#ff1f4b', '#00e5ff'];
    ctx.fillStyle = cA;
    ctx.fillText(text, x - dch, y);
    ctx.fillStyle = cB;
    ctx.fillText(text, x + dch, y);
    ctx.globalAlpha = prevAlpha;
  }

  // camada principal
  applyTextStyle(d, fill, fpx, fk);
  if (hasStroke) {
    strokeSetup();
    ctx.strokeStyle = resolveColor(preset.stroke!.color, d.primary, d.accent);
    ctx.strokeText(text, x, y);
  }
  if (preset.glow && d.fx.glow > 0 && fpx >= d.fontPx * 0.7) {
    // passada dupla engrossa o glow (canvas soma shadows por draw) —
    // SÓ na palavra grande; na pequena o glow duplo apaga a letra
    ctx.fillText(text, x, y);
  }
  ctx.fillText(text, x, y);

  // negrito sintético: stroke fino da própria cor engrossa os glifos
  if (FAUX_BOLD) {
    clearShadow(ctx);
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(1, fpx * 0.035);
    ctx.strokeStyle = fill;
    ctx.strokeText(text, x, y);
  }

  // shine sweep: banda de brilho diagonal varrendo os glifos em loop
  if (preset.shine) {
    clearShadow(ctx);
    const ph = (d.tMs % preset.shine.period) / preset.shine.period;
    const w = ctx.measureText(text).width;
    const bw = Math.max(w * 0.4, fpx * 0.45);
    const start = x - bw + (w + 2 * bw) * ph;
    const g = ctx.createLinearGradient(start, y - fpx * 0.9, start + bw, y + fpx * 0.22);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, `rgba(255,255,255,${preset.shine.alpha})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillText(text, x, y);
  }
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

/** Caixa com skew + sombra sólida opcional, centrada em (cx, cy). */
function drawFxBox(
  d: DrawCtx,
  cx: number,
  cy: number,
  w: number,
  h: number,
  radius: number,
  fill: Paint,
  skewDeg: number,
  boxShadow: { color: PresetColor; x: number; y: number } | undefined,
  scale: number,
  border?: { color: PresetColor; width: number },
  gradientStops?: Array<[number, PresetColor]>,
) {
  const { ctx } = d;
  ctx.save();
  clearShadow(ctx);
  ctx.translate(cx, cy);
  if (skewDeg) ctx.transform(1, 0, Math.tan(-skewDeg * DEG), 1, 0, 0);
  ctx.scale(scale, scale);
  if (boxShadow) {
    ctx.fillStyle = resolveColor(boxShadow.color, d.primary, d.accent);
    roundRect(
      ctx,
      -w / 2 + boxShadow.x * d.fontPx,
      -h / 2 + boxShadow.y * d.fontPx,
      w,
      h,
      radius,
    );
    ctx.fill();
  }
  if (gradientStops) {
    const g = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
    for (const [o, c] of gradientStops) g.addColorStop(o, resolveColor(c, d.primary, d.accent));
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = fill;
  }
  roundRect(ctx, -w / 2, -h / 2, w, h, radius);
  ctx.fill();
  if (border) {
    ctx.strokeStyle = resolveColor(border.color, d.primary, d.accent);
    ctx.lineWidth = Math.max(1, border.width * d.fontPx);
    roundRect(ctx, -w / 2, -h / 2, w, h, radius);
    ctx.stroke();
  }
  ctx.restore();
}

// ─── Glitch de fatias (offscreen) ───────────────────────────────────────────

let fxCanvas: HTMLCanvasElement | null = null;

function getFxCtx(W: number, H: number): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;
  if (!fxCanvas) fxCanvas = document.createElement('canvas');
  if (fxCanvas.width !== W || fxCanvas.height !== H) {
    fxCanvas.width = W;
    fxCanvas.height = H;
  }
  const c = fxCanvas.getContext('2d');
  if (c) c.clearRect(0, 0, W, H);
  return c;
}

/**
 * Composita o offscreen no destino em FAIXAS horizontais — as faixas de
 * glitch saem deslocadas. Determinístico (passo de tempo + seed do bloco).
 * `strength` > 0 força o burst (fase de entrada); fora dela o burst é
 * intermitente (~20% dos passos).
 */
function compositeGlitchBands(
  dst: CanvasRenderingContext2D,
  src: HTMLCanvasElement,
  W: number,
  H: number,
  tMs: number,
  seed: number,
  top: number,
  height: number,
  fontPx: number,
  strength: number,
) {
  const step = Math.floor(tMs / 80);
  const inBurst = strength > 0.02 || prand(seed + step * 101) < 0.2;
  if (!inBurst) {
    dst.drawImage(src, 0, 0);
    return;
  }
  const power = strength > 0.02 ? strength : 0.45;
  const n = 2 + Math.floor(prand(seed + step * 7) * 3);
  const bands: Array<{ y: number; h: number; dx: number }> = [];
  for (let j = 0; j < n; j++) {
    const y = top + prand(seed + step * 13 + j * 17) * height;
    const h = fontPx * (0.1 + prand(seed + step * 19 + j * 23) * 0.32);
    const dx = (prand(seed + step * 29 + j * 31) - 0.5) * 2 * fontPx * (0.35 + power * 1.1);
    bands.push({ y: Math.max(0, Math.min(H - 2, y)), h: Math.min(h, H), dx });
  }
  bands.sort((a, b) => a.y - b.y);
  // remove sobreposição pra varredura em faixas ficar simples
  for (let j = 1; j < bands.length; j++) {
    const prevEnd = bands[j - 1].y + bands[j - 1].h;
    if (bands[j].y < prevEnd) bands[j].y = prevEnd;
  }

  // fantasma inteiro deslocado (só na entrada forte)
  if (strength > 0.1) {
    dst.save();
    dst.globalAlpha = 0.22;
    dst.drawImage(src, fontPx * 0.16 * (prand(seed + step * 41) > 0.5 ? 1 : -1), 0);
    dst.restore();
  }

  let cursor = 0;
  for (const b of bands) {
    if (b.y >= H) break;
    if (b.y > cursor) dst.drawImage(src, 0, cursor, W, b.y - cursor, 0, cursor, W, b.y - cursor);
    const bh = Math.min(b.h, H - b.y);
    if (bh > 0) dst.drawImage(src, 0, b.y, W, bh, b.dx, b.y, W, bh);
    cursor = b.y + bh;
  }
  if (cursor < H) dst.drawImage(src, 0, cursor, W, H - cursor, 0, cursor, W, H - cursor);
}

// ─── Draw principal ─────────────────────────────────────────────────────────

/**
 * Desenha as legendas do tempo `tMs` sobre o canvas (W×H = pixels do canvas).
 * O canvas deve chegar limpo (ou com o frame do vídeo já desenhado).
 */
export function drawCaptions(
  realCtx: CanvasRenderingContext2D,
  blocks: Block[],
  basePreset: TypoPreset,
  styleIn: StyleState,
  tMs: number,
  W: number,
  H: number,
): void {
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

  // estilo EFETIVO: "aplicar a todas" desligado grava overrides por bloco
  const ov = styleIn.perBlock?.[block.id];
  const style: StyleState = ov ? { ...styleIn, ...ov } : styleIn;
  FAUX_ITALIC = style.italic === true;
  FAUX_BOLD = style.bold === true;

  // troca de fonte pelo editor: só a fonte PRINCIPAL muda; o apoio do mix
  // mantém a dele (a composição é parte do modelo)
  const preset =
    style.fontOverride && style.fontOverride !== basePreset.font
      ? { ...basePreset, font: style.fontOverride }
      : basePreset;

  const primary = style.primary ?? preset.defaultPrimary;
  const accent = style.accent ?? preset.defaultAccent;
  // destaque manual do user vence; sem ele, o preset com autoEmphasis escolhe
  // a palavra forte do bloco sozinho (variação de cor/tamanho automática)
  let hiList = style.highlights[block.id] ?? [];
  if (
    hiList.length === 0 &&
    preset.autoEmphasis &&
    style.autoEmphasis !== false
  ) {
    const auto = autoEmphasisIndex(block);
    if (auto !== null) hiList = [auto];
  }
  const highlights = new Set(hiList);
  const layout = measureLayout(realCtx, block, preset, style, W, highlights);
  const { fontPx, lineH } = layout;
  const seedBase = hashStr(block.id);

  // Progresso do bloco (pra caixas, barras, rotação e saída)
  const pBlock = preset.in.dur <= 0 ? 1 : clamp01((tMs - block.start) / preset.in.dur);
  const eBlock = EASE[preset.in.ease ?? 'outCubic'](Math.min(1, pBlock));

  // glitch de fatias: desenha o lettering num offscreen e composita em faixas
  // (NUNCA fatia o vídeo por baixo — preview e export idênticos)
  const bandsStrength =
    preset.glitchBands && pBlock < 1 ? (1 - eBlock) : 0;
  const bandsActive =
    !!preset.glitchBands && (pBlock < 1 || preset.loop?.kind === 'glitch');
  const fxCtx = bandsActive ? getFxCtx(W, H) : null;
  const ctx = fxCtx ?? realCtx;

  const d: DrawCtx = {
    ctx,
    preset,
    primary,
    accent,
    fontPx,
    glowPx: (preset.glow?.blur ?? 0) * fontPx,
    tMs,
    seedBase,
    fx: {
      stroke: style.fxStroke ?? 1,
      shadow: style.fxShadow ?? 1,
      glow: style.fxGlow ?? 1,
      smoke: style.fxSmoke ?? 1,
    },
    underline: style.underline === true,
  };

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
  const blockH = isSolo ? lineH : layout.totalH;
  let topY = style.posY * H - blockH / 2;
  topY = Math.min(Math.max(topY, H * 0.04), H * 0.96 - blockH);
  // posição horizontal arrastável (clamp mantém o bloco dentro do frame)
  const blockWmax = Math.max(...layout.lines.map((l) => l.width * l.scale));
  let cx = (style.posX ?? 0.5) * W;
  const halfW = blockWmax / 2 + W * 0.02;
  cx = halfW * 2 >= W ? W / 2 : Math.min(Math.max(cx, halfW), W - halfW);

  // Palavra ativa (karaokê)
  let activeIdx = 0;
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

  // Rotação da composição (fixa + jitter carimbado por bloco/palavra-solo)
  const rotSeed = isSolo ? seedBase + activeIdx * 13 : seedBase;
  const rotDeg =
    (preset.blockRotate ?? 0) +
    (preset.blockRotateJitter
      ? (prand(rotSeed * 7 + 3) - 0.5) * 2 * preset.blockRotateJitter
      : 0);
  if (rotDeg !== 0) {
    const cyc = topY + blockH / 2;
    ctx.translate(cx, cyc);
    ctx.rotate(rotDeg * DEG);
    ctx.translate(-cx, -cyc);
  }

  const loopSpec = preset.loop;

  // Helpers de geometria
  const lineOriginX = (li: number) => {
    const line = layout.lines[li];
    if (preset.align === 'left') return cx - blockWmax / 2;
    return cx - (line.width * line.scale) / 2;
  };
  const lineBaseY = (li: number) => {
    const line = layout.lines[li];
    return topY + line.y0 + line.h * 0.78;
  };
  const wordAbsX = (wi: number) => {
    const w = layout.words[wi];
    const line = layout.lines[w.line];
    return lineOriginX(w.line) + w.x * line.scale;
  };

  // Cópias da própria frase (pequena branca em cima, fantasma vazado atrás,
  // riscada embaixo...) — 'above'/'below' empilham na ordem do array.
  const drawEchoes = (phase: 'behind' | 'front') => {
    if (!preset.echoes || isSolo) return;
    let aboveOff = 0;
    let belowOff = 0;
    for (const ec of preset.echoes) {
      const s = ec.scale;
      const scaledH = blockH * s;
      const gap = (ec.gap ?? 0.3) * fontPx;
      let y: number;
      if (ec.pos === 'above') {
        aboveOff += scaledH + gap;
        y = topY - aboveOff;
      } else if (ec.pos === 'below') {
        y = topY + blockH + belowOff + gap;
        belowOff += scaledH + gap;
      } else {
        y = topY + blockH / 2 - scaledH / 2;
      }
      if ((phase === 'behind') !== (ec.pos === 'behind')) continue;
      const col = resolveColor(ec.color, primary, accent);
      ctx.save();
      ctx.globalAlpha = outAlpha * clamp01(pBlock * 2) * (ec.alpha ?? 1);
      ctx.translate(cx + (ec.dx ?? 0) * fontPx, y);
      ctx.scale(s, s);
      ctx.translate(-cx, -topY);
      if (ec.glow) {
        ctx.shadowColor = col;
        ctx.shadowBlur = ec.glow * fontPx;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
      } else {
        clearShadow(ctx);
      }
      layout.lines.forEach((line, li) => {
        const x0 = lineOriginX(li);
        const by = lineBaseY(li);
        ctx.save();
        if (line.scale !== 1) {
          ctx.translate(cx, by);
          ctx.scale(line.scale, line.scale);
          ctx.translate(-cx, -by);
        }
        for (const wi of line.wordIdx) {
          const wl = layout.words[wi];
          ctx.font = fs(wl.fk, wl.fpx);
          if (ec.outline) {
            ctx.strokeStyle = col;
            ctx.lineWidth = Math.max(1.5, fontPx * 0.035);
            ctx.lineJoin = 'round';
            ctx.strokeText(wl.text, x0 + wl.x, by);
          } else {
            ctx.fillStyle = col;
            ctx.fillText(wl.text, x0 + wl.x, by);
            if (ec.glow) ctx.fillText(wl.text, x0 + wl.x, by);
          }
        }
        if (ec.strike) {
          ctx.fillStyle = col;
          const lw = line.width * line.scale;
          ctx.fillRect(
            x0 - fontPx * 0.1,
            by - line.h * 0.28,
            lw + fontPx * 0.2,
            Math.max(2, fontPx * 0.06),
          );
        }
        ctx.restore();
      });
      ctx.restore();
    }
  };

  // ── modo SOLO (uma palavra por vez, estilo viral) ──
  if (isSolo) {
    const w = block.words[activeIdx];
    const wl = layout.words[activeIdx];
    const text = wl.text;
    ctx.font = fs(preset.font, wl.fpx);
    const ww = wl.w;
    const fitScale = Math.min(1, (W * 0.82) / Math.max(ww, 1));
    const fx = computeInFx(preset.in, 0, tMs, w.start, fontPx, seedBase + activeIdx * 977);
    const loop = computeLoopFx(loopSpec, 0, tMs, fx.p, fontPx, seedBase);
    const isHi = highlights.has(activeIdx);

    ctx.save();
    ctx.globalAlpha = outAlpha * fx.alpha * loop.alphaMul;
    ctx.translate(cx + fx.dx + loop.dx, topY + lineH * 0.48 + fx.dy + loop.dy);
    ctx.scale(fx.sx * loop.s * fitScale, fx.sy * loop.s * fitScale);
    if (fx.rot || loop.rot) ctx.rotate(fx.rot + loop.rot);
    if (fx.skew) ctx.transform(1, 0, Math.tan(fx.skew), 1, 0, 0);
    if (fx.blur > 0.4) ctx.filter = `blur(${fx.blur.toFixed(1)}px)`;
    let soloBoxFill: string | null = null;
    if (preset.box && preset.box.mode !== 'none') {
      const padX = preset.box.padX * fontPx;
      const padY = preset.box.padY * fontPx;
      // destaque manual troca a COR DA CAIXA (o texto segue o contraste)
      soloBoxFill = resolveColor(
        isHi ? (preset.highlightColor ?? preset.box.fill) : preset.box.fill,
        primary,
        accent,
      );
      drawFxBox(
        d,
        0,
        0,
        ww + padX * 2,
        lineH * 0.96 + padY * 2,
        preset.box.radius * fontPx,
        soloBoxFill,
        preset.box.skew ?? 0,
        preset.box.shadow,
        1,
        preset.box.border,
        preset.box.gradient,
      );
    }
    const fill =
      soloBoxFill && preset.box?.autoText
        ? contrastColor(soloBoxFill)
        : isHi
          ? resolveColor(preset.highlightColor ?? 'accent', primary, accent)
          : resolveFill(d, lineH);
    fillWordText(d, text, -ww / 2, lineH * 0.3, fill, wl.fpx, wl.fk, wl.mixed);
    ctx.restore();
    finishDraw();
    return;
  }

  // ── MÁSCARA (knockout): painel escurecido com o texto vazado — o vídeo
  // aparece ATRAVÉS das letras. Caminho próprio (substitui o render normal).
  if (preset.knockout && !isSolo && !fxCtx) {
    const ko = preset.knockout;
    const fx2 = getFxCtx(W, H);
    if (fx2 && fxCanvas) {
      const padX = ko.pad * fontPx;
      const padY = ko.pad * fontPx * 0.8;
      let minX = Infinity;
      let maxX = -Infinity;
      layout.lines.forEach((line, li) => {
        const x0 = lineOriginX(li);
        minX = Math.min(minX, x0);
        maxX = Math.max(maxX, x0 + line.width * line.scale);
      });
      fx2.save();
      fx2.fillStyle = `rgba(0,0,0,${ko.dim})`;
      roundRect(
        fx2,
        minX - padX,
        topY - padY,
        maxX - minX + padX * 2,
        blockH + padY * 2,
        fontPx * 0.25,
      );
      fx2.fill();
      // vaza as letras (o vídeo aparece por elas)
      fx2.globalCompositeOperation = 'destination-out';
      fx2.textBaseline = 'alphabetic';
      fx2.textAlign = 'left';
      layout.lines.forEach((line, li) => {
        const x0 = lineOriginX(li);
        const by = lineBaseY(li);
        for (const wi of line.wordIdx) {
          const wl = layout.words[wi];
          fx2.font = fs(wl.fk, wl.fpx);
          fx2.fillStyle = '#ffffff';
          fx2.fillText(wl.text, x0 + wl.x, by);
        }
      });
      fx2.globalCompositeOperation = 'source-over';
      // contorno fino define as letras sobre vídeo claro
      fx2.strokeStyle = `rgba(255,255,255,0.55)`;
      fx2.lineWidth = Math.max(1, fontPx * 0.018);
      fx2.lineJoin = 'round';
      layout.lines.forEach((line, li) => {
        const x0 = lineOriginX(li);
        const by = lineBaseY(li);
        for (const wi of line.wordIdx) {
          const wl = layout.words[wi];
          fx2.font = fs(wl.fk, wl.fpx);
          fx2.strokeText(wl.text, x0 + wl.x, by);
        }
      });
      fx2.restore();

      ctx.save();
      ctx.globalAlpha = outAlpha * clamp01(pBlock * 2.2);
      const s2 = 0.94 + 0.06 * Math.min(eBlock, 1);
      ctx.translate(cx, topY + blockH / 2);
      ctx.scale(s2, s2);
      ctx.translate(-cx, -(topY + blockH / 2));
      ctx.drawImage(fxCanvas, 0, 0);
      ctx.restore();
    }
    finishDraw();
    return;
  }

  // ── fumaça procedural (atrás de tudo) ──
  if (preset.smoke) {
    const gate = outAlpha * clamp01(pBlock * 2);
    const alpha = preset.smoke.alpha * gate * (style.fxSmoke ?? 1);
    if (alpha > 0.01) {
      ctx.save();
      clearShadow(ctx);
      for (let i = 0; i < 7; i++) {
        const rx = fontPx * (1.3 + prand(seedBase + i * 31) * 1.6);
        const bx =
          cx +
          (prand(seedBase + i * 17) - 0.5) * W * 0.55 +
          Math.sin((tMs / 1000) * 0.35 + i * 1.9) * fontPx * 0.9;
        const by =
          topY +
          blockH * (0.1 + prand(seedBase + i * 23) * 0.95) +
          Math.sin((tMs / 1000) * 0.22 + i * 2.6) * fontPx * 0.5;
        const g = ctx.createRadialGradient(bx, by, 0, bx, by, rx);
        const a = alpha * (0.5 + 0.5 * prand(seedBase + i * 41));
        g.addColorStop(0, `rgba(255,255,255,${(a * 0.85).toFixed(3)})`);
        g.addColorStop(0.55, `rgba(205,205,215,${(a * 0.4).toFixed(3)})`);
        g.addColorStop(1, 'rgba(180,180,190,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(bx, by, rx, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // ── post-it (retângulo sólido rotacionado atrás do texto) ──
  if (preset.sticky) {
    const wMax = Math.max(...layout.lines.map((l) => l.width * l.scale));
    ctx.save();
    ctx.globalAlpha = outAlpha * clamp01(pBlock * 2.5);
    clearShadow(ctx);
    ctx.translate(cx + wMax * 0.12, topY + blockH * 0.92);
    ctx.rotate(preset.sticky.rotate * DEG);
    const es = 0.85 + 0.15 * Math.min(eBlock, 1.1);
    ctx.scale(es, es);
    const sw = wMax * 0.85;
    const sh = blockH * 0.9 + fontPx * 0.9;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(-sw / 2 + fontPx * 0.06, -sh / 2 + fontPx * 0.08, sw, sh);
    ctx.fillStyle = preset.sticky.color;
    ctx.fillRect(-sw / 2, -sh / 2, sw, sh);
    ctx.restore();
  }

  // ── caixas de fundo (block/line) ──
  const blockBox = preset.box;
  if (blockBox && (blockBox.mode === 'block' || blockBox.mode === 'line')) {
    const padX = blockBox.padX * fontPx;
    const padY = blockBox.padY * fontPx;
    ctx.save();
    ctx.globalAlpha = outAlpha * clamp01(pBlock * 2.5);
    const s = 0.85 + 0.15 * Math.min(eBlock, 1.12);
    const boxFill = resolveColor(blockBox.fill, primary, accent);
    if (blockBox.mode === 'block') {
      let minX = Infinity;
      let maxX = -Infinity;
      layout.lines.forEach((line, li) => {
        const x0 = lineOriginX(li);
        minX = Math.min(minX, x0);
        maxX = Math.max(maxX, x0 + line.width * line.scale);
      });
      drawFxBox(
        d,
        (minX + maxX) / 2,
        topY + blockH / 2,
        maxX - minX + padX * 2,
        blockH + padY * 2,
        blockBox.radius * fontPx,
        boxFill,
        blockBox.skew ?? 0,
        blockBox.shadow,
        s,
        blockBox.border,
        blockBox.gradient,
      );
    } else {
      layout.lines.forEach((line, li) => {
        if (blockBox.firstLineOnly && li > 0) return;
        if (blockBox.emphasisLineOnly && !line.wordIdx.some((wi) => highlights.has(wi))) return;
        const bw = blockBox.fullBleed ? W + 8 : line.width * line.scale + padX * 2;
        const bh = line.h * 0.92 + padY * 2;
        drawFxBox(
          d,
          blockBox.fullBleed ? W / 2 : cx,
          topY + line.y0 + line.h * 0.52,
          bw,
          bh,
          blockBox.radius * fontPx,
          boxFill,
          blockBox.skew ?? 0,
          blockBox.shadow,
          s,
          blockBox.border,
          blockBox.gradient,
        );
      });
    }
    ctx.restore();
  }

  // ── barra de pôster sob cada linha ──
  if (preset.bar) {
    const barW = clamp01(eBlock * 1.15);
    ctx.save();
    ctx.globalAlpha = outAlpha * clamp01(pBlock * 3);
    clearShadow(ctx);
    ctx.fillStyle = resolveColor(preset.bar.color, primary, accent);
    layout.lines.forEach((line, li) => {
      const lw = line.width * line.scale * barW;
      const th = preset.bar!.thickness * fontPx;
      const y = lineBaseY(li) + fontPx * 0.14;
      ctx.save();
      ctx.translate(cx, y + th / 2);
      if (preset.bar!.skew) ctx.transform(1, 0, Math.tan(-preset.bar!.skew * DEG), 1, 0, 0);
      ctx.fillRect(-lw / 2, -th / 2, lw, th);
      ctx.restore();
    });
    ctx.restore();
  }

  // ── barra vertical à esquerda (ref "| HIGHLIGHT KEY PHRASES") ──
  if (preset.sideBar) {
    ctx.save();
    ctx.globalAlpha = outAlpha * clamp01(pBlock * 2.5);
    clearShadow(ctx);
    ctx.fillStyle = resolveColor(preset.sideBar.color, primary, accent);
    const sbw = Math.max(2, preset.sideBar.width * fontPx);
    const sbh = blockH * clamp01(eBlock * 1.1);
    ctx.fillRect(cx - blockWmax / 2 - fontPx * 0.45 - sbw, topY + (blockH - sbh) / 2, sbw, sbh);
    ctx.restore();
  }

  // ── linhas de moldura acima/abaixo (ref "poucos minutos") ──
  if (preset.frameLines) {
    const fl = preset.frameLines;
    const wMax = Math.max(...layout.lines.map((l) => l.width * l.scale));
    const lw = wMax * 1.06 * clamp01(eBlock * 1.1);
    const th = Math.max(1, fl.thickness * fontPx);
    const gap = fl.gap * fontPx;
    ctx.save();
    ctx.globalAlpha = outAlpha * clamp01(pBlock * 2.5);
    clearShadow(ctx);
    ctx.fillStyle = resolveColor(fl.color, primary, accent);
    ctx.fillRect(cx - lw / 2, topY - gap - th, lw, th);
    ctx.fillRect(cx - lw / 2, topY + blockH + gap, lw, th);
    ctx.restore();
  }

  // ── risco/swoosh desenhando atrás do texto (ref "na sua edição") ──
  if (preset.swoosh) {
    const wMax = Math.max(...layout.lines.map((l) => l.width * l.scale));
    const y0 = topY + blockH * 0.88;
    const pts: Array<[number, number]> = [];
    const N = 64;
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const x = cx - wMax * 0.62 + wMax * 1.3 * u;
      const y =
        y0 +
        Math.sin(u * Math.PI) * fontPx * 0.55 -
        u * u * fontPx * 1.15 +
        Math.sin(u * Math.PI * 2.2 + 1.1) * fontPx * 0.18;
      pts.push([x, y]);
    }
    const vis = Math.max(2, Math.floor(clamp01(eBlock * 1.15) * pts.length));
    ctx.save();
    ctx.globalAlpha = outAlpha;
    clearShadow(ctx);
    ctx.strokeStyle = resolveColor(preset.swoosh.color, primary, accent);
    ctx.lineWidth = Math.max(2, preset.swoosh.width * fontPx);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i < vis; i++) {
      const [x, y] = pts[i];
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  // ── círculo/elipse desenhando ao redor do texto (ref "circulado") ──
  if (preset.circle) {
    const wMax = Math.max(...layout.lines.map((l) => l.width * l.scale));
    const rx = wMax * 0.62 + fontPx * 0.5;
    const ry = blockH * 0.72 + fontPx * 0.55;
    const e2 = clamp01(eBlock * 1.1);
    ctx.save();
    ctx.globalAlpha = outAlpha * clamp01(pBlock * 2);
    clearShadow(ctx);
    ctx.strokeStyle = resolveColor(preset.circle.color, primary, accent);
    ctx.lineWidth = Math.max(2, preset.circle.width * fontPx);
    ctx.lineCap = 'round';
    ctx.translate(cx, topY + blockH / 2);
    ctx.rotate(-4 * DEG);
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, -0.6 * Math.PI, -0.6 * Math.PI + e2 * 2.35 * Math.PI);
    ctx.stroke();
    ctx.restore();
  }

  // ── ecos ATRÁS do texto (fantasma vazado gigante) ──
  drawEchoes('behind');

  // ── typewriter (caminho próprio) ──
  if (preset.in.kind === 'typewriter') {
    drawTypewriter(d, block, layout, tMs, cx, topY, highlights, outAlpha);
    drawEchoes('front');
    finishDraw();
    return;
  }

  const isMask = preset.in.kind === 'mask-up';
  const isWipe = preset.in.kind === 'wipe';
  const isFill = karaoke === 'fill';

  // caixa de LINHA/BLOCO com autoText: o texto contrasta com a caixa
  // (fix "branco sobre branco" nos lower-thirds)
  const lineBoxText =
    blockBox && blockBox.mode !== 'word' && blockBox.autoText
      ? contrastColor(resolveColor(blockBox.fill, primary, accent))
      : null;

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
          ctx.rect(
            x0 - fontPx,
            topY + line.y0 - line.h * 0.14,
            line.width + fontPx * 2,
            line.h * 1.24,
          );
        } else {
          ctx.rect(
            x0 - fontPx * 0.2,
            topY + line.y0 - line.h * 0.3,
            (line.width + fontPx * 0.4) * le,
            line.h * 1.5,
          );
        }
        ctx.clip();
        if (isMask) {
          const dyLine = (1 - le) * line.h;
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

        const fx =
          preset.unit === 'char'
            ? null
            : computeInFx(
                preset.in,
                preset.unit === 'word' ? wi : 0,
                tMs,
                block.start,
                fontPx,
                seedBase + wi * 977,
              );

        // cor da palavra nesta passada
        let fill: Paint;
        if (preset.mix) {
          // tipografia mista: a destacada mantém o look principal do preset
          // (gradiente/accent — ou o gradiente PRÓPRIO do destaque); as de
          // apoio usam a cor do mix
          if (isHi) {
            fill = preset.highlightGradient
              ? resolveHighlightFill(d, lineH)
              : resolveFill(d, lineH);
          } else {
            fill = resolveColor(preset.mix.color ?? 'primary', primary, accent);
            if (preset.mix.accentLast && wi === block.words.length - 1) fill = accent;
          }
        } else {
          fill = preset.colorCycle
            ? resolveColor(preset.colorCycle[wi % preset.colorCycle.length], primary, accent)
            : resolveFill(d, lineH);
          if (
            preset.lineAccent === 'last' &&
            layout.lines.length > 1 &&
            wl.line === layout.lines.length - 1
          ) {
            fill = accent;
          }
          if (isHi) fill = resolveHighlightFill(d, lineH);
        }
        if (lineBoxText) {
          fill =
            isHi && (preset.highlightColor || preset.highlightGradient)
              ? fill
              : lineBoxText;
        }
        if (karaoke === 'word-color' && isActive) fill = accent;
        if (isFill) fill = pass === 'base' ? fill : accent;

        // karaokê zoom/box na palavra ativa
        let extraS = 1;
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
          drawFxBox(
            d,
            wx + wl.w / 2,
            baseY - lineH * 0.3,
            wl.w + padX * 2,
            lineH * 0.82 + padY * 2,
            fontPx * 0.18,
            accent,
            preset.box?.skew ?? 0,
            preset.box?.shadow,
            0.7 + 0.3 * we,
          );
          ctx.restore();
          fill = contrastColor(accent);
        }
        if (karaoke === 'word-box' && isActive && pass !== 'base') fill = contrastColor(accent);

        // caixa por palavra (preset.box mode word) — com ciclo de cores
        if (pass === 'base' && preset.box && preset.box.mode === 'word') {
          const bp = fx ? fx.p : pBlock;
          const be = fx ? fx.e : eBlock;
          if (bp > 0) {
            const cycle = preset.box.cycle;
            // destaque manual SEMPRE vence o ciclo — a caixa da palavra vira accent
            const rawBoxFill = isHi
              ? 'accent'
              : cycle
                ? cycle[wi % cycle.length]
                : preset.box.fill;
            const boxFill = resolveColor(rawBoxFill, primary, accent);
            const padX = preset.box.padX * fontPx;
            const padY = preset.box.padY * fontPx;
            ctx.save();
            ctx.globalAlpha = outAlpha * clamp01(bp * 3);
            drawFxBox(
              d,
              wx + wl.w / 2 + (fx?.dx ?? 0),
              baseY - lineH * 0.3 + (fx?.dy ?? 0),
              wl.w + padX * 2,
              lineH * 0.8 + padY * 2,
              preset.box.radius * fontPx,
              boxFill,
              preset.box.skew ?? 0,
              preset.box.shadow,
              Math.min(be, 1.15) * extraS,
            );
            ctx.restore();
            // destaque vira caixa accent → o texto SEMPRE contrasta (fix
            // "chip cobrindo o texto": accent sobre accent sumia a palavra)
            if (preset.box.autoText || isHi) fill = contrastColor(boxFill);
          }
        }

        // highlight manual estilo box/underline (caixa de PALAVRA convive com
        // caixa de linha/bloco — ref callout: palavra em caixa vermelha DENTRO
        // da pílula branca; só conflita com box mode 'word')
        if (
          pass === 'base' &&
          isHi &&
          preset.highlightStyle === 'box' &&
          (!preset.box || preset.box.mode !== 'word')
        ) {
          const padX = fontPx * 0.18;
          ctx.save();
          ctx.globalAlpha = outAlpha * (fx?.alpha ?? 1);
          drawFxBox(
            d,
            wx + wl.w / 2,
            baseY - lineH * 0.3,
            wl.w + padX * 2,
            lineH * 0.86,
            fontPx * 0.14,
            accent,
            -4,
            undefined,
            1,
          );
          ctx.restore();
          fill = contrastColor(accent);
        }

        // holofote do karaokê: palavras inativas esmaecem
        const dimMul =
          preset.karaokeDim !== undefined &&
          karaoke !== 'none' &&
          karaoke !== 'fill' &&
          !isActive
            ? preset.karaokeDim
            : 1;
        drawWord(d, block, layout, wi, wx, baseY, fill, fx, loopSpec, tMs, seedBase, outAlpha * dimMul, unitIdx, extraS);

        // sublinhados
        if (pass === 'base') {
          const wantUnderline =
            (isHi && preset.highlightStyle === 'underline') ||
            (karaoke === 'word-underline' && isActive);
          if (wantUnderline) {
            const up = karaoke === 'word-underline' && isActive ? clamp01((tMs - word.start) / 140) : 1;
            ctx.save();
            ctx.globalAlpha = outAlpha * (fx?.alpha ?? 1);
            clearShadow(ctx);
            ctx.fillStyle = accent;
            const uw = wl.w * EASE.outCubic(up);
            ctx.fillRect(wx + (wl.w - uw) / 2, baseY + lineH * 0.1, uw, Math.max(2, fontPx * 0.07));
            ctx.restore();
          }
          // palavras NÃO destacadas riscadas (ref "NEITHER ~FORGES NOR~")
          if (preset.strikeOthers && !isHi) {
            ctx.save();
            ctx.globalAlpha = outAlpha * (fx?.alpha ?? 1);
            clearShadow(ctx);
            ctx.fillStyle = primary;
            ctx.fillRect(wx - fontPx * 0.04, baseY - lineH * 0.3, wl.w + fontPx * 0.08, Math.max(2, fontPx * 0.07));
            ctx.restore();
          }
        }
      }
      ctx.restore();
    });
  };

  if (isFill) {
    drawPass('base');
    const aw = layout.words[activeIdx];
    const word = block.words[activeIdx];
    const wp = clamp01((tMs - word.start) / Math.max(1, word.end - word.start));
    const fillX = wordAbsX(activeIdx) + aw.w * layout.lines[aw.line].scale * wp;
    ctx.save();
    ctx.beginPath();
    layout.lines.forEach((line, li) => {
      const y0 = topY + line.y0 - line.h * 0.2;
      if (li < aw.line) {
        ctx.rect(0, y0, W, line.h * 1.4);
      } else if (li === aw.line) {
        ctx.rect(0, y0, fillX, line.h * 1.4);
      }
    });
    ctx.clip();
    drawPass('accent');
    ctx.restore();
  } else {
    drawPass('base');
  }

  // ── ecos NA FRENTE (frase pequena em cima/embaixo, riscada...) ──
  drawEchoes('front');

  // ── rabiscos/faíscas ao redor (ref "Como FAZER ESSA LEGENDA") ──
  if (preset.doodles) {
    const dcol = resolveColor(preset.doodles.color, primary, accent);
    const e2 = clamp01(eBlock * 1.2);
    ctx.save();
    ctx.globalAlpha = outAlpha * e2;
    clearShadow(ctx);
    ctx.strokeStyle = dcol;
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(2, fontPx * 0.06);
    const spots: Array<[number, number, number]> = [
      [cx - blockWmax / 2 - fontPx * 0.8, topY - fontPx * 0.2, -0.4],
      [cx + blockWmax / 2 + fontPx * 0.8, topY + fontPx * 0.1, 0.5],
      [cx + blockWmax / 2 + fontPx * 0.6, topY + blockH + fontPx * 0.1, 0.2],
      [cx - blockWmax / 2 - fontPx * 0.6, topY + blockH - fontPx * 0.2, -0.2],
    ];
    spots.forEach(([sx, sy, rot], i) => {
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(rot + prand(seedBase + i * 7) * 0.6);
      const L = fontPx * (0.28 + prand(seedBase + i * 13) * 0.18) * e2;
      for (let k = 0; k < 3; k++) {
        const ang = (k - 1) * 0.55;
        ctx.beginPath();
        ctx.moveTo(Math.cos(ang) * L * 0.35, Math.sin(ang) * L * 0.35);
        ctx.lineTo(Math.cos(ang) * L, Math.sin(ang) * L);
        ctx.stroke();
      }
      ctx.restore();
    });
    ctx.restore();
  }

  finishDraw();

  function finishDraw() {
    ctx.restore();
    if (fxCtx && fxCanvas) {
      compositeGlitchBands(
        realCtx,
        fxCanvas,
        W,
        H,
        tMs,
        seedBase,
        Math.max(0, topY - lineH * 0.6),
        blockH + lineH * 1.2,
        fontPx,
        bandsStrength,
      );
    }
  }
}

// tile do preenchimento psicodélico (cache por preset)
let patternTile: HTMLCanvasElement | null = null;
let patternKey = '';

function getTrippyPattern(d: DrawCtx): Paint {
  const pf = d.preset.patternFill!;
  const key = d.preset.id + '|' + pf.colors.join();
  if (typeof document === 'undefined') return pf.colors[0];
  if (!patternTile || patternKey !== key) {
    patternTile = document.createElement('canvas');
    patternTile.width = 96;
    patternTile.height = 96;
    const c = patternTile.getContext('2d');
    if (!c) return pf.colors[0];
    c.clearRect(0, 0, 96, 96);
    if (pf.style === 'bricks') {
      // tijolos (ref "CLAUDE CODE"): fiadas com rejunte escuro
      c.fillStyle = pf.colors[1];
      c.fillRect(0, 0, 96, 96);
      c.fillStyle = pf.colors[0];
      for (let row = 0; row < 6; row++) {
        const off = row % 2 === 0 ? 0 : 24;
        for (let col = -1; col < 3; col++) {
          c.fillRect(col * 48 + off + 2, row * 16 + 2, 44, 12);
        }
      }
    } else if (pf.style === 'grunge') {
      // carimbo corroído (ref "SUBTITLE OVERLAY"): cor cheia + mordidas
      c.fillStyle = pf.colors[0];
      c.fillRect(0, 0, 96, 96);
      c.fillStyle = pf.colors[1];
      let s = 12345;
      const rnd = () => {
        s = (s * 16807) % 2147483647;
        return s / 2147483647;
      };
      for (let i = 0; i < 90; i++) {
        const x = rnd() * 96;
        const y = rnd() * 96;
        const r = rnd() * 3.2 + 0.6;
        c.beginPath();
        c.arc(x, y, r, 0, Math.PI * 2);
        c.fill();
      }
    } else if (pf.style === 'stripes') {
      // estêncil listrado (ref "TEXT COMES ALIVE"): barras verticais
      c.fillStyle = pf.colors[0];
      c.fillRect(0, 0, 96, 96);
      c.fillStyle = pf.colors[1];
      for (let x = 0; x < 96; x += 12) c.fillRect(x, 0, 6, 96);
    } else {
      c.fillStyle = pf.colors[0];
      c.fillRect(0, 0, 96, 96);
      c.strokeStyle = pf.colors[1];
      c.lineWidth = 7;
      c.lineCap = 'round';
      for (let k = -1; k < 9; k++) {
        c.beginPath();
        for (let x = -8; x <= 104; x += 6) {
          const y = k * 13 + Math.sin(x * 0.11 + k * 1.7) * 5;
          if (x === -8) c.moveTo(x, y);
          else c.lineTo(x, y);
        }
        c.stroke();
      }
    }
    patternKey = key;
  }
  const pat = d.ctx.createPattern(patternTile, 'repeat');
  if (!pat) return pf.colors[0];
  const s = (d.fontPx / 60) * pf.scale;
  const off = (d.tMs * pf.speed) / 1000;
  pat.setTransform(
    new DOMMatrix()
      .translateSelf((off * 14) % 96, (off * 9) % 96)
      .scaleSelf(s, s),
  );
  return pat;
}

/** Fill da palavra DESTACADA: gradiente próprio quando o preset define. */
function resolveHighlightFill(d: DrawCtx, lineH: number): Paint {
  const p = d.preset;
  if (p.highlightGradient) {
    const g = d.ctx.createLinearGradient(0, -lineH * 0.75, 0, lineH * 0.35);
    for (const [o, c] of p.highlightGradient) {
      g.addColorStop(o, resolveColor(c, d.primary, d.accent));
    }
    return g;
  }
  return resolveColor(p.highlightColor ?? 'accent', d.primary, d.accent);
}

function resolveFill(d: DrawCtx, lineH: number): Paint {
  const { preset, ctx } = d;
  if (preset.patternFill) return getTrippyPattern(d);
  if (preset.fill === 'gradient') {
    const g =
      preset.gradientDir === 'diagonal'
        ? ctx.createLinearGradient(-lineH * 1.6, -lineH * 0.75, lineH * 1.6, lineH * 0.35)
        : ctx.createLinearGradient(0, -lineH * 0.75, 0, lineH * 0.35);
    const stops: Array<[number, string]> =
      preset.gradientStops ??
      (preset.gradient
        ? [
            [0, preset.gradient[0]],
            [1, preset.gradient[1]],
          ]
        : [
            [0, '#ffffff'],
            [1, '#d0d0d0'],
          ]);
    for (const [o, c] of stops) g.addColorStop(o, resolveColor(c, d.primary, d.accent));
    return g;
  }
  return resolveColor(preset.fill, d.primary, d.accent);
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
  fill: Paint,
  fxWord: UnitFx | null,
  loopSpec: LoopSpec | undefined,
  tMs: number,
  seedBase: number,
  outAlpha: number,
  charBase: number,
  extraS: number,
) {
  const { ctx, preset, fontPx } = d;
  const wl = layout.words[wi];
  const lineH = layout.lineH;
  const wordJitterRot = preset.wordRotateJitter
    ? (prand(seedBase * 3 + wi * 61) - 0.5) * 2 * preset.wordRotateJitter * DEG
    : 0;
  // script de apoio pode sentar mais baixo/sobreposto (ref "1 Click text")
  const mixDy = wl.mixed && preset.mix?.dy ? preset.mix.dy * fontPx : 0;

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
      ctx.translate(cxx + cl.w / 2 + fx.dx + loop.dx, baseY - lineH * 0.3 + fx.dy + loop.dy + mixDy);
      ctx.scale(fx.sx * loop.s * extraS, fx.sy * loop.s * extraS);
      if (fx.rot || loop.rot || wordJitterRot) ctx.rotate(fx.rot + loop.rot + wordJitterRot);
      if (fx.skew) ctx.transform(1, 0, Math.tan(fx.skew), 1, 0, 0);
      if (fx.blur > 0.4) ctx.filter = `blur(${fx.blur.toFixed(1)}px)`;
      // cores por LETRA + letras vazadas (refs "FUN TEXT" / "VIBRANT FLICKER")
      let chFill: Paint = fill;
      if (preset.charColorCycle && !wl.mixed) {
        chFill = resolveColor(
          preset.charColorCycle[gi % preset.charColorCycle.length],
          d.primary,
          d.accent,
        );
      }
      const outlineChar =
        !!preset.charOutlineRatio &&
        !wl.mixed &&
        prand(seedBase * 13 + gi * 47) < preset.charOutlineRatio;
      if (outlineChar) {
        clearShadow(ctx);
        ctx.font = fs(wl.fk, wl.fpx);
        ctx.strokeStyle = typeof chFill === 'string' ? chFill : d.primary;
        ctx.lineWidth = Math.max(1.5, wl.fpx * 0.045);
        ctx.lineJoin = 'round';
        ctx.strokeText(cl.ch, -cl.w / 2, lineH * 0.3);
      } else {
        fillWordText(d, cl.ch, -cl.w / 2, lineH * 0.3, chFill, wl.fpx, wl.fk, wl.mixed);
      }
      ctx.restore();
    }
    if (d.underline && !wl.mixed) {
      ctx.save();
      ctx.globalAlpha = outAlpha;
      clearShadow(ctx);
      ctx.fillStyle = typeof fill === 'string' ? fill : d.primary;
      ctx.fillRect(wx, baseY + lineH * 0.12, wl.w, Math.max(1.5, wl.fpx * 0.055));
      ctx.restore();
    }
    return;
  }

  // por PALAVRA (ou bloco)
  const fx = fxWord ?? computeInFx(preset.in, 0, tMs, block.start, fontPx, seedBase);
  const loop = computeLoopFx(loopSpec, wi, tMs, fx.p, fontPx, seedBase);
  ctx.save();
  ctx.globalAlpha = outAlpha * fx.alpha * loop.alphaMul;
  ctx.translate(wx + wl.w / 2 + fx.dx + loop.dx, baseY - lineH * 0.3 + fx.dy + loop.dy + mixDy);
  ctx.scale(fx.sx * loop.s * extraS, fx.sy * loop.s * extraS);
  if (fx.rot || loop.rot || wordJitterRot) ctx.rotate(fx.rot + loop.rot + wordJitterRot);
  if (fx.skew) ctx.transform(1, 0, Math.tan(fx.skew), 1, 0, 0);
  if (fx.blur > 0.4) ctx.filter = `blur(${fx.blur.toFixed(1)}px)`;

  if (preset.in.kind === 'glitch' && fx.p < 1 && !wl.mixed) {
    // fantasmas RGB extras durante a entrada glitch
    const m = (1 - fx.e) * (preset.in.amp ?? 1) * fontPx * 0.4;
    if (m > 0.5) {
      const step = Math.floor(tMs / 45);
      const ox = (prand(seedBase + wi * 311 + step * 3) - 0.5) * m * 2;
      ctx.save();
      ctx.globalAlpha *= 0.55;
      clearShadow(ctx);
      ctx.fillStyle = 'rgba(255,45,85,0.9)';
      ctx.font = fs(wl.fk, wl.fpx);
      ctx.fillText(wl.text, -wl.w / 2 + ox, lineH * 0.3);
      ctx.fillStyle = 'rgba(0,229,255,0.9)';
      ctx.fillText(wl.text, -wl.w / 2 - ox, lineH * 0.3);
      ctx.restore();
    }
  }

  fillWordText(d, wl.text, -wl.w / 2, lineH * 0.3, fill, wl.fpx, wl.fk, wl.mixed);
  if (d.underline && !wl.mixed) {
    clearShadow(ctx);
    ctx.fillStyle = fill;
    ctx.fillRect(-wl.w / 2, lineH * 0.42, wl.w, Math.max(1.5, wl.fpx * 0.055));
  }
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
  for (let li = 0; li < layout.lines.length; li++) {
    const line = layout.lines[li];
    const x0 = cx - (line.width * line.scale) / 2;
    const baseY = topY + line.y0 + line.h * 0.78;
    ctx.save();
    if (line.scale !== 1) {
      ctx.translate(cx, baseY);
      ctx.scale(line.scale, line.scale);
      ctx.translate(-cx, -baseY);
    }
    for (const wi of line.wordIdx) {
      const wl = layout.words[wi];
      const isHi = highlights.has(wi);
      const fill = isHi
        ? resolveColor(preset.highlightColor ?? 'accent', d.primary, d.accent)
        : resolveFill(d, lineH);
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
        fillWordText(d, cl.ch, x0 + wl.x + cl.x, baseY, fill, wl.fpx, wl.fk, wl.mixed);
        drawn++;
        caretX = x0 + wl.x + cl.x + cl.w;
        caretY = baseY;
      }
    }
    ctx.restore();
  }
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
  clearShadow(ctx);
  ctx.fillStyle = d.accent;
  if (preset.caret === 'bar') {
    ctx.fillRect(x, y - lineH * 0.62, Math.max(2, fontPx * 0.06), lineH * 0.72);
  } else {
    ctx.fillRect(x, y - lineH * 0.62, fontPx * 0.52, lineH * 0.72);
  }
  ctx.restore();
}

/**
 * BBox da legenda no tempo t (coordenadas do canvas) — hit-test pro editor:
 * clicar seleciona, arrastar move, alça redimensiona, duplo clique edita.
 * Usa exatamente a mesma geometria do drawCaptions.
 */
export function captionBBoxAt(
  ctx: CanvasRenderingContext2D,
  blocks: Block[],
  basePreset: TypoPreset,
  styleArg: StyleState,
  tMs: number,
  W: number,
  H: number,
): { x: number; y: number; w: number; h: number; blockId: string } | null {
  let block: Block | null = null;
  for (const b of blocks) {
    if (tMs >= b.start && tMs < b.end) {
      block = b;
      break;
    }
    if (b.start > tMs) break;
  }
  if (!block || block.words.length === 0) return null;

  // mesmo merge por-bloco do drawCaptions (o bbox tem que bater com o draw)
  const ov = styleArg.perBlock?.[block.id];
  const style: StyleState = ov ? { ...styleArg, ...ov } : styleArg;
  FAUX_ITALIC = style.italic === true;
  FAUX_BOLD = style.bold === true;

  const preset =
    style.fontOverride && style.fontOverride !== basePreset.font
      ? { ...basePreset, font: style.fontOverride }
      : basePreset;
  let hiList = style.highlights[block.id] ?? [];
  if (hiList.length === 0 && preset.autoEmphasis && style.autoEmphasis !== false) {
    const auto = autoEmphasisIndex(block);
    if (auto !== null) hiList = [auto];
  }
  const highlights = new Set(hiList);
  const layout = measureLayout(ctx, block, preset, style, W, highlights);
  const isSolo = (preset.karaoke ?? 'none') === 'solo';
  const blockH = isSolo ? layout.lineH : layout.totalH;
  let topY = style.posY * H - blockH / 2;
  topY = Math.min(Math.max(topY, H * 0.04), H * 0.96 - blockH);
  const blockWmax = isSolo
    ? Math.max(...layout.words.map((w) => w.w))
    : Math.max(...layout.lines.map((l) => l.width * l.scale));
  let cx = (style.posX ?? 0.5) * W;
  const halfW = blockWmax / 2 + W * 0.02;
  cx = halfW * 2 >= W ? W / 2 : Math.min(Math.max(cx, halfW), W - halfW);
  const pad = layout.fontPx * 0.45;
  return {
    x: cx - blockWmax / 2 - pad,
    y: topY - pad,
    w: blockWmax + pad * 2,
    h: blockH + pad * 2,
    blockId: block.id,
  };
}

// ─── Demo (galeria de modelos) ──────────────────────────────────────────────

const demoCache = new Map<string, Block>();

/**
 * Desenha um loop de demonstração do preset (pra galeria). `tLoop` em ms,
 * qualquer valor — o engine faz o módulo internamente. A palavra do meio vem
 * destacada pra mostrar o comportamento de destaque de cada modelo.
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
  const cacheKey = preset.id + '|' + demoText;
  let demo = demoCache.get(cacheKey);
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
    demoCache.set(cacheKey, demo);
  }
  // SEM destaque manual forçado: a demo mostra exatamente o comportamento
  // real (autoEmphasis do preset, quando existir) — galeria = vídeo.
  const style: StyleState = {
    presetId: preset.id,
    fontScale: 1.02,
    posY: 0.54,
    primary: null,
    accent: null,
    uppercase: null,
    highlights: {},
    autoEmphasis: true,
  };
  drawCaptions(ctx, [demo], preset, style, t, W, H);
}
