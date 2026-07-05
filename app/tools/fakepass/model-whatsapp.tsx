'use client';

/**
 * FakePass — modelo WhatsApp (tela de conversa).
 * Réplica fiel da tela de chat: header colorido com avatar/nome/status +
 * ícones (vídeo, telefone, 3-pontos), balões enviados/recebidos com hora e
 * checks azuis de "visto", papel de parede bege (claro) / escuro, e barra de
 * input no rodapé. Suporta modo claro e escuro.
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
  nome: string;
  status: string;
  conversa: string;
  dark: boolean;
  avatar: string;
  hora: string;
};

type Msg = { t: string; me: boolean };

function parseMsgs(txt: string): Msg[] {
  return txt
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter((l) => l.trim() !== '')
    .map((l) => (l.startsWith('> ') ? { t: l.slice(2), me: true } : { t: l, me: false }));
}

/* ─────────────────────────── Ícones ─────────────────────────── */

function ChevronBack() {
  return (
    <svg width="12" height="20" viewBox="0 0 12 20" fill="none" aria-hidden>
      <path
        d="M10 2L2 10l8 8"
        stroke="#ffffff"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function VideoIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="#ffffff" aria-hidden>
      <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h6A2.5 2.5 0 0 1 15 6.5v11A2.5 2.5 0 0 1 12.5 20h-6A2.5 2.5 0 0 1 4 17.5v-11Zm13 3.1 3.4-2.3c.5-.35 1.2 0 1.2.62v10.16c0 .62-.7.97-1.2.62L17 16.4V9.6Z" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="#ffffff" aria-hidden>
      <path d="M6.6 10.8a15.6 15.6 0 0 0 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.4.6 3.6.6.6 0 1 .5 1 1V20c0 .6-.4 1-1 1C10.9 21 3 13.1 3 3.4c0-.5.5-1 1-1h3.4c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.4 0 .8-.2 1l-2.2 2.2Z" />
    </svg>
  );
}

function DotsIcon() {
  return (
    <svg width="5" height="20" viewBox="0 0 5 20" fill="#ffffff" aria-hidden>
      <circle cx="2.5" cy="3" r="2.1" />
      <circle cx="2.5" cy="10" r="2.1" />
      <circle cx="2.5" cy="17" r="2.1" />
    </svg>
  );
}

function DoubleCheck() {
  // dois checks azuis (visto)
  return (
    <svg width="16" height="11" viewBox="0 0 16 11" fill="none" aria-hidden style={{ display: 'block' }}>
      <path
        d="M1 5.7 3.7 8.4 9 2.6"
        stroke="#53bdeb"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6.3 5.7 9 8.4 14.3 2.6"
        stroke="#53bdeb"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function EmojiIcon({ color }: { color: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.7" />
      <circle cx="9" cy="10" r="1.15" fill={color} />
      <circle cx="15" cy="10" r="1.15" fill={color} />
      <path d="M8.3 14.2a4.6 4.6 0 0 0 7.4 0" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="#ffffff" aria-hidden>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path
        d="M6 11a6 6 0 0 0 12 0M12 17v3.5M9 20.5h6"
        stroke="#ffffff"
        strokeWidth="1.7"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* ─────────────────────────── Avatar ─────────────────────────── */

function Avatar({ src, size }: { src: string; size: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        overflow: 'hidden',
        flexShrink: 0,
        background: '#c4c9cc',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 24 24" fill="#ffffff" aria-hidden>
          <circle cx="12" cy="8.4" r="4.1" />
          <path d="M4.2 20.5c0-4 3.5-6.4 7.8-6.4s7.8 2.4 7.8 6.4Z" />
        </svg>
      )}
    </div>
  );
}

/* ─────────────────────────── Balão ─────────────────────────── */

function Bubble({ m, hora, dark }: { m: Msg; hora: string; dark: boolean }) {
  const bg = m.me
    ? dark
      ? '#005c4b'
      : '#dcf8c6'
    : dark
      ? '#202c33'
      : '#ffffff';
  const color = dark ? '#e9edef' : '#000000';
  const metaColor = dark ? 'rgba(233,237,239,0.6)' : '#667781';
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: m.me ? 'flex-end' : 'flex-start',
      }}
    >
      <div
        style={{
          position: 'relative',
          maxWidth: '78%',
          background: bg,
          color,
          borderRadius: 8,
          padding: '6px 9px 8px',
          fontSize: 14.2,
          lineHeight: 1.32,
          boxShadow: dark ? '0 1px 0.5px rgba(0,0,0,0.28)' : '0 1px 0.5px rgba(0,0,0,0.13)',
          wordBreak: 'break-word',
          whiteSpace: 'pre-wrap',
        }}
      >
        <span>{m.t}</span>
        <span
          style={{
            float: 'right',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 3,
            marginLeft: 8,
            marginTop: 4,
            fontSize: 11,
            color: metaColor,
            lineHeight: 1,
            position: 'relative',
            top: 3,
          }}
        >
          {hora}
          {m.me ? <DoubleCheck /> : null}
        </span>
      </div>
    </div>
  );
}

