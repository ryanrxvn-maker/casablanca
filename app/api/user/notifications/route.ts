import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { serviceClient } from '@/app/api/admin/_helpers';
import { classifyAccess } from '@/app/api/admin/_classify';
import { rateLimit } from '@/lib/rate-limit';
import { staticUnlocksForEmail, UNLOCKABLE_TOOLS } from '@/lib/tool-unlocks';
import {
  addDismissedKey,
  cleanAudience,
  isLive,
  matchesAudience,
  NOTIF_ACTIONS,
  popupKey,
  readContent,
  sessionIdFromJwt,
  shouldPopup,
  sortPopups,
  type NotifAction,
  type NotifItem,
  type NotifPayload,
  type Viewer,
} from '@/lib/announcements';
import {
  ANN_COLUMNS,
  asKind,
  INBOX_COLUMNS,
  isMissingSchema,
  iso,
  UUID_RE,
  type AnnRow,
  type InboxRow,
} from '@/lib/announcements-server';

/**
 * /api/user/notifications — o sino de cada conta.
 *
 * GET  sincroniza: entrega na caixa da conta todo aviso NO AR cuja audiência
 *      bate com ela agora, devolve o histórico (lidas e não lidas, sem as
 *      apagadas) e quais janelas abrir AGORA na tela.
 * POST ações: read | unread | dismiss (fechou a janela) | click (clicou no
 *      botão) | delete | restore | read_all | clear_read.
 *
 * A janela abre de novo a cada LOGIN (sessão nova do Supabase, claim
 * `session_id` do token) enquanto o aviso estiver no ar — ver
 * lib/announcements.ts. Tudo com a service role, sempre filtrado pela conta
 * da sessão: ninguém lê nem mexe na caixa de outra pessoa.
 *
 * Sem a migration 038 responde `enabled: false` e o sino só fica quieto.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 10;

const CATALOG = new Set(UNLOCKABLE_TOOLS.map((t) => t.path));
const HISTORY_LIMIT = 120;
const NO_STORE = { 'Cache-Control': 'no-store' };

type Who = { userId: string; email: string | null; sk: string };

async function identify(): Promise<Who | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  // Sessão de login: o mesmo id enquanto o token só é renovado; login novo =
  // id novo. O usuário já foi validado acima, aqui só lemos o claim.
  let sid: string | null = null;
  try {
    const { data } = await supabase.auth.getSession();
    sid = sessionIdFromJwt(data.session?.access_token);
  } catch {
    /* sem sessão legível: cai no horário do último login */
  }
  const raw = sid ? `sid:${sid}` : `login:${user.id}:${user.last_sign_in_at ?? ''}`;
  return {
    userId: user.id,
    email: user.email ?? null,
    sk: createHash('sha256').update(raw).digest('hex').slice(0, 20),
  };
}

function off(who: Who): NotifPayload {
  return { enabled: false, userId: who.userId, sk: who.sk, items: [], unread: 0, popups: [] };
}

async function loadViewer(svc: ReturnType<typeof serviceClient>, who: Who): Promise<Viewer | null> {
  type P = {
    is_admin?: boolean | null;
    is_active?: boolean | null;
    tier?: string | null;
    subscription_status?: string | null;
    current_period_end?: string | null;
    tool_unlocks?: string[] | null;
  };
  // Mesma cascata do middleware: sem a coluna de desbloqueio (028), segue sem ela.
  let p: P | null = null;
  const full = await svc
    .from('profiles')
    .select('is_admin, is_active, tier, subscription_status, current_period_end, tool_unlocks')
    .eq('id', who.userId)
    .maybeSingle();
  if (!full.error) p = (full.data ?? null) as P | null;
  else {
    const mid = await svc
      .from('profiles')
      .select('is_admin, is_active, tier, subscription_status, current_period_end')
      .eq('id', who.userId)
      .maybeSingle();
    if (mid.error) return null;
    p = (mid.data ?? null) as P | null;
  }
  if (!p) return null;
  const { plan, access } = classifyAccess(p);
  const unlocks = [...(Array.isArray(p.tool_unlocks) ? p.tool_unlocks : []), ...staticUnlocksForEmail(who.email)];
  return {
    id: who.userId,
    email: who.email,
    isAdmin: p.is_admin === true,
    isActive: p.is_active === true,
    plan,
    access,
    beta: unlocks.some((u) => CATALOG.has(u)),
  };
}

