import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { createClient } from '@/lib/supabase/server';
import { serviceClient } from '@/app/api/admin/_helpers';
import { getStripe } from '@/lib/stripe';
import {
  findLiveStripeSubscription,
  reconcileUserBilling,
} from '@/lib/billing-reconcile';

/**
 * POST /api/billing/retry-payment
 *
 * "Tentar cobrar de novo" da tela Minha assinatura: quando a renovação falhou
 * (past_due/unpaid — acesso SUSPENSO), o cliente clica e a fatura em aberto é
 * cobrada NA HORA no cartão padrão (o que já está salvo, ou o novo que ele
 * acabou de trocar). Pagou → reconcilia com o Stripe e o acesso volta no
 * mesmo request (sem esperar webhook).
 *
 * Respostas de erro sempre AMIGÁVEIS com `code` pra UI decidir o próximo
 * passo (ex.: card_declined → abre a troca de cartão).
 * Só o dono da assinatura; acha a assinatura viva por customer/EMAIL mesmo
 * com vínculo perdido (mesmo padrão do cancel — caso Fernando).
 */

export const runtime = 'nodejs';
export const maxDuration = 30;

type SubLike = Stripe.Subscription & {
  latest_invoice?: Stripe.Invoice | string | null;
};

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
      .select('stripe_subscription_id, stripe_customer_id')
      .eq('id', user.id)
      .maybeSingle();
    const p = profile as {
      stripe_subscription_id?: string | null;
      stripe_customer_id?: string | null;
    } | null;

    const stripe = getStripe();

    // Assinatura VIVA (inclui past_due) — cura o vínculo se estiver perdido.
    let subId = p?.stripe_subscription_id ?? null;
    let sub: SubLike | null = null;
    if (subId) {
      try {
        sub = (await stripe.subscriptions.retrieve(subId, {
          expand: ['latest_invoice'],
        })) as SubLike;
        if (sub.status === 'canceled' || sub.status === 'incomplete_expired') {
          sub = null; // morta — procura outra viva abaixo
        }
      } catch {
        sub = null; // id inválido/deletado — procura pela busca viva
      }
    }
    if (!sub) {
      const found = await findLiveStripeSubscription(
        p?.stripe_customer_id,
        user.email,
      ).catch(() => null);
      if (found) {
        subId = found.sub.id;
        sub = (await stripe.subscriptions.retrieve(found.sub.id, {
          expand: ['latest_invoice'],
        })) as SubLike;
        await svc
          .from('profiles')
          .update({
            stripe_customer_id: found.customerId,
            stripe_subscription_id: found.sub.id,
          })
          .eq('id', user.id);
      }
    }

    if (!sub) {
      return NextResponse.json(
        {
          error:
            'Sua assinatura não está mais ativa no Stripe. Assine de novo pra reativar o acesso.',
          code: 'no_subscription',
        },
        { status: 400 },
      );
    }

    // Já está em dia (pagou por fora / webhook atrasou)? Só reconcilia.
    if (sub.status === 'active' || sub.status === 'trialing') {
      const rec = await reconcileUserBilling(user.id);
      return NextResponse.json({ ok: true, already: true, tier: rec.tier });
    }

    // Fatura em aberto da assinatura.
    const latest =
      sub.latest_invoice && typeof sub.latest_invoice === 'object'
        ? (sub.latest_invoice as Stripe.Invoice)
        : null;
    let invoice: Stripe.Invoice | null =
      latest && (latest.status === 'open' || latest.status === 'uncollectible')
        ? latest
        : null;
    if (!invoice && subId) {
      const list = await stripe.invoices.list({
        subscription: subId,
        status: 'open',
        limit: 1,
      });
      invoice = list.data[0] ?? null;
    }

    if (!invoice) {
      // Nada em aberto: se a fatura já foi paga, a reconciliação resolve.
      const rec = await reconcileUserBilling(user.id);
      if (rec.applied || rec.tier === 'basic' || rec.tier === 'pro') {
        return NextResponse.json({ ok: true, already: true, tier: rec.tier });
      }
      return NextResponse.json(
        {
          error:
            'Não achei uma cobrança em aberto pra tentar de novo. Se o problema continuar, fala com a gente.',
          code: 'no_open_invoice',
        },
        { status: 400 },
      );
    }

    // Cobra AGORA no cartão padrão.
    try {
      await stripe.invoices.pay(invoice.id as string);
    } catch (payErr) {
      const err = payErr as {
        type?: string;
        code?: string;
        message?: string;
        raw?: { message?: string };
      };
      const code = err?.code ?? '';
      if (code === 'invoice_payment_intent_requires_action') {
        return NextResponse.json(
          {
            error:
              'O banco pediu uma verificação extra que não dá pra fazer automático. Troca o cartão (ou cadastra o mesmo de novo) que a cobrança passa na validação.',
            code: 'requires_action',
          },
          { status: 402 },
        );
      }
      if (err?.type === 'StripeCardError' || code === 'card_declined') {
        return NextResponse.json(
          {
            error:
              'O cartão foi recusado de novo. Confere com o banco se está liberado pra compras online — ou troca o cartão aqui embaixo e tenta outra vez.',
            code: 'card_declined',
          },
          { status: 402 },
        );
      }
      throw payErr;
    }

    // Pagou → acesso volta AGORA (sem depender do webhook).
    const rec = await reconcileUserBilling(user.id);
    return NextResponse.json({ ok: true, paid: true, tier: rec.tier });
  } catch (e) {
    return NextResponse.json(
      {
        error: 'Não consegui concluir a cobrança agora. Tenta de novo em instantes.',
        detail: e instanceof Error ? e.message.slice(0, 300) : String(e),
      },
      { status: 500 },
    );
  }
}
