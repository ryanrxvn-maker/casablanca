import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { serviceClient } from '@/app/api/admin/_helpers';
import { getStripe } from '@/lib/stripe';
import { findLiveStripeSubscription } from '@/lib/billing-reconcile';
import { rateLimit } from '@/lib/rate-limit';
import { notifyOwner } from '@/lib/notify';
import {
  cancelSubscriptionNow,
  checkRefund,
  refundAndCancelNow,
  refundBlockText,
  scheduleCancelAtPeriodEnd,
} from '@/lib/billing-refund';

/**
 * POST /api/billing/cancel
 * body: { action: 'cancel' | 'reactivate', keepAccess?: boolean }
 *
 * Política (09.10):
 *   • cancel até 7 dias da ÚLTIMA cobrança → reembolso automático do valor
 *     inteiro + assinatura encerrada no Stripe + Premium acaba na hora.
 *     (`keepAccess: true` = o cliente prefere só desligar a renovação e usar
 *     até o fim do período, abrindo mão do reembolso.)
 *   • cancel depois dos 7 dias → sem reembolso; renovação desligada e acesso
 *     até a próxima data de cobrança (que não acontece).
 *   • reactivate → desfaz o cancelamento AGENDADO (o encerrado não volta).
 *
 * Também vale pra quem já tinha agendado o cancelamento e ainda está nos
 * 7 dias: chamar 'cancel' de novo devolve e encerra agora.
 */

export const runtime = 'nodejs';
export const maxDuration = 30;

const LIVE = new Set(['active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused']);

function periodEndISO(sub: unknown): string | null {
  const s = sub as {
    cancel_at?: number | null;
    current_period_end?: number;
    items?: { data?: Array<{ current_period_end?: number }> };
  };
  const end = s.cancel_at ?? s.items?.data?.[0]?.current_period_end ?? s.current_period_end ?? null;
  return end ? new Date(end * 1000).toISOString() : null;
}

