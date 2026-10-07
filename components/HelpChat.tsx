'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { DarkoLogo } from './DarkoLogo';
import {
  HELP_TOPICS,
  MAX_DESCRICAO,
  buildSupportMessage,
  cleanText,
  detectTopic,
  followUpFor,
  looksLikeEmail,
  toolFromPath,
  whatsappUrl,
  type HelpTopic,
  type HelpTopicId,
} from '@/lib/help-chat';
import s from './HelpChat.module.css';

/**
 * CHAT DE AJUDA (07.10) — substitui o botão verde do WhatsApp.
 *
 * Botão roxo no canto → mini chat com sugestões ("Problemas com a conta",
 * "Erro em alguma ferramenta"...). A pessoa conta o problema e o chat devolve
 * um botão que abre o WhatsApp do suporte com a mensagem JÁ ESCRITA: quem é
 * (nome + e-mail da conta), o que houve e em que página estava. O chat não
 * finge responder nada: atendimento é gente, no WhatsApp.
 *
 * Montado no layout raiz (todas as páginas). O pulso do botão é enfeite →
 * `ae-ambient` (pausa no modo descanso, ver AmbientCalm).
 */

type NewMsg = { kind: 'bot'; text: string } | { kind: 'user'; text: string } | { kind: 'cta'; message: string };
type Msg = NewMsg & { id: number };

type Chips = { kind: 'topics' } | { kind: 'quick'; items: string[] } | { kind: 'email' } | { kind: 'done' } | null;

type Stage = 'topic' | 'describe' | 'email' | 'done';

type Identity = { logged: boolean; name: string | null; firstName: string | null; email: string | null };

const ANON: Identity = { logged: false, name: null, firstName: null, email: null };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const PLACEHOLDER: Record<Stage, string> = {
  topic: 'Escreva sua dúvida ou problema...',
  describe: 'Conte o que aconteceu...',
  email: 'seu@email.com',
  done: 'Quer acrescentar algum detalhe?',
};

// ─── quem está pedindo ajuda ────────────────────────────────────────────────
// Sessão local (instantânea: e-mail + nome do cadastro) e o nome do perfil,
// buscado UMA vez por usuário e só quando o chat é usado: nenhuma query a
// mais no carregamento das páginas. Perfil lento nunca segura a conversa.
const profileName = new Map<string, Promise<string | null>>();

