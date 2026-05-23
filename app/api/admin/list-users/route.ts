import { NextResponse } from 'next/server';
import { jsonError, requireAdmin, serviceClient } from '../_helpers';

/**
 * GET /api/admin/list-users
 *
 * Retorna so os USUARIOS (is_admin=false). Admins (incluindo o proprio
 * caller) sao filtrados — admin nao precisa se ver na lista.
 */

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  try {
    const svc = serviceClient();

    const { data: profiles, error } = await svc
      .from('profiles')
      .select(
        'id, name, is_admin, is_active, activated_at, created_at, must_change_password, last_seen_at, last_ip, last_tool, last_tool_at, tier, phone, phone_verified, phone_verified_at, legacy_no_phone',
      )
      .eq('is_admin', false)
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
