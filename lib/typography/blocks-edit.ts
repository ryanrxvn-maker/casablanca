/**
 * EDIÇÃO DE BLOCOS QUE NÃO PERDE O TRABALHO DO USUÁRIO.
 *
 * O editor da Tipografia guarda quatro coisas indexadas pelo **id do bloco**:
 *
 *   • `locked`      — blocos com o cadeado fechado (visual congelado)
 *   • `blockStyles` — override de estilo por bloco (vence o global no engine)
 *   • `wordStyles`  — override por PALAVRA (indexado por posição na frase)
 *   • `highlights`  — palavras pintadas de destaque (também por posição)
 *
 * Toda operação que **cunha um id novo** (trocar o ritmo, dividir, juntar)
 * apagava esses quatro mapas de uma vez: o cadeado do user abria sozinho e a
 * mudança caía em cima de tudo. Este módulo faz o contrário — carrega a
 * identidade junto com o bloco:
 *
 *   • `regroupKeepingLocks` — remonta SÓ o que não está travado; bloco com
 *     cadeado sai intacto (palavras, tempo, id, estilo) do outro lado;
 *   • `splitKeepingIdentity` / `mergeKeepingIdentity` — as metades (ou a
 *     junção) herdam estilo, cadeado, destaques e estilos por palavra, com os
 *     índices de palavra REMAPEADOS pro novo bloco;
 *   • `removeKeepingIdentity` / `pruneIdentity` — varre os órfãos, pra sessão
 *     salva não crescer com entradas de bloco que não existe mais.
 *
 * É tudo função pura (nada de React/DOM) justamente pra ser testável:
 * `lib/typography/blocks-edit.test.ts`.
 */

import type { Block, PerBlockStyle, TWord, WordStyle } from './engine';
import { groupWords, mintBlockId, type GroupPace } from './group';

/** Os quatro mapas indexados por id de bloco que o editor mantém. */
export type BlockIdentity = {
  locked: string[];
  blockStyles: Record<string, PerBlockStyle>;
  wordStyles: Record<string, Record<number, WordStyle>>;
  highlights: Record<string, number[]>;
};

export type BlocksAndIdentity = BlockIdentity & { blocks: Block[] };

/** Folga mínima entre o fim de um bloco e o começo do próximo (ms). */
const GAP_MS = 40;

export function emptyIdentity(): BlockIdentity {
  return { locked: [], blockStyles: {}, wordStyles: {}, highlights: {} };
}

/* ─────────────────────────── helpers de identidade ────────────────────── */

function pickIdentity(ident: BlockIdentity, id: string) {
  return {
    locked: ident.locked.includes(id),
    style: ident.blockStyles[id],
    words: ident.wordStyles[id],
    highlights: ident.highlights[id],
  };
}

/**
 * Copia a identidade de `from` pra `to`, deslocando os índices de palavra em
 * `shift` e descartando o que cair fora de `[0, wordCount)`.
 */
function carryIdentity(
  out: BlockIdentity,
  src: BlockIdentity,
  from: string,
  to: string,
  shift: number,
  wordCount: number,
): void {
  const s = pickIdentity(src, from);
  if (s.locked && !out.locked.includes(to)) out.locked.push(to);
  if (s.style) out.blockStyles[to] = { ...out.blockStyles[to], ...s.style };
  if (s.words) {
    const dst = { ...(out.wordStyles[to] ?? {}) };
    for (const [k, v] of Object.entries(s.words)) {
      const i = Number(k) + shift;
      if (i >= 0 && i < wordCount) dst[i] = { ...dst[i], ...v };
    }
    if (Object.keys(dst).length > 0) out.wordStyles[to] = dst;
  }
  if (s.highlights) {
    const moved = s.highlights
      .map((i) => i + shift)
      .filter((i) => i >= 0 && i < wordCount);
    if (moved.length > 0) {
      const merged = new Set([...(out.highlights[to] ?? []), ...moved]);
      out.highlights[to] = Array.from(merged).sort((a, b) => a - b);
    }
  }
}

/**
 * Apaga do mapa de identidade tudo que não aponta mais pra um bloco vivo —
 * e, nos blocos vivos, os índices de palavra que passaram do fim do texto.
 */
export function pruneIdentity(blocks: Block[], ident: BlockIdentity): BlockIdentity {
  const alive = new Map(blocks.map((b) => [b.id, b.words.length]));
  const out: BlockIdentity = emptyIdentity();
  out.locked = ident.locked.filter((id) => alive.has(id));
  for (const [id, st] of Object.entries(ident.blockStyles)) {
    if (alive.has(id)) out.blockStyles[id] = st;
  }
  for (const [id, ws] of Object.entries(ident.wordStyles)) {
    const n = alive.get(id);
    if (n === undefined) continue;
    const keep: Record<number, WordStyle> = {};
    for (const [k, v] of Object.entries(ws)) {
      if (Number(k) >= 0 && Number(k) < n) keep[Number(k)] = v;
    }
    if (Object.keys(keep).length > 0) out.wordStyles[id] = keep;
  }
  for (const [id, hl] of Object.entries(ident.highlights)) {
    const n = alive.get(id);
    if (n === undefined) continue;
    const keep = hl.filter((i) => i >= 0 && i < n);
    if (keep.length > 0) out.highlights[id] = keep;
  }
  return out;
}

