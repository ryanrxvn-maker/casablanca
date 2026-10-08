/**
 * SMART POSITION da legenda (08.10) — PURO, testável no harness.
 *
 * Silas: *"posiciona automaticamente a legenda exatamente na dobra da tela
 * dividida; no React a legenda fica sempre no meio, exatamente no meio. E a
 * legenda da tela dividida não pode atropelar o take seguinte: ela some antes
 * do frame seguinte trocar, e não começa antecipado engolindo o take
 * anterior"*.
 *
 * Como funciona:
 *  1. Cada janela de insert vira uma REGIÃO com o alvo da legenda: a dobra de
 *     cada tela dividida (a emenda, a linha, o respiro entre os cards, o meio
 *     do degradê da mescla) ou o centro exato no React. Tela cheia não muda
 *     nada — a legenda fica onde o editor pôs.
 *  2. Bloco de legenda que ATRAVESSA a borda de uma região é cortado NA borda:
 *     a parte de antes termina no último quadro do take antigo e a de depois
 *     nasce no primeiro quadro do take novo. As palavras vão pra parte em que
 *     o MEIO delas cai. É a borda que o render usa pra trocar o quadro (a
 *     janela do insert, já encaixada no corte), então a posição nunca vaza.
 *  3. Cada bloco dentro de uma região ganha `posX/posY` no `perBlock` — o
 *     mesmo override que o editor de legendas usa. O render (drawCaptions) e o
 *     PNG do projeto editável passam pelo MESMO merge, então os dois saem
 *     iguais sem tocar no motor.
 */

import { palcoDoLayout, type LayoutInsert } from './pilot-inserts';

/** O centro da legenda (fração do quadro) num formato, ou null = não mexe. */
export function alvoDaLegendaNoLayout(layout: LayoutInsert, W: number, H: number): { posX: number; posY: number } | null {
  if (!(W > 0) || !(H > 0)) return null;
  const p = palcoDoLayout(layout, W, H);
  if (layout.tipo === 'cheia') return null;
  if (p.react) return { posX: 0.5, posY: 0.5 };
  if (p.linha) return { posX: 0.5, posY: (p.linha.y + p.linha.h / 2) / H };
  if (p.degrade) return { posX: 0.5, posY: (p.degrade.opaco + p.degrade.some) / 2 / H };
  if (!p.avatar) return null;
  // divididas: o meio do vão entre o retângulo de cima e o de baixo
  const [cima, baixo] = p.avatar.y < p.insert.y ? [p.avatar, p.insert] : [p.insert, p.avatar];
  const fimDeCima = cima.y + cima.h;
  const comecoDeBaixo = baixo.y;
  return { posX: 0.5, posY: (fimDeCima + comecoDeBaixo) / 2 / H };
}

/** Uma região do vídeo em que a legenda tem um lugar próprio. */
export type RegiaoDeLegenda = { start: number; end: number; posX: number; posY: number };

/** As regiões a partir das janelas dos inserts (s) e do formato de cada um. */
export function regioesDaLegenda(
  janelas: Array<{ id: string; start: number; end: number }>,
  layoutPorId: (id: string) => LayoutInsert | null | undefined,
  W: number,
  H: number,
): RegiaoDeLegenda[] {
  const out: RegiaoDeLegenda[] = [];
  for (const j of janelas) {
    const l = layoutPorId(j.id);
    if (!l || !(j.end > j.start)) continue;
    const alvo = alvoDaLegendaNoLayout(l, W, H);
    if (!alvo) continue;
    out.push({ start: j.start, end: j.end, ...alvo });
  }
  return out.sort((a, b) => a.start - b.start);
}

/* ════════════════════════ blocos cortados nas bordas ════════════════════════ */

type Palavra = { text: string; start: number; end: number };
type BlocoLike = { id: string; words: Palavra[]; start: number; end: number };
type EstiloLike = {
  perBlock?: Record<string, Record<string, unknown>>;
  highlights?: Record<string, number[]>;
  wordStyles?: Record<string, Record<number, unknown>>;
};

/** Pedaço mais curto que isto não é mostrado sozinho (um piscar de texto). */
export const PEDACO_MIN_MS = 160;

/**
 * Corta os blocos nas bordas das regiões e põe cada pedaço no lugar dele.
 * Blocos em ms (como o motor), regiões em s. Devolve blocos e estilo NOVOS —
 * nada do que entrou é mutado. Sem região, devolve o que entrou.
 */
