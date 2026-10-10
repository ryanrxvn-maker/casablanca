/**
 * Avisos e propagandas (central de avisos do /admin + sino de notificações).
 *
 * Lógica PURA, sem rede e sem React: a mesma regra roda no servidor (rotas
 * /api/admin/announcements e /api/user/notifications), no painel (contagem de
 * alcance e prévia) e nos testes (lib/announcements.test.ts).
 *
 * Regra da janela (pedido do Silas, 09.10):
 *  • enquanto o aviso estiver no ar, a janela abre a cada LOGIN;
 *  • quem já está logado vê na hora em que o admin ativa;
 *  • fechou a janela → fica só no histórico de notificações até sair e
 *    entrar de novo (sessão de login nova) ou o admin reativar.
 * A "chave" de cada janela fechada é `<sessão>:<activated_at>`, então login
 * novo e reativação abrem de novo sozinhos, sem relógio nem flag extra.
 */

import { EMAIL_TEMPLATES, type EmailTemplate } from './email-templates';

/* ───────────────────────── Modelos ───────────────────────── */

export type AnnKind = 'aviso' | 'propaganda';

export const AVISO_TONES = ['info', 'novidade', 'sucesso', 'atencao', 'urgente'] as const;
export type AvisoTone = (typeof AVISO_TONES)[number];

export const PROMO_THEMES = ['violeta', 'lima', 'ciano', 'ambar', 'rosa'] as const;
export type PromoTheme = (typeof PROMO_THEMES)[number];

/**
 * Arte da janela grande: 'tema' = imagem enviada ou a arte do Auto Edit na
 * cor; 'pilot' = a cena animada do herói do Pilot (cérebro que vira código e
 * avatares em holograma), a mesma da página da ferramenta. Aviso antigo sem o
 * campo cai em 'tema'.
 */
export const PROMO_ARTS = ['tema', 'pilot'] as const;
export type PromoArt = (typeof PROMO_ARTS)[number];

export type AvisoContent = {
  tone: AvisoTone;
  title: string;
  body: string;
  ctaLabel: string;
  ctaUrl: string;
};

export type PromoContent = {
  theme: PromoTheme;
  art: PromoArt;
  badge: string;
  title: string;
  body: string;
  bullets: string[];
  priceOld: string;
  priceNew: string;
  priceNote: string;
  ctaLabel: string;
  ctaUrl: string;
  imageUrl: string;
  /** Ajustes do e-mail (modelo "E-mail" da central). Sem isso, template automático e assunto = título. */
  mail?: MailSettings;
};

export type AnnContent = AvisoContent | PromoContent;

/* ───────────────────────── E-mail ───────────────────────── */

/** off = só na tela · also = tela + e-mail (1 vez por ativação) · only = só e-mail */
export const EMAIL_MODES = ['off', 'also', 'only'] as const;
export type EmailMode = (typeof EMAIL_MODES)[number];

export type MailSettings = { template: EmailTemplate; subject: string; preheader: string };

export type MailReason = 'quota' | 'erro' | 'sem_chave' | 'sem_destinatario';

/** Resultado do envio da ATIVAÇÃO atual (o servidor grava; o painel mostra). */
export type MailLog = {
  /** activated_at da ativação que este envio cobre */
  for: string | null;
  total: number;
  sent: number;
  failed: number;
  /** pediram pra não receber e-mail (ficaram de fora) */
  optOut: number;
  reason: MailReason | null;
  message: string | null;
  at: string;
  /** terminou (com ou sem falha); false = em andamento */
  done: boolean;
  /**
   * Até quem já foi (chave de ordem do último destinatário entregue ao Resend).
   * "Tentar o resto" continua DEPOIS dele — a chave de idempotência do Resend
   * vence em 24 h, então retomar no dia seguinte sem isto mandaria de novo.
   */
  cursor: string | null;
  /** cota lida no último envio (cabeçalhos do Resend) */
  quota: MailQuota | null;
};

/**
 * Cota do Resend lida nos cabeçalhos da resposta (valores = JÁ USADOS).
 * `daily` só vem no plano grátis — e essa cota é a MESMA dos e-mails de
 * código de cadastro/senha.
 */
export type MailQuota = { daily: number | null; monthly: number | null; at: string };

