'use client';

/**
 * FakePass — registro de MODELOS.
 *
 * Cada modelo é um objeto FakeModel (ver shared.tsx) com controles + preview
 * próprios. Adicionar um modelo novo = escrever um objeto e incluí-lo em MODELS.
 * O shell (page.tsx) cuida de seleção, palco e export automaticamente.
 */

import type { ReactNode } from 'react';
import {
  FitText,
  Field,
  TextField,
  TextArea,
  Swatches,
  type FakeModel,
  FONT_STACK,
} from './shared';

/* ───────────────── Fundos de Story (compartilhados) ───────────────── */

export const STORY_BGS: { id: string; label: string; css: string; solid?: string }[] = [
  { id: 'azul', label: 'Azul', css: '#4aa0e6', solid: '#4aa0e6' },
  { id: 'insta', label: 'Instagram', css: 'linear-gradient(45deg,#feda75 0%,#fa7e1e 25%,#d62976 50%,#962fbf 75%,#4f5bd5 100%)' },
  { id: 'sol', label: 'Pôr do sol', css: 'linear-gradient(160deg,#f6d365 0%,#fda085 100%)' },
  { id: 'roxo', label: 'Roxo', css: '#7b4de0', solid: '#7b4de0' },
  { id: 'verde', label: 'Verde', css: '#22b573', solid: '#22b573' },
  { id: 'preto', label: 'Preto', css: '#101010', solid: '#101010' },
  { id: 'grafite', label: 'Grafite', css: 'linear-gradient(160deg,#3a3a3f 0%,#141416 100%)' },
];

const STORY_W = 340;
const STORY_RATIO = 16 / 9;

