'use client';

/**
 * FakePass — Instagram Direct (DM).
 * Tela do chat do Instagram: header com avatar/nome/status, balões de mensagem
 * (recebido cinza / enviado com gradiente Instagram), rodapé com pill de input.
 * Modo claro e escuro. Lista de mensagens editada como uma string multi-linha.
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
  emojify,
} from './shared';

type S = {
  nome: string;
  status: string;
  conversa: string;
  dark: boolean;
  avatar: string;
  visto: boolean;
};

type Msg = { t: string; me: boolean };

const IG_GRADIENT = 'linear-gradient(135deg,#4f5bd5,#962fbf,#d62976,#fa7e1e)';

function parseMsgs(txt: string): Msg[] {
  return txt
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter((l) => l.trim() !== '')
    .map((l) => (l.startsWith('> ') ? { t: l.slice(2), me: true } : { t: l, me: false }));
}

/** Cantos do balão colados quando o próximo/anterior é do mesmo lado. */
function bubbleRadius(me: boolean, firstOfRun: boolean, lastOfRun: boolean) {
  const big = 18;
  const small = 5;
  if (me) {
    return `${big}px ${firstOfRun ? big : small}px ${lastOfRun ? big : small}px ${big}px`;
  }
  return `${firstOfRun ? big : small}px ${big}px ${big}px ${lastOfRun ? big : small}px`;
}

function initial(nome: string) {
  const t = nome.trim();
  return t ? t[0].toUpperCase() : '?';
}

function Avatar({
  src,
  nome,
  size,
  dark,
}: {
  src: string;
  nome: string;
  size: number;
  dark: boolean;
}) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          objectFit: 'cover',
          flexShrink: 0,
        }}
      />
    );
  }
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        flexShrink: 0,
        background: dark ? '#3a3a3c' : '#d9d9d9',
        color: dark ? '#e5e5e5' : '#7a7a7a',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.42,
        fontWeight: 600,
      }}
    >
      {initial(nome)}
    </div>
  );
}

/* ─────────────────────── Ícones (linha, ~22px) ─────────────────────── */

