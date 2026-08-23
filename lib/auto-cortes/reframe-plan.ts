/**
 * AUTO CORTES — planejador PURO de reenquadro (sem DOM, sem timers).
 *
 * Entra: amostras de rosto (5 fps) + histogramas de luminância da MESMA
 * passada; sai: um `CropPlan` determinístico em coordenadas NORMALIZADAS da
 * fonte (0..1). Nada aqui toca canvas/vídeo — a parte de DOM mora em
 * `reframe.ts`, e é isso que deixa o planner testável no `npm test`.
 *
 * Regras (docs/auto-cortes/ARQUITETURA.md §3.4):
 *  - tracks associados por IoU > 0,3; track vivo = aparece em >= 40 % das amostras;
 *  - zona morta de 8 % da largura do crop (8 % da altura no eixo Y) — jitter do
 *    detector não pode fazer o enquadro tremer;
 *  - headroom: o rosto fica no TERÇO SUPERIOR do crop, não no meio;
 *  - suavização exponencial com tau 0,5 s e velocidade máxima 0,25·W/s;
 *  - corte de cena (diferença de histograma > 0,45) = SALTO instantâneo,
 *    porque deslizar por cima de um corte parece defeito;
 *  - `auto`: 1 track -> seguir · 2 tracks estáveis e distantes -> dividir ·
 *    nenhum -> centro;
 *  - aspecto alvo igual ao da fonte -> `none` (não mexe em nada);
 *  - `ajustar` -> `fit` (o compositor põe o vídeo inteiro sobre fundo desfocado).
 *
 * IMPORTANTE (por que os tipos estão duplicados aqui): este arquivo compila
 * SOZINHO no `npm test` (`tsc reframe-plan.ts reframe.test.ts ...`), e nesse
 * modo o tsc não resolve o alias `@/`. Como `lib/auto-cortes/types.ts` importa
 * `@/lib/typography/engine`, importar dele quebraria o teste. Então o contrato
 * é ESPELHADO aqui e a equivalência com `types.ts` fica travada por asserção
 * de tipo em `reframe.ts` (divergiu = erro no `tsc --noEmit`).
 */

// ───────────────────────────────────────────────────────────────────────────
// Espelho estrutural do contrato (lib/auto-cortes/types.ts)
// ───────────────────────────────────────────────────────────────────────────

export type NormBox = { x: number; y: number; w: number; h: number };
export type FaceBox = NormBox & { score: number };
export type FaceSample = { tSec: number; faces: FaceBox[] };
export type CropKeyframe = { tSec: number; box: NormBox };
export type AspectRatio = '9:16' | '4:5' | '1:1' | '16:9';
export type ReframeMode = 'auto' | 'seguir' | 'dividir' | 'centro' | 'ajustar';

export type CropPlan =
  | { layout: 'single'; mode: Exclude<ReframeMode, 'auto' | 'dividir'>; keyframes: CropKeyframe[] }
  | { layout: 'split'; tracks: [CropKeyframe[], CropKeyframe[]] }
  | { layout: 'fit' }
  | { layout: 'none' };

/** Histograma de luminância de uma amostra (16 bins, soma 1). */
export type HistSample = { tSec: number; hist: number[] };

export type PlanCropOptions = {
  srcW: number;
  srcH: number;
  aspect: AspectRatio;
  mode: ReframeMode;
};

// ───────────────────────────────────────────────────────────────────────────
// Constantes do planner (exportadas: o teste trava os números)
// ───────────────────────────────────────────────────────────────────────────

/** proporção (largura/altura) de cada saída — espelha ASPECT_OUTPUT */
export const ASPECT_AR: Record<AspectRatio, number> = {
  '9:16': 1080 / 1920,
  '4:5': 1080 / 1350,
  '1:1': 1,
  '16:9': 1920 / 1080,
};

