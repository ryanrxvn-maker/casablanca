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
/** Arranjo da CENA atrás do chyron: 1 quadro cheio, 2/3 quadros, ou PiP. */
export type NewsLayout = 'single' | 'duplo' | 'triplo' | 'pip';

/** Verde de chroma key (broadcast). */
export const NEWS_GREEN = '#00b140';
/** Fonte dos telejornais (sans forte). Reusa a stack do app. */
export const NEWS_FONT = FONT_STACK;
/** Largura de referência do design landscape — tudo escala a partir daqui. */
export const NEWS_REF_W = 640;
/** No 9:16 o chyron precisa ser MAIOR/mais evidente: referência menor => k maior. */
export const NEWS_REF_W_PORTRAIT = 384;

/** Campos de fundo/orientação/cena que TODO template de notícia carrega. */
export type NewsBg = {
  orient: NewsOrient;
  bgMode: NewsBgMode;
  bgImage: string; // dataURL (quadro 1)
  bgColor: string;
  green: string;
  layout: NewsLayout;
  box2: string; // dataURL (quadro 2)
  box3: string; // dataURL (quadro 3)
  pip: string; // dataURL (janelinha do repórter)
};

export const defaultNewsBg: NewsBg = {
  orient: 'landscape',
  bgMode: 'green',
  bgImage: '',
  bgColor: '#0c1a2b',
  green: NEWS_GREEN,
  layout: 'single',
  box2: '',
  box3: '',
  pip: '',
};

/** Dimensões do palco por orientação. 16:9 → 1920×1080; 9:16 → 1080×1920. */
export function newsDims(orient: NewsOrient): StageDims {
  return orient === 'portrait'
    ? { stageW: 360, ratio: 16 / 9, exportW: 1080 }
    : { stageW: 640, ratio: 9 / 16, exportW: 1920 };
}

/** Ajuda o template: largura/altura reais + fator de escala k (maior no 9:16). */
export function stageMetrics(orient: NewsOrient) {
  const d = newsDims(orient);
  const W = d.stageW;
  const H = Math.round(W * d.ratio);
  const ref = orient === 'portrait' ? NEWS_REF_W_PORTRAIT : NEWS_REF_W;
  return { W, H, k: W / ref, orient };
}

/* ─────────────────────────────── Palco ─────────────────────────────── */

/**
 * Palco da notícia: a "cena" (fundo) preenche o quadro todo e o chyron
 * (children) fica por cima. Fundo = imagem enviada (cover), cor sólida, ou
 * TELA VERDE. Imagem via CSS background raster (cover) — suportado no export.
 */
/** Fundo de um quadro: imagem (cover) ou a cor de preenchimento (verde/cor). */
function boxBg(img: string, fill: string): string {
  return img ? `url("${img}") center/cover no-repeat, ${fill}` : fill;
}

export function NewsStage({ bg, children }: { bg: NewsBg; children: ReactNode }) {
  const { W, H, orient } = stageMetrics(bg.orient);
  // fill = fundo dos quadros SEM imagem (verde de chroma por padrão, ou cor).
  const fill = bg.bgMode === 'solid' ? bg.bgColor : bg.green;
  const box1 = bg.bgMode === 'image' ? bg.bgImage : '';
  const layout = bg.layout ?? 'single';
  // No 9:16 sobe o chyron um tico pra não ficar colado na base.
  const lift = orient === 'portrait' ? Math.round(H * 0.05) : 0;
  const divider = Math.max(2, Math.round(W * 0.006));
  const pipW = Math.round(W * 0.3);
  return (
    <div
      style={{
        position: 'relative',
        width: W,
        height: H,
        overflow: 'hidden',
        background: fill,
        fontFamily: NEWS_FONT,
        WebkitFontSmoothing: 'antialiased',
        color: '#fff',
        // line-height REAL (não herda o 0 do palco): sem isso, os textos sem
        // line-height próprio ficam com caixa de altura 0 e as COLUNAS (LIVE+hora,
        // AO VIVO+cidade) COLAPSAM/sobrepõem já no navegador. Cada texto que precisa
        // de altura específica sobrescreve o seu.
        lineHeight: 1.1,
      }}
    >
      {/* CENA (atrás do chyron) */}
      {layout === 'duplo' ? (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', gap: divider, background: '#000' }}>
          <div style={{ flex: 1, background: boxBg(box1, fill) }} />
          <div style={{ flex: 1, background: boxBg(bg.box2, fill) }} />
        </div>
      ) : layout === 'triplo' ? (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', gap: divider, background: '#000' }}>
          <div style={{ flex: 1, background: boxBg(box1, fill) }} />
          <div style={{ flex: 1, background: boxBg(bg.box2, fill) }} />
          <div style={{ flex: 1, background: boxBg(bg.box3, fill) }} />
        </div>
      ) : (
        <div style={{ position: 'absolute', inset: 0, background: boxBg(box1, fill) }} />
      )}

      {/* CHYRON (leve lift no 9:16) */}
      <div style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: lift }}>{children}</div>

      {/* PiP (janelinha do repórter): desenhada POR CIMA do chyron e ACIMA dele,
          então fica 100% VERDE (chroma) — dá pra encaixar o repórter sem cortar. */}
      {layout === 'pip' ? (
        <div
          style={{
            position: 'absolute',
            right: Math.round(W * 0.035),
            bottom: Math.round(H * 0.34) + lift,
            width: pipW,
            height: Math.round((pipW * 9) / 16),
            borderRadius: Math.round(W * 0.012),
            overflow: 'hidden',
            border: `${Math.max(1, Math.round(W * 0.004))}px solid #ffffff`,
            background: boxBg(bg.pip, fill),
            boxShadow: '0 2px 10px rgba(0,0,0,0.4)',
          }}
        />
      ) : null}
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

/** Bloco de controles de fundo + orientação + cena, reusado por todos. */
export function NewsBgControls({ bg, set }: { bg: NewsBg; set: (p: any) => void }) {
  const layout = bg.layout ?? 'single';
  const multi = layout === 'duplo' || layout === 'triplo';
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
      <Field label="Layout da cena" hint="Quantos quadros/janelas atrás do chyron.">
        <Segmented
          value={layout}
          options={[
            { value: 'single', label: '1 quadro' },
            { value: 'duplo', label: '2 quadros' },
            { value: 'triplo', label: '3 quadros' },
            { value: 'pip', label: 'Repórter' },
          ]}
          onChange={(v) => set({ layout: v })}
        />
      </Field>
      <Field label={multi ? 'Fundo do quadro 1' : 'Fundo (a cena atrás dos gráficos)'}>
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
        <Field label={multi ? 'Imagem do quadro 1' : 'Imagem de fundo'} hint="Sua foto/cena atrás do chyron.">
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
      {/* Uploads dos quadros extras — vazio = tela verde (dá pra chroma). */}
      {layout === 'duplo' || layout === 'triplo' ? (
        <Field label="Imagem do quadro 2" hint="Vazio = verde (pra encaixar outro vídeo).">
          <ImageUpload value={bg.box2} onChange={(v) => set({ box2: v })} label="quadro 2" />
        </Field>
      ) : null}
      {layout === 'triplo' ? (
        <Field label="Imagem do quadro 3" hint="Vazio = verde.">
          <ImageUpload value={bg.box3} onChange={(v) => set({ box3: v })} label="quadro 3" />
        </Field>
      ) : null}
      {layout === 'pip' ? (
        <Field label="Imagem do repórter (PiP)" hint="Vazio = verde na janelinha.">
          <ImageUpload value={bg.pip} onChange={(v) => set({ pip: v })} label="repórter" />
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