function toItem(ann: AnnRow, row: Pick<InboxRow, 'delivered_at' | 'read_at' | 'clicked_at'>, now: number): NotifItem {
  const kind = asKind(ann.kind);
  return {
    id: ann.id,
    kind,
    content: readContent(kind, ann.content),
    deliveredAt: iso(row.delivered_at) ?? row.delivered_at,
    readAt: iso(row.read_at),
    clickedAt: iso(row.clicked_at),
    live: isLive({ active: ann.active === true, ends_at: ann.ends_at }, now),
    activatedAt: iso(ann.activated_at),
    endsAt: iso(ann.ends_at),
  };
}

export async function GET() {
  let who: Who | null = null;
  try {
    who = await identify();
    if (!who) return NextResponse.json({ error: 'Nao autenticado.' }, { status: 401, headers: NO_STORE });
    if (!rateLimit(`notif:get:${who.userId}`, 40, 60_000)) {
      return NextResponse.json({ error: 'Muitas consultas seguidas.' }, { status: 429, headers: NO_STORE });
    }

    const svc = serviceClient();
    const now = Date.now();

    const [viewer, liveRes, inboxRes] = await Promise.all([
      loadViewer(svc, who),
      svc
        .from('announcements')
        .select(ANN_COLUMNS)
        .eq('active', true)
        .order('activated_at', { ascending: false })
        .limit(100),
      svc
        .from('announcement_inbox')
        .select(`${INBOX_COLUMNS}, announcements(${ANN_COLUMNS})`)
        .eq('user_id', who.userId)
        .order('delivered_at', { ascending: false })
        .limit(HISTORY_LIMIT),
    ]);

    if (isMissingSchema(liveRes.error) || isMissingSchema(inboxRes.error)) {
      return NextResponse.json(off(who), { headers: NO_STORE });
    }
    if (liveRes.error || inboxRes.error) {
      console.error('[notifications] leitura falhou:', liveRes.error?.message ?? inboxRes.error?.message);
      return NextResponse.json({ error: 'Falha ao carregar as notificações.' }, { status: 500, headers: NO_STORE });
    }

    type InboxJoined = InboxRow & { announcements: AnnRow | AnnRow[] | null };
    const rows = ((inboxRes.data ?? []) as unknown as InboxJoined[]).map((r) => ({
      ...r,
      ann: Array.isArray(r.announcements) ? r.announcements[0] ?? null : r.announcements,
    }));
    const rowById = new Map<string, InboxRow>(rows.map((r) => [r.announcement_id, r]));

    // Audiência avaliada AGORA: quem mudou de plano passa a receber (ou para
    // de receber) os avisos do novo grupo sem depender de nada.
    const matched = viewer
      ? ((liveRes.data ?? []) as unknown as AnnRow[]).filter(
          (a) => isLive({ active: a.active === true, ends_at: a.ends_at }, now) && matchesAudience(cleanAudience(a.audience), viewer),
        )
      : [];

    // Entrega: o que bate e ainda não está na caixa. A conta pode ter mais
    // linhas que o histórico lido; confere essas antes de achar que é novo.
    let missing = matched.filter((a) => !rowById.has(a.id));
    if (missing.length) {
      const known = await svc
        .from('announcement_inbox')
        .select(INBOX_COLUMNS)
        .eq('user_id', who.userId)
        .in('announcement_id', missing.map((a) => a.id));
      for (const r of (known.data ?? []) as unknown as InboxRow[]) rowById.set(r.announcement_id, r);
      missing = missing.filter((a) => !rowById.has(a.id));
    }
    const delivered: Array<{ ann: AnnRow; row: InboxRow }> = [];
    if (missing.length) {
      const stamp = new Date(now).toISOString();
      const ins = await svc.from('announcement_inbox').upsert(
        missing.map((a) => ({ user_id: who!.userId, announcement_id: a.id, delivered_at: stamp })),
        { onConflict: 'user_id,announcement_id', ignoreDuplicates: true },
      );
      if (ins.error) console.error('[notifications] entrega falhou:', ins.error.message);
      else {
        for (const a of missing) {
          const row: InboxRow = { announcement_id: a.id, delivered_at: stamp, read_at: null, dismissed_keys: [], clicked_at: null, deleted_at: null };
          rowById.set(a.id, row);
          delivered.push({ ann: a, row });
        }
      }
    }

    const items: NotifItem[] = [
      ...delivered.map((d) => toItem(d.ann, d.row, now)),
      ...rows.filter((r) => r.ann && !r.deleted_at).map((r) => toItem(r.ann as AnnRow, r, now)),
    ].sort((a, b) => Date.parse(b.deliveredAt) - Date.parse(a.deliveredAt));

    const popups = sortPopups(
      matched
        .filter((a) => rowById.has(a.id) && shouldPopup({ popup: a.popup !== false, active: a.active === true, ends_at: a.ends_at, activated_at: a.activated_at }, rowById.get(a.id), who!.sk, now))
        .map((a) => toItem(a, rowById.get(a.id) as InboxRow, now)),
    ).slice(0, 6);

    const payload: NotifPayload = {
      enabled: true,
      userId: who.userId,
      sk: who.sk,
      items,
      unread: items.filter((i) => !i.readAt).length,
      popups,
    };
    return NextResponse.json(payload, { headers: NO_STORE });
  } catch (e) {
    console.error('[notifications GET]', e);
    if (who) return NextResponse.json(off(who), { headers: NO_STORE });
    return NextResponse.json({ error: 'Erro inesperado.' }, { status: 500, headers: NO_STORE });
  }
}