/* ─────────────────────────── Tela ─────────────────────────── */

function Screen({ s, status }: { s: S; status: StatusCfg }) {
  const W = 320;
  const H = Math.round(W * 2.02);
  const headerBg = s.dark ? '#1f2c34' : '#075e54';
  const chatBg = s.dark ? '#0b141a' : '#e5ddd5';
  const footerBg = s.dark ? '#1f2c34' : '#f0f0f0';
  const inputBg = s.dark ? '#2a3942' : '#ffffff';
  const inputText = s.dark ? '#8696a0' : '#8a8a8a';
  const iconMuted = s.dark ? '#8696a0' : '#54656f';
  const msgs = parseMsgs(s.conversa);

  return (
    <div
      style={{
        width: W,
        height: H,
        background: chatBg,
        overflow: 'hidden',
        fontFamily: FONT_STACK,
        display: 'flex',
        flexDirection: 'column',
        WebkitFontSmoothing: 'antialiased',
      }}
    >
      {/* StatusBar sobre o header colorido — tone light nos dois modos */}
      <div style={{ background: headerBg, flexShrink: 0 }}>
        <StatusBar cfg={status} tone="light" />
      </div>

      {/* HEADER */}
      <div
        style={{
          height: 56,
          flexShrink: 0,
          background: headerBg,
          display: 'flex',
          alignItems: 'center',
          padding: '0 10px 0 6px',
          gap: 4,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', paddingRight: 2 }}>
          <ChevronBack />
        </div>
        <Avatar src={s.avatar} size={38} />
        <div style={{ flex: 1, minWidth: 0, marginLeft: 8, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div
            style={{
              fontSize: 16,
              fontWeight: 600,
              color: '#ffffff',
              lineHeight: 1.2,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {s.nome}
          </div>
          {s.status.trim() !== '' ? (
            <div
              style={{
                fontSize: 12.5,
                color: 'rgba(255,255,255,0.8)',
                lineHeight: 1.2,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {s.status}
            </div>
          ) : null}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <VideoIcon />
          <PhoneIcon />
          <DotsIcon />
        </div>
      </div>

      {/* MENSAGENS */}
      <div
        style={{
          flex: 1,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-end',
          gap: 2,
          padding: 8,
        }}
      >
        {msgs.map((m, i) => (
          <Bubble key={i} m={m} hora={s.hora} dark={s.dark} />
        ))}
      </div>

      {/* RODAPÉ */}
      <div
        style={{
          flexShrink: 0,
          background: footerBg,
          padding: '6px 8px',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: inputBg,
            borderRadius: 22,
            padding: '8px 12px',
            minHeight: 40,
            boxSizing: 'border-box',
          }}
        >
          <EmojiIcon color={iconMuted} />
          <span style={{ flex: 1, fontSize: 15, color: inputText }}>Mensagem</span>
        </div>
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: '50%',
            background: s.dark ? '#00a884' : '#008069',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <MicIcon />
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── Modelo ─────────────────────────── */

const MODEL: FakeModel<S> = {
  id: 'whatsapp',
  label: 'WhatsApp',
  category: 'chat',
  hue: 'rgba(37,211,102,0.4)',
  stageW: 320,
  ratio: 2.02,
  exportW: 1080,
  usesPhone: true,
  defaultState: {
    nome: 'Ana',
    status: 'online',
    conversa: 'Oi, viu minha mensagem?\nPreciso muito da sua resposta\n> Oi! Vi sim, tava sem sinal\n> Já te respondo tudo direitinho',
    dark: false,
    avatar: '',
    hora: '09:41',
  },
  Controls: ({ s, set }) => (
    <div className="flex flex-col gap-4">
      <Field label="Nome">
        <TextField value={s.nome} onChange={(v) => set({ nome: v })} placeholder="Nome do contato" maxLength={40} />
      </Field>
      <Field label="Status" hint="Ex.: online, digitando…, visto por último hoje às 14:20">
        <TextField value={s.status} onChange={(v) => set({ status: v })} placeholder="online" maxLength={60} />
      </Field>
      <Field label="Foto do contato">
        <ImageUpload value={s.avatar} onChange={(v) => set({ avatar: v })} label="foto" round />
      </Field>
      <Field label="Hora">
        <TextField value={s.hora} onChange={(v) => set({ hora: v })} placeholder="09:41" maxLength={8} />
      </Field>
      <Field label="Conversa" hint="Uma linha por mensagem. Comece com > pra ser sua (direita).">
        <TextArea value={s.conversa} onChange={(v) => set({ conversa: v })} rows={6} />
      </Field>
      <Toggle on={s.dark} onChange={(v) => set({ dark: v })} label="Modo escuro" />
    </div>
  ),
  Preview: ({ s, status }) => <Screen s={s} status={status} />,
};

export default [MODEL];
