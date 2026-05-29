import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { getStripe } from '@/lib/stripe';
import { serviceClient } from '@/app/api/admin/_helpers';
import { tierForPriceId, type PaidTier } from '@/lib/plan-prices';

/**
 * POST /api/billing/webhook  (Stripe → servidor)
 *
 * Única via, fora do admin, que promove/rebaixa tier. Roda com SERVICE_ROLE
 * (bypassa o trigger anti-escalada). Assinatura verificada via STRIPE_WEBHOOK_SECRET
 * — request sem assinatura válida é rejeitado (impede falsificação).
 *
 * Eventos tratados:
 *  • checkout.session.completed       → vincula subscription + promove tier
 *  • customer.subscription.updated    → reflete status; ativo=tier do plano, senão free
 *  • customer.subscription.deleted    → volta pra free
 *
 * IMPORTANTE: nunca mexe em is_admin. Admin que por acaso tenha assinatura
 * continua admin (use-tier/middleware priorizam is_admin).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type SubLike = Stripe.Subscription & { current_period_end?: number };

function planFromSubscription(sub: Stripe.Subscription): PaidTier | null {
  const priceId = sub.items?.data?.[0]?.price?.id;
  return priceId ? tierForPriceId(priceId) : null;
}

function isActiveStatus(status: string): boolean {
  return status === 'active' || status === 'trialing';
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

  const svc = serviceClient();

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.userId;
        const customerId =
          typeof session.customer === 'string' ? session.customer : session.customer?.id;
        const subscriptionId =
          typeof session.subscription === 'string'
            ? session.subscription
            : session.subscription?.id;

        if (!subscriptionId) break;
        const sub = (await stripe.subscriptions.retrieve(subscriptionId)) as SubLike;
        const plan = planFromSubscription(sub) ?? (session.metadata?.plan as PaidTier | undefined);
        if (!plan) break;

        const update: Record<string, unknown> = {
          stripe_customer_id: customerId ?? null,
          stripe_subscription_id: subscriptionId,
          subscription_status: sub.status,
          subscription_plan: plan,
          tier: plan,
          current_period_end: sub.current_period_end
            ? new Date(sub.current_period_end * 1000).toISOString()
            : null,
        };

        // Localiza o profile: prefere metadata.userId, cai pro customer id.
        if (userId) {
          await svc.from('profiles').update(update).eq('id', userId);
        } else if (customerId) {
          await svc.from('profiles').update(update).eq('stripe_customer_id', customerId);
        }
        break;
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object as SubLike;
        const customerId =
          typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
        if (!customerId) break;
        const plan = planFromSubscription(sub);
        const active = isActiveStatus(sub.status);

        await svc
          .from('profiles')
          .update({
            stripe_subscription_id: sub.id,
            subscription_status: sub.status,
            subscription_plan: plan,
            // Ativo → tier do plano. Inadimplente/cancelado → free.
            tier: active && plan ? plan : 'free',
            current_period_end: sub.current_period_end
              ? new Date(sub.current_period_end * 1000).toISOString()
              : null,
          })
          .eq('stripe_customer_id', customerId);
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const customerId =
          typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
        if (!customerId) break;
        await svc
          .from('profiles')
          .update({
            subscription_status: 'canceled',
            subscription_plan: null,
            tier: 'free',
          })
          .eq('stripe_customer_id', customerId);
        break;
      }

      default:
        break;
    }
  } catch (e) {
    // Loga mas devolve 200 pra evitar retries infinitos do Stripe em erro de app.
    console.error('[billing webhook]', event.type, e);
    return NextResponse.json({ received: true, warning: 'handler error' });
  }

  return NextResponse.json({ received: true });
}
