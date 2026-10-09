import { NextResponse } from 'next/server';
import { jsonError, requireAdmin, serviceClient } from '../_helpers';
import {
  audienceIsEmpty,
  cleanAudience,
  cleanContent,
  cleanEndsAt,
  type AnnKind,
  type AnnStats,
} from '@/lib/announcements';
import {
  ANN_COLUMNS,
  isMissingSchema,
  toAdminAnnouncement,
  toStats,
  UUID_RE,
  type AnnRow,
} from '@/lib/announcements-server';

/**
 * /api/admin/announcements — central de avisos do painel.
 *
 * GET     lista (mais novos primeiro) com os números de cada um
 * POST    cria   { kind, content, audience, popup, active, endsAt }
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
export const maxDuration = 15;

const NEEDS_DB = 'A tabela de avisos ainda não existe no banco: rode a migration 038_announcements.sql no Supabase.';

function kindOf(v: unknown): AnnKind | null {
  return v === 'aviso' || v === 'propaganda' ? v : null;
}

async function readOne(svc: ReturnType<typeof serviceClient>, id: string) {
  const res = await svc.from('announcements').select(ANN_COLUMNS).eq('id', id).maybeSingle();
  return { row: (res.data ?? null) as AnnRow | null, error: res.error };
}

export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  try {
    const svc = serviceClient();
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
    const active = body.active === true;
    if (active && audienceIsEmpty(audience)) return jsonError('Escolha quem recebe antes de publicar.', 400);
    const endsAt = cleanEndsAt(body.endsAt);
    if (endsAt === undefined) return jsonError('O prazo precisa ser uma data no futuro (até 1 ano).', 400);

    const now = new Date().toISOString();
    const svc = serviceClient();
    const ins = await svc
      .from('announcements')
      .insert({
        kind,
        content: content.value,
        audience,
        popup: body.popup !== false,
        active,
        activated_at: active ? now : null,
        ends_at: endsAt,
        created_by: UUID_RE.test(guard.userId) ? guard.userId : null,
        created_at: now,
        updated_at: now,
      })
      .select(ANN_COLUMNS)
      .single();
    if (isMissingSchema(ins.error)) return jsonError(NEEDS_DB, 503);
    if (ins.error) return jsonError('Falha ao salvar o aviso.', 500, ins.error.message);
    return NextResponse.json({ ok: true, item: toAdminAnnouncement(ins.data as unknown as AnnRow) });
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

    if (action === 'activate') {
      if (audienceIsEmpty(existing.audience)) return jsonError('Escolha quem recebe antes de publicar.', 400);
      patch.active = true;
      patch.activated_at = stamp;
      // Reativar um aviso cujo prazo já passou: sem prazo (senão nem aparece).
      if (cur.row.ends_at && Date.parse(cur.row.ends_at) <= now) patch.ends_at = null;
    } else if (action === 'pause') {
      patch.active = false;
    } else if (action === 'republish') {
      if (!cur.row.active) return jsonError('Ative o aviso antes de mostrar de novo.', 400);
      patch.activated_at = stamp;
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
        patch.audience = audience;
      }
      if ('popup' in body) patch.popup = body.popup !== false;
      if ('endsAt' in body) {
        const endsAt = cleanEndsAt(body.endsAt, now);
        if (endsAt === undefined) return jsonError('O prazo precisa ser uma data no futuro (até 1 ano).', 400);
        patch.ends_at = endsAt;
      }
      if (body.republish === true && cur.row.active) patch.activated_at = stamp;
    } else {
      return jsonError('Ação inválida.', 400);
    }

    const up = await svc.from('announcements').update(patch).eq('id', id).select(ANN_COLUMNS).single();
    if (up.error) return jsonError('Falha ao salvar o aviso.', 500, up.error.message);
    return NextResponse.json({ ok: true, item: toAdminAnnouncement(up.data as unknown as AnnRow) });
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
