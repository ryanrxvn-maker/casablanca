/**
 * AUTO CORTES — legendas de UM corte.
 *
 * Reuso total do engine das Legendas Automáticas (`lib/typography`): as
 * palavras da transcrição viram blocos com o MESMO `groupWords`, e o desenho
 * é o MESMO `drawCaptions`. A única coisa que muda é o relógio: a transcrição
 * está em tempo ABSOLUTO do vídeo-fonte e o corte começa em zero, então todo
 * bloco é deslocado por `-startMs` e clampado nas bordas.
 *
 * O tamanho da fonte no engine é fração da LARGURA do canvas (não da altura),
 * então a mesma legenda "parece" maior em 16:9 do que em 9:16 — o
 * `captionStyleFor` compensa isso por proporção.
 */

import {
  DEFAULT_STYLE,
  type Block,
  type StyleState,
  type TWord,
} from '@/lib/typography/engine';
import { groupWords } from '@/lib/typography/group';
import type { AspectRatio, CaptionPace, Ms } from './types';

/** Compensação de tamanho por proporção (o engine mede pela LARGURA). */
export const CAPTION_FONT_SCALE: Record<AspectRatio, number> = {
  '9:16': 1,
  '4:5': 1,
  '1:1': 0.95,
  '16:9': 0.62,
};

/** Altura da legenda: baixa no vertical, um pouco mais baixa ainda no 16:9. */
export const CAPTION_POS_Y: Record<AspectRatio, number> = {
  '9:16': 0.76,
  '4:5': 0.76,
  '1:1': 0.76,
  '16:9': 0.8,
};

/**
 * Palavras que INTERSECTAM o intervalo (a palavra que começa antes do corte
 * mas termina dentro dele entra — cortar palavra pela metade é o que faz a
 * legenda "engolir" o começo da frase).
 *
 * Espelha o `wordsInRange` de `transcript.ts` (agente A1) — mantido local
 * pra este módulo não depender da ordem de entrega das fases.
 */
export function wordsInClip<T extends TWord>(words: T[], startMs: Ms, endMs: Ms): T[] {
  return words.filter((w) => w.end > startMs && w.start < endMs);
}

/** Desloca os blocos no tempo (positivo = pra frente). */
export function shiftBlocks(blocks: Block[], deltaMs: number): Block[] {
  return blocks.map((b) => ({
    ...b,
    start: b.start + deltaMs,
    end: b.end + deltaMs,
    words: b.words.map((w) => ({ ...w, start: w.start + deltaMs, end: w.end + deltaMs })),
  }));
}

/**
 * Blocos de legenda de um corte `[startMs, endMs)`, já em tempo RELATIVO ao
 * corte (0 = primeiro frame) e clampados na duração.
 */
export function buildClipCaptions(
  words: TWord[],
  startMs: Ms,
  endMs: Ms,
  pace: CaptionPace,
): Block[] {
  const dur = Math.max(0, endMs - startMs);
  if (dur <= 0) return [];

  const dentro = wordsInClip(words, startMs, endMs);
  if (dentro.length === 0) return [];

  const blocos = shiftBlocks(groupWords(dentro, pace), -startMs);

  const out: Block[] = [];
  for (const b of blocos) {
    const start = Math.max(0, b.start);
    const end = Math.min(dur, b.end);
    if (end <= start) continue;
    // as palavras também são clampadas: karaokê/typewriter usam o tempo delas
    const words2 = b.words.map((w) => ({
      ...w,
      start: Math.max(0, Math.min(dur, w.start)),
      end: Math.max(0, Math.min(dur, w.end)),
    }));
    out.push({ ...b, start, end, words: words2 });
  }
  return out;
}

/** Estilo das legendas do corte — só muda o que depende da proporção. */
export function captionStyleFor(aspect: AspectRatio, presetId: string): StyleState {
  return {
    ...DEFAULT_STYLE,
    presetId,
    fontScale: CAPTION_FONT_SCALE[aspect] ?? 1,
    posY: CAPTION_POS_Y[aspect] ?? DEFAULT_STYLE.posY,
  };
}
