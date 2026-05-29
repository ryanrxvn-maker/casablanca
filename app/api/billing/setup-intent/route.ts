import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { serviceClient } from '@/app/api/admin/_helpers';
import { getStripe } from '@/lib/stripe';

/**
 * POST /api/billing/setup-intent
 *
 * Cria um SetupIntent pro cliente logado salvar um cartão novo com segurança
 * (o número vai direto do browser pro Stripe via Elements; nunca passa aqui).
 * Devolve { clientSecret }.
 */

export const runtime = 'nodejs';

export async function POST() {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Faça login.' }, { status: 401 });

    const svc = serviceClient();
    const { data: profile } = await svc
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', user.id)
      .maybeSingle();
    const customerId = (profile as { stripe_customer_id?: string | null } | null)
      ?.stripe_customer_id;
    if (!customerId) {
      return NextResponse.json(
        { error: 'Você ainda não tem uma assinatura.' },
        { status: 400 },
      );
    }

    const stripe = getStripe();
    const intent = await stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ['card'],
      usage: 'off_session',
    });

    return NextResponse.json({ clientSecret: intent.client_secret });
  } catch (e) {
    return NextResponse.json(
      { error: 'Falha ao iniciar atualização.', detail: e instanceof Error ? e.message.slice(0, 300) : String(e) },
      { status: 500 },
    );
  }
}
