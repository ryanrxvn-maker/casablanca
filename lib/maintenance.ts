/**
 * Ferramentas em MANUTENÇÃO.
 *
 * Regra: bloqueadas pra TODOS os clientes — só a conta admin acessa (pra
 * testar) e as contas da lista "furam a manutenção". O bloqueio REAL é
 * server-side no middleware (lib/supabase/middleware.ts) e nas APIs
 * (requireToolAccess); a UI só mostra o aviso.
 *
 * 10.10: o estado deixou de ser uma lista fixa no código. O admin liga e
 * desliga pelo botão "Ferramentas" do /admin; o estado mora num arquivo
 * privado no Storage (lib/maintenance-store.ts). Este módulo é a regra PURA,
 * sem rede: serve ao middleware (edge), às APIs, ao hub e ao painel.
 * Sem arquivo salvo ainda, vale DEFAULT_MAINTENANCE_TOOLS (o que estava fixo).
 */

/* ───────────────────────── Modelo ───────────────────────── */

export type ToolMaint = {
  maintenance: boolean;
  /** Recado pro cliente (opcional). */
  message: string;
  /** Volta sozinha neste horário (ISO) ou null = sem previsão. */
  until: string | null;
  since: string | null;
  by: string | null;
};

export type ToolsLogAction = 'on' | 'off' | 'edit' | 'all_on' | 'all_off' | 'bypass';

export type ToolsLogEntry = {
  at: string;
  by: string;
  action: ToolsLogAction;
  path?: string;
  detail?: string;
};

export type ToolsConfig = {
  v: 1;
  /** Sobe a cada gravação: dois admins salvando juntos não se atropelam. */
  rev: number;
  tools: Record<string, ToolMaint>;
  /** Emails que acessam ferramenta em manutenção (além do admin). */
  bypass: string[];
  log: ToolsLogEntry[];
  updatedAt: string | null;
};

/** O que cada conta recebe: só o que está em manutenção AGORA, sem emails nem histórico. */
export type MaintenanceSnapshot = {
  tools: Record<string, { message: string; until: string | null }>;
  /** Esta conta entra mesmo assim (admin ou email liberado). */
  canBypass: boolean;
  rev: number;
};

export const LIMITS = { message: 160, bypass: 60, log: 40, untilDays: 30 } as const;

/** Estado de antes do painel (era a lista fixa). Vale até a 1ª gravação. */
export const DEFAULT_MAINTENANCE_TOOLS: readonly string[] = [
  // '/tools/normalizador' — SAIU da manutenção em 14.08.2026 (liberado pra todos, incl. free)
  '/tools/separador-audio',
  '/tools/remover-elementos',
];
/** @deprecated nome antigo; o estado vivo vem do painel. */
export const MAINTENANCE_TOOLS = DEFAULT_MAINTENANCE_TOOLS;

const PATH_RE = /^\/tools\/[a-z0-9-]{2,40}$/;
export const isToolPath = (p: unknown): p is string => typeof p === 'string' && PATH_RE.test(p);

export function defaultToolsConfig(): ToolsConfig {
  const tools: Record<string, ToolMaint> = {};
  for (const p of DEFAULT_MAINTENANCE_TOOLS) tools[p] = { maintenance: true, message: '', until: null, since: null, by: null };
  return { v: 1, rev: 0, tools, bypass: [], log: [], updatedAt: null };
}

/* ───────────────────────── Limpeza ───────────────────────── */

