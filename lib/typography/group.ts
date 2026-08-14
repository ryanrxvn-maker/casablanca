/**
 * Agrupamento de palavras word-level em BLOCOS de legenda (estilo CapCut:
 * blocos curtos, ritmo de fala) + utilitários de edição (retime, split,
 * merge) e serialização SRT. Tempo sempre em MILISSEGUNDOS.
 */

import type { TWord, Block } from './engine';

export type GroupPace = 'rapido' | 'equilibrado' | 'frases';

type PaceCfg = {
  maxWords: number;
  maxChars: number;
  gapMs: number; // silêncio que força bloco novo
  holdMs: number; // quanto o bloco segura na tela depois da última palavra
};

const PACES: Record<GroupPace, PaceCfg> = {
  rapido: { maxWords: 3, maxChars: 15, gapMs: 600, holdMs: 700 },
  equilibrado: { maxWords: 5, maxChars: 24, gapMs: 700, holdMs: 900 },
  frases: { maxWords: 9, maxChars: 38, gapMs: 800, holdMs: 1400 },
};

let seq = 0;
function newId(): string {
  seq += 1;
  return `b${seq.toString(36)}${(seq * 7919 % 1296).toString(36)}`;
}

/** Pontuação que fecha bloco (fim de frase). */
const SENTENCE_END = /[.!?…]$/;
/** Pontuação fraca — fecha bloco se ele já está razoavelmente cheio. */
const SOFT_BREAK = /[,;:]$/;

function cleanWordText(raw: string): string {
  // Tira pontuação "burocrática" das pontas (estilo legenda viral), mas
  // preserva ? e ! que carregam entonação. Aspas e reticências caem.
  return raw
    .trim()
    .replace(/^["'“”‘’«»(\[]+/, '')
    .replace(/["'“”‘’«»)\]]+$/, '')
    .replace(/[.,;:…]+$/, '')
    .trim();
}

function finishBlock(words: TWord[], displayEnd: number): Block {
  return {
    id: newId(),
    words,
    start: words[0].start,
    end: displayEnd,
  };
}

/**
 * Agrupa a transcrição em blocos. `words` deve vir ordenado por start.
 * O texto de cada palavra é limpo de pontuação de fim ANTES de entrar no
 * bloco — o SRT e o render usam o mesmo texto limpo (WYSIWYG).
 */
export function groupWords(rawWords: TWord[], pace: GroupPace): Block[] {
  const cfg = PACES[pace];
  const blocks: Block[] = [];
  let cur: TWord[] = [];
  let curChars = 0;

  const wordsIn = rawWords.filter((w) => w.text.trim().length > 0);

  for (let i = 0; i < wordsIn.length; i++) {
    const raw = wordsIn[i];
    const cleaned = cleanWordText(raw.text);
    if (!cleaned) continue;
    const w: TWord = { text: cleaned, start: raw.start, end: raw.end };

    if (cur.length > 0) {
      const last = cur[cur.length - 1];
      const gap = w.start - last.end;
      const nextChars = curChars + 1 + cleaned.length;
      const prevRaw = wordsIn[i - 1]?.text.trim() ?? '';
      const sentenceEnded = SENTENCE_END.test(prevRaw);
      const softBreak =
        SOFT_BREAK.test(prevRaw) && curChars >= Math.ceil(cfg.maxChars * 0.55);
      if (
        gap > cfg.gapMs ||
        sentenceEnded ||
        softBreak ||
        cur.length >= cfg.maxWords ||
        nextChars > cfg.maxChars
      ) {
        blocks.push(finishBlock(cur, last.end));
        cur = [];
        curChars = 0;
      }
    }

    cur.push(w);
    curChars += (curChars > 0 ? 1 : 0) + cleaned.length;
  }
  if (cur.length > 0) blocks.push(finishBlock(cur, cur[cur.length - 1].end));

  // Segunda passada: estica o fim de cada bloco (hold) até perto do começo
  // do próximo — legenda que pisca e some entre falas é o erro nº1.
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const next = blocks[i + 1];
    const naturalEnd = b.words[b.words.length - 1].end;
    const cap = next ? next.start - 40 : naturalEnd + cfg.holdMs;
    b.end = Math.max(naturalEnd, Math.min(naturalEnd + cfg.holdMs, cap));
  }
  return blocks;
}

export function blockText(b: Block): string {
  return b.words.map((w) => w.text).join(' ');
}

/**
 * Reaplica um texto editado ao bloco redistribuindo os tempos por peso de
 * caracteres (mantém start/end do bloco). Usado quando o user corrige a
 * transcrição na mão.
 */
export function retimeBlockText(b: Block, newText: string): Block {
  const parts = newText
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (parts.length === 0) return b;

  const spoken = b.words[b.words.length - 1].end - b.words[0].start;
  const t0 = b.words[0].start;
  const totalChars = parts.reduce((s, p) => s + p.length, 0);
  let acc = 0;
  const words: TWord[] = parts.map((text) => {
    const start = t0 + (acc / totalChars) * spoken;
    acc += text.length;
    const end = t0 + (acc / totalChars) * spoken;
    return { text, start: Math.round(start), end: Math.round(end) };
  });
  return { ...b, words };
}

/** Divide o bloco na fronteira de palavra mais próxima do meio (em chars). */
export function splitBlock(b: Block): [Block, Block] | null {
  if (b.words.length < 2) return null;
  const total = b.words.reduce((s, w) => s + w.text.length, 0);
  let acc = 0;
  let cut = 1;
  for (let i = 0; i < b.words.length - 1; i++) {
    acc += b.words[i].text.length;
    if (acc >= total / 2) {
      cut = i + 1;
      break;
    }
  }
  const first = b.words.slice(0, cut);
  const second = b.words.slice(cut);
  const a: Block = {
    id: newId(),
    words: first,
    start: b.start,
    end: second[0].start - 40,
  };
  const c: Block = {
    id: newId(),
    words: second,
    start: second[0].start,
    end: b.end,
  };
  if (a.end <= a.start) a.end = first[first.length - 1].end;
  return [a, c];
}

export function mergeBlocks(a: Block, b: Block): Block {
  return {
    id: newId(),
    words: [...a.words, ...b.words],
    start: a.start,
    end: b.end,
  };
}

function msToSrtTime(ms: number): string {
  const t = Math.max(0, Math.round(ms));
  const h = Math.floor(t / 3_600_000);
  const m = Math.floor((t % 3_600_000) / 60_000);
  const s = Math.floor((t % 60_000) / 1000);
  const mi = t % 1000;
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(mi, 3)}`;
}

export function blocksToSrt(blocks: Block[]): string {
  return blocks
    .map(
      (b, i) =>
        `${i + 1}\n${msToSrtTime(b.start)} --> ${msToSrtTime(b.end)}\n${blockText(b)}\n`,
    )
    .join('\n');
}
