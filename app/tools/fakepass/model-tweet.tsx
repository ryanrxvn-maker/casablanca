'use client';

/**
 * FakePass — modelo TWEET / X.
 * Card de um post do X (ex-Twitter). Altura AUTOMÁTICA (é um card, não uma
 * tela de celular) — o export captura a altura real. Dois temas: X moderno
 * (logo X) e Twitter clássico (passarinho azul), cada um em claro/escuro.
 */

import {
  Field,
  TextField,
  TextArea,
  Toggle,
  ImageUpload,
  FONT_STACK,
  type FakeModel,
} from './shared';

/* ─────────────────────────── Tipos ─────────────────────────── */

type S = {
  nome: string;
  handle: string; // sem @
  verificado: boolean;
  texto: string;
  avatar: string;
  curtidas: string;
  retweets: string;
  comentarios: string;
  data: string;
  dark: boolean;
  xStyle: boolean;
};

/* ─────────────────────────── Paleta ─────────────────────────── */

function palette(dark: boolean) {
  return dark
    ? { bg: '#000000', text: '#e7e9ea', gray: '#71767b', line: '#2f3336' }
    : { bg: '#ffffff', text: '#0f1419', gray: '#536471', line: '#eff3f4' };
}

/* ─────────────────────────── Ícones ─────────────────────────── */

// Selo de verificado azul (X/Twitter blue check).
function VerifiedBadge() {
  return (
    <svg
      viewBox="0 0 22 22"
      width="18"
      height="18"
      aria-hidden
      style={{ flexShrink: 0 }}
    >
      <path
        fill="#1d9bf0"
        d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.854-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.688-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.634.433 1.218.877 1.688.47.443 1.054.747 1.687.878.633.132 1.29.084 1.897-.136.274.586.705 1.084 1.246 1.439.54.354 1.17.551 1.816.569.647-.016 1.276-.213 1.817-.567s.972-.854 1.245-1.44c.604.239 1.266.296 1.903.164.636-.132 1.22-.447 1.68-.907.46-.46.776-1.044.908-1.681s.075-1.299-.165-1.903c.586-.274 1.084-.705 1.439-1.246.354-.54.551-1.17.569-1.816zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z"
      />
    </svg>
  );
}

// Logo X (novo).
function XLogo({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden style={{ flexShrink: 0 }}>
      <path
        fill={color}
        d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"
      />
    </svg>
  );
}

// Passarinho clássico (Twitter).
function BirdLogo() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden style={{ flexShrink: 0 }}>
      <path
        fill="#1d9bf0"
        d="M23.643 4.937c-.835.37-1.732.62-2.675.733a4.67 4.67 0 0 0 2.048-2.578 9.3 9.3 0 0 1-2.958 1.13 4.66 4.66 0 0 0-7.938 4.25 13.229 13.229 0 0 1-9.602-4.868c-.4.69-.63 1.49-.63 2.342A4.66 4.66 0 0 0 3.96 9.824a4.647 4.647 0 0 1-2.11-.583v.06a4.66 4.66 0 0 0 3.737 4.568 4.692 4.692 0 0 1-2.104.08 4.661 4.661 0 0 0 4.352 3.234 9.348 9.348 0 0 1-5.786 1.995 9.5 9.5 0 0 1-1.112-.065 13.175 13.175 0 0 0 7.14 2.093c8.57 0 13.255-7.098 13.255-13.254 0-.2-.005-.402-.014-.602a9.47 9.47 0 0 0 2.323-2.41z"
      />
    </svg>
  );
}

// Ícones da barra de ação (linha, cinza).
function IconComment({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
      <path
        fill={color}
        d="M1.751 10c0-4.42 3.584-8 8.005-8h4.366c4.49 0 8.129 3.64 8.129 8.13 0 2.96-1.607 5.68-4.196 7.11l-8.054 4.46v-3.69h-.067c-4.49.1-8.183-3.51-8.183-8.01z"
      />
    </svg>
  );
}
function IconRetweet({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
      <path
        fill={color}
        d="M4.5 3.88l4.432 4.14-1.364 1.46L5.5 7.55V16c0 1.1.896 2 2 2H13v2H7.5c-2.209 0-4-1.79-4-4V7.55L1.432 9.48.068 8.02 4.5 3.88zM16.5 6H11V4h5.5c2.209 0 4 1.79 4 4v8.45l2.068-1.93 1.364 1.46-4.432 4.14-4.432-4.14 1.364-1.46 2.068 1.93V8c0-1.1-.896-2-2-2z"
      />
    </svg>
  );
}
function IconLike({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
      <path
        fill={color}
        d="M16.697 5.5c-1.222-.06-2.679.51-3.89 2.16l-.805 1.09-.806-1.09C9.984 6.01 8.526 5.44 7.304 5.5c-1.243.07-2.349.78-2.91 1.91-.552 1.12-.633 2.78.479 4.82 1.074 1.97 3.257 4.27 7.129 6.61 3.87-2.34 6.052-4.64 7.126-6.61 1.111-2.04 1.03-3.7.477-4.82-.561-1.13-1.666-1.84-2.908-1.91z"
      />
    </svg>
  );
}
function IconShare({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
      <path
        fill={color}
        d="M12 2.59l5.7 5.7-1.41 1.42L13 6.41V16h-2V6.41l-3.3 3.3-1.41-1.42L12 2.59zM21 15l-.02 3.51c0 1.38-1.12 2.49-2.5 2.49H5.5C4.11 21 3 19.88 3 18.5V15h2v3.5c0 .28.22.5.5.5h12.98c.28 0 .5-.22.5-.5L19 15h2z"
      />
    </svg>
  );
}

