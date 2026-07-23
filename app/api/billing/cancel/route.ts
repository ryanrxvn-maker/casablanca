import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { serviceClient } from '@/app/api/admin/_helpers';
import { getStripe } from '@/lib/stripe';
import { findLiveStripeSubscription } from '@/lib/billing-reconcile';

/**
 * POST /api/billing/cancel
 * body: { action: 'cancel' | 'reactivate' }
 *
 * Cancela no fim do período (mantém acesso até lá) ou desfaz o cancelamento.
 * Só o dono da assinatura. O webhook customer.subscription.updated/deleted
 * cuida de rebaixar o tier quando o período acabar.
 */

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Faça login.' }, { status: 401 });

    const body = (await req.json().catch(() => null)) as { action?: string } | null;
    const action = body?.action;
    if (action !== 'cancel' && action !== 'reactivate') {
      return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 });
    }

    const svc = serviceClient();
    const { data: profile } = await svc
      .from('profiles')
      .select('stripe_subscription_id, stripe_customer_id')
      .eq('id', user.id)
      .maybeSingle();
    const p = profile as {
      stripe_subscription_id?: string | null;
      stripe_customer_id?: string | null;
    } | null;
    let subId = p?.stripe_subscription_id ?? null;

    // Vínculo perdido (webhook falhou / cortesia por cima)? Busca a assinatura
    // VIVA direto no Stripe — cancelar TEM que funcionar mesmo assim (caso
    // Fernando: "cancelava" e o cartão continuava sendo cobrado).
    if (!subId) {
      try {
        const found = await findLiveStripeSubscription(p?.stripe_customer_id, user.email);
        if (found) {
          subId = found.sub.id;
          await svc
            .from('profiles')
            .update({
              stripe_customer_id: found.customerId,
              stripe_subscription_id: subId,
            })
            .eq('id', user.id);
        }
      } catch {
        /* Stripe indisponível — cai no erro padrão abaixo */
      }
    }

    if (!subId) {
      return NextResponse.json(
        { error: 'Você não tem uma assinatura ativa.' },
        { status: 400 },
      );
    }

    const stripe = getStripe();
    const updated = await stripe.subscriptions.update(subId, {
      cancel_at_period_end: action === 'cancel',
    });

    return NextResponse.json({
      ok: true,
      cancel_at_period_end: (updated as { cancel_at_period_end?: boolean }).cancel_at_period_end ?? false,
    });
  } catch (e) {
    return NextResponse.json(
      { error: 'Falha na operação.', detail: e instanceof Error ? e.message.slice(0, 300) : String(e) },
      { status: 500 },
    );
  }
}
