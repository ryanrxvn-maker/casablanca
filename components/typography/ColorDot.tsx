'use client';

/**
 * SELETOR DE COR do editor de legendas (quadrado saturacao x brilho + barra de
 * matiz + paleta rapida + conta-gotas), EXTRAIDO de
 * app/tools/tipografia/page.tsx em 30.08.2026 sem mudar uma virgula do
 * comportamento: a janelinha do ROTEIRO DE LEGENDA usa exatamente o mesmo
 * controle do painel de estilo, entao ele nao pode viver dentro da pagina.
 *
 * O menu sai por PORTAL (components/Popover) com z-index 999, acima de
 * qualquer modal do editor.
 */

import { useCallback, useRef, useState } from 'react';
import { Popover } from '@/components/Popover';

// mesmo relevo 3D dos outros botoes do editor
const T3D =
  ' shadow-[0_2px_0_rgba(0,0,0,0.16),0_6px_12px_-6px_rgba(0,0,0,0.25)] hover:-translate-y-[1.5px] hover:shadow-[0_3.5px_0_rgba(0,0,0,0.16),0_10px_18px_-8px_rgba(0,0,0,0.3)] active:translate-y-[1px] active:shadow-[inset_0_2px_5px_rgba(0,0,0,0.28)] transition-all duration-150 will-change-transform';

