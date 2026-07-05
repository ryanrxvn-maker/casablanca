'use client';

/**
 * FakePass — KIT das NOTÍCIAS (telejornais / breaking news).
 *
 * Infra compartilhada por todos os templates de emissora (CNN, BBC, Fox, MSNBC,
 * GloboNews, CNN Brasil, Band News, …). Cada emissora vive num arquivo próprio
 * (model-news-*.tsx) e desenha seu PRÓPRIO lower-third/chyron; aqui ficam:
 *  • dimensões por orientação (16:9 ↔ 9:16) — o palco alterna pelo estado;
 *  • o PALCO com a "cena" atrás (imagem enviada / cor / TELA VERDE p/ chroma);
 *  • os controles de fundo + orientação;
 *  • primitivos reusáveis (Ticker, LiveTag, Clock, parseItems).
 *
 * Tudo no chyron deve escalar por `k = W / NEWS_REF_W` pra 16:9 e 9:16 saírem
 * proporcionais SEM bug de proporção.
 */

import type { ReactNode, CSSProperties } from 'react';
import { Field, Segmented, ImageUpload, Swatches, FONT_STACK, type StageDims } from './shared';

/* ─────────────────────────── Tipos / dimensões ─────────────────────────── */

export type NewsOrient = 'landscape' | 'portrait';
export type NewsBgMode = 'image' | 'solid' | 'green';

/** Verde de chroma key (broadcast). */
export const NEWS_GREEN = '#00b140';
/** Fonte dos telejornais (sans forte). Reusa a stack do app. */
export const NEWS_FONT = FONT_STACK;
/** Largura de referência do design landscape — tudo escala a partir daqui. */
export const NEWS_REF_W = 640;

/** Campos de fundo/orientação que TODO template de notícia carrega no estado. */
export type NewsBg = {
  orient: NewsOrient;
  bgMode: NewsBgMode;
  bgImage: string; // dataURL
  bgColor: string;
  green: string;
};

export const defaultNewsBg: NewsBg = {
  orient: 'landscape',
  bgMode: 'green',
  bgImage: '',
  bgColor: '#0c1a2b',
  green: NEWS_GREEN,
};

/** Dimensões do palco por orientação. 16:9 → 1920×1080; 9:16 → 1080×1920. */
export function newsDims(orient: NewsOrient): StageDims {
  return orient === 'portrait'
    ? { stageW: 338, ratio: 16 / 9, exportW: 1080 }
    : { stageW: 640, ratio: 9 / 16, exportW: 1920 };
}

/** Ajuda o template: largura/altura reais + fator de escala k. */
export function stageMetrics(orient: NewsOrient) {
  const d = newsDims(orient);
  const W = d.stageW;
  const H = Math.round(W * d.ratio);
  return { W, H, k: W / NEWS_REF_W, orient };
}

/* ─────────────────────────────── Palco ─────────────────────────────── */

/**
 * Palco da notícia: a "cena" (fundo) preenche o quadro todo e o chyron
 * (children) fica por cima. Fundo = imagem enviada (cover), cor sólida, ou
 * TELA VERDE. Imagem via CSS background raster (cover) — suportado no export.
 */
export function NewsStage({ bg, children }: { bg: NewsBg; children: ReactNode }) {
  const { W, H } = stageMetrics(bg.orient);
  const solid = bg.bgMode === 'green' ? bg.green : bg.bgMode === 'solid' ? bg.bgColor : '#0e1216';
  const withImg =
    bg.bgMode === 'image' && bg.bgImage
      ? `url("${bg.bgImage}") center/cover no-repeat`
      : '';
  return (
    <div
      style={{
        position: 'relative',
        width: W,
        height: H,
        overflow: 'hidden',
        background: withImg ? `${withImg}, ${solid}` : solid,
        backgroundColor: solid,
        fontFamily: NEWS_FONT,
        WebkitFontSmoothing: 'antialiased',
        color: '#fff',
      }}
    >
      {children}
    </div>
  );
}

/* ────────────────────────── Controles de fundo ────────────────────────── */

function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="relative inline-flex h-9 w-9 cursor-pointer items-center justify-center overflow-hidden rounded-full border-2 border-white/25">
      <span className="absolute inset-0" style={{ background: value }} />
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
    </label>
  );
}

