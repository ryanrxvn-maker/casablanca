'use client';

/**
 * FakePass — bloco de COMENTÁRIOS (Instagram / TikTok).
 * Card de altura automática (não usa telefone/StatusBar). Cada linha do estado
 * é um comentário no formato 'usuário: texto'. Exporta como PNG com a altura
 * real do card.
 */

import {
  Field,
  TextArea,
  Segmented,
  Toggle,
  FONT_STACK,
  type FakeModel,
  emojify,
} from './shared';

/* ─────────────────────────── Tipos / parse ─────────────────────────── */

type S = { comentarios: string; dark: boolean; estilo: string };

type Comentario = { user: string; texto: string; likes: number };

// tempos e contagens "aleatórios porém estáveis" derivados do índice — mantém
// o print consistente entre renders (nada de Math.random no meio do preview).
const TEMPOS = ['2 h', '5 h', '1 d', '3 d', '1 sem', '38 min', '2 sem', '12 h'];
const LIKES = [128, 12, 341, 3, 57, 1, 892, 24, 6, 210];

function parseComentarios(txt: string): Comentario[] {
  return txt
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter((l) => l.trim() !== '')
    .map((l, i) => {
      const idx = l.indexOf(':');
      const user = idx >= 0 ? l.slice(0, idx).trim() : '';
      const texto = idx >= 0 ? l.slice(idx + 1).trim() : l.trim();
      return { user, texto, likes: LIKES[i % LIKES.length] };
    });
}

// nº de curtidas com "mil" pt-BR pra números grandes.
function fmtLikes(n: number): string {
  if (n >= 1000) {
    const m = Math.round(n / 100) / 10;
    return `${m} mil`.replace('.', ',');
  }
  return String(n);
}

/* ─────────────────────────── Ícones ─────────────────────────── */

function Heart({ size, color }: { size: number; color: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z" />
    </svg>
  );
}

/* ─────────────────────────── Avatar ─────────────────────────── */

// círculo cinza com a inicial do usuário (fallback padrão dos apps).
function Avatar({ user, dark }: { user: string; dark: boolean }) {
  const inicial = (user.trim()[0] || '?').toUpperCase();
  return (
    <div
      style={{
        width: 36,
        height: 36,
        borderRadius: '50%',
        flexShrink: 0,
        background: dark ? '#2a2a2a' : '#dbdbdb',
        color: dark ? '#8e8e8e' : '#ffffff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 15,
        fontWeight: 600,
        lineHeight: 1,
      }}
    >
      {inicial}
    </div>
  );
}

/* ─────────────────────────── Card ─────────────────────────── */

function CommentsCard({ s }: { s: S }) {
  const W = 380;
  const tiktok = s.estilo === 'tiktok';
  const bg = s.dark ? '#000000' : '#ffffff';
  const txtColor = s.dark ? '#ffffff' : '#000000';
  // meta (tempo/curtidas/responder): cinza padrão IG; no TikTok um cinza mais escuro.
  const metaColor = s.dark
    ? tiktok
      ? '#6b6b6b'
      : '#a8a8a8'
    : tiktok
    ? '#8a8b91'
    : '#8e8e8e';
  const heartColor = s.dark ? '#a8a8a8' : '#262626';

  const itens = parseComentarios(s.comentarios);

  return (
    <div
      style={{
        width: W,
        background: bg,
        padding: '12px 16px',
        fontFamily: FONT_STACK,
        WebkitFontSmoothing: 'antialiased',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {itens.map((c, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <Avatar user={c.user} dark={s.dark} />

            {/* coluna do texto */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 13,
                  lineHeight: 1.4,
                  color: txtColor,
                  wordBreak: 'break-word',
                  overflowWrap: 'anywhere',
                }}
              >
                {c.user ? (
                  <span style={{ fontWeight: 600 }}>{c.user} </span>
                ) : null}
                <span style={{ fontWeight: 400 }}>{emojify(c.texto, 'apple')}</span>
              </div>

              {/* meta */}
              <div
                style={{
                  marginTop: 5,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 16,
                  fontSize: 11,
                  fontWeight: 600,
                  color: metaColor,
                }}
              >
                <span style={{ fontWeight: 400 }}>há {TEMPOS[i % TEMPOS.length]}</span>
                {!tiktok ? (
                  <span>{fmtLikes(c.likes)} curtidas</span>
                ) : null}
                <span>Responder</span>
              </div>
            </div>

            {/* coração à direita */}
            {tiktok ? (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 3,
                  flexShrink: 0,
                  paddingTop: 2,
                }}
              >
                <Heart size={18} color={heartColor} />
                <span style={{ fontSize: 11, fontWeight: 400, color: metaColor }}>
                  {fmtLikes(c.likes)}
                </span>
              </div>
            ) : (
              <div style={{ flexShrink: 0, paddingTop: 2 }}>
                <Heart size={14} color={heartColor} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────── Modelo ─────────────────────────── */

const DEFAULT_COMENTARIOS = [
  'ana.souza: gente, esse resultado é real mesmo?? 😱',
  'jp_martins: comprei semana passada e já cheguei correndo aqui elogiar kkk',
  'carla.dias: alguém sabe se entrega no interior?',
  'lucasf: melhor decisão que tomei esse ano, sério',
].join('\n');

const COMMENTS: FakeModel<S> = {
  id: 'comments',
  label: 'Comentários',
  category: 'post',
  hue: 'rgba(255,73,133,0.4)',
  stageW: 380,
  ratio: 1.0,
  exportW: 1080,
  usesPhone: false,
  defaultState: {
    comentarios: DEFAULT_COMENTARIOS,
    dark: false,
    estilo: 'ig',
  },
  Controls: ({ s, set }) => (
    <div className="flex flex-col gap-4">
      <Field
        label="Comentários"
        hint="Uma linha por comentário, formato usuário: texto"
      >
        <TextArea
          value={s.comentarios}
          onChange={(v) => set({ comentarios: v })}
          placeholder={'usuário: comentário aqui'}
          rows={6}
        />
      </Field>
      <Field label="Estilo">
        <Segmented
          value={s.estilo}
          options={[
            { value: 'ig', label: 'Instagram' },
            { value: 'tiktok', label: 'TikTok' },
          ]}
          onChange={(v) => set({ estilo: v })}
        />
      </Field>
      <Toggle on={s.dark} onChange={(v) => set({ dark: v })} label="Modo escuro" />
    </div>
  ),
  Preview: ({ s }) => <CommentsCard s={s} />,
};

export default [COMMENTS];
