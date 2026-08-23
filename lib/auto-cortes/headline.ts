/**
 * AUTO CORTES — headline (o "Texto" do Opus Clip).
 *
 * A headline é um TÍTULO ESTÁTICO de 1-2 linhas queimado no alto do corte,
 * acima do rosto. Não é legenda: não acompanha a fala, não pisca, não troca.
 * Tecnicamente ela reusa o mesmo engine (`drawCaptions`) com UM bloco só —
 * assim preview, miniatura e MP4 saem idênticos e a galeria de modelos é a
 * mesma da Tipografia.
 *
 * Por que as palavras têm tempo se o título é estático: vários modelos
 * revelam por palavra na ENTRADA (stagger, mask-up, karaokê). Dar 1,2 s por
 * palavra faz a entrada acontecer nos primeiros segundos e, depois disso,
 * tudo fica parado até o fim do corte.
 */

import {
  DEFAULT_STYLE,
  drawCaptions,
  type Block,
  type StyleState,
  type TypoPreset,
} from '@/lib/typography/engine';
import { getPreset, TYPO_PRESETS } from '@/lib/typography/presets';
import type { AspectRatio } from './types';
import { CAPTION_FONT_SCALE } from './captions';

/** id fixo do bloco da headline (estilos por bloco continuam previsíveis) */
export const HEADLINE_BLOCK_ID = 'headline';
/** espaçamento entre palavras na entrada */
export const HEADLINE_WORD_STEP_MS = 1200;
/** escala base pedida na arquitetura (§3.5) */
export const HEADLINE_BASE_SCALE = 0.82;
/** texto de demonstração dos cards da galeria de headline */
export const HEADLINE_DEMO_TEXT = 'ESSE É O SEGREDO';

/** Altura da headline: alto do frame, acima do rosto (o 16:9 tem menos ar). */
export const HEADLINE_POS_Y: Record<AspectRatio, number> = {
  '9:16': 0.15,
  '4:5': 0.15,
  '1:1': 0.15,
  '16:9': 0.12,
};

/**
 * Modelos que ficam BONS como título estático de 1-2 linhas. A galeria de
 * headline mostra só estes — a lista é curada na mão, não filtrada por
 * categoria. Ficaram DE FORA, de propósito:
 *  - qualquer modelo com `karaoke` (a cor persegue a fala, e aqui não há fala);
 *  - `loop` (glitch/shake/flicker): título que treme os 60 s inteiros cansa —
 *    é por isso que o `glitch-viral`, apesar de favorito nas legendas, não
 *    entrou;
 *  - `typewriter` e modelos por LETRA: a digitação lenta rouba os 3 s de ouro;
 *  - `stack` (uma palavra por linha): 8 palavras viram 8 linhas.
 */
export const HEADLINE_PRESET_IDS: readonly string[] = [
  // ── família nova, desenhada pra headline (cat 'Headline') ──
  'hl-caixa-branca', // réplica do Opus: caixa branca por linha, Montserrat preta
  'hl-caixa-preta',
  'hl-marca-texto',
  'hl-faixa-vermelha',
  'hl-pilula',
  'hl-jornal',
  'hl-gradiente',
  'hl-contorno',
  // ── caixas e faixas que já existiam e funcionam como título ──
  'faixa-suave',
  'barra-branca-solida',
  'tarja-preta',
  'caixa-solida',
  'botao-cta',
  'pilula-dourada',
  'lower-third-ouro',
  // ── impacto (bloco inteiro entrando de uma vez) ──
  'vermelho-sangue',
  'ouro',
  'carimbo',
  'barra-impacto',
  'cartaz-3d',
  'poster-stack',
  // ── virais com tipografia mista (a palavra forte quebra pra própria linha) ──
  'titulo-viral',
  'titulo-ouro',
  'verde-dinheiro',
  'extensao-script',
  'empilhado',
  // ── editorial / minimal ──
  'keynote',
  'jornal',
  'bodoni-fashion',
];

/** Os modelos de headline, na ordem curada (pra galeria da UI). */
export function headlinePresets(): TypoPreset[] {
  const byId = new Map(TYPO_PRESETS.map((p) => [p.id, p]));
  const out: TypoPreset[] = [];
  for (const id of HEADLINE_PRESET_IDS) {
    const p = byId.get(id);
    if (p) out.push(p);
  }
  return out;
}

export function isHeadlinePresetId(id: string): boolean {
  return HEADLINE_PRESET_IDS.indexOf(id) >= 0;
}

/**
 * Bloco único da headline, em tempo RELATIVO ao corte.
 * `durationMs` = duração do corte inteiro ou 5000 (opção "primeiros 5 s").
 *
 * As palavras ficam espaçadas em 1,2 s; se o texto for longo demais pra caber
 * nesse ritmo dentro da duração (caso do "primeiros 5 s" com 8 palavras), o
 * passo encolhe pra que a última palavra AINDA apareça — melhor uma entrada
 * mais rápida do que uma palavra que nunca chega.
 */
export function makeHeadlineBlock(text: string, durationMs: number): Block {
  const dur = Math.max(1, Math.round(durationMs));
  const parts = String(text ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return { id: HEADLINE_BLOCK_ID, words: [], start: 0, end: dur };

  const step = Math.max(1, Math.min(HEADLINE_WORD_STEP_MS, Math.floor(dur / parts.length)));
  const words = parts.map((t, i) => ({
    text: t,
    start: Math.min(dur, i * step),
    end: Math.min(dur, (i + 1) * step),
  }));
  // a última segura até o fim: karaokê/typewriter não deixam buraco no meio
  words[words.length - 1].end = dur;
  return { id: HEADLINE_BLOCK_ID, words, start: 0, end: dur };
}

/**
 * Estilo da headline. O engine mede o tamanho pela LARGURA do canvas, então
 * a escala base (0,82) leva a MESMA compensação por proporção das legendas —
 * sem isso o título ocupa 20 % da altura num 16:9.
 */
export function headlineStyle(aspect: AspectRatio, preset: TypoPreset): StyleState {
  return {
    ...DEFAULT_STYLE,
    presetId: preset.id,
    fontScale: HEADLINE_BASE_SCALE * (CAPTION_FONT_SCALE[aspect] ?? 1),
    posY: HEADLINE_POS_Y[aspect] ?? 0.15,
    // o destaque automático só vale se o próprio modelo pede (mix/emphasisBreak
    // dependem dele); nos modelos de caixa ele só bagunçaria o título
    autoEmphasis: preset.autoEmphasis ?? false,
  };
}

/** Atalho quando só se tem o id do modelo. */
export function headlineStyleById(aspect: AspectRatio, presetId: string): StyleState {
  return headlineStyle(aspect, getPreset(presetId));
}

/**
 * Desenha a headline. É `drawCaptions` com um bloco só — mesmo renderer do
 * preview e do MP4 (WYSIWYG).
 */
export function drawHeadline(
  ctx: CanvasRenderingContext2D,
  block: Block,
  preset: TypoPreset,
  style: StyleState,
  tMs: number,
  W: number,
  H: number,
): void {
  if (!block || block.words.length === 0) return;
  drawCaptions(ctx, [block], preset, style, tMs, W, H);
}
