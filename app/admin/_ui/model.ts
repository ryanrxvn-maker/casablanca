import { UNLOCKABLE_TOOLS } from '@/lib/tool-unlocks';
import type {
  AccessDeviceRow,
  AccessEventRow,
  AccessSessionRow,
  DaySummary,
  DeviceSummary,
  IpSummary,
  UsageSummary,
} from '@/lib/admin-access-summary';

/* ───────────────────────── Tipos ───────────────────────── */

export type AdminUser = {
  id: string;
  email: string | null;
  name: string | null;
  is_admin: boolean;
  is_active: boolean;
  must_change_password: boolean;
  created_at: string;
  last_seen_at: string | null;
  last_ip: string | null;
  last_tool: string | null;
  last_tool_at: string | null;
  tier?: string | null;
  phone?: string | null;
  phone_verified?: boolean | null;
  subscription_status?: string | null;
  subscription_plan?: string | null;
  current_period_end?: string | null;
  traffic_source?: string | null;
  plan: 'premium' | 'free';
  access: 'paid' | 'granted' | 'pending' | 'anomaly' | 'free';
  tool_unlocks: string[];
  static_unlocks: string[];
  receipt_url: string | null;
  last_payment_at: string | null;
  concurrent_30d?: number;
  concurrent_last_at?: string | null;
};

export type Payment = {
  id: number;
  email: string | null;
  amount: number;
  currency: string;
  plan: string | null;
  billing: string | null;
  status: string;
  receipt_url: string | null;
  created_at: string | null;
};

/** Uma linha de /api/admin/cancellations (lida do Stripe, ao vivo). */
export type CancelRow = {
  key: string;
  kind: 'scheduled' | 'refunded' | 'ended' | 'refund';
  user_id: string | null;
  name: string | null;
  email: string | null;
  customer_id: string | null;
  subscription_id: string | null;
  plan: string | null;
  amount: number | null;
  started_at: string | null;
  requested_at: string | null;
  access_until: string | null;
  refunded_amount: number;
  refunded_at: string | null;
  reason: string | null;
  comment: string | null;
};

export const CANCEL_META: Record<CancelRow['kind'], { label: string; accent: Accent }> = {
  scheduled: { label: 'Cancelamento agendado', accent: 'amber' },
  refunded: { label: 'Cancelou e foi reembolsado', accent: 'danger' },
  refund: { label: 'Reembolsado', accent: 'danger' },
  ended: { label: 'Assinatura encerrada', accent: 'neutral' },
};

/** O cancelamento ainda vale pra essa conta? Encerrado/reembolsado de quem
 *  voltou a pagar é passado — não marca a pessoa como "cancelou". */
export function cancelApplies(c: CancelRow | undefined, u: Pick<AdminUser, 'access'>): c is CancelRow {
  if (!c) return false;
  return c.kind === 'scheduled' || u.access !== 'paid';
}

export type ConcurrencyAlert = {
  id: number;
  user_id: string;
  name: string | null;
  email: string | null;
  started_at: string;
  ended_at: string;
  label_a: string | null;
  label_b: string | null;
  place_a: string | null;
  place_b: string | null;
  same_network: boolean;
};

export type Dash = {
  totals: { users: number; online: number; paying: number; mrr: number };
  toolRanking: Array<{ tool: string; count: number }>;
  trafficSources: Array<{ source: string; count: number }>;
  payments: Payment[];
  revenueTotal: number;
  refundedTotal?: number;
  growth?: {
    newToday: number;
    new7d: number;
    new30d: number;
    active24h: number;
    active7d: number;
    active30d: number;
    customers: number;
    signupDays: Array<{ day: string; count: number }>;
  };
  concurrency?: {
    enabled: boolean;
    accounts7d: number;
    events7d: number;
    recent: ConcurrencyAlert[];
  };
};

