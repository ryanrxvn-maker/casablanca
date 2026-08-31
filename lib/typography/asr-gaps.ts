/**
 * BURACO NA LEGENDA: foi o reconhecimento que falhou ou era silêncio mesmo?
 *
 * O Whisper é mandado numa tacada só com o áudio inteiro e, em vídeo longo,
 * ele às vezes DESISTE de um trecho: volta sem nenhuma palavra ali, sem erro
 * nenhum. A ferramenta acreditava e o vídeo saía com um vão de legenda no
 * meio — sem ninguém avisar, e sem jeito de saber se era falha ou pausa.
 *
 * Aqui a resposta vem MEDIDA: o mesmo detector de fala da decupagem
 * (`lib/speech-detect.ts`, que compara com o piso do próprio arquivo em vez
 * de um limiar absoluto) diz onde tem VOZ; o que tem voz e não tem palavra é
 * buraco de reconhecimento — e o que não tem voz é silêncio de verdade.
 *
 * Tudo função pura: `lib/typography/asr-gaps.ts` roda sobre listas de tempos.
 * Testes em `lib/typography/asr-gaps.test.ts`.
 */

import type { TWord } from './engine';

export type Span = { start: number; end: number };

export type AsrGap = Span & {
  /** quanto desse vão tem VOZ (ms) */
  speechMs: number;
  /**
   * `falha`   — tem fala e não tem palavra: o reconhecimento perdeu.
   * `silencio` — não tem fala: o vão é legítimo.
   */
  kind: 'falha' | 'silencio';
};

/** Junta intervalos que se tocam/sobrepõem, em ordem. */
export function mergeSpans(spans: Span[], joinMs = 0): Span[] {
  const ord = spans
    .filter((s) => s.end > s.start)
    .slice()
    .sort((a, b) => a.start - b.start);
  const out: Span[] = [];
  for (const s of ord) {
    const last = out[out.length - 1];
    if (last && s.start - last.end <= joinMs) {
      last.end = Math.max(last.end, s.end);
    } else {
      out.push({ start: s.start, end: s.end });
    }
  }
  return out;
}

/** Quanto de `spans` cai dentro de [a, b). */
export function overlapMs(spans: Span[], a: number, b: number): number {
  let total = 0;
  for (const s of spans) {
    const o = Math.min(s.end, b) - Math.max(s.start, a);
    if (o > 0) total += o;
  }
  return total;
}

/** Converte a máscara de frames do speech-detect em intervalos de fala (ms). */
export function maskToSpans(mask: ArrayLike<number>, frameSec: number): Span[] {
  const out: Span[] = [];
  let ini = -1;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) {
      if (ini < 0) ini = i;
    } else if (ini >= 0) {
      out.push({ start: Math.round(ini * frameSec * 1000), end: Math.round(i * frameSec * 1000) });
      ini = -1;
    }
  }
  if (ini >= 0) {
    out.push({
      start: Math.round(ini * frameSec * 1000),
      end: Math.round(mask.length * frameSec * 1000),
    });
  }
  return out;
}

export type FindGapsOpts = {
  /** vão menor que isso nem é olhado (ms) */
  minGapMs?: number;
  /** com menos voz que isso dentro do vão, é silêncio (ms) */
  minSpeechMs?: number;
  /** fração do vão que precisa ter voz pra virar `falha` */
  minSpeechRatio?: number;
};

/**
 * Acha os vãos entre as palavras do ASR e classifica cada um.
 *
 * `durationMs` fecha a conta nas pontas: o começo do vídeo antes da primeira
 * palavra e a cauda depois da última também são vãos — e é justamente onde o
 * Whisper costuma comer o final.
 */
export function findAsrGaps(
  words: TWord[],
  speech: Span[],
  durationMs: number,
  opts: FindGapsOpts = {},
): AsrGap[] {
  const minGap = opts.minGapMs ?? 900;
  const minSpeech = opts.minSpeechMs ?? 600;
  const minRatio = opts.minSpeechRatio ?? 0.35;

  const cobertos = mergeSpans(
    words.filter((w) => w.end > w.start).map((w) => ({ start: w.start, end: w.end })),
    // palavras vizinhas com respiro curto não abrem vão
    260,
  );

  const vaos: Span[] = [];
  let cursor = 0;
  for (const c of cobertos) {
    if (c.start - cursor >= minGap) vaos.push({ start: cursor, end: c.start });
    cursor = Math.max(cursor, c.end);
  }
  if (durationMs - cursor >= minGap) vaos.push({ start: cursor, end: durationMs });

  const fala = mergeSpans(speech);
  return vaos.map((v) => {
    const speechMs = overlapMs(fala, v.start, v.end);
    const dur = v.end - v.start;
    const kind: AsrGap['kind'] =
      speechMs >= minSpeech && speechMs >= dur * minRatio ? 'falha' : 'silencio';
    return { ...v, speechMs, kind };
  });
}

/**
 * Janela a re-transcrever pra cobrir o buraco, com uma folga de cada lado
 * (o Whisper acerta melhor com contexto, e a folga garante que a palavra
 * colada na borda não fique cortada de novo). Nunca sai de [0, duração].
 */
export function gapWindow(gap: Span, durationMs: number, padMs = 900): Span {
  return {
    start: Math.max(0, Math.round(gap.start - padMs)),
    end: Math.min(durationMs, Math.round(gap.end + padMs)),
  };
}

/**
 * Costura as palavras recuperadas de uma janela na transcrição original.
 *
 * Só entra o que cai DENTRO do buraco (a folga da janela existe pro Whisper
 * ter contexto, não pra duplicar palavra que já estava lá), e o resultado sai
 * ordenado por tempo. `offsetMs` é onde a janela começa no vídeo — o Whisper
 * devolve tempos relativos ao recorte.
 */
export function spliceRecovered(
  base: TWord[],
  recuperadas: TWord[],
  gap: Span,
  offsetMs: number,
): { words: TWord[]; added: number } {
  const deslocadas = recuperadas
    .map((w) => ({ text: w.text, start: w.start + offsetMs, end: w.end + offsetMs }))
    .filter((w) => w.text.trim().length > 0)
    // o centro da palavra tem que cair no buraco
    .filter((w) => {
      const meio = (w.start + w.end) / 2;
      return meio >= gap.start && meio < gap.end;
    });

  if (deslocadas.length === 0) return { words: base, added: 0 };

  // nunca deixar a recuperada pisar numa palavra que já existia
  const limpas = deslocadas.filter(
    (w) => !base.some((b) => Math.min(b.end, w.end) - Math.max(b.start, w.start) > 0),
  );
  if (limpas.length === 0) return { words: base, added: 0 };

  const juntas = [...base, ...limpas].sort((a, b) => a.start - b.start || a.end - b.end);
  return { words: juntas, added: limpas.length };
}

/** Resumo honesto pra mostrar na tela. */
export function describeGaps(gaps: AsrGap[]): {
  falhas: AsrGap[];
  silencios: AsrGap[];
  totalFalhaMs: number;
} {
  const falhas = gaps.filter((g) => g.kind === 'falha');
  return {
    falhas,
    silencios: gaps.filter((g) => g.kind === 'silencio'),
    totalFalhaMs: falhas.reduce((s, g) => s + (g.end - g.start), 0),
  };
}
