import { NextResponse } from 'next/server';
import { jsonError, requireAdmin, serviceClient } from '../_helpers';
import { reconcileUserBilling } from '@/lib/billing-reconcile';

/**
 * POST /api/admin/reconcile-billing  (admin)
 *   Body: { userId?: string, email?: string }
 *
 * Força a reconciliação do acesso pago de um cliente com o Stripe. Uso
 * operacional: "pagou e continuou free" → o admin clica e o tier sobe na
 * hora, lendo o estado REAL do Stripe (sem depender do webhook). Só concede;
 * nunca rebaixa.
 */

export const runtime = 'nodejs';
export const maxDuration = 20;

export async function POST(req: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  try {
    const { userId, email } = (await req.json().catch(() => ({}))) as {
      userId?: string;
      email?: string;
    };

    let uid = typeof userId === 'string' && userId ? userId : null;
    if (!uid && typeof email === 'string' && email) {
      const { data } = await serviceClient()
        .from('profiles')
        .select('id')
        .ilike('email', email.trim())
        .maybeSingle();
      uid = (data as { id?: string } | null)?.id ?? null;
    }
    if (!uid) {
      return jsonError('Informe userId ou email de um usuário existente.', 400);
    }

    const result = await reconcileUserBilling(uid);
    return NextResponse.json({ ok: true, userId: uid, ...result });
  } catch (e) {
    return jsonError(
      'Falha ao reconciliar com o Stripe.',
      500,
      e instanceof Error ? e.message : String(e),
    );
  }
}
