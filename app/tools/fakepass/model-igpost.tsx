'use client';

/**
 * FakePass — POST DO FEED DO INSTAGRAM (com moldura de celular).
 *
 * Réplica fiel de uma publicação no feed: StatusBar → header (avatar + nome +
 * selo verificado + local + ⋯) → imagem quadrada → ações (like/comentar/
 * compartilhar + salvar) → curtidas → legenda → "ver todos os comentários" →
 * tempo. Modo claro e escuro com as cores exatas do app.
 */

import {
  StatusBar,
  Field,
  TextField,
  TextArea,
  Toggle,
  ImageUpload,
  FONT_STACK,
  type FakeModel,
  type StatusCfg,
} from './shared';

type S = {
  username: string;
  verificado: boolean;
  local: string;
  foto: string; // dataURL da imagem do post
  avatar: string; // dataURL do avatar (round)
  curtidas: string;
  legenda: string;
  comentarios: string;
  tempo: string;
  dark: boolean;
};

/* ─────────────────────────── Ícones ─────────────────────────── */

function VerifiedBadge({ size = 12 }: { size?: number }) {
  // Selo azul verificado do Instagram (roseta + check branco).
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden style={{ display: 'block' }}>
      <path
        d="M12 1.5l2.35 1.86 2.99-.24.86 2.88 2.52 1.63-.93 2.85.93 2.85-2.52 1.63-.86 2.88-2.99-.24L12 22.5l-2.35-1.86-2.99.24-.86-2.88L3.28 16.4l.93-2.85-.93-2.85 2.52-1.63.86-2.88 2.99.24L12 1.5z"
        fill="#3897f0"
      />
      <path d="M10.6 15.2l-2.9-2.9 1.27-1.27 1.63 1.63 4.02-4.02 1.27 1.28-5.29 5.28z" fill="#fff" />
    </svg>
  );
}

function DotsIcon({ color }: { color: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill={color} aria-hidden>
      <circle cx="5" cy="12" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="19" cy="12" r="1.7" />
    </svg>
  );
}

function HeartIcon({ color }: { color: string }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 20.7l-1.45-1.32C5.4 14.72 2 11.64 2 7.86 2 4.78 4.42 2.4 7.5 2.4c1.74 0 3.41.81 4.5 2.09 1.09-1.28 2.76-2.09 4.5-2.09C19.58 2.4 22 4.78 22 7.86c0 3.78-3.4 6.86-8.55 11.54L12 20.7z" />
    </svg>
  );
}

function CommentIcon({ color }: { color: string }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20.66 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.36a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}

function ShareIcon({ color }: { color: string }) {
  // Aviãozinho (compartilhar em Direct).
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M22 3L2.5 10.4l7 2.6M22 3l-6.6 18-4.9-8M22 3l-12.5 10" />
    </svg>
  );
}

function BookmarkIcon({ color }: { color: string }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4.5L5 21V4a1 1 0 0 1 1-1z" />
    </svg>
  );
}

function ImagePlaceholder({ dark }: { dark: boolean }) {
  const stroke = dark ? '#3a3a3a' : '#c7c7c7';
  return (
    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.6" />
      <path d="M21 15l-5-5L5 21" />
    </svg>
  );
}

/* ─────────────────────────── Preview ─────────────────────────── */

