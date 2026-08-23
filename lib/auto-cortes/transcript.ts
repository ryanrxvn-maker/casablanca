/**
 * AUTO CORTES — miolo PURO da transcrição.
 *
 * Sem DOM, sem React, sem ffmpeg e sem rede: só matemática de tempo. É aqui
 * que mora tudo que precisa ser TESTÁVEL do caminho áudio → ASR → frases
 * (ver `transcript.test.ts`). Quem toca ffmpeg/fetch é `transcribe.ts`.
 *
 * Regras vindas de docs/auto-cortes/ARQUITETURA.md §3.2:
 *  - pedaços de `LIMITS.audioChunkSec` (9 min) com `LIMITS.audioChunkOverlapSec`
 *    (3 s) de sobreposição — o overlap existe porque o ASR erra as palavras
 *    coladas na borda do arquivo;
 *  - no merge, a sobreposição é cortada no MEIO: o pedaço anterior fica com as
 *    palavras que TERMINAM antes do meio, o seguinte com o resto (partição por
 *    fim = sem buraco e sem duplicata, mesmo pra palavra que atravessa a
 *    fronteira), e um passe de dedup limpa a mesma palavra repetida;
 *  - frase quebra por pontuação final, por pausa >= 700 ms ou por teto de 28
 *    palavras — o que vier primeiro.
 *
 * Tempo de palavra sempre em MILISSEGUNDOS; tempo de pedaço em SEGUNDOS.
 */

import { LIMITS } from './types';
import type { AudioChunkPlan, ChunkWords, Sentence, Word } from './types';

/** Pausa (ms) que sozinha já fecha uma frase. */
export const SENTENCE_PAUSE_MS = 700;
/** Teto de palavras por frase (frase longa demais atrapalha o modelo). */
export const SENTENCE_MAX_WORDS = 28;
/** Janela pra considerar duas palavras iguais como a MESMA (dedup do overlap). */
export const DUP_WINDOW_MS = 300;

/** Arredonda pra milissegundo (evita 0.30000000000000004 no plano). */
function r3(sec: number): number {
  return Math.round(sec * 1000) / 1000;
}

/** `S0001` — id estável de frase (é o que o modelo referencia, nunca tempo). */
export function sentenceId(n: number): string {
  return `S${String(Math.max(1, Math.trunc(n))).padStart(4, '0')}`;
}

// ───────────────────────────────────────────────────────────────────────────
// 1. Plano dos pedaços de áudio
// ───────────────────────────────────────────────────────────────────────────

/**
 * Divide a duração em pedaços contíguos de `chunkSec` que se ESTICAM
 * `overlapSec` pra dentro do pedaço seguinte. Ou seja: o passo é `chunkSec`,
 * mas cada pedaço dura `chunkSec + overlapSec` (o último para na duração real).
 *
 * O último pedaço é descartado quando o que sobrava dele já estava inteiro
 * dentro do overlap do anterior — senão o plano teria um pedacinho de 1 s só
 * pra repetir o que já foi transcrito.
 */
