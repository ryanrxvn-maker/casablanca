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

    // Tenta o select completo; se a migration 015 não rodou, cai pro select básico.
    let profiles:
      | Array<Record<string, unknown>>
      | null = null;
    const full = await svc
      .from('profiles')
      .select(
        'id, name, email, is_admin, is_active, activated_at, created_at, must_change_password, last_seen_at, last_ip, last_tool, last_tool_at, tier, phone, phone_verified, phone_verified_at, legacy_no_phone',
      )
      .eq('is_admin', false)
      .order('created_at', { ascending: false });

    if (full.error) {
      const basic = await svc
        .from('profiles')
        .select(
          'id, name, email, is_admin, is_active, activated_at, created_at, must_change_password, last_seen_at, last_ip, last_tool, last_tool_at',
        )
        .eq('is_admin', false)
        .order('created_at', { ascending: false });
      if (basic.error) {
        return jsonError('Falha ao listar usuarios.', 500, basic.error.message);
      }
      profiles = (basic.data ?? null) as Array<Record<string, unknown>> | null;
    } else {
      profiles = (full.data ?? null) as Array<Record<string, unknown>> | null;
    }

    // Email vem direto do profiles (populado no signup) — sem o teto de 200
    // do admin.listUsers, que sumia com o email das contas > 200º.
    const enriched = (profiles ?? []).map((p) => ({
      ...p,
      email: (p.email as string | null) ?? null,
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