function withTimeout<T>(p: PromiseLike<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    Promise.resolve(p).then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

type Supa = ReturnType<typeof import('@/lib/supabase/client').createClient>;

function fetchProfileName(supabase: Supa, uid: string): Promise<string | null> {
  let p = profileName.get(uid);
  if (!p) {
    p = withTimeout(supabase.from('profiles').select('name').eq('id', uid).maybeSingle(), 6000)
      .then(({ data }) => (data?.name ? String(data.name).trim() || null : null))
      .catch(() => {
        profileName.delete(uid); // falhou: tenta de novo na próxima
        return null;
      });
    profileName.set(uid, p);
  }
  return p;
}

/** `waitProfileMs`: quanto esperar o nome do perfil antes de ficar com o da sessão. */
async function loadIdentity(waitProfileMs = 4000): Promise<Identity> {
  try {
    const { createClient } = await import('@/lib/supabase/client');
    const supabase = createClient();
    const { data } = await withTimeout(supabase.auth.getSession(), 4000);
    const user = data.session?.user;
    if (!user) return ANON;
    const meta = (user.user_metadata || {}) as Record<string, unknown>;
    const fromMeta =
      (typeof meta.full_name === 'string' && meta.full_name.trim()) ||
      (typeof meta.name === 'string' && meta.name.trim()) ||
      null;
    const fromProfile = await Promise.race([fetchProfileName(supabase, user.id), sleep(waitProfileMs).then(() => null)]);
    const name = fromProfile || fromMeta;
    return {
      logged: true,
      name,
      firstName: name ? name.split(/\s+/)[0] : null,
      email: user.email ?? null,
    };
  } catch {
    return ANON;
  }
}

/** "digitando..." proporcional ao tamanho da fala, sem enrolar */
const typingMs = (text: string) => 420 + Math.min(820, text.length * 11);

// ─── ícones (traço fino, desenhados pra cá) ─────────────────────────────────

function ChatGlyph() {
  return (
    <svg width="27" height="27" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#fff"
        d="M12 3.6c-4.97 0-9 3.3-9 7.38 0 2.2 1.17 4.17 3.03 5.52-.12 1.25-.62 2.5-1.6 3.5a.42.42 0 0 0 .32.71c2-.1 3.62-.82 4.74-1.68.8.19 1.64.29 2.51.29 4.97 0 9-3.3 9-7.36 0-4.07-4.03-7.37-9-7.37Z"
      />
      <circle className={s.dot} cx="8.1" cy="11" r="1.3" fill="#6f42e8" />
      <circle className={s.dot} cx="12" cy="11" r="1.3" fill="#6f42e8" />
      <circle className={s.dot} cx="15.9" cy="11" r="1.3" fill="#6f42e8" />
    </svg>
  );
}

function CloseGlyph({ size = 22, stroke = 2.2 }: { size?: number; stroke?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" aria-hidden="true">
      <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
    </svg>
  );
}

function WhatsGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 2.1.55 4.16 1.6 5.96L2 22l4.27-1.12a9.9 9.9 0 004.77 1.21h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.84 9.84 0 0012.04 2zm0 18.15h-.01a8.21 8.21 0 01-4.18-1.14l-.3-.18-3.1.81.83-3.02-.2-.31a8.18 8.18 0 01-1.25-4.4c0-4.54 3.69-8.23 8.23-8.23 2.2 0 4.27.86 5.82 2.41a8.16 8.16 0 012.41 5.82c0 4.54-3.69 8.24-8.25 8.24zm4.52-6.16c-.25-.12-1.47-.72-1.7-.81-.23-.08-.39-.12-.56.13-.16.25-.65.81-.79.97-.15.17-.29.18-.54.06a6.74 6.74 0 01-1.98-1.22 7.45 7.45 0 01-1.37-1.71c-.14-.25-.01-.38.11-.5.11-.11.25-.29.37-.43.12-.14.16-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.35-.77-1.85-.2-.49-.41-.42-.56-.43h-.48c-.17 0-.43.06-.66.31-.23.25-.86.84-.86 2.04 0 1.2.88 2.37 1 2.53.12.17 1.74 2.65 4.2 3.72.59.25 1.04.4 1.4.52.59.19 1.12.16 1.54.1.47-.07 1.47-.6 1.68-1.18.21-.58.21-1.08.14-1.18-.06-.1-.22-.16-.47-.28z" />
    </svg>
  );
}

function LineIcon({ d, size = 18, children }: { d?: string; size?: number; children?: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {d ? <path d={d} /> : null}
      {children}
    </svg>
  );
}

function TopicIcon({ id }: { id: HelpTopicId }) {
  switch (id) {
    case 'conta':
      return (
        <LineIcon>
          <circle cx="12" cy="8.6" r="3.6" />
          <path d="M5 19.6c1.4-3.1 4-4.6 7-4.6s5.6 1.5 7 4.6" />
        </LineIcon>
      );
    case 'ferramenta':
      return (
        <LineIcon>
          <path d="M10.3 4.6 3.4 17a2 2 0 0 0 1.7 3h13.8a2 2 0 0 0 1.7-3L13.7 4.6a2 2 0 0 0-3.4 0Z" />
          <path d="M12 10v3.6" />
          <circle cx="12" cy="16.6" r=".5" fill="currentColor" />
        </LineIcon>
      );
    case 'duvida':
      return (
        <LineIcon>
          <circle cx="12" cy="12" r="8.6" />
          <path d="M9.7 9.6a2.4 2.4 0 0 1 4.7.7c0 1.6-2.4 2.1-2.4 3.6" />
          <circle cx="12" cy="16.8" r=".5" fill="currentColor" />
        </LineIcon>
      );
    case 'pagamento':
      return (
        <LineIcon>
          <rect x="3" y="5.6" width="18" height="12.8" rx="2.6" />
          <path d="M3 10h18M7 14.8h3.4" />
        </LineIcon>
      );
  }
}

