'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { DarkoLogo } from './DarkoLogo';
import { GUIDE_PATHS } from './tool-guides/routes';
import { tierAllowsTool, useTier, type Tier } from '@/lib/use-tier';
import {
  AULA_STUCK,
  HELP_CHAT_EVENT,
  HELP_TOPICS,
  HOME_ARTICLES,
  MAX_DESCRICAO,
  articleById,
  articleView,
  aulaDoChat,
  aulaLabel,
  aulaPedida,
  aulaStatus,
  aulaSubject,
  aulasDisponiveis,
  buildSupportMessage,
  cleanText,
  detectTopic,
  findArticle,
  followUpFor,
  isGiveUp,
  isGreeting,
  isNo,
  isThanks,
  isYes,
  looksLikeEmail,
  toolFromPath,
  topicById,
  whatsappUrl,
  wordCount,
  type ArticleView,
  type AulaDoChat,
  type HelpArticle,
  type HelpArticleId,
  type HelpTopic,
  type HelpTopicId,
} from '@/lib/help-chat';
import s from './HelpChat.module.css';

/**
 * CHAT DE AJUDA (07.10) — substitui o botão verde do WhatsApp.
 *
 * Botão roxo no canto → mini chat com sugestões ("Problemas com a conta",
 * "Erro em alguma ferramenta"...). O que é simples o próprio chat ensina
 * (10.10): cancelar a assinatura, excluir a conta, recuperar a senha... com o
 * passo a passo da tela real e um botão que leva pra ela. Depois de toda
 * resposta ele PERGUNTA se a pessoa ainda precisa do suporte; se precisar (ou
 * se for algo que só gente resolve), devolve um botão que abre o WhatsApp do
 * suporte com a mensagem JÁ ESCRITA: quem é (nome + e-mail da conta), o
 * assunto e o que houve.
 *
 * Outras telas abrem o chat com `openHelpChat('<resposta>')` (lib/help-chat).
 *
 * Aulas em vídeo (11.10): cartão da aula com a capa e "Assistir no YouTube"
 * (lista em "Aulas em vídeo", a da ferramenta aberta primeiro). A trava é a
 * mesma do "Como usar": o plano vem do useTier, montado SÓ quando o chat abre
 * (nenhuma consulta a mais no carregamento das páginas).
 *
 * Montado no layout raiz (todas as páginas). O pulso do botão é enfeite →
 * `ae-ambient` (pausa no modo descanso, ver AmbientCalm).
 */

type NewMsg =
  | { kind: 'bot'; text: string }
  | { kind: 'user'; text: string }
  | { kind: 'cta'; message: string }
  | { kind: 'answer'; title: string; view: ArticleView }
  | { kind: 'aula'; aula: AulaDoChat };
type Msg = NewMsg & { id: number };

type Chips =
  | { kind: 'topics' }
  | { kind: 'items'; topic: HelpTopicId }
  | { kind: 'quick'; items: string[]; skip?: boolean }
  | { kind: 'email' }
  /** "Isso resolveu?": depois de uma resposta (article) ou de uma aula (aula = rota) */
  | { kind: 'resolve'; article?: HelpArticleId; aula?: AulaDoChat; maisAulas?: boolean }
  | { kind: 'request'; article: HelpArticleId }
  | { kind: 'aulas'; items: AulaDoChat[] }
  | { kind: 'after' }
  | { kind: 'done' }
  | null;

/** answer = acabou de ler uma resposta do chat e ainda não disse se resolveu */
type Stage = 'topic' | 'describe' | 'answer' | 'email' | 'done';

type Convo = {
  topic: HelpTopicId | null;
  /** resposta do chat que a pessoa leu: vira o Assunto se ela ainda precisar do suporte */
  article: HelpArticleId | null;
  /** assunto pronto quando não veio de uma resposta (depois de uma aula) */
  subject: string | null;
  /** aula que a pessoa acabou de ver no chat */
  aula: AulaDoChat | null;
  description: string;
  email: string | null;
  path: string | null;
  /** já pediu "me conta um pouco mais" uma vez */
  vague: boolean;
};

type Identity = { logged: boolean; name: string | null; firstName: string | null; email: string | null };

const ANON: Identity = { logged: false, name: null, firstName: null, email: null };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// curtas de propósito: no celular (fonte 16px) a dica mais longa quebrava em
// 2 linhas e o campo nascia com barra de rolagem
const PLACEHOLDER: Record<Stage, string> = {
  topic: 'Escreva sua dúvida...',
  describe: 'Conte o que aconteceu...',
  answer: 'Ficou alguma dúvida?',
  email: 'seu@email.com',
  done: 'Algum detalhe a mais?',
};

const RESOLVED = 'Resolveu, obrigado!';
const TO_SUPPORT = 'Falar com o suporte';
const SKIP_DETAILS = 'Prefiro explicar no WhatsApp';
const VER_AULAS = 'Ver as aulas em vídeo';

