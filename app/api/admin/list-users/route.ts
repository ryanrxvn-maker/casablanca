import { NextResponse } from 'next/server';
import { jsonError, requireAdmin, serviceClient } from '../_helpers';

/**
 * GET /api/admin/list-users
 *
 * So admin. Retorna lista de profiles com email (do auth.users via join).
 */

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  try {
    const svc = serviceClient();

    // Pega lista de profiles ordenada por created_at desc
    const { data: profiles, error } = await svc
      .from('profiles')
      .select('id, name, is_admin, is_active, activated_at, created_at')
      .order('created_at', { ascending: false });

    if (error) {
      return jsonError('Falha ao listar usuarios.', 500, error.message);
    }

    // Cruza com auth.users pra pegar email
    const ids = (profiles ?? []).map((p) => p.id);
    const emails: Record<string, string> = {};
    if (ids.length > 0) {
      const { data: usersList } = await svc.auth.admin.listUsers({
        page: 1,
        perPage: 200,
      });
      for (const u of usersList?.users ?? []) {
        if (u.email) emails[u.id] = u.email;
      }
    }

    const enriched = (profiles ?? []).map((p) => ({
      ...p,
      email: emails[p.id] ?? null,
    }));

    return NextResponse.json({ users: enriched });
  } catch (e) {
    console.error('[admin list-users]', e);
    return jsonError(
      'Erro inesperado.',
      500,
      e instanceof Error ? e.message : String(e),
    );
  }
}
