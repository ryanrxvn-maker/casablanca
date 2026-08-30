/**
 * ROTEIRO DE LEGENDA — hook e body com letterings DIFERENTES no mesmo vídeo.
 *
 * O criativo padrão do B2C/DR MILLION quer o HOOK num modelo (ex.: Vermelho
 * Sangue, 120%, altura 50%) e o BODY em outro (ex.: Keynote, 100%, altura
 * 70%) — e às vezes o body dividido em partes, cada uma com a sua legenda.
 * Antes isso era feito na mão, bloco a bloco, com o cadeado.
 *
 * Aqui o roteiro é DADO: uma lista de trechos, cada um com o texto da copy (ou
 * um número de palavras) e o estilo que deve valer nele. O módulo:
 *
 *   1. conta as palavras de cada trecho ignorando token que é só pontuação
 *      (um travessão solto no meio do hook inflava a conta em 1 e travava um
 *      bloco a mais — armadilha real do lote de 17.08);
 *   2. casa essa contagem com os blocos da legenda, dizendo onde cada trecho
 *      começa e termina — e se a fronteira caiu EXATAMENTE numa virada de
 *      bloco ou no meio de um;
 *   3. aplica, gravando um override por bloco (que é o que o engine respeita)
 *      e fechando o cadeado deles — opcionalmente PARTINDO o bloco na palavra
 *      exata quando a fronteira caiu no meio.
 *
 * Tudo função pura: `lib/typography/caption-script.test.ts`.
 */

import type { Block, PerBlockStyle } from './engine';
import {
  splitAtWordKeepingIdentity,
  type BlockIdentity,
  type BlocksAndIdentity,
} from './blocks-edit';

export type SegKind = 'hook' | 'body';

export type CaptionSegment = {
  id: string;
  kind: SegKind;
  /** rótulo mostrado na janelinha ("Hook", "Body 1"...) */
  label: string;
  /** copy do trecho; vazio + `words: null` = "o resto do vídeo" */
  text: string;
  /** contagem manual de palavras (vence o texto); null = derivar do texto */
  words: number | null;
  style: PerBlockStyle;
};

export type CaptionTemplate = {
  id: string;
  name: string;
  /** vem de fábrica (não dá pra apagar) */
  builtin?: boolean;
  hint?: string;
  segments: Array<Pick<CaptionSegment, 'kind' | 'label' | 'style'>>;
};

/* ─────────────────────────── contagem de palavras ─────────────────────── */

const HAS_ALNUM = /[\p{L}\p{N}]/u;

/**
 * Palavras "de verdade" de um trecho de copy. Token sem letra nem número
 * (travessão, reticências, aspas soltas) NÃO conta — foi exatamente isso que
 * empurrou a fronteira do hook um bloco pra frente no lote de 17.08.
 */
export function scriptWords(text: string): string[] {
  return text
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && HAS_ALNUM.test(t));
}

export function countScriptWords(text: string): number {
  return scriptWords(text).length;
}

/** Quantas palavras o trecho pede (null = "o resto"). */
export function segmentDemand(seg: CaptionSegment): number | null {
  if (seg.words != null && Number.isFinite(seg.words)) {
    return Math.max(0, Math.round(seg.words));
  }
  const n = countScriptWords(seg.text);
  return n > 0 ? n : null;
}

/* ──────────────────────────────── resolução ───────────────────────────── */

export type ResolvedSegment = {
  seg: CaptionSegment;
  /** índice do 1º e do último bloco (inclusive). -1/-1 = não coube nada */
  from: number;
  to: number;
  blockIds: string[];
  startMs: number;
  endMs: number;
  /** palavras que o trecho pediu (null = "o resto") */
  demand: number | null;
  /** palavras que os blocos escolhidos realmente somam */
  got: number;
  /** a fronteira caiu numa virada de bloco? */
  exact: boolean;
  /**
   * Corte sugerido quando NÃO foi exato: partir este bloco antes desta
   * palavra deixa a fronteira no lugar certo.
   */
  cut: { blockId: string; wordIndex: number } | null;
};

export type ResolvedScript = {
  segments: ResolvedSegment[];
  /** blocos que nenhum trecho cobriu (seguem no estilo global) */
  leftover: number;
  totalWords: number;
};

/**
 * Casa os trechos do roteiro com os blocos da legenda, na ordem.
 *
 * A fronteira só pode cair numa virada de bloco: quando a contagem termina no
 * meio de um bloco, o trecho leva o bloco inteiro **só se isso for mais perto
 * do pedido** do que deixá-lo pro trecho seguinte — e o corte exato vira uma
 * sugestão (`cut`) que a UI oferece aplicar.
 */
