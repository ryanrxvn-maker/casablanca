import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { jsonError, requireAdmin, serviceClient } from '../_helpers';
import { getStripe } from '@/lib/stripe';
import { findLiveStripeSubscription } from '@/lib/billing-reconcile';
import {
  checkRefund,
  refundAndCancelNow,
  refundBlockText,
  scheduleCancelAtPeriodEnd,
  type RefundCheck,
} from '@/lib/billing-refund';

/**
 * Cancelamento pelo ADMIN (painel):
 *
 *   GET  ?userId=<uuid> → prévia: assinatura viva, última cobrança, se está nos
 *        7 dias, quanto volta. A janela de confirmação mostra isto ANTES do clique.
 *   POST { userId, mode: 'refund_now' | 'at_period_end' }
 *        refund_now    → devolve a última cobrança INTEIRA e encerra agora
 *                        (o admin pode fora dos 7 dias e mesmo se já houve
 *                        reembolso antes — é decisão humana).
 *        at_period_end → só desliga a renovação; acesso até o fim do período.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIVE = new Set(['active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused']);

async function loadTarget(userId: string) {
  const svc = serviceClient();
  const { data } = await svc
    .from('profiles')
    .select('id, email, name, is_admin, stripe_customer_id, stripe_subscription_id, subscription_status')
    .eq('id', userId)
    .maybeSingle();
  const p = data as {
    id: string;
    email: string | null;
    name: string | null;
    is_admin: boolean | null;
    stripe_customer_id: string | null;
    stripe_subscription_id: string | null;
    subscription_status: string | null;
  } | null;
  if (!p) return null;

  const stripe = getStripe();
  let subId = p.stripe_subscription_id;
  let customerId = p.stripe_customer_id;
  let sub: Stripe.Subscription | null = subId
    ? await stripe.subscriptions.retrieve(subId).catch(() => null)
    : null;
  // Vínculo velho/encerrado: procura uma assinatura VIVA pelo customer/email.
  if (!sub || !LIVE.has(sub.status)) {
    const found = await findLiveStripeSubscription(customerId, p.email).catch(() => null);
    if (found) {
      sub = found.sub;
      subId = found.sub.id;
      customerId = found.customerId;
    }
  }
  return { p, sub, subId: sub ? subId : null, customerId };
}

function preview(check: RefundCheck) {
  const c = check.charge;
  return {
    eligible_by_policy: check.eligible,
    block_reason: check.eligible ? null : check.reason,
    block_text: check.eligible ? null : refundBlockText(check.reason, c),
    charge: c
      ? {
          amount: c.amount,
          refunded: c.amountRefunded,
          paid_at: new Date(c.paidAt).toISOString(),
          deadline: new Date(c.refundDeadline).toISOString(),
          kind: c.kind,
        }
      : null,
  };
}

export async function GET(req: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  try {
    const userId = new URL(req.url).searchParams.get('userId') ?? '';
    if (!UUID.test(userId)) return jsonError('userId inválido.', 400);
    const t = await loadTarget(userId);
    if (!t) return jsonError('Usuário não encontrado.', 404);

    const check = await checkRefund({
      userId,
      email: t.p.email,
      customerId: t.customerId,
      subId: t.subId,
    });
    const s = t.sub as unknown as {
      status?: string;
      cancel_at_period_end?: boolean;
      cancel_at?: number | null;
      items?: { data?: Array<{ current_period_end?: number }> };
    } | null;
    const end = s ? s.cancel_at ?? s.items?.data?.[0]?.current_period_end ?? null : null;
    return NextResponse.json({
      ok: true,
      email: t.p.email,
      subscription: s
        ? {
            id: t.subId,
            status: s.status ?? null,
            live: LIVE.has(s.status ?? ''),
            cancel_scheduled: !!s.cancel_at_period_end || !!s.cancel_at,
            period_end: end ? new Date(end * 1000).toISOString() : null,
          }
        : null,
      one_time: !t.subId && t.p.subscription_status === 'paid',
      ...preview(check),
    });
  } catch (e) {
    return jsonError('Falha ao ler o Stripe.', 500, e instanceof Error ? e.message : String(e));
  }
}

export async function POST(req: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  try {
    const body = (await req.json().catch(() => ({}))) as { userId?: string; mode?: string };
    const userId = body.userId ?? '';
    if (!UUID.test(userId)) return jsonError('userId inválido.', 400);
    if (body.mode !== 'refund_now' && body.mode !== 'at_period_end') return jsonError('Modo inválido.', 400);

    const t = await loadTarget(userId);
    if (!t) return jsonError('Usuário não encontrado.', 404);
    if (t.p.is_admin) return jsonError('Conta admin não tem assinatura pra cancelar.', 400);

    const live = !!t.sub && LIVE.has(t.sub.status);

    if (body.mode === 'at_period_end') {
      if (!live || !t.subId) return jsonError('Não há assinatura viva pra agendar o cancelamento.', 400);
      const { accessUntil } = await scheduleCancelAtPeriodEnd({
        subId: t.subId,
        email: t.p.email,
        userId,
        why: 'decisão do admin',
        by: 'admin',
      });
      return NextResponse.json({ ok: true, mode: 'scheduled', access_until: accessUntil });
    }

    // refund_now
    const check = await checkRefund({
      userId,
      email: t.p.email,
      customerId: t.customerId,
      subId: t.subId, // encerrada também serve: devolve a última fatura dela
    });
    const charge = check.charge;
    if (!charge || charge.amount <= 0 || (!charge.paymentIntentId && !charge.chargeId)) {
      return jsonError('Não achei uma cobrança paga pra devolver.', 400);
    }
    if (charge.disputed) {
      return jsonError('Essa cobrança está em contestação no banco — o reembolso sai pela disputa, não por aqui.', 409);
    }
    const r = await refundAndCancelNow({
      userId,
      email: t.p.email,
      customerId: t.customerId,
      subId: t.subId, // já encerrada = o cancelamento só confirma
      charge,
      by: 'admin',
      adminId: guard.userId,
    });
    return NextResponse.json({
      ok: true,
      mode: 'refunded',
      refunded: r.refunded,
      already_refunded: r.refunded === 0,
      amount: charge.amount,
    });
  } catch (e) {
    console.error('[admin refund-cancel]', e);
    return jsonError('Falha ao cancelar/reembolsar no Stripe.', 500, e instanceof Error ? e.message : String(e));
  }
}
