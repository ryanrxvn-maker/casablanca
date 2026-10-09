/**
 * Envio de e-mail dos avisos (servidor). Quem chama: /api/admin/announcements
 * (ativar, mostrar de novo, ligar o e-mail de um aviso no ar, modelo "E-mail",
 * "Tentar o resto" e "Enviar teste pra mim").
 *
 *   • público = mesma regra da janela (viewerFromProfile + matchesAudience);
 *   • 1 e-mail por pessoa, com "Oi, Nome" e o link de saída DELA;
 *   • lotes de 100 no Resend com chave de idempotência `ann-<id>-<ativação>-<n>`:
 *     repetir o envio da mesma ativação (clique duplo, "Tentar o resto") não
 *     duplica e-mail — o Resend devolve o lote já enviado;
 *   • limite de taxa (429) → espera e tenta de novo; cota do plano acabou →
 *     para limpo e registra quanto faltou (o "Tentar o resto" continua dali).
 */

import { classifyAccess } from '@/app/api/admin/_classify';
import type { serviceClient } from '@/app/api/admin/_helpers';
import { staticUnlocksForEmail, UNLOCKABLE_TOOLS } from '@/lib/tool-unlocks';
import type { AnnContent, AnnKind, Audience, MailLog, MailReason, Viewer } from './announcements';
import { batchKey, emailFromAnnouncement, firstName, pickRecipients, type Person, type Recipient } from './announcement-email';
import { renderEmail } from './email-templates';
import { TEST_OPTOUT_ID, optoutUrl } from './email-optout';

type Svc = ReturnType<typeof serviceClient>;

const CATALOG = new Set(UNLOCKABLE_TOOLS.map((t) => t.path));
export const MAIL_BATCH = 100;
const GAP_MS = 550; // o Resend aceita ~2 chamadas/s
const BUDGET_MS = 48_000; // sobra folga no maxDuration da rota (60 s)

export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || 'https://www.darkoautoedit.com').replace(/\/$/, '');
}

function fromAddress(): string {
  return process.env.ANNOUNCE_FROM || process.env.NOTIFY_FROM || 'Auto Edit <naoresponda@darkoautoedit.com>';
}

/* ───────────────────────── Quem é cada conta ───────────────────────── */

export type ProfileForViewer = {
  id: string;
  is_admin?: boolean | null;
  is_active?: boolean | null;
  tier?: string | null;
  subscription_status?: string | null;
  current_period_end?: string | null;
  tool_unlocks?: string[] | null;
};

/** O MESMO cálculo da janela/sino (plano, acesso, beta) — usado pelos dois lados. */
export function viewerFromProfile(p: ProfileForViewer, email: string | null): Viewer {
  const { plan, access } = classifyAccess(p);
  const unlocks = [...(Array.isArray(p.tool_unlocks) ? p.tool_unlocks : []), ...staticUnlocksForEmail(email)];
  return {
    id: p.id,
    email,
    isAdmin: p.is_admin === true,
    isActive: p.is_active === true,
    plan,
    access,
    beta: unlocks.some((u) => CATALOG.has(u)),
  };
}

const PEOPLE_FULL = 'id, email, name, created_at, is_admin, is_active, tier, subscription_status, current_period_end, tool_unlocks';
const PEOPLE_MID = 'id, email, name, created_at, is_admin, is_active, tier, subscription_status, current_period_end';

async function loadPeople(svc: Svc): Promise<Person[]> {
  const out: Person[] = [];
  let cols = PEOPLE_FULL;
  for (let from = 0; from < 200_000; from += 1000) {
    let res = await svc.from('profiles').select(cols).order('created_at', { ascending: true }).range(from, from + 999);
    // Mesma cascata do middleware: sem a coluna de desbloqueio (028), segue sem ela.
    if (res.error && cols === PEOPLE_FULL) {
      cols = PEOPLE_MID;
      res = await svc.from('profiles').select(cols).order('created_at', { ascending: true }).range(from, from + 999);
    }
    if (res.error) throw new Error(`profiles: ${res.error.message}`);
    const rows = (res.data ?? []) as unknown as Array<ProfileForViewer & { email: string | null; name: string | null; created_at: string }>;
    for (const p of rows) out.push({ viewer: viewerFromProfile(p, p.email), name: p.name, createdAt: p.created_at });
    if (rows.length < 1000) break;
  }
  return out;
}

/** Contas que clicaram em "não quero mais receber" (app_metadata.email_optout). */
async function loadOptOuts(svc: Svc): Promise<Set<string>> {
  const out = new Set<string>();
  for (let page = 1; page <= 200; page++) {
    const { data, error } = await svc.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`auth: ${error.message}`);
    const users = data?.users ?? [];
    for (const u of users) if ((u.app_metadata as Record<string, unknown> | undefined)?.email_optout === true) out.add(u.id);
    if (users.length < 1000) break;
  }
  return out;
}