/** Linha única, sem controle nem caractere invisível de direção (filtro por código). */
function cleanText(raw: unknown, max: number): string {
  if (typeof raw !== 'string') return '';
  const s = raw
    .split('')
    .filter((c) => {
      const o = c.charCodeAt(0);
      return o >= 32 && o !== 127 && !(o >= 0x200b && o <= 0x200f) && !(o >= 0x202a && o <= 0x202e) && !(o >= 0x2066 && o <= 0x2069) && o !== 0xfeff;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(s).slice(0, max).join('');
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const e = raw.trim().toLowerCase();
  return e.length <= 254 && EMAIL_RE.test(e) ? e : null;
}

function isoOrNull(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw) return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

const ACTIONS: readonly ToolsLogAction[] = ['on', 'off', 'edit', 'all_on', 'all_off', 'bypass'];

/** Lê o arquivo salvo sem confiar no formato: lixo vira o padrão, nunca exceção. */
export function cleanToolsConfig(raw: unknown): ToolsConfig {
  if (!raw || typeof raw !== 'object') return defaultToolsConfig();
  const r = raw as Record<string, unknown>;
  const tools: Record<string, ToolMaint> = {};
  const src = r.tools && typeof r.tools === 'object' ? (r.tools as Record<string, unknown>) : {};
  for (const [path, v] of Object.entries(src)) {
    if (!isToolPath(path) || !v || typeof v !== 'object') continue;
    const t = v as Record<string, unknown>;
    tools[path] = {
      maintenance: t.maintenance === true,
      message: cleanText(t.message, LIMITS.message),
      until: isoOrNull(t.until),
      since: isoOrNull(t.since),
      by: typeof t.by === 'string' ? cleanText(t.by, 80) || null : null,
    };
  }
  const bypass = Array.from(new Set((Array.isArray(r.bypass) ? r.bypass : []).map(normalizeEmail).filter((e): e is string => !!e))).slice(0, LIMITS.bypass);
  const log: ToolsLogEntry[] = (Array.isArray(r.log) ? r.log : [])
    .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
    .map((e) => {
      const entry: ToolsLogEntry = {
        at: isoOrNull(e.at) ?? new Date(0).toISOString(),
        by: cleanText(e.by, 80) || 'admin',
        action: ACTIONS.includes(e.action as ToolsLogAction) ? (e.action as ToolsLogAction) : 'edit',
      };
      if (isToolPath(e.path)) entry.path = e.path;
      if (typeof e.detail === 'string' && e.detail) entry.detail = cleanText(e.detail, 200);
      return entry;
    })
    .slice(0, LIMITS.log);
  return {
    v: 1,
    rev: typeof r.rev === 'number' && Number.isFinite(r.rev) && r.rev >= 0 ? Math.floor(r.rev) : 0,
    tools,
    bypass,
    log,
    updatedAt: isoOrNull(r.updatedAt),
  };
}

/* ───────────────────────── Leitura ───────────────────────── */

type Live = Record<string, { message: string; until: string | null }>;

/** Manutenção valendo AGORA (prazo vencido = já voltou ao ar sozinha). */
export function activeMaintenance(cfg: ToolsConfig, now = Date.now()): Live {
  const out: Live = {};
  for (const [path, t] of Object.entries(cfg.tools)) {
    if (!t.maintenance) continue;
    if (t.until && Date.parse(t.until) <= now) continue;
    out[path] = { message: t.message, until: t.until };
  }
  return out;
}

type Source = ToolsConfig | MaintenanceSnapshot | null | undefined;

function liveMap(src: Source, now: number): Live {
  if (!src) {
    const m: Live = {};
    for (const p of DEFAULT_MAINTENANCE_TOOLS) m[p] = { message: '', until: null };
    return m;
  }
  if ('v' in src) return activeMaintenance(src, now);
  // retrato do cliente: o prazo também vence sozinho no navegador
  const m: Live = {};
  for (const [p, t] of Object.entries(src.tools)) if (!t.until || Date.parse(t.until) > now) m[p] = t;
  return m;
}

/** Manutenção do path (ou de um sub-path dele): o recado, ou null se está no ar. */
export function maintenanceOf(path: string, src?: Source, now = Date.now()): { message: string; until: string | null } | null {
  if (!path) return null;
  const map = liveMap(src, now);
  for (const [p, info] of Object.entries(map)) {
    if (path === p || path.startsWith(p + '/')) return info;
  }
  return null;
}

/** True se o path (ou um sub-path dele) está em manutenção. Sem `src` = estado padrão. */
export function isToolInMaintenance(path: string, src?: Source, now = Date.now()): boolean {
  return maintenanceOf(path, src, now) !== null;
}

/* ───────────────────────── Quem fura ───────────────────────── */

/**
 * Emails que FURAM a manutenção (além do admin) — clientes de confiança.
 * Três fontes somadas: fixos no código, env da Vercel e a lista do painel.
 *   • NEXT_PUBLIC_MAINTENANCE_BYPASS_EMAILS  (vale no client + server)
 *   • MAINTENANCE_BYPASS_EMAILS              (só server, extra)
 */
function parseEmails(v?: string | null): string[] {
  if (!v) return [];
  return v
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

// Clientes de confiança fixos (sempre liberados).
export const MAINTENANCE_BYPASS_BASE: readonly string[] = [
  'elderemanoel.13@gmail.com', // Elder Manoel — cliente PRO de confiança
];

/** Fixos no código + env: aparecem no painel com cadeado (não dá pra tirar por lá). */
export function fixedBypassEmails(): string[] {
  return Array.from(
    new Set<string>([
      ...MAINTENANCE_BYPASS_BASE.map((e) => e.toLowerCase()),
      ...parseEmails(process.env.NEXT_PUBLIC_MAINTENANCE_BYPASS_EMAILS),
      ...parseEmails(process.env.MAINTENANCE_BYPASS_EMAILS),
    ]),
  );
}

/** True se o email pode acessar ferramentas em manutenção (cliente liberado). */
export function canBypassMaintenance(email?: string | null, cfg?: ToolsConfig | null): boolean {
  if (!email) return false;
  const e = email.trim().toLowerCase();
  if (fixedBypassEmails().includes(e)) return true;
  return !!cfg && cfg.bypass.includes(e);
}

export function toSnapshot(cfg: ToolsConfig, canBypass: boolean, now = Date.now()): MaintenanceSnapshot {
  return { tools: activeMaintenance(cfg, now), canBypass, rev: cfg.rev };
}

/* ───────────────────────── Mudanças (painel) ───────────────────────── */

export type ToolChange =
  | { kind: 'set'; path: string; maintenance: boolean; message?: unknown; until?: unknown }
  | { kind: 'all'; maintenance: boolean; paths: string[]; message?: unknown; until?: unknown }
  | { kind: 'bypass'; emails: unknown };

export type ChangeResult = { ok: true; cfg: ToolsConfig; changed: boolean; summary: string } | { ok: false; error: string };

/** Prazo de volta: futuro e até 30 dias; vazio = sem previsão; undefined = inválido. */
export function cleanUntil(raw: unknown, now = Date.now()): string | null | undefined {
  if (raw == null || raw === '') return null;
  if (typeof raw !== 'string') return undefined;
  const t = Date.parse(raw);
  if (!Number.isFinite(t) || t <= now + 30_000 || t > now + LIMITS.untilDays * 86_400_000) return undefined;
  return new Date(t).toISOString();
}

function withLog(cfg: ToolsConfig, entries: ToolsLogEntry[], at: string): ToolsConfig {
  return { ...cfg, rev: cfg.rev + 1, updatedAt: at, log: [...entries, ...cfg.log].slice(0, LIMITS.log) };
}

function liveOne(cfg: ToolsConfig, path: string, now: number): boolean {
  const t = cfg.tools[path];
  return !!t && t.maintenance && (!t.until || Date.parse(t.until) > now);
}

/**
 * Aplica uma mudança do painel e devolve o arquivo novo (puro: o servidor
 * grava, o teste confere). `label` dá nome humano pro resumo.
 */
export function applyToolChange(
  cfg: ToolsConfig,
  change: ToolChange,
  by: string,
  label: (path: string) => string = (p) => p,
  now = Date.now(),
): ChangeResult {
  const at = new Date(now).toISOString();
  const who = cleanText(by, 80) || 'admin';

  if (change.kind === 'bypass') {
    const raw = Array.isArray(change.emails) ? change.emails : [];
    const emails = Array.from(new Set(raw.map(normalizeEmail).filter((e): e is string => !!e)));
    if (emails.length > LIMITS.bypass) return { ok: false, error: `No máximo ${LIMITS.bypass} contas liberadas.` };
    const added = emails.filter((e) => !cfg.bypass.includes(e));
    const removed = cfg.bypass.filter((e) => !emails.includes(e));
    if (!added.length && !removed.length) return { ok: true, cfg, changed: false, summary: 'Nada mudou.' };
    const parts = [added.length ? `liberou ${added.join(', ')}` : '', removed.length ? `tirou ${removed.join(', ')}` : ''].filter(Boolean);
    const detail = parts.join(' · ');
    return { ok: true, changed: true, cfg: withLog({ ...cfg, bypass: emails }, [{ at, by: who, action: 'bypass', detail }], at), summary: 'Lista de contas liberadas salva.' };
  }

  const message = cleanText(change.message, LIMITS.message);
  const until = change.maintenance ? cleanUntil(change.until, now) : null;
  if (until === undefined) return { ok: false, error: `A previsão de volta precisa ser no futuro (até ${LIMITS.untilDays} dias).` };

  if (change.kind === 'all') {
    const paths = Array.from(new Set((Array.isArray(change.paths) ? change.paths : []).filter(isToolPath)));
    if (!paths.length) return { ok: false, error: 'Nenhuma ferramenta escolhida.' };
    const tools = { ...cfg.tools };
    let n = 0;
    for (const p of paths) {
      const cur = tools[p];
      if (change.maintenance) {
        if (liveOne(cfg, p, now)) continue;
        tools[p] = { maintenance: true, message, until, since: at, by: who };
        n++;
      } else {
        if (!cur?.maintenance) continue;
        tools[p] = { ...cur, maintenance: false, until: null };
        n++;
      }
    }
    if (!n) return { ok: true, cfg, changed: false, summary: 'Nada mudou.' };
    const detail = `${n} ${n === 1 ? 'ferramenta' : 'ferramentas'}`;
    return {
      ok: true,
      changed: true,
      cfg: withLog({ ...cfg, tools }, [{ at, by: who, action: change.maintenance ? 'all_on' : 'all_off', detail }], at),
      summary: change.maintenance ? `${detail} em manutenção.` : `${detail} de volta ao ar.`,
    };
  }

  if (!isToolPath(change.path)) return { ok: false, error: 'Ferramenta inválida.' };
  const cur = cfg.tools[change.path];
  const wasLive = liveOne(cfg, change.path, now);
  const name = label(change.path);

  if (!change.maintenance) {
    if (!cur?.maintenance) return { ok: true, cfg, changed: false, summary: `${name} já está no ar.` };
    const tools = { ...cfg.tools, [change.path]: { ...cur, maintenance: false, until: null } };
    return { ok: true, changed: true, cfg: withLog({ ...cfg, tools }, [{ at, by: who, action: 'off', path: change.path }], at), summary: `${name} voltou ao ar.` };
  }

  // Já estava em manutenção: só troca recado/previsão (mantém o "desde").
  if (wasLive && cur && cur.message === message && cur.until === until) {
    return { ok: true, cfg, changed: false, summary: 'Nada mudou.' };
  }
  const tools = {
    ...cfg.tools,
    [change.path]: {
      maintenance: true,
      message,
      until,
      since: wasLive && cur?.since ? cur.since : at,
      by: wasLive && cur?.by ? cur.by : who,
    },
  };
  const entry: ToolsLogEntry = { at, by: who, action: wasLive ? 'edit' : 'on', path: change.path };
  if (message) entry.detail = message;
  return {
    ok: true,
    changed: true,
    cfg: withLog({ ...cfg, tools }, [entry], at),
    summary: wasLive ? `Aviso de ${name} atualizado.` : `${name} em manutenção.`,
  };
}

/* ───────────────────────── Texto ───────────────────────── */

const TZ = 'America/Sao_Paulo';
const fHour = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const fDay = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit' });
const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

/** "hoje às 18:00", "amanhã às 09:30", "12/10 às 14:00". */
export function whenLabel(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  const d = dayKey.format(new Date(t));
  if (d === dayKey.format(new Date(now))) return `hoje às ${fHour.format(t)}`;
  if (d === dayKey.format(new Date(now + 86_400_000))) return `amanhã às ${fHour.format(t)}`;
  return `${fDay.format(t)} às ${fHour.format(t)}`;
}
