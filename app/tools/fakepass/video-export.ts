'use client';

/**
 * FakePass — export de VÍDEO (.webm) dos modelos DOM com partes que se mexem
 * (telejornais: relógio rodando, ticker deslizando, bolinha AO VIVO pulsando).
 *
 * Como funciona (e por que é fiel):
 *  1. A BASE do vídeo é o próprio export de PNG (`renderNodeToCanvas`) com a
 *     TINTA dos elementos animados oculta no clone — todo o resto do frame é
 *     idêntico ao download estático, pixel a pixel.
 *  2. Cada elemento `[data-fp-anim]` é medido no DOM REAL: retângulo, fonte,
 *     cor, letter-spacing e a BASELINE exata (marcador inline-block de altura
 *     zero — o topo do rect é a baseline). No frame t=0 o texto é desenhado
 *     na MESMA posição em que o navegador o pinta → sem "salto" ao dar play.
 *  3. Por frame: desenha a base + relógio (minuto vira no meio do vídeo),
 *     ticker (peças do DOM deslizando em loop, com clip na faixa) e bolinha
 *     pulsando. captureStream + MediaRecorder → .webm (mesmo motor das Lives).
 *
 * Tags reconhecidas:
 *  • data-fp-anim="clock"   — texto com hora (H:MM em qualquer posição);
 *  • data-fp-anim="ticker"  — faixa cujos itens deslizam (o rótulo fica fora);
 *  • data-fp-anim="livedot" — bolinha que pulsa (some da base e é redesenhada).
 */

import { renderNodeToCanvas } from './shared';

type Rect = { x: number; y: number; w: number; h: number };

type Piece = {
  text: string;
  color: string;
  font: string; // já em px de EXPORT
  letterSpacing: number; // px de export
  x: number; // export px, relativo ao stage
  baseline: number; // export px, relativo ao stage
  /** largura REAL no DOM (export px) — o canvas não suporta `tabular-nums`,
   *  então os dígitos saem mais largos; normalizamos com scaleX = wDom/wCanvas. */
  wDom: number;
  /** text-shadow do DOM (já escalado), se houver. */
  shadow?: { color: string; x: number; y: number; blur: number };
};

/** Converte o text-shadow computado ("rgba(...) 0px 1px 3px") pra spec do canvas. */
function parseShadow(cs: CSSStyleDeclaration, scale: number) {
  const ts = cs.textShadow;
  if (!ts || ts === 'none') return undefined;
  const m = /(rgba?\([^)]+\)|#[0-9a-f]+)\s+(-?[\d.]+)px\s+(-?[\d.]+)px(?:\s+(-?[\d.]+)px)?/i.exec(ts);
  if (!m) return undefined;
  return { color: m[1], x: parseFloat(m[2]) * scale, y: parseFloat(m[3]) * scale, blur: (parseFloat(m[4]) || 0) * scale };
}

type ClockSpec = { kind: 'clock'; rect: Rect; piece: Piece; maxW: number };
type TickerSpec = { kind: 'ticker'; rect: Rect; pieces: Piece[]; totalW: number; speed: number };
type DotSpec = { kind: 'livedot'; rect: Rect; color: string };
type Spec = ClockSpec | TickerSpec | DotSpec;

const TICKER_SPEED_CSS = 55; // px CSS por segundo (ritmo de chyron real)
const TICKER_LOOP_GAP_CSS = 64; // respiro entre o fim e a volta do texto

function buildFont(cs: CSSStyleDeclaration, scale: number): string {
  const size = (parseFloat(cs.fontSize) || 13) * scale;
  return `${cs.fontStyle} ${cs.fontWeight} ${size}px ${cs.fontFamily}`;
}

function applyTransformCase(text: string, cs: CSSStyleDeclaration): string {
  if (cs.textTransform === 'uppercase') return text.toUpperCase();
  if (cs.textTransform === 'lowercase') return text.toLowerCase();
  return text;
}

