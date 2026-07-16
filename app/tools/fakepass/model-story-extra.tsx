'use client';

/**
 * FakePass — stickers EXTRAS de STORY.
 * Contagem Regressiva (dígitos em quadradinhos, fiel ao Instagram), Localização
 * (com temas) e Menção. Emojis renderizados como Apple.
 */

import { Field, TextField, Segmented, emojify, FONT_STACK, type FakeModel } from './shared';
import { STORY_W, STORY_RATIO, STORY_BGS, StoryStage, BgControls } from './story-kit';

/* ═══════════════════ Contagem Regressiva ═══════════════════ */

type CountdownState = { titulo: string; horas: string; minutos: string; segundos: string; bg: string };

const BOX_H = 55;

function DigitBox({ d }: { d: string }) {
  return (
    <div style={{ width: 38, height: BOX_H, borderRadius: 10, background: '#eef0f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 38, fontWeight: 700, color: '#2b2b2b', lineHeight: 1 }}>
      {d}
    </div>
  );
}

function DigitGroup({ value, label }: { value: string; label: string }) {
  const s = (value || '0').replace(/\D/g, '').padStart(2, '0').slice(-2);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 9 }}>
      <div style={{ display: 'flex', gap: 4 }}>
        <DigitBox d={s[0]} />
        <DigitBox d={s[1]} />
      </div>
      <span style={{ fontSize: 15, color: '#3a3a3a', fontWeight: 400, lineHeight: 1 }}>{label}</span>
    </div>
  );
}

// Colon com a MESMA altura das caixas → centraliza junto dos dígitos (não sobe).
function Colon() {
  return <div style={{ height: BOX_H, display: 'flex', alignItems: 'center', fontSize: 30, fontWeight: 700, color: '#2b2b2b', padding: '0 1px' }}>:</div>;
}

function CountdownSticker({ titulo, horas, minutos, segundos }: { titulo: string; horas: string; minutos: string; segundos: string }) {
  return (
    <div style={{ width: STORY_W * 0.92, borderRadius: 22, background: '#ffffff', boxShadow: '0 8px 26px rgba(0,0,0,0.18)', WebkitFontSmoothing: 'antialiased', fontFamily: FONT_STACK, padding: '18px 18px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 16 }}>
        <div style={{ fontSize: 23, fontWeight: 800, color: '#1a1a1a', lineHeight: 1.35, letterSpacing: '-0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 7 }}>
          {emojify(titulo, 'apple')}
        </div>
        <div style={{ width: 34, height: 34, borderRadius: '50%', border: '1.5px solid #c7c7c7', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#9a9a9a" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'center', gap: 4 }}>
        <DigitGroup value={horas} label="horas" />
        <Colon />
        <DigitGroup value={minutos} label="minutos" />
        <Colon />
        <DigitGroup value={segundos} label="segundos" />
      </div>
    </div>
  );
}

const IG_COUNTDOWN: FakeModel<CountdownState> = {
  id: 'ig-countdown', label: 'Contagem Regressiva', category: 'story', hue: 'rgba(120,80,220,0.42)',
  stageW: STORY_W, ratio: STORY_RATIO, exportW: 1080, usesPhone: false,
  defaultState: { titulo: 'LANÇAMENTO 🤩', horas: '22', minutos: '33', segundos: '13', bg: STORY_BGS[3].css },
  Controls: ({ s, set }) => (
    <div className="flex flex-col gap-4">
      <Field label="Título"><TextField value={s.titulo} onChange={(v) => set({ titulo: v })} placeholder="LANÇAMENTO 🤩" maxLength={40} withEmoji /></Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Horas"><TextField value={s.horas} onChange={(v) => set({ horas: v })} placeholder="22" maxLength={2} /></Field>
        <Field label="Minutos"><TextField value={s.minutos} onChange={(v) => set({ minutos: v })} placeholder="33" maxLength={2} /></Field>
        <Field label="Segundos"><TextField value={s.segundos} onChange={(v) => set({ segundos: v })} placeholder="13" maxLength={2} /></Field>
      </div>
      <BgControls bg={s.bg} set={set} />
    </div>
  ),
  Preview: ({ s }) => (
    <StoryStage bg={s.bg}>
      <CountdownSticker titulo={s.titulo} horas={s.horas} minutos={s.minutos} segundos={s.segundos} />
    </StoryStage>
  ),
};

/* ═══════════════════ Localização (temas fiéis) ═══════════════════ */

type LocationState = { local: string; tema: string; bg: string };

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
      <span style={{ fontSize: 16, fontWeight: 600, color: t.rainbow ? undefined : t.text, lineHeight: 1.4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', letterSpacing: t.upper ? '0.02em' : 0 }}>
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
      <span style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
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