export function resolveCaptionScript(
  blocks: Block[],
  segments: CaptionSegment[],
): ResolvedScript {
  const counts = blocks.map((b) => b.words.length);
  const totalWords = counts.reduce((s, n) => s + n, 0);
  const out: ResolvedSegment[] = [];
  let bi = 0; // próximo bloco livre

  segments.forEach((seg, si) => {
    const demand = segmentDemand(seg);
    const isLast = si === segments.length - 1;
    if (bi >= blocks.length) {
      out.push({
        seg, from: -1, to: -1, blockIds: [], startMs: 0, endMs: 0,
        demand, got: 0, exact: demand === null, cut: null,
      });
      return;
    }
    // Trecho sem copy e sem contagem: so' o ULTIMO leva "todo o resto". Um
    // hook ainda vazio nao pode engolir o video inteiro so' porque o user
    // abriu a janelinha e ainda nao colou nada.
    if (demand === null && !isLast) {
      out.push({
        seg, from: -1, to: -1, blockIds: [], startMs: 0, endMs: 0,
        demand: null, got: 0, exact: true, cut: null,
      });
      return;
    }
    // "o resto": leva tudo que sobrou
    if (demand === null) {
      const from = bi;
      const to = blocks.length - 1;
      bi = blocks.length;
      out.push({
        seg, from, to,
        blockIds: blocks.slice(from, to + 1).map((b) => b.id),
        startMs: blocks[from].start,
        endMs: blocks[to].end,
        demand: null,
        got: counts.slice(from, to + 1).reduce((s, n) => s + n, 0),
        exact: true,
        cut: null,
      });
      return;
    }

    const from = bi;
    let acc = 0;
    let i = bi;
    while (i < blocks.length && acc + counts[i] <= demand) {
      acc += counts[i];
      i++;
    }
    // i = 1º bloco que estoura (ou fim). acc = palavras se pararmos antes dele
    let to = i - 1;
    let got = acc;
    let cut: ResolvedSegment['cut'] = null;
    let exact = acc === demand;

    if (!exact && i < blocks.length) {
      const faltam = demand - acc; // 1..counts[i]-1
      cut = { blockId: blocks[i].id, wordIndex: faltam };
      const sobrariam = counts[i] - faltam;
      // levar o bloco inteiro erra por `sobrariam`; deixá-lo erra por `faltam`
      if (sobrariam < faltam || to < from) {
        to = i;
        got = acc + counts[i];
      }
    } else if (!exact && i >= blocks.length) {
      // pediu mais palavras do que existe — leva o que tem
      to = blocks.length - 1;
      got = counts.slice(from, to + 1).reduce((s, n) => s + n, 0);
    }

    if (to < from) {
      // o 1º bloco já estoura sozinho e ficou mais perto deixá-lo pro próximo:
      // ainda assim o trecho precisa de ao menos um bloco pra existir
      to = from;
      got = counts[from];
    }
    bi = to + 1;
    exact = got === demand;
    out.push({
      seg, from, to,
      blockIds: blocks.slice(from, to + 1).map((b) => b.id),
      startMs: blocks[from].start,
      endMs: blocks[to].end,
      demand, got, exact,
      cut: exact ? null : cut,
    });
  });

  return { segments: out, leftover: Math.max(0, blocks.length - bi), totalWords };
}

/* ──────────────────────────────── aplicação ───────────────────────────── */

export type ApplyResult = BlocksAndIdentity & {
  /** blocos que receberam o estilo de algum trecho */
  styled: number;
  /** quantos blocos foram partidos pra fronteira ficar exata */
  splits: number;
  resolved: ResolvedScript;
};

/**
 * Aplica o roteiro: grava o estilo de cada trecho como override dos blocos
 * dele e fecha o cadeado — é o override por bloco que o engine respeita, e o
 * cadeado é a alça visível pro user soltar depois.
 *
 * Com `splitAtBoundary`, os blocos onde a fronteira caiu no meio são partidos
 * na palavra exata ANTES de aplicar (levando destaque e estilo por palavra
 * junto), então hook e body terminam exatamente onde a copy diz.
 */
export function applyCaptionScript(
  blocks: Block[],
  segments: CaptionSegment[],
  ident: BlockIdentity,
  opts?: { splitAtBoundary?: boolean; lock?: boolean },
): ApplyResult {
  const splitAtBoundary = opts?.splitAtBoundary !== false;
  const lock = opts?.lock !== false;

  let curBlocks = blocks;
  let curIdent: BlockIdentity = {
    locked: [...ident.locked],
    blockStyles: { ...ident.blockStyles },
    wordStyles: { ...ident.wordStyles },
    highlights: { ...ident.highlights },
  };
  let splits = 0;

  if (splitAtBoundary) {
    // um corte por passada: cada split muda os índices, então re-resolvemos.
    // teto = nº de trechos (cada fronteira é cortada no máximo uma vez)
    for (let guard = 0; guard < segments.length + 2; guard++) {
      const r = resolveCaptionScript(curBlocks, segments);
      const pending = r.segments.find((s) => s.cut && !s.exact);
      if (!pending || !pending.cut) break;
      const done = splitAtWordKeepingIdentity(
        curBlocks,
        pending.cut.blockId,
        pending.cut.wordIndex,
        curIdent,
      );
      if (!done) break;
      curBlocks = done.blocks;
      curIdent = {
        locked: done.locked,
        blockStyles: done.blockStyles,
        wordStyles: done.wordStyles,
        highlights: done.highlights,
      };
      splits++;
    }
  }

  const resolved = resolveCaptionScript(curBlocks, segments);
  const nextStyles = { ...curIdent.blockStyles };
  const nextLocked = new Set(curIdent.locked);
  let styled = 0;
  for (const rs of resolved.segments) {
    for (const id of rs.blockIds) {
      nextStyles[id] = { ...nextStyles[id], ...rs.seg.style };
      if (lock) nextLocked.add(id);
      styled++;
    }
  }

  return {
    blocks: curBlocks,
    locked: Array.from(nextLocked),
    blockStyles: nextStyles,
    wordStyles: curIdent.wordStyles,
    highlights: curIdent.highlights,
    styled,
    splits,
    resolved,
  };
}