const freshConvo = (email: string | null = null): Convo => ({
  topic: null,
  article: null,
  subject: null,
  aula: null,
  description: '',
  email,
  path: null,
  vague: false,
});

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

/** bolinha de play dos chips de aula */
function PlayDot() {
  return (
    <span className={s.playDot} aria-hidden="true">
      <svg width="8" height="8" viewBox="0 0 24 24">
        <path d="M8 5.5v13l10.5-6.5L8 5.5Z" fill="#fff" />
      </svg>
    </span>
  );
}

/** linha da lista: resposta que o chat dá (lâmpada), pedido que vai pro suporte (balão) ou aula (play) */
function RowIcon({ kind }: { kind: 'answer' | 'support' | 'aula' }) {
  if (kind === 'aula') {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M8 5.5v13l10.5-6.5L8 5.5Z" fill="currentColor" />
      </svg>
    );
  }
  return kind === 'answer' ? (
    <LineIcon size={16}>
      <path d="M9.4 17.6h5.2M10.2 20.4h3.6" />
      <path d="M12 3.6a5.9 5.9 0 0 0-3.5 10.6c.6.5.9 1.1.9 1.8v.4h5.2V16c0-.7.3-1.3.9-1.8A5.9 5.9 0 0 0 12 3.6Z" />
    </LineIcon>
  ) : (
    <LineIcon size={16}>
      <path d="M20 11.6c0 3.7-3.6 6.6-8 6.6-.9 0-1.8-.1-2.6-.4L5.2 19.6l1.1-3.2C5 15.2 4 13.5 4 11.6 4 7.9 7.6 5 12 5s8 2.9 8 6.6Z" />
    </LineIcon>
  );
}

/** Texto do passo com o nome do botão "entre aspas" em destaque. */
function rich(text: string): ReactNode {
  const parts = text.split(/"([^"]+)"/);
  return parts.map((p, i) => (i % 2 ? <strong key={i}>{p}</strong> : p));
}

/** Ícone do YouTube (retângulo arredondado + play), pintado pela cor do texto. */
function YoutubeGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="1.6" y="4.6" width="20.8" height="14.8" rx="4.4" fill="currentColor" />
      <path d="M10 8.9v6.2l5.4-3.1L10 8.9Z" fill="var(--yt-play, #e8102b)" />
    </svg>
  );
}

// ─── aula em vídeo (YouTube) ────────────────────────────────────────────────

/** Rótulo do link pra abrir a página da aula ("Abrir a ferramenta" / "Abrir Chaves de IA"). */
const abrirLabel = (a: AulaDoChat) => (a.path.startsWith('/tools/') ? 'Abrir a ferramenta' : `Abrir ${a.label}`);

/**
 * Cartão da aula: a capa (cartela da própria aula) e o botão vermelho
 * "Assistir no YouTube", que abre o vídeo numa aba nova (no celular, no app
 * do YouTube). O vídeo é não listado: só chega nele quem tem o link.
 */
