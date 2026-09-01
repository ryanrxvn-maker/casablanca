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
 *  • data-fp-anim="clock"     — texto com hora (H:MM em qualquer posição);
 *  • data-fp-anim="calltimer" — duração de chamada (M:SS) que CONTA a cada
 *                               segundo, como um cronômetro real;
 *  • data-fp-anim="ticker"    — faixa cujos itens deslizam (o rótulo fica fora);
 *  • data-fp-anim="livedot"   — bolinha que pulsa (some da base e é redesenhada).
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

type ClockSpec = { kind: 'clock' | 'calltimer'; rect: Rect; piece: Piece; maxW: number };
type TickerSpec = { kind: 'ticker'; rect: Rect; pieces: Piece[]; totalW: number; speed: number };
type DotSpec = { kind: 'livedot'; rect: Rect; color: string };
type Spec = ClockSpec | TickerSpec | DotSpec;

/** Vídeo de fundo ([data-fp-video]): na base ele vira BURACO transparente e o
 *  frame REAL é desenhado POR BAIXO a cada frame do export (cover no rect). */
type VideoSpec = { rect: Rect; el: HTMLVideoElement };

/** drawImage em COVER (recorta o excesso, centrado) — igual ao object-fit da prévia. */
function drawCover(ctx: CanvasRenderingContext2D, v: HTMLVideoElement, r: Rect) {
  if (v.readyState < 2 || !v.videoWidth || !v.videoHeight) return;
  const sc = Math.max(r.w / v.videoWidth, r.h / v.videoHeight);
  const sw = r.w / sc;
  const sh = r.h / sc;
  const sx = (v.videoWidth - sw) / 2;
  const sy = (v.videoHeight - sh) / 2;
  ctx.drawImage(v, sx, sy, sw, sh, r.x, r.y, r.w, r.h);
}

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

/** Relógio COM SEGUNDOS (H:MM:SS): avança em `plusSec` segundos — no vídeo os
 *  segundos CONTAM em tempo real (11:20:35 → 11:20:36 → …). Preserva zero à
 *  esquerda e sufixo (AM/PM etc.); 12h vira 1 depois do 12, 24h zera no 23. */
export function advanceClockSeconds(text: string, plusSec: number): string {
  const m = /(\d{1,2}):([0-5]\d):([0-5]\d)/.exec(text);
  if (!m) return text;
  let hh = parseInt(m[1], 10);
  let total = parseInt(m[2], 10) * 60 + parseInt(m[3], 10) + Math.max(0, Math.floor(plusSec));
  while (total >= 3600) {
    total -= 3600;
    hh += 1;
  }
  const h12 = / ?[AP]M/i.test(text.slice(m.index + m[0].length));
  if (h12) {
    if (hh > 12) hh -= 12;
  } else if (hh > 23) {
    hh -= 24;
  }
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  const hhStr = m[1].length === 2 && m[1][0] === '0' ? String(hh).padStart(2, '0') : String(hh);
  return (
    text.slice(0, m.index) +
    `${hhStr}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}` +
    text.slice(m.index + m[0].length)
  );
}

/** Avança a PRIMEIRA duração M:SS achada no texto em `plusSec` segundos
 *  (cronômetro de chamada: 0:42 → 0:43 → … → 1:00). Sem M:SS, devolve igual. */
export function advanceCallTimer(text: string, plusSec: number): string {
  const m = /(\d{1,3}):([0-5]\d)/.exec(text);
  if (!m) return text;
  const total = parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + Math.max(0, Math.floor(plusSec));
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  // preserva o zero à esquerda do minuto se o texto original tinha (00:42)
  const mmStr = m[1].length === 2 && m[1][0] === '0' && mm < 100 ? String(mm).padStart(2, '0') : String(mm);
  return text.slice(0, m.index) + `${mmStr}:${String(ss).padStart(2, '0')}` + text.slice(m.index + m[0].length);
}

