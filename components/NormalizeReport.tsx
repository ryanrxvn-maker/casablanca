'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { AudioReport } from '@/lib/audio-report';
import type { NormalizeEngineInfo } from '@/lib/ffmpeg-worker';

/**
 * NormalizeReport — relatório visual antes × depois de UM arquivo do
 * Normalizador. Prova a diferença de várias formas:
 *
 *   1. ONDA SONORA: as duas ondas (antes em cinza, depois em teal) na mesma
 *      escala, com a guarda de true-peak (−1.5 dB) tracejada no depois.
 *   2. CURVA DE VOLUME: o nível da voz ao longo do tempo — antes oscilando,
 *      depois reto dentro da "faixa nivelada". Hover mostra os dois valores.
 *   3. MÉTRICAS: volume médio (LUFS), oscilação ±dB, pico e ruído de fundo,
 *      cada uma antes → depois com o delta.
 *   4. OUVIR A/B: player com chave ANTES/DEPOIS que troca no mesmo ponto.
 *
 * Cores: "antes" usa o cinza do tema (recessivo), "depois" usa o accent teal
 * da ferramenta (--nrm-acc, com override no modo claro), lime é reservado pra
 * status (alvo/ok). Os canvas leem os tokens do tema na hora de desenhar e
 * redesenham quando o data-theme muda.
 */

const LABEL_STYLE: CSSProperties = {
  fontFamily: 'var(--font-tech)',
  letterSpacing: '0.18em',
};

/* ───────────────────────── helpers de desenho ───────────────────────── */

type ChartColors = {
  acc: string;
  mut: string;
  lime: string;
  text: string;
  surface: string;
  rgba: (triplet: string, a: number) => string;
  fontTech: string;
  fontMono: string;
};

function resolveColors(el: HTMLElement): ChartColors {
  const cs = getComputedStyle(el);
  const trip = (name: string, fb: string) =>
    cs.getPropertyValue(name).trim() || fb;
  const rgba = (t: string, a: number) =>
    `rgba(${t.split(/\s+/).join(',')},${a})`;
  return {
    acc: trip('--nrm-acc', '94 234 212'),
    mut: trip('--text-muted', '139 139 150'),
    lime: trip('--lime', '200 214 132'),
    text: trip('--text', '235 235 240'),
    surface: trip('--bg-softer', '21 21 26'),
    rgba,
    fontTech: cs.getPropertyValue('--font-tech').trim() || 'ui-sans-serif, system-ui',
    fontMono: cs.getPropertyValue('--font-mono').trim() || 'ui-monospace, monospace',
  };
}

function fitCanvas(
  cv: HTMLCanvasElement,
): { w: number; h: number; ctx: CanvasRenderingContext2D } | null {
  const rect = cv.getBoundingClientRect();
  if (rect.width < 10 || rect.height < 10) return null;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.round(rect.width);
  const h = Math.round(rect.height);
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
  }
  const ctx = cv.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { w, h, ctx };
}

function smooth3(src: Float32Array): Float32Array {
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) {
    const a = src[Math.max(0, i - 1)];
    const b = src[i];
    const c = src[Math.min(src.length - 1, i + 1)];
    out[i] = (a + b + c) / 3;
  }
  return out;
}

function fmtClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Observa resize + troca de tema e redesenha. */
function useChartRedraw(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  redraw: () => void,
) {
  const redrawRef = useRef(redraw);
  redrawRef.current = redraw;
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const run = () => redrawRef.current();
    run();
    const ro = new ResizeObserver(run);
    ro.observe(cv.parentElement ?? cv);
    const mo = new MutationObserver(run);
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasRef]);
}

/* ───────────────────────── onda sonora A × B ───────────────────────── */