export async function POST(req: Request) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Faça login.' }, { status: 401 });

    if (!rateLimit(`billing-cancel:${user.id}`, 6, 60_000)) {
      return NextResponse.json(
        { error: 'Muitas tentativas. Espere um minuto e tente de novo.' },
        { status: 429 },
      );
    }

    const body = (await req.json().catch(() => null)) as {
      action?: string;
      keepAccess?: boolean;
    } | null;
    const action = body?.action;
    if (action !== 'cancel' && action !== 'reactivate') {
      return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 });
    }
    const keepAccess = body?.keepAccess === true;

    const svc = serviceClient();
    const { data: profile } = await svc
      .from('profiles')
      .select('stripe_subscription_id, stripe_customer_id, subscription_status, current_period_end, email')
      .eq('id', user.id)
      .maybeSingle();
    const p = profile as {
      stripe_subscription_id?: string | null;
      stripe_customer_id?: string | null;
      subscription_status?: string | null;
      current_period_end?: string | null;
      email?: string | null;
    } | null;
    const email = user.email ?? p?.email ?? null;
    let subId = p?.stripe_subscription_id ?? null;
    let customerId = p?.stripe_customer_id ?? null;

    // Vínculo perdido (webhook falhou / cortesia por cima)? Busca a assinatura
    // VIVA direto no Stripe — cancelar TEM que funcionar mesmo assim (caso
    // Fernando: "cancelava" e o cartão continuava sendo cobrado).
    if (!subId) {
      try {
        const found = await findLiveStripeSubscription(customerId, email);
        if (found) {
          subId = found.sub.id;
          customerId = found.customerId;
          await svc
            .from('profiles')
            .update({ stripe_customer_id: customerId, stripe_subscription_id: subId })
            .eq('id', user.id);
        }
      } catch {
        /* Stripe indisponível — cai no erro padrão abaixo */
      }
    }

    const stripe = getStripe();

    // ── Plano anual (pagamento único, sem assinatura) ─────────────────────
    if (!subId) {
      if (action === 'cancel' && p?.subscription_status === 'paid' && customerId) {
        const check = await checkRefund({ userId: user.id, email, customerId, subId: null });
        if (check.eligible && !keepAccess) {
          const r = await refundAndCancelNow({
            userId: user.id,
            email,
            customerId,
            subId: null,
            charge: check.charge,
            by: 'customer',
          });
          return NextResponse.json({ ok: true, mode: 'refunded', refunded: r.refunded || check.charge.amount });
        }
        const until = p.current_period_end
          ? new Date(p.current_period_end).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
          : 'o fim do período';
        return NextResponse.json(
          {
            error: check.eligible
              ? `Seu plano anual não tem renovação automática: o acesso continua até ${until}.`
              : `Seu plano anual não tem renovação automática: o acesso continua até ${until}. ` +
                `Sem reembolso automático porque ${refundBlockText(check.reason, check.charge)}.`,
          },
          { status: 400 },
        );
      }
      return NextResponse.json({ error: 'Você não tem uma assinatura ativa.' }, { status: 400 });
    }

    const sub = await stripe.subscriptions.retrieve(subId);
    const live = LIVE.has(sub.status);

    if (action === 'reactivate') {
      if (!live) {
        return NextResponse.json(
          { error: 'Essa assinatura já foi encerrada. Pra voltar, assine de novo em Planos.' },
          { status: 400 },
        );
      }
      const updated = await stripe.subscriptions.update(subId, { cancel_at_period_end: false });
      // O dono fica sabendo: um "desfazer" por engano é o que faz o cliente
      // jurar que cancelou com a assinatura ativa no Stripe.
      await notifyOwner(
        '🔁 Cliente desfez o cancelamento',
        `<p><b>Cliente:</b> ${email ?? user.id}<br>A assinatura ${subId} voltou a renovar normalmente.</p>`,
      ).catch(() => {});
      return NextResponse.json({
        ok: true,
        mode: 'reactivated',
        cancel_at_period_end: updated.cancel_at_period_end ?? false,
      });
    }

    // ── cancel ───────────────────────────────────────────────────────────
    const check = await checkRefund({ userId: user.id, email, customerId, subId });

    // O reembolso já saiu numa tentativa anterior mas o encerramento não
    // terminou: só completa — nunca devolve 2×.
    if (!check.eligible && check.reason === 'already_refunded' && live && check.charge) {
      const r = await refundAndCancelNow({
        userId: user.id,
        email,
        customerId,
        subId,
        charge: check.charge,
        by: 'customer',
      });
      return NextResponse.json({ ok: true, mode: 'refunded', refunded: r.charge.amount });
    }

    if (!live) {
      return NextResponse.json({ ok: true, mode: 'ended' });
    }

    if (check.eligible && !keepAccess) {
      const r = await refundAndCancelNow({
        userId: user.id,
        email,
        customerId,
        subId,
        charge: check.charge,
        by: 'customer',
      });
      return NextResponse.json({ ok: true, mode: 'refunded', refunded: r.refunded || check.charge.amount });
    }

    // Renovação RECUSADA (past_due/unpaid/incomplete): o período atual não
    // foi pago e o acesso já está suspenso. Agendar pro "fim do período"
    // deixaria o Stripe re-tentando cobrar o cartão até lá — encerra agora.
    if (sub.status === 'past_due' || sub.status === 'unpaid' || sub.status === 'incomplete') {
      await cancelSubscriptionNow(stripe, subId, 'Cancelada pelo cliente com a renovação pendente (não paga)');
      await svc
        .from('profiles')
        .update({ subscription_status: 'canceled', subscription_plan: null, tier: 'free' })
        .eq('id', user.id);
      return NextResponse.json({ ok: true, mode: 'ended' });
    }

    // Sem reembolso: desliga a renovação, acesso até o fim do período pago.
    const why = check.eligible
      ? 'o cliente escolheu usar até o fim do período (abriu mão do reembolso)'
      : refundBlockText(check.reason, check.charge);
    const accessUntil = sub.cancel_at_period_end
      ? periodEndISO(sub)
      : (await scheduleCancelAtPeriodEnd({ subId, email, userId: user.id, why, by: 'customer' })).accessUntil;

    return NextResponse.json({
      ok: true,
      mode: 'scheduled',
      access_until: accessUntil,
      no_refund_reason: check.eligible ? 'kept_access' : check.reason,
      cancel_at_period_end: true,
    });
  } catch (e) {
    console.error('[billing cancel]', e);
    return NextResponse.json(
      {
        error: 'Não deu pra concluir agora. Tente de novo em instantes.',
        detail: e instanceof Error ? e.message.slice(0, 300) : String(e),
      },
      { status: 500 },
    );
  }
}
