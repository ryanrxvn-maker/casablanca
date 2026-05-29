import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { serviceClient } from '@/app/api/admin/_helpers';
import { getStripe } from '@/lib/stripe';

/**
 * POST /api/billing/portal
 *
 * Abre o Customer Portal do Stripe pra o usuário gerenciar/cancelar a
 * própria assinatura. Exige login + ter um stripe_customer_id.
 */

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Faça login.' }, { status: 401 });
    }

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
        { error: 'Você ainda não tem assinatura.' },
        { status: 400 },
      );
    }

    const base =
      (process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') ||
        req.headers.get('origin') ||
        '').replace(/\/$/, '');

    const stripe = getStripe();
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${base}/configuracoes`,
    });

    return NextResponse.json({ url: session.url });
  } catch (e) {
    return NextResponse.json(
      {
        error: 'Falha ao abrir portal.',
        detail: e instanceof Error ? e.message.slice(0, 300) : String(e),
      },
      { status: 500 },
    );
  }
}
