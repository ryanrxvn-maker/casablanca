'use client';

/**
 * FakePass — módulo compartilhado (fundação).
 *
 * Tudo que é comum a todos os modelos de print/sticker vive aqui:
 *  • tipos do sistema modular de modelos
 *  • FitText — auto-ajuste de fonte (mesmo motor da caixinha de pergunta)
 *  • downloadNodeAsPng — export nítido via html2canvas + Object URL
 *  • StatusBar — barra de status realista de celular (iPhone / Android)
 *  • primitivos de controle (Field, TextField, Toggle, RangeField, etc.)
 *
 * Cada MODELO (sticker, chat, post…) é um objeto FakeModel registrado em
 * models.tsx e consumido pelo shell em page.tsx.
 */

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type CSSProperties,
} from 'react';
import { Inter } from 'next/font/google';

// Fonte base dos prints — Inter (réplica fiel do SF Pro do iOS/Instagram),
// carregada local. Em Apple o sistema entrega SF Pro nativo pela stack abaixo.
export const uiFont = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-fp',
});
export const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, var(--font-fp), 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/* ────────────────────────────── Tipos ────────────────────────────── */

export type PhoneOS = 'ios' | 'android';

export type StatusCfg = {
  os: PhoneOS;
  time: string;
  carrier: string;
  battery: number; // 0-100
  charging: boolean;
  signal: number; // 0-4
  wifi: boolean;
  network: string; // '4G' | '5G' | 'LTE' | ''
  airplane: boolean;
};

export const defaultStatus: StatusCfg = {
  os: 'ios',
  time: '9:41',
  carrier: 'Vivo',
  battery: 82,
  charging: false,
  signal: 4,
  wifi: true,
  network: '5G',
  airplane: false,
};

export type ModelCategory = 'story' | 'chat' | 'post' | 'notif';

export type FakeModel<S = any> = {
  id: string;
  label: string;
  category: ModelCategory;
  hue: string;
  /** Largura do PALCO em px no preview (o export escala a partir daí). */
  stageW: number;
  /** altura/largura do palco. */
  ratio: number;
  /** Largura final do PNG exportado. */
  exportW: number;
  /** Mostra a barra de status do celular no topo do palco? */
  usesPhone: boolean;
  defaultState: S;
  Controls: (p: { s: S; set: (patch: Partial<S>) => void }) => ReactNode;
  /** Renderiza o conteúdo do print. `status` só vem quando usesPhone. */
  Preview: (p: { s: S; status: StatusCfg }) => ReactNode;
};

/* ─────────────────────────── FitText ─────────────────────────── */

const useIsoLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/**
 * Texto que encolhe a fonte (do máximo ao mínimo) até caber na altura-alvo —
 * igual ao Instagram. Mede o scrollHeight real; o tamanho final é o que o
 * export rasteriza.
 */
export function FitText({
  children,
  maxPx,
  minPx,
  maxHeight,
  style,
}: {
  children: string;
  maxPx: number;
  minPx: number;
  maxHeight: number;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [px, setPx] = useState(maxPx);
  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let size = maxPx;
    el.style.fontSize = `${size}px`;
    let guard = 0;
    while (size > minPx && el.scrollHeight > maxHeight && guard < 48) {
      size -= 1;
      el.style.fontSize = `${size}px`;
      guard += 1;
    }
    setPx(size);
  }, [children, maxPx, minPx, maxHeight]);
  return (
    <div ref={ref} style={{ ...style, fontSize: px }}>
      {children || ' '}
    </div>
  );
}

/* ───────────────────────── Export (PNG) ───────────────────────── */

/**
 * Rasteriza um nó do DOM em PNG nítido. `targetW` define a largura final; o
 * scale é derivado da largura real do nó, então funciona pra qualquer palco.
 * Download por Object URL (nunca base64 — data URL trunca arquivo grande).
 */