export function readMailQuota(raw: unknown): MailQuota | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);
  const q = { daily: n(r.daily), monthly: n(r.monthly), at: typeof r.at === 'string' ? r.at : new Date(0).toISOString() };
  return q.daily === null && q.monthly === null ? null : q;
}

export function readMailLog(raw: unknown): MailLog | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  const reasons: MailReason[] = ['quota', 'erro', 'sem_chave', 'sem_destinatario'];
  return {
    cursor: typeof r.cursor === 'string' && r.cursor.length <= 80 ? r.cursor : null,
    quota: readMailQuota(r.quota),
    for: typeof r.for === 'string' ? r.for : null,
    total: n(r.total),
    sent: n(r.sent),
    failed: n(r.failed),
    optOut: n(r.optOut),
    reason: reasons.includes(r.reason as MailReason) ? (r.reason as MailReason) : null,
    message: typeof r.message === 'string' ? r.message.slice(0, 300) : null,
    at: typeof r.at === 'string' ? r.at : new Date(0).toISOString(),
    done: r.done !== false,
  };
}

/** Modo de e-mail de um público vindo do banco (antigo sem o campo = off). */
export function emailModeOf(a: { email?: unknown } | null | undefined): EmailMode {
  return (EMAIL_MODES as readonly string[]).includes(a?.email as string) ? (a!.email as EmailMode) : 'off';
}

/**
 * Esta ativação já teve e-mail? Regra do pedido: o e-mail sai UMA vez por
 * ativação (o banner segue abrindo a cada login); desativar e ativar de novo
 * gera ativação nova → e-mail de novo.
 */
export function mailDoneFor(log: MailLog | null, activatedAt: string | null): boolean {
  if (!log || !activatedAt || !log.for) return false;
  return Date.parse(log.for) === Date.parse(activatedAt) && log.done && !log.reason;
}

export const LIMITS = {
  avisoTitle: 70,
  avisoBody: 280,
  promoBadge: 32,
  promoTitle: 80,
  promoBody: 260,
  bullet: 70,
  bullets: 3,
  price: 18,
  priceNote: 28,
  ctaLabel: 28,
  mailSubject: 120,
  mailPreheader: 160,
  url: 600,
  emails: 500,
} as const;

/** Cor de cada tom/tema por TOKEN do site (adapta no claro sozinho). */
export const TONE_META: Record<AvisoTone, { label: string; rgb: string }> = {
  info: { label: 'Informação', rgb: 'var(--cyan)' },
  novidade: { label: 'Novidade', rgb: 'var(--violet)' },
  sucesso: { label: 'Sucesso', rgb: 'var(--lime)' },
  atencao: { label: 'Atenção', rgb: 'var(--amber)' },
  urgente: { label: 'Urgente', rgb: '232 92 104' },
};

export const THEME_META: Record<PromoTheme, { label: string; rgb: string }> = {
  violeta: { label: 'Violeta', rgb: 'var(--violet)' },
  lima: { label: 'Lima', rgb: 'var(--lime)' },
  ciano: { label: 'Ciano', rgb: 'var(--cyan)' },
  ambar: { label: 'Âmbar', rgb: 'var(--amber)' },
  rosa: { label: 'Rosa', rgb: 'var(--pink)' },
};

export const KIND_LABEL: Record<AnnKind, string> = { aviso: 'Aviso', propaganda: 'Propaganda' };

/* ───────────────────────── Texto seguro ───────────────────────── */

/** Corta por caractere visível (emoji inteiro), nunca no meio de um par. */
export function clampChars(s: string, max: number): string {
  const chars = Array.from(s);
  return chars.length > max ? chars.slice(0, max).join('') : s;
}

export function charCount(s: string): number {
  return Array.from(s).length;
}

// Controle invisível e override de direção (texto que se disfarça de outro).
// Faixas por CÓDIGO (sem escape no fonte: caractere invisível literal no
// arquivo é armadilha e barra invertida some em patch por shell).
const INVISIBLE_RANGES: Array<[number, number]> = [
  [0x00, 0x08],
  [0x0b, 0x1f],
  [0x7f, 0x7f],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x2064],
  [0x2066, 0x2069],
  [0xfeff, 0xfeff],
];
const INVISIBLE = new RegExp(
  '[' + INVISIBLE_RANGES.map(([a, b]) => String.fromCharCode(a) + (b > a ? '-' + String.fromCharCode(b) : '')).join('') + ']',
  'g',
);

