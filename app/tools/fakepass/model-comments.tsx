'use client';

/**
 * FakePass — bloco de COMENTÁRIOS do Instagram (bottom-sheet).
 * REFORMA FIDELIDADE 2024: grabber + header, lista com avatar colorido,
 * selo verificado, @menções/#hashtags azuis, barra de emojis de reação
 * rápida e rodapé de input. Card de altura AUTOMÁTICA (não usa StatusBar).
 * Cada linha do estado = um comentário 'usuário: texto' (✓ no fim do nome
 * = verificado).
 */

import {
  Field,
  TextArea,
  Toggle,
  Emo,
  FONT_STACK,
  type FakeModel,
} from './shared';
import type { ReactNode } from 'react';

/* ─────────────────────────── Tipos / parse ─────────────────────────── */

type S = { comentarios: string; dark: boolean };

type Comentario = { user: string; verificado: boolean; texto: string };

// valores "aleatórios porém estáveis" — ciclados por índice pra o print sair
// igual entre renders.
const TEMPOS = ['2 h', '5 h', '7 h', '9 h', '11 h', '6 h'];
const RESPOSTAS = [57, 35, 8, 7, 12, 4];
// vazio = comentário sem curtidas (só o coração, como no Instagram real)
const CURTIDAS = ['9.361', '', '14,9 mil', '16', '', '48'];

function parseComentarios(txt: string): Comentario[] {
  return txt
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter((l) => l.trim() !== '')
    .map((l) => {
      const idx = l.indexOf(':');
      let user = idx >= 0 ? l.slice(0, idx).trim() : '';
      const texto = idx >= 0 ? l.slice(idx + 1).trim() : l.trim();
      let verificado = false;
      if (user.endsWith('✓')) {
        verificado = true;
        user = user.slice(0, -1).trim();
      }
      return { user, verificado, texto };
    });
}

/* ─────── Render do texto: @menção / #hashtag azul + emojis ─────── */

const AZUL = '#0095f6';

// quebra o texto em pedaços: @menções e #hashtags viram spans azuis; o resto
// passa pelo <Emo> pra rasterizar emojis Apple.
function renderTexto(texto: string): ReactNode {
  // acha @menções e #hashtags em qualquer posição (mesmo coladas em pontuação);
  // o resto passa pelo <Emo> pra rasterizar emojis Apple.
  const re = /([@#][A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)/g;
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(texto)) !== null) {
    if (m.index > last) out.push(<Emo key={`t${k}`} t={texto.slice(last, m.index)} set="apple" />);
    out.push(
      <span key={`m${k}`} style={{ color: AZUL }}>
        {m[0]}
      </span>,
    );
    k += 1;
    last = m.index + m[0].length;
  }
  if (last < texto.length) out.push(<Emo key={`t${k}`} t={texto.slice(last)} set="apple" />);
  return out.length ? out : <Emo t={texto} set="apple" />;
}

/* ─────────────────────────── Ícones ─────────────────────────── */

