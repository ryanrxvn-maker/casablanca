import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { getStripe } from '@/lib/stripe';
import { serviceClient } from '@/app/api/admin/_helpers';
import {
  periodEndFrom,
  isPaidTier,
  isBilling,
  type PaidTier,
  type Billing,
} from '@/lib/plan-prices';

/**
 * POST /api/billing/webhook  (Stripe → servidor)
 *
 * Modelo PAGAMENTO ÚNICO: quando um Checkout de pagamento confirma, libera
 * acesso por 1 mês ou 1 ano (sem renovar). Roda com SERVICE_ROLE (bypassa o
 * trigger anti-escalada). Assinatura verificada via STRIPE_WEBHOOK_SECRET.
 *
 * Eventos:
 *  • checkout.session.completed         → cartão/PIX confirmados na hora
 *  • checkout.session.async_payment_succeeded → boleto/PIX que confirmam depois
 *
 * Cartão/PIX/boleto: todos pagamento único. O acesso expira em
 * current_period_end (enforçado em require-tier + middleware). Admin nunca expira.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function grantAccess(session: Stripe.Checkout.Session) {
  const userId = session.metadata?.userId;
  const plan = session.metadata?.plan;
  const billing = session.metadata?.billing;
  const customerId =
    typeof session.customer === 'string' ? session.customer : session.customer?.id;

  if (!userId || !plan || !isPaidTier(plan)) return;
  const period: Billing = isBilling(billing ?? '') ? (billing as Billing) : 'monthly';
  const periodEnd = periodEndFrom(period).toISOString();

  const svc = serviceClient();
  await svc
    .from('profiles')
    .update({
      stripe_customer_id: customerId ?? null,
      subscription_status: 'paid',
      subscription_plan: plan as PaidTier,
      tier: plan as PaidTier,
      current_period_end: periodEnd,
    })
    .eq('id', userId);

  // ─── Trilha de auditoria: registra o pagamento + link do comprovante ───
  const piId =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id ?? null;

  let receiptUrl: string | null = null;
  if (piId) {
    try {
      const pi = await getStripe().paymentIntents.retrieve(piId, {
        expand: ['latest_charge'],
      });
      const charge = pi.latest_charge as Stripe.Charge | null;
      receiptUrl = charge?.receipt_url ?? null;
    } catch {
      /* sem comprovante agora — não bloqueia o registro */
    }
  }

  // Idempotente: a checkout_session é UNIQUE, então reentregas não duplicam.
  await svc.from('payments').upsert(
    {
      user_id: userId,
      email: session.customer_details?.email ?? session.customer_email ?? null,
      amount: session.amount_total ?? 0,
      currency: session.currency ?? 'brl',
      plan: plan as PaidTier,
      billing: period,
      status: 'paid',
      stripe_payment_intent: piId,
      stripe_checkout_session: session.id,
      receipt_url: receiptUrl,
    },
    { onConflict: 'stripe_checkout_session' },
  );
}

export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: 'STRIPE_WEBHOOK_SECRET não configurado.' },
      { status: 500 },
    );
  }

  const sig = req.headers.get('stripe-signature');
  if (!sig) {
    return NextResponse.json({ error: 'Sem assinatura.' }, { status: 400 });
  }

  const raw = await req.text();
  const stripe = getStripe();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig, secret);
  } catch (e) {
    return NextResponse.json(
      { error: 'Assinatura inválida.', detail: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        // Só libera quando o pagamento está confirmado (cartão/PIX). Boleto
        // e PIX pendentes chegam depois via async_payment_succeeded.
        if (session.payment_status === 'paid') {
          await grantAccess(session);
        }
        break;
      }
      case 'checkout.session.async_payment_succeeded': {
        const session = event.data.object as Stripe.Checkout.Session;
        await grantAccess(session);
        break;
      }
      default:
        break;
    }
  } catch (e) {
    console.error('[billing webhook]', event.type, e);
    return NextResponse.json({ received: true, warning: 'handler error' });
  }

  return NextResponse.json({ received: true });
}
