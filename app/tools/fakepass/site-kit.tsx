'use client';

/**
 * FakePass — KIT dos SITES DE NOTÍCIA (páginas de portal).
 *
 * Infra compartilhada pelos templates de portal (BBC, Reuters, AP, CNN,
 * Guardian, Al Jazeera, G1, Folha, UOL, Estadão, O Globo…). Cada portal vive
 * num arquivo model-site-*.tsx e desenha seu PRÓPRIO masthead/tipografia; aqui
 * ficam: o quadro da página (SiteFrame), a barra de navegação genérica
 * (SiteNav), a imagem-hero com opção de TELA VERDE (HeroBox), os controles e as
 * fontes. Recria o LAYOUT do site; todo texto é placeholder editável.
 */

import { createContext, useContext, type ReactNode, type CSSProperties } from 'react';
import { Field, Segmented, ImageUpload, Swatches, TextField, FONT_STACK, type StageDims } from './shared';
import { NEWS_GREEN } from './news-kit';

/* ─────────────────────────── Tipos / dimensões ─────────────────────────── */

export type SiteHeroMode = 'image' | 'green' | 'color';

/** Formato do print: desktop (clássico), 9:16 (Story), 16:9 (TV) e 4:5 (Feed). */
export type SiteFormat = 'desktop' | 'portrait' | 'landscape' | 'feed45';

/** Fundo da imagem-hero que TODO template de site carrega no estado. */
export type SiteBg = {
  format: SiteFormat;
  heroMode: SiteHeroMode;
  heroImage: string;
  heroColor: string;
  green: string;
};

export const defaultSiteBg: SiteBg = {
  format: 'desktop',
  heroMode: 'green',
  heroImage: '',
  heroColor: '#c9d2da',
  green: NEWS_GREEN,
};

/** Campos de artigo comuns a todos os portais. */
export type SiteArticle = SiteBg & {
  category: string;
  headline: string;
  standfirst: string;
  author: string;
  time: string;
  body: string;
};

export const defaultSiteArticle: SiteArticle = {
  ...defaultSiteBg,
  category: 'World',
  headline: 'Governments meet to discuss new global measures',
  standfirst: 'Leaders gathered to address the developing situation as analysts weigh the likely impact.',
  author: 'By Jordan Avery',
  time: '2 hours ago',
  body: 'Officials confirmed the talks would continue through the week, with further statements expected. Observers said the outcome could shape policy for months to come.',
};

export const SITE_SANS = FONT_STACK;
export const SITE_SERIF = "Georgia, 'Times New Roman', 'Noto Serif', 'PT Serif', serif";

/** Largura da COLUNA do artigo (o design de todos os templates vive nela). */
export const SITE_W = 760;

/**
 * Dimensões do PALCO por formato. O design do artigo é sempre a coluna de até
 * 760px — os formatos só mudam o QUADRO em volta (corte/moldura), então a
 * tipografia de cada portal fica idêntica em todos:
 *  • desktop  → 760×939  (print clássico; export 1520×1878)
 *  • portrait → 540×960  (coluna mobile; export 1080×1920)
 *  • feed45   → 760×950  (mesmo design, corte 4:5; export 1080×1350)
 *  • landscape→ 1280×720 (coluna 760 centrada, como no navegador; export 1920×1080)
 */
export function siteDims(format: SiteFormat = 'desktop'): StageDims {
  if (format === 'portrait') return { stageW: 540, ratio: 16 / 9, exportW: 1080 };
  if (format === 'landscape') return { stageW: 1280, ratio: 9 / 16, exportW: 1920 };
  if (format === 'feed45') return { stageW: 760, ratio: 5 / 4, exportW: 1080 };
  return { stageW: SITE_W, ratio: 1.235, exportW: 1520 };
}

/** Largura da COLUNA (o W que os templates usam pra desenhar) + altura do quadro. */
export function siteMetrics(format: SiteFormat = 'desktop') {
  const d = siteDims(format);
  const W = Math.min(d.stageW, SITE_W);
  const H = Math.round(d.stageW * d.ratio);
  return { W, H, k: 1 };
}

