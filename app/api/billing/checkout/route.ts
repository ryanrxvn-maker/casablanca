import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { serviceClient } from '@/app/api/admin/_helpers';
import { getStripe } from '@/lib/stripe';
import { priceIdFor, isPaidTier, isBilling } from '@/lib/plan-prices';

/**
 * POST /api/billing/checkout
 * body: { plan: 'basic' | 'pro', billing: 'monthly' | 'annual' }
 *
 * Cria uma Checkout Session de assinatura recorrente no Stripe e devolve
 * { url } pra redirecionar. Exige login. O tier só é promovido pelo WEBHOOK
 * após o pagamento confirmar — nunca aqui.
 */

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Faça login pra assinar.', need: 'login' },
        { status: 401 },
      );
    }

    const body = (await req.json().catch(() => null)) as {
      plan?: string;
      billing?: string;
    } | null;
    const plan = body?.plan ?? '';
    const billing = body?.billing ?? '';
    if (!isPaidTier(plan) || !isBilling(billing)) {
      return NextResponse.json(
        { error: 'Plano ou ciclo inválido.' },
        { status: 400 },
      );
    }

    const priceId = priceIdFor(plan, billing);
    if (!priceId) {
      return NextResponse.json(
        {
          error: `Price ID não configurado pra ${plan}/${billing}. Configure STRIPE_PRICE_${plan.toUpperCase()}_${billing.toUpperCase()} no ambiente.`,
        },
        { status: 500 },
      );
    }

    // Reusa o Customer do Stripe se já existir; senão cria.
    const svc = serviceClient();
    const { data: profile } = await svc
      .from('profiles')
      .select('stripe_customer_id, email')
      .eq('id', user.id)
      .maybeSingle();

    const stripe = getStripe();
    let customerId = (profile as { stripe_customer_id?: string | null } | null)
      ?.stripe_customer_id ?? null;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        metadata: { userId: user.id },
      });
      customerId = customer.id;
      await svc
        .from('profiles')
        .update({ stripe_customer_id: customerId })
        .eq('id', user.id);
    }

    const base =
      (process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') ||
        req.headers.get('origin') ||
        '').replace(/\/$/, '');

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      success_url: `${base}/tools?upgraded=1`,
      cancel_url: `${base}/planos?canceled=1`,
      subscription_data: {
        metadata: { userId: user.id, plan },
      },
      metadata: { userId: user.id, plan },
    });

    return NextResponse.json({ url: session.url });
  } catch (e) {
    return NextResponse.json(
      {
        error: 'Falha ao iniciar checkout.',
        detail: e instanceof Error ? e.message.slice(0, 300) : String(e),
      },
      { status: 500 },
    );
  }
}
