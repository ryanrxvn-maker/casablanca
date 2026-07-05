'use client';

/**
 * FakePass — POST DO FEED DO INSTAGRAM (com moldura de celular).
 * REFORMA FIDELIDADE 2024.
 *
 * Réplica fiel de uma publicação no feed:
 *   StatusBar → header (avatar com anel gradiente + nome + selo verificado +
 *   música / "Sugestões para você" + Seguir + ⋯) → imagem quadrada (com badge
 *   de carrossel e ícone de mudo) → dots de carrossel → ações (like/comentar/
 *   compartilhar + salvar) → curtidas → legenda → "ver todos os comentários" →
 *   tempo → barra de navegação inferior.
 * Modo claro e escuro com as cores exatas do app.
 */

import {
  StatusBar,
  Field,
  TextField,
  TextArea,
  Toggle,
  ImageUpload,
  Emo,
  FONT_STACK,
  type FakeModel,
  type StatusCfg,
  type EmojiSet,
} from './shared';

type S = {
  username: string;
  verificado: boolean;
  musica: string;
  foto: string; // dataURL da imagem do post
  avatar: string; // dataURL do avatar (round)
  curtidas: string;
  legenda: string;
  comentarios: string;
  tempo: string;
  dark: boolean;
  carrossel: boolean;
  totalSlides: string;
  mutado: boolean;
};

/* ─────────────────────────── Ícones ─────────────────────────── */

function VerifiedBadge({ size = 12 }: { size?: number }) {
  // Selo azul verificado do Instagram (roseta + check branco).
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden style={{ display: 'block', flexShrink: 0 }}>
      <path
        d="M12 1.5l2.35 1.86 2.99-.24.86 2.88 2.52 1.63-.93 2.85.93 2.85-2.52 1.63-.86 2.88-2.99-.24L12 22.5l-2.35-1.86-2.99.24-.86-2.88L3.28 16.4l.93-2.85-.93-2.85 2.52-1.63.86-2.88 2.99.24L12 1.5z"
        fill="#3897f0"
      />
      <path d="M10.6 15.2l-2.9-2.9 1.27-1.27 1.63 1.63 4.02-4.02 1.27 1.28-5.29 5.28z" fill="#fff" />
    </svg>
  );
}

function MusicNote({ color }: { color: string }) {
  // Nota musical (audio do reel/post).
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill={color} aria-hidden style={{ display: 'block', flexShrink: 0 }}>
      <path d="M20 3l-9 2v10.1A3.5 3.5 0 1 0 13 18V8.3l6-1.3v5.3A3.5 3.5 0 1 0 20 15V3z" />
    </svg>
  );
}

function DotsIcon({ color }: { color: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill={color} aria-hidden style={{ flexShrink: 0 }}>
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

function MuteIcon() {
  // Alto-falante com "sem som" (badge branco sobre círculo escuro).
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ display: 'block' }}>
      <path d="M4 9v6h4l5 4V5L8 9H4z" fill="#ffffff" stroke="none" />
      <path d="M17 8l5 8M22 8l-5 8" />
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

/* ─────────────── Ícones da barra de navegação inferior ─────────────── */

function NavHome({ color }: { color: string }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 10.5L12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1v-9.5z" />
    </svg>
  );
}

function NavReels({ color }: { color: string }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <path d="M3 8h18M8 3l2.5 5M14 3l2.5 5" />
      <path d="M10.5 11.5l4.5 2.5-4.5 2.5v-5z" fill={color} stroke="none" />
    </svg>
  );
}

function NavCreate({ color }: { color: string }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  );
}

function NavSearch({ color }: { color: string }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  );
}

function NavProfile({ color }: { color: string }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" />
    </svg>
  );
}

/* ─────────────────────────── Preview ─────────────────────────── */

const RATIO = 2.05;