/** Formato corrente do quadro — o SiteNav usa pra virar nav compacta no 9:16. */
const SiteFormatCtx = createContext<SiteFormat>('desktop');

/* ─────────────────────────────── Quadro ─────────────────────────────── */

/** Página branca (recorte de topo do artigo), altura fixa com overflow hidden.
 *  `format` muda o QUADRO: no 16:9 a coluna de 760 sai centrada (navegador);
 *  no 9:16 a coluna é 540 (mobile) e o SiteNav compacta sozinho via contexto. */
export function SiteFrame({
  children,
  format = 'desktop',
  bg = '#ffffff',
  color = '#111111',
  font = SITE_SANS,
}: {
  children: ReactNode;
  format?: SiteFormat;
  bg?: string;
  color?: string;
  font?: string;
}) {
  const d = siteDims(format);
  const frameW = d.stageW;
  const frameH = Math.round(d.stageW * d.ratio);
  const colW = Math.min(frameW, SITE_W);
  return (
    <div
      style={{
        width: frameW,
        height: frameH,
        overflow: 'hidden',
        background: bg,
        color,
        fontFamily: font,
        WebkitFontSmoothing: 'antialiased',
        position: 'relative',
      }}
    >
      <SiteFormatCtx.Provider value={format}>
        <div style={{ width: colW, margin: '0 auto', display: 'flex', flexDirection: 'column' }}>
          {children}
        </div>
      </SiteFormatCtx.Provider>
    </div>
  );
}

/* ─────────────────────────── Barra de navegação ─────────────────────────── */

export function SiteNav({
  logo,
  items,
  bg = '#ffffff',
  color = '#222222',
  border = '#e4e4e4',
  right,
  height,
  fontSize,
}: {
  logo: ReactNode;
  items?: string[];
  bg?: string;
  color?: string;
  border?: string;
  right?: ReactNode;
  height?: number;
  fontSize?: number;
}) {
  // 9:16 (mobile): menu de itens não cabe — vira HAMBÚRGUER + logo, como os
  // portais reais no celular. Nenhum template precisa saber disso (contexto).
  const compact = useContext(SiteFormatCtx) === 'portrait';
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: compact ? 12 : 16,
        padding: '0 18px',
        height: height ?? 52,
        background: bg,
        color,
        borderBottom: `1px solid ${border}`,
        flexShrink: 0,
      }}
    >
      {compact ? (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" aria-hidden>
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      ) : null}
      {logo}
      {items && items.length && !compact ? (
        <div style={{ display: 'flex', gap: 16, fontSize: fontSize ?? 13.5, fontWeight: 700, lineHeight: 1, marginLeft: 6, overflow: 'hidden', whiteSpace: 'nowrap' }}>
          {items.map((it, i) => (
            <span key={i} style={{ lineHeight: 1 }}>{it}</span>
          ))}
        </div>
      ) : null}
      {/* lineHeight 1: os chips (Entrar/Assine/Sign in) herdavam o line-height 0
          do palco → pílula de ~8px com o glifo transbordando; o html2canvas
          ancorava o texto diferente e ele saía AFUNDADO/cortado no PNG. Com o
          line box definido, prévia e download desenham igual. */}
      {right ? <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12, lineHeight: 1 }}>{right}</div> : null}
    </div>
  );
}

/* ─────────────────────────── Imagem-hero (chroma) ─────────────────────────── */