export async function downloadNodeAsPng(
  node: HTMLElement,
  filename: string,
  targetW: number,
) {
  if (document.fonts?.ready) await document.fonts.ready;
  await new Promise((r) => setTimeout(r, 60));
  const { default: html2canvas } = await import('html2canvas');
  const rect = node.getBoundingClientRect();
  const scale = targetW / rect.width;
  const canvas: HTMLCanvasElement = await html2canvas(node, {
    scale,
    backgroundColor: null,
    useCORS: true,
    logging: false,
  });
  const blob: Blob | null = await new Promise((res) =>
    canvas.toBlob((b: Blob | null) => res(b), 'image/png'),
  );
  if (!blob) throw new Error('toBlob vazio');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/* ─────────────────────── Ícones da StatusBar ─────────────────────── */

function SignalBars({ n, color }: { n: number; color: string }) {
  // 4 barras crescentes; as (n) primeiras acesas.
  const hs = [4, 7, 10, 13];
  return (
    <svg width="17" height="13" viewBox="0 0 17 13" fill="none" aria-hidden>
      {hs.map((h, i) => (
        <rect
          key={i}
          x={i * 4.3}
          y={13 - h}
          width="3"
          height={h}
          rx="0.8"
          fill={color}
          opacity={i < n ? 1 : 0.28}
        />
      ))}
    </svg>
  );
}

function WifiGlyph({ color }: { color: string }) {
  return (
    <svg width="16" height="12" viewBox="0 0 16 12" fill="none" aria-hidden>
      <path
        d="M8 2.2c2.6 0 5 1 6.8 2.7l-1.5 1.6A7.6 7.6 0 0 0 8 4.3 7.6 7.6 0 0 0 2.7 6.5L1.2 4.9A9.8 9.8 0 0 1 8 2.2Z"
        fill={color}
      />
      <path
        d="M8 6.1c1.5 0 2.9.6 3.9 1.6l-1.6 1.6A2.9 2.9 0 0 0 8 8.4c-.9 0-1.7.4-2.3 1L4.1 7.7A5.5 5.5 0 0 1 8 6.1Z"
        fill={color}
      />
      <circle cx="8" cy="10.6" r="1.3" fill={color} />
    </svg>
  );
}

function BatteryGlyph({
  level,
  charging,
  color,
}: {
  level: number;
  charging: boolean;
  color: string;
}) {
  const lvl = Math.max(0, Math.min(100, level));
  const w = (lvl / 100) * 18;
  const fill = lvl <= 20 ? '#ff453a' : color;
  return (
    <svg width="27" height="13" viewBox="0 0 27 13" fill="none" aria-hidden>
      <rect
        x="0.5"
        y="0.5"
        width="22"
        height="12"
        rx="3"
        stroke={color}
        strokeOpacity="0.4"
      />
      <rect x="2" y="2" width={w} height="9" rx="1.6" fill={fill} />
      <rect x="24" y="4" width="2.2" height="5" rx="1.1" fill={color} opacity="0.5" />
      {charging ? (
        <path d="M12 2l-3 5h2.2l-.6 4 3.4-5.4h-2.3L12 2z" fill="#34c759" />
      ) : null}
    </svg>
  );
}

/* ─────────────────────────── StatusBar ─────────────────────────── */

/**
 * Barra de status realista. `tone` = cor do texto/ícones (dark p/ fundo claro,
 * light p/ fundo escuro). Altura ~44px (iOS) / ~28px (Android), escalável via
 * `scale` (o palco é fixo, mas modelos maiores podem crescer a barra).
 */
export function StatusBar({
  cfg,
  tone = 'dark',
  scale = 1,
}: {
  cfg: StatusCfg;
  tone?: 'dark' | 'light';
  scale?: number;
}) {
  const color = tone === 'light' ? '#ffffff' : '#000000';
  const ios = cfg.os === 'ios';
  const h = (ios ? 44 : 28) * scale;
  const fs = (ios ? 15 : 13) * scale;

  const right = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 * scale }}>
      {cfg.airplane ? (
        <span style={{ fontSize: fs, color }}>✈</span>
      ) : (
        <>
          {cfg.network && !ios ? (
            <span style={{ fontSize: fs * 0.82, color, fontWeight: 600 }}>
              {cfg.network}
            </span>
          ) : null}
          <SignalBars n={cfg.signal} color={color} />
          {cfg.network && ios ? (
            <span style={{ fontSize: fs * 0.82, color, fontWeight: 600 }}>
              {cfg.network}
            </span>
          ) : null}
          {cfg.wifi ? <WifiGlyph color={color} /> : null}
        </>
      )}
      {!ios ? (
        <span style={{ fontSize: fs * 0.82, color, fontWeight: 600 }}>
          {Math.round(cfg.battery)}%
        </span>
      ) : null}
      <BatteryGlyph level={cfg.battery} charging={cfg.charging} color={color} />
    </div>
  );

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: h,
        padding: `0 ${(ios ? 26 : 16) * scale}px`,
        color,
        fontFamily: FONT_STACK,
        WebkitFontSmoothing: 'antialiased',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          fontSize: fs,
          fontWeight: ios ? 600 : 500,
          letterSpacing: ios ? '0.01em' : 0,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {ios ? cfg.time : `${cfg.carrier ? cfg.carrier + '  ' : ''}${cfg.time}`}
      </div>
      {right}
    </div>
  );
}