export function aplicarSmartPosition<B extends BlocoLike, S extends EstiloLike>(
  blocks: B[],
  style: S,
  regioes: RegiaoDeLegenda[],
): { blocks: B[]; style: S; cortes: number; posicionados: number } {
  if (!regioes.length || !blocks.length) return { blocks, style, cortes: 0, posicionados: 0 };
  // SEM arredondar: o render compara o MESMO instante (t*1000 contra start*1000)
  // — um quadro exatamente no corte tem que cair do mesmo lado nos dois.
  const bordasMs = [...new Set(regioes.flatMap((r) => [r.start * 1000, r.end * 1000]))].sort((a, b) => a - b);
  const perBlock: Record<string, Record<string, unknown>> = { ...(style.perBlock || {}) };
  const highlights: Record<string, number[]> = { ...(style.highlights || {}) };
  const wordStyles: Record<string, Record<number, unknown>> = { ...(style.wordStyles || {}) };
  const out: B[] = [];
  let cortes = 0;

  for (const b of blocks) {
    const dentro = bordasMs.filter((x) => x > b.start && x < b.end);
    if (!dentro.length || !b.words.length) {
      out.push(b);
      continue;
    }
    // fatias de tempo: [b.start, borda1], [borda1, borda2], …, [bordaN, b.end]
    const marcos = [b.start, ...dentro, b.end];
    const fatias = marcos.slice(0, -1).map((de, i) => ({ de, ate: marcos[i + 1], idx: [] as number[] }));
    b.words.forEach((w, i) => {
      const meio = (w.start + w.end) / 2;
      let k = fatias.findIndex((f) => meio >= f.de && meio < f.ate);
      if (k < 0) k = meio < b.start ? 0 : fatias.length - 1;
      fatias[k].idx.push(i);
    });
    // pedaço curto demais (um piscar) entrega as palavras pro vizinho
    for (let k = 0; k < fatias.length; k++) {
      const f = fatias[k];
      if (!f.idx.length || f.ate - f.de >= PEDACO_MIN_MS) continue;
      const viz = k + 1 < fatias.length ? fatias[k + 1] : k > 0 ? fatias[k - 1] : null;
      if (!viz) continue;
      viz.idx = [...viz.idx, ...f.idx].sort((x, y) => x - y);
      f.idx = [];
    }
    const comPalavras = fatias.filter((f) => f.idx.length);
    if (comPalavras.length <= 1) {
      // todas as palavras numa fatia: o bloco só ENCOLHE pra ela (não vaza
      // pra região vizinha) — mantém o id, o estilo e os destaques
      const f = comPalavras[0];
      if (!f) {
        out.push(b);
        continue;
      }
      if (f.de !== b.start || f.ate !== b.end) cortes++;
      out.push({ ...b, start: f.de, end: f.ate });
      continue;
    }
    cortes++;
    comPalavras.forEach((f, n) => {
      // o id original fica com a 1ª fatia; as outras ganham `~n`
      const id = n === 0 ? b.id : `${b.id}~${n}`;
      const words = f.idx.map((i) => b.words[i]);
      out.push({ ...b, id, words, start: f.de, end: f.ate });
      const reindex = (lista: number[] | undefined) =>
        lista ? lista.filter((i) => f.idx.includes(i)).map((i) => f.idx.indexOf(i)) : undefined;
      if (style.perBlock?.[b.id]) perBlock[id] = { ...style.perBlock[b.id] };
      const h = reindex(style.highlights?.[b.id]);
      if (h) highlights[id] = h;
      const ws = style.wordStyles?.[b.id];
      if (ws) {
        const novo: Record<number, unknown> = {};
        for (const [k, v] of Object.entries(ws)) {
          const i = Number(k);
          if (f.idx.includes(i)) novo[f.idx.indexOf(i)] = v;
        }
        wordStyles[id] = novo;
      }
    });
  }

  // cada bloco dentro de uma região vai pro lugar dela
  let posicionados = 0;
  for (const b of out) {
    const meioMs = (b.start + b.end) / 2;
    const r = regioes.find((x) => meioMs >= x.start * 1000 && meioMs < x.end * 1000);
    if (!r) continue;
    perBlock[b.id] = { ...(perBlock[b.id] || {}), posX: r.posX, posY: r.posY };
    posicionados++;
  }
  return {
    blocks: out,
    style: { ...style, perBlock, highlights, wordStyles },
    cortes,
    posicionados,
  };
}