/** Área de imagem principal. `heroMode` verde = chroma pra compositar. */
export function HeroBox({
  bg,
  w,
  h,
  children,
  style,
}: {
  bg: SiteBg;
  w: number;
  h: number;
  children?: ReactNode;
  style?: CSSProperties;
}) {
  const fill = bg.heroMode === 'color' ? bg.heroColor : bg.green;
  const img = bg.heroMode === 'image' ? bg.heroImage : '';
  return (
    <div
      style={{
        position: 'relative',
        width: w,
        height: h,
        overflow: 'hidden',
        background: img ? `url("${img}") center/cover no-repeat, ${fill}` : fill,
        flexShrink: 0,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/* ────────────────────────── Controles do fundo ────────────────────────── */

function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="relative inline-flex h-9 w-9 cursor-pointer items-center justify-center overflow-hidden rounded-full border-2 border-white/25">
      <span className="absolute inset-0" style={{ background: value }} />
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
    </label>
  );
}

/** Controles da imagem-hero (verde chroma / imagem / cor). Reusado por todos. */
export function SiteBgControls({ bg, set }: { bg: SiteBg; set: (p: any) => void }) {
  return (
    <div className="flex flex-col gap-4">
      <Field label="Formato" hint="Todos exportam em alta e alinhados — o design do artigo é o mesmo.">
        <Segmented
          value={bg.format ?? 'desktop'}
          options={[
            { value: 'desktop', label: 'Desktop' },
            { value: 'portrait', label: '9:16 (Story)' },
            { value: 'feed45', label: '4:5 (Feed)' },
            { value: 'landscape', label: '16:9 (TV)' },
          ]}
          onChange={(v) => set({ format: v })}
        />
      </Field>
      <Field label="Imagem principal (hero)" hint="Verde = chroma key pra encaixar sua imagem/vídeo.">
        <Segmented
          value={bg.heroMode}
          options={[
            { value: 'green', label: 'Tela verde' },
            { value: 'image', label: 'Imagem' },
            { value: 'color', label: 'Cor' },
          ]}
          onChange={(v) => set({ heroMode: v })}
        />
      </Field>
      {bg.heroMode === 'image' ? (
        <Field label="Imagem do hero">
          <ImageUpload value={bg.heroImage} onChange={(v) => set({ heroImage: v })} label="imagem" />
        </Field>
      ) : null}
      {bg.heroMode === 'color' ? (
        <Field label="Cor do hero">
          <div className="flex items-center gap-2.5">
            <ColorInput value={bg.heroColor} onChange={(v) => set({ heroColor: v })} />
            <Swatches value={bg.heroColor} colors={['#c9d2da', '#1a1a1a', '#0a3d62', '#b0413e', '#2e7d32']} onChange={(v) => set({ heroColor: v })} />
          </div>
        </Field>
      ) : null}
      {bg.heroMode === 'green' ? (
        <Field label="Tom do verde">
          <Swatches value={bg.green} colors={[NEWS_GREEN, '#00ff00', '#009e3a', '#3cb043']} onChange={(v) => set({ green: v })} />
        </Field>
      ) : null}
    </div>
  );
}

/** Campos de artigo padrão (categoria/manchete/dek/autor/hora/corpo). */
export function ArticleFields({
  s,
  set,
  serifNote,
}: {
  s: SiteArticle;
  set: (p: any) => void;
  serifNote?: boolean;
}) {
  return (
    <>
      <Field label="Categoria / editoria"><TextField value={s.category} onChange={(v) => set({ category: v })} placeholder="World" maxLength={40} /></Field>
      <Field label="Manchete"><TextField value={s.headline} onChange={(v) => set({ headline: v })} placeholder="Manchete do artigo" maxLength={140} /></Field>
      <Field label="Linha de apoio (dek)"><TextField value={s.standfirst} onChange={(v) => set({ standfirst: v })} placeholder="Resumo abaixo da manchete" maxLength={200} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Autor"><TextField value={s.author} onChange={(v) => set({ author: v })} placeholder="By Jane Doe" maxLength={50} /></Field>
        <Field label="Quando"><TextField value={s.time} onChange={(v) => set({ time: v })} placeholder="2 hours ago" maxLength={30} /></Field>
      </div>
      <Field label="Primeiro parágrafo"><TextField value={s.body} onChange={(v) => set({ body: v })} placeholder="Texto do corpo" maxLength={320} /></Field>
    </>
  );
}
