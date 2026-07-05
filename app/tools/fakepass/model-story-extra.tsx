'use client';

/**
 * FakePass — stickers EXTRAS de STORY.
 * Contagem Regressiva, Localização e Menção. Todos sobre o StoryStage
 * (fundo colorido) e com fundo personalizável via BgControls.
 */

import { FitText, Field, TextField, ImageUpload, FONT_STACK, type FakeModel } from './shared';
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
    <div
      style={{
        width: STORY_W * 0.78,
        borderRadius: 16,
        background: 'rgba(255,255,255,0.9)',
        boxShadow: '0 8px 24px rgba(0,0,0,0.16)',
        WebkitFontSmoothing: 'antialiased',
        fontFamily: FONT_STACK,
        padding: 16,
      }}
    >
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

/* ═══════════════════ Localização ═══════════════════ */

type LocationState = { local: string; bg: string };

function PinIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden style={{ flexShrink: 0 }}>
      <defs>
        <linearGradient id="fp-loc-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#feda75" />
          <stop offset="35%" stopColor="#fa7e1e" />
          <stop offset="70%" stopColor="#d62976" />
          <stop offset="100%" stopColor="#962fbf" />
        </linearGradient>
      </defs>
      <path
        d="M12 2c-3.87 0-7 3.13-7 7 0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"
        fill="url(#fp-loc-grad)"
      />
      <circle cx="12" cy="9" r="2.6" fill="#fff" />
    </svg>
  );
}

function LocationSticker({ local }: { local: string }) {
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        maxWidth: STORY_W * 0.86,
        background: '#fff',
        borderRadius: 999,
        padding: '8px 14px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.16)',
        WebkitFontSmoothing: 'antialiased',
        fontFamily: FONT_STACK,
      }}
    >
      <PinIcon />
      <span style={{ fontSize: 16, fontWeight: 600, color: '#262626', lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {local || ' '}
      </span>
    </div>
  );
}

const IG_LOCATION: FakeModel<LocationState> = {
  id: 'ig-location', label: 'Localização', category: 'story', hue: 'rgba(80,180,255,0.42)',
  stageW: STORY_W, ratio: STORY_RATIO, exportW: 1080, usesPhone: false,
  defaultState: { local: 'São Paulo, Brasil', bg: STORY_BGS[1].css },
  Controls: ({ s, set }) => (
    <div className="flex flex-col gap-4">
      <Field label="Localização"><TextField value={s.local} onChange={(v) => set({ local: v })} placeholder="São Paulo, Brasil" maxLength={60} /></Field>
      <BgControls bg={s.bg} set={set} />
    </div>
  ),
  Preview: ({ s }) => (
    <StoryStage bg={s.bg}>
      <LocationSticker local={s.local} />
    </StoryStage>
  ),
};

/* ═══════════════════ Menção ═══════════════════ */

type MentionState = { usuario: string; avatar: string; bg: string };

function MentionSticker({ usuario, avatar }: { usuario: string; avatar: string }) {
  const handle = '@' + (usuario || '').replace(/^@+/, '');
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        maxWidth: STORY_W * 0.86,
        background: '#fff',
        borderRadius: 12,
        padding: '6px 12px 6px 6px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.16)',
        WebkitFontSmoothing: 'antialiased',
        fontFamily: FONT_STACK,
      }}
    >
      <div
        style={{
          width: 30,
          height: 30,
          borderRadius: '50%',
          overflow: 'hidden',
          flexShrink: 0,
          background: '#dbdbdb',
          backgroundImage: avatar ? `url(${avatar})` : undefined,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      />
      <span style={{ fontSize: 16, fontWeight: 600, color: '#262626', lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {handle}
      </span>
    </div>
  );
}

const IG_MENTION: FakeModel<MentionState> = {
  id: 'ig-mention', label: 'Menção', category: 'story', hue: 'rgba(250,126,30,0.42)',
  stageW: STORY_W, ratio: STORY_RATIO, exportW: 1080, usesPhone: false,
  defaultState: { usuario: 'seu_user', avatar: '', bg: STORY_BGS[5].css },
  Controls: ({ s, set }) => (
    <div className="flex flex-col gap-4">
      <Field label="Usuário" hint="O @ é adicionado automaticamente."><TextField value={s.usuario} onChange={(v) => set({ usuario: v })} placeholder="seu_user" maxLength={30} /></Field>
      <Field label="Foto do perfil"><ImageUpload value={s.avatar} onChange={(v) => set({ avatar: v })} label="foto" round /></Field>
      <BgControls bg={s.bg} set={set} />
    </div>
  ),
  Preview: ({ s }) => (
    <StoryStage bg={s.bg}>
      <MentionSticker usuario={s.usuario} avatar={s.avatar} />
    </StoryStage>
  ),
};

export default [IG_COUNTDOWN, IG_LOCATION, IG_MENTION];
