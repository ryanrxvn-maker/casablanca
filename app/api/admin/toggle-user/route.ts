import { NextResponse } from 'next/server';
import { jsonError, requireAdmin, serviceClient } from '../_helpers';

/**
 * POST /api/admin/toggle-user
 * body: { userId, action: 'activate' | 'deactivate' | 'promote' | 'demote' | 'delete' }
 *
 * So admin. Liga/desliga is_active, ou promove/demote is_admin, ou deleta.
 * Service role bypassa o trigger, entao a operacao funciona.
 */

export const runtime = 'nodejs';
export const maxDuration = 30;

type Action = 'activate' | 'deactivate' | 'promote' | 'demote' | 'delete';

export async function POST(req: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  try {
    let body: { userId?: string; action?: Action };
    try {
      body = await req.json();
    } catch (e) {
      return jsonError(
        'Body JSON invalido.',
        400,
        e instanceof Error ? e.message : String(e),
      );
    }

    const userId = String(body.userId ?? '');
    const action = body.action;
    if (!userId || !action) {
      return jsonError('userId e action sao obrigatorios.', 400);
    }

    // Nao permite admin se auto-desligar / auto-deletar
    if (
      userId === guard.userId &&
      (action === 'deactivate' || action === 'demote' || action === 'delete')
    ) {
      return jsonError(
        'Voce nao pode desativar/deletar a propria conta admin.',
        400,
      );
    }

    const svc = serviceClient();

    if (action === 'delete') {
      const { error } = await svc.auth.admin.deleteUser(userId);
      if (error) return jsonError('Falha ao deletar.', 500, error.message);
      return NextResponse.json({ ok: true });
    }

    const patch: Record<string, unknown> = {};
    if (action === 'activate') {
      patch.is_active = true;
      patch.activated_at = new Date().toISOString();
    }
    if (action === 'deactivate') {
      patch.is_active = false;
    }
    if (action === 'promote') {
      patch.is_admin = true;
    }
    if (action === 'demote') {
      patch.is_admin = false;
    }

    const { error } = await svc
      .from('profiles')
      .update(patch)
      .eq('id', userId);

    if (error) return jsonError('Falha ao atualizar.', 500, error.message);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[admin toggle-user]', e);
    return jsonError(
      'Erro inesperado.',
      500,
      e instanceof Error ? e.message : String(e),
    );
  }
}