/* ───────────────────────────── trocar o RITMO ─────────────────────────── */

/** Janela FALADA do bloco (ignora o hold de exibição). */
function spokenSpan(b: Block): { a: number; z: number } {
  return { a: b.words[0].start, z: b.words[b.words.length - 1].end };
}

/** A palavra está majoritariamente dentro da janela? */
function insideSpan(w: TWord, span: { a: number; z: number }): boolean {
  const overlap = Math.min(w.end, span.z) - Math.max(w.start, span.a);
  if (overlap <= 0) return false;
  const len = Math.max(1, w.end - w.start);
  return overlap >= len * 0.5 || overlap >= 1;
}

export type RegroupResult = BlocksAndIdentity & {
  /** quantos blocos saíram intactos por estarem travados */
  kept: number;
  /** quantos blocos foram remontados no ritmo novo */
  remade: number;
};

/**
 * Remonta os blocos no ritmo `pace` **preservando os travados**.
 *
 * Cada bloco com cadeado vira uma janela protegida na linha do tempo: as
 * palavras da transcrição que caem dentro dela não entram no reagrupamento, e
 * o bloco sai do outro lado com o MESMO id (logo, com o mesmo estilo, cadeado,
 * destaques e estilos por palavra). Os trechos livres entre um travado e outro
 * são reagrupados de forma independente, no ritmo novo.
 *
 * A única coisa que um bloco travado pode perder é alguns ms do *hold* — e só
 * quando ele passaria por cima do bloco seguinte, caso em que o engine
 * simplesmente não desenharia o próximo (ele para no primeiro bloco cuja
 * janela contém o tempo). Palavras, id e estilo nunca mudam.
 */
export function regroupKeepingLocks(
  rawWords: TWord[],
  pace: GroupPace,
  blocks: Block[],
  ident: BlockIdentity,
): RegroupResult {
  const lockedSet = new Set(ident.locked);
  const keep = blocks
    .filter((b) => lockedSet.has(b.id) && b.words.length > 0)
    .slice()
    .sort((a, b) => a.start - b.start);

  if (keep.length === 0) {
    const next = groupWords(rawWords, pace);
    return { blocks: next, ...emptyIdentity(), kept: 0, remade: next.length };
  }

  const spans = keep.map(spokenSpan);
  const out: Block[] = [];
  let free: TWord[] = [];
  let remade = 0;
  const emitted = new Set<number>();

  const flushFree = () => {
    if (free.length === 0) return;
    const grouped = groupWords(free, pace);
    remade += grouped.length;
    out.push(...grouped);
    free = [];
  };

  for (const w of rawWords) {
    if (!w.text.trim()) continue;
    let hit = -1;
    for (let i = 0; i < spans.length; i++) {
      if (insideSpan(w, spans[i])) {
        hit = i;
        break;
      }
    }
    if (hit < 0) {
      free.push(w);
      continue;
    }
    flushFree();
    if (!emitted.has(hit)) {
      emitted.add(hit);
      out.push(keep[hit]);
    }
  }
  flushFree();

  // Travado que não casou com nenhuma palavra (texto reescrito na mão, por
  // exemplo) entra pela posição no tempo — não pode sumir por causa disso.
  for (let i = 0; i < keep.length; i++) {
    if (emitted.has(i)) continue;
    const b = keep[i];
    const at = out.findIndex((o) => o.start > b.start);
    out.splice(at < 0 ? out.length : at, 0, b);
  }

  out.sort((a, b) => a.start - b.start);
  const clamped = clampOverlaps(out, lockedSet);
  const nextIdent = pruneIdentity(clamped, ident);
  return { blocks: clamped, ...nextIdent, kept: keep.length, remade };
}

/**
 * Garante que nenhum bloco invada o começo do próximo. Encolhe primeiro o
 * bloco LIVRE (é o descartável); só mexe no hold de um travado quando ele
 * esconderia o próximo por inteiro — e nunca antes da última palavra falada.
 */