// ─── cartão da mensagem pronta ──────────────────────────────────────────────

function CtaCard({ message }: { message: string }) {
  const [copied, setCopied] = useState(false);
  const [opened, setOpened] = useState(false);
  const href = whatsappUrl(message);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(t);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
    } catch {
      /* sem permissão de área de transferência: o botão do WhatsApp segue valendo */
    }
  };

  return (
    <div className={s.cta}>
      <div className={s.ctaInner}>
        <div className={s.ctaHead}>
          <span>Sua mensagem pro suporte</span>
          <button type="button" className={s.copy} onClick={copy} aria-label="Copiar mensagem">
            {copied ? (
              <LineIcon size={13} d="m5 12.5 4.5 4.5L19 7.5" />
            ) : (
              <LineIcon size={13}>
                <rect x="8" y="8" width="12" height="12" rx="2.6" />
                <path d="M16 8V6.6A2.6 2.6 0 0 0 13.4 4H6.6A2.6 2.6 0 0 0 4 6.6v6.8A2.6 2.6 0 0 0 6.6 16H8" />
              </LineIcon>
            )}
            {copied ? 'Copiada' : 'Copiar'}
          </button>
        </div>
        <div className={s.preview} data-testid="help-chat-preview">
          {message}
        </div>
        <a
          className={s.wa}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => setOpened(true)}
          data-testid="help-chat-whatsapp"
        >
          <span className={s.waIcon}>
            <WhatsGlyph size={19} />
          </span>
          <span className={s.waText}>Enviar no WhatsApp</span>
          <span className={s.waArrow}>
            <LineIcon size={15} d="M7.5 16.5 16.5 7.5M9 7.5h7.5V15" />
          </span>
        </a>
        {opened ? <p className={s.hint}>O WhatsApp abriu numa nova aba. Não abriu? Toque de novo.</p> : null}
      </div>
    </div>
  );
}

// ─── o chat ─────────────────────────────────────────────────────────────────