export type StageVideo = {
  width: number;
  height: number;
  renderFrame: (ctx: CanvasRenderingContext2D, t: number) => void;
  /** Há alguma parte animada de fato? (sem specs o vídeo seria estático) */
  animated: boolean;
  /** Vídeos de fundo AO VIVO no frame: o export precisa rodar em TEMPO REAL
   *  (o <video> toca de verdade) — o encoder rápido não se aplica. */
  hasLiveVideo: boolean;
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
  const videos: VideoSpec[] = [];
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

      if (kind === 'clock' || kind === 'calltimer') {
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
          kind,
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

    // vídeos de fundo ([data-fp-video]): rect medido no DOM real
    node.querySelectorAll<HTMLVideoElement>('video[data-fp-video]').forEach((v) => {
      const cs = getComputedStyle(v);
      if (cs.display === 'none' || cs.visibility === 'hidden') return;
      const r = v.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      videos.push({ rect: rectOf(r), el: v });
    });
  } finally {
    if (zoomEl) zoomEl.style.zoom = prevZoom;
  }

  // ── 2) base = export real com a tinta animada oculta no clone ──
  // Vídeo de fundo vira BURACO transparente na base (data-fp-vidhole impede o
  // snapshot do renderNodeToCanvas): o frame REAL é composto POR BAIXO a cada
  // frame do export — chyron/PiP/qualquer coisa por cima segue na base.
  videos.forEach((v) => { v.el.dataset.fpVidhole = '1'; });
  const base = await renderNodeToCanvas(node, targetW, refW, (root) => {
    root.querySelectorAll<HTMLElement>('[data-fp-anim="clock"], [data-fp-anim="calltimer"], [data-fp-anim="ticker"]').forEach((el) => {
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
  videos.forEach((v) => { delete v.el.dataset.fpVidhole; });

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
    // vídeos de fundo PRIMEIRO (a base tem o buraco transparente na área deles)
    for (const v of videos) drawCover(ctx, v.el, v.rect);
    ctx.drawImage(base, 0, 0);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    for (const sp of specs) {
      if (sp.kind === 'clock' || sp.kind === 'calltimer') {
        // clock H:MM: o minuto vira no meio do vídeo (como quem pega a virada
        // ao vivo). clock H:MM:SS: os SEGUNDOS contam em tempo real. calltimer:
        // duração de chamada CONTANDO a cada segundo. Se o texto novo ficar
        // mais LARGO que a caixinha (9:59→10:00), o drawPiece comprime pra
        // caber (guard na MESMA métrica do desenho).
        const text =
          sp.kind === 'calltimer'
            ? advanceCallTimer(sp.piece.text, t)
            : /\d{1,2}:[0-5]\d:[0-5]\d/.test(sp.piece.text)
              ? advanceClockSeconds(sp.piece.text, t)
              : t >= 4
                ? advanceClockText(sp.piece.text, 1)
                : sp.piece.text;
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
      } else if (sp.kind === 'livedot') {
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

  return {
    width: base.width,
    height: base.height,
    renderFrame,
    animated: specs.length > 0 || videos.length > 0,
    hasLiveVideo: videos.length > 0,
  };
}

/* ─────────────── Encoder RÁPIDO (WebCodecs + mp4-muxer) ─────────────── */

export type EncodedVideo = { blob: Blob; ext: 'mp4' | 'webm' };

/**
 * Codifica `seconds`×`fps` frames MAIS RÁPIDO QUE TEMPO REAL: em vez de gravar
 * o relógio de parede (MediaRecorder = 20s de vídeo → 20s esperando), cada
 * frame é desenhado e empurrado pro encoder de HARDWARE (WebCodecs) na
 * velocidade máxima — um export de 30s sai em poucos segundos, imune a aba em
 * segundo plano. Sai .mp4 (H.264), que qualquer editor abre direto.
 *
 * `drawFrame(i, t)` desenha o frame i (t em segundos) no canvas dado.
 * Devolve null quando o navegador não suporta (aí o chamador cai pro
 * MediaRecorder em tempo real, comportamento antigo).
 */
export async function encodeCanvasVideo(
  cv: HTMLCanvasElement,
  opts: { seconds: number; fps?: number; drawFrame: (i: number, t: number) => void },
): Promise<EncodedVideo | null> {
  if (typeof (window as any).VideoEncoder === 'undefined') return null;
  // H.264 4:2:0 exige dimensões PARES — ímpar cai pro caminho antigo
  if (cv.width % 2 || cv.height % 2) return null;
  const fps = opts.fps ?? 30;
  const seconds = Math.max(1, opts.seconds);
  const total = Math.round(seconds * fps);
  // (sem tipo do DOM aqui: WebCodecs pode não existir no lib.dom do TS alvo)
  const cfg = {
    // High 5.0: cobre 1920×1080 e 1080×1920 com folga
    codec: 'avc1.640032',
    width: cv.width,
    height: cv.height,
    bitrate: 10_000_000,
    framerate: fps,
  };
  try {
    const sup = await (window as any).VideoEncoder.isConfigSupported(cfg);
    if (!sup?.supported) return null;
  } catch {
    return null;
  }
  let Muxer: any;
  let ArrayBufferTarget: any;
  try {
    ({ Muxer, ArrayBufferTarget } = await import('mp4-muxer'));
  } catch {
    return null;
  }
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width: cv.width, height: cv.height },
    fastStart: 'in-memory',
  });
  let encErr: unknown = null;
  const encoder = new (window as any).VideoEncoder({
    output: (chunk: any, meta: any) => muxer.addVideoChunk(chunk, meta),
    error: (e: unknown) => { encErr = e; },
  });
  encoder.configure(cfg);
  try {
    for (let i = 0; i < total; i++) {
      if (encErr) throw encErr;
      const t = Math.min(i / fps, seconds);
      opts.drawFrame(i, t);
      const frame = new (window as any).VideoFrame(cv, {
        timestamp: Math.round((i * 1e6) / fps),
        duration: Math.round(1e6 / fps),
      });
      encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
      frame.close();
      // backpressure SEM timer (timer sofre throttle em aba de fundo):
      // espera o próprio encoder liberar a fila via evento dequeue
      if (encoder.encodeQueueSize > 4) {
        await new Promise<void>((res) => {
          encoder.ondequeue = () => { encoder.ondequeue = null; res(); };
        });
      }
    }
    await encoder.flush();
    if (encErr) throw encErr;
    muxer.finalize();
    return { blob: new Blob([muxer.target.buffer], { type: 'video/mp4' }), ext: 'mp4' };
  } catch (err) {
    console.warn('[fakepass] encoder rápido falhou — caindo pro tempo real', err);
    try { encoder.close(); } catch {}
    return null;
  }
}

/** Grava `seconds` de animação e devolve o Blob .webm.
 *
 *  ⚠ NÃO usar requestAnimationFrame aqui: com a aba em segundo plano ou a
 *  janela ocluída o Chrome SUSPENDE o rAF — o canvas para de repintar, o
 *  captureStream não emite mais frames e o vídeo sai com 1-2s em vez dos 20s
 *  (era exatamente o bug do export 9:16: gravação longa, usuário troca de
 *  aba, frames morrem). O motor agora é imune a throttle:
 *   • clock num WEB WORKER (thread própria, sem throttle de timer da página);
 *   • captureStream(0) + track.requestFrame() — cada paint é EMPURRADO pro
 *     encoder, sem depender do compositor;
 *   • recorder.start(1000) com timeslice — falha no meio ainda entrega o que
 *     já foi gravado;
 *   • parada por tempo DECORRIDO medido no tick (nada de setTimeout solto).
 */
export async function recordStageVideo(
  node: HTMLElement,
  opts: { seconds: number; targetW: number; refW?: number },
): Promise<EncodedVideo> {
  const prep = await prepareStageVideo(node, opts.targetW, opts.refW);
  const cv = document.createElement('canvas');
  cv.width = prep.width;
  cv.height = prep.height;
  const ctx = cv.getContext('2d');
  if (!ctx) throw new Error('canvas indisponível');
  prep.renderFrame(ctx, 0);
  // gancho de inspeção (testes/dev): permite renderizar frames à mão
  (window as any).__fpVidLast = { prep, canvas: cv, ctx };

  // vídeo de fundo? Garante tocando (mudo) e DO COMEÇO — o export pega o take inteiro.
  const bgVids = Array.from(node.querySelectorAll<HTMLVideoElement>('video[data-fp-video]'));
  for (const v of bgVids) {
    try {
      v.muted = true;
      v.currentTime = 0;
      await v.play().catch(() => {});
    } catch {}
  }

  // ── caminho RÁPIDO (WebCodecs): frames determinísticos → codifica na
  // velocidade máxima em vez de esperar o relógio. Vídeo de fundo AO VIVO não
  // dá (o <video> anda em tempo real) → segue pro MediaRecorder abaixo.
  if (!prep.hasLiveVideo) {
    const fast = await encodeCanvasVideo(cv, {
      seconds: opts.seconds,
      drawFrame: (_i, t) => prep.renderFrame(ctx, t),
    });
    if (fast) return fast;
  }

  // captura MANUAL (frameRequestRate 0): o frame só entra quando a gente chama
  // track.requestFrame() — determinístico. Sem suporte (borda), cai pra 30fps.
  let stream = cv.captureStream(0);
  let track = stream.getVideoTracks()[0] as any;
  const manualPush = typeof track?.requestFrame === 'function';
  if (!manualPush) {
    track?.stop?.();
    stream = cv.captureStream(30);
    track = stream.getVideoTracks()[0];
  }

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

  const FPS = 30;
  const seconds = Math.max(1, opts.seconds);
  const t0 = performance.now();
  let worker: Worker | null = null;
  let fallbackId: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  const finish = () => {
    if (stopped) return;
    stopped = true;
    try {
      worker?.terminate();
    } catch {}
    if (fallbackId) clearInterval(fallbackId);
    if (recorder.state !== 'inactive') recorder.stop();
  };

  const tick = () => {
    if (stopped) return;
    const t = (performance.now() - t0) / 1000;
    // um frame com erro NÃO pode matar o loop (senão o vídeo congela ali)
    try {
      prep.renderFrame(ctx, Math.min(t, seconds));
    } catch {}
    try {
      if (manualPush) track.requestFrame();
    } catch {}
    if (t >= seconds) finish();
  };

  // clock no Worker: postMessage chega como task normal mesmo com a aba de
  // fundo (mesmo padrão do poll HeyGen). Se o Worker falhar, setInterval da
  // página segura o export com a aba VISÍVEL (comportamento antigo).
  try {
    const src = `let id=0;onmessage=()=>{id=setInterval(()=>postMessage(0),${Math.round(1000 / FPS)})}`;
    const url = URL.createObjectURL(new Blob([src], { type: 'application/javascript' }));
    worker = new Worker(url);
    URL.revokeObjectURL(url);
    worker.onmessage = tick;
    worker.postMessage('start');
  } catch {
    fallbackId = setInterval(tick, Math.round(1000 / FPS));
  }

  recorder.addEventListener('error', finish);
  recorder.start(1000);
  tick(); // 1º frame já dentro da captura
  // backstop: se algo travar o clock, encerra e entrega o que tiver
  setTimeout(finish, seconds * 1000 + 15_000);

  const blob = await done;
  finish();
  return { blob, ext: 'webm' };
}

/* ─────────── Encoder com CANAL ALFA (VP9 + alpha, WebM) ─────────── */

/**
 * Codifica o canvas em WebM **com transparência REAL** (VP9 `alpha: 'keep'`).
 *
 * É a resposta definitiva pro "não pode subtrair nada": em vez de pintar um
 * fundo verde e mandar o editor RECORTAR por cor — o que sempre come uma borda
 * do conteúdo e engole qualquer pixel parecido com a chave —, o vídeo já sai
 * com o fundo VAZIO. No CapCut/Premiere é só jogar por cima: nada é recortado,
 * nada é subtraído, e as bordas do texto continuam suaves.
 *
 * Devolve null quando o navegador não suporta (aí o chamador cai no mp4/chroma).
 */
export async function encodeCanvasVideoAlpha(
  cv: HTMLCanvasElement,
  opts: { seconds: number; fps?: number; drawFrame: (i: number, t: number) => void },
): Promise<EncodedVideo | null> {
  if (typeof (window as any).VideoEncoder === 'undefined') return null;
  const fps = opts.fps ?? 30;
  const seconds = Math.max(1, opts.seconds);
  const total = Math.round(seconds * fps);
  const cfg: any = {
    codec: 'vp09.00.10.08',
    width: cv.width,
    height: cv.height,
    bitrate: 10_000_000,
    framerate: fps,
    alpha: 'keep',
  };
  try {
    const sup = await (window as any).VideoEncoder.isConfigSupported(cfg);
    if (!sup?.supported) return null;
    // alguns Chrome dizem "supported" mas devolvem a config SEM alpha — nesse
    // caso o vídeo sairia com fundo preto sólido, pior que o chroma.
    if (sup.config && sup.config.alpha && sup.config.alpha !== 'keep') return null;
  } catch {
    return null;
  }
  let Muxer: any;
  let ArrayBufferTarget: any;
  try {
    ({ Muxer, ArrayBufferTarget } = await import('webm-muxer'));
  } catch {
    return null;
  }
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'V_VP9', width: cv.width, height: cv.height, frameRate: fps, alpha: true },
  });
  let encErr: unknown = null;
  const encoder = new (window as any).VideoEncoder({
    output: (chunk: any, meta: any) => muxer.addVideoChunk(chunk, meta),
    error: (e: unknown) => { encErr = e; },
  });
  encoder.configure(cfg);
  try {
    for (let i = 0; i < total; i++) {
      if (encErr) throw encErr;
      const t = Math.min(i / fps, seconds);
      opts.drawFrame(i, t);
      const frame = new (window as any).VideoFrame(cv, {
        timestamp: Math.round((i * 1e6) / fps),
        duration: Math.round(1e6 / fps),
        alpha: 'keep',
      });
      encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
      frame.close();
      if (encoder.encodeQueueSize > 4) {
        await new Promise<void>((res) => {
          encoder.ondequeue = () => { encoder.ondequeue = null; res(); };
        });
      }
    }
    await encoder.flush();
    if (encErr) throw encErr;
    muxer.finalize();
    return { blob: new Blob([muxer.target.buffer], { type: 'video/webm' }), ext: 'webm' };
  } catch (err) {
    console.warn('[fakepass] encoder com alfa falhou — caindo pro caminho normal', err);
    try { encoder.close(); } catch {}
    return null;
  }
}