/** Baseline exata de um text-node: um inline-block de altura 0 senta NA baseline. */
function baselineOf(textNode: Node): number {
  const el = textNode.parentElement!;
  const mk = el.ownerDocument.createElement('span');
  mk.style.cssText = 'display:inline-block;width:0;height:0;padding:0;margin:0';
  el.insertBefore(mk, textNode);
  const y = mk.getBoundingClientRect().top;
  mk.remove();
  return y;
}

/** Avança a PRIMEIRA hora H:MM achada no texto em `plusMin` minutos. */
export function advanceClockText(text: string, plusMin: number): string {
  const m = /(\d{1,2}):([0-5]\d)/.exec(text);
  if (!m) return text;
  let hh = parseInt(m[1], 10);
  let mm = parseInt(m[2], 10) + plusMin;
  const h12 = hh >= 1 && hh <= 12 && !/(\d{1,2}):[0-5]\d\s*:/.test(text) && / ?[AP]M/i.test(text.slice(m.index));
  while (mm >= 60) {
    mm -= 60;
    hh += 1;
  }
  if (h12) {
    if (hh > 12) hh -= 12;
  } else if (hh > 23) {
    hh -= 24;
  }
  const hhStr = m[1].length === 2 && m[1][0] === '0' ? String(hh).padStart(2, '0') : String(hh);
  return text.slice(0, m.index) + `${hhStr}:${String(mm).padStart(2, '0')}` + text.slice(m.index + m[0].length);
}

export type StageVideo = {
  width: number;
  height: number;
  renderFrame: (ctx: CanvasRenderingContext2D, t: number) => void;
  /** Há alguma parte animada de fato? (sem specs o vídeo seria estático) */
  animated: boolean;
};