/* ─────────────────────────── templates de fábrica ─────────────────────── */

/**
 * Template 1 — o que já rodava na mão: hook em Vermelho Sangue centralizado
 * (120% / altura 50%) e body em Keynote (100% / altura 70%). Receita do lote
 * WL PL de 17.08.2026.
 */
export const TEMPLATE_1: CaptionTemplate = {
  id: 'tpl-1',
  name: 'Template 1',
  builtin: true,
  hint: 'Hook Vermelho Sangue no meio · Body Keynote embaixo',
  segments: [
    {
      kind: 'hook',
      label: 'Hook',
      style: { presetId: 'vermelho-sangue', fontScale: 1.2, posY: 0.5, posX: 0.5 },
    },
    {
      kind: 'body',
      label: 'Body',
      style: { presetId: 'keynote', fontScale: 1, posY: 0.7, posX: 0.5 },
    },
  ],
};

/**
 * Template 2 — hook na viral Extensão Script (o mix script vermelho + caps
 * do print aprovado em 30.08) e body em Faixa Suave, que é o que salva
 * quando a cena é clara demais (roupa/cozinha branca): o Keynote é texto
 * branco puro e SOME; a pílula escura do Faixa Suave lê.
 */
export const TEMPLATE_2: CaptionTemplate = {
  id: 'tpl-2',
  name: 'Template 2',
  builtin: true,
  hint: 'Hook Extensão Script · Body Faixa Suave (cena clara)',
  segments: [
    {
      kind: 'hook',
      label: 'Hook',
      style: { presetId: 'extensao-script', fontScale: 1.2, posY: 0.5, posX: 0.5 },
    },
    {
      kind: 'body',
      label: 'Body',
      style: { presetId: 'faixa-suave', fontScale: 1, posY: 0.7, posX: 0.5 },
    },
  ],
};

export const BUILTIN_TEMPLATES: CaptionTemplate[] = [TEMPLATE_1, TEMPLATE_2];

let segSeq = 0;
export function newSegmentId(): string {
  segSeq += 1;
  return `seg${segSeq.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

/** Rótulos "Hook", "Body 1", "Body 2"... na ordem (1 body só = "Body"). */
export function relabelSegments(segs: CaptionSegment[]): CaptionSegment[] {
  const bodies = segs.filter((s) => s.kind === 'body').length;
  let n = 0;
  return segs.map((s) => {
    if (s.kind === 'hook') return { ...s, label: 'Hook' };
    n += 1;
    return { ...s, label: bodies > 1 ? `Body ${n}` : 'Body' };
  });
}

/**
 * Transforma um template em trechos editáveis, PRESERVANDO os textos que o
 * user já digitou (casando por posição) — trocar de template não pode apagar
 * a copy colada.
 */
export function templateToSegments(
  tpl: CaptionTemplate,
  keepFrom: CaptionSegment[] = [],
): CaptionSegment[] {
  const segs = tpl.segments.map((s, i) => ({
    id: newSegmentId(),
    kind: s.kind,
    label: s.label,
    text: keepFrom[i]?.text ?? '',
    words: keepFrom[i]?.words ?? null,
    style: { ...s.style },
  }));
  // o user já tinha MAIS trechos que o template: os extras seguem com a copy,
  // herdando o estilo do último trecho do template
  if (keepFrom.length > segs.length) {
    const tail = tpl.segments[tpl.segments.length - 1];
    for (let i = segs.length; i < keepFrom.length; i++) {
      segs.push({
        id: newSegmentId(),
        kind: keepFrom[i].kind,
        label: keepFrom[i].label,
        text: keepFrom[i].text,
        words: keepFrom[i].words,
        style: { ...tail.style },
      });
    }
  }
  return relabelSegments(segs);
}

/** Roteiro em branco (1 hook + 1 body) a partir do Template 1. */
export function defaultSegments(): CaptionSegment[] {
  return templateToSegments(TEMPLATE_1);
}

/** O roteiro atual virando template salvável (sem os textos da copy). */
export function segmentsToTemplate(
  segs: CaptionSegment[],
  name: string,
  id: string,
): CaptionTemplate {
  return {
    id,
    name,
    segments: segs.map((s) => ({ kind: s.kind, label: s.label, style: { ...s.style } })),
  };
}