export async function listRecipients(svc: Svc, audience: Audience): Promise<{ list: Recipient[]; optOut: number }> {
  const [people, optOut] = await Promise.all([loadPeople(svc), loadOptOuts(svc)]);
  return pickRecipients(people, audience, optOut);
}

/* ───────────────────────── Resend ───────────────────────── */

type BatchResult = { ok: true } | { ok: false; reason: MailReason | 'retry'; message: string; waitMs?: number; already?: boolean };

async function postBatch(key: string, payload: unknown[], idem: string | null): Promise<BatchResult> {
  let res: Response;
  try {
    res = await fetch('https://api.resend.com/emails/batch', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'content-type': 'application/json',
        ...(idem ? { 'Idempotency-Key': idem } : {}),
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return { ok: false, reason: 'retry', message: (e as Error).message || 'rede', waitMs: 1500 };
  }
  if (res.ok) return { ok: true };
  const j = (await res.json().catch(() => ({}))) as { name?: string; message?: string };
  const name = j.name ?? '';
  const message = (j.message || `HTTP ${res.status}`).slice(0, 240);
  if (res.status === 409 && name === 'invalid_idempotent_request') return { ok: false, reason: 'erro', message, already: true };
  if (res.status === 409) return { ok: false, reason: 'retry', message, waitMs: 1200 };
  if (res.status === 429 && /quota/i.test(name + message)) return { ok: false, reason: 'quota', message };
  if (res.status === 429) {
    const after = Number(res.headers.get('retry-after'));
    return { ok: false, reason: 'retry', message, waitMs: Number.isFinite(after) && after > 0 ? after * 1000 : 1200 };
  }
  if (res.status >= 500) return { ok: false, reason: 'retry', message, waitMs: 2000 };
  return { ok: false, reason: 'erro', message };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type MailJob = {
  id: string;
  kind: AnnKind;
  content: AnnContent;
  endsAt: string | null;
  /** activated_at da ativação que este envio cobre */
  activatedAt: string;
  audience: Audience;
};

/**
 * Envia (ou continua) o e-mail de uma ativação. Devolve o registro pra gravar
 * no audience.mailLog. `test` = só pro admin, com "[Teste]" e sem idempotência.
 */
export async function deliverMail(svc: Svc, job: MailJob, opts: { test?: { email: string; name: string | null } } = {}): Promise<MailLog> {
  const at = new Date().toISOString();
  const base: MailLog = { for: job.activatedAt, total: 0, sent: 0, failed: 0, optOut: 0, reason: null, message: null, at, done: true };
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ...base, reason: 'sem_chave', message: 'RESEND_API_KEY não está configurada.' };

  const site = siteUrl();
  const msg = emailFromAnnouncement({ kind: job.kind, content: job.content, endsAt: job.endsAt }, site);
  let recipients: Recipient[];
  if (opts.test) {
    recipients = [{ id: TEST_OPTOUT_ID, email: opts.test.email, name: opts.test.name }];
  } else {
    const r = await listRecipients(svc, job.audience);
    recipients = r.list;
    base.optOut = r.optOut;
  }
  base.total = recipients.length;
  if (!recipients.length) return { ...base, reason: 'sem_destinatario', message: 'Ninguém do público tem e-mail pra receber.' };

  const from = fromAddress();
  const started = Date.now();
  for (let i = 0; i * MAIL_BATCH < recipients.length; i++) {
    if (Date.now() - started > BUDGET_MS) {
      return { ...base, done: false, message: 'Passou do tempo de uma chamada: use "Tentar o resto" pra continuar (não duplica).' };
    }
    const slice = recipients.slice(i * MAIL_BATCH, (i + 1) * MAIL_BATCH);
    const payload = slice.map((r) => {
      const unsubscribe = optoutUrl(site, r.id);
      const { html, text } = renderEmail(msg, { siteUrl: site, unsubscribeUrl: unsubscribe, firstName: firstName(r.name) });
      return {
        from,
        to: [r.email],
        subject: opts.test ? `[Teste] ${msg.subject}` : msg.subject,
        html,
        text,
        headers: {
          'List-Unsubscribe': `<${unsubscribe}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      };
    });
    const idem = opts.test ? null : batchKey(job.id, job.activatedAt, i);
    let result: BatchResult = { ok: false, reason: 'retry', message: '' };
    for (let attempt = 0; attempt < 4; attempt++) {
      result = await postBatch(key, payload, idem);
      if (result.ok || result.reason !== 'retry') break;
      await sleep(result.waitMs ?? 1200);
    }
    if (result.ok || (!result.ok && result.already)) {
      base.sent += slice.length;
    } else if (result.reason === 'quota') {
      base.failed += recipients.length - i * MAIL_BATCH;
      return { ...base, reason: 'quota', message: `Acabou a cota do plano do Resend: ${result.message}` };
    } else {
      base.failed += slice.length;
      base.reason = 'erro';
      base.message = result.message || 'Falha no envio.';
    }
    if ((i + 1) * MAIL_BATCH < recipients.length) await sleep(GAP_MS);
  }
  return base;
}
