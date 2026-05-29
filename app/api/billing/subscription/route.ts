import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { createClient } from '@/lib/supabase/server';
import { serviceClient } from '@/app/api/admin/_helpers';
import { getStripe } from '@/lib/stripe';

/**
 * GET /api/billing/subscription
 *
 * Dados da assinatura do usuário logado pra a tela nativa "Minha assinatura":
 * plano, valor, próxima cobrança, cartão, status (incl. cancelamento agendado)
 * e histórico de faturas (com link do comprovante). Só leitura.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type SubLike = Stripe.Subscription & {
  current_period_end?: number;
  cancel_at_period_end?: boolean;
  default_payment_method?: Stripe.PaymentMethod | string | null;
  metadata: Record<string, string>;
};

export async function GET() {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Faça login.' }, { status: 401 });

    const svc = serviceClient();
    const { data: profile } = await svc
      .from('profiles')
      .select('stripe_customer_id, stripe_subscription_id, subscription_status, tier')
      .eq('id', user.id)
      .maybeSingle();

    const p = profile as {
      stripe_customer_id?: string | null;
      stripe_subscription_id?: string | null;
      subscription_status?: string | null;
      tier?: string | null;
    } | null;

    const customerId = p?.stripe_customer_id ?? null;
    const subId = p?.stripe_subscription_id ?? null;

    if (!subId) {
      // Pode ser acesso admin_grant ou nenhum — sem assinatura recorrente.
      return NextResponse.json({
        subscription: null,
        tier: p?.tier ?? 'free',
        status: p?.subscription_status ?? null,
      });
    }

    const stripe = getStripe();
    const sub = (await stripe.subscriptions.retrieve(subId, {
      expand: ['default_payment_method', 'items.data.price'],
    })) as SubLike;

    const item = sub.items?.data?.[0];
    const price = item?.price;
    const pm =
      sub.default_payment_method && typeof sub.default_payment_method !== 'string'
        ? sub.default_payment_method
        : null;
    const card = pm?.card
      ? {
          brand: pm.card.brand,
          last4: pm.card.last4,
          exp_month: pm.card.exp_month,
          exp_year: pm.card.exp_year,
        }
      : null;

    // Histórico de faturas com comprovante
    let invoices: Array<{
      id: string;
      amount: number;
      currency: string;
      created: number;
      status: string | null;
      url: string | null;
    }> = [];
    if (customerId) {
      const list = await stripe.invoices.list({ customer: customerId, limit: 12 });
      invoices = list.data.map((inv) => ({
        id: inv.id ?? '',
        amount: inv.amount_paid ?? inv.amount_due ?? 0,
        currency: inv.currency ?? 'brl',
        created: inv.created,
        status: inv.status ?? null,
        url: (inv as { hosted_invoice_url?: string | null }).hosted_invoice_url ?? null,
      }));
    }

    return NextResponse.json({
      subscription: {
        id: sub.id,
        status: sub.status,
        plan: sub.metadata?.plan ?? p?.tier ?? null,
        billing: sub.metadata?.billing ?? null,
        amount: price?.unit_amount ?? null,
        currency: price?.currency ?? 'brl',
        interval: price?.recurring?.interval ?? null,
        current_period_end: sub.current_period_end ?? null,
        cancel_at_period_end: sub.cancel_at_period_end ?? false,
        card,
      },
      invoices,
      tier: p?.tier ?? 'free',
    });
  } catch (e) {
    return NextResponse.json(
      { error: 'Falha ao carregar assinatura.', detail: e instanceof Error ? e.message.slice(0, 300) : String(e) },
      { status: 500 },
    );
  }
}
