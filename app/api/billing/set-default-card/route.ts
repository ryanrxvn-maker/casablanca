import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { serviceClient } from '@/app/api/admin/_helpers';
import { getStripe } from '@/lib/stripe';

/**
 * POST /api/billing/set-default-card
 * body: { paymentMethodId: string }
 *
 * Depois que o Elements confirma o SetupIntent (cartão salvo), define o novo
 * cartão como padrão do cliente E da assinatura, pra as próximas cobranças
 * usarem ele. Valida que o payment method pertence ao customer do usuário.
 */

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Faça login.' }, { status: 401 });

    const body = (await req.json().catch(() => null)) as { paymentMethodId?: string } | null;
    const pmId = body?.paymentMethodId;
    if (!pmId) return NextResponse.json({ error: 'Cartão inválido.' }, { status: 400 });

    const svc = serviceClient();
    const { data: profile } = await svc
      .from('profiles')
      .select('stripe_customer_id, stripe_subscription_id')
      .eq('id', user.id)
      .maybeSingle();
    const p = profile as {
      stripe_customer_id?: string | null;
      stripe_subscription_id?: string | null;
    } | null;
    const customerId = p?.stripe_customer_id;
    if (!customerId) {
      return NextResponse.json({ error: 'Sem cliente Stripe.' }, { status: 400 });
    }

    const stripe = getStripe();

    // Segurança: o payment method tem que pertencer a ESTE customer.
    const pm = await stripe.paymentMethods.retrieve(pmId);
    const pmCustomer = typeof pm.customer === 'string' ? pm.customer : pm.customer?.id;
    if (pmCustomer !== customerId) {
      return NextResponse.json({ error: 'Cartão não pertence à sua conta.' }, { status: 403 });
    }

    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: pmId },
    });
    if (p?.stripe_subscription_id) {
      await stripe.subscriptions.update(p.stripe_subscription_id, {
        default_payment_method: pmId,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: 'Falha ao definir cartão.', detail: e instanceof Error ? e.message.slice(0, 300) : String(e) },
      { status: 500 },
    );
  }
}