function WaveCompare({ before, after }: { before: AudioReport; after: AudioReport }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useChartRedraw(canvasRef, () => {
    const cv = canvasRef.current;
    if (!cv) return;
    const fit = fitCanvas(cv);
    if (!fit) return;
    const { w, h, ctx } = fit;
    const C = resolveColors(cv);
    ctx.clearRect(0, 0, w, h);

    const lanes = [
      { rep: before, label: 'ANTES', color: (a: number) => C.rgba(C.mut, a) },
      { rep: after, label: 'DEPOIS', color: (a: number) => C.rgba(C.acc, a) },
    ];
    const laneH = h / 2;

    lanes.forEach((lane, li) => {
      const cy = laneH * li + laneH / 2;
      const half = laneH * 0.42;
      const { peak, rms } = lane.rep.env;
      const B = peak.length;
      const xOf = (i: number) => (B <= 1 ? 0 : (i / (B - 1)) * w);

      // hairline central da lane
      ctx.fillStyle = C.rgba(C.mut, 0.18);
      ctx.fillRect(0, cy - 0.5, w, 1);

      // polígono espelhado (peak translúcido por baixo, RMS sólido por cima)
      const poly = (env: Float32Array, alpha: number) => {
        ctx.beginPath();
        for (let i = 0; i < B; i++) {
          const amp = Math.pow(10, env[i] / 20);
          const y = cy - Math.max(0.6, amp * half);
          if (i === 0) ctx.moveTo(xOf(i), y);
          else ctx.lineTo(xOf(i), y);
        }
        for (let i = B - 1; i >= 0; i--) {
          const amp = Math.pow(10, env[i] / 20);
          ctx.lineTo(xOf(i), cy + Math.max(0.6, amp * half));
        }
        ctx.closePath();
        ctx.fillStyle = lane.color(alpha);
        ctx.fill();
      };
      poly(peak, 0.28);
      poly(rms, li === 0 ? 0.7 : 0.88);

      // guarda de true-peak (−1.5 dB ≈ 0.841) só no DEPOIS
      if (li === 1) {
        const a = Math.pow(10, -1.5 / 20);
        ctx.strokeStyle = C.rgba(C.lime, 0.4);
        ctx.setLineDash([3, 5]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, cy - a * half);
        ctx.lineTo(w, cy - a * half);
        ctx.moveTo(0, cy + a * half);
        ctx.lineTo(w, cy + a * half);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = C.rgba(C.lime, 0.75);
        ctx.font = `600 8px ${C.fontMono}`;
        ctx.textAlign = 'right';
        ctx.fillText('-1.5 dB', w - 4, cy - a * half - 3);
        ctx.textAlign = 'left';
      }

      // label da lane
      ctx.font = `700 9px ${C.fontTech}`;
      try {
        (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = '1.5px';
      } catch {
        /* browsers antigos */
      }
      ctx.fillStyle = li === 0 ? C.rgba(C.mut, 0.95) : C.rgba(C.acc, 0.95);
      ctx.fillText(lane.label, 6, laneH * li + 12);
      try {
        (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = '0px';
      } catch {
        /* ignora */
      }
    });

    // separador entre as lanes
    ctx.fillStyle = C.rgba(C.mut, 0.12);
    ctx.fillRect(0, laneH - 0.5, w, 1);
  });

  return <canvas ref={canvasRef} className="block h-[150px] w-full md:h-[168px]" />;
}

/* ─────────────────── curva de volume (nivelamento) ─────────────────── */

function LevelChart({ before, after }: { before: AudioReport; after: AudioReport }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hoverRef = useRef<{ x: number } | null>(null);
  const rafRef = useRef(0);

  const draw = () => {
    const cv = canvasRef.current;
    if (!cv) return;
    const fit = fitCanvas(cv);
    if (!fit) return;
    const { w, h, ctx } = fit;
    const C = resolveColors(cv);
    ctx.clearRect(0, 0, w, h);

    const padL = 34;
    const padR = 8;
    const padT = 8;
    const padB = 16;
    const iw = w - padL - padR;
    const ih = h - padT - padB;

    const curveB = smooth3(before.env.rms);
    const curveA = smooth3(after.env.rms);
    const gateB = Math.max(before.noiseFloorDb + 8, -58);
    const gateA = Math.max(after.noiseFloorDb + 8, -58);

    // domínio y: 0 até um piso que mostre as duas curvas + a faixa nivelada
    let minActive = -22;
    const scanMin = (env: Float32Array, gate: number) => {
      for (let i = 0; i < env.length; i++) {
        if (env[i] > gate && env[i] < minActive) minActive = env[i];
      }
    };
    scanMin(curveB, gateB);
    scanMin(curveA, gateA);
    const bandC = after.speechLevelDb;
    const bandHalf = Math.max(2.5, after.swingDb);
    let yMin = Math.floor((Math.min(minActive, bandC - bandHalf) - 4) / 5) * 5;
    yMin = Math.max(-60, Math.min(-30, yMin));
    const yMax = 0;
    const yOf = (db: number) =>
      padT + ((yMax - Math.max(yMin, Math.min(yMax, db))) / (yMax - yMin)) * ih;
    const xOf = (i: number, B: number) =>
      padL + (B <= 1 ? 0 : (i / (B - 1)) * iw);

    // grid recessivo a cada 10 dB + labels
    ctx.font = `500 8.5px ${C.fontMono}`;
    for (let g = 0; g >= yMin; g -= 10) {
      const y = yOf(g);
      ctx.fillStyle = C.rgba(C.mut, 0.1);
      ctx.fillRect(padL, y - 0.5, iw, 1);
      ctx.fillStyle = C.rgba(C.mut, 0.75);
      ctx.textAlign = 'right';
      ctx.fillText(String(g), padL - 5, y + 3);
    }
    ctx.textAlign = 'left';

    // faixa nivelada (nível médio ± oscilação do DEPOIS)
    const bandTop = yOf(bandC + bandHalf);
    const bandBot = yOf(bandC - bandHalf);
    ctx.fillStyle = C.rgba(C.lime, 0.08);
    ctx.fillRect(padL, bandTop, iw, Math.max(2, bandBot - bandTop));
    ctx.strokeStyle = C.rgba(C.lime, 0.4);
    ctx.setLineDash([4, 5]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, yOf(bandC));
    ctx.lineTo(padL + iw, yOf(bandC));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = C.rgba(C.lime, 0.85);
    ctx.font = `600 8px ${C.fontMono}`;
    ctx.textAlign = 'right';
    ctx.fillText('FAIXA NIVELADA', padL + iw - 4, bandTop - 3);
    ctx.textAlign = 'left';

    // curvas (gap nas pausas — só a VOZ entra no gráfico)
    const curve = (
      env: Float32Array,
      gate: number,
      stroke: string,
      width: number,
      glow?: string,
    ) => {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = width;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      if (glow) {
        ctx.shadowColor = glow;
        ctx.shadowBlur = 6;
      }
      ctx.beginPath();
      let open = false;
      for (let i = 0; i < env.length; i++) {
        if (env[i] <= gate) {
          open = false;
          continue;
        }
        const X = xOf(i, env.length);
        const Y = yOf(env[i]);
        if (!open) {
          ctx.moveTo(X, Y);
          open = true;
        } else {
          ctx.lineTo(X, Y);
        }
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
    };
    curve(curveB, gateB, C.rgba(C.mut, 0.8), 1.6);
    curve(curveA, gateA, C.rgba(C.acc, 0.95), 2.2, C.rgba(C.acc, 0.35));

    // eixo do tempo
    const dur = after.durationSec || before.durationSec;
    ctx.font = `500 8.5px ${C.fontMono}`;
    ctx.fillStyle = C.rgba(C.mut, 0.75);
    ctx.fillText('0:00', padL, h - 4);
    ctx.textAlign = 'center';
    ctx.fillText(fmtClock(dur / 2), padL + iw / 2, h - 4);
    ctx.textAlign = 'right';
    ctx.fillText(fmtClock(dur), padL + iw, h - 4);
    ctx.textAlign = 'left';

    // hover: crosshair + leitura dos dois valores
    const hover = hoverRef.current;
    if (hover && hover.x >= padL && hover.x <= padL + iw) {
      const frac = (hover.x - padL) / iw;
      const iA = Math.round(frac * (curveA.length - 1));
      const iB = Math.round(frac * (curveB.length - 1));
      const vA = curveA[iA];
      const vB = curveB[iB];
      const X = xOf(iA, curveA.length);

      ctx.strokeStyle = C.rgba(C.text, 0.22);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(X, padT);
      ctx.lineTo(X, padT + ih);
      ctx.stroke();

      const dot = (v: number, gate: number, color: string) => {
        if (v <= gate) return;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(X, yOf(v), 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = C.rgba(C.surface, 1);
        ctx.lineWidth = 1.5;
        ctx.stroke();
      };
      dot(vB, gateB, C.rgba(C.mut, 1));
      dot(vA, gateA, C.rgba(C.acc, 1));

      const fmtV = (v: number, gate: number) =>
        v > gate ? `${v.toFixed(1)} dB` : 'pausa';
      const rows: Array<[string, string, string | null]> = [
        [fmtClock(frac * dur), '', null],
        ['ANTES', fmtV(vB, gateB), C.rgba(C.mut, 1)],
        ['DEPOIS', fmtV(vA, gateA), C.rgba(C.acc, 1)],
      ];
      const bw = 118;
      const bh = 46;
      const bx = X + 10 + bw > w - padR ? X - 10 - bw : X + 10;
      const by = padT + 4;
      ctx.fillStyle = C.rgba(C.surface, 0.94);
      ctx.strokeStyle = C.rgba(C.mut, 0.35);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(bx, by, bw, bh, 7);
      ctx.fill();
      ctx.stroke();
      ctx.font = `500 9px ${C.fontMono}`;
      rows.forEach((row, ri) => {
        const y = by + 13 + ri * 13;
        let x = bx + 8;
        if (row[2]) {
          ctx.fillStyle = row[2];
          ctx.fillRect(x, y - 6, 6, 6);
          x += 10;
        }
        ctx.fillStyle = row[2] ? C.rgba(C.text, 0.9) : C.rgba(C.mut, 0.9);
        ctx.fillText(row[0], x, y);
        if (row[1]) {
          ctx.textAlign = 'right';
          ctx.fillStyle = C.rgba(C.text, 0.95);
          ctx.fillText(row[1], bx + bw - 8, y);
          ctx.textAlign = 'left';
        }
      });
    }
  };

  useChartRedraw(canvasRef, draw);

  const scheduleDraw = () => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      draw();
    });
  };

  return (
    <canvas
      ref={canvasRef}
      className="block h-[168px] w-full cursor-crosshair md:h-[188px]"
      onPointerMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        hoverRef.current = { x: e.clientX - rect.left };
        scheduleDraw();
      }}
      onPointerLeave={() => {
        hoverRef.current = null;
        scheduleDraw();
      }}
    />
  );
}

