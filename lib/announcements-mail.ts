/**
 * Envio de e-mail dos avisos (servidor). Quem chama: /api/admin/announcements
 * (ativar, mostrar de novo, ligar o e-mail de um aviso no ar, modelo "E-mail",
 * "Tentar o resto" e "Enviar teste pra mim").
 *
 *   • público = mesma regra da janela (viewerFromProfile + matchesAudience);
 *   • 1 e-mail por pessoa, com "Oi, Nome" e o link de saída DELA;
 *   • fila em ordem de cadastro + MARCADOR (mailLog.cursor) de até quem já
 *     foi: "Tentar o resto" continua dali, mesmo dias depois, sem repetir;
 *   • lotes de até 100 com chave de idempotência por aviso+ativação+quem está
 *     no lote: clique duplo / duas abas não duplicam (vale 24 h no Resend);
 *   • cota lida nos cabeçalhos: no plano grátis (100/dia, a MESMA cota dos
 *     códigos de cadastro) para guardando a reserva do dia;
 *   • limite de taxa (429) → espera e tenta de novo; cota acabou ou erro →
 *     para limpo e registra quanto faltou.
 */

import { classifyAccess } from '@/app/api/admin/_classify';
import type { serviceClient } from '@/app/api/admin/_helpers';
import { staticUnlocksForEmail, UNLOCKABLE_TOOLS } from '@/lib/tool-unlocks';
import type { AnnContent, AnnKind, Audience, MailLog, MailQuota, MailReason, Viewer } from './announcements';
import {
  afterCursor,
  batchKey,
  emailFromAnnouncement,
  firstName,
  FREE_DAILY,
  FREE_RESERVE,
  nextBatchSize,
  pickRecipients,
  roomToday,
  type Person,
  type Recipient,
} from './announcement-email';
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

type BatchResult = ({ ok: true } | { ok: false; reason: MailReason | 'retry'; message: string; waitMs?: number; already?: boolean }) & { quota?: MailQuota | null };

/** x-resend-daily-quota / x-resend-monthly-quota = JÁ usados (o diário só existe no plano grátis). */
function quotaFrom(res: Response): MailQuota | null {
  const num = (h: string) => {
    const v = res.headers.get(h);
    const n = v === null || v.trim() === '' ? NaN : Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
  };
  const daily = num('x-resend-daily-quota');
  const monthly = num('x-resend-monthly-quota');
  return daily === null && monthly === null ? null : { daily, monthly, at: new Date().toISOString() };
}

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
  const quota = quotaFrom(res);
  if (res.ok) return { ok: true, quota };
  const j = (await res.json().catch(() => ({}))) as { name?: string; message?: string };
  const name = j.name ?? '';
  const message = (j.message || `HTTP ${res.status}`).slice(0, 240);
  // mesma chave, corpo diferente = esse lote JÁ saiu (com o texto de antes)
  if (res.status === 409 && name === 'invalid_idempotent_request') return { ok: false, reason: 'erro', message, already: true, quota };
  if (res.status === 409) return { ok: false, reason: 'retry', message, waitMs: 1200 };
  if (res.status === 429 && /quota/i.test(name + message)) return { ok: false, reason: 'quota', message, quota };
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

/** Frase da parada por reserva do plano grátis (o painel mostra igual). */
export function reserveMessage(quota: MailQuota | null): string {
  const used = quota?.daily ?? 0;
  return `Plano grátis do Resend: ${used} de ${FREE_DAILY} e-mails do dia já usados. Parei guardando ${FREE_RESERVE} pros códigos de cadastro e senha; a cota volta às 21h (Brasília).`;
}

/**
 * Envia (ou continua) o e-mail de uma ativação. Devolve o registro pra gravar
 * no audience.mailLog.
 *   • `prev` da MESMA ativação → continua DEPOIS do marcador (nunca repete
 *     quem já recebeu, mesmo dias depois);
 *   • o 1º lote de cada rodada leva 1 pessoa: lê a cota nos cabeçalhos antes
 *     de mandar em massa; no plano grátis para guardando a reserva do dia;
 *   • lote com erro PARA a rodada sem avançar o marcador ("Tentar o resto"
 *     tenta de novo dali — nada se perde calado);
 *   • `test` = só pro admin, com "[Teste]" e sem idempotência.
 */
export async function deliverMail(
  svc: Svc,
  job: MailJob,
  opts: { test?: { email: string; name: string | null }; prev?: MailLog | null } = {},
): Promise<MailLog> {
  const at = new Date().toISOString();
  const prev = !opts.test && opts.prev?.for && Date.parse(opts.prev.for) === Date.parse(job.activatedAt) ? opts.prev : null;
  const base: MailLog = {
    for: job.activatedAt,
    total: 0,
    sent: prev?.sent ?? 0,
    failed: 0,
    optOut: 0,
    reason: null,
    message: null,
    at,
    done: true,
    cursor: prev?.cursor ?? null,
    quota: prev?.quota ?? null,
  };
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ...base, reason: 'sem_chave', message: 'RESEND_API_KEY não está configurada.' };

  const site = siteUrl();
  const msg = emailFromAnnouncement({ kind: job.kind, content: job.content, endsAt: job.endsAt }, site);
  let recipients: Recipient[];
  if (opts.test) {
    recipients = [{ id: TEST_OPTOUT_ID, email: opts.test.email, name: opts.test.name, key: '' }];
  } else {
    const r = await listRecipients(svc, job.audience);
    recipients = afterCursor(r.list, base.cursor);
    base.optOut = r.optOut;
  }
  base.total = base.sent + recipients.length;
  if (!recipients.length) {
    // retomada de algo que já tinha ido inteiro: fecha sem erro
    return base.sent ? base : { ...base, reason: 'sem_destinatario', message: 'Ninguém do público tem e-mail pra receber.' };
  }

  const from = fromAddress();
  const started = Date.now();
  let probed = false;
  let pos = 0;
  while (pos < recipients.length) {
    if (Date.now() - started > BUDGET_MS) {
      return { ...base, done: false, message: 'Passou do tempo de uma chamada: use "Tentar o resto" pra continuar (não duplica).' };
    }
    // a cota guardada de outra rodada pode ser de ontem: só vale depois da sonda
    const size = nextBatchSize(probed, probed ? roomToday(base.quota) : Infinity, MAIL_BATCH);
    if (size === 0) {
      base.failed = recipients.length - pos;
      return { ...base, reason: 'quota', message: reserveMessage(base.quota) };
    }
    const slice = recipients.slice(pos, pos + size);
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
    const idem = opts.test ? null : batchKey(job.id, job.activatedAt, slice);
    let result: BatchResult = { ok: false, reason: 'retry', message: '' };
    for (let attempt = 0; attempt < 4; attempt++) {
      result = await postBatch(key, payload, idem);
      if (result.quota) base.quota = result.quota;
      if (result.ok || result.reason !== 'retry') break;
      await sleep(result.waitMs ?? 1200);
    }
    probed = true;
    if (result.ok || (!result.ok && result.already)) {
      base.sent += slice.length;
      base.cursor = slice[slice.length - 1].key || base.cursor;
    } else if (result.reason === 'quota') {
      base.failed = recipients.length - pos;
      return { ...base, reason: 'quota', message: base.quota?.daily != null ? reserveMessage(base.quota) : `Acabou a cota do plano do Resend: ${result.message}` };
    } else {
      base.failed = recipients.length - pos;
      return { ...base, reason: 'erro', message: result.message || 'Falha no envio.' };
    }
    pos += slice.length;
    if (pos < recipients.length) await sleep(GAP_MS);
  }
  return base;
}