/** Palco de Story: fundo (cor/gradiente) com o sticker centralizado. */
function StoryStage({ bg, children }: { bg: string; children: ReactNode }) {
  return (
    <div
      style={{
        width: STORY_W,
        height: Math.round(STORY_W * STORY_RATIO),
        background: bg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {children}
    </div>
  );
}

/** Controles de fundo reusados por todos os stickers de Story. */
function BgControls({ bg, set }: { bg: string; set: (p: any) => void }) {
  const isGrad = bg.startsWith('linear-gradient');
  const solid = STORY_BGS.find((f) => f.css === bg)?.solid ?? (bg.startsWith('#') ? bg : '#4aa0e6');
  return (
    <Field label="Fundo">
      <div className="flex flex-wrap items-center gap-2.5">
        <Swatches value={bg} colors={STORY_BGS.map((f) => f.css)} onChange={(v) => set({ bg: v })} />
        <label
          className="relative inline-flex h-9 w-9 cursor-pointer items-center justify-center overflow-hidden rounded-full border-2 border-white/25 transition hover:border-white/60"
          title="Cor personalizada"
          style={{ background: isGrad ? 'conic-gradient(from 0deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)' : solid }}
        >
          <input type="color" className="absolute inset-0 cursor-pointer opacity-0" value={solid} onChange={(e) => set({ bg: e.target.value })} />
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="relative">
            <path d="M12 19l7-7 3 3-7 7-3-3z" /><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" /><path d="M2 2l7.586 7.586" /><circle cx="11" cy="11" r="2" />
          </svg>
        </label>
      </div>
    </Field>
  );
}

/* ═══════════════════ MODELO 1 — Caixinha de Pergunta ═══════════════════ */

type QuestionState = { header: string; pergunta: string; bg: string };

function QuestionSticker({ header, pergunta }: { header: string; pergunta: string }) {
  return (
    <div
      className={uiClass()}
      style={{
        width: STORY_W * 0.8,
        borderRadius: 11,
        overflow: 'hidden',
        boxShadow: '0 8px 24px rgba(0,0,0,0.16)',
        WebkitFontSmoothing: 'antialiased',
        fontFamily: FONT_STACK,
      }}
    >
      <FitText
        maxPx={15}
        minPx={11}
        maxHeight={STORY_W * 0.2}
        style={{ background: '#262626', color: '#fff', padding: '13px 20px', textAlign: 'center', fontWeight: 400, lineHeight: 1.3, letterSpacing: '-0.01em', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
      >
        {header}
      </FitText>
      <FitText
        maxPx={21}
        minPx={13}
        maxHeight={STORY_W * 0.5}
        style={{ background: '#fff', color: '#454545', padding: '24px 22px', textAlign: 'center', fontWeight: 400, lineHeight: 1.32, letterSpacing: '-0.015em', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
      >
        {pergunta}
      </FitText>
    </div>
  );
}

const IG_QUESTION: FakeModel<QuestionState> = {
  id: 'ig-question',
  label: 'Caixinha de Pergunta',
  category: 'story',
  hue: 'rgba(74,160,230,0.42)',
  stageW: STORY_W,
  ratio: STORY_RATIO,
  exportW: 1080,
  usesPhone: false,
  defaultState: { header: 'Faça uma pergunta', pergunta: 'Drop ainda vai valer a pena com essas taxas?', bg: STORY_BGS[0].css },
  Controls: ({ s, set }) => (
    <div className="flex flex-col gap-4">
      <Field label="Pergunta do topo">
        <TextField value={s.header} onChange={(v) => set({ header: v })} placeholder="Faça uma pergunta" maxLength={80} />
      </Field>
      <Field label="A pergunta / mensagem">
        <TextArea value={s.pergunta} onChange={(v) => set({ pergunta: v })} placeholder="Escreve a pergunta…" maxLength={280} rows={3} />
      </Field>
      <BgControls bg={s.bg} set={set} />
    </div>
  ),
  Preview: ({ s }) => (
    <StoryStage bg={s.bg}>
      <QuestionSticker header={s.header} pergunta={s.pergunta} />
    </StoryStage>
  ),
};

/* ═══════════════════════ MODELO 2 — Enquete (Poll) ═══════════════════════ */

type PollState = { pergunta: string; opA: string; opB: string; bg: string };

function PollSticker({ pergunta, opA, opB }: { pergunta: string; opA: string; opB: string }) {
  const cell: React.CSSProperties = {
    flex: 1,
    padding: '14px 10px',
    textAlign: 'center',
    fontSize: 18,
    fontWeight: 700,
    color: '#262626',
    lineHeight: 1.25,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  };
  return (
    <div
      style={{
        width: STORY_W * 0.82,
        borderRadius: 14,
        overflow: 'hidden',
        background: 'rgba(255,255,255,0.92)',
        boxShadow: '0 8px 24px rgba(0,0,0,0.16)',
        WebkitFontSmoothing: 'antialiased',
        fontFamily: FONT_STACK,
      }}
    >
      <FitText
        maxPx={19}
        minPx={13}
        maxHeight={STORY_W * 0.36}
        style={{ color: '#262626', padding: '18px 18px 14px', textAlign: 'center', fontWeight: 500, lineHeight: 1.3, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
      >
        {pergunta}
      </FitText>
      <div style={{ display: 'flex', borderTop: '1px solid rgba(0,0,0,0.08)' }}>
        <div style={cell}>{opA || ' '}</div>
        <div style={{ ...cell, borderLeft: '1px solid rgba(0,0,0,0.08)' }}>{opB || ' '}</div>
      </div>
    </div>
  );
}

const IG_POLL: FakeModel<PollState> = {
  id: 'ig-poll',
  label: 'Enquete',
  category: 'story',
  hue: 'rgba(232,121,249,0.42)',
  stageW: STORY_W,
  ratio: STORY_RATIO,
  exportW: 1080,
  usesPhone: false,
  defaultState: { pergunta: 'Qual é melhor?', opA: 'Esse', opB: 'Aquele', bg: STORY_BGS[1].css },
  Controls: ({ s, set }) => (
    <div className="flex flex-col gap-4">
      <Field label="Pergunta">
        <TextField value={s.pergunta} onChange={(v) => set({ pergunta: v })} placeholder="Qual é melhor?" maxLength={120} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Opção A">
          <TextField value={s.opA} onChange={(v) => set({ opA: v })} placeholder="Sim" maxLength={40} />
        </Field>
        <Field label="Opção B">
          <TextField value={s.opB} onChange={(v) => set({ opB: v })} placeholder="Não" maxLength={40} />
        </Field>
      </div>
      <BgControls bg={s.bg} set={set} />
    </div>
  ),
  Preview: ({ s }) => (
    <StoryStage bg={s.bg}>
      <PollSticker pergunta={s.pergunta} opA={s.opA} opB={s.opB} />
    </StoryStage>
  ),
};

/* ─────────────── util: className da fonte (var --font-fp) ─────────────── */
// A fonte Inter local injeta a var no escopo via className; como os stickers
// usam FONT_STACK (que referencia var(--font-fp)), precisamos que a var exista
// no DOM. O shell aplica uiFont.variable no palco, então aqui só usamos a stack.
function uiClass() {
  return '';
}

/* ─────────────────────────── Registro ─────────────────────────── */

export const CATEGORIES: { id: string; label: string }[] = [
  { id: 'story', label: 'Stickers de Story' },
  { id: 'chat', label: 'Conversas' },
  { id: 'post', label: 'Posts' },
  { id: 'notif', label: 'Notificações' },
];

export const MODELS: FakeModel[] = [IG_QUESTION, IG_POLL];