/** Bloco de controles de fundo + orientação, reusado por todos os templates. */
export function NewsBgControls({ bg, set }: { bg: NewsBg; set: (p: any) => void }) {
  return (
    <div className="flex flex-col gap-4">
      <Field label="Formato" hint="Ambos exportam em alta, sem distorcer.">
        <Segmented
          value={bg.orient}
          options={[
            { value: 'landscape', label: '16:9 (TV)' },
            { value: 'portrait', label: '9:16 (Reels)' },
          ]}
          onChange={(v) => set({ orient: v })}
        />
      </Field>
      <Field label="Fundo (a cena atrás dos gráficos)">
        <Segmented
          value={bg.bgMode}
          options={[
            { value: 'green', label: 'Tela verde' },
            { value: 'image', label: 'Imagem' },
            { value: 'solid', label: 'Cor' },
          ]}
          onChange={(v) => set({ bgMode: v })}
        />
      </Field>
      {bg.bgMode === 'image' ? (
        <Field label="Imagem de fundo" hint="Sua foto/cena atrás do chyron.">
          <ImageUpload value={bg.bgImage} onChange={(v) => set({ bgImage: v })} label="imagem" />
        </Field>
      ) : null}
      {bg.bgMode === 'solid' ? (
        <Field label="Cor do fundo">
          <div className="flex items-center gap-2.5">
            <ColorInput value={bg.bgColor} onChange={(v) => set({ bgColor: v })} />
            <Swatches value={bg.bgColor} colors={['#0c1a2b', '#111827', '#0e1216', '#1a1a1a', '#0a3d62']} onChange={(v) => set({ bgColor: v })} />
          </div>
        </Field>
      ) : null}
      {bg.bgMode === 'green' ? (
        <Field label="Tom do verde" hint="Padrão de chroma key broadcast.">
          <Swatches value={bg.green} colors={[NEWS_GREEN, '#00ff00', '#009e3a', '#3cb043']} onChange={(v) => set({ green: v })} />
        </Field>
      ) : null}
    </div>
  );
}

/* ─────────────────────────── Primitivos ─────────────────────────── */

/** Divide "a | b | c" (ou linhas) em itens da barra de manchetes/ticker. */
export function parseItems(txt: string): string[] {
  return txt
    .split(/\n|\s\|\s/g)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Tag "LIVE / AO VIVO" com bolinha opcional. */
export function LiveTag({
  text = 'LIVE',
  bg = '#c8102e',
  color = '#fff',
  dot = true,
  k = 1,
  style,
}: {
  text?: string;
  bg?: string;
  color?: string;
  dot?: boolean;
  k?: number;
  style?: CSSProperties;
}) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5 * k,
        background: bg,
        color,
        fontWeight: 800,
        fontSize: 13 * k,
        letterSpacing: 0.5 * k,
        padding: `${3 * k}px ${7 * k}px`,
        lineHeight: 1,
        ...style,
      }}
    >
      {dot ? <span style={{ width: 7 * k, height: 7 * k, borderRadius: '50%', background: color, display: 'inline-block' }} /> : null}
      {text}
    </span>
  );
}

/** Relógio/tempo simples. */
export function Clock({ text, color = '#fff', k = 1, style }: { text: string; color?: string; k?: number; style?: CSSProperties }) {
  return (
    <span style={{ color, fontWeight: 700, fontSize: 13 * k, fontVariantNumeric: 'tabular-nums', letterSpacing: 0.3 * k, ...style }}>
      {text}
    </span>
  );
}

/**
 * Ticker genérico (rodapé com itens separados). Cada emissora pode usar ou
 * desenhar o seu. `labelText` = caixinha à esquerda (ex.: "URGENT UPDATES").
 */
export function Ticker({
  items,
  k = 1,
  bg = '#0a2a5e',
  color = '#fff',
  labelText,
  labelBg = '#c8102e',
  sep = '•',
  sepColor,
  height,
  fontSize,
}: {
  items: string[];
  k?: number;
  bg?: string;
  color?: string;
  labelText?: string;
  labelBg?: string;
  sep?: string;
  sepColor?: string;
  height?: number;
  fontSize?: number;
}) {
  const h = height ?? 30 * k;
  const fs = fontSize ?? 13 * k;
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', height: h, background: bg, color, width: '100%', overflow: 'hidden' }}>
      {labelText ? (
        <div style={{ display: 'flex', alignItems: 'center', background: labelBg, padding: `0 ${10 * k}px`, fontWeight: 800, fontSize: fs, letterSpacing: 0.4 * k, whiteSpace: 'nowrap' }}>
          {labelText}
        </div>
      ) : null}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 * k, padding: `0 ${12 * k}px`, fontSize: fs, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', flex: 1 }}>
        {items.map((it, i) => (
          <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 * k }}>
            {i > 0 ? <span style={{ color: sepColor ?? 'rgba(255,255,255,0.5)' }}>{sep}</span> : null}
            <span>{it}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