/** nº de bins do histograma de luminância */
export const HIST_BINS = 16;
/** diferença de histograma que caracteriza corte de cena */
export const SCENE_CUT_DIFF = 0.45;
/** IoU mínimo pra dizer que duas caixas são a MESMA pessoa */
export const IOU_MIN = 0.3;
/** fração das amostras em que o track precisa aparecer pra contar como vivo */
export const TRACK_ALIVE_RATIO = 0.4;
/** zona morta: fração do tamanho do crop que o alvo pode andar sem mover nada */
export const DEAD_ZONE = 0.08;
/** constante de tempo da suavização exponencial (s) */
export const SMOOTH_TAU_SEC = 0.5;
/** velocidade máxima do crop, em larguras da FONTE por segundo */
export const VMAX_PER_SEC = 0.25;
/** distância horizontal mínima entre 2 rostos pra virar tela dividida */
export const SPLIT_MIN_DX = 0.35;
/** desvio-padrão máximo do centro X pra considerar um track "estável" */
export const SPLIT_MAX_STDX = 0.08;
/** o rosto fica a 1/3 do topo do crop (headroom) */
export const HEADROOM = 1 / 3;
/** tolerância de aspecto pra considerar fonte e saída iguais */
export const ASPECT_EPS = 0.01;
/** erro máximo (normalizado) tolerado ao simplificar keyframes */
export const SIMPLIFY_EPS = 0.0015;

// ───────────────────────────────────────────────────────────────────────────
// Utilitários geométricos
// ───────────────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  if (hi < lo) return lo;
  return v < lo ? lo : v > hi ? hi : v;
}

export function iou(a: NormBox, b: NormBox): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const iw = x2 - x1;
  const ih = y2 - y1;
  if (iw <= 0 || ih <= 0) return 0;
  const inter = iw * ih;
  const uni = a.w * a.h + b.w * b.h - inter;
  return uni <= 0 ? 0 : inter / uni;
}

/**
 * Tamanho do crop (normalizado na fonte) que preenche a saída sem barra preta:
 * o lado "sobrando" é cortado, o outro fica inteiro.
 */
export function cropSizeFor(srcAR: number, outAR: number): { cw: number; ch: number } {
  if (outAR < srcAR) {
    // saída mais estreita que a fonte (9:16 saindo de 16:9): altura inteira
    return { cw: clamp(outAR / srcAR, 0.02, 1), ch: 1 };
  }
  // saída mais larga que a fonte: largura inteira
  return { cw: 1, ch: clamp(srcAR / outAR, 0.02, 1) };
}

function boxFromCenter(cx: number, cy: number, cw: number, ch: number): NormBox {
  const x = clamp(cx - cw / 2, 0, Math.max(0, 1 - cw));
  const y = clamp(cy - ch / 2, 0, Math.max(0, 1 - ch));
  return { x, y, w: cw, h: ch };
}

function centeredBox(cw: number, ch: number): NormBox {
  return boxFromCenter(0.5, 0.5, cw, ch);
}

// ───────────────────────────────────────────────────────────────────────────
// Corte de cena por histograma
// ───────────────────────────────────────────────────────────────────────────

/** Distância de variação total entre dois histogramas normalizados (0..1). */
export function histDiff(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) s += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
  return s / 2;
}

/**
 * Instantes (segundos, no relógio das amostras) em que a imagem TROCOU.
 * Amostra cujo histograma difere mais que `threshold` da anterior = corte.
 */
export function sceneCuts(hists: HistSample[], threshold = SCENE_CUT_DIFF): number[] {
  const cuts: number[] = [];
  for (let i = 1; i < hists.length; i++) {
    if (histDiff(hists[i - 1].hist, hists[i].hist) > threshold) cuts.push(hists[i].tSec);
  }
  return cuts;
}

// ───────────────────────────────────────────────────────────────────────────
// Rastreamento de rostos
// ───────────────────────────────────────────────────────────────────────────

export type Track = {
  id: number;
  /** caixa por índice de amostra (null = pessoa não apareceu naquela amostra) */
  boxes: Array<NormBox | null>;
  /** em quantas amostras apareceu */
  hits: number;
  /** fração das amostras em que apareceu */
  presence: number;
  meanCx: number;
  meanCy: number;
  meanArea: number;
  /** desvio-padrão do centro X (estabilidade) */
  stdCx: number;
  firstIdx: number;
  lastIdx: number;
};

/**
 * Associa as caixas entre amostras por IoU (guloso e determinístico: pares
 * ordenados por IoU e, no empate, por id do track / índice do rosto).
 */
