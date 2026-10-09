import { NextResponse } from 'next/server';
import { jsonError, requireAdmin, serviceClient } from '../_helpers';
import {
  audienceIsEmpty,
  cleanAudience,
  cleanContent,
  cleanEndsAt,
  emailModeOf,
  mailDoneFor,
  seenFromInbox,
  type AnnKind,
  type AnnStats,
  type InboxSeenRow,
  type MailLog,
  type SeenRow,
} from '@/lib/announcements';
import {
  ANN_COLUMNS,
  audienceForDb,
  isMissingSchema,
  rawMailLog,
  toAdminAnnouncement,
  toStats,
  UUID_RE,
  type AnnRow,
} from '@/lib/announcements-server';
import { deliverMail } from '@/lib/announcements-mail';

/**
 * /api/admin/announcements — central de avisos do painel.
 *
 * GET     lista (mais novos primeiro) com os números de cada um
 *         ?views=<id>  "Quem viu": cada conta que recebeu, com a hora de cada
 *                      login em que viu, primeira/última vez, clique e se apagou
 * POST   cria   { kind, content, audience, popup, active, endsAt }
 * PATCH   muda   { id, action: 'update' | 'activate' | 'pause' | 'republish', ... }
 *           update aceita content/audience/popup/endsAt e `republish: true`
 *           (abre a janela de novo pra quem já tinha fechado)
 * DELETE  ?id=   apaga de vez (some também do histórico de quem recebeu)
 *
 * Tudo validado aqui com a MESMA função do painel (lib/announcements.ts):
 * link só /caminho ou https, texto limpo, audiência conhecida.
 * Sem a migration 038: GET responde `enabled: false`, escrita responde 503.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// envio de e-mail roda dentro da ativação (lotes de 100 no Resend)
export const maxDuration = 60;

const NEEDS_DB = 'A tabela de avisos ainda não existe no banco: rode a migration 038_announcements.sql no Supabase.';

function kindOf(v: unknown): AnnKind | null {
  return v === 'aviso' || v === 'propaganda' ? v : null;
}

async function readOne(svc: ReturnType<typeof serviceClient>, id: string) {
  const res = await svc.from('announcements').select(ANN_COLUMNS).eq('id', id).maybeSingle();
  return { row: (res.data ?? null) as AnnRow | null, error: res.error };
}

/* ───────────────────────── E-mail ─────────────────────────
   Regra do pedido (09.10): com o envelope ligado o e-mail sai UMA vez por
   ATIVAÇÃO — a janela continua abrindo a cada login. Desativar e ativar (ou
   "mostrar de novo pra todos") = ativação nova = e-mail de novo. Pausado não
   manda. O resultado fica em audience.mailLog (sem migration). */

/** Grava só o registro do envio, relendo o público atual (não atropela edição). */
async function writeMailLog(svc: ReturnType<typeof serviceClient>, id: string, log: MailLog): Promise<AnnRow | null> {
  const cur = await readOne(svc, id);
  if (!cur.row) return null;
  const aud = cur.row.audience && typeof cur.row.audience === 'object' ? { ...(cur.row.audience as Record<string, unknown>) } : {};
  const up = await svc.from('announcements').update({ audience: { ...aud, mailLog: log } }).eq('id', id).select(ANN_COLUMNS).single();
  return up.error ? null : (up.data as unknown as AnnRow);
}

/** Manda o e-mail desta ativação se ainda não saiu (force = "Tentar o resto"). */
async function mailIfDue(svc: ReturnType<typeof serviceClient>, row: AnnRow, force = false): Promise<AnnRow> {
  const mode = emailModeOf(row.audience as { email?: unknown });
  if (mode === 'off' || !row.activated_at) return row;
  if (mode === 'also' && !row.active) return row;
  if (!force && mailDoneFor(rawMailLog(row.audience), row.activated_at)) return row;
  const a = toAdminAnnouncement(row);
  const log = await deliverMail(svc, { id: row.id, kind: a.kind, content: a.content, endsAt: a.endsAt, activatedAt: row.activated_at, audience: a.audience });
  return (await writeMailLog(svc, row.id, log)) ?? row;
}