export async function prepareStageVideo(
  node: HTMLElement,
  targetW: number,
  refW?: number,
): Promise<StageVideo> {
  // ── 1) medições no DOM real, com o zoom da prévia neutralizado ──
  const zoomEl = node.closest('[data-fp-zoom]') as HTMLElement | null;
  const prevZoom = zoomEl ? zoomEl.style.zoom : '';
  if (zoomEl) zoomEl.style.zoom = '1';
  const specs: Spec[] = [];
  try {
    const nodeRect = node.getBoundingClientRect();
    const scale = targetW / (refW ?? nodeRect.width);
    const rectOf = (r: DOMRect): Rect => ({
      x: (r.left - nodeRect.left) * scale,
      y: (r.top - nodeRect.top) * scale,
      w: r.width * scale,
      h: r.height * scale,
    });

    node.querySelectorAll<HTMLElement>('[data-fp-anim]').forEach((el) => {
      const kind = el.dataset.fpAnim;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return;
      // texto rotacionado/vertical fica fora (eixo errado pro desenho 2D simples)
      if (cs.writingMode !== 'horizontal-tb') return;
      const elRect = el.getBoundingClientRect();
      if (elRect.width < 2 || elRect.height < 2) return;

      if (kind === 'livedot') {
        specs.push({ kind: 'livedot', rect: rectOf(elRect), color: cs.backgroundColor });
        return;
      }

      if (kind === 'clock') {
        // 1º text-node com conteúdo
        let tn: Node | null = null;
        const walk = (n: Node) => {
          if (tn) return;
          if (n.nodeType === 3 && (n.textContent || '').trim()) { tn = n; return; }
          n.childNodes.forEach(walk);
        };
        walk(el);
        if (!tn) return;
        const range = document.createRange();
        range.selectNodeContents(tn);
        const tr = range.getClientRects()[0];
        if (!tr) return;
        const pcs = getComputedStyle((tn as Node).parentElement || el);
        specs.push({
          kind: 'clock',
          rect: rectOf(elRect),
          maxW: (elRect.width - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0)) * scale,
          piece: {
            text: applyTransformCase((el.textContent || '').replace(/\s+/g, ' ').trim(), pcs),
            color: pcs.color,
            font: buildFont(pcs, scale),
            letterSpacing: (parseFloat(pcs.letterSpacing) || 0) * scale,
            x: (tr.left - nodeRect.left) * scale,
            baseline: (baselineOf(tn) - nodeRect.top) * scale,
            wDom: tr.width * scale,
            shadow: parseShadow(pcs, scale),
          },
        });
        return;
      }

      if (kind === 'ticker') {
        // cada text-node vira uma PEÇA com a posição/estilo exatos do DOM —
        // no t=0 o desenho coincide com o layout real (gaps de flex inclusos).
        const pieces: Piece[] = [];
        let minL = Infinity;
        let maxR = -Infinity;
        const walk = (n: Node) => {
          if (n.nodeType === 3 && (n.textContent || '').trim()) {
            const range = document.createRange();
            range.selectNodeContents(n);
            const tr = range.getClientRects()[0];
            if (!tr) return;
            const pcs = getComputedStyle(n.parentElement || el);
            pieces.push({
              text: applyTransformCase((n.textContent || '').trim(), pcs),
              color: pcs.color,
              font: buildFont(pcs, scale),
              letterSpacing: (parseFloat(pcs.letterSpacing) || 0) * scale,
              x: (tr.left - nodeRect.left) * scale,
              baseline: (baselineOf(n) - nodeRect.top) * scale,
              wDom: tr.width * scale,
              shadow: parseShadow(pcs, scale),
            });
            minL = Math.min(minL, (tr.left - nodeRect.left) * scale);
            maxR = Math.max(maxR, (tr.right - nodeRect.left) * scale);
            return;
          }
          n.childNodes.forEach(walk);
        };
        walk(el);
        if (!pieces.length) return;
        specs.push({
          kind: 'ticker',
          rect: rectOf(elRect),
          pieces,
          totalW: maxR - minL + TICKER_LOOP_GAP_CSS * scale,
          speed: TICKER_SPEED_CSS * scale,
        });
        return;
      }
    });
  } finally {
    if (zoomEl) zoomEl.style.zoom = prevZoom;
  }

  // ── 2) base = export real com a tinta animada oculta no clone ──
  const base = await renderNodeToCanvas(node, targetW, refW, (root) => {
    root.querySelectorAll<HTMLElement>('[data-fp-anim="clock"], [data-fp-anim="ticker"]').forEach((el) => {
      el.style.color = 'transparent';
      el.style.textShadow = 'none';
      el.style.setProperty('-webkit-text-fill-color', 'transparent');
      el.querySelectorAll<HTMLElement>('*').forEach((c) => {
        c.style.color = 'transparent';
        c.style.textShadow = 'none';
        c.style.setProperty('-webkit-text-fill-color', 'transparent');
      });
    });
    root.querySelectorAll<HTMLElement>('[data-fp-anim="livedot"]').forEach((el) => {
      el.style.visibility = 'hidden';
    });
  });

  // desenha uma peça na LARGURA do DOM: o canvas não tem `tabular-nums`, então
  // normalizamos com scaleX = wDom/wCanvas — no t=0 a tinta coincide com a base.
  const drawPiece = (ctx: CanvasRenderingContext2D, p: Piece, text: string, x: number, fitW?: number) => {
    ctx.font = p.font;
    (ctx as any).letterSpacing = `${p.letterSpacing}px`;
    const wc = ctx.measureText(p.text).width;
    let sx = wc > 1 ? p.wDom / wc : 1;
    sx = Math.max(0.85, Math.min(1.15, sx));
    // texto NOVO mais largo que a caixinha (1:21→1:22)? comprime pra CABER —
    // 2-3% nos dígitos é imperceptível e o relógio nunca fura o chip.
    if (fitW) {
      const wNew = ctx.measureText(text).width * sx;
      if (wNew > fitW) sx *= fitW / wNew;
    }
    ctx.fillStyle = p.color;
    ctx.save();
    if (p.shadow) {
      ctx.shadowColor = p.shadow.color;
      ctx.shadowOffsetX = p.shadow.x;
      ctx.shadowOffsetY = p.shadow.y;
      ctx.shadowBlur = p.shadow.blur;
    }
    ctx.translate(x, p.baseline);
    ctx.scale(sx, 1);
    ctx.fillText(text, 0, 0);
    ctx.restore();
    (ctx as any).letterSpacing = '0px';
    return sx;
  };

  const renderFrame = (ctx: CanvasRenderingContext2D, t: number) => {
    ctx.clearRect(0, 0, base.width, base.height);
    ctx.drawImage(base, 0, 0);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    for (const sp of specs) {
      if (sp.kind === 'clock') {
        // o minuto vira no meio do vídeo (como quem pega a virada ao vivo);
        // se a hora nova ficar mais LARGA que a caixinha (9:59→10:00), congela.
        // Guard na MESMA métrica do desenho (canvas × scaleX de normalização).
        const plus = t >= 4 ? 1 : 0;
        let text = plus ? advanceClockText(sp.piece.text, plus) : sp.piece.text;
        ctx.font = sp.piece.font;
        (ctx as any).letterSpacing = `${sp.piece.letterSpacing}px`;
        drawPiece(ctx, sp.piece, text, sp.piece.x, sp.maxW);
      } else if (sp.kind === 'ticker') {
        ctx.save();
        ctx.beginPath();
        ctx.rect(sp.rect.x, sp.rect.y, sp.rect.w, sp.rect.h);
        ctx.clip();
        const slide = (t * sp.speed) % sp.totalW;
        for (const off of [0, sp.totalW]) {
          for (const p of sp.pieces) {
            const x = p.x - slide + off;
            if (x > sp.rect.x + sp.rect.w || x < sp.rect.x - sp.totalW) continue;
            drawPiece(ctx, p, p.text, x);
          }
        }
        ctx.restore();
      } else {
        // bolinha AO VIVO pulsando (1 Hz, nunca some de todo)
        const a = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(2 * Math.PI * t - Math.PI / 2));
        ctx.save();
        ctx.globalAlpha = a;
        ctx.fillStyle = sp.color;
        ctx.beginPath();
        ctx.arc(sp.rect.x + sp.rect.w / 2, sp.rect.y + sp.rect.h / 2, Math.min(sp.rect.w, sp.rect.h) / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  };

  return { width: base.width, height: base.height, renderFrame, animated: specs.length > 0 };
}

/** Grava `seconds` de animação e devolve o Blob .webm. */
export async function recordStageVideo(
  node: HTMLElement,
  opts: { seconds: number; targetW: number; refW?: number },
): Promise<Blob> {
  const prep = await prepareStageVideo(node, opts.targetW, opts.refW);
  const cv = document.createElement('canvas');
  cv.width = prep.width;
  cv.height = prep.height;
  const ctx = cv.getContext('2d');
  if (!ctx) throw new Error('canvas indisponível');
  prep.renderFrame(ctx, 0);
  // gancho de inspeção (testes/dev): permite renderizar frames à mão
  (window as any).__fpVidLast = { prep, canvas: cv, ctx };

  const stream = cv.captureStream(30);
  let mime = 'video/webm;codecs=vp9';
  if (!MediaRecorder.isTypeSupported(mime)) mime = 'video/webm;codecs=vp8';
  if (!MediaRecorder.isTypeSupported(mime)) mime = 'video/webm';
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  const done = new Promise<Blob>((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }));
  });

  let raf = 0;
  const t0 = performance.now();
  const loop = () => {
    const t = (performance.now() - t0) / 1000;
    prep.renderFrame(ctx, t);
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  recorder.start();
  await new Promise((r) => setTimeout(r, Math.max(1, opts.seconds) * 1000));
  recorder.stop();
  const blob = await done;
  cancelAnimationFrame(raf);
  return blob;
}