export type ProfileData = {
  user: AdminUser & {
    avatar_url?: string | null;
    activated_at?: string | null;
    phone_verified_at?: string | null;
    legacy_no_phone?: boolean | null;
    stripe_customer_id?: string | null;
    stripe_subscription_id?: string | null;
    utm_source?: string | null;
    utm_medium?: string | null;
    utm_campaign?: string | null;
    first_touch_at?: string | null;
  };
  auth: {
    created_at: string | null;
    last_sign_in_at: string | null;
    email_confirmed_at: string | null;
    provider: string | null;
    providers: string[];
  } | null;
  payments: Payment[];
  billing: { totalPaid: number; refunded: number; count: number; firstAt: string | null; lastAt: string | null };
  tierChanges: Array<{
    id: number;
    from_tier: string | null;
    to_tier: string | null;
    reason: string | null;
    created_at: string;
    by: string | null;
  }>;
  usage: UsageSummary;
  access: {
    enabled: boolean;
    sessions: AccessSessionRow[];
    events: AccessEventRow[];
    ips: IpSummary[];
    devices: DeviceSummary[];
    days: DaySummary[];
    totals: {
      activeSeconds: number;
      connectedSeconds: number;
      ips: number;
      devices: number;
      concurrent: number;
      sameMachine: number;
      firstAt: string | null;
    };
  };
};

export type { AccessDeviceRow, AccessEventRow, AccessSessionRow };

/* ───────────────────────── Cor por token ───────────────────────── */

export type Accent = 'lime' | 'cyan' | 'violet' | 'amber' | 'neutral' | 'danger';
const ACCENT_VAR: Record<Accent, string> = {
  lime: 'var(--lime)',
  cyan: 'var(--cyan)',
  violet: 'var(--violet)',
  amber: 'var(--amber)',
  neutral: 'var(--text-muted)',
  danger: '232 92 104',
};
/** Cor por TOKEN (adapta no modo claro sozinho). */
export const accent = (a: Accent, alpha?: number) =>
  alpha == null ? `rgb(${ACCENT_VAR[a]})` : `rgb(${ACCENT_VAR[a]} / ${alpha})`;

export const ACCESS_META: Record<AdminUser['access'], { label: string; short: string; accent: Accent }> = {
  paid: { label: 'Premium pago', short: 'Pago', accent: 'lime' },
  granted: { label: 'Premium liberado', short: 'Liberado', accent: 'cyan' },
  // Renovação falhou → acesso SUSPENSO até o pagamento entrar (assinatura
  // continua viva no Stripe; o cliente resolve na tela de assinatura).
  pending: { label: 'Pagamento pendente', short: 'Pendente', accent: 'amber' },
  anomaly: { label: 'Premium sem origem', short: 'Sem origem', accent: 'danger' },
  free: { label: 'Free', short: 'Free', accent: 'neutral' },
};

/* ───────────────────────── Ferramentas ───────────────────────── */

const TOOL_LABELS: Record<string, string> = {
  decupagem: 'Remover Silêncios',
  'decupagem-copy': 'Remover Silêncios por Copy',
  downloader: 'Downloader',
  camuflagem: 'Camuflagem de Áudio',
  compressor: 'Compressor',
  'audio-split': 'Dividir Voz',
  acelerador: 'Mixer de Velocidade',
  normalizador: 'Normalizador de Áudio',
  calculadora: 'Calculadora',
  'copy-srt': 'Gerador de SRT',
  'auto-cortes': 'Auto Cortes',
  'auto-broll': 'Auto B-roll',
  'heygen-auto': 'Hey Auto',
  'clickup-pilot': 'Pilot',
  'remover-elementos': 'Remover Legenda',
  'separador-audio': 'Separador de Áudio',
  'ltx-video': 'LTX Video',
  fakepass: 'FakePrint',
  'caixinha-pergunta': 'Caixinha de Pergunta',
  lipsync: 'Lipsync',
  historico: 'Histórico',
  notificacoes: 'Notificações',
  tipografia: 'Tipografia',
  legendas: 'Legendas',
};
export const toolLabel = (s: string | null | undefined) => (s ? (TOOL_LABELS[s] ?? s) : null);

export const CATALOG_PATHS = new Set(UNLOCKABLE_TOOLS.map((t) => t.path));
export const CATALOG_LABEL = new Map(UNLOCKABLE_TOOLS.map((t) => [t.path, t.label]));

export function betaProTools(u: Pick<AdminUser, 'tool_unlocks' | 'static_unlocks'>): string[] {
  const set = new Set<string>();
  for (const p of u.tool_unlocks ?? []) if (CATALOG_PATHS.has(p)) set.add(p);
  for (const p of u.static_unlocks ?? []) if (CATALOG_PATHS.has(p)) set.add(p);
  return Array.from(set);
}

/* ───────────────────────── Estado ao vivo ───────────────────────── */