function Screen({ s, status }: { s: S; status: StatusCfg }) {
  const W = 320;
  const H = Math.round(W * RATIO);

  const bg = s.dark ? '#000000' : '#ffffff';
  const fg = s.dark ? '#ffffff' : '#000000';
  const border = s.dark ? '#262626' : '#dbdbdb';
  const muted = '#8e8e8e';
  const placeBg = s.dark ? '#121212' : '#efefef';

  const username = s.username || 'usuario';
  const emojiSet: EmojiSet = status.os === 'android' ? 'google' : 'apple';

  const slidesN = Math.max(1, Math.round(Number(s.totalSlides) || 1));

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
          height: 56,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          padding: '0 12px',
          gap: 10,
        }}
      >
        {/* Avatar com anel gradiente Instagram */}
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: '50%',
            flexShrink: 0,
            padding: 2,
            background:
              'linear-gradient(45deg,#feda75,#fa7e1e,#d62976,#962fbf,#4f5bd5)',
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

        {/* Nome + música / sugestão — SEM flex-coluna (html2canvas corta) */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span
              style={{
                fontSize: 13.5,
                fontWeight: 600,
                color: fg,
                lineHeight: 1.4,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: 150,
              }}
            >
              {username}
            </span>
            {s.verificado ? <VerifiedBadge size={12} /> : null}
          </div>

          {s.musica ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 1 }}>
              <MusicNote color={fg} />
              <span
                style={{
                  fontSize: 11.5,
                  fontWeight: 400,
                  color: fg,
                  lineHeight: 1.4,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  maxWidth: 150,
                }}
              >
                {s.musica}
              </span>
            </div>
          ) : (
            <span
              style={{
                fontSize: 11.5,
                fontWeight: 400,
                color: muted,
                lineHeight: 1.4,
                marginTop: 1,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: 150,
              }}
            >
              Sugestões para você
            </span>
          )}
        </div>

        {/* Botão Seguir (só quando não há música = "Sugestões para você") */}
        {!s.musica ? (
          <div
            style={{
              flexShrink: 0,
              background: '#0095f6',
              color: '#ffffff',
              fontSize: 12,
              fontWeight: 600,
              borderRadius: 8,
              padding: '5px 16px',
              lineHeight: 1,
            }}
          >
            Seguir
          </div>
        ) : null}

        <DotsIcon color={fg} />
      </div>

      {/* IMAGEM quadrada */}
      <div
        style={{
          width: W,
          height: W,
          flexShrink: 0,
          position: 'relative',
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

        {/* Badge de carrossel (1/N) topo-direito */}
        {s.carrossel ? (
          <div
            style={{
              position: 'absolute',
              top: 10,
              right: 10,
              background: 'rgba(0,0,0,0.6)',
              color: '#ffffff',
              fontSize: 11,
              fontWeight: 600,
              borderRadius: 10,
              padding: '3px 8px',
              lineHeight: 1,
            }}
          >
            {`1/${slidesN}`}
          </div>
        ) : null}

        {/* Ícone de mudo (canto inferior direito) */}
        {s.mutado ? (
          <div
            style={{
              position: 'absolute',
              bottom: 10,
              right: 10,
              width: 26,
              height: 26,
              borderRadius: '50%',
              background: 'rgba(0,0,0,0.55)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <MuteIcon />
          </div>
        ) : null}
      </div>

      {/* DOTS do carrossel */}
      {s.carrossel ? (
        <div
          style={{
            height: 18,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 5,
          }}
        >
          {Array.from({ length: Math.min(slidesN, 5) }).map((_, i) => (
            <span
              key={i}
              style={{
                width: 5,
                height: 5,
                borderRadius: '50%',
                background: i === 0 ? '#0095f6' : s.dark ? '#3a3a3a' : '#c7c7c7',
              }}
            />
          ))}
        </div>
      ) : null}

      {/* AÇÕES */}
      <div
        style={{
          height: 46,
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
      <div style={{ padding: '0 12px', display: 'flex', flexDirection: 'column', gap: 5, flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: fg, lineHeight: 1.2 }}>
          {(s.curtidas || '0')} curtidas
        </div>

        <div style={{ fontSize: 13, color: fg, lineHeight: 1.35, wordBreak: 'break-word' }}>
          <span style={{ fontWeight: 600 }}>{username}</span>
          {s.legenda ? (
            <span style={{ fontWeight: 400 }}> <Emo t={s.legenda} set={emojiSet} /></span>
          ) : null}
        </div>

        {s.comentarios ? (
          <div style={{ fontSize: 13, color: muted, lineHeight: 1.2 }}>
            Ver todos os {s.comentarios} comentários
          </div>
        ) : null}

        {s.tempo ? (
          <div style={{ fontSize: 11, color: muted, textTransform: 'uppercase', letterSpacing: '0.02em', lineHeight: 1.2 }}>
            {s.tempo}
          </div>
        ) : null}
      </div>

      {/* BARRA DE NAVEGAÇÃO INFERIOR */}
      <div
        style={{
          height: 48,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-around',
          padding: '0 8px',
          borderTop: `1px solid ${border}`,
        }}
      >
        <NavHome color={fg} />
        <NavReels color={fg} />
        <NavCreate color={fg} />
        <NavSearch color={fg} />
        <NavProfile color={fg} />
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
  ratio: RATIO,
  exportW: 1080,
  usesPhone: true,
  defaultState: {
    username: 'natacha.investe',
    verificado: true,
    musica: 'natacha.investe • Som original',
    foto: '',
    avatar: '',
    curtidas: '12.482',
    legenda: 'Esse foi o gráfico que mudou tudo pra mim 📈 salva esse post pra não esquecer 🔥',
    comentarios: '327',
    tempo: 'há 2 horas',
    dark: false,
    carrossel: true,
    totalSlides: '5',
    mutado: false,
  },
  Controls: ({ s, set }) => (
    <div className="flex flex-col gap-4">
      <Field label="Nome de usuário">
        <TextField value={s.username} onChange={(v) => set({ username: v })} placeholder="usuario" maxLength={30} />
      </Field>
      <Toggle on={s.verificado} onChange={(v) => set({ verificado: v })} label="Conta verificada" />
      <Field label="Música / áudio" hint="Em branco mostra “Sugestões para você” + botão Seguir.">
        <TextField value={s.musica} onChange={(v) => set({ musica: v })} placeholder="Som original" maxLength={40} />
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
      <Toggle on={s.carrossel} onChange={(v) => set({ carrossel: v })} label="Carrossel (vários slides)" />
      <Field label="Total de slides" hint="Aparece como 1/N e nos pontinhos.">
        <TextField value={s.totalSlides} onChange={(v) => set({ totalSlides: v })} placeholder="5" maxLength={2} />
      </Field>
      <Toggle on={s.mutado} onChange={(v) => set({ mutado: v })} label="Vídeo sem som (mudo)" />
      <Toggle on={s.dark} onChange={(v) => set({ dark: v })} label="Modo escuro" />
    </div>
  ),
  Preview: ({ s, status }) => <Screen s={s} status={status} />,
};

export default [MODEL];
