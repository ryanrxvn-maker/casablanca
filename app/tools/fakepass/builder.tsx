'use client';

/**
 * FakePass — CONSTRUTOR VISUAL de listas (conversas, comentários, participantes).
 *
 * Substitui os campos "uma linha por mensagem" (sintaxe manual, fácil de errar)
 * por cards clicáveis: botão + pra ADICIONAR cada tipo (texto, áudio, imagem,
 * vídeo), seletor de lado (Eu ↔ Contato), emoji por botão, duração do áudio em
 * chips, upload da mídia, reordenar e duplicar.
 *
 * Duas famílias:
 *  • ChatBuilder    — mensagens de chat (WhatsApp, Instagram DM) → ChatMsg[]
 *  • CommentBuilder — listas "usuário: texto" (lives, comentários) → string,
 *    preservando o formato que os modelos já leem (nada quebra).
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { EmojiPickerButton } from './emoji-picker';

/* ────────────────────────────── Tipos ────────────────────────────── */

export type ChatKind = 'text' | 'audio' | 'image' | 'video';

export type ChatMsg = {
  id: string;
  kind: ChatKind;
  /** true = enviada por mim (direita). */
  me: boolean;
  /** texto da mensagem — ou legenda, quando é imagem/vídeo. */
  text: string;
  /** duração exibida no áudio/vídeo (mm:ss). */
  dur: string;
  /** dataURL da imagem (no vídeo é a THUMB — o print mostra o frame parado). */
  src: string;
};

// contador puro (sem Date.now/random): o mesmo id sai no servidor e no cliente,
// então o defaultState de cada modelo é estável na hidratação.
let seq = 0;
export function newMsg(patch: Partial<ChatMsg> = {}): ChatMsg {
  seq += 1;
  return { id: `m${seq}`, kind: 'text', me: false, text: '', dur: '0:07', src: '', ...patch };
}

const AUDIO_RE = /^(?:áudio|audio)\s+(\d+:\d{2})/i;

/**
 * Normaliza o estado da conversa. Aceita o formato NOVO (ChatMsg[]) e o ANTIGO
 * (string, uma linha por mensagem, "> " = minha, "audio 0:07" = áudio) — assim
 * nenhum estado/print antigo quebra.
 */
export function toMsgs(v: unknown): ChatMsg[] {
  if (Array.isArray(v)) return v as ChatMsg[];
  if (typeof v !== 'string') return [];
  return v
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter((l) => l.trim() !== '')
    .map((raw) => {
      const me = raw.startsWith('> ');
      const body = me ? raw.slice(2) : raw;
      const a = body.match(AUDIO_RE);
      if (a) return newMsg({ kind: 'audio', me, dur: a[1] });
      return newMsg({ kind: 'text', me, text: body });
    });
}

/* ───────────────────────── Primitivos de UI ───────────────────────── */

const ICON = {
  text: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a8 8 0 0 1-11.5 7.2L4 21l1.8-5.5A8 8 0 1 1 21 12z" /></svg>
  ),
  audio: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M6 11a6 6 0 0 0 12 0M12 17v4" /></svg>
  ),
  image: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2.5" /><circle cx="8.5" cy="9.5" r="1.6" /><path d="M4 17l4.5-4.2a1.5 1.5 0 0 1 2 0L15 16l1.7-1.5a1.5 1.5 0 0 1 2 0L20 16" /></svg>
  ),
  video: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="6" width="13" height="12" rx="2.5" /><path d="M15.5 10.5 21 7v10l-5.5-3.5" /></svg>
  ),
};

const KIND_LABEL: Record<ChatKind, string> = {
  text: 'Texto',
  audio: 'Áudio',
  image: 'Imagem',
  video: 'Vídeo',
};

function IconBtn({
  title,
  onClick,
  disabled,
  danger,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className={
        'flex h-6 w-6 items-center justify-center rounded-md transition disabled:opacity-25 ' +
        (danger
          ? 'text-text-dim hover:bg-red-500/15 hover:text-red-300'
          : 'text-text-dim hover:bg-white/10 hover:text-white')
      }
    >
      {children}
    </button>
  );
}

