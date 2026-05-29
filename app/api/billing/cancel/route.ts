import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { serviceClient } from '@/app/api/admin/_helpers';
import { getStripe } from '@/lib/stripe';

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
      .select('stripe_subscription_id')
      .eq('id', user.id)
      .maybeSingle();
    const subId = (profile as { stripe_subscription_id?: string | null } | null)
      ?.stripe_subscription_id;
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
