import {
  cleanAudience,
  isLive,
  readContent,
  readMailLog,
  type AdminAnnouncement,
  type AnnKind,
  type AnnStats,
  type Audience,
  type MailLog,
} from './announcements';

/**
 * Peças de servidor dos avisos: leitura das linhas do banco sem confiar no
 * formato e detecção de "migration 038 ainda não rodou" (aí tudo responde
 * vazio e o painel avisa, em vez de quebrar a tela de todo cliente).
 */

export type AnnRow = {
  id: string;
  kind: string;
  content: unknown;
  audience: unknown;
  popup: boolean | null;
  active: boolean | null;
  activated_at: string | null;
  ends_at: string | null;
  created_at: string;
  updated_at: string;
};

export type InboxRow = {
  announcement_id: string;
  delivered_at: string;
  read_at: string | null;
  dismissed_keys: string[] | null;
  clicked_at: string | null;
  deleted_at: string | null;
};

export const ANN_COLUMNS = 'id, kind, content, audience, popup, active, activated_at, ends_at, created_at, updated_at';
export const INBOX_COLUMNS = 'announcement_id, delivered_at, read_at, dismissed_keys, clicked_at, deleted_at';

type PgErr = { code?: string; message?: string } | null | undefined;

/** Tabela/função da 038 ausente (ou o cache do PostgREST ainda sem ela). */
export function isMissingSchema(err: PgErr): boolean {
  if (!err) return false;
  if (err.code === '42P01' || err.code === '42883' || err.code === 'PGRST205' || err.code === 'PGRST202') return true;
  return /does not exist|could not find the (table|function)|schema cache/i.test(err.message ?? '');
}

/** Data do Postgres (microssegundos, "+00:00") → ISO de 3 casas, que todo
 *  navegador lê igual (Safari antigo tropeça no formato longo). */
export function iso(v: string | null | undefined): string | null {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

export function asKind(k: unknown): AnnKind {
  return k === 'propaganda' ? 'propaganda' : 'aviso';
}

const ZERO: AnnStats = { delivered: 0, read: 0, clicked: 0, dismissed: 0, deleted: 0 };

export function toAdminAnnouncement(r: AnnRow, stats?: AnnStats, now = Date.now()): AdminAnnouncement {
  const kind = asKind(r.kind);
  return {
    id: r.id,
    kind,
    content: readContent(kind, r.content),
    audience: cleanAudience(r.audience),
    popup: r.popup !== false,
    active: r.active === true,
    live: isLive({ active: r.active === true, ends_at: r.ends_at }, now),
    activatedAt: iso(r.activated_at),
    endsAt: iso(r.ends_at),
    createdAt: iso(r.created_at) ?? r.created_at,
    updatedAt: iso(r.updated_at) ?? r.updated_at,
    stats: stats ?? ZERO,
    mail: rawMailLog(r.audience),
  };
}

/**
 * O registro do envio de e-mail mora no próprio `audience` (jsonb, sem
 * migration nova) como `mailLog`. Só o servidor escreve: o cleanAudience
 * descarta o campo vindo do painel, e quem grava público reanexa o atual.
 */
export function rawMailLog(audience: unknown): MailLog | null {
  if (!audience || typeof audience !== 'object') return null;
  return readMailLog((audience as Record<string, unknown>).mailLog);
}

export function audienceForDb(clean: Audience, mail: MailLog | null): Record<string, unknown> {
  return mail ? { ...clean, mailLog: mail } : { ...clean };
}

export function toStats(r: Record<string, unknown>): AnnStats {
  const n = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0);
  return { delivered: n(r.delivered), read: n(r.read), clicked: n(r.clicked), dismissed: n(r.dismissed), deleted: n(r.deleted) };
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