/* ─────────────────────── Controles (primitivos) ─────────────────────── */

const LBL: CSSProperties = {
  fontSize: 10.5,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.16em',
};

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="text-text-muted" style={{ ...LBL, fontFamily: 'var(--font-tech)' }}>
        {label}
      </span>
      <div className="mt-2">{children}</div>
      {hint ? <p className="mt-1 text-[11px] text-text-dim">{hint}</p> : null}
    </label>
  );
}

export function TextField({
  value,
  onChange,
  placeholder,
  maxLength,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  maxLength?: number;
}) {
  return (
    <input
      type="text"
      className="input-field"
      value={value}
      placeholder={placeholder}
      maxLength={maxLength}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function TextArea({
  value,
  onChange,
  placeholder,
  maxLength,
  rows = 3,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  maxLength?: number;
  rows?: number;
}) {
  return (
    <textarea
      className="input-field resize-y leading-relaxed"
      value={value}
      placeholder={placeholder}
      maxLength={maxLength}
      rows={rows}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="flex w-full items-center justify-between rounded-[12px] border border-line-strong bg-bg-soft/40 px-3.5 py-2.5 text-left transition hover:border-violet/40"
    >
      <span className="text-[13px] font-semibold text-white">{label}</span>
      <span
        className={
          'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 ' +
          (on ? 'bg-violet' : 'bg-line-strong')
        }
      >
        <span
          className="inline-block rounded-full bg-white shadow transition-transform duration-200"
          style={{ height: 18, width: 18, transform: on ? 'translateX(22px)' : 'translateX(3px)' }}
        />
      </span>
    </button>
  );
}

export function RangeField({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  display,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  display?: (v: number) => string;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-text-muted" style={{ ...LBL, fontFamily: 'var(--font-tech)' }}>
          {label}
        </span>
        <span className="text-[12px] font-semibold text-white" style={{ fontFamily: 'var(--font-mono)' }}>
          {display ? display(value) : value}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-violet"
      />
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={
              'rounded-full border px-3.5 py-1.5 text-[12px] font-semibold transition-all duration-200 active:scale-[0.97] ' +
              (active
                ? 'border-violet/65 bg-violet/15 text-white'
                : 'border-line-strong text-text-muted hover:border-violet hover:text-white')
            }
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Swatches({
  value,
  colors,
  onChange,
}: {
  value: string;
  colors: string[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {colors.map((c) => {
        const active = value === c;
        return (
          <button
            key={c}
            type="button"
            aria-label={`Cor ${c}`}
            aria-pressed={active}
            onClick={() => onChange(c)}
            className={
              'h-9 w-9 rounded-full border-2 transition-all duration-200 active:scale-95 ' +
              (active ? 'border-white ring-2 ring-violet/70' : 'border-white/25 hover:border-white/60')
            }
            style={{ background: c }}
          />
        );
      })}
    </div>
  );
}

/**
 * Upload de imagem → devolve um data URL (fica só no navegador). html2canvas
 * rasteriza data URLs sem problema de CORS.
 */
export function ImageUpload({
  value,
  onChange,
  label = 'Imagem',
  round,
}: {
  value: string;
  onChange: (dataUrl: string) => void;
  label?: string;
  round?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const pick = (file?: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onChange(String(reader.result || ''));
    reader.readAsDataURL(file);
  };
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className={
          'relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden border border-line-strong bg-bg-soft/60 transition hover:border-violet/55 ' +
          (round ? 'rounded-full' : 'rounded-[12px]')
        }
      >
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt="" className="h-full w-full object-cover" />
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-text-muted" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="M21 15l-5-5L5 21" />
          </svg>
        )}
      </button>
      <div className="flex flex-col gap-1.5">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="rounded-full border border-line-strong px-3 py-1.5 text-[12px] font-semibold text-text-muted transition hover:border-violet/55 hover:text-white"
        >
          {value ? 'Trocar' : `Enviar ${label.toLowerCase()}`}
        </button>
        {value ? (
          <button
            type="button"
            onClick={() => onChange('')}
            className="text-left text-[11px] text-text-dim hover:text-red-300"
          >
            Remover
          </button>
        ) : null}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => pick(e.target.files?.[0])}
      />
    </div>
  );
}
