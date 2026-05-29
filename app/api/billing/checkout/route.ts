import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { serviceClient } from '@/app/api/admin/_helpers';
import { getStripe } from '@/lib/stripe';
import {
  PRICE_AMOUNT,
  PLAN_LABEL,
  stripeInterval,
  isPaidTier,
  isBilling,
} from '@/lib/plan-prices';

/**
 * POST /api/billing/checkout
 * body: { plan: 'basic' | 'pro', billing: 'monthly' | 'annual' }
 *
 * Cria uma Checkout Session de ASSINATURA RECORRENTE (mode=subscription),
 * só cartão (recorrência não suporta PIX/boleto), e devolve { url }. Exige
 * login. O acesso só é concedido pelo WEBHOOK quando o pagamento confirma —
 * nunca aqui. Renova automaticamente até o cliente cancelar no portal.
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

    const amount = PRICE_AMOUNT[plan][billing];
    const periodLabel = billing === 'annual' ? 'Anual' : 'Mensal';

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

    // Valida o customer salvo: se foi criado em OUTRO modo (ex: cus_ de teste
    // e agora estamos em live) ou foi deletado, o Stripe não acha → recriamos.
    if (customerId) {
      try {
        const existing = await stripe.customers.retrieve(customerId);
        if ((existing as { deleted?: boolean }).deleted) customerId = null;
      } catch {
        customerId = null; // não existe neste modo (test↔live) → recria abaixo
      }
    }

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
      payment_method_types: ['card'], // recorrência: só cartão
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'brl',
            unit_amount: amount,
            recurring: { interval: stripeInterval(billing) },
            product_data: {
              name: `${PLAN_LABEL[plan]} — ${periodLabel}`,
            },
          },
        },
      ],
      allow_promotion_codes: true,
      subscription_data: {
        metadata: { userId: user.id, plan, billing },
      },
      success_url: `${base}/tools?upgraded=1`,
      cancel_url: `${base}/planos?canceled=1`,
      metadata: { userId: user.id, plan, billing },
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
