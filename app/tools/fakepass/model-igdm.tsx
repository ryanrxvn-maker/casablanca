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
  username: string;
  conversa: string;
  dark: boolean;
  avatar: string;
  visto: boolean;
};

type Msg = { kind: 'text'; t: string; me: boolean } | { kind: 'audio'; dur: string; me: boolean };

const AUDIO_RE = /^(?:áudio|audio)\s+(\d+:\d{2})$/i;

// Mensagens enviadas do Instagram DM = gradiente ROXO→AZUL (não o colorido).
const IG_GRADIENT = 'linear-gradient(155deg,#bd3be0 0%,#8a45f0 48%,#5b6ef0 100%)';

// O Instagram aplica UM gradiente global (rosa/magenta no topo → azul/roxo na base)
// ao longo de toda a conversa: cada bolha enviada mostra a fatia da cor correspondente
// à sua posição vertical. Interpolamos por posição pra reproduzir esse efeito.
const IG_TOP: [number, number, number] = [0xc7, 0x3c, 0xd8]; // magenta-roxo (topo)
const IG_BOT: [number, number, number] = [0x6a, 0x50, 0xf2]; // azul-roxo (base)
function meBubbleBg(t: number): string {
  const k = Math.max(0, Math.min(1, t));
  const mix = (a: number, b: number) => Math.round(a + (b - a) * k);
  const c = `rgb(${mix(IG_TOP[0], IG_BOT[0])},${mix(IG_TOP[1], IG_BOT[1])},${mix(IG_TOP[2], IG_BOT[2])})`;
  // leve gradiente vertical na própria bolha pra manter o brilho do original
  const lighter = `rgb(${Math.min(255, mix(IG_TOP[0], IG_BOT[0]) + 14)},${Math.min(255, mix(IG_TOP[1], IG_BOT[1]) + 10)},${Math.min(255, mix(IG_TOP[2], IG_BOT[2]) + 14)})`;
  return `linear-gradient(160deg,${lighter} 0%,${c} 100%)`;
}

function parseMsgs(txt: string): Msg[] {
  return txt
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter((l) => l.trim() !== '')
    .map((l): Msg => {
      const me = l.startsWith('> ');
      const body = me ? l.slice(2) : l;
      const a = body.match(AUDIO_RE);
      if (a) return { kind: 'audio', dur: a[1], me };
      return { kind: 'text', t: body, me };
    });
}

/** Balão de áudio do Instagram DM: play + waveform + tempo + "Ver transcrição". */
function IgAudioBubble({ dur, me, dark, radius }: { dur: string; me: boolean; dark: boolean; radius: string }) {
  const bg = me ? IG_GRADIENT : dark ? '#262626' : '#efefef';
  const fg = me ? '#ffffff' : dark ? '#ffffff' : '#000000';
  const wave = me ? 'rgba(255,255,255,0.7)' : dark ? '#6e6e6e' : '#b0b0b0';
  const meta = me ? 'rgba(255,255,255,0.85)' : '#8e8e8e';
  const bars = [7, 13, 20, 11, 24, 15, 9, 22, 13, 18, 10, 26, 14, 8, 21, 12, 17, 9, 23, 14, 10, 19, 8, 16, 21, 11, 15];
  return (
    <div style={{ maxWidth: '80%', padding: '10px 12px', borderRadius: radius, background: bg }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <svg width="13" height="15" viewBox="0 0 16 18" fill={fg} aria-hidden><path d="M2 1l13 8-13 8z" /></svg>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, height: 26, flex: 1 }}>
          {bars.map((h, i) => (
            <span key={i} style={{ width: 2, height: h, borderRadius: 2, background: wave, flexShrink: 0 }} />
          ))}
        </div>
        <span style={{ fontSize: 11, color: meta, fontVariantNumeric: 'tabular-nums' }}>{dur}</span>
      </div>
      <div style={{ fontSize: 12, color: meta, marginTop: 5 }}>Ver transcrição</div>
    </div>
  );
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

function StickerPlusIcon({ color }: { color: string }) {
  // Dois círculos sobrepostos: carinha (esq/baixo) + círculo com "+" (dir/cima) — igual ao IG DM
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="9.4" cy="14.2" r="6.4" />
      <circle cx="8" cy="13.4" r="0.35" fill={color} stroke={color} strokeWidth="1.1" />
      <circle cx="11" cy="13.4" r="0.35" fill={color} stroke={color} strokeWidth="1.1" />
      <path d="M7.3 16.1c.55.7 1.3 1.05 2.1 1.05s1.55-.35 2.1-1.05" />
      <circle cx="17.2" cy="6.8" r="3.9" fill="#000" fillOpacity="0" />
      <circle cx="17.2" cy="6.8" r="3.9" />
      <path d="M17.2 5.2v3.2M15.6 6.8h3.2" />
    </svg>
  );
}

function TagIcon({ color }: { color: string }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20.6 13.4l-7.1 7.1a2 2 0 0 1-2.8 0l-7.2-7.2A2 2 0 0 1 3 11.9V4.5a1.5 1.5 0 0 1 1.5-1.5h7.4a2 2 0 0 1 1.4.6l7.3 7.3a1.7 1.7 0 0 1 0 2.5z" />
      <circle cx="7.7" cy="7.7" r="1.3" fill={color} stroke="none" />
    </svg>
  );
}

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
  const rodapeCircleBg = '#8a45f0';
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
        {/* bloco do nome SEM flex-coluna: o html2canvas erra justifyContent
            center e corta o nome/username. A linha (alignItems center) já
            centraliza verticalmente. */}
        <div style={{ flex: 1, minWidth: 0, lineHeight: 1.15 }}>
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
          {s.username.trim() ? (
            <div
              style={{
                fontSize: 12,
                color: muted,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {s.username.replace(/^@+/, '')}
            </div>
          ) : null}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 15, flexShrink: 0 }}>
          <StickerPlusIcon color={fg} />
          <PhoneIcon color={fg} />
          <TagIcon color={fg} />
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
                {m.kind === 'audio' ? (
                  <IgAudioBubble dur={m.dur} me={m.me} dark={s.dark} radius={bubbleRadius(m.me, firstOfRun, lastOfRun)} />
                ) : (
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
                      background: m.me ? meBubbleBg(msgs.length > 1 ? i / (msgs.length - 1) : 0.5) : recvBg,
                      color: m.me ? '#ffffff' : recvFg,
                    }}
                  >
                    {emojify(m.t, emojiSet)}
                  </div>
                )}
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
    username: 'ana.souza',
    conversa: 'oii tudo bem?\nvi que você entrou no grupo\n> oi! tudo sim 😄\n> acabei de entrar mesmo\naudio 0:16\nque bom! qualquer dúvida chama',
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
      <Field label="Usuário (@)" hint="O @ do perfil (sem digitar o @)">
        <TextField
          value={s.username}
          onChange={(v) => set({ username: v })}
          placeholder="ana.souza"
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