/* ───────────────────────────── métricas ───────────────────────────── */

function MetricTile({
  label,
  before,
  after,
  pill,
  pillGood,
}: {
  label: string;
  before: string;
  after: string;
  pill?: string | null;
  pillGood?: boolean;
}) {
  return (
    <div className="rounded-[12px] border border-line bg-bg-soft/50 px-3 py-2.5">
      <div className="text-[9px] font-bold uppercase text-text-muted" style={LABEL_STYLE}>
        {label}
      </div>
      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
        <span className="mono text-[11px] text-text-muted">{before}</span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          className="shrink-0 self-center text-text-muted opacity-70"
          aria-hidden
        >
          <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span
          className="text-[16px] font-extrabold tracking-tight text-text"
          style={{ fontFamily: 'var(--font-tech)', letterSpacing: '-0.01em' }}
        >
          {after}
        </span>
      </div>
      {pill ? (
        <span
          className="mono mt-1.5 inline-flex rounded-full px-2 py-[2px] text-[9px] font-bold"
          style={
            pillGood
              ? {
                  background: 'rgba(var(--lime), 0.14)',
                  color: 'rgb(var(--lime))',
                }
              : {
                  border: '1px solid rgb(var(--line))',
                  color: 'rgb(var(--text-muted))',
                }
          }
        >
          {pill}
        </span>
      ) : null}
    </div>
  );
}