export function buildTracks(samples: FaceSample[], iouMin = IOU_MIN): Track[] {
  type Raw = { id: number; boxes: Array<NormBox | null>; last: NormBox; lastIdx: number };
  const raw: Raw[] = [];
  const n = samples.length;

  for (let i = 0; i < n; i++) {
    const faces = samples[i].faces;
    const pairs: Array<{ t: number; f: number; iou: number }> = [];
    for (let t = 0; t < raw.length; t++) {
      for (let f = 0; f < faces.length; f++) {
        const v = iou(raw[t].last, faces[f]);
        if (v > iouMin) pairs.push({ t, f, iou: v });
      }
    }
    pairs.sort((a, b) => (b.iou - a.iou) || (a.t - b.t) || (a.f - b.f));

    const usedTrack = new Set<number>();
    const usedFace = new Set<number>();
    for (const pr of pairs) {
      if (usedTrack.has(pr.t) || usedFace.has(pr.f)) continue;
      usedTrack.add(pr.t);
      usedFace.add(pr.f);
      const box = faces[pr.f];
      raw[pr.t].boxes[i] = { x: box.x, y: box.y, w: box.w, h: box.h };
      raw[pr.t].last = box;
      raw[pr.t].lastIdx = i;
    }
    for (let f = 0; f < faces.length; f++) {
      if (usedFace.has(f)) continue;
      const box = faces[f];
      const boxes: Array<NormBox | null> = new Array(n).fill(null);
      boxes[i] = { x: box.x, y: box.y, w: box.w, h: box.h };
      raw.push({ id: raw.length, boxes, last: box, lastIdx: i });
    }
  }

  return raw.map((r) => {
    let hits = 0;
    let sx = 0;
    let sy = 0;
    let sa = 0;
    let first = -1;
    for (let i = 0; i < n; i++) {
      const b = r.boxes[i];
      if (!b) continue;
      if (first < 0) first = i;
      hits++;
      sx += b.x + b.w / 2;
      sy += b.y + b.h / 2;
      sa += b.w * b.h;
    }
    const meanCx = hits > 0 ? sx / hits : 0.5;
    let varX = 0;
    for (let i = 0; i < n; i++) {
      const b = r.boxes[i];
      if (!b) continue;
      const d = b.x + b.w / 2 - meanCx;
      varX += d * d;
    }
    return {
      id: r.id,
      boxes: r.boxes,
      hits,
      presence: n > 0 ? hits / n : 0,
      meanCx,
      meanCy: hits > 0 ? sy / hits : 0.5,
      meanArea: hits > 0 ? sa / hits : 0,
      stdCx: hits > 0 ? Math.sqrt(varX / hits) : 0,
      firstIdx: first,
      lastIdx: r.lastIdx,
    };
  });
}

/** Tracks vivos (>= 40 % das amostras), ordenados por dominância. */
export function liveTracks(tracks: Track[], aliveRatio = TRACK_ALIVE_RATIO): Track[] {
  return tracks
    .filter((t) => t.presence >= aliveRatio)
    .sort(
      (a, b) =>
        b.presence * b.meanArea - a.presence * a.meanArea ||
        a.firstIdx - b.firstIdx ||
        a.id - b.id,
    );
}

// ───────────────────────────────────────────────────────────────────────────
// Trajetória do crop (zona morta + headroom + suavização + vmax + salto)
// ───────────────────────────────────────────────────────────────────────────

function cutBetween(cuts: number[], from: number, to: number): boolean {
  for (const c of cuts) if (c > from && c <= to) return true;
  return false;
}

/**
 * Percorre as amostras produzindo o centro do crop em cada uma.
 * `boxAt(i, curX)` devolve a caixa do rosto naquela amostra (ou null pra
 * segurar o último alvo — pessoa que sumiu por um instante não move o
 * enquadro). O `curX` deixa o chamador escolher "quem está mais perto do
 * enquadro atual" quando o track dominante não está em cena.
 */