export function HelpChat() {
  const pathname = usePathname();
  const pathRef = useRef(pathname);
  pathRef.current = pathname;

  const [ready, setReady] = useState(false);
  const [everOpened, setEverOpened] = useState(false);
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [chips, setChips] = useState<Chips>(null);
  const [typing, setTyping] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stage, setStageState] = useState<Stage>('topic');
  const [draft, setDraft] = useState('');

  const stageRef = useRef<Stage>('topic');
  const busyRef = useRef(false);
  const convo = useRef<{ topic: HelpTopicId | null; description: string; email: string | null; path: string | null }>({
    topic: null,
    description: '',
    email: null,
    path: null,
  });
  const run = useRef(0);
  const nextId = useRef(1);
  const greeted = useRef(false);
  const lastCta = useRef<number | null>(null);
  const fabRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const uid = useId();
  const panelId = `help-chat-${uid.replace(/:/g, '')}`;
  const titleId = `${panelId}-title`;

  useEffect(() => {
    // entra depois da primeira pintura (sem piscar no SSR)
    const t = setTimeout(() => setReady(true), 400);
    return () => clearTimeout(t);
  }, []);

  const setStage = (v: Stage) => {
    stageRef.current = v;
    setStageState(v);
  };
  const setBusyBoth = (v: boolean) => {
    busyRef.current = v;
    setBusy(v);
  };
  const push = (m: NewMsg) => {
    const id = nextId.current++;
    setMsgs((prev) => [...prev, { ...m, id } as Msg]);
    return id;
  };

  /** Fala do chat com "digitando..." antes de cada balão. false = conversa foi reiniciada no meio. */
  const botSay = async (lines: string[], myRun: number) => {
    for (const text of lines) {
      setTyping(true);
      await sleep(typingMs(text));
      if (myRun !== run.current) return false;
      setTyping(false);
      push({ kind: 'bot', text });
      await sleep(90);
    }
    return myRun === run.current;
  };

  const focusInput = () => {
    // no celular focar abre o teclado por cima das sugestões: só com mouse
    if (typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches) {
      inputRef.current?.focus({ preventScroll: true });
    }
  };

  const greet = async () => {
    const myRun = ++run.current;
    greeted.current = true;
    setBusyBoth(true);
    setTyping(true);
    const [ident] = await Promise.all([
      Promise.race([loadIdentity(900), sleep(1600).then(() => null)]),
      sleep(520),
    ]);
    if (myRun !== run.current) return;
    setTyping(false);
    push({
      kind: 'bot',
      text: ident?.firstName ? `Oi, ${ident.firstName}! Aqui é o suporte do Auto Edit.` : 'Oi! Aqui é o suporte do Auto Edit.',
    });
    await sleep(90);
    if (!(await botSay(['Como posso te ajudar? Escolha um assunto abaixo ou escreva com suas palavras.'], myRun))) return;
    setStage('topic');
    setChips({ kind: 'topics' });
    setBusyBoth(false);
  };

  const finish = async (myRun: number, update = false) => {
    const ident = await loadIdentity();
    if (myRun !== run.current) return;
    const c = convo.current;
    const message = buildSupportMessage({
      name: ident.name,
      email: ident.email || c.email,
      topic: c.topic,
      description: c.description,
      pathname: c.path ?? pathRef.current,
      host: window.location.host,
    });
    const lines = update
      ? ['Acrescentei isso na mensagem. Ela ficou assim:']
      : ['Prontinho! Deixei sua mensagem pronta pro nosso suporte.', 'Toque no botão abaixo: o WhatsApp abre com ela já escrita, é só enviar.'];
    if (!(await botSay(lines, myRun))) return;
    const id = nextId.current++;
    const prevCta = update ? lastCta.current : null;
    lastCta.current = id;
    setMsgs((prev) => [...prev.filter((m) => m.id !== prevCta), { kind: 'cta', message, id }]);
    setStage('done');
    setChips({ kind: 'done' });
    setBusyBoth(false);
  };

  const afterDescription = async (myRun: number) => {
    const ident = await loadIdentity();
    if (myRun !== run.current) return;
    if (!ident.logged && !convo.current.email) {
      if (!(await botSay(['Pro suporte achar sua conta mais rápido: qual e-mail você usa no Auto Edit?'], myRun))) return;
      setStage('email');
      setChips({ kind: 'email' });
      setBusyBoth(false);
      focusInput();
      return;
    }
    await finish(myRun);
  };

  const pickTopic = async (t: HelpTopic) => {
    if (busyRef.current) return;
    const myRun = run.current;
    setBusyBoth(true);
    setChips(null);
    push({ kind: 'user', text: t.label });
    setTyping(true);
    convo.current.topic = t.id;
    convo.current.path = pathRef.current;
    if (!(await botSay([followUpFor(t.id, toolFromPath(pathRef.current))], myRun))) return;
    setStage('describe');
    setChips({ kind: 'quick', items: t.rapidas });
    setBusyBoth(false);
    focusInput();
  };

  const send = async (raw: string) => {
    const text = cleanText(raw);
    if (!text || busyRef.current) return;
    const myRun = run.current;
    setDraft('');
    setBusyBoth(true);
    setChips(null);
    push({ kind: 'user', text });
    setTyping(true);
    const c = convo.current;
    switch (stageRef.current) {
      case 'topic':
        c.topic = detectTopic(text);
        c.description = text;
        c.path = pathRef.current;
        return afterDescription(myRun);
      case 'describe':
        c.description = text;
        return afterDescription(myRun);
      case 'email':
        if (looksLikeEmail(text)) {
          c.email = text.trim();
          return finish(myRun);
        }
        if (await botSay(['Esse e-mail parece incompleto. Confere pra mim? Se preferir, toque em Pular.'], myRun)) {
          setChips({ kind: 'email' });
          setBusyBoth(false);
        }
        return;
      case 'done':
        c.description = cleanText(`${c.description}\n${text}`);
        return finish(myRun, true);
    }
  };

  const skipEmail = async () => {
    if (busyRef.current) return;
    const myRun = run.current;
    setBusyBoth(true);
    setChips(null);
    push({ kind: 'user', text: 'Pular' });
    setTyping(true);
    await finish(myRun);
  };

  const otherSubject = async () => {
    if (busyRef.current) return;
    const myRun = run.current;
    setBusyBoth(true);
    setChips(null);
    push({ kind: 'user', text: 'Falar de outro assunto' });
    setTyping(true);
    convo.current = { topic: null, description: '', email: convo.current.email, path: null };
    lastCta.current = null;
    if (!(await botSay(['Claro! Sobre o que é dessa vez?'], myRun))) return;
    setStage('topic');
    setChips({ kind: 'topics' });
    setBusyBoth(false);
  };

  const restart = () => {
    run.current++;
    setMsgs([]);
    setChips(null);
    setTyping(false);
    setDraft('');
    setStage('topic');
    convo.current = { topic: null, description: '', email: convo.current.email, path: null };
    lastCta.current = null;
    void greet();
  };

  const openChat = () => {
    setOpen(true);
    if (!everOpened) {
      setEverOpened(true);
      // monta fechado e abre no quadro seguinte, pra transição rodar já na 1ª vez
      requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
    } else {
      setShown(true);
    }
    if (!greeted.current) void greet();
    setTimeout(focusInput, 320);
  };

  const closeChat = (refocus = true) => {
    setOpen(false);
    setShown(false);
    if (refocus) fabRef.current?.focus({ preventScroll: true });
  };

  // Esc fecha (só quando o foco está no chat, pra não brigar com outros modais)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const a = document.activeElement;
      if (panelRef.current?.contains(a) || a === fabRef.current) closeChat();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // sempre mostra a última fala
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el || !shown) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollTo({ top: el.scrollHeight, behavior: reduce ? 'auto' : 'smooth' });
  }, [msgs, typing, chips, shown]);

  // campo cresce até 5 linhas
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [draft]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(draft);
    }
  };

  const canSend = !busy && cleanText(draft).length > 0;
  const started = msgs.some((m) => m.kind === 'user');

  return (
    <>
      {everOpened ? (
        <div
          ref={panelRef}
          id={panelId}
          className={s.panel}
          data-state={shown ? 'open' : 'closed'}
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
          aria-hidden={!shown}
          data-testid="help-chat-panel"
        >
          <div className={s.inner}>
            <header className={s.header}>
              <span className={s.avatar}>
                <DarkoLogo size={28} />
              </span>
              <div className={s.headText}>
                <h2 id={titleId} className={s.title}>
                  Suporte Auto Edit
                </h2>
                <p className={s.subtitle} style={{ margin: 0 }}>
                  <WhatsGlyph size={13} />
                  <span>Atendimento pelo WhatsApp</span>
                </p>
              </div>
              <button
                type="button"
                className={s.iconBtn}
                onClick={restart}
                disabled={!started}
                aria-label="Recomeçar conversa"
                title="Recomeçar conversa"
              >
                <LineIcon size={17} d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v4h4" />
              </button>
              <button type="button" className={s.iconBtn} onClick={() => closeChat()} aria-label="Fechar chat" title="Fechar">
                <CloseGlyph size={18} stroke={1.8} />
              </button>
            </header>

            <div ref={listRef} className={s.list} aria-live="polite" aria-relevant="additions" data-testid="help-chat-list">
              {msgs.map((m, i) => {
                const prev = msgs[i - 1];
                const side = m.kind === 'user' ? 'user' : 'bot';
                const prevSide = prev ? (prev.kind === 'user' ? 'user' : 'bot') : side;
                const rowCls = `${s.row} ${side === 'user' ? s.rowUser : s.rowBot} ${prev && prevSide !== side ? s.gap : ''}`;
                if (m.kind === 'cta') {
                  return (
                    <div key={m.id} className={rowCls}>
                      <CtaCard message={m.message} />
                    </div>
                  );
                }
                return (
                  <div key={m.id} className={rowCls}>
                    <div className={`${s.bubble} ${m.kind === 'user' ? s.user : s.bot}`} data-from={m.kind}>
                      {m.text}
                    </div>
                  </div>
                );
              })}

              {typing ? (
                <div className={`${s.row} ${s.rowBot} ${msgs.length && msgs[msgs.length - 1].kind === 'user' ? s.gap : ''}`}>
                  <div className={`${s.bubble} ${s.bot} ${s.typing}`} aria-label="Digitando">
                    <i />
                    <i />
                    <i />
                  </div>
                </div>
              ) : null}

              {chips?.kind === 'topics' ? (
                <div className={s.topics} data-testid="help-chat-topics">
                  {HELP_TOPICS.map((t, i) => (
                    <button
                      key={t.id}
                      type="button"
                      className={s.topic}
                      style={{ animationDelay: `${i * 60}ms` }}
                      onClick={() => void pickTopic(t)}
                    >
                      <span className={s.topicIcon}>
                        <TopicIcon id={t.id} />
                      </span>
                      <span className={s.topicLabel}>{t.label}</span>
                      <span className={s.chev}>
                        <LineIcon size={16} d="m9.5 6.5 5.5 5.5-5.5 5.5" />
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}

              {chips?.kind === 'quick' ? (
                <div className={s.quick}>
                  {chips.items.map((q, i) => (
                    <button key={q} type="button" className={s.chip} style={{ animationDelay: `${i * 50}ms` }} onClick={() => void send(q)}>
                      {q}
                    </button>
                  ))}
                </div>
              ) : null}

              {chips?.kind === 'email' ? (
                <div className={s.quick}>
                  <button type="button" className={s.chip} onClick={() => void skipEmail()}>
                    Pular
                  </button>
                </div>
              ) : null}

              {chips?.kind === 'done' ? (
                <div className={s.quick}>
                  <button type="button" className={s.chip} onClick={() => void otherSubject()}>
                    Falar de outro assunto
                  </button>
                </div>
              ) : null}
            </div>

            <form
              className={s.composer}
              onSubmit={(e) => {
                e.preventDefault();
                void send(draft);
              }}
            >
              <div className={s.field}>
                <textarea
                  ref={inputRef}
                  className={s.textarea}
                  rows={1}
                  value={draft}
                  maxLength={MAX_DESCRICAO}
                  placeholder={PLACEHOLDER[stage]}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={onKeyDown}
                  inputMode={stage === 'email' ? 'email' : 'text'}
                  autoComplete={stage === 'email' ? 'email' : 'off'}
                  aria-label="Mensagem"
                  data-testid="help-chat-input"
                />
                <button type="submit" className={s.send} disabled={!canSend} aria-label="Enviar">
                  <LineIcon size={17} d="M12 18.5v-13M6.5 11 12 5.5l5.5 5.5" />
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      <div className={s.fabWrap} data-ready={ready ? 'true' : 'false'} data-open={open ? 'true' : 'false'}>
        <span className={s.tip} aria-hidden="true">
          Precisa de ajuda?
        </span>
        <button
          ref={fabRef}
          type="button"
          className={s.fab}
          onClick={() => (open ? closeChat(false) : openChat())}
          onPointerEnter={() => void loadIdentity()}
          onFocus={() => void loadIdentity()}
          aria-label={open ? 'Fechar chat de ajuda' : 'Abrir chat de ajuda'}
          aria-expanded={open}
          aria-controls={everOpened ? panelId : undefined}
          data-testid="help-chat-fab"
        >
          <span aria-hidden className={`${s.pulse} ae-ambient`} />
          <span aria-hidden className={s.rim} />
          <span className={s.core}>
            <span className={`${s.icon} ${s.iconChat}`}>
              <ChatGlyph />
            </span>
            <span className={`${s.icon} ${s.iconClose}`} style={{ color: '#fff' }}>
              <CloseGlyph />
            </span>
          </span>
        </button>
      </div>
    </>
  );
}
