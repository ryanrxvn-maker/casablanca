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
import { setEmojiSet } from './emoji-style';

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

/**
 * Ícone de verdade dos apps mais usados (07.10): sem ícone enviado, uma
 * notificação do WhatsApp mostrava um balão cinza genérico, e na tela de
 * bloqueio de verdade o que aparece é o ícone verde do app.
 *
 * PNG 128 px embutido, NÃO <svg>: o html2canvas desenhou o SVG (inclusive
 * como <img> de data:image/svg) cortado no download, só um pedaço verde,
 * enquanto a prévia saía certa. PNG ele desenha igual à prévia.
 * Receita (viewBox 64): squircle rx 14 com degradê #5ffc7b→#28b53f, anel
 * branco r 16.6 traço 3.6 em (32,31), rabicho no canto de baixo e o
 * telefone do ícone "call" do Material em translate(22.6 21.6) scale(.78).
 * Instagram: degradê 45° #feda75 #fa7e1e #d62976 #962fbf #4f5bd5, câmera
 * em traço 3.6.
 */
const BRAND_ICONS: Record<string, string> = {
  whatsapp:
    'data:image/png;base64,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',
  instagram:
    'data:image/png;base64,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',
};

/** Ícone oficial do app pelo nome digitado ("WhatsApp", "whats app", "Instagram"…). */
function brandIcon(app: string): string | null {
  const k = app.toLowerCase().replace(/[^a-z]/g, '');
  if (k === 'whatsapp' || k === 'whatsappbusiness' || k === 'zap') return BRAND_ICONS.whatsapp;
  if (k === 'instagram' || k === 'insta') return BRAND_ICONS.instagram;
  return null;
}

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
  // emoji ainda no padrão (ou vazio) + app conhecido = ícone oficial do app;
  // quem trocou o emoji de propósito continua vendo o emoji dele
  const brand = !icone && (!emoji.trim() || emoji.trim() === '💬') ? brandIcon(app) : null;
  const src = icone || brand;
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
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
      {emojify(glyph)}
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
        // Vidro fosco iOS. O html2canvas ignora backdrop-filter — como o
        // wallpaper padrão é preto, o blur não muda nada, então removemos pra o
        // download sair IGUAL à prévia (sem depender de um filtro não suportado).
        background: 'rgba(245,245,245,0.22)',
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
            lineHeight: 1.4,
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
          {emojify(s.texto)}
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
            lineHeight: 1.4,
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
          {emojify(s.texto)}
        </div>
      ) : null}
    </div>
  );
}

/* ───────────────────────────── Lockscreen ───────────────────────────── */

function LockCircleBtn({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(40,40,40,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
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
        fontSize: ios ? 84 : 64,
        fontWeight: ios ? 300 : 300,
        color: '#ffffff',
        lineHeight: 1,
        letterSpacing: ios ? '-0.01em' : '-0.01em',
        /* tabular-nums REMOVIDO: h2c posiciona segmentos com métrica tabular do DOM mas desenha proporcional → vão no meio do texto (11 :20) */
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
      {/* No lockscreen a hora fica no relógio grande → a status bar mostra a operadora */}
      <StatusBar cfg={status} tone="light" leftOverride={status.carrier || ''} />

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
          onChange={(v) => {
            set({ os: v });
            setEmojiSet(v === 'android' ? 'google' : 'apple');
          }}
        />
      </Field>

      <Field label="App"><TextField value={s.app} onChange={(v) => set({ app: v })} placeholder="WhatsApp" maxLength={30} /></Field>

      <div className="grid grid-cols-[auto_1fr] items-end gap-3">
        <Field label="Emoji" hint="WhatsApp e Instagram já saem com o ícone oficial; troque o emoji pra usar outro.">
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