export function hsvToHex(h: number, s: number, v: number): string {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const to2 = (n: number) =>
    Math.round((n + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${to2(r)}${to2(g)}${to2(b)}`;
}
export function hexToHsv(hex: string): { h: number; s: number; v: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

export const SWATCHES = [
  '#ffffff', '#d9dbe0', '#8a8f99', '#3a3d45', '#0f0f10', '#000000',
  '#ffd60a', '#ffb300', '#ff9f0a', '#ff6b00', '#e8b04c', '#b8860b',
  '#ff2d55', '#e8192c', '#b00020', '#ff5db1', '#f472b6', '#ffb3c6',
  '#a78bfa', '#7c5cff', '#5b2fd6', '#c9bcf2', '#31c4ff', '#22d3ee',
  '#0aa2c0', '#bde0fe', '#2eff4f', '#2edb84', '#0f9d58', '#c8e87c',
  '#d4fc79', '#f5f0e1', '#ffdab9', '#8b5a2b', '#5c3a21', '#2b1d0e',
];

export function ColorDot({
  label,
  value,
  fallback,
  onPick,
  disabled,
}: {
  label: string;
  value: string | null;
  fallback: string;
  onPick: (v: string | null) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [hex, setHex] = useState('');
  const cur = value ?? fallback;
  // seletor de TOM arrastável (CapCut): quadrado saturação×brilho + barra de matiz
  const [hsv, setHsv] = useState<{ h: number; s: number; v: number }>({ h: 45, s: 1, v: 1 });
  const svRef = useRef<HTMLDivElement | null>(null);
  const hueRef = useRef<HTMLDivElement | null>(null);
  // gatilho + menu por PORTAL (o card do passo corta/desloca popover ancorado)
  const dotBtnRef = useRef<HTMLButtonElement | null>(null);
  const closeDot = useCallback(() => setOpen(false), []);
  const openPicker = () => {
    if (!open) {
      const fromCur = hexToHsv(cur);
      if (fromCur) setHsv(fromCur);
    }
    setOpen((v) => !v);
  };
  const dragSv = (e: React.PointerEvent) => {
    const el = svRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const s = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const v = 1 - Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    const next = { ...hsv, s, v };
    setHsv(next);
    onPick(hsvToHex(next.h, next.s, next.v));
  };
  const dragHue = (e: React.PointerEvent) => {
    const el = hueRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const h = Math.min(359.9, Math.max(0, ((e.clientX - r.left) / r.width) * 360));
    const next = { ...hsv, h };
    setHsv(next);
    onPick(hsvToHex(next.h, next.s, next.v));
  };
  return (
    <div className="relative">
      <button
        ref={dotBtnRef}
        onClick={openPicker}
        disabled={disabled}
        className={
          'flex items-center gap-2 rounded-[10px] border border-line bg-bg-soft px-2.5 py-1.5 hover:border-amber-400/50' +
          T3D
        }
      >
        <span
          className="h-5 w-5 rounded-[6px] border border-white/25 shadow-inner"
          style={{ background: cur }}
        />
        <span className="text-[11px] font-semibold text-text-muted">{label}</span>
      </button>
      <Popover open={open} anchorRef={dotBtnRef} onClose={closeDot} width={248}>
        <div className="rounded-[16px] border border-line-strong bg-bg-elev p-3 shadow-2xl">
          {/* topo: cor atual grande + hex + conta-gotas (só ícone) */}
          <div className="mb-2.5 flex items-center gap-2">
            <span
              className="h-8 w-8 shrink-0 rounded-[9px] border border-white/20 shadow-[inset_0_1px_2px_rgba(255,255,255,0.25),0_2px_6px_rgba(0,0,0,0.35)]"
              style={{ background: cur }}
            />
            <input
              value={hex}
              onChange={(e) => {
                setHex(e.target.value);
                const v = e.target.value.trim();
                if (/^#?[0-9a-fA-F]{6}$/.test(v)) {
                  onPick(v.startsWith('#') ? v : '#' + v);
                }
              }}
              placeholder={cur}
              className="mono w-full min-w-0 rounded-[8px] border border-line bg-black/25 px-2 py-1.5 text-[11px] text-text outline-none focus:border-amber-400/50"
            />
            {typeof window !== 'undefined' && 'EyeDropper' in window ? (
              <button
                title="Pegar cor da tela — clica em qualquer pixel do preview"
                onClick={async () => {
                  try {
                    const picker = new (
                      window as unknown as {
                        EyeDropper: new () => { open: () => Promise<{ sRGBHex: string }> };
                      }
                    ).EyeDropper();
                    const r = await picker.open();
                    if (r?.sRGBHex) {
                      onPick(r.sRGBHex);
                      const fromPick = hexToHsv(r.sRGBHex);
                      if (fromPick) setHsv(fromPick);
                    }
                  } catch {
                    /* user cancelou o conta-gotas */
                  }
                }}
                className={
                  'flex h-8 w-9 shrink-0 items-center justify-center rounded-[9px] border border-line bg-bg-soft text-text hover:border-amber-400/60 hover:text-amber-400' +
                  T3D
                }
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                  <path d="m2 22 1-1h3l9-9M3 21v-3l9-9m0 0 3.5-3.5M15 6l3 3m-3-3 2.3-2.3a2.4 2.4 0 0 1 3.4 3.4L18 9" />
                </svg>
              </button>
            ) : null}
          </div>

          {/* quadrado de TOM (saturação × brilho) — arrasta igual CapCut */}
          <div
            ref={svRef}
            onPointerDown={(e) => {
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              dragSv(e);
            }}
            onPointerMove={(e) => {
              if (e.buttons === 1) dragSv(e);
            }}
            className="relative h-[130px] w-full cursor-crosshair touch-none rounded-[10px] border border-white/15"
            style={{
              background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hsvToHex(hsv.h, 1, 1)})`,
            }}
          >
            <span
              className="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1.5px_rgba(0,0,0,0.6)]"
              style={{
                left: `${hsv.s * 100}%`,
                top: `${(1 - hsv.v) * 100}%`,
                background: hsvToHex(hsv.h, hsv.s, hsv.v),
              }}
            />
          </div>
          {/* barra de matiz */}
          <div
            ref={hueRef}
            onPointerDown={(e) => {
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              dragHue(e);
            }}
            onPointerMove={(e) => {
              if (e.buttons === 1) dragHue(e);
            }}
            className="relative mt-2 h-[14px] w-full cursor-pointer touch-none rounded-full border border-white/15"
            style={{
              background:
                'linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)',
            }}
          >
            <span
              className="pointer-events-none absolute top-1/2 h-[18px] w-[18px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1.5px_rgba(0,0,0,0.6)]"
              style={{ left: `${(hsv.h / 360) * 100}%`, background: hsvToHex(hsv.h, 1, 1) }}
            />
          </div>

          {/* paleta rápida */}
          <div className="mt-2.5 grid grid-cols-9 gap-1">
            {SWATCHES.map((c) => (
              <button
                key={c}
                onClick={() => {
                  onPick(c);
                  const fromSw = hexToHsv(c);
                  if (fromSw) setHsv(fromSw);
                }}
                className={
                  'h-[19px] w-[19px] rounded-[5px] border transition-transform hover:scale-125 ' +
                  (cur.toLowerCase() === c ? 'border-amber-400' : 'border-white/15')
                }
                style={{ background: c }}
                title={c}
              />
            ))}
          </div>

          <div className="mt-2.5 flex items-center gap-1.5">
            <button
              onClick={() => {
                onPick(null);
                setOpen(false);
              }}
              className={
                'w-full rounded-[8px] border border-line bg-bg-soft px-2 py-1.5 text-[10.5px] font-semibold text-text-muted hover:text-text' +
                T3D
              }
            >
              Padrão do modelo
            </button>
            <button
              onClick={() => setOpen(false)}
              className={
                'shrink-0 rounded-[8px] border border-amber-400/60 bg-amber-400/15 px-3 py-1.5 text-[10.5px] font-bold text-amber-600' +
                T3D
              }
            >
              OK
            </button>
          </div>
        </div>
      </Popover>
    </div>
  );
}