/** Linha única: sem quebra, espaços colapsados. */
export function cleanLine(raw: unknown, max: number): string {
  if (typeof raw !== 'string') return '';
  const s = raw.replace(/\r\n?/g, '\n').replace(/\t/g, ' ').replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();
  return clampChars(s, max);
}

/** Texto com parágrafo: mantém até UMA linha em branco entre blocos. */
export function cleanText(raw: unknown, max: number): string {
  if (typeof raw !== 'string') return '';
  const s = raw
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    .replace(INVISIBLE, '')
    .split('\n')
    .map((l) => l.replace(/ {2,}/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return clampChars(s, max);
}

/* ───────────────────────── Links ───────────────────────── */

/**
 * Link do botão: página do site ("/planos") ou endereço https. Sem protocolo
 * ("site.com/x") vira https. Devolve '' pra vazio e null pra inválido
 * (javascript:, http:, data:, "//host" disfarçado de caminho...).
 */
export function normalizeLink(raw: unknown): string | null {
  if (typeof raw !== 'string') return '';
  const s = raw.replace(INVISIBLE, '').trim();
  if (!s) return '';
  if (s.length > LIMITS.url) return null;
  if (s.startsWith('/')) {
    if (s.startsWith('//') || s.startsWith('/\\') || /\s/.test(s)) return null;
    return s;
  }
  const tryHttps = (v: string) => {
    try {
      const u = new URL(v);
      if (u.protocol !== 'https:' || !u.hostname.includes('.')) return null;
      if (u.username || u.password) return null;
      return u.toString();
    } catch {
      return null;
    }
  };
  if (/^https:\/\//i.test(s)) return tryHttps(s);
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return null; // outro protocolo
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?([/?#].*)?$/i.test(s)) return tryHttps('https://' + s);
  return null;
}

/** Imagem da propaganda: só https (Supabase Storage ou qualquer CDN). */
export function normalizeImage(raw: unknown): string | null {
  if (typeof raw !== 'string') return '';
  const s = raw.trim();
  if (!s) return '';
  if (s.length > LIMITS.url) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' && u.hostname.includes('.') ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Link interno (mesmo site)? Aceita caminho e URL absoluta do próprio host. */
export function internalPath(url: string, origin?: string): string | null {
  if (url.startsWith('/') && !url.startsWith('//')) return url;
  if (!origin) return null;
  try {
    const u = new URL(url);
    const o = new URL(origin);
    const host = (h: string) => h.replace(/^www\./, '');
    if (u.protocol === o.protocol && host(u.host) === host(o.host)) return u.pathname + u.search + u.hash;
  } catch {
    /* não é URL */
  }
  return null;
}

/* ───────────────────────── Conteúdo ───────────────────────── */

export function emptyContent(kind: 'aviso'): AvisoContent;
export function emptyContent(kind: 'propaganda'): PromoContent;
export function emptyContent(kind: AnnKind): AnnContent;
export function emptyContent(kind: AnnKind): AnnContent {
  if (kind === 'aviso') return { tone: 'novidade', title: '', body: '', ctaLabel: '', ctaUrl: '' };
  return {
    theme: 'violeta',
    art: 'tema',
    badge: '',
    title: '',
    body: '',
    bullets: [],
    priceOld: '',
    priceNew: '',
    priceNote: '',
    ctaLabel: '',
    ctaUrl: '',
    imageUrl: '',
  };
}

export type CleanResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Limpa e valida o conteúdo de um template. O servidor SEMPRE passa por aqui
 * antes de gravar; o painel usa a mesma função pra mostrar o erro antes.
 */
export function cleanContent(kind: AnnKind, raw: unknown): CleanResult<AnnContent> {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const ctaLabel = cleanLine(r.ctaLabel, LIMITS.ctaLabel);
  const ctaUrl = normalizeLink(r.ctaUrl);
  if (ctaUrl === null) {
    return { ok: false, error: 'O link do botão precisa ser uma página do site (começando com /) ou um endereço https://.' };
  }
  if (ctaUrl && !ctaLabel) return { ok: false, error: 'Escreva o texto do botão (o link já está preenchido).' };
  if (ctaLabel && !ctaUrl) return { ok: false, error: 'Coloque o link do botão (ou apague o texto dele).' };

  if (kind === 'aviso') {
    const tone = (AVISO_TONES as readonly string[]).includes(r.tone as string) ? (r.tone as AvisoTone) : 'info';
    const title = cleanLine(r.title, LIMITS.avisoTitle);
    const body = cleanText(r.body, LIMITS.avisoBody);
    if (!title) return { ok: false, error: 'Escreva o título do aviso.' };
    return { ok: true, value: { tone, title, body, ctaLabel, ctaUrl } };
  }

  const theme = (PROMO_THEMES as readonly string[]).includes(r.theme as string) ? (r.theme as PromoTheme) : 'violeta';
  const title = cleanLine(r.title, LIMITS.promoTitle);
  if (!title) return { ok: false, error: 'Escreva o título da propaganda.' };
  const art = (PROMO_ARTS as readonly string[]).includes(r.art as string) ? (r.art as PromoArt) : 'tema';
  // Com a cena do Pilot a imagem não aparece: nem guarda nem barra link velho.
  const imageUrl = art === 'pilot' ? '' : normalizeImage(r.imageUrl);
  if (imageUrl === null) return { ok: false, error: 'A imagem precisa ser um endereço https:// (ou envie um arquivo).' };
  const bullets = (Array.isArray(r.bullets) ? r.bullets : [])
    .map((b) => cleanLine(b, LIMITS.bullet))
    .filter(Boolean)
    .slice(0, LIMITS.bullets);
  const priceOld = cleanLine(r.priceOld, LIMITS.price);
  const priceNew = cleanLine(r.priceNew, LIMITS.price);
  if (priceOld && !priceNew) return { ok: false, error: 'Preencha o preço novo (o "de" sozinho não aparece).' };
  return {
    ok: true,
    value: {
      theme,
      art,
      badge: cleanLine(r.badge, LIMITS.promoBadge),
      title,
      body: cleanText(r.body, LIMITS.promoBody),
      bullets,
      priceOld,
      priceNew,
      priceNote: priceNew ? cleanLine(r.priceNote, LIMITS.priceNote) : '',
      ctaLabel,
      ctaUrl,
      imageUrl,
      ...(r.mail && typeof r.mail === 'object' ? { mail: cleanMail(r.mail, title) } : {}),
    },
  };
}

/** Ajustes do e-mail: template conhecido, assunto (vazio = título) e pré-texto. */
export function cleanMail(raw: unknown, title: string): MailSettings {
  const m = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const template = (EMAIL_TEMPLATES as readonly string[]).includes(m.template as string) ? (m.template as EmailTemplate) : 'oferta';
  return {
    template,
    subject: cleanLine(m.subject, LIMITS.mailSubject) || clampChars(title, LIMITS.mailSubject),
    preheader: cleanLine(m.preheader, LIMITS.mailPreheader),
  };
}

/** Lê do banco sem confiar: conteúdo quebrado vira o vazio do tipo (nunca derruba a tela). */
export function readContent(kind: AnnKind, raw: unknown): AnnContent {
  const r = cleanContent(kind, raw);
  if (r.ok) return r.value;
  // Conteúdo antigo/inválido: mostra o que der, sem botão nem imagem duvidosos.
  const base = emptyContent(kind);
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (kind === 'aviso') {
    const b = base as AvisoContent;
    return { ...b, title: cleanLine(o.title, LIMITS.avisoTitle) || 'Aviso', body: cleanText(o.body, LIMITS.avisoBody) };
  }
  const b = base as PromoContent;
  return { ...b, title: cleanLine(o.title, LIMITS.promoTitle) || 'Novidade', body: cleanText(o.body, LIMITS.promoBody) };
}

export function contentTitle(c: AnnContent): string {
  return c.title;
}

/* ───────────────────────── Audiência ───────────────────────── */

export const SEGMENTS = ['all', 'free', 'premium', 'paid', 'granted', 'pending', 'beta'] as const;
export type Segment = (typeof SEGMENTS)[number];

export const SEGMENT_META: Record<Segment, { label: string; hint: string }> = {
  all: { label: 'Todos os clientes', hint: 'Free e Premium' },
  free: { label: 'Free', hint: 'Sem plano ativo' },
  premium: { label: 'Premium', hint: 'Pagantes, liberados e legado' },
  paid: { label: 'Pagantes', hint: 'Assinatura paga no Stripe' },
  granted: { label: 'Liberados por você', hint: 'Premium sem cobrança' },
  pending: { label: 'Pagamento pendente', hint: 'Renovação não paga' },
  beta: { label: 'Beta Pro', hint: 'Com ferramenta liberada' },
};

export type Audience = {
  segments: Segment[];
  emails: string[];
  includeAdmins: boolean;
  /** canal de e-mail (ausente = off): ver EMAIL_MODES */
  email?: EmailMode;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const e = raw.replace(INVISIBLE, '').trim().toLowerCase();
  return e.length <= 254 && EMAIL_RE.test(e) ? e : null;
}

export function cleanAudience(raw: unknown): Audience {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const segs = Array.from(
    new Set((Array.isArray(r.segments) ? r.segments : []).filter((s): s is Segment => (SEGMENTS as readonly string[]).includes(s as string))),
  );
  const emails = Array.from(
    new Set((Array.isArray(r.emails) ? r.emails : []).map(normalizeEmail).filter((e): e is string => !!e)),
  ).slice(0, LIMITS.emails);
  return {
    // "Todos" engole os outros segmentos (nada a somar).
    segments: segs.includes('all') ? ['all'] : SEGMENTS.filter((s) => segs.includes(s)),
    emails,
    includeAdmins: r.includeAdmins === true,
    email: emailModeOf(r),
  };
}

export function audienceIsEmpty(a: Audience): boolean {
  return a.segments.length === 0 && a.emails.length === 0 && !a.includeAdmins;
}

/** "Free e Pagantes · 3 contas · admins" */
export function audienceSummary(a: Audience, opts: { admins?: boolean } = {}): string {
  const parts: string[] = [];
  const segs = a.segments.map((s) => (s === 'all' ? 'Todos os clientes' : SEGMENT_META[s].label));
  if (segs.length === 1) parts.push(segs[0]);
  else if (segs.length > 1) parts.push(segs.slice(0, -1).join(', ') + ' e ' + segs[segs.length - 1]);
  if (a.emails.length) parts.push(`${a.emails.length} ${a.emails.length === 1 ? 'conta' : 'contas'}`);
  if (a.includeAdmins && opts.admins !== false) parts.push('admins');
  return parts.join(' · ') || (a.includeAdmins ? 'Só admins' : 'Ninguém');
}

/** Quem está olhando (servidor monta do profile; painel monta da lista). */
export type Viewer = {
  id: string;
  email: string | null;
  isAdmin: boolean;
  isActive: boolean;
  plan: 'premium' | 'free';
  access: 'paid' | 'granted' | 'pending' | 'anomaly' | 'free';
  beta: boolean;
};

export function viewerSegments(v: Pick<Viewer, 'plan' | 'access' | 'beta'>): Set<Segment> {
  const s = new Set<Segment>(['all']);
  s.add(v.plan === 'premium' ? 'premium' : 'free');
  if (v.access === 'paid') s.add('paid');
  if (v.access === 'granted') s.add('granted');
  if (v.access === 'pending') s.add('pending');
  if (v.beta) s.add('beta');
  return s;
}

export function matchesAudience(a: Audience, v: Viewer): boolean {
  if (!v.isActive) return false;
  const email = v.email?.toLowerCase() ?? null;
  if (email && a.emails.includes(email)) return true;
  // Admin não é cliente: só recebe quando o aviso pede (ou pelo email).
  if (v.isAdmin) return a.includeAdmins;
  const segs = viewerSegments(v);
  return a.segments.some((s) => segs.has(s));
}

/* ───────────────────────── No ar / janela ───────────────────────── */

export type LiveShape = { active: boolean; ends_at: string | null };

export function isLive(a: LiveShape, now = Date.now()): boolean {
  if (!a.active) return false;
  if (!a.ends_at) return true;
  const end = Date.parse(a.ends_at);
  return Number.isFinite(end) ? end > now : true;
}

export const MAX_DISMISSED_KEYS = 16;

/** Chave de uma janela fechada: sessão de login + momento da ativação. */
export function popupKey(session: string, activatedAt: string | null): string {
  const t = activatedAt ? Date.parse(activatedAt) : 0;
  return `${session}:${Number.isFinite(t) ? t : 0}`;
}

/**
 * Como a chave fica GRAVADA (09.10): `<sessão>:<ativação>@<hora em que fechou>`.
 * A hora alimenta o "Quem viu" do painel (um registro por login em que a
 * pessoa viu e fechou a janela). Chave antiga, sem a hora, vale igual.
 */
export function keyBase(stored: string): string {
  const at = stored.indexOf('@');
  return at < 0 ? stored : stored.slice(0, at);
}

export function shouldPopup(
  a: LiveShape & { popup: boolean; activated_at: string | null },
  row: { dismissed_keys?: string[] | null } | null | undefined,
  session: string,
  now = Date.now(),
): boolean {
  if (!a.popup || !isLive(a, now)) return false;
  const keys = row?.dismissed_keys ?? [];
  const want = popupKey(session, a.activated_at);
  return !keys.some((k) => keyBase(k) === want);
}

/**
 * Acrescenta a chave sem repetir o login e mantém só as últimas. Com `atMs`,
 * grava a hora do fechamento; fechar de novo no MESMO login guarda a hora do
 * primeiro (é a mesma visualização).
 */
export function addDismissedKey(keys: string[] | null | undefined, key: string, atMs?: number): string[] {
  const base = keyBase(key);
  const list = keys ?? [];
  const prev = list.find((k) => keyBase(k) === base);
  const entry = prev ?? (atMs != null && Number.isFinite(atMs) ? `${base}@${Math.round(atMs)}` : base);
  const next = list.filter((k) => keyBase(k) !== base);
  next.push(entry);
  return next.slice(-MAX_DISMISSED_KEYS);
}

/* ───────────────────────── Quem viu (painel) ───────────────────────── */

/** Linha da caixa de uma conta, como vem do banco. */
export type InboxSeenRow = {
  delivered_at: string;
  read_at: string | null;
  dismissed_at: string | null;
  dismissed_keys: string[] | null;
  clicked_at: string | null;
  deleted_at: string | null;
};

export type SeenView = {
  /** hora em que viu (fechou a janela / abriu no sino); null = registro antigo sem hora */
  at: string | null;
  /** onde: na janela da tela (um login) ou abrindo no sino */
  via: 'janela' | 'sino';
  /** foi antes do admin "mostrar de novo pra todos" (outra ativação) */
  earlier: boolean;
};

export type SeenRow = {
  userId: string;
  deliveredAt: string;
  /** uma por login em que viu, da mais antiga pra mais nova */
  views: SeenView[];
  /** chegou no teto de logins guardados: pode ter visto mais vezes */
  capped: boolean;
  firstAt: string | null;
  lastAt: string | null;
  clickedAt: string | null;
  deletedAt: string | null;
};

const msToIso = (ms: number) => new Date(ms).toISOString();

/**
 * O que o painel mostra de UMA conta: cada login em que ela viu o aviso (hora
 * de cada um), primeira e última vez, clique e se apagou do sino.
 * Sem chave e com leitura = leu no sino (aviso "só no sino" ou abriu pela
 * lista). Apagar do sino sem ler marca leitura na mesma hora: não conta.
 */
export function seenFromInbox(userId: string, row: InboxSeenRow, activatedAt: string | null): SeenRow {
  const keys = row.dismissed_keys ?? [];
  const act = activatedAt ? Date.parse(activatedAt) : NaN;
  const views: SeenView[] = keys.map((k, i) => {
    const base = keyBase(k);
    const atPart = k.length > base.length ? Number(k.slice(base.length + 1)) : NaN;
    const actPart = Number(base.slice(base.lastIndexOf(':') + 1));
    // chave antiga sem hora: a ÚLTIMA da lista é a do último fechamento e a
    // PRIMEIRA é a da primeira leitura (o 1º fechamento grava read_at)
    const at =
      Number.isFinite(atPart) && atPart > 0
        ? msToIso(atPart)
        : i === keys.length - 1
          ? row.dismissed_at
          : i === 0
            ? row.read_at
            : null;
    return { at, via: 'janela', earlier: Number.isFinite(act) && Number.isFinite(actPart) && actPart !== act };
  });
  const apagouSemLer = !!row.deleted_at && row.read_at === row.deleted_at;
  if (!views.length && row.read_at && !apagouSemLer) views.push({ at: row.read_at, via: 'sino', earlier: false });
  views.sort((a, b) => (a.at ? Date.parse(a.at) : 0) - (b.at ? Date.parse(b.at) : 0));
  const times = views.map((v) => v.at).filter((t): t is string => !!t);
  return {
    userId,
    deliveredAt: row.delivered_at,
    views,
    capped: keys.length >= MAX_DISMISSED_KEYS,
    firstAt: times[0] ?? null,
    lastAt: times[times.length - 1] ?? null,
    clickedAt: row.clicked_at,
    deletedAt: row.deleted_at,
  };
}

/* ───────────────────────── Sessão de login ───────────────────────── */

/** session_id do access token do Supabase (claim `session_id`), sem validar
 *  assinatura: quem chama já validou o usuário pelo getUser(). */
export function sessionIdFromJwt(token: string | null | undefined): string | null {
  if (!token) return null;
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const json =
      typeof atob === 'function'
        ? decodeURIComponent(
            Array.from(atob(pad))
              .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
              .join(''),
          )
        : Buffer.from(pad, 'base64').toString('utf8');
    const claims = JSON.parse(json) as { session_id?: unknown };
    return typeof claims.session_id === 'string' && claims.session_id ? claims.session_id : null;
  } catch {
    return null;
  }
}

/* ───────────────────────── O que o cliente recebe ───────────────────────── */

export type NotifItem = {
  id: string;
  kind: AnnKind;
  content: AnnContent;
  deliveredAt: string;
  readAt: string | null;
  clickedAt: string | null;
  live: boolean;
  activatedAt: string | null;
  endsAt: string | null;
};

export type NotifPayload = {
  enabled: boolean;
  userId: string | null;
  /** Hash curto da sessão de login: mudou = login novo. */
  sk: string;
  items: NotifItem[];
  unread: number;
  popups: NotifItem[];
};

export type NotifAction = 'read' | 'unread' | 'dismiss' | 'click' | 'delete' | 'restore' | 'read_all' | 'clear_read';
export const NOTIF_ACTIONS: readonly NotifAction[] = ['read', 'unread', 'dismiss', 'click', 'delete', 'restore', 'read_all', 'clear_read'];

/** Propaganda primeiro (janela grande, uma por vez), depois avisos; mais novo antes. */
export function sortPopups<T extends { kind: AnnKind; activatedAt: string | null }>(list: T[]): T[] {
  const at = (s: string | null) => (s ? Date.parse(s) || 0 : 0);
  return [...list].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'propaganda' ? -1 : 1;
    return at(b.activatedAt) - at(a.activatedAt);
  });
}

/* ───────────────────────── Painel (admin) ───────────────────────── */

export type AnnStats = { delivered: number; read: number; clicked: number; dismissed: number; deleted: number };

export type AdminAnnouncement = {
  id: string;
  kind: AnnKind;
  content: AnnContent;
  audience: Audience;
  popup: boolean;
  active: boolean;
  live: boolean;
  activatedAt: string | null;
  endsAt: string | null;
  createdAt: string;
  updatedAt: string;
  stats: AnnStats;
  /** envio de e-mail da ativação atual (null = nunca saiu e-mail) */
  mail: MailLog | null;
};

export type AnnStatus = 'live' | 'scheduled_end' | 'paused' | 'draft' | 'ended';

/** Estado pro selo do painel: no ar, rascunho (nunca ativado), pausado, encerrado pelo prazo. */
export function annStatus(a: Pick<AdminAnnouncement, 'active' | 'activatedAt' | 'endsAt'>, now = Date.now()): AnnStatus {
  if (a.active) {
    if (!isLive({ active: true, ends_at: a.endsAt }, now)) return 'ended';
    return a.endsAt ? 'scheduled_end' : 'live';
  }
  return a.activatedAt ? 'paused' : 'draft';
}

/** Prazo: ISO no futuro (até 1 ano) ou null. Devolve undefined pra inválido. */
export function cleanEndsAt(raw: unknown, now = Date.now()): string | null | undefined {
  if (raw == null || raw === '') return null;
  if (typeof raw !== 'string') return undefined;
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) return undefined;
  if (t <= now + 60_000) return undefined;
  if (t > now + 366 * 86_400_000) return undefined;
  return new Date(t).toISOString();
}

/* ───────────────────────── Prazo ───────────────────────── */

/** "2 d 04 h", "3 h 12 min", "8 min", null se acabou. */
export function timeLeft(endsAt: string | null, now = Date.now()): string | null {
  if (!endsAt) return null;
  const ms = Date.parse(endsAt) - now;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'menos de 1 min';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ${String(min % 60).padStart(2, '0')} min`;
  const d = Math.floor(h / 24);
  return `${d} d ${String(h % 24).padStart(2, '0')} h`;
}