export async function POST(req: Request) {
  try {
    const who = await identify();
    if (!who) return NextResponse.json({ error: 'Nao autenticado.' }, { status: 401 });
    if (!rateLimit(`notif:post:${who.userId}`, 120, 60_000)) {
      return NextResponse.json({ error: 'Muitas ações seguidas.' }, { status: 429 });
    }
    const body = (await req.json().catch(() => ({}))) as { action?: unknown; id?: unknown };
    const action = body.action as NotifAction;
    if (!NOTIF_ACTIONS.includes(action)) return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 });
    const id = typeof body.id === 'string' ? body.id : '';
    const needsId = action !== 'read_all' && action !== 'clear_read';
    if (needsId && !UUID_RE.test(id)) return NextResponse.json({ error: 'Notificação inválida.' }, { status: 400 });

    const svc = serviceClient();
    const stamp = new Date().toISOString();
    const uid = who.userId;
    const inbox = () => svc.from('announcement_inbox');

    let error: { code?: string; message?: string } | null = null;

    if (action === 'read') {
      ({ error } = await inbox().update({ read_at: stamp }).eq('user_id', uid).eq('announcement_id', id).is('read_at', null));
    } else if (action === 'unread') {
      ({ error } = await inbox().update({ read_at: null }).eq('user_id', uid).eq('announcement_id', id));
    } else if (action === 'restore') {
      ({ error } = await inbox().update({ deleted_at: null }).eq('user_id', uid).eq('announcement_id', id));
    } else if (action === 'delete') {
      const res = await Promise.all([
        inbox().update({ deleted_at: stamp }).eq('user_id', uid).eq('announcement_id', id),
        // apagar sem ler não deixa número preso no sino
        inbox().update({ read_at: stamp }).eq('user_id', uid).eq('announcement_id', id).is('read_at', null),
      ]);
      error = res[0].error ?? res[1].error;
    } else if (action === 'read_all') {
      ({ error } = await inbox().update({ read_at: stamp }).eq('user_id', uid).is('read_at', null).is('deleted_at', null));
    } else if (action === 'clear_read') {
      ({ error } = await inbox().update({ deleted_at: stamp }).eq('user_id', uid).not('read_at', 'is', null).is('deleted_at', null));
    } else {
      // dismiss / click: grava a chave desta sessão + ativação (a janela só
      // volta em login novo ou reativação) e conta como lida.
      const cur = await inbox().select('dismissed_keys, read_at, announcements(activated_at)').eq('user_id', uid).eq('announcement_id', id).maybeSingle();
      if (cur.error) error = cur.error;
      else if (cur.data) {
        const row = cur.data as unknown as {
          dismissed_keys: string[] | null;
          read_at: string | null;
          announcements: { activated_at: string | null } | Array<{ activated_at: string | null }> | null;
        };
        const ann = Array.isArray(row.announcements) ? row.announcements[0] : row.announcements;
        const patch: Record<string, unknown> = {
          dismissed_at: stamp,
          dismissed_keys: addDismissedKey(row.dismissed_keys, popupKey(who.sk, ann?.activated_at ?? null)),
          read_at: row.read_at ?? stamp,
        };
        if (action === 'click') patch.clicked_at = stamp;
        ({ error } = await inbox().update(patch).eq('user_id', uid).eq('announcement_id', id));
      }
    }

    if (isMissingSchema(error)) return NextResponse.json({ ok: false, enabled: false });
    if (error) {
      console.error(`[notifications ${action}]`, error.message);
      return NextResponse.json({ error: 'Não deu pra salvar agora. Tente de novo.' }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[notifications POST]', e);
    return NextResponse.json({ error: 'Erro inesperado.' }, { status: 500 });
  }
}