/** E-mail e nome do admin logado (pro "Enviar teste pra mim"). */
async function adminContact(svc: ReturnType<typeof serviceClient>, userId: string): Promise<{ email: string; name: string | null } | null> {
  if (!UUID_RE.test(userId)) return null;
  const { data } = await svc.auth.admin.getUserById(userId);
  const email = data?.user?.email;
  if (!email) return null;
  const prof = await svc.from('profiles').select('name').eq('id', userId).maybeSingle();
  return { email, name: (prof.data as { name?: string | null } | null)?.name ?? null };
}

const SEEN_COLUMNS = 'user_id, delivered_at, read_at, dismissed_at, dismissed_keys, clicked_at, deleted_at';
const SEEN_PAGE = 1000; // teto de linhas por consulta da API do Supabase

/** "Quem viu" de UM aviso: a caixa de cada conta, em páginas (sem o teto de 1000). */
async function seenList(svc: ReturnType<typeof serviceClient>, id: string) {
  if (!UUID_RE.test(id)) return jsonError('Aviso inválido.', 400);
  const one = await readOne(svc, id);
  if (isMissingSchema(one.error)) return NextResponse.json({ enabled: false, rows: [] });
  if (one.error) return jsonError('Falha ao ler o aviso.', 500, one.error.message);
  if (!one.row) return jsonError('Esse aviso não existe mais.', 404);
  const rows: SeenRow[] = [];
  for (let from = 0; from < 50 * SEEN_PAGE; from += SEEN_PAGE) {
    const res = await svc
      .from('announcement_inbox')
      .select(SEEN_COLUMNS)
      .eq('announcement_id', id)
      .order('delivered_at', { ascending: true })
      .range(from, from + SEEN_PAGE - 1);
    if (res.error) return jsonError('Falha ao ler quem recebeu.', 500, res.error.message);
    const page = (res.data ?? []) as unknown as Array<InboxSeenRow & { user_id: string }>;
    for (const r of page) rows.push(seenFromInbox(r.user_id, r, one.row.activated_at));
    if (page.length < SEEN_PAGE) break;
  }
  // Nome/e-mail de quem recebeu: a lista de clientes do painel não traz admin
  // (e o aviso pode ir pra admins). Em lotes pra URL do .in() não estourar.
  const people: Array<{ id: string; email: string | null; name: string | null; isAdmin: boolean }> = [];
  const ids = rows.map((r) => r.userId);
  for (let i = 0; i < ids.length; i += 200) {
    const res = await svc.from('profiles').select('id, email, name, is_admin').in('id', ids.slice(i, i + 200));
    if (res.error) break; // sem nome ainda mostra a conta (pelo id); não derruba a tela
    for (const p of (res.data ?? []) as Array<{ id: string; email: string | null; name: string | null; is_admin: boolean | null }>) {
      people.push({ id: p.id, email: p.email, name: p.name, isAdmin: p.is_admin === true });
    }
  }
  return NextResponse.json(
    { enabled: true, activatedAt: one.row.activated_at, popup: one.row.popup !== false, rows, people },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function GET(req: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  try {
    const svc = serviceClient();
    const viewsId = new URL(req.url).searchParams.get('views');
    if (viewsId !== null) return await seenList(svc, viewsId);
    const [list, stats] = await Promise.all([
      svc.from('announcements').select(ANN_COLUMNS).order('created_at', { ascending: false }).limit(200),
      svc.rpc('announcement_stats'),
    ]);
    if (isMissingSchema(list.error)) return NextResponse.json({ enabled: false, items: [] });
    if (list.error) return jsonError('Falha ao listar os avisos.', 500, list.error.message);
    const byId = new Map<string, AnnStats>();
    if (!stats.error) {
      for (const r of (stats.data ?? []) as Array<Record<string, unknown>>) byId.set(String(r.announcement_id), toStats(r));
    }
    const now = Date.now();
    const items = ((list.data ?? []) as unknown as AnnRow[]).map((r) => toAdminAnnouncement(r, byId.get(r.id), now));
    return NextResponse.json({ enabled: true, items }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return jsonError('Erro inesperado.', 500, e instanceof Error ? e.message : String(e));
  }
}

export async function POST(req: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const kind = kindOf(body.kind);
    if (!kind) return jsonError('Escolha o modelo (aviso ou propaganda).', 400);
    const content = cleanContent(kind, body.content);
    if (!content.ok) return jsonError(content.error, 400);
    const audience = cleanAudience(body.audience);
    const endsAt = cleanEndsAt(body.endsAt);
    if (endsAt === undefined) return jsonError('O prazo precisa ser uma data no futuro (até 1 ano).', 400);
    const svc = serviceClient();

    // "Enviar teste pra mim": só pro admin logado, com [Teste] no assunto. Não salva nada.
    if (body.test === true) {
      const me = await adminContact(svc, guard.userId);
      if (!me) return jsonError('Não achei o e-mail da sua conta pra mandar o teste.', 400);
      const log = await deliverMail(
        svc,
        { id: 'teste', kind, content: content.value, endsAt, activatedAt: new Date().toISOString(), audience },
        { test: me },
      );
      if (log.reason) return jsonError(log.message || 'Não deu pra mandar o teste.', 502);
      return NextResponse.json({ ok: true, to: me.email });
    }

    // Modelo "E-mail": nunca vira janela no site (fora do ar, sem popup).
    const only = audience.email === 'only';
    const active = !only && body.active === true;
    const send = only && body.send === true;
    if ((active || send) && audienceIsEmpty(audience)) return jsonError('Escolha quem recebe antes de publicar.', 400);

    const now = new Date().toISOString();
    const ins = await svc
      .from('announcements')
      .insert({
        kind,
        content: content.value,
        audience,
        popup: only ? false : body.popup !== false,
        active,
        activated_at: active || send ? now : null,
        ends_at: endsAt,
        created_by: UUID_RE.test(guard.userId) ? guard.userId : null,
        created_at: now,
        updated_at: now,
      })
      .select(ANN_COLUMNS)
      .single();
    if (isMissingSchema(ins.error)) return jsonError(NEEDS_DB, 503);
    if (ins.error) return jsonError('Falha ao salvar o aviso.', 500, ins.error.message);
    let row = ins.data as unknown as AnnRow;
    if (active || send) row = await mailIfDue(svc, row);
    return NextResponse.json({ ok: true, item: toAdminAnnouncement(row) });
  } catch (e) {
    return jsonError('Erro inesperado.', 500, e instanceof Error ? e.message : String(e));
  }
}

export async function PATCH(req: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const id = typeof body.id === 'string' ? body.id : '';
    if (!UUID_RE.test(id)) return jsonError('Aviso inválido.', 400);
    const action = body.action;
    const svc = serviceClient();
    const cur = await readOne(svc, id);
    if (isMissingSchema(cur.error)) return jsonError(NEEDS_DB, 503);
    if (cur.error) return jsonError('Falha ao ler o aviso.', 500, cur.error.message);
    if (!cur.row) return jsonError('Esse aviso não existe mais.', 404);

    const now = Date.now();
    const stamp = new Date(now).toISOString();
    const patch: Record<string, unknown> = { updated_at: stamp };
    const existing = toAdminAnnouncement(cur.row, undefined, now);
    const mode = emailModeOf(cur.row.audience as { email?: unknown });
    // depois de gravar: 'due' = manda se esta ativação ainda não teve e-mail; 'force' = continua o envio
    let mailAfter: 'no' | 'due' | 'force' = 'no';

    if (action === 'activate') {
      if (mode === 'only') return jsonError('E-mail não fica no ar no site: use "Enviar de novo".', 400);
      if (audienceIsEmpty(existing.audience)) return jsonError('Escolha quem recebe antes de publicar.', 400);
      patch.active = true;
      patch.activated_at = stamp;
      // Reativar um aviso cujo prazo já passou: sem prazo (senão nem aparece).
      if (cur.row.ends_at && Date.parse(cur.row.ends_at) <= now) patch.ends_at = null;
      mailAfter = 'due';
    } else if (action === 'pause') {
      patch.active = false;
    } else if (action === 'republish') {
      if (!cur.row.active) return jsonError('Ative o aviso antes de mostrar de novo.', 400);
      patch.activated_at = stamp;
      mailAfter = 'due';
    } else if (action === 'send') {
      if (mode !== 'only') return jsonError('Só o modelo E-mail é enviado por aqui.', 400);
      if (audienceIsEmpty(existing.audience)) return jsonError('Escolha quem recebe antes de enviar.', 400);
      patch.activated_at = stamp;
      patch.active = false;
      mailAfter = 'due';
    } else if (action === 'resume') {
      if (mode === 'off' || !cur.row.activated_at) return jsonError('Esse aviso não tem e-mail pra continuar.', 400);
      mailAfter = 'force';
    } else if (action === 'update') {
      const kind = kindOf(body.kind) ?? existing.kind;
      if ('content' in body) {
        const content = cleanContent(kind, body.content);
        if (!content.ok) return jsonError(content.error, 400);
        patch.content = content.value;
        patch.kind = kind;
      }
      if ('audience' in body) {
        const audience = cleanAudience(body.audience);
        if (cur.row.active && audienceIsEmpty(audience)) return jsonError('Um aviso no ar precisa de alguém pra receber.', 400);
        // o registro do envio (mailLog) é do servidor: o painel não manda, aqui reanexa
        patch.audience = audienceForDb(audience, rawMailLog(cur.row.audience));
        // ligou o envelope num aviso que já está no ar → e-mail desta ativação (se ainda não saiu)
        if (cur.row.active && audience.email === 'also' && mode !== 'also') mailAfter = 'due';
      }
      if ('popup' in body) patch.popup = mode === 'only' ? false : body.popup !== false;
      if ('endsAt' in body) {
        const endsAt = cleanEndsAt(body.endsAt, now);
        if (endsAt === undefined) return jsonError('O prazo precisa ser uma data no futuro (até 1 ano).', 400);
        patch.ends_at = endsAt;
      }
      if (body.republish === true && cur.row.active) {
        patch.activated_at = stamp;
        mailAfter = 'due';
      }
    } else {
      return jsonError('Ação inválida.', 400);
    }

    const up = await svc.from('announcements').update(patch).eq('id', id).select(ANN_COLUMNS).single();
    if (up.error) return jsonError('Falha ao salvar o aviso.', 500, up.error.message);
    let row = up.data as unknown as AnnRow;
    if (mailAfter !== 'no') row = await mailIfDue(svc, row, mailAfter === 'force');
    return NextResponse.json({ ok: true, item: toAdminAnnouncement(row) });
  } catch (e) {
    return jsonError('Erro inesperado.', 500, e instanceof Error ? e.message : String(e));
  }
}

export async function DELETE(req: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  try {
    const id = new URL(req.url).searchParams.get('id') ?? '';
    if (!UUID_RE.test(id)) return jsonError('Aviso inválido.', 400);
    const svc = serviceClient();
    const del = await svc.from('announcements').delete().eq('id', id);
    if (isMissingSchema(del.error)) return jsonError(NEEDS_DB, 503);
    if (del.error) return jsonError('Falha ao apagar o aviso.', 500, del.error.message);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return jsonError('Erro inesperado.', 500, e instanceof Error ? e.message : String(e));
  }
}