function Screen({ s, status }: { s: S; status: StatusCfg }) {
  const W = 320;
  const H = Math.round(W * 1.62);

  const bg = s.dark ? '#000000' : '#ffffff';
  const fg = s.dark ? '#ffffff' : '#000000';
  const border = s.dark ? '#262626' : '#dbdbdb';
  const muted = '#8e8e8e';
  const placeBg = s.dark ? '#121212' : '#efefef';

  const username = s.username || 'usuario';

  return (
    <div
      style={{
        width: W,
        height: H,
        background: bg,
        overflow: 'hidden',
        fontFamily: FONT_STACK,
        display: 'flex',
        flexDirection: 'column',
        WebkitFontSmoothing: 'antialiased',
        color: fg,
      }}
    >
      <StatusBar cfg={status} tone={s.dark ? 'light' : 'dark'} />

      {/* HEADER */}
      <div
        style={{
          height: 52,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          padding: '0 12px',
          gap: 10,
        }}
      >
        {/* Avatar com anel gradiente */}
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            flexShrink: 0,
            padding: 2,
            background: 'linear-gradient(45deg,#f9ce34,#ee2a7b,#6228d7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              width: '100%',
              height: '100%',
              borderRadius: '50%',
              overflow: 'hidden',
              background: placeBg,
              border: `1.5px solid ${bg}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {s.avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={s.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : null}
          </div>
        </div>

        {/* Nome + local */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span
              style={{
                fontSize: 13.5,
                fontWeight: 600,
                color: fg,
                lineHeight: 1.15,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: s.local ? 150 : 190,
              }}
            >
              {username}
            </span>
            {s.verificado ? <VerifiedBadge size={12} /> : null}
          </div>
          {s.local ? (
            <span
              style={{
                fontSize: 11,
                fontWeight: 400,
                color: fg,
                lineHeight: 1.2,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: 190,
              }}
            >
              {s.local}
            </span>
          ) : null}
        </div>

        <DotsIcon color={fg} />
      </div>

      {/* IMAGEM quadrada */}
      <div
        style={{
          width: W,
          height: W,
          flexShrink: 0,
          background: placeBg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        {s.foto ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={s.foto} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        ) : (
          <ImagePlaceholder dark={s.dark} />
        )}
      </div>

      {/* AÇÕES */}
      <div
        style={{
          height: 44,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          padding: '0 12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <HeartIcon color={fg} />
          <CommentIcon color={fg} />
          <ShareIcon color={fg} />
        </div>
        <div style={{ flex: 1 }} />
        <BookmarkIcon color={fg} />
      </div>

      {/* CURTIDAS + LEGENDA + COMENTÁRIOS + TEMPO */}
      <div style={{ padding: '0 12px', display: 'flex', flexDirection: 'column', gap: 5 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: fg, lineHeight: 1.2 }}>
          {(s.curtidas || '0')} curtidas
        </div>

        <div style={{ fontSize: 13, color: fg, lineHeight: 1.35, wordBreak: 'break-word' }}>
          <span style={{ fontWeight: 600 }}>{username}</span>
          {s.legenda ? <span style={{ fontWeight: 400 }}> {s.legenda}</span> : null}
        </div>

        {s.comentarios ? (
          <div style={{ fontSize: 13, color: muted, lineHeight: 1.2 }}>
            Ver todos os {s.comentarios} comentários
          </div>
        ) : null}

        {s.tempo ? (
          <div style={{ fontSize: 10, color: muted, textTransform: 'uppercase', letterSpacing: '0.02em', lineHeight: 1.2 }}>
            {s.tempo}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ─────────────────────────── Modelo ─────────────────────────── */

const MODEL: FakeModel<S> = {
  id: 'ig-post',
  label: 'Post do Instagram',
  category: 'post',
  hue: 'rgba(193,53,132,0.4)',
  stageW: 320,
  ratio: 1.62,
  exportW: 1080,
  usesPhone: true,
  defaultState: {
    username: 'natacha.investe',
    verificado: true,
    local: 'São Paulo, Brasil',
    foto: '',
    avatar: '',
    curtidas: '12.482',
    legenda: 'Esse foi o gráfico que mudou tudo pra mim 📈 salva esse post pra não esquecer.',
    comentarios: '327',
    tempo: 'há 2 horas',
    dark: false,
  },
  Controls: ({ s, set }) => (
    <div className="flex flex-col gap-4">
      <Field label="Nome de usuário">
        <TextField value={s.username} onChange={(v) => set({ username: v })} placeholder="usuario" maxLength={30} />
      </Field>
      <Toggle on={s.verificado} onChange={(v) => set({ verificado: v })} label="Conta verificada" />
      <Field label="Localização" hint="Deixe em branco pra esconder.">
        <TextField value={s.local} onChange={(v) => set({ local: v })} placeholder="São Paulo, Brasil" maxLength={40} />
      </Field>
      <Field label="Foto do post">
        <ImageUpload value={s.foto} onChange={(v) => set({ foto: v })} label="foto" />
      </Field>
      <Field label="Avatar">
        <ImageUpload value={s.avatar} onChange={(v) => set({ avatar: v })} label="avatar" round />
      </Field>
      <Field label="Curtidas">
        <TextField value={s.curtidas} onChange={(v) => set({ curtidas: v })} placeholder="12.482" maxLength={16} />
      </Field>
      <Field label="Legenda">
        <TextArea value={s.legenda} onChange={(v) => set({ legenda: v })} placeholder="Escreve a legenda…" maxLength={300} rows={3} />
      </Field>
      <Field label="Comentários" hint="Só o número. Em branco esconde a linha.">
        <TextField value={s.comentarios} onChange={(v) => set({ comentarios: v })} placeholder="327" maxLength={12} />
      </Field>
      <Field label="Tempo">
        <TextField value={s.tempo} onChange={(v) => set({ tempo: v })} placeholder="há 2 horas" maxLength={30} />
      </Field>
      <Toggle on={s.dark} onChange={(v) => set({ dark: v })} label="Modo escuro" />
    </div>
  ),
  Preview: ({ s, status }) => <Screen s={s} status={status} />,
};

export default [MODEL];
