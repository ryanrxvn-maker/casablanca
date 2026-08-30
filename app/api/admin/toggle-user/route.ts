import { NextResponse } from 'next/server';
import { jsonError, requireAdmin, serviceClient } from '../_helpers';
import { findLiveStripeSubscription } from '@/lib/billing-reconcile';

/**
 * POST /api/admin/toggle-user
 * body: { userId, action: 'activate' | 'deactivate' | 'promote' | 'demote' | 'delete' }
 *
 * So admin. Liga/desliga is_active, ou promove/demote is_admin, ou deleta.
 * Service role bypassa o trigger, entao a operacao funciona.
 *
 * DELETE tem trava: conta com assinatura VIVA no Stripe nao e deletada. O
 * profile some por cascade de auth.users e o Stripe continua cobrando um
 * cliente que nao tem mais conta — todo evento vira "assinatura orfa".
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
      // Trava: assinatura viva no Stripe. Deletar aqui apaga o profile
      // (cascade) e deixa a cobranca rodando pra sempre, sem dono.
      const { data: prof } = await svc
        .from('profiles')
        .select('email, stripe_customer_id')
        .eq('id', userId)
        .maybeSingle();
      const p = prof as {
        email?: string | null;
        stripe_customer_id?: string | null;
      } | null;
      const live = await findLiveStripeSubscription(
        p?.stripe_customer_id,
        p?.email,
      ).catch(() => null);
      if (live) {
        return jsonError(
          `Esse usuario tem assinatura VIVA no Stripe (${live.sub.id} · ${live.sub.status}). ` +
            'Cancele (e reembolse, se for o caso) no Stripe ANTES de deletar a conta — ' +
            'senao o cartao continua sendo cobrado por uma conta que nao existe mais.',
          409,
        );
      }

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