/** Textarea que cresce sozinha com o conteúdo (1→N linhas), sem barra de rolagem. */
function GrowArea({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.height = 'auto';
      el.style.height = Math.max(34, Math.min(160, el.scrollHeight)) + 'px';
    };
    // Mede VÁRIAS vezes: no 1º paint do dev o CSS (Tailwind) e a fonte ainda não
    // assentaram, e uma medição única pegava a caixa gigante do estado transitório.
    fit();
    const raf = requestAnimationFrame(fit);
    const t = window.setTimeout(fit, 150);
    (document as any).fonts?.ready?.then(fit).catch(() => {});
    // largura do painel muda (janela/coluna) → o texto re-quebra e a altura muda
    const ro = new ResizeObserver(fit);
    if (el.parentElement) ro.observe(el.parentElement);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(t);
      ro.disconnect();
    };
  }, [value]);
  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="input-field !min-h-0 resize-none overflow-hidden !py-2 !pr-9 text-[13px] leading-snug"
    />
  );
}

/** Campo de texto com botão de emoji embutido (nada de copiar e colar). */
function TextWithEmoji({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="relative">
      <GrowArea value={value} onChange={onChange} placeholder={placeholder} />
      <span className="absolute right-1.5 top-1.5">
        <EmojiPickerButton
          align="right"
          onPick={(e) => onChange(value + e)}
          className="flex h-6 w-6 items-center justify-center rounded-md text-text-dim transition hover:bg-white/10 hover:text-white"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M8.5 14a4 4 0 0 0 7 0" /><path d="M9 9.5h.01M15 9.5h.01" /></svg>
        </EmojiPickerButton>
      </span>
    </div>
  );
}

const DUR_PRESETS = ['0:04', '0:07', '0:16', '0:32', '1:04'];

/** Duração no formato mm:ss — chips de atalho + campo livre. */
function DurationField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0:07"
        maxLength={6}
        className="input-field !w-20 !py-1.5 text-center text-[13px]"
        style={{ fontFamily: 'var(--font-mono)' }}
      />
      {DUR_PRESETS.map((d) => (
        <button
          key={d}
          type="button"
          onClick={() => onChange(d)}
          className={
            'rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ' +
            (value === d
              ? 'border-violet/65 bg-violet/15 text-white'
              : 'border-line-strong text-text-muted hover:border-violet/50 hover:text-white')
          }
          style={{ fontFamily: 'var(--font-mono)' }}
        >
          {d}
        </button>
      ))}
    </div>
  );
}

/** Miniatura clicável que abre o seletor de arquivo (imagem ou thumb do vídeo). */
function MediaPick({
  value,
  onChange,
  kind,
}: {
  value: string;
  onChange: (v: string) => void;
  kind: 'image' | 'video';
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const pick = (file?: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onChange(String(reader.result || ''));
    reader.readAsDataURL(file);
  };
  return (
    <div className="flex items-center gap-2.5">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="relative flex h-12 w-16 shrink-0 items-center justify-center overflow-hidden rounded-[10px] border border-line-strong bg-bg-soft/60 transition hover:border-violet/55"
      >
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="text-text-muted">{ICON[kind]}</span>
        )}
      </button>
      <div className="flex flex-col gap-1">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="rounded-full border border-line-strong px-2.5 py-1 text-[11.5px] font-semibold text-text-muted transition hover:border-violet/55 hover:text-white"
        >
          {value ? 'Trocar' : kind === 'video' ? 'Enviar frame' : 'Enviar imagem'}
        </button>
        {value ? (
          <button type="button" onClick={() => onChange('')} className="text-left text-[10.5px] text-text-dim hover:text-red-300">
            Remover
          </button>
        ) : null}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => pick(e.target.files?.[0])}
      />
    </div>
  );
}

/* ─────────────────────────── ChatBuilder ─────────────────────────── */