function BackIcon({ color }: { color: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M15 4 7 12l8 8"
        stroke={color}
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PhoneIcon({ color }: { color: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M6.5 3.5c.6 0 1.1.4 1.3 1l.9 2.7c.2.5 0 1.1-.4 1.5l-1.3 1.2a12.5 12.5 0 0 0 5.6 5.6l1.2-1.3c.4-.4 1-.6 1.5-.4l2.7.9c.6.2 1 .7 1 1.3v3c0 .9-.8 1.6-1.7 1.5C10.9 20.6 3.4 13.1 3 4.7 3 3.8 3.6 3 4.5 3h2Z"
        stroke={color}
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CameraIcon({ color }: { color: string }) {
  return (
    <svg width="23" height="23" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3.5 8.5a2 2 0 0 1 2-2h1.3l.9-1.4a1.4 1.4 0 0 1 1.2-.6h4.2c.5 0 .9.2 1.2.6l.9 1.4h1.1a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-7Z"
        stroke={color}
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3.2" stroke={color} strokeWidth="1.6" />
    </svg>
  );
}

/* Rodapé */

function AppCameraCircle({ color, bg }: { color: string; bg: string }) {
  return (
    <div
      style={{
        width: 30,
        height: 30,
        borderRadius: '50%',
        background: bg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M4 8.5a1.7 1.7 0 0 1 1.7-1.7h1l.8-1.2a1.2 1.2 0 0 1 1-.5h3a1.2 1.2 0 0 1 1 .5l.8 1.2h1A1.7 1.7 0 0 1 20 8.5v6.8A1.7 1.7 0 0 1 18.3 17H5.7A1.7 1.7 0 0 1 4 15.3V8.5Z"
          stroke={color}
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <circle cx="12" cy="11.8" r="2.7" stroke={color} strokeWidth="1.6" />
      </svg>
    </div>
  );
}

function MicIcon({ color }: { color: string }) {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="9" y="3.5" width="6" height="11" rx="3" stroke={color} strokeWidth="1.6" />
      <path
        d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5"
        stroke={color}
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ImageIcon({ color }: { color: string }) {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.4" stroke={color} strokeWidth="1.6" />
      <circle cx="8.4" cy="9.4" r="1.5" stroke={color} strokeWidth="1.4" />
      <path
        d="M4 17l4.6-4.2a1.5 1.5 0 0 1 2 0L15 16l1.7-1.5a1.5 1.5 0 0 1 2 0L20.5 16"
        stroke={color}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StickerIcon({ color }: { color: string }) {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3.5a8.5 8.5 0 1 1-.4 17c-.2 0-.3-.3-.1-.5l7-7c.2-.2.5-.1.5.1"
        stroke={color}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M20 12.5a7.9 7.9 0 0 1-7.5 7.5V15a2.5 2.5 0 0 1 2.5-2.5H20Z"
        stroke={color}
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ─────────────────────────────── Tela ─────────────────────────────── */

function Screen({ s, status }: { s: S; status: StatusCfg }) {
  const W = 320;
  const H = Math.round(W * 2.02);

  const bg = s.dark ? '#000000' : '#ffffff';
  const fg = s.dark ? '#ffffff' : '#000000';
  const border = s.dark ? '#262626' : '#dbdbdb';
  const muted = '#8e8e8e';
  const recvBg = s.dark ? '#262626' : '#efefef';
  const recvFg = s.dark ? '#ffffff' : '#000000';
  const pillBorder = s.dark ? '#363636' : '#dbdbdb';
  const pillBg = s.dark ? '#000000' : '#ffffff';
  const rodapeCircleBg = s.dark ? '#3797f0' : '#3797f0';
  const emojiSet = status.os === 'android' ? 'google' : 'apple';

  const msgs = parseMsgs(s.conversa);
  // índice da última mensagem enviada (pra âncora do "Visto")
  let lastMeIdx = -1;
  for (let i = 0; i < msgs.length; i++) if (msgs[i].me) lastMeIdx = i;

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
          height: 54,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '0 12px',
          borderBottom: `1px solid ${border}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          <BackIcon color={fg} />
        </div>
        <Avatar src={s.avatar} nome={s.nome} size={34} dark={s.dark} />
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            lineHeight: 1.15,
          }}
        >
          <div
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: fg,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {s.nome || ' '}
          </div>
          {s.status.trim() ? (
            <div
              style={{
                fontSize: 12,
                color: muted,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {s.status}
            </div>
          ) : null}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 }}>
          <PhoneIcon color={fg} />
          <CameraIcon color={fg} />
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
          padding: 10,
          gap: 3,
        }}
      >
        {msgs.map((m, i) => {
          const prev = msgs[i - 1];
          const next = msgs[i + 1];
          const firstOfRun = !prev || prev.me !== m.me;
          const lastOfRun = !next || next.me !== m.me;
          const showVisto = s.visto && m.me && i === lastMeIdx;
          return (
            <div key={i} style={{ display: 'flex', flexDirection: 'column' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: m.me ? 'flex-end' : 'flex-start',
                }}
              >
                <div
                  style={{
                    maxWidth: '72%',
                    padding: '8px 12px',
                    borderRadius: bubbleRadius(m.me, firstOfRun, lastOfRun),
                    fontSize: 14.5,
                    lineHeight: 1.32,
                    letterSpacing: '-0.01em',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    background: m.me ? IG_GRADIENT : recvBg,
                    color: m.me ? '#ffffff' : recvFg,
                  }}
                >
                  {emojify(m.t, emojiSet)}
                </div>
              </div>
              {showVisto ? (
                <div
                  style={{
                    fontSize: 11,
                    color: muted,
                    textAlign: 'right',
                    marginTop: 3,
                    paddingRight: 2,
                  }}
                >
                  Visto
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* RODAPE */}
      <div
        style={{
          height: 48,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 9,
          padding: '0 10px',
        }}
      >
        <AppCameraCircle color="#ffffff" bg={rodapeCircleBg} />
        <div
          style={{
            flex: 1,
            minWidth: 0,
            height: 34,
            borderRadius: 20,
            border: `1px solid ${pillBorder}`,
            background: pillBg,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '0 12px',
          }}
        >
          <span style={{ flex: 1, fontSize: 14, color: muted }}>Mensagem...</span>
          <MicIcon color={fg} />
          <ImageIcon color={fg} />
          <StickerIcon color={fg} />
        </div>
      </div>
    </div>
  );
}

const MODEL: FakeModel<S> = {
  id: 'ig-dm',
  label: 'Instagram DM',
  category: 'chat',
  hue: 'rgba(214,41,118,0.4)',
  stageW: 320,
  ratio: 2.02,
  exportW: 1080,
  usesPhone: true,
  defaultState: {
    nome: 'ana.souza',
    status: 'Ativo(a) agora',
    conversa: 'oii tudo bem?\nvi que você entrou no grupo\n> oi! tudo sim 😄\n> acabei de entrar mesmo\nque bom! qualquer dúvida chama',
    dark: false,
    avatar: '',
    visto: true,
  },
  Controls: ({ s, set }) => (
    <div className="flex flex-col gap-4">
      <Field label="Nome / usuário">
        <TextField
          value={s.nome}
          onChange={(v) => set({ nome: v })}
          placeholder="usuario"
          maxLength={40}
        />
      </Field>
      <Field label="Status" hint="Ex.: Ativo(a) agora, Ativo(a) há 5 min">
        <TextField
          value={s.status}
          onChange={(v) => set({ status: v })}
          placeholder="Ativo(a) agora"
          maxLength={40}
        />
      </Field>
      <Field label="Foto de perfil">
        <ImageUpload value={s.avatar} onChange={(v) => set({ avatar: v })} label="foto" round />
      </Field>
      <Field
        label="Conversa"
        hint="Uma linha por mensagem. Comece com > pra ser sua (direita)."
      >
        <TextArea
          value={s.conversa}
          onChange={(v) => set({ conversa: v })}
          placeholder={'oi!\n> oi, tudo bem?'}
          rows={6}
        />
      </Field>
      <Toggle on={s.dark} onChange={(v) => set({ dark: v })} label="Modo escuro" />
      <Toggle on={s.visto} onChange={(v) => set({ visto: v })} label='Mostrar "Visto"' />
    </div>
  ),
  Preview: ({ s, status }) => <Screen s={s} status={status} />,
};

export default [MODEL];
