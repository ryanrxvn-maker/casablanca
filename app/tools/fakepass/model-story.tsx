'use client';

/**
 * FakePass — modelos de STICKER DE STORY.
 * Caixinha de Pergunta, Enquete, Quiz e Slider de Emoji. Todos sobre o
 * StoryStage (fundo colorido) e com fundo personalizável via BgControls.
 */

import { FitText, Field, TextField, TextArea, Segmented, RangeField, FONT_STACK, type FakeModel } from './shared';
import { STORY_W, STORY_RATIO, STORY_BGS, StoryStage, BgControls } from './story-kit';

/* ═══════════════════ Caixinha de Pergunta ═══════════════════ */

type QuestionState = { header: string; pergunta: string; bg: string };

function QuestionSticker({ header, pergunta }: { header: string; pergunta: string }) {
  return (
    <div style={{ width: STORY_W * 0.8, borderRadius: 11, overflow: 'hidden', boxShadow: '0 8px 24px rgba(0,0,0,0.16)', WebkitFontSmoothing: 'antialiased', fontFamily: FONT_STACK }}>
      <FitText maxPx={15} minPx={11} maxHeight={STORY_W * 0.2} style={{ background: '#262626', color: '#fff', padding: '13px 20px', textAlign: 'center', fontWeight: 400, lineHeight: 1.3, letterSpacing: '-0.01em', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {header}
      </FitText>
      <FitText maxPx={21} minPx={13} maxHeight={STORY_W * 0.5} style={{ background: '#fff', color: '#454545', padding: '24px 22px', textAlign: 'center', fontWeight: 400, lineHeight: 1.32, letterSpacing: '-0.015em', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {pergunta}
      </FitText>
    </div>
  );
}

const IG_QUESTION: FakeModel<QuestionState> = {
  id: 'ig-question', label: 'Caixinha de Pergunta', category: 'story', hue: 'rgba(74,160,230,0.42)',
  stageW: STORY_W, ratio: STORY_RATIO, exportW: 1080, usesPhone: false,
  defaultState: { header: 'Faça uma pergunta', pergunta: 'Drop ainda vai valer a pena com essas taxas?', bg: STORY_BGS[0].css },
  Controls: ({ s, set }) => (
    <div className="flex flex-col gap-4">
      <Field label="Pergunta do topo"><TextField value={s.header} onChange={(v) => set({ header: v })} placeholder="Faça uma pergunta" maxLength={80} /></Field>
      <Field label="A pergunta / mensagem"><TextArea value={s.pergunta} onChange={(v) => set({ pergunta: v })} placeholder="Escreve a pergunta…" maxLength={280} rows={3} /></Field>
      <BgControls bg={s.bg} set={set} />
    </div>
  ),
  Preview: ({ s }) => <StoryStage bg={s.bg}><QuestionSticker header={s.header} pergunta={s.pergunta} /></StoryStage>,
};

/* ═══════════════════ Enquete ═══════════════════ */

type PollState = { pergunta: string; opA: string; opB: string; bg: string };

function PollSticker({ pergunta, opA, opB }: { pergunta: string; opA: string; opB: string }) {
  const cell: React.CSSProperties = { flex: 1, padding: '14px 10px', textAlign: 'center', fontSize: 18, fontWeight: 700, color: '#262626', lineHeight: 1.25, whiteSpace: 'pre-wrap', wordBreak: 'break-word' };
  return (
    <div style={{ width: STORY_W * 0.82, borderRadius: 14, overflow: 'hidden', background: 'rgba(255,255,255,0.92)', boxShadow: '0 8px 24px rgba(0,0,0,0.16)', WebkitFontSmoothing: 'antialiased', fontFamily: FONT_STACK }}>
      <FitText maxPx={19} minPx={13} maxHeight={STORY_W * 0.36} style={{ color: '#262626', padding: '18px 18px 14px', textAlign: 'center', fontWeight: 500, lineHeight: 1.3, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {pergunta}
      </FitText>
      <div style={{ display: 'flex', borderTop: '1px solid rgba(0,0,0,0.08)' }}>
        <div style={cell}>{opA || ' '}</div>
        <div style={{ ...cell, borderLeft: '1px solid rgba(0,0,0,0.08)' }}>{opB || ' '}</div>
      </div>
    </div>
  );
}

const IG_POLL: FakeModel<PollState> = {
  id: 'ig-poll', label: 'Enquete', category: 'story', hue: 'rgba(232,121,249,0.42)',
  stageW: STORY_W, ratio: STORY_RATIO, exportW: 1080, usesPhone: false,
  defaultState: { pergunta: 'Qual é melhor?', opA: 'Esse', opB: 'Aquele', bg: STORY_BGS[1].css },
  Controls: ({ s, set }) => (
    <div className="flex flex-col gap-4">
      <Field label="Pergunta"><TextField value={s.pergunta} onChange={(v) => set({ pergunta: v })} placeholder="Qual é melhor?" maxLength={120} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Opção A"><TextField value={s.opA} onChange={(v) => set({ opA: v })} placeholder="Sim" maxLength={40} /></Field>
        <Field label="Opção B"><TextField value={s.opB} onChange={(v) => set({ opB: v })} placeholder="Não" maxLength={40} /></Field>
      </div>
      <BgControls bg={s.bg} set={set} />
    </div>
  ),
  Preview: ({ s }) => <StoryStage bg={s.bg}><PollSticker pergunta={s.pergunta} opA={s.opA} opB={s.opB} /></StoryStage>,
};

/* ═══════════════════ Quiz ═══════════════════ */

type QuizState = { pergunta: string; ops: string[]; correta: number; bg: string };

function QuizSticker({ pergunta, ops, correta }: { pergunta: string; ops: string[]; correta: number }) {
  const items = ops.map((o, i) => ({ o, i })).filter((x) => x.o.trim() !== '');
  return (
    <div style={{ width: STORY_W * 0.82, borderRadius: 16, background: 'rgba(255,255,255,0.96)', boxShadow: '0 8px 24px rgba(0,0,0,0.16)', WebkitFontSmoothing: 'antialiased', fontFamily: FONT_STACK, padding: '16px 14px' }}>
      <FitText maxPx={18} minPx={13} maxHeight={STORY_W * 0.3} style={{ color: '#262626', padding: '2px 6px 12px', textAlign: 'center', fontWeight: 600, lineHeight: 1.3, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {pergunta}
      </FitText>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map(({ o, i }) => {
          const ok = i === correta;
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '11px 12px', borderRadius: 11, fontSize: 15, fontWeight: 600, background: ok ? '#e6f8ef' : '#f2f2f2', color: ok ? '#12885a' : '#333333', border: ok ? '1.5px solid #37c98a' : '1.5px solid transparent' }}>
              <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', textAlign: 'center' }}>{o}</span>
              {ok ? <span style={{ fontSize: 15 }}>✓</span> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const IG_QUIZ: FakeModel<QuizState> = {
  id: 'ig-quiz', label: 'Quiz', category: 'story', hue: 'rgba(52,201,138,0.42)',
  stageW: STORY_W, ratio: STORY_RATIO, exportW: 1080, usesPhone: false,
  defaultState: { pergunta: 'Qual a capital do Brasil?', ops: ['Brasília', 'São Paulo', 'Rio', ''], correta: 0, bg: STORY_BGS[3].css },
  Controls: ({ s, set }) => {
    const filled = s.ops.map((o, i) => ({ o, i })).filter((x) => x.o.trim() !== '');
    return (
      <div className="flex flex-col gap-4">
        <Field label="Pergunta"><TextField value={s.pergunta} onChange={(v) => set({ pergunta: v })} placeholder="Sua pergunta" maxLength={120} /></Field>
        <div className="grid grid-cols-2 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <Field key={i} label={`Opção ${i + 1}`}>
              <TextField value={s.ops[i]} onChange={(v) => { const ops = [...s.ops]; ops[i] = v; set({ ops }); }} placeholder={i < 2 ? 'Obrigatória' : 'Opcional'} maxLength={40} />
            </Field>
          ))}
        </div>
        <Field label="Resposta certa"><Segmented value={String(s.correta)} options={filled.map((x) => ({ value: String(x.i), label: `Opção ${x.i + 1}` }))} onChange={(v) => set({ correta: parseInt(v, 10) })} /></Field>
        <BgControls bg={s.bg} set={set} />
      </div>
    );
  },
  Preview: ({ s }) => <StoryStage bg={s.bg}><QuizSticker pergunta={s.pergunta} ops={s.ops} correta={s.correta} /></StoryStage>,
};

/* ═══════════════════ Slider de Emoji ═══════════════════ */

type SliderState = { pergunta: string; emoji: string; valor: number; bg: string };
const EMOJIS = ['😍', '🔥', '😂', '😮', '❤️', '👏', '🥵', '💯'];

function SliderSticker({ pergunta, emoji, valor }: { pergunta: string; emoji: string; valor: number }) {
  const v = Math.max(0, Math.min(100, valor));
  return (
    <div style={{ width: STORY_W * 0.82, borderRadius: 16, background: 'rgba(255,255,255,0.96)', boxShadow: '0 8px 24px rgba(0,0,0,0.16)', WebkitFontSmoothing: 'antialiased', fontFamily: FONT_STACK, padding: '18px 22px 30px' }}>
      <FitText maxPx={18} minPx={13} maxHeight={STORY_W * 0.3} style={{ color: '#262626', padding: '0 0 20px', textAlign: 'center', fontWeight: 500, lineHeight: 1.3, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {pergunta}
      </FitText>
      <div style={{ position: 'relative', height: 12, borderRadius: 6, background: '#ededed' }}>
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${v}%`, borderRadius: 6, background: 'linear-gradient(90deg,#ffd54a,#ff5e8a)' }} />
        <div style={{ position: 'absolute', left: `${v}%`, top: '50%', transform: 'translate(-50%,-50%)', fontSize: 32, lineHeight: 1, filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.25))' }}>{emoji || '😍'}</div>
      </div>
    </div>
  );
}

const IG_SLIDER: FakeModel<SliderState> = {
  id: 'ig-slider', label: 'Slider de Emoji', category: 'story', hue: 'rgba(255,94,138,0.42)',
  stageW: STORY_W, ratio: STORY_RATIO, exportW: 1080, usesPhone: false,
  defaultState: { pergunta: 'O quanto você curtiu?', emoji: '😍', valor: 70, bg: STORY_BGS[2].css },
  Controls: ({ s, set }) => (
    <div className="flex flex-col gap-4">
      <Field label="Pergunta"><TextField value={s.pergunta} onChange={(v) => set({ pergunta: v })} placeholder="Sua pergunta" maxLength={120} /></Field>
      <Field label="Emoji">
        <div className="flex flex-wrap items-center gap-2">
          {EMOJIS.map((e) => (
            <button key={e} type="button" onClick={() => set({ emoji: e })} className={'flex h-9 w-9 items-center justify-center rounded-full border text-[18px] transition ' + (s.emoji === e ? 'border-violet/70 bg-violet/15' : 'border-line-strong hover:border-violet/50')}>{e}</button>
          ))}
          <input type="text" value={s.emoji} onChange={(e) => set({ emoji: e.target.value.slice(0, 2) })} className="input-field !w-16 text-center" maxLength={2} />
        </div>
      </Field>
      <RangeField label="Posição" value={s.valor} min={0} max={100} onChange={(v) => set({ valor: v })} display={(v) => v + '%'} />
      <BgControls bg={s.bg} set={set} />
    </div>
  ),
  Preview: ({ s }) => <StoryStage bg={s.bg}><SliderSticker pergunta={s.pergunta} emoji={s.emoji} valor={s.valor} /></StoryStage>,
};

export const STORY_MODELS: FakeModel[] = [IG_QUESTION, IG_POLL, IG_QUIZ, IG_SLIDER];
