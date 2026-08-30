'use client';

/**
 * FakePass — BALÃO DE RESPOSTA DE COMENTÁRIO do TikTok.
 * O sticker que aparece quando o criador responde um comentário em vídeo:
 * balão cinza-claro arredondado com a linha "Responder ao comentário de {nome}"
 * em cinza e o texto do comentário em preto por baixo — fiel ao app, inclusive
 * a variante ESCURA. Exporta como sticker (fundo do palco é só apoio visual).
 */

import { Field, TextField, TextArea, Toggle, RangeField, Emo, FONT_STACK, type FakeModel } from './shared';
import { STORY_W, STORY_RATIO, STORY_BGS, StoryStage, BgControls } from './story-kit';

type S = { nome: string; comentario: string; dark: boolean; tamanho: number; bg: string };

function TikTokReplyBubble({ s }: { s: S }) {
  const bg = s.dark ? 'rgba(37,37,40,0.96)' : '#ebebec';
  const headerColor = s.dark ? '#a9a9ae' : '#86878b';
  const textColor = s.dark ? '#ffffff' : '#161823';
  const fs = s.tamanho;
  return (
    <div
      style={{
        maxWidth: STORY_W * 0.84,
        background: bg,
        borderRadius: 10,
        padding: '9px 13px 11px',
        fontFamily: FONT_STACK,
        WebkitFontSmoothing: 'antialiased',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ color: headerColor, fontWeight: 400, fontSize: Math.max(10, fs * 0.74), lineHeight: 1.3, marginBottom: 3 }}>
        Responder ao comentário de {s.nome}
      </div>
      <div style={{ color: textColor, fontWeight: 600, fontSize: fs, lineHeight: 1.32, wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
        <Emo t={s.comentario} set="apple" />
      </div>
    </div>
  );
}

const TIKTOK_REPLY: FakeModel<S> = {
  id: 'tiktok-reply',
  label: 'Balão de comentário',
  category: 'story',
  hue: 'rgba(254,44,85,0.42)',
  stageW: STORY_W,
  ratio: STORY_RATIO,
  exportW: 1080,
  usesPhone: false,
  defaultState: {
    nome: 'Cleonice Rodrigues',
    comentario: 'eu gosto desses tipo de comentário pode colocar aí',
    dark: false,
    tamanho: 15,
    bg: STORY_BGS[6].css,
  },
  Controls: ({ s, set }) => (
    <div className="flex flex-col gap-4">
      <Field label="Nome de quem comentou"><TextField value={s.nome} onChange={(v) => set({ nome: v })} placeholder="Cleonice Rodrigues" maxLength={40} /></Field>
      <Field label="Comentário"><TextArea value={s.comentario} onChange={(v) => set({ comentario: v })} placeholder="texto do comentário" rows={3} maxLength={220} withEmoji /></Field>
      <RangeField label="Tamanho do texto" value={s.tamanho} min={12} max={22} onChange={(v) => set({ tamanho: v })} display={(v) => `${v}px`} />
      <Toggle on={s.dark} onChange={(v) => set({ dark: v })} label="Balão escuro" />
      <BgControls bg={s.bg} set={set} />
    </div>
  ),
  Preview: ({ s }) => (
    <StoryStage bg={s.bg}>
      <TikTokReplyBubble s={s} />
    </StoryStage>
  ),
};

export default [TIKTOK_REPLY];