function trajectory(
  samples: FaceSample[],
  cuts: number[],
  boxAt: (i: number, curX: number) => NormBox | null,
  cw: number,
  ch: number,
): CropKeyframe[] {
  const out: CropKeyframe[] = [];
  const minCx = cw / 2;
  const maxCx = 1 - cw / 2;
  const minCy = ch / 2;
  const maxCy = 1 - ch / 2;

  // alvo COMPROMETIDO (o que a zona morta protege) e posição atual do crop
  let tgtX: number | null = null;
  let tgtY: number | null = null;
  let curX = 0.5;
  let curY = 0.5;
  let prevT = samples.length > 0 ? samples[0].tSec : 0;
  let started = false;

  for (let i = 0; i < samples.length; i++) {
    const t = samples[i].tSec;
    const face = boxAt(i, tgtX ?? curX);

    if (face) {
      const faceCx = face.x + face.w / 2;
      const faceCy = face.y + face.h / 2;
      // headroom: o rosto fica no terço superior do crop
      const wantX = clamp(faceCx, minCx, maxCx);
      const wantY = clamp(faceCy + ch * (0.5 - HEADROOM), minCy, maxCy);
      if (tgtX === null || tgtY === null) {
        tgtX = wantX;
        tgtY = wantY;
      } else {
        // zona morta: só recompromete o alvo quando o rosto anda de verdade
        if (Math.abs(wantX - tgtX) > DEAD_ZONE * cw) tgtX = wantX;
        if (Math.abs(wantY - tgtY) > DEAD_ZONE * ch) tgtY = wantY;
      }
    }

    const goalX = tgtX ?? clamp(0.5, minCx, maxCx);
    const goalY = tgtY ?? clamp(0.5, minCy, maxCy);

    if (!started) {
      // o primeiro frame JÁ nasce enquadrado (nada de deslizar do centro)
      curX = goalX;
      curY = goalY;
      started = true;
    } else {
      const dt = Math.max(0, t - prevT);
      if (cutBetween(cuts, prevT, t)) {
        // corte de cena: salto instantâneo, sem deslizar por cima do corte
        curX = goalX;
        curY = goalY;
      } else if (dt > 0) {
        const alpha = 1 - Math.exp(-dt / SMOOTH_TAU_SEC);
        const vmax = VMAX_PER_SEC * dt;
        let dx = (goalX - curX) * alpha;
        let dy = (goalY - curY) * alpha;
        if (Math.abs(dx) > vmax) dx = dx > 0 ? vmax : -vmax;
        if (Math.abs(dy) > vmax) dy = dy > 0 ? vmax : -vmax;
        curX += dx;
        curY += dy;
      }
    }

    curX = clamp(curX, minCx, maxCx);
    curY = clamp(curY, minCy, maxCy);
    out.push({ tSec: t, box: boxFromCenter(curX, curY, cw, ch) });
    prevT = t;
  }

  if (out.length === 0) out.push({ tSec: 0, box: centeredBox(cw, ch) });
  return out;
}

/**
 * Tira keyframes que a interpolação linear já reproduz (erro < eps).
 * Crop parado vira 2 keyframes; movimento contínuo mantém a mesma inclinação.
 */