function ShareIcon({ color }: { color: string }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

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

function VerifiedBadge({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#0095f6"
        d="M12 1.5l2.35 1.72 2.9-.28 1.16 2.67 2.67 1.16-.28 2.9L22.5 12l-1.72 2.35.28 2.9-2.67 1.16-1.16 2.67-2.9-.28L12 22.5l-2.35-1.72-2.9.28-1.16-2.67-2.67-1.16.28-2.9L1.5 12l1.72-2.35-.28-2.9 2.67-1.16 1.16-2.67 2.9.28L12 1.5z"
      />
      <path
        fill="#fff"
        d="M10.6 15.2l-2.9-2.9 1.3-1.3 1.6 1.6 4-4 1.3 1.3-5.3 5.3z"
      />
    </svg>
  );
}

/* ─────────────────────────── Avatar ─────────────────────────── */

// cor determinística a partir do nome (hash simples → paleta IG-like).
const CORES = [
  '#e1306c',
  '#405de6',
  '#5851db',
  '#833ab4',
  '#fd1d1d',
  '#f77737',
  '#00a884',
  '#0095f6',
  '#c13584',
];

function corDeterministica(user: string): string {
  let h = 0;
  for (let i = 0; i < user.length; i++) h = (h * 31 + user.charCodeAt(i)) >>> 0;
  return CORES[h % CORES.length];
}

function Avatar({ user }: { user: string }) {
  const inicial = (user.trim()[0] || '?').toUpperCase();
  return (
    <div
      style={{
        width: 34,
        height: 34,
        borderRadius: '50%',
        flexShrink: 0,
        background: corDeterministica(user),
        color: '#ffffff',
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

const REACOES = ['❤️', '🙌', '🔥', '👏', '😍', '😮', '😂'];

function CommentsCard({ s }: { s: S }) {
  const W = 390;
  const bg = s.dark ? '#000000' : '#ffffff';
  const txtColor = s.dark ? '#ffffff' : '#000000';
  const cinza = '#8e8e8e';
  const heartColor = cinza;
  const borda = s.dark ? '#262626' : '#dbdbdb';
  const grabber = s.dark ? '#3a3a3a' : '#d9d9d9';
  const pillBorda = s.dark ? '#363636' : '#dbdbdb';

  const itens = parseComentarios(s.comentarios);

  return (
    <div
      style={{
        width: W,
        background: bg,
        borderRadius: '14px 14px 0 0',
        fontFamily: FONT_STACK,
        WebkitFontSmoothing: 'antialiased',
        boxSizing: 'border-box',
        overflow: 'hidden',
        // line-height REAL: o palco herda `line-height:0` (ver [[project_fakepass]]) e
        // o username/tempo/"Responder"/título NÃO setam o seu → colapsavam pra altura 0
        // e o html2canvas EMBOLAVA as linhas no download. Dando altura de linha real,
        // prévia e download batem. (A linha do texto do comentário já tem 1.35 próprio.)
        lineHeight: 1.35,
      }}
    >
      {/* HEADER: grabber + título + share */}
      <div style={{ position: 'relative', padding: '10px 14px 12px' }}>
        <div
          style={{
            width: 36,
            height: 4,
            borderRadius: 2,
            background: grabber,
            margin: '0 auto 12px',
          }}
        />
        <div
          style={{
            fontSize: 15,
            fontWeight: 600,
            color: txtColor,
            textAlign: 'center',
          }}
        >
          Comentários
        </div>
        <div
          style={{
            position: 'absolute',
            right: 14,
            top: '50%',
            transform: 'translateY(-2px)',
          }}
        >
          <ShareIcon color={txtColor} />
        </div>
      </div>

      {/* LISTA */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          padding: '12px 14px',
        }}
      >
        {itens.map((c, i) => {
          const autor = i === 0;
          const mostraRespostas = autor || i % 2 === 1;
          return (
            <div
              key={i}
              style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}
            >
              <Avatar user={c.user} />

              {/* coluna do texto */}
              <div style={{ flex: 1, minWidth: 0 }}>
                {/* linha1: usuário + selo + tempo + autor */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: 4,
                  }}
                >
                  <span
                    style={{ fontSize: 13, fontWeight: 600, color: txtColor }}
                  >
                    {c.user}
                  </span>
                  {c.verificado ? <VerifiedBadge size={12} /> : null}
                  <span style={{ fontSize: 12, color: cinza, marginLeft: 4 }}>
                    {TEMPOS[i % TEMPOS.length]}
                    {autor ? ' · Autor' : ''}
                  </span>
                </div>

                {/* linha2: texto */}
                <div
                  style={{
                    marginTop: 3,
                    fontSize: 13,
                    lineHeight: 1.35,
                    color: txtColor,
                    wordBreak: 'break-word',
                    overflowWrap: 'anywhere',
                  }}
                >
                  {renderTexto(c.texto)}
                </div>

                {/* linha3: Responder · Ver X respostas */}
                <div
                  style={{
                    marginTop: 6,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14,
                    fontSize: 12,
                    color: cinza,
                  }}
                >
                  <span style={{ fontWeight: 600 }}>Responder</span>
                  {mostraRespostas ? (
                    <span>
                      Ver {RESPOSTAS[i % RESPOSTAS.length]} respostas
                    </span>
                  ) : null}
                </div>
              </div>

              {/* coração + curtidas à direita */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 4,
                  flexShrink: 0,
                  paddingTop: 2,
                }}
              >
                <Heart size={17} color={heartColor} />
                {CURTIDAS[i % CURTIDAS.length] ? (
                  <span style={{ fontSize: 11, color: cinza }}>
                    {CURTIDAS[i % CURTIDAS.length]}
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {/* BARRA DE EMOJIS de reação rápida */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-around',
          padding: 10,
          borderTop: `1px solid ${borda}`,
          fontSize: 26,
          lineHeight: 1,
        }}
      >
        {REACOES.map((e, i) => (
          <span key={i} style={{ display: 'inline-flex' }}>
            <Emo t={e} set="apple" />
          </span>
        ))}
      </div>

      {/* RODAPÉ: input */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '8px 14px 14px',
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            flexShrink: 0,
            background: corDeterministica('você'),
            color: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          V
        </div>
        <div
          style={{
            flex: 1,
            minWidth: 0,
            height: 36,
            display: 'flex',
            alignItems: 'center',
            padding: '0 14px',
            borderRadius: 999,
            border: `1px solid ${pillBorda}`,
            fontSize: 13,
            color: cinza,
          }}
        >
          Participe da conversa...
        </div>
        <div
          style={{
            flexShrink: 0,
            padding: '5px 9px',
            borderRadius: 6,
            border: `1px solid ${pillBorda}`,
            fontSize: 11,
            fontWeight: 700,
            color: cinza,
          }}
        >
          GIF
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── Modelo ─────────────────────────── */

const DEFAULT_COMENTARIOS = [
  'draco.oficial✓: quem chegou aqui pelo #reels curte aí 🔥 marca aquele amigo @lucas.mendes',
  'ana.souza: gente esse resultado é real mesmo?? 😱 preciso testar',
  'jp_martins: comprei semana passada e já vim correndo elogiar kkk melhor decisão 🙌',
  'carla.dias: alguém sabe se entrega no interior? @sac.loja me ajuda',
  'lucasf: salvando esse post na hora, conteúdo tá voando 🚀 #dicas',
].join('\n');

const COMMENTS: FakeModel<S> = {
  id: 'comments',
  label: 'Comentários',
  category: 'post',
  hue: 'rgba(255,73,133,0.4)',
  stageW: 390,
  ratio: 1.1,
  exportW: 1080,
  usesPhone: false,
  defaultState: {
    comentarios: DEFAULT_COMENTARIOS,
    dark: false,
  },
  Controls: ({ s, set }) => (
    <div className="flex flex-col gap-4">
      <Field
        label="Comentários"
        hint="Uma linha por comentário no formato usuário: texto. Ponha ✓ no fim do nome pra verificado."
      >
        <TextArea
          value={s.comentarios}
          onChange={(v) => set({ comentarios: v })}
          placeholder={'usuário: comentário aqui'}
          rows={7}
        />
      </Field>
      <Toggle on={s.dark} onChange={(v) => set({ dark: v })} label="Modo escuro" />
    </div>
  ),
  Preview: ({ s }) => <CommentsCard s={s} />,
};

export default [COMMENTS];