/* ─────────────────────────── Card ─────────────────────────── */

function TweetCard({ s }: { s: S }) {
  const c = palette(s.dark);
  const initial = (s.nome || '?').trim().charAt(0).toUpperCase();

  const numColor = c.text;
  const metric = (n: string, label: string) => (
    <span style={{ fontSize: 14, color: c.gray }}>
      <span style={{ fontWeight: 700, color: numColor }}>{n || '0'}</span> {label}
    </span>
  );

  return (
    <div
      style={{
        width: 380,
        background: c.bg,
        color: c.text,
        padding: '14px 16px',
        boxSizing: 'border-box',
        fontFamily: FONT_STACK,
        WebkitFontSmoothing: 'antialiased',
        lineHeight: 1.3,
      }}
    >
      {/* Topo: avatar + nome/handle + logo */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: '50%',
            flexShrink: 0,
            overflow: 'hidden',
            background: s.dark ? '#333639' : '#cfd9de',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {s.avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={s.avatar}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <span style={{ fontSize: 20, fontWeight: 700, color: s.dark ? '#e7e9ea' : '#ffffff' }}>
              {initial}
            </span>
          )}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <span
              style={{
                fontSize: 15,
                fontWeight: 700,
                color: c.text,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: 200,
              }}
            >
              {s.nome || 'Nome'}
            </span>
            {s.verificado ? <VerifiedBadge /> : null}
          </div>
          <div
            style={{
              fontSize: 15,
              color: c.gray,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            @{s.handle || 'usuario'}
          </div>
        </div>

        <div style={{ flexShrink: 0, paddingTop: 2 }}>
          {s.xStyle ? <XLogo color={c.text} /> : <BirdLogo />}
        </div>
      </div>

      {/* Texto do tweet */}
      <div
        style={{
          fontSize: 17,
          fontWeight: 400,
          lineHeight: 1.4,
          color: c.text,
          margin: '12px 0',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {s.texto || ' '}
      </div>

      {/* Data + hora */}
      <div style={{ fontSize: 14, color: c.gray, marginBottom: 12 }}>
        {s.data || ' '}
      </div>

      {/* Divisória */}
      <div style={{ height: 1, background: c.line, margin: '0 0 12px' }} />

      {/* Métricas: retweets + curtidas + comentários */}
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
        {metric(s.retweets, 'Retweets')}
        {metric(s.curtidas, 'Curtidas')}
        {metric(s.comentarios, 'Comentários')}
      </div>

      {/* Divisória */}
      <div style={{ height: 1, background: c.line, margin: '12px 0' }} />

      {/* Barra de ações */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingRight: 8,
        }}
      >
        <IconComment color={c.gray} />
        <IconRetweet color={c.gray} />
        <IconLike color={c.gray} />
        <IconShare color={c.gray} />
      </div>
    </div>
  );
}

/* ─────────────────────────── Modelo ─────────────────────────── */

const MODEL: FakeModel<S> = {
  id: 'tweet',
  label: 'Tweet / X',
  category: 'post',
  hue: 'rgba(29,155,240,0.4)',
  stageW: 380,
  ratio: 0.62,
  exportW: 1200,
  usesPhone: false,
  defaultState: {
    nome: 'Ana Souza',
    handle: 'anasouza',
    verificado: true,
    texto: 'Comprei o curso ontem e já apliquei o primeiro módulo hoje. Melhor decisão do ano, de verdade. 🚀',
    avatar: '',
    curtidas: '2.4 mil',
    retweets: '318',
    comentarios: '96',
    data: '14:32 - 5 de jul de 2025',
    dark: false,
    xStyle: true,
  },
  Controls: ({ s, set }) => (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Nome">
          <TextField value={s.nome} onChange={(v) => set({ nome: v })} placeholder="Ana Souza" maxLength={50} />
        </Field>
        <Field label="@ (sem arroba)">
          <TextField value={s.handle} onChange={(v) => set({ handle: v.replace(/^@/, '') })} placeholder="anasouza" maxLength={30} />
        </Field>
      </div>
      <Toggle on={s.verificado} onChange={(v) => set({ verificado: v })} label="Selo verificado" />
      <Field label="Texto do tweet">
        <TextArea value={s.texto} onChange={(v) => set({ texto: v })} placeholder="O que está acontecendo?" maxLength={280} rows={4} />
      </Field>
      <Field label="Foto de perfil">
        <ImageUpload value={s.avatar} onChange={(v) => set({ avatar: v })} label="foto" round />
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Retweets">
          <TextField value={s.retweets} onChange={(v) => set({ retweets: v })} placeholder="318" maxLength={12} />
        </Field>
        <Field label="Curtidas">
          <TextField value={s.curtidas} onChange={(v) => set({ curtidas: v })} placeholder="2.4 mil" maxLength={12} />
        </Field>
        <Field label="Comentários">
          <TextField value={s.comentarios} onChange={(v) => set({ comentarios: v })} placeholder="96" maxLength={12} />
        </Field>
      </div>
      <Field label="Data e hora">
        <TextField value={s.data} onChange={(v) => set({ data: v })} placeholder="14:32 - 5 de jul de 2025" maxLength={60} />
      </Field>
      <Toggle on={s.dark} onChange={(v) => set({ dark: v })} label="Modo escuro" />
      <Toggle on={s.xStyle} onChange={(v) => set({ xStyle: v })} label="Estilo X (novo)" />
    </div>
  ),
  Preview: ({ s }) => <TweetCard s={s} />,
};

export default [MODEL];