export function simplifyKeyframes(kfs: CropKeyframe[], eps = SIMPLIFY_EPS): CropKeyframe[] {
  if (kfs.length <= 2) return kfs;
  const out: CropKeyframe[] = [kfs[0]];
  for (let i = 1; i < kfs.length - 1; i++) {
    const a = out[out.length - 1];
    const b = kfs[i];
    const c = kfs[i + 1];
    const span = c.tSec - a.tSec;
    const r = span > 0 ? (b.tSec - a.tSec) / span : 0;
    const ex = Math.abs(a.box.x + (c.box.x - a.box.x) * r - b.box.x);
    const ey = Math.abs(a.box.y + (c.box.y - a.box.y) * r - b.box.y);
    if (ex > eps || ey > eps) out.push(b);
  }
  out.push(kfs[kfs.length - 1]);
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// Tela dividida
// ───────────────────────────────────────────────────────────────────────────

/**
 * 9:16 empilha os dois crops (1080x960 cada); as outras proporções ficam lado
 * a lado. O compositor deduz a orientação pela PROPORÇÃO da caixa do plano
 * (metade empilhada = 2x a proporção da saída; lado a lado = metade dela),
 * então não precisa de campo novo no contrato.
 */
export function splitOrientation(aspect: AspectRatio): 'stacked' | 'side' {
  return aspect === '9:16' ? 'stacked' : 'side';
}

export function splitHalfAR(aspect: AspectRatio): number {
  const ar = ASPECT_AR[aspect];
  return splitOrientation(aspect) === 'stacked' ? ar * 2 : ar / 2;
}

// ───────────────────────────────────────────────────────────────────────────
// planCrop
// ───────────────────────────────────────────────────────────────────────────

export function planCrop(
  samples: FaceSample[],
  cuts: number[],
  opts: PlanCropOptions,
): CropPlan {
  const { srcW, srcH, aspect, mode } = opts;
  const srcAR = srcH > 0 ? srcW / srcH : 1;
  const outAR = ASPECT_AR[aspect];

  // "Ajustar" é escolha explícita do cliente: vale mesmo com o mesmo aspecto.
  if (mode === 'ajustar') return { layout: 'fit' };
  // Mesmo aspecto da fonte: nada a reenquadrar.
  if (Math.abs(srcAR - outAR) <= ASPECT_EPS) return { layout: 'none' };

  const { cw, ch } = cropSizeFor(srcAR, outAR);
  const centro = (): CropPlan => ({
    layout: 'single',
    mode: 'centro',
    keyframes: [{ tSec: samples.length > 0 ? samples[0].tSec : 0, box: centeredBox(cw, ch) }],
  });

  if (mode === 'centro') return centro();

  const tracks = liveTracks(buildTracks(samples));
  if (tracks.length === 0) return centro();

  const wantSplit =
    (mode === 'dividir' || mode === 'auto') &&
    tracks.length >= 2 &&
    Math.abs(tracks[0].meanCx - tracks[1].meanCx) > SPLIT_MIN_DX &&
    (mode === 'dividir' ||
      (tracks[0].stdCx <= SPLIT_MAX_STDX && tracks[1].stdCx <= SPLIT_MAX_STDX));

  if (wantSplit) {
    const halfAR = splitHalfAR(aspect);
    const half = cropSizeFor(srcAR, halfAR);
    // esquerda primeiro (ordem de leitura / ordem no empilhamento)
    const pair = [tracks[0], tracks[1]].sort((a, b) => a.meanCx - b.meanCx || a.id - b.id);
    const kfsA = simplifyKeyframes(
      trajectory(samples, cuts, (i) => pair[0].boxes[i], half.cw, half.ch),
    );
    const kfsB = simplifyKeyframes(
      trajectory(samples, cuts, (i) => pair[1].boxes[i], half.cw, half.ch),
    );
    return { layout: 'split', tracks: [kfsA, kfsB] };
  }

  // "dividir" pedido mas sem 2 pessoas: degrada pra seguir (nunca entrega
  // uma tela dividida com a mesma pessoa dos dois lados).
  const dom = tracks[0];
  /**
   * Quando o track dominante NÃO está em cena (clipe com mais de um plano —
   * corta pro entrevistador, volta), o enquadro segue quem está lá, escolhendo
   * o rosto mais perto do enquadro atual. Sem isso um corte com 2 planos
   * ficaria centralizado no plano inteiro do outro.
   */
  const boxAt = (i: number, curX: number): NormBox | null => {
    const b = dom.boxes[i];
    if (b) return b;
    const faces = samples[i].faces;
    if (faces.length === 0) return null;
    let best: NormBox = faces[0];
    let bestD = Infinity;
    for (const f of faces) {
      const d = Math.abs(f.x + f.w / 2 - curX);
      if (d < bestD) {
        bestD = d;
        best = f;
      }
    }
    return best;
  };
  const keyframes = simplifyKeyframes(trajectory(samples, cuts, boxAt, cw, ch));
  return { layout: 'single', mode: 'seguir', keyframes };
}

// ───────────────────────────────────────────────────────────────────────────
// Interpolação (usada pelo compositor do render)
// ───────────────────────────────────────────────────────────────────────────

/** Caixa do plano no instante `tSec` (interpolação LINEAR entre keyframes). */
export function boxAtTime(kfs: CropKeyframe[], tSec: number): NormBox {
  if (kfs.length === 0) return { x: 0, y: 0, w: 1, h: 1 };
  if (kfs.length === 1 || tSec <= kfs[0].tSec) return kfs[0].box;
  const last = kfs[kfs.length - 1];
  if (tSec >= last.tSec) return last.box;
  let lo = 0;
  let hi = kfs.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (kfs[mid].tSec <= tSec) lo = mid;
    else hi = mid;
  }
  const a = kfs[lo];
  const b = kfs[hi];
  const span = b.tSec - a.tSec;
  const r = span > 0 ? (tSec - a.tSec) / span : 0;
  return {
    x: a.box.x + (b.box.x - a.box.x) * r,
    y: a.box.y + (b.box.y - a.box.y) * r,
    w: a.box.w + (b.box.w - a.box.w) * r,
    h: a.box.h + (b.box.h - a.box.h) * r,
  };
}