function AulaCard({ aula, atual, onLink }: { aula: AulaDoChat; atual: string | null; onLink: () => void }) {
  return (
    <div className={s.aula} data-testid="help-chat-aula">
      <a
        className={s.aulaCover}
        href={aula.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Assistir no YouTube: ${aula.titulo} (${aula.duracao})`}
        tabIndex={-1}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={aula.capa} alt="" loading="lazy" decoding="async" />
        <span className={s.aulaPill} aria-hidden="true">
          <span className={s.aulaPillPlay}>
            <svg width="11" height="11" viewBox="0 0 24 24">
              <path d="M8 5.5v13l10.5-6.5L8 5.5Z" fill="#fff" />
            </svg>
          </span>
          <span className={s.aulaPillTime}>{aula.duracao}</span>
        </span>
      </a>
      <div className={s.aulaBody}>
        <p className={s.aulaMeta}>Aula em vídeo · {aula.duracao}</p>
        <p className={s.aulaTitle}>{aula.titulo}</p>
        <a className={s.yt} href={aula.url} target="_blank" rel="noopener noreferrer" data-testid="help-chat-aula-youtube">
          <span className={s.ytIcon}>
            <YoutubeGlyph size={20} />
          </span>
          <span className={s.ytText}>Assistir no YouTube</span>
          <span className={s.ytArrow}>
            <LineIcon size={15} d="M7.5 16.5 16.5 7.5M9 7.5h7.5V15" />
          </span>
        </a>
        {atual !== aula.path ? (
          <Link href={aula.path} className={s.aulaTool} onClick={onLink}>
            {abrirLabel(aula)}
            <LineIcon size={13} d="m9.5 6.5 5.5 5.5-5.5 5.5" />
          </Link>
        ) : null}
      </div>
    </div>
  );
}

/** A aula dentro de uma resposta do chat (ex.: Chaves de IA): uma linha com capa + YouTube. */
function AulaInline({ aula }: { aula: AulaDoChat }) {
  return (
    <a className={s.aulaInline} href={aula.url} target="_blank" rel="noopener noreferrer" data-testid="help-chat-aula-inline">
      <span className={s.aulaThumb}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={aula.capa} alt="" loading="lazy" decoding="async" />
        <span className={s.aulaThumbPlay} aria-hidden="true">
          <svg width="9" height="9" viewBox="0 0 24 24">
            <path d="M8 5.5v13l10.5-6.5L8 5.5Z" fill="#fff" />
          </svg>
        </span>
      </span>
      <span className={s.aulaInlineText}>
        <span className={s.aulaInlineTitle}>Assistir à aula no YouTube</span>
        <span className={s.aulaInlineMeta}>
          {aula.titulo} · {aula.duracao}
        </span>
      </span>
      <span className={s.aulaInlineYt}>
        <YoutubeGlyph size={22} />
      </span>
    </a>
  );
}

/** Lê o plano da conta (useTier) e avisa o chat. Só monta com o chat aberto. */
function TierProbe({ onTier }: { onTier: (t: Tier | null) => void }) {
  const tier = useTier();
  useEffect(() => {
    onTier(tier);
  }, [tier, onTier]);
  return null;
}

// ─── cartão de resposta (o passo a passo que o chat ensina) ──────────────────

function AnswerCard({ title, view, onLink }: { title: string; view: ArticleView; onLink: () => void }) {
  return (
    <div className={s.answer} data-testid="help-chat-answer">
      <p className={s.answerTitle}>{title}</p>
      {view.intro ? <p className={s.answerIntro}>{rich(view.intro)}</p> : null}
      <ol className={s.steps}>
        {view.steps.map((step, i) => (
          <li key={i} className={s.step}>
            <span className={s.stepNum} aria-hidden="true">
              {i + 1}
            </span>
            <span className={s.stepText}>{rich(step)}</span>
          </li>
        ))}
      </ol>
      {view.note ? <p className={s.answerNote}>{rich(view.note)}</p> : null}
      {view.aula ? <AulaInline aula={view.aula} /> : null}
      {view.link ? (
        <Link href={view.link.href} className={s.answerLink} onClick={onLink} data-testid="help-chat-answer-link">
          <span>{view.link.label}</span>
          <LineIcon size={15} d="M7.5 16.5 16.5 7.5M9 7.5h7.5V15" />
        </Link>
      ) : null}
    </div>
  );
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
  const convo = useRef<Convo>(freshConvo());
  const run = useRef(0);
  const nextId = useRef(1);
  const greeted = useRef(false);
  const lastCta = useRef<number | null>(null);
  const fabRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  /** pedido de outra tela (openHelpChat): sempre a versão mais nova das funções abaixo */
  const externalOpen = useRef<(article: HelpArticleId | null) => void>(() => {});
  // plano da conta (trava das aulas): vem do TierProbe, que só monta com o chat aberto
  const [tier, setTier] = useState<Tier | null>(null);
  const tierRef = useRef<Tier | null>(null);
  const onTier = useCallback((t: Tier | null) => {
    tierRef.current = t;
    setTier(t);
  }, []);
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

  /** Volta pra escolha de assunto, sem mais nada pendente na conversa. */
  const idleTopics = (kind: 'topics' | 'after' = 'topics') => {
    convo.current = freshConvo(convo.current.email);
    setStage('topic');
    setChips({ kind });
    setBusyBoth(false);
  };

  // ─── trava das aulas ───────────────────────────────────────────────────────
  /** Aula visível pra este plano: rota fora de /tools (Chaves de IA) é de todo mundo. */
  const podeCom = (t: Tier | null) => (path: string) => !path.startsWith('/tools/') || tierAllowsTool(t ?? 'free', path);

  /**
   * Plano pra decidir quais aulas mostrar AGORA: deslogado = free; logado
   * espera o useTier (até 3 s) e, sem resposta, fica no free (esconde a aula
   * paga em vez de mostrar pra quem não pode).
   */
  const planoAgora = async (): Promise<Tier> => {
    const ident = await Promise.race([loadIdentity(900), sleep(1600).then(() => null)]);
    if (!ident?.logged) return 'free';
    for (let i = 0; i < 30 && tierRef.current == null; i++) await sleep(100);
    return tierRef.current ?? 'free';
  };

  /**
   * Mostra o passo a passo de uma resposta e, logo depois, PERGUNTA se a
   * pessoa ainda precisa do suporte (ou, num pedido que só a equipe conclui,
   * se quer que o chat deixe o pedido pronto). Chamada com o chat ocupado.
   */
  const showArticle = async (a: HelpArticle, myRun: number, lead?: string) => {
    setTyping(true);
    const [ident, plano] = await Promise.all([
      Promise.race([loadIdentity(900), sleep(1600).then(() => null)]),
      a.aula ? planoAgora() : Promise.resolve(null),
      lead ? Promise.resolve() : sleep(380),
    ]);
    if (myRun !== run.current) return;
    if (lead && !(await botSay([lead], myRun))) return;
    setTyping(true);
    await sleep(520);
    if (myRun !== run.current) return;
    setTyping(false);
    convo.current = {
      ...freshConvo(convo.current.email),
      topic: a.topic,
      article: a.id,
      path: pathRef.current,
    };
    const aula = a.aula && plano ? aulaDoChat(a.aula === 'atual' ? pathRef.current : a.aula, podeCom(plano)) : null;
    push({
      kind: 'answer',
      title: a.title,
      view: articleView(a, { logged: !!ident?.logged, hasGuide: GUIDE_PATHS.has(pathRef.current || ''), aula }),
    });
    await sleep(260);
    const ask = a.request
      ? 'Quer que eu deixe o pedido pronto pro suporte no WhatsApp?'
      : 'Isso resolveu? Se ainda precisar, te levo pro nosso suporte no WhatsApp.';
    if (!(await botSay([ask], myRun))) return;
    setStage('answer');
    setChips(
      a.request
        ? { kind: 'request', article: a.id }
        : // "Como usar" fora de uma ferramenta com aula: oferece a lista de aulas
          { kind: 'resolve', article: a.id, maisAulas: a.aula === 'atual' && !aula },
    );
    setBusyBoth(false);
  };

  /** Cartão da aula + o convite pro suporte, caso a dúvida continue depois do vídeo. */
  const showAula = async (aula: AulaDoChat, myRun: number, lead?: string) => {
    setTyping(true);
    if (lead) {
      if (!(await botSay([lead], myRun))) return;
      setTyping(true);
    }
    await sleep(lead ? 420 : 700);
    if (myRun !== run.current) return;
    setTyping(false);
    convo.current = {
      ...freshConvo(convo.current.email),
      topic: 'duvida',
      subject: aulaSubject(aula),
      aula,
      path: pathRef.current,
    };
    push({ kind: 'aula', aula });
    await sleep(260);
    if (!(await botSay(['Depois de assistir, se ainda ficar alguma dúvida, te levo pro nosso suporte no WhatsApp.'], myRun))) return;
    setStage('answer');
    setChips({ kind: 'resolve', aula, maisAulas: true });
    setBusyBoth(false);
  };

  /** Lista das aulas que esta pessoa pode ver (a da ferramenta aberta primeiro). */
  const showAulas = async (myRun: number, lead?: string) => {
    setTyping(true);
    const plano = await planoAgora();
    if (myRun !== run.current) return;
    const items = aulasDisponiveis(podeCom(plano), pathRef.current);
    if (!items.length) {
      if (await botSay(['Ainda não tem aula em vídeo liberada pro seu plano. Posso te ajudar com outra coisa?'], myRun)) idleTopics('topics');
      return;
    }
    if (!(await botSay([lead ?? 'Essas são as aulas em vídeo. Toque numa pra assistir no YouTube:'], myRun))) return;
    convo.current = { ...freshConvo(convo.current.email), topic: 'duvida', path: pathRef.current };
    setStage('topic');
    setChips({ kind: 'aulas', items });
    setBusyBoth(false);
  };

  /**
   * Aula de uma rota pedida (texto livre ou linha da lista). Se ela não pode
   * ver (ferramenta de outro plano) ou a aula ainda não saiu, diz isso e mostra
   * as que ela pode assistir; Chaves de IA sem vídeo cai na resposta escrita.
   */
  const askAula = async (path: string, myRun: number) => {
    setTyping(true);
    const plano = await planoAgora();
    if (myRun !== run.current) return;
    const pode = podeCom(plano);
    const aula = aulaDoChat(path, pode);
    if (aula) return showAula(aula, myRun);
    if (path === '/configuracoes/api') return showArticle(articleById('chave-ia')!, myRun, 'Essa eu te explico por aqui:');
    const status = aulaStatus(path, pode);
    const nome = aulaLabel(path);
    const motivo =
      status === 'bloqueada'
        ? `A aula de ${nome} fica liberada junto com a ferramenta, no plano Premium.`
        : status === 'sem-video'
          ? `A aula de ${nome} ainda não está no ar.`
          : null;
    return showAulas(myRun, motivo ? `${motivo} Essas você já pode assistir:` : undefined);
  };

  const handlePedida = (pedida: { uma: string } | 'lista', myRun: number) =>
    pedida === 'lista' ? showAulas(myRun) : askAula(pedida.uma, myRun);

  const greet = async (article: HelpArticle | null = null) => {
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
    if (article) {
      // veio de um botão de outra tela: a pergunta já é conhecida
      push({ kind: 'user', text: article.title });
      return showArticle(article, myRun);
    }
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
      article: c.article,
      subject: c.subject,
      description: c.description,
      pathname: c.path ?? pathRef.current,
    });
    const pedido = !!articleById(c.article)?.request;
    const lines = update
      ? ['Acrescentei isso na mensagem. Ela ficou assim:']
      : pedido
        ? ['Prontinho! Deixei o seu pedido pronto pro nosso suporte.', 'Toque no botão abaixo: o WhatsApp abre com ele já escrito, é só enviar.']
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

  /** Começa uma ação do usuário: trava o chat e mostra o balão dele. */
  const begin = (userText: string | null) => {
    if (busyRef.current) return null;
    const myRun = run.current;
    setBusyBoth(true);
    setChips(null);
    if (userText) push({ kind: 'user', text: userText });
    setTyping(true);
    return myRun;
  };

  const pickTopic = async (t: HelpTopic) => {
    const myRun = begin(t.label);
    if (myRun === null) return;
    convo.current = { ...freshConvo(convo.current.email), topic: t.id, path: pathRef.current };
    if (!(await botSay([followUpFor(t.id, toolFromPath(pathRef.current))], myRun))) return;
    setStage('describe');
    setChips({ kind: 'items', topic: t.id });
    setBusyBoth(false);
    focusInput();
  };

  const pickArticle = async (a: HelpArticle) => {
    const myRun = begin(a.title);
    if (myRun === null) return;
    await showArticle(a, myRun);
  };

  /** "Resolveu, obrigado!" (ou um "valeu" digitado depois da resposta) */
  const resolved = async (myRun: number) => {
    if (!(await botSay(['Que bom que deu certo! Se precisar de mais alguma coisa, é só chamar.'], myRun))) return;
    idleTopics('after');
  };

  /** Não resolveu: pede o relato (com sugestões) pra montar a mensagem do suporte. */
  const toSupport = async (a: HelpArticle, myRun: number) => {
    convo.current = { ...freshConvo(convo.current.email), topic: a.topic, article: a.id, path: pathRef.current };
    if (!(await botSay(['Combinado! Me conta em poucas palavras o que está acontecendo, que eu deixo a mensagem pronta pro suporte.'], myRun))) return;
    setStage('describe');
    setChips({ kind: 'quick', items: a.stuck, skip: true });
    setBusyBoth(false);
    focusInput();
  };

  /** Viu a aula e ainda precisa do suporte: assunto "Dúvida sobre <ferramenta>". */
  const toSupportAula = async (aula: AulaDoChat, myRun: number) => {
    convo.current = {
      ...freshConvo(convo.current.email),
      topic: 'duvida',
      subject: aulaSubject(aula),
      aula,
      path: pathRef.current,
    };
    if (!(await botSay(['Combinado! Me conta em poucas palavras qual é a dúvida, que eu deixo a mensagem pronta pro suporte.'], myRun))) return;
    setStage('describe');
    setChips({ kind: 'quick', items: AULA_STUCK, skip: true });
    setBusyBoth(false);
    focusInput();
  };

  const pickAula = async (aula: AulaDoChat, label = aula.label) => {
    const myRun = begin(label);
    if (myRun === null) return;
    await showAula(aula, myRun);
  };

  /** Linha "Ver as aulas em vídeo" / chip "Aulas em vídeo". */
  const pickAulas = async (label: string) => {
    const myRun = begin(label);
    if (myRun === null) return;
    await showAulas(myRun);
  };

  /** Pedido que só a equipe conclui (excluir a conta): vai direto pra mensagem pronta. */
  const sendRequest = async (a: HelpArticle, myRun: number, extra = '') => {
    convo.current = {
      ...freshConvo(convo.current.email),
      topic: a.topic,
      article: a.id,
      path: pathRef.current,
      description: cleanText([a.request?.text ?? '', extra].filter(Boolean).join('\n')),
    };
    await afterDescription(myRun);
  };

  const changedMind = async (myRun: number) => {
    if (!(await botSay(['Tudo certo, sua conta continua ativa. Posso te ajudar em mais alguma coisa?'], myRun))) return;
    idleTopics('topics');
  };

  const send = async (raw: string) => {
    const text = cleanText(raw);
    if (!text) return;
    const myRun = begin(text);
    if (myRun === null) return;
    setDraft('');
    const c = convo.current;
    switch (stageRef.current) {
      case 'topic': {
        if (isGreeting(text)) {
          if (await botSay(['Oi! Me conta o que você precisa ou escolha um assunto abaixo.'], myRun)) idleTopics('topics');
          return;
        }
        if (isThanks(text)) {
          if (await botSay(['Por nada! Se precisar, é só chamar.'], myRun)) idleTopics('after');
          return;
        }
        // "tem aula?", "vídeo de como usa o downloader": a aula vem antes do texto
        const pedida = aulaPedida(text, pathRef.current);
        if (pedida) return handlePedida(pedida, myRun);
        const a = findArticle(text);
        if (a) return showArticle(a, myRun, 'Essa eu te explico por aqui:');
        c.topic = detectTopic(text);
        if (!c.topic && !c.vague && wordCount(text) <= 3) {
          // "ajuda", "preciso de ajuda": sem assunto não dá pra montar nada útil
          c.vague = true;
          if (await botSay(['Me conta um pouco mais pra eu te ajudar: o que está acontecendo?'], myRun)) {
            setChips({ kind: 'topics' });
            setBusyBoth(false);
            focusInput();
          }
          return;
        }
        c.description = text;
        c.path = pathRef.current;
        return afterDescription(myRun);
      }
      case 'describe': {
        // depois de escolher um assunto, a pergunta pode ter resposta pronta (ou
        // aula); depois do "Falar com o suporte" (resposta ou aula já vista),
        // o texto é o relato
        const livre = !c.article && !c.subject;
        const pedida = livre ? aulaPedida(text, pathRef.current) : null;
        if (pedida) return handlePedida(pedida, myRun);
        const a = livre ? findArticle(text) : null;
        if (a) return showArticle(a, myRun, 'Essa eu te explico por aqui:');
        c.description = text;
        return afterDescription(myRun);
      }
      case 'answer': {
        const a = articleById(c.article);
        if (!a) {
          if (c.aula) {
            // depois da aula: "valeu"/"não" = tudo certo; outra pergunta = outra resposta;
            // o resto é a dúvida, que já vira o relato pro suporte
            if (isThanks(text) || isYes(text) || isGiveUp(text) || isNo(text)) return resolved(myRun);
            const pedida = aulaPedida(text, pathRef.current);
            if (pedida && (pedida === 'lista' || pedida.uma !== c.aula.path)) return handlePedida(pedida, myRun);
            const other = findArticle(text);
            if (other) return showArticle(other, myRun, 'Essa eu te explico por aqui:');
          }
          c.description = text;
          return afterDescription(myRun);
        }
        if (a.request) {
          if (isYes(text)) return sendRequest(a, myRun);
          if (isNo(text) || isGiveUp(text)) return changedMind(myRun);
          const other = findArticle(text);
          if (other && other.id !== a.id) return showArticle(other, myRun, 'Essa eu te explico por aqui:');
          return sendRequest(a, myRun, other ? '' : text);
        }
        if (isThanks(text) || isYes(text) || isGiveUp(text)) return resolved(myRun);
        if (isNo(text)) return toSupport(a, myRun);
        const pedida = aulaPedida(text, pathRef.current);
        if (pedida) return handlePedida(pedida, myRun);
        const other = findArticle(text);
        if (other && other.id !== a.id) return showArticle(other, myRun, 'Essa eu te explico por aqui:');
        // escreveu o que está acontecendo: já é o relato pro suporte
        c.description = text;
        return afterDescription(myRun);
      }
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
    const myRun = begin('Pular');
    if (myRun === null) return;
    await finish(myRun);
  };

  const skipDetails = async () => {
    const myRun = begin(SKIP_DETAILS);
    if (myRun === null) return;
    convo.current.description = '';
    await afterDescription(myRun);
  };

  const otherSubject = async (label: string) => {
    const myRun = begin(label);
    if (myRun === null) return;
    convo.current = freshConvo(convo.current.email);
    lastCta.current = null;
    if (!(await botSay(['Claro! Sobre o que é dessa vez?'], myRun))) return;
    idleTopics('topics');
  };

  const onChip = (label: string, action: (myRun: number) => Promise<void>) => {
    const myRun = begin(label);
    if (myRun === null) return;
    void action(myRun);
  };

  const restart = (article: HelpArticle | null = null) => {
    run.current++;
    setMsgs([]);
    setChips(null);
    setTyping(false);
    setDraft('');
    setStage('topic');
    convo.current = freshConvo(convo.current.email);
    lastCta.current = null;
    void greet(article);
  };

  const openChat = (article: HelpArticle | null = null) => {
    setOpen(true);
    if (!everOpened) {
      setEverOpened(true);
      // monta fechado e abre no quadro seguinte, pra transição rodar já na 1ª vez
      requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
    } else {
      setShown(true);
    }
    if (!greeted.current) void greet(article);
    else if (article) {
      // conversa no meio de uma fala do chat: recomeça já na resposta pedida
      if (busyRef.current) restart(article);
      else void pickArticle(article);
    }
    if (!article) setTimeout(focusInput, 320);
  };

  const closeChat = (refocus = true) => {
    setOpen(false);
    setShown(false);
    if (refocus) fabRef.current?.focus({ preventScroll: true });
  };

  externalOpen.current = (id) => openChat(articleById(id));

  // outras telas abrem o chat (ex.: "Solicitar exclusão da conta" nas Configurações)
  useEffect(() => {
    const onOpen = (e: Event) => {
      const id = (e as CustomEvent<{ article?: HelpArticleId | null }>).detail?.article ?? null;
      externalOpen.current(id);
    };
    window.addEventListener(HELP_CHAT_EVENT, onOpen);
    return () => window.removeEventListener(HELP_CHAT_EVENT, onOpen);
  }, []);

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
  }, [draft, stage]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(draft);
    }
  };

  /** Link do passo a passo: no celular o chat cobre a tela, então fecha pra pessoa ver a página. */
  const onAnswerLink = () => {
    if (window.matchMedia('(max-width: 640px)').matches) closeChat(false);
  };

  const canSend = !busy && cleanText(draft).length > 0;
  const started = msgs.some((m) => m.kind === 'user');
  const itemsTopic = chips?.kind === 'items' ? topicById(chips.topic) : null;
  const chipArticle = chips?.kind === 'resolve' || chips?.kind === 'request' ? articleById(chips.article) : null;
  const chipAula = chips?.kind === 'resolve' ? chips.aula ?? null : null;
  // aula da ferramenta aberta, se esta pessoa pode ver (plano ainda carregando = free)
  const aulaAtual = aulaDoChat(pathname, podeCom(tier));

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
          <TierProbe onTier={onTier} />
          <div className={s.inner}>
            <header className={s.header}>
              <span className={s.avatar}>
                <DarkoLogo size={28} />
              </span>
              <div className={s.headText}>
                <h2 id={titleId} className={s.title}>
                  Suporte Auto Edit
                </h2>
              </div>
              <button
                type="button"
                className={s.iconBtn}
                onClick={() => restart()}
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
                if (m.kind === 'answer') {
                  return (
                    <div key={m.id} className={rowCls}>
                      <AnswerCard title={m.title} view={m.view} onLink={onAnswerLink} />
                    </div>
                  );
                }
                if (m.kind === 'aula') {
                  return (
                    <div key={m.id} className={rowCls}>
                      <AulaCard aula={m.aula} atual={pathname} onLink={onAnswerLink} />
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
                <>
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
                  <div className={s.popular} data-testid="help-chat-popular">
                    <span className={s.popularLabel}>Mais procurados</span>
                    <div className={s.popularChips}>
                      {HOME_ARTICLES.map((id, i) => {
                        const a = articleById(id)!;
                        return (
                          <button
                            key={id}
                            type="button"
                            className={s.chip}
                            style={{ animationDelay: `${240 + i * 50}ms` }}
                            onClick={() => void pickArticle(a)}
                          >
                            {a.title}
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        className={`${s.chip} ${s.chipAula}`}
                        style={{ animationDelay: `${240 + HOME_ARTICLES.length * 50}ms` }}
                        onClick={() => void pickAulas('Aulas em vídeo')}
                        data-testid="help-chat-aulas-chip"
                      >
                        <PlayDot />
                        Aulas em vídeo
                      </button>
                    </div>
                  </div>
                </>
              ) : null}

              {itemsTopic ? (
                <div className={s.faq} data-testid="help-chat-faq">
                  {/* dúvida ou erro numa ferramenta: a aula dela primeiro */}
                  {(itemsTopic.id === 'duvida' || itemsTopic.id === 'ferramenta') && aulaAtual ? (
                    <button
                      type="button"
                      className={s.faqRow}
                      onClick={() => void pickAula(aulaAtual, `Ver a aula de ${aulaAtual.label}`)}
                      data-testid="help-chat-aula-atual"
                    >
                      <span className={`${s.faqIcon} ${s.faqIconAula}`}>
                        <RowIcon kind="aula" />
                      </span>
                      <span className={s.faqLabel}>Ver a aula de {aulaAtual.label}</span>
                      <span className={s.chev}>
                        <LineIcon size={15} d="m9.5 6.5 5.5 5.5-5.5 5.5" />
                      </span>
                    </button>
                  ) : null}
                  {itemsTopic.id === 'duvida' ? (
                    <button type="button" className={s.faqRow} onClick={() => void pickAulas(VER_AULAS)}>
                      <span className={`${s.faqIcon} ${s.faqIconAula}`}>
                        <RowIcon kind="aula" />
                      </span>
                      <span className={s.faqLabel}>{VER_AULAS}</span>
                      <span className={s.chev}>
                        <LineIcon size={15} d="m9.5 6.5 5.5 5.5-5.5 5.5" />
                      </span>
                    </button>
                  ) : null}
                  {itemsTopic.artigos.map((id, i) => {
                    const a = articleById(id)!;
                    return (
                      <button
                        key={id}
                        type="button"
                        className={s.faqRow}
                        style={{ animationDelay: `${i * 40}ms` }}
                        onClick={() => void pickArticle(a)}
                      >
                        <span className={s.faqIcon}>
                          <RowIcon kind="answer" />
                        </span>
                        <span className={s.faqLabel}>{a.title}</span>
                        <span className={s.chev}>
                          <LineIcon size={15} d="m9.5 6.5 5.5 5.5-5.5 5.5" />
                        </span>
                      </button>
                    );
                  })}
                  {itemsTopic.rapidas.map((q, i) => (
                    <button
                      key={q}
                      type="button"
                      className={s.faqRow}
                      style={{ animationDelay: `${(itemsTopic.artigos.length + i) * 40}ms` }}
                      onClick={() => void send(q)}
                    >
                      <span className={s.faqIcon}>
                        <RowIcon kind="support" />
                      </span>
                      <span className={s.faqLabel}>{q}</span>
                      <span className={s.chev}>
                        <LineIcon size={15} d="m9.5 6.5 5.5 5.5-5.5 5.5" />
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
                  {chips.skip ? (
                    <button
                      type="button"
                      className={`${s.chip} ${s.chipWa}`}
                      style={{ animationDelay: `${chips.items.length * 50}ms` }}
                      onClick={() => void skipDetails()}
                    >
                      <WhatsGlyph size={14} />
                      {SKIP_DETAILS}
                    </button>
                  ) : null}
                </div>
              ) : null}

              {chips?.kind === 'aulas' ? (
                <div className={s.faq} data-testid="help-chat-aulas">
                  {chips.items.map((a, i) => (
                    <button
                      key={a.path}
                      type="button"
                      className={s.faqRow}
                      style={{ animationDelay: `${i * 35}ms` }}
                      onClick={() => void pickAula(a)}
                    >
                      <span className={s.aulaRowThumb}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={a.capa} alt="" loading="lazy" decoding="async" />
                        <span className={s.aulaThumbPlay} aria-hidden="true">
                          <svg width="8" height="8" viewBox="0 0 24 24">
                            <path d="M8 5.5v13l10.5-6.5L8 5.5Z" fill="#fff" />
                          </svg>
                        </span>
                      </span>
                      <span className={s.faqLabel}>
                        {a.label}
                        {a.path === pathname ? <span className={s.aulaHere}>Esta tela</span> : null}
                      </span>
                      <span className={s.aulaRowTime}>{a.duracao}</span>
                      <span className={s.chev}>
                        <LineIcon size={15} d="m9.5 6.5 5.5 5.5-5.5 5.5" />
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}

              {chips?.kind === 'resolve' && (chipArticle || chipAula) ? (
                <div className={s.quick} data-testid="help-chat-resolve">
                  <button type="button" className={s.chip} onClick={() => onChip(RESOLVED, resolved)}>
                    {RESOLVED}
                  </button>
                  <button
                    type="button"
                    className={`${s.chip} ${s.chipWa}`}
                    style={{ animationDelay: '50ms' }}
                    onClick={() =>
                      onChip(TO_SUPPORT, (r) => (chipAula ? toSupportAula(chipAula, r) : toSupport(chipArticle!, r)))
                    }
                    data-testid="help-chat-to-support"
                  >
                    <WhatsGlyph size={14} />
                    {TO_SUPPORT}
                  </button>
                  {chips.maisAulas ? (
                    <button
                      type="button"
                      className={`${s.chip} ${s.chipAula}`}
                      style={{ animationDelay: '100ms' }}
                      onClick={() => void pickAulas(chipAula ? 'Ver outras aulas' : VER_AULAS)}
                    >
                      <PlayDot />
                      {chipAula ? 'Ver outras aulas' : VER_AULAS}
                    </button>
                  ) : null}
                </div>
              ) : null}

              {chips?.kind === 'request' && chipArticle?.request ? (
                <div className={s.quick} data-testid="help-chat-request">
                  <button type="button" className={s.chip} onClick={() => onChip('Mudei de ideia', changedMind)}>
                    Mudei de ideia
                  </button>
                  <button
                    type="button"
                    className={`${s.chip} ${s.chipWa}`}
                    style={{ animationDelay: '50ms' }}
                    onClick={() => onChip(chipArticle.request!.button, (r) => sendRequest(chipArticle, r))}
                  >
                    <WhatsGlyph size={14} />
                    {chipArticle.request.button}
                  </button>
                </div>
              ) : null}

              {chips?.kind === 'email' ? (
                <div className={s.quick}>
                  <button type="button" className={s.chip} onClick={() => void skipEmail()}>
                    Pular
                  </button>
                </div>
              ) : null}

              {chips?.kind === 'after' ? (
                <div className={s.quick}>
                  <button type="button" className={s.chip} onClick={() => void otherSubject('Tenho outra dúvida')}>
                    Tenho outra dúvida
                  </button>
                </div>
              ) : null}

              {chips?.kind === 'done' ? (
                <div className={s.quick}>
                  <button type="button" className={s.chip} onClick={() => void otherSubject('Falar de outro assunto')}>
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