export function planAudioChunks(
  durationSec: number,
  opts: { chunkSec?: number; overlapSec?: number } = {},
): AudioChunkPlan[] {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return [];
  const chunkSec = Math.max(5, opts.chunkSec ?? LIMITS.audioChunkSec);
  const overlapSec = Math.max(
    0,
    Math.min(chunkSec / 2, opts.overlapSec ?? LIMITS.audioChunkOverlapSec),
  );

  const out: AudioChunkPlan[] = [];
  const steps = Math.max(1, Math.ceil(durationSec / chunkSec));
  for (let i = 0; i < steps; i++) {
    const startSec = i * chunkSec;
    const remaining = durationSec - startSec;
    if (remaining <= 0) break;
    // sobra menor que o overlap = já veio inteira no pedaço anterior
    if (i > 0 && remaining <= overlapSec) break;
    out.push({
      idx: out.length,
      startSec: r3(startSec),
      durSec: r3(Math.min(chunkSec + overlapSec, remaining)),
    });
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// 2. Merge das palavras dos pedaços
// ───────────────────────────────────────────────────────────────────────────

/** Normaliza pra comparar duas palavras (dedup): sem caixa, sem pontuação. */
function normalizeWord(text: string): string {
  return (text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * Junta as palavras de todos os pedaços num único vetor absoluto.
 *
 *  1. REBASE: cada palavra vem com tempo relativo ao pedaço → soma o start dele.
 *  2. FRONTEIRA: entre o pedaço i e o i+1 a sobreposição é cortada no meio
 *     (`B + overlap/2`, com B = início do i+1): fica com o i tudo que TERMINA
 *     antes do meio, e com o i+1 tudo que termina do meio em diante.
 *  3. DEDUP: a mesma palavra repetida (texto normalizado igual e |Δstart| <
 *     300 ms) é removida — rede de segurança pro caso do ASR datar a palavra
 *     de forma diferente nos dois pedaços.
 */
export function mergeChunkWords(
  chunks: ChunkWords[],
  overlapSec: number = LIMITS.audioChunkOverlapSec,
): Word[] {
  const ordered = (chunks ?? [])
    .filter((c): c is ChunkWords => !!c)
    .slice()
    .sort((a, b) => a.startSec - b.startSec || a.idx - b.idx);
  if (ordered.length === 0) return [];

  const halfMs = Math.max(0, overlapSec * 1000) / 2;
  const merged: Word[] = [];

  for (let k = 0; k < ordered.length; k++) {
    const c = ordered[k];
    const offsetMs = Math.round(c.startSec * 1000);
    const hasPrev = k > 0;
    const next = k + 1 < ordered.length ? ordered[k + 1] : null;
    // Corte com o pedaço ANTERIOR: B = início DESTE pedaço.
    const lowCut = hasPrev ? offsetMs + halfMs : Number.NEGATIVE_INFINITY;
    // Corte com o pedaço SEGUINTE: B = início do SEGUINTE.
    const highCut = next
      ? Math.round(next.startSec * 1000) + halfMs
      : Number.POSITIVE_INFINITY;

    for (const w of c.words ?? []) {
      if (!w || typeof w.text !== 'string') continue;
      const start = Math.round(w.start) + offsetMs;
      const end = Math.round(Math.max(w.end, w.start)) + offsetMs;
      if (end < lowCut) continue; // pertence ao pedaço anterior
      if (end >= highCut) continue; // pertence ao pedaço seguinte
      merged.push({ ...w, text: w.text, start, end });
    }
  }

  merged.sort((a, b) => a.start - b.start || a.end - b.end);

  const out: Word[] = [];
  for (const w of merged) {
    const last = out[out.length - 1];
    if (last && Math.abs(w.start - last.start) < DUP_WINDOW_MS) {
      const a = normalizeWord(last.text);
      const b = normalizeWord(w.text);
      if (a !== '' && a === b) continue; // mesma palavra vinda dos dois pedaços
    }
    out.push(w);
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// 3. Frases (a unidade que o modelo enxerga)
// ───────────────────────────────────────────────────────────────────────────

const END_LATIN = /[.!?…]+["'”’)\]]*$/;
const END_CJK = /[。！？…]+["'”’)\]]*$/;

function makeSentence(n: number, words: Word[], from: number, to: number): Sentence {
  let endMs = words[to].end;
  const parts: string[] = [];
  for (let i = from; i <= to; i++) {
    if (words[i].end > endMs) endMs = words[i].end;
    const t = words[i].text.trim();
    if (t) parts.push(t);
  }
  const text = parts
    .join(' ')
    .replace(/\s+([,.;:!?…])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return {
    id: sentenceId(n),
    startMs: words[from].start,
    endMs,
    text,
    wordFrom: from,
    wordTo: to,
  };
}

/**
 * Agrupa as palavras em frases. Fecha a frase na PRIMEIRA das três condições:
 * pontuação final, pausa >= `SENTENCE_PAUSE_MS` até a próxima palavra, ou
 * `SENTENCE_MAX_WORDS` palavras acumuladas. Ids sequenciais (`S0001`,
 * `S0002`…) e estáveis pra mesma entrada — o modelo referencia esses ids.
 *
 * `language` só escolhe o conjunto de pontuação final (latino × CJK).
 */
export function buildSentences(words: Word[], language = 'pt'): Sentence[] {
  const out: Sentence[] = [];
  if (!words || words.length === 0) return out;
  const endRe = /^(zh|ja|ko)/i.test(language ?? '') ? END_CJK : END_LATIN;

  let from = 0;
  for (let i = 0; i < words.length; i++) {
    const isLast = i === words.length - 1;
    const gapToNext = isLast ? Number.POSITIVE_INFINITY : words[i + 1].start - words[i].end;
    const count = i - from + 1;
    const closes =
      isLast ||
      endRe.test(words[i].text.trim()) ||
      gapToNext >= SENTENCE_PAUSE_MS ||
      count >= SENTENCE_MAX_WORDS;
    if (!closes) continue;
    out.push(makeSentence(out.length + 1, words, from, i));
    from = i + 1;
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// 4. Hash e recorte
// ───────────────────────────────────────────────────────────────────────────

/**
 * Hash estável (FNV-1a 32 bits, hex de 8 dígitos) das palavras + idioma. Serve
 * de chave de cache da análise: mesma transcrição → mesma chave, palavra
 * diferente (ou tempo diferente) → chave diferente.
 */
export function transcriptHash(words: Word[], language: string): string {
  let h = 0x811c9dc5;
  const feed = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  };
  feed(language ?? '');
  for (const w of words ?? []) {
    feed('\u0001');
    feed(w.text ?? '');
    feed('\u0002');
    feed(String(w.start));
    feed('\u0003');
    feed(String(w.end));
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Palavras que ENCOSTAM na janela `[startMs, endMs)` — usado pra montar a
 * legenda de um corte e pro refino de bordas. Palavra que termina exatamente
 * no início (ou começa exatamente no fim) fica de fora.
 */
export function wordsInRange(words: Word[], startMs: number, endMs: number): Word[] {
  if (!words || words.length === 0 || !(endMs > startMs)) return [];
  return words.filter((w) => w.end > startMs && w.start < endMs);
}