export function isOnline(u: Pick<AdminUser, 'last_seen_at'>, now = Date.now()): boolean {
  if (!u.last_seen_at) return false;
  return (now - new Date(u.last_seen_at).getTime()) / 1000 <= 60;
}

export function isUsingTool(u: Pick<AdminUser, 'last_tool_at'>, now = Date.now()): boolean {
  if (!u.last_tool_at) return false;
  return (now - new Date(u.last_tool_at).getTime()) / 1000 <= 90;
}

/* ───────────────────────── Formatação ───────────────────────── */

const TZ = 'America/Sao_Paulo';
const fDate = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
const fDateShort = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit' });
const fTime = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const fWeekday = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, weekday: 'long', day: '2-digit', month: 'long' });

export const fmtDate = (iso: string | null | undefined) => (iso ? fDate.format(new Date(iso)) : null);
export const fmtDateShort = (iso: string | number | null | undefined) =>
  iso == null ? null : fDateShort.format(new Date(iso));
export const fmtTime = (iso: string | null | undefined) => (iso ? fTime.format(new Date(iso)) : null);
export const fmtDateTime = (iso: string | null | undefined) =>
  iso ? `${fDate.format(new Date(iso))} às ${fTime.format(new Date(iso))}` : null;

/** "terça-feira, 07 de outubro" → primeira letra maiúscula. */
export function fmtWeekday(iso: string): string {
  const s = fWeekday.format(new Date(iso));
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Dia YYYY-MM-DD (do servidor, fuso SP) → "07/10". */
export function dayLabel(day: string): string {
  const [, m, d] = day.split('-');
  return `${d}/${m}`;
}

export function timeAgo(iso: string | null | undefined, now = Date.now()): string | null {
  if (!iso) return null;
  const s = (now - new Date(iso).getTime()) / 1000;
  if (s < 0) return 'agora';
  if (s < 60) return 'agora';
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  if (s < 30 * 86400) {
    const d = Math.floor(s / 86400);
    return d === 1 ? 'ontem' : `há ${d} dias`;
  }
  return fmtDate(iso);
}

export function daysSince(iso: string | null | undefined, now = Date.now()): number | null {
  if (!iso) return null;
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 86_400_000));
}

export function brl(centavos: number): string {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** 45 → "menos de 1 min", 750 → "12 min", 3900 → "1 h 05 min". */
export function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return 'menos de 1 min';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h} h ${String(rm).padStart(2, '0')} min` : `${h} h`;
}

/** +5511987654321 → +55 (11) 98765-4321. Outros formatos saem como vieram. */
export function fmtPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = raw.replace(/\D/g, '');
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) {
    const ddd = d.slice(2, 4);
    const n = d.slice(4);
    const head = n.length === 9 ? n.slice(0, 5) : n.slice(0, 4);
    return `+55 (${ddd}) ${head}-${n.slice(head.length)}`;
  }
  return raw.startsWith('+') ? raw : `+${d}`;
}

export function whatsappLink(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = raw.replace(/\D/g, '');
  return d.length >= 10 ? `https://wa.me/${d}` : null;
}

export function initials(name: string | null | undefined, email: string | null | undefined): string {
  const src = (name || '').trim();
  if (src) {
    const parts = src.split(/\s+/).filter(Boolean);
    const a = parts[0]?.[0] ?? '';
    const b = parts.length > 1 ? parts[parts.length - 1][0] : '';
    return (a + b).toUpperCase();
  }
  return (email || '?').slice(0, 1).toUpperCase();
}

export function planLabel(plan: string | null | undefined, billing?: string | null): string {
  const p = plan === 'basic' ? 'Premium' : plan === 'pro' ? 'Pro' : plan ? plan : 'Plano';
  if (!billing) return p;
  return `${p} ${billing === 'annual' ? 'anual' : 'mensal'}`;
}

export const STRIPE_STATUS_LABEL: Record<string, string> = {
  active: 'Assinatura ativa',
  trialing: 'Em teste',
  paid: 'Pago (pagamento único)',
  admin_grant: 'Liberado pelo admin',
  past_due: 'Cobrança atrasada',
  unpaid: 'Não pago',
  canceled: 'Cancelada',
  incomplete: 'Incompleta',
  incomplete_expired: 'Expirada',
  refunded: 'Reembolsado',
};

export const TIER_LABEL: Record<string, string> = {
  free: 'Free',
  basic: 'Premium',
  pro: 'Pro',
  beta: 'Beta',
  admin: 'Admin',
};