export function ChatBuilder({
  value,
  onChange,
  kinds = ['text', 'audio', 'image', 'video'],
  meLabel = 'Eu',
  themLabel = 'Contato',
}: {
  value: unknown;
  onChange: (msgs: ChatMsg[]) => void;
  kinds?: ChatKind[];
  meLabel?: string;
  themLabel?: string;
}) {
  const msgs = toMsgs(value);

  const patch = (i: number, p: Partial<ChatMsg>) =>
    onChange(msgs.map((m, k) => (k === i ? { ...m, ...p } : m)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= msgs.length) return;
    const copy = msgs.slice();
    [copy[i], copy[j]] = [copy[j], copy[i]];
    onChange(copy);
  };
  const dup = (i: number) => {
    const copy = msgs.slice();
    copy.splice(i + 1, 0, newMsg({ ...msgs[i] }));
    onChange(copy);
  };
  const del = (i: number) => onChange(msgs.filter((_, k) => k !== i));
  const add = (kind: ChatKind) => {
    // segue o lado da última mensagem (conversa costuma alternar em blocos)
    const last = msgs[msgs.length - 1];
    onChange([...msgs, newMsg({ kind, me: last ? last.me : false })]);
  };

  return (
    <div className="flex flex-col gap-2">
      {msgs.map((m, i) => (
        <div
          key={m.id}
          className={
            'rounded-[13px] border p-2.5 transition ' +
            (m.me ? 'border-violet/35 bg-violet/[0.07]' : 'border-line-strong/70 bg-bg-soft/25')
          }
        >
          {/* cabeçalho do card: lado + tipo + ações */}
          <div className="mb-2 flex items-center gap-2">
            <div className="flex overflow-hidden rounded-full border border-line-strong">
              {[
                { v: false, label: themLabel },
                { v: true, label: meLabel },
              ].map((o) => (
                <button
                  key={String(o.v)}
                  type="button"
                  onClick={() => patch(i, { me: o.v })}
                  className={
                    'px-2.5 py-1 text-[11px] font-bold transition ' +
                    (m.me === o.v ? 'bg-violet/25 text-white' : 'text-text-dim hover:text-white')
                  }
                >
                  {o.label}
                </button>
              ))}
            </div>
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-text-muted">
              {ICON[m.kind]}
              {KIND_LABEL[m.kind]}
            </span>
            <span className="ml-auto flex items-center gap-0.5">
              <IconBtn title="Subir" onClick={() => move(i, -1)} disabled={i === 0}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
              </IconBtn>
              <IconBtn title="Descer" onClick={() => move(i, 1)} disabled={i === msgs.length - 1}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M19 12l-7 7-7-7" /></svg>
              </IconBtn>
              <IconBtn title="Duplicar" onClick={() => dup(i)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h8" /></svg>
              </IconBtn>
              <IconBtn title="Remover" onClick={() => del(i)} danger>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </IconBtn>
            </span>
          </div>

          {/* corpo por tipo */}
          {m.kind === 'text' ? (
            <TextWithEmoji value={m.text} onChange={(v) => patch(i, { text: v })} placeholder="Escreva a mensagem…" />
          ) : m.kind === 'audio' ? (
            <DurationField value={m.dur} onChange={(v) => patch(i, { dur: v })} />
          ) : (
            <div className="flex flex-col gap-2">
              <MediaPick value={m.src} onChange={(v) => patch(i, { src: v })} kind={m.kind === 'video' ? 'video' : 'image'} />
              {m.kind === 'video' ? <DurationField value={m.dur} onChange={(v) => patch(i, { dur: v })} /> : null}
              <TextWithEmoji value={m.text} onChange={(v) => patch(i, { text: v })} placeholder="Legenda (opcional)" />
            </div>
          )}
        </div>
      ))}

      {/* barra de adicionar */}
      <div className="flex flex-wrap gap-1.5">
        {kinds.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => add(k)}
            className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-line-strong px-3 py-1.5 text-[12px] font-semibold text-text-muted transition hover:border-violet/60 hover:bg-violet/10 hover:text-white"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            {KIND_LABEL[k]}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ───────────────────────── CommentBuilder ───────────────────────── */

export type CommentItem = { id: string; user: string; text: string };

let cseq = 0;
function newComment(p: Partial<CommentItem> = {}): CommentItem {
  cseq += 1;
  return { id: `c${cseq}`, user: '', text: '', ...p };
}

/** "usuário: texto" por linha → itens. */
export function toComments(v: unknown): CommentItem[] {
  if (typeof v !== 'string') return [];
  return v
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((line) => {
      const i = line.indexOf(':');
      if (i === -1) return newComment({ user: line.trim(), text: '' });
      return newComment({ user: line.slice(0, i).trim(), text: line.slice(i + 1).trim() });
    });
}

/** Itens → "usuário: texto" por linha (o formato que os modelos já leem). */
export function fromComments(list: CommentItem[]): string {
  return list.map((c) => (c.text.trim() ? `${c.user}: ${c.text}` : c.user)).join('\n');
}

/**
 * Construtor de listas "usuário: texto" — comentários de live, de post, etc.
 * Guarda no MESMO formato de string que os modelos já consomem (o desenho no
 * canvas/DOM não muda em nada), só a EDIÇÃO vira visual.
 */
export function CommentBuilder({
  value,
  onChange,
  userPlaceholder = 'usuário',
  textPlaceholder = 'comentário',
  addLabel = 'Comentário',
}: {
  value: string;
  onChange: (v: string) => void;
  userPlaceholder?: string;
  textPlaceholder?: string;
  addLabel?: string;
}) {
  // Estado LOCAL como fonte de verdade da edição: a string serializada não
  // guarda linha vazia, então um card recém-criado (ainda em branco) sumia na
  // hora — o usuário clicava em + e nada aparecia. Aqui ele fica na tela até
  // ser preenchido; pra fora continua saindo a MESMA string de sempre.
  const [items, setItems] = useState<CommentItem[]>(() => toComments(value));
  const emitted = useRef(value);
  useEffect(() => {
    if (value !== emitted.current) {
      setItems(toComments(value));
      emitted.current = value;
    }
  }, [value]);
  const commit = (list: CommentItem[]) => {
    setItems(list);
    const s = fromComments(list);
    emitted.current = s;
    onChange(s);
  };

  const patch = (i: number, p: Partial<CommentItem>) =>
    commit(items.map((c, k) => (k === i ? { ...c, ...p } : c)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    const copy = items.slice();
    [copy[i], copy[j]] = [copy[j], copy[i]];
    commit(copy);
  };
  const del = (i: number) => commit(items.filter((_, k) => k !== i));
  const dup = (i: number) => {
    const copy = items.slice();
    copy.splice(i + 1, 0, newComment({ ...items[i] }));
    commit(copy);
  };

  return (
    <div className="flex flex-col gap-2">
      {items.map((c, i) => (
        <div key={c.id} className="rounded-[13px] border border-line-strong/70 bg-bg-soft/25 p-2.5">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={c.user}
              placeholder={userPlaceholder}
              onChange={(e) => patch(i, { user: e.target.value })}
              className="input-field !w-40 !py-1.5 text-[12.5px] font-semibold"
            />
            <span className="ml-auto flex items-center gap-0.5">
              <IconBtn title="Subir" onClick={() => move(i, -1)} disabled={i === 0}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
              </IconBtn>
              <IconBtn title="Descer" onClick={() => move(i, 1)} disabled={i === items.length - 1}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M19 12l-7 7-7-7" /></svg>
              </IconBtn>
              <IconBtn title="Duplicar" onClick={() => dup(i)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h8" /></svg>
              </IconBtn>
              <IconBtn title="Remover" onClick={() => del(i)} danger>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </IconBtn>
            </span>
          </div>
          <div className="mt-2">
            <TextWithEmoji value={c.text} onChange={(v) => patch(i, { text: v })} placeholder={textPlaceholder} />
          </div>
        </div>
      ))}
      <div>
        <button
          type="button"
          onClick={() => commit([...items, newComment()])}
          className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-line-strong px-3 py-1.5 text-[12px] font-semibold text-text-muted transition hover:border-violet/60 hover:bg-violet/10 hover:text-white"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
          {addLabel}
        </button>
      </div>
    </div>
  );
}
