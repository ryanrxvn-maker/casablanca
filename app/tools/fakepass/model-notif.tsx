'use client';

/**
 * FakePass — NOTIFICAÇÃO na tela de bloqueio (lockscreen).
 * Relógio grande sobre wallpaper + um card de notificação (estilo iOS ou Android).
 * A maior parte da tela é wallpaper — a hora e a notificação respiram.
 */

import {
  StatusBar,
  Field,
  TextField,
  TextArea,
  ImageUpload,
  Segmented,
  FONT_STACK,
  type FakeModel,
  type StatusCfg,
  emojify,
} from './shared';

type S = {
  os: string; // 'ios' | 'android'
  app: string;
  icone: string; // dataURL do ícone (opcional)
  emoji: string; // emoji/inicial fallback
  titulo: string;
  texto: string;
  tempo: string;
  horaGrande: string;
  data: string;
  wallpaper: string; // dataURL
};

const W = 320;
const H = Math.round(W * 2.02);

/* ─────────────────────── Ícone do app (topo do card) ─────────────────────── */

function AppIcon({
  icone,
  emoji,
  app,
  size,
  radius,
  bg,
}: {
  icone: string;
  emoji: string;
  app: string;
  size: number;
  radius: number;
  bg: string;
}) {
  const inicial = (app.trim()[0] || '?').toUpperCase();
  const glyph = emoji.trim() || inicial;
  if (icone) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={icone}
        alt=""
        style={{
          width: size,
          height: size,
          borderRadius: radius,
          objectFit: 'cover',
          flexShrink: 0,
          display: 'block',
        }}
      />
    );
  }
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: bg,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: Math.round(size * 0.58),
        lineHeight: 1,
        color: '#fff',
        fontWeight: 600,
        overflow: 'hidden',
      }}
    >
      {emojify(glyph, 'apple')}
    </div>
  );
}

/* ───────────────────────────── Card iOS ───────────────────────────── */

function IosCard({ s }: { s: S }) {
  return (
    <div
      style={{
        margin: '0 12px',
        borderRadius: 18,
        background: 'rgba(245,245,245,0.22)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        padding: '12px 14px',
        boxShadow: '0 1px 8px rgba(0,0,0,0.14)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <AppIcon icone={s.icone} emoji={s.emoji} app={s.app} size={20} radius={5} bg="rgba(255,255,255,0.35)" />
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: '#ffffff',
            letterSpacing: '0.02em',
            textTransform: 'uppercase',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            flex: 1,
          }}
        >
          {s.app || 'App'}
        </span>
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', flexShrink: 0 }}>
          {s.tempo || 'agora'}
        </span>
      </div>
      {s.titulo.trim() ? (
        <div
          style={{
            fontSize: 15,
            fontWeight: 600,
            color: '#ffffff',
            lineHeight: 1.3,
            marginBottom: 2,
            wordBreak: 'break-word',
          }}
        >
          {s.titulo}
        </div>
      ) : null}
      {s.texto.trim() ? (
        <div
          style={{
            fontSize: 14,
            color: 'rgba(255,255,255,0.9)',
            lineHeight: 1.32,
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            wordBreak: 'break-word',
          }}
        >
          {emojify(s.texto, s.os === 'android' ? 'google' : 'apple')}
        </div>
      ) : null}
    </div>
  );
}

/* ─────────────────────────── Card Android ─────────────────────────── */

function AndroidCard({ s }: { s: S }) {
  return (
    <div
      style={{
        margin: '0 10px',
        borderRadius: 24,
        background: '#fafafa',
        padding: '13px 15px',
        boxShadow: '0 1px 6px rgba(0,0,0,0.18)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
        <AppIcon icone={s.icone} emoji={s.emoji} app={s.app} size={18} radius={9} bg="#1a73e8" />
        <span
          style={{
            fontSize: 12,
            fontWeight: 500,
            color: '#5f6368',
            letterSpacing: '0.01em',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            flex: 1,
          }}
        >
          {s.app || 'App'}
        </span>
        <span style={{ fontSize: 12, color: '#5f6368', flexShrink: 0 }}>
          {'· ' + (s.tempo || 'agora')}
        </span>
      </div>
      {s.titulo.trim() ? (
        <div
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: '#202124',
            lineHeight: 1.3,
            marginBottom: 2,
            wordBreak: 'break-word',
          }}
        >
          {s.titulo}
        </div>
      ) : null}
      {s.texto.trim() ? (
        <div
          style={{
            fontSize: 13.5,
            color: '#3c4043',
            lineHeight: 1.32,
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            wordBreak: 'break-word',
          }}
        >
          {emojify(s.texto, s.os === 'android' ? 'google' : 'apple')}
        </div>
      ) : null}
    </div>
  );
}

/* ───────────────────────────── Lockscreen ───────────────────────────── */

function LockCircleBtn({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(40,40,40,0.55)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      {children}
    </div>
  );
}

