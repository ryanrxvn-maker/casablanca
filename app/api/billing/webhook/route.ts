import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { getStripe } from '@/lib/stripe';
import { serviceClient } from '@/app/api/admin/_helpers';
import { isPaidTier, type PaidTier } from '@/lib/plan-prices';

/**
 * POST /api/billing/webhook  (Stripe → servidor)
 *
 * Modelo ASSINATURA RECORRENTE (cartão). Roda com SERVICE_ROLE (bypassa o
 * trigger anti-escalada). Assinatura verificada via STRIPE_WEBHOOK_SECRET.
 *
 * Eventos:
 *  • checkout.session.completed       → 1a assinatura criada → concede acesso
 *  • invoice.paid                     → cobrança (1a + renovações) → renova + grava comprovante
 *  • customer.subscription.updated    → active/trialing=plano · past_due/canceled/unpaid=free
 *  • customer.subscription.deleted    → free
 *
 * Garantias: se o cartão falhar na renovação, o Stripe tenta de novo e, esgotado,
 * marca past_due/canceled → aqui o tier cai pra free automaticamente. Admin nunca
 * é alterado (use-tier/middleware priorizam is_admin).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type SubLike = Stripe.Subscription & {
  current_period_end?: number;
  metadata: Record<string, string>;
};
type InvoiceLike = Stripe.Invoice & {
  subscription?: string | { id: string } | null;
  payment_intent?: string | { id: string } | null;
  charge?: string | { id: string } | null;
  hosted_invoice_url?: string | null;
};

function activeStatus(status: string): boolean {
  return status === 'active' || status === 'trialing';
}

/** Aplica no profile o estado atual da assinatura. */
async function applySubscription(sub: SubLike) {
  const userId = sub.metadata?.userId;
  const planRaw = sub.metadata?.plan ?? '';
  if (!userId || !isPaidTier(planRaw)) return;
  const plan = planRaw as PaidTier;
  const customerId =
    typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;

  const active = activeStatus(sub.status);
  const svc = serviceClient();
  await svc
    .from('profiles')
    .update({
      stripe_customer_id: customerId ?? null,
      stripe_subscription_id: sub.id,
      subscription_status: sub.status, // active | past_due | canceled | unpaid | ...
      subscription_plan: active ? plan : null,
      tier: active ? plan : 'free', // cartão falhou/cancelou → free
      current_period_end: sub.current_period_end
        ? new Date(sub.current_period_end * 1000).toISOString()
        : null,
    })
    .eq('id', userId);
}

/** Grava o comprovante de uma cobrança (1a ou renovação). Idempotente por invoice. */
async function recordInvoice(invoice: InvoiceLike, sub: SubLike) {
  const userId = sub.metadata?.userId;
  if (!userId) return;
  const piId =
    typeof invoice.payment_intent === 'string'
      ? invoice.payment_intent
      : invoice.payment_intent?.id ?? null;

  await serviceClient()
    .from('payments')
    .upsert(
      {
        user_id: userId,
        email: invoice.customer_email ?? null,
        amount: invoice.amount_paid ?? 0,
        currency: invoice.currency ?? 'brl',
        plan: (sub.metadata?.plan as PaidTier) ?? null,
        billing: sub.metadata?.billing ?? null,
        status: 'paid',
        stripe_payment_intent: piId,
        stripe_checkout_session: invoice.id, // chave única do registro
        receipt_url: invoice.hosted_invoice_url ?? null,
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
  if (!sig) return NextResponse.json({ error: 'Sem assinatura.' }, { status: 400 });

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
        const subId =
          typeof session.subscription === 'string'
            ? session.subscription
            : session.subscription?.id;
        if (subId) {
          const sub = (await stripe.subscriptions.retrieve(subId)) as SubLike;
          await applySubscription(sub);
        }
        break;
      }
      case 'invoice.paid': {
        const invoice = event.data.object as InvoiceLike;
        const subId =
          typeof invoice.subscription === 'string'
            ? invoice.subscription
            : invoice.subscription?.id;
        if (subId) {
          const sub = (await stripe.subscriptions.retrieve(subId)) as SubLike;
          await applySubscription(sub); // renova current_period_end
          await recordInvoice(invoice, sub);
        }
        break;
      }
      case 'customer.subscription.updated': {
        await applySubscription(event.data.object as SubLike);
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object as SubLike;
        const customerId =
          typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
        const userId = sub.metadata?.userId;
        const svc = serviceClient();
        const patch = {
          subscription_status: 'canceled',
          subscription_plan: null,
          tier: 'free',
        };
        if (userId) await svc.from('profiles').update(patch).eq('id', userId);
        else if (customerId)
          await svc.from('profiles').update(patch).eq('stripe_customer_id', customerId);
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