function clampOverlaps(blocks: Block[], lockedSet: Set<string>): Block[] {
  const out = blocks.map((b) => ({ ...b }));
  for (let i = 0; i < out.length - 1; i++) {
    const cur = out[i];
    const next = out[i + 1];
    if (cur.end <= next.start) continue;
    const floor = cur.words[cur.words.length - 1].end;
    const target = Math.max(floor, next.start - GAP_MS);
    if (!lockedSet.has(cur.id) || target < cur.end) cur.end = target;
    // ainda cobrindo o próximo inteiro (travado que foi esticado na mão):
    // o próximo nunca apareceria — então o travado cede o hold que sobra
    if (cur.end > next.start) cur.end = Math.max(next.start - GAP_MS, cur.start + 1);
  }
  return out;
}

/* ───────────────────────────── dividir / juntar ───────────────────────── */

export type SplitResult = BlocksAndIdentity & { firstId: string; secondId: string } | null;

/**
 * Divide o bloco na fronteira de palavra mais próxima do meio, levando a
 * identidade junto: as duas metades nascem com o estilo e o cadeado do pai, e
 * destaques/estilos por palavra vão cada um pra metade certa (índices
 * remapeados). Antes disso, dividir um bloco travado o destravava calado.
 */
export function splitKeepingIdentity(
  blocks: Block[],
  id: string,
  ident: BlockIdentity,
): SplitResult {
  const b = blocks.find((x) => x.id === id);
  if (!b || b.words.length < 2) return null;
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
  return splitAtWordKeepingIdentity(blocks, id, cut, ident);
}

/**
 * Divide o bloco ANTES da palavra de índice `cut`, levando a identidade
 * junto. É o motor do botão de tesoura e também de "cortar na palavra exata"
 * do roteiro de legenda (hook × body).
 */
export function splitAtWordKeepingIdentity(
  blocks: Block[],
  id: string,
  cut: number,
  ident: BlockIdentity,
): SplitResult {
  const idx = blocks.findIndex((b) => b.id === id);
  if (idx < 0) return null;
  const b = blocks[idx];
  if (cut < 1 || cut > b.words.length - 1) return null;

  const firstWords = b.words.slice(0, cut);
  const secondWords = b.words.slice(cut);
  const first: Block = {
    id: mintBlockId(),
    words: firstWords,
    start: b.start,
    end: Math.max(firstWords[firstWords.length - 1].end, secondWords[0].start - GAP_MS),
  };
  const second: Block = {
    id: mintBlockId(),
    words: secondWords,
    start: secondWords[0].start,
    end: Math.max(b.end, secondWords[secondWords.length - 1].end),
  };

  const out = pruneIdentity(
    blocks.map((x) => x),
    ident,
  );
  carryIdentity(out, ident, id, first.id, 0, first.words.length);
  carryIdentity(out, ident, id, second.id, -cut, second.words.length);
  // o pai morreu — tira o que era dele
  const next = blocks.slice();
  next.splice(idx, 1, first, second);
  const cleaned = pruneIdentity(next, out);
  return { blocks: next, ...cleaned, firstId: first.id, secondId: second.id };
}

export type MergeResult = BlocksAndIdentity & { mergedId: string } | null;

/**
 * Junta o bloco com o seguinte. O resultado herda o estilo do PRIMEIRO (com
 * o do segundo preenchendo só o que o primeiro não define) e fica travado se
 * qualquer um dos dois estava — destaques e estilos por palavra do segundo
 * entram deslocados pelo tamanho do primeiro.
 */
export function mergeKeepingIdentity(
  blocks: Block[],
  id: string,
  ident: BlockIdentity,
): MergeResult {
  const idx = blocks.findIndex((b) => b.id === id);
  if (idx < 0 || idx >= blocks.length - 1) return null;
  const a = blocks[idx];
  const b = blocks[idx + 1];
  const merged: Block = {
    id: mintBlockId(),
    words: [...a.words, ...b.words],
    start: a.start,
    end: b.end,
  };
  const next = blocks.slice();
  next.splice(idx, 2, merged);

  const out = pruneIdentity(next, ident);
  // o segundo entra primeiro pra que, num conflito de chave, o estilo do
  // PRIMEIRO (aplicado depois) seja o que fica
  carryIdentity(out, ident, b.id, merged.id, a.words.length, merged.words.length);
  carryIdentity(out, ident, a.id, merged.id, 0, merged.words.length);
  if (ident.blockStyles[a.id]) {
    out.blockStyles[merged.id] = {
      ...ident.blockStyles[b.id],
      ...ident.blockStyles[a.id],
    };
  }
  return { blocks: next, ...pruneIdentity(next, out), mergedId: merged.id };
}

/** Remove o bloco e limpa o que ficou órfão nos quatro mapas. */
export function removeKeepingIdentity(
  blocks: Block[],
  id: string,
  ident: BlockIdentity,
): BlocksAndIdentity {
  const next = blocks.filter((b) => b.id !== id);
  return { blocks: next, ...pruneIdentity(next, ident) };
}