/* ─────────────────────────── player A/B ─────────────────────────── */

function ABPlayer({ beforeUrl, afterUrl }: { beforeUrl: string; afterUrl: string }) {
  const beforeRef = useRef<HTMLAudioElement | null>(null);
  const afterRef = useRef<HTMLAudioElement | null>(null);
  const [mode, setMode] = useState<'before' | 'after'>('after');
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  useEffect(() => {
    const a = afterRef.current;
    const b = beforeRef.current;
    if (!a || !b) return;
    const onLoaded = () => setDuration(a.duration || b.duration || 0);
    const onTimeA = () => {
      if (modeRef.current === 'after') setCurrent(a.currentTime || 0);
    };
    const onTimeB = () => {
      if (modeRef.current === 'before') setCurrent(b.currentTime || 0);
    };
    const onEnd = () => setPlaying(false);
    a.addEventListener('loadedmetadata', onLoaded);
    b.addEventListener('loadedmetadata', onLoaded);
    a.addEventListener('timeupdate', onTimeA);
    b.addEventListener('timeupdate', onTimeB);
    a.addEventListener('ended', onEnd);
    b.addEventListener('ended', onEnd);
    return () => {
      a.removeEventListener('loadedmetadata', onLoaded);
      b.removeEventListener('loadedmetadata', onLoaded);
      a.removeEventListener('timeupdate', onTimeA);
      b.removeEventListener('timeupdate', onTimeB);
      a.removeEventListener('ended', onEnd);
      b.removeEventListener('ended', onEnd);
    };
  }, [beforeUrl, afterUrl]);

  const elFor = (m: 'before' | 'after') =>
    m === 'after' ? afterRef.current : beforeRef.current;

  function toggle() {
    const el = elFor(mode);
    if (!el) return;
    if (playing) {
      el.pause();
      setPlaying(false);
    } else {
      void el.play();
      setPlaying(true);
    }
  }

  function switchTo(m: 'before' | 'after') {
    if (m === mode) return;
    const from = elFor(mode);
    const to = elFor(m);
    if (from && to) {
      to.currentTime = from.currentTime || 0;
      from.pause();
      if (playing) void to.play();
    }
    setMode(m);
  }

  function seek(e: React.ChangeEvent<HTMLInputElement>) {
    const v = parseFloat(e.target.value);
    const a = afterRef.current;
    const b = beforeRef.current;
    if (a) a.currentTime = v;
    if (b) b.currentTime = v;
    setCurrent(v);
  }

  const pct = duration > 0 ? (current / duration) * 100 : 0;

  return (
    <div
      className={
        'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[12px] border bg-bg px-3 py-2.5 transition-colors duration-300 ' +
        (playing ? 'border-line-strong' : 'border-line')
      }
    >
      <audio ref={beforeRef} src={beforeUrl} preload="metadata" />
      <audio ref={afterRef} src={afterUrl} preload="metadata" />

      <button
        onClick={toggle}
        aria-label={playing ? 'Pausar' : 'Reproduzir'}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-all duration-200 hover:brightness-110 hover:scale-[1.06] active:scale-[0.94]"
        style={{
          background: 'rgb(var(--nrm-acc))',
          color: 'rgb(var(--bg))',
          boxShadow: playing ? '0 0 18px -2px rgba(var(--nrm-acc), 0.7)' : 'none',
        }}
      >
        {playing ? (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="5" width="4" height="14" rx="1" />
            <rect x="14" y="5" width="4" height="14" rx="1" />
          </svg>
        ) : (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>

      <div
        className="flex shrink-0 overflow-hidden rounded-full border border-line"
        role="group"
        aria-label="Comparar antes e depois"
      >
        <button
          onClick={() => switchTo('before')}
          className={
            'px-3 py-1.5 text-[9.5px] font-bold uppercase tracking-[0.14em] transition-colors ' +
            (mode === 'before' ? 'bg-bg-softer text-text' : 'text-text-muted hover:text-text')
          }
          style={{ fontFamily: 'var(--font-tech)' }}
        >
          Antes
        </button>
        <button
          onClick={() => switchTo('after')}
          className={
            'px-3 py-1.5 text-[9.5px] font-bold uppercase tracking-[0.14em] transition-colors ' +
            (mode === 'after' ? '' : 'text-text-muted hover:text-text')
          }
          style={{
            fontFamily: 'var(--font-tech)',
            ...(mode === 'after'
              ? {
                  background: 'rgba(var(--nrm-acc), 0.16)',
                  color: 'rgb(var(--nrm-acc))',
                }
              : {}),
          }}
        >
          Depois
        </button>
      </div>

      <div className="min-w-[120px] flex-1">
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.01}
          value={current}
          onChange={seek}
          className="w-full"
          style={{ ['--range-fill' as string]: `${pct}%` }}
          aria-label="Posição"
        />
      </div>

      <div className="mono shrink-0 text-[11px] text-text-muted">
        {fmtClock(current)} / {fmtClock(duration)}
      </div>
    </div>
  );
}

/* ───────────────────────────── relatório ───────────────────────────── */

export function NormalizeReport({
  before,
  after,
  beforeUrl,
  afterUrl,
  engine,
}: {
  before: AudioReport;
  after: AudioReport;
  beforeUrl: string;
  afterUrl: string;
  engine?: NormalizeEngineInfo | null;
}) {
  // ---- métricas derivadas ------------------------------------------------
  const hasLufs = before.lufs !== null && after.lufs !== null;
  const volBefore = hasLufs ? (before.lufs as number) : before.speechLevelDb;
  const volAfter = hasLufs ? (after.lufs as number) : after.speechLevelDb;
  const volUnit = hasLufs ? 'LUFS' : 'dB';
  const volDelta = volAfter - volBefore;

  const swingCutPct =
    before.swingDb > 0.5
      ? Math.round((1 - after.swingDb / before.swingDb) * 100)
      : null;

  const peakBefore = before.truePeakDb ?? before.peakDb;
  const peakAfter = after.truePeakDb ?? after.peakDb;
  const peakUnit = after.truePeakDb !== null ? 'dBTP' : 'dB';
  const peakProtected = peakAfter <= -1.2;

  const noiseDelta = after.noiseFloorDb - before.noiseFloorDb;

  const onTarget = after.lufs !== null && Math.abs(after.lufs + 16) <= 1.5;

  let verdict: string;
  if (swingCutPct !== null && swingCutPct >= 10) {
    verdict = `Oscilação da voz caiu ${swingCutPct}% — todas as falas saíram no mesmo patamar.`;
  } else if (before.swingDb <= 2) {
    verdict =
      'A voz já era estável — foi aplicado ganho de volume e limpeza, sem mexer na dinâmica.';
  } else {
    verdict = 'Volume regulado e picos protegidos.';
  }

  const badges: Array<{ text: string; tone: 'acc' | 'lime' | 'muted' }> = [];
  if (engine?.denoise === 'rnnoise') badges.push({ text: 'DENOISE IA', tone: 'acc' });
  else if (engine?.denoise === 'afftdn') badges.push({ text: 'DENOISE', tone: 'muted' });
  if (engine?.extremeMode) badges.push({ text: 'REFORÇO EXTREMO', tone: 'acc' });
  if (engine?.gainDb != null) {
    badges.push({
      text: `GANHO ${engine.gainDb >= 0 ? '+' : ''}${engine.gainDb.toFixed(1)} dB`,
      tone: 'muted',
    });
  }
  if (onTarget) badges.push({ text: 'ALVO −16 LUFS ✓', tone: 'lime' });

  const badgeStyle = (tone: 'acc' | 'lime' | 'muted'): CSSProperties => {
    if (tone === 'acc') {
      return {
        ...LABEL_STYLE,
        letterSpacing: '0.12em',
        color: 'rgb(var(--nrm-acc))',
        border: '1px solid rgba(var(--nrm-acc), 0.35)',
        background: 'rgba(var(--nrm-acc), 0.08)',
      };
    }
    if (tone === 'lime') {
      return {
        ...LABEL_STYLE,
        letterSpacing: '0.12em',
        color: 'rgb(var(--lime))',
        border: '1px solid rgba(var(--lime), 0.35)',
        background: 'rgba(var(--lime), 0.1)',
      };
    }
    return {
      ...LABEL_STYLE,
      letterSpacing: '0.12em',
      color: 'rgb(var(--text-muted))',
      border: '1px solid rgb(var(--line))',
    };
  };

  const chip = (colorVar: string, label: string) => (
    <span className="mono inline-flex items-center gap-1.5 text-[9px] text-text-muted">
      <i
        className="inline-block h-2 w-2 rounded-[2px]"
        style={{ background: colorVar }}
        aria-hidden
      />
      {label}
    </span>
  );

  return (
    <div
      className="nrm-report relative overflow-hidden rounded-[14px] border border-line/80"
      style={{
        background:
          'linear-gradient(180deg, rgba(255,255,255,0.02), rgba(0,0,0,0.14)), linear-gradient(180deg, rgb(var(--bg-softer)), rgb(var(--bg-soft)))',
      }}
    >
      {/* hairline accent no topo */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-px"
        style={{
          background:
            'linear-gradient(90deg, transparent, rgba(var(--nrm-acc), 0.55), transparent)',
        }}
      />

      <div className="relative flex flex-col gap-4 p-3.5 md:p-4">
        {/* header */}
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
          <div className="min-w-0">
            <div
              className="inline-flex items-center gap-2 text-[9.5px] font-bold uppercase text-text-muted"
              style={LABEL_STYLE}
            >
              <span
                aria-hidden
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{
                  background: 'rgb(var(--nrm-acc))',
                  boxShadow: '0 0 8px rgba(var(--nrm-acc), 0.8)',
                }}
              />
              Relatório · antes × depois
            </div>
            <p className="mt-1 text-[11.5px] leading-snug text-text-muted">{verdict}</p>
          </div>
          {badges.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {badges.map((b) => (
                <span
                  key={b.text}
                  className="rounded-full px-2 py-[3px] text-[8.5px] font-bold uppercase"
                  style={badgeStyle(b.tone)}
                >
                  {b.text}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        {/* onda sonora */}
        <div>
          <div className="mb-1 text-[9px] font-bold uppercase text-text-muted" style={LABEL_STYLE}>
            Onda sonora
          </div>
          <div className="overflow-hidden rounded-[10px] border border-line/70 bg-bg/60">
            <WaveCompare before={before} after={after} />
          </div>
        </div>

        {/* curva de volume */}
        <div>
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-[9px] font-bold uppercase text-text-muted" style={LABEL_STYLE}>
              Curva de volume da voz
            </span>
            <div className="flex items-center gap-2.5">
              {chip('rgba(var(--text-muted), 0.9)', 'ANTES')}
              {chip('rgb(var(--nrm-acc))', 'DEPOIS')}
            </div>
          </div>
          <div className="overflow-hidden rounded-[10px] border border-line/70 bg-bg/60">
            <LevelChart before={before} after={after} />
          </div>
        </div>

        {/* métricas */}
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <MetricTile
            label="Volume médio"
            before={volBefore.toFixed(1)}
            after={`${volAfter.toFixed(1)} ${volUnit}`}
            pill={
              Math.abs(volDelta) >= 1
                ? `${volDelta >= 0 ? '+' : ''}${volDelta.toFixed(1)} dB`
                : 'já no nível'
            }
            pillGood={Math.abs(volDelta) >= 1}
          />
          <MetricTile
            label="Oscilação da voz"
            before={`±${before.swingDb.toFixed(1)}`}
            after={`±${after.swingDb.toFixed(1)} dB`}
            pill={
              swingCutPct !== null && swingCutPct >= 5
                ? `−${swingCutPct}% de oscilação`
                : 'já estável'
            }
            pillGood={swingCutPct !== null && swingCutPct >= 5}
          />
          <MetricTile
            label="Pico"
            before={peakBefore.toFixed(1)}
            after={`${peakAfter.toFixed(1)} ${peakUnit}`}
            pill={peakProtected ? 'PROTEGIDO' : null}
            pillGood={peakProtected}
          />
          <MetricTile
            label="Ruído de fundo"
            before={before.noiseFloorDb.toFixed(0)}
            after={`${after.noiseFloorDb.toFixed(0)} dB`}
            pill={
              noiseDelta <= -3
                ? `−${Math.abs(noiseDelta).toFixed(0)} dB de ruído`
                : after.noiseFloorDb <= -55
                  ? 'limpo'
                  : null
            }
            pillGood={noiseDelta <= -3 || after.noiseFloorDb <= -55}
          />
        </div>

        {/* ouvir A/B */}
        <div>
          <div className="mb-1 text-[9px] font-bold uppercase text-text-muted" style={LABEL_STYLE}>
            Comparar de ouvido
          </div>
          <ABPlayer beforeUrl={beforeUrl} afterUrl={afterUrl} />
        </div>
      </div>

      <style jsx global>{`
        .nrm-report {
          --nrm-acc: 94 234 212;
        }
        html[data-theme='light'] .nrm-report {
          /* teal escuro — legível sobre o fundo claro */
          --nrm-acc: 15 118 110;
        }
      `}</style>
    </div>
  );
}