function LockScreen({ s, status }: { s: S; status: StatusCfg }) {
  const ios = s.os !== 'android';
  // Wallpaper PRETO por padrão (como o print). Se o user envia uma imagem,
  // fica cover perfeito.
  const bg = s.wallpaper
    ? `url(${s.wallpaper}) center/cover no-repeat`
    : '#000000';

  const clock = (
    <div
      style={{
        fontSize: ios ? 68 : 64,
        fontWeight: ios ? 700 : 300,
        color: '#ffffff',
        lineHeight: 1,
        letterSpacing: ios ? '-0.02em' : '-0.01em',
        fontVariantNumeric: 'tabular-nums',
        textShadow: '0 1px 12px rgba(0,0,0,0.28)',
      }}
    >
      {s.horaGrande || '9:41'}
    </div>
  );

  const date = (
    <div
      style={{
        fontSize: 14,
        fontWeight: 500,
        color: 'rgba(255,255,255,0.85)',
        textShadow: '0 1px 8px rgba(0,0,0,0.28)',
        letterSpacing: '0.01em',
      }}
    >
      {s.data || 'quinta-feira, 5 de julho'}
    </div>
  );

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
        position: 'relative',
      }}
    >
      {/* leve escurecimento no topo pra legibilidade da hora sobre wallpapers claros */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(180deg,rgba(0,0,0,0.18),rgba(0,0,0,0) 32%)',
          pointerEvents: 'none',
        }}
      />
      <StatusBar cfg={status} tone="light" />

      {/* Relógio grande centralizado. iOS: data em cima, hora embaixo. */}
      <div
        style={{
          position: 'relative',
          textAlign: 'center',
          marginTop: ios ? 30 : 40,
          display: 'flex',
          flexDirection: ios ? 'column' : 'column-reverse',
          alignItems: 'center',
          gap: ios ? 8 : 6,
        }}
      >
        {date}
        {clock}
      </div>

      {/* Empurra o card pra parte de baixo — a maior parte é wallpaper. */}
      <div style={{ flex: 1 }} />

      <div style={{ position: 'relative', paddingBottom: 78 }}>
        {ios ? <IosCard s={s} /> : <AndroidCard s={s} />}
      </div>

      {/* Lanterna + Câmera nos cantos inferiores (estilo iPhone) */}
      <div style={{ position: 'absolute', bottom: 22, left: 0, right: 0, display: 'flex', justifyContent: 'space-between', padding: '0 30px' }}>
        <LockCircleBtn>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="#fff" aria-hidden><path d="M9 2h6l-.8 5H9.8L9 2zm.9 6h4.2l-.3 2.2A2 2 0 0 1 11.8 12h-.6A2 2 0 0 1 9.2 10.2L8.9 8zM11 13h2v9h-2z" /></svg>
        </LockCircleBtn>
        <LockCircleBtn>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3l2-3h8l2 3h3a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="3.5" /></svg>
        </LockCircleBtn>
      </div>
    </div>
  );
}

/* ─────────────────────────────── Model ─────────────────────────────── */

const MODEL: FakeModel<S> = {
  id: 'notif',
  label: 'Notificação',
  category: 'notif',
  hue: 'rgba(120,120,140,0.4)',
  stageW: W,
  ratio: 2.02,
  exportW: 1080,
  usesPhone: true,
  defaultState: {
    os: 'ios',
    app: 'WhatsApp',
    icone: '',
    emoji: '💬',
    titulo: 'Mãe',
    texto: 'Filho, chegou aquele dinheiro que te falei? Me avisa quando puder 🙏',
    tempo: 'agora',
    horaGrande: '9:41',
    data: 'quinta-feira, 5 de julho',
    wallpaper: '',
  },
  Controls: ({ s, set }) => (
    <div className="flex flex-col gap-4">
      <Field label="Celular">
        <Segmented
          value={s.os}
          options={[
            { value: 'ios', label: 'iPhone' },
            { value: 'android', label: 'Android' },
          ]}
          onChange={(v) => set({ os: v })}
        />
      </Field>

      <Field label="App"><TextField value={s.app} onChange={(v) => set({ app: v })} placeholder="WhatsApp" maxLength={30} /></Field>

      <div className="grid grid-cols-[auto_1fr] items-end gap-3">
        <Field label="Emoji" hint="Ou a inicial do app.">
          <input
            type="text"
            value={s.emoji}
            onChange={(e) => set({ emoji: e.target.value.slice(0, 2) })}
            placeholder="💬"
            maxLength={2}
            className="input-field !w-16 text-center text-[18px]"
          />
        </Field>
        <Field label="Ícone (imagem)" hint="Opcional — sobrepõe o emoji.">
          <ImageUpload value={s.icone} onChange={(v) => set({ icone: v })} label="ícone" />
        </Field>
      </div>

      <Field label="Título"><TextField value={s.titulo} onChange={(v) => set({ titulo: v })} placeholder="Mãe" maxLength={60} /></Field>
      <Field label="Texto"><TextArea value={s.texto} onChange={(v) => set({ texto: v })} placeholder="Corpo da notificação…" maxLength={220} rows={3} /></Field>
      <Field label="Tempo"><TextField value={s.tempo} onChange={(v) => set({ tempo: v })} placeholder="agora" maxLength={20} /></Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Hora grande"><TextField value={s.horaGrande} onChange={(v) => set({ horaGrande: v })} placeholder="9:41" maxLength={8} /></Field>
        <Field label="Data"><TextField value={s.data} onChange={(v) => set({ data: v })} placeholder="quinta-feira, 5 de julho" maxLength={40} /></Field>
      </div>

      <Field label="Wallpaper" hint="Sem imagem = gradiente escuro.">
        <ImageUpload value={s.wallpaper} onChange={(v) => set({ wallpaper: v })} label="wallpaper" />
      </Field>
    </div>
  ),
  Preview: ({ s, status }) => <LockScreen s={s} status={status} />,
};

export default [MODEL];
