'use client';

/**
 * FakePass — stickers EXTRAS de STORY.
 * Contagem Regressiva, Localização (com temas fiéis ao Instagram) e Menção.
 */

import { FitText, Field, TextField, Segmented, FONT_STACK, type FakeModel } from './shared';
import { STORY_W, STORY_RATIO, STORY_BGS, StoryStage, BgControls } from './story-kit';

/* ═══════════════════ Contagem Regressiva ═══════════════════ */

type CountdownState = { titulo: string; dias: string; horas: string; min: string; bg: string };

function CountdownBlock({ num, label }: { num: string; label: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
      <span style={{ fontSize: 30, fontWeight: 700, color: '#262626', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
        {num || '00'}
      </span>
      <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#8e8e8e', marginTop: 6 }}>
        {label}
      </span>
    </div>
  );
}

function CountdownSticker({ titulo, dias, horas, min }: { titulo: string; dias: string; horas: string; min: string }) {
  return (
    <div style={{ width: STORY_W * 0.78, borderRadius: 16, background: 'rgba(255,255,255,0.9)', boxShadow: '0 8px 24px rgba(0,0,0,0.16)', WebkitFontSmoothing: 'antialiased', fontFamily: FONT_STACK, padding: 16 }}>
      <FitText maxPx={16} minPx={11} maxHeight={STORY_W * 0.22} style={{ color: '#262626', textAlign: 'center', fontWeight: 600, lineHeight: 1.25, letterSpacing: '0.02em', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {titulo}
      </FitText>
      <div style={{ display: 'flex', alignItems: 'flex-start', marginTop: 14 }}>
        <CountdownBlock num={dias} label="Dias" />
        <CountdownBlock num={horas} label="Horas" />
        <CountdownBlock num={min} label="Min" />
      </div>
    </div>
  );
}

const IG_COUNTDOWN: FakeModel<CountdownState> = {
  id: 'ig-countdown', label: 'Contagem Regressiva', category: 'story', hue: 'rgba(120,80,220,0.42)',
  stageW: STORY_W, ratio: STORY_RATIO, exportW: 1080, usesPhone: false,
  defaultState: { titulo: 'LANÇAMENTO', dias: '02', horas: '14', min: '30', bg: STORY_BGS[3].css },
  Controls: ({ s, set }) => (
    <div className="flex flex-col gap-4">
      <Field label="Título"><TextField value={s.titulo} onChange={(v) => set({ titulo: v })} placeholder="LANÇAMENTO" maxLength={40} /></Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Dias"><TextField value={s.dias} onChange={(v) => set({ dias: v })} placeholder="02" maxLength={3} /></Field>
        <Field label="Horas"><TextField value={s.horas} onChange={(v) => set({ horas: v })} placeholder="14" maxLength={3} /></Field>
        <Field label="Min"><TextField value={s.min} onChange={(v) => set({ min: v })} placeholder="30" maxLength={3} /></Field>
      </div>
      <BgControls bg={s.bg} set={set} />
    </div>
  ),
  Preview: ({ s }) => (
    <StoryStage bg={s.bg}>
      <CountdownSticker titulo={s.titulo} dias={s.dias} horas={s.horas} min={s.min} />
    </StoryStage>
  ),
};

/* ═══════════════════ Localização (temas fiéis) ═══════════════════ */

type LocationState = { local: string; tema: string; bg: string };

// Temas conforme as variações reais do sticker de localização do Instagram.
const LOC_THEMES: Record<string, { pill: string; pin: string; text: string; upper: boolean; rainbow: boolean }> = {
  preto:     { pill: '#ffffff', pin: '#262626', text: '#262626', upper: true,  rainbow: false },
  roxo:      { pill: '#ffffff', pin: '#8b3dff', text: '#8b3dff', upper: true,  rainbow: false },
  gradiente: { pill: '#ffffff', pin: 'grad',    text: '#262626', upper: true,  rainbow: false },
  escuro:    { pill: '#2b2b2b', pin: '#ffffff', text: '#ffffff', upper: false, rainbow: false },
  colorido:  { pill: '#ffffff', pin: '#ed4956', text: '#262626', upper: false, rainbow: true },
};
const LOC_ORDER = ['preto', 'roxo', 'gradiente', 'escuro', 'colorido'];
const LOC_LABEL: Record<string, string> = { preto: 'Preto', roxo: 'Roxo', gradiente: 'Gradiente', escuro: 'Escuro', colorido: 'Colorido' };
const RAINBOW = ['#ed4956', '#f7773a', '#fcaf45', '#4caf50', '#35b8e0', '#8b3dff'];

function rainbowText(text: string) {
  let ci = 0;
  return [...text].map((ch, i) =>
    ch === ' ' ? (
      <span key={i}>&nbsp;</span>
    ) : (
      <span key={i} style={{ color: RAINBOW[ci++ % RAINBOW.length] }}>{ch}</span>
    ),
  );
}

function Pin({ color, inner }: { color: string; inner: string }) {
  const fill = color === 'grad' ? 'url(#fp-loc-grad)' : color;
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden style={{ flexShrink: 0 }}>
      {color === 'grad' ? (
        <defs>
          <linearGradient id="fp-loc-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#feda75" /><stop offset="35%" stopColor="#fa7e1e" /><stop offset="70%" stopColor="#d62976" /><stop offset="100%" stopColor="#962fbf" />
          </linearGradient>
        </defs>
      ) : null}
      <path d="M12 2c-3.87 0-7 3.13-7 7 0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" fill={fill} />
      <circle cx="12" cy="9" r="2.6" fill={inner} />
    </svg>
  );
}

function LocationSticker({ local, tema }: { local: string; tema: string }) {
  const t = LOC_THEMES[tema] ?? LOC_THEMES.preto;
  const txt = (t.upper ? (local || '').toUpperCase() : local || '') || ' ';
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, maxWidth: STORY_W * 0.86, background: t.pill, borderRadius: 999, padding: '9px 16px', boxShadow: '0 8px 24px rgba(0,0,0,0.16)', WebkitFontSmoothing: 'antialiased', fontFamily: FONT_STACK }}>
      <Pin color={t.pin} inner={t.pill} />
      <span style={{ fontSize: 16, fontWeight: 600, color: t.rainbow ? undefined : t.text, lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', letterSpacing: t.upper ? '0.02em' : 0 }}>
        {t.rainbow ? rainbowText(txt) : txt}
      </span>
    </div>
  );
}

const IG_LOCATION: FakeModel<LocationState> = {
  id: 'ig-location', label: 'Localização', category: 'story', hue: 'rgba(80,180,255,0.42)',
  stageW: STORY_W, ratio: STORY_RATIO, exportW: 1080, usesPhone: false,
  defaultState: { local: 'São Paulo, Brasil', tema: 'gradiente', bg: STORY_BGS[5].css },
  Controls: ({ s, set }) => (
    <div className="flex flex-col gap-4">
      <Field label="Localização"><TextField value={s.local} onChange={(v) => set({ local: v })} placeholder="São Paulo, Brasil" maxLength={60} /></Field>
      <Field label="Estilo"><Segmented value={s.tema} options={LOC_ORDER.map((k) => ({ value: k, label: LOC_LABEL[k] }))} onChange={(v) => set({ tema: v })} /></Field>
      <BgControls bg={s.bg} set={set} />
    </div>
  ),
  Preview: ({ s }) => (
    <StoryStage bg={s.bg}>
      <LocationSticker local={s.local} tema={s.tema} />
    </StoryStage>
  ),
};

/* ═══════════════════ Menção (sem avatar, @ colorido) ═══════════════════ */

type MentionState = { usuario: string; bg: string };

function MentionSticker({ usuario }: { usuario: string }) {
  const h = (usuario || '').replace(/^@+/, '') || 'usuario';
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', maxWidth: STORY_W * 0.86, background: '#ffffff', borderRadius: 8, padding: '9px 18px', boxShadow: '0 8px 24px rgba(0,0,0,0.16)', WebkitFontSmoothing: 'antialiased', fontFamily: FONT_STACK }}>
      <span style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        <span style={{ color: '#fa7e1e' }}>@</span>
        <span style={{ color: '#262626' }}>{h}</span>
      </span>
    </div>
  );
}

const IG_MENTION: FakeModel<MentionState> = {
  id: 'ig-mention', label: 'Menção', category: 'story', hue: 'rgba(250,126,30,0.42)',
  stageW: STORY_W, ratio: STORY_RATIO, exportW: 1080, usesPhone: false,
  defaultState: { usuario: 'seu_user', bg: STORY_BGS[5].css },
  Controls: ({ s, set }) => (
    <div className="flex flex-col gap-4">
      <Field label="Usuário" hint="O @ é adicionado automaticamente."><TextField value={s.usuario} onChange={(v) => set({ usuario: v })} placeholder="seu_user" maxLength={30} /></Field>
      <BgControls bg={s.bg} set={set} />
    </div>
  ),
  Preview: ({ s }) => (
    <StoryStage bg={s.bg}>
      <MentionSticker usuario={s.usuario} />
    </StoryStage>
  ),
};

export default [IG_COUNTDOWN, IG_LOCATION, IG_MENTION];
