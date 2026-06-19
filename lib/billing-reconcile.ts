import type Stripe from 'stripe';
import { getStripe } from '@/lib/stripe';
import { serviceClient } from '@/app/api/admin/_helpers';
import {
  PRICE_AMOUNT,
  periodEndFrom,
  isPaidTier,
  type PaidTier,
  type Billing,
} from '@/lib/plan-prices';

/**
 * RECONCILIAÇÃO DE COBRANÇA — rede de segurança INDEPENDENTE do webhook.
 *
 * Olha o estado REAL no Stripe (assinaturas + pagamentos do customer) e
 * aplica o tier correto no profile. Roda com SERVICE_ROLE (bypassa o trigger
 * anti-escalada, igual ao webhook). É o seguro contra "pagou e continuou free":
 * se o webhook não chegou/falhou, isto conserta na volta do checkout
 * (success_url) e via botão admin.
 *
 * GARANTIA: só CONCEDE acesso (nunca rebaixa). Quem rebaixa é o webhook
 * (past_due/canceled) + a expiração no middleware. Assim, um acesso liberado
 * na mão pelo admin (admin_grant, sem assinatura no Stripe) NUNCA é removido
 * por engano daqui.
 */

export type ReconcileResult = {
  applied: boolean;
  tier: 'free' | 'basic' | 'pro' | 'admin';
  reason: string;
  source: 'subscription' | 'one_time' | 'admin' | 'none';
};

/** Mapeia um valor (centavos) de volta pro plano. Fallback quando falta o
 *  metadata.plan na assinatura/sessão (não depende de o checkout ter gravado). */
function planFromAmount(amount?: number | null): PaidTier | null {
  if (amount == null) return null;
  const tiers: PaidTier[] = ['basic', 'pro'];
  const cycles: Billing[] = ['monthly', 'annual'];
  for (const t of tiers)
    for (const c of cycles) if (PRICE_AMOUNT[t][c] === amount) return t;
  return null;
}

const PLAN_RANK: Record<PaidTier, number> = { basic: 1, pro: 2 };

/** Resolve o plano pago de uma subscription: metadata.plan ou, faltando, pelo
 *  valor do item. Não depende de o checkout ter gravado metadata. */
function planOfSub(sub: unknown): PaidTier | null {
  const s = sub as {
    metadata?: { plan?: string };
    items?: { data?: Array<{ price?: { unit_amount?: number | null } }> };
  };
  const mp = s.metadata?.plan ?? '';
  if (isPaidTier(mp)) return mp;
  return planFromAmount(s.items?.data?.[0]?.price?.unit_amount);
}

/** Fim do período de uma assinatura. Na API Basil (2025-03-31+) o campo saiu
 *  do objeto Subscription e foi pros items — lemos do item com fallback. */
export function stripeSubPeriodEndISO(sub: unknown): string | null {
  const s = sub as {
    current_period_end?: number;
    items?: { data?: Array<{ current_period_end?: number }> };
  };
  const fromItem = s.items?.data?.[0]?.current_period_end;
  const ts =
    typeof fromItem === 'number'
      ? fromItem
      : typeof s.current_period_end === 'number'
        ? s.current_period_end
        : null;
  return ts ? new Date(ts * 1000).toISOString() : null;
}

/**
 * Reconcilia o acesso pago de um usuário com o Stripe. Idempotente.
 * Retorna o que foi aplicado (ou por que não aplicou).
 */
export async function reconcileUserBilling(
  userId: string,
): Promise<ReconcileResult> {
  const svc = serviceClient();
  const { data: profile } = await svc
    .from('profiles')
    .select('stripe_customer_id, tier, is_admin')
    .eq('id', userId)
    .maybeSingle();

  const prof = profile as {
    stripe_customer_id?: string | null;
    tier?: string | null;
    is_admin?: boolean | null;
  } | null;

  if (prof?.is_admin) {
    return { applied: false, tier: 'admin', reason: 'conta admin', source: 'admin' };
  }

  const currentTier = (prof?.tier as ReconcileResult['tier']) ?? 'free';
  const customerId = prof?.stripe_customer_id ?? null;
  if (!customerId) {
    return {
      applied: false,
      tier: currentTier,
      reason: 'sem stripe_customer_id (cliente nunca iniciou checkout)',
      source: 'none',
    };
  }

  const stripe = getStripe();

  // ── 1) Assinatura recorrente que CONCEDE acesso? ───────────────────────
  const subs = await stripe.subscriptions.list({
    customer: customerId,
    status: 'all',
    limit: 10,
  });

  // Entre as ativas/trial, escolhe o MELHOR plano (pro > basic) — determinístico.
  // (Cliente que deu upgrade basic→pro pode ter 2 subs ativas por um tempo; sem
  // isso o .find() poderia gravar 'basic' enquanto a 'pro' real está ativa.)
  let best: { sub: Stripe.Subscription; plan: PaidTier } | null = null;
  for (const s of subs.data) {
    if (s.status !== 'active' && s.status !== 'trialing') continue;
    const plan = planOfSub(s);
    if (!plan) continue;
    if (!best || PLAN_RANK[plan] > PLAN_RANK[best.plan]) best = { sub: s, plan };
  }

  // Resgate: sub ainda 'incomplete'/'past_due' mas cuja fatura JÁ foi paga
  // (cliente voltou do checkout antes do Stripe marcar 'active'). Concede.
  if (!best) {
    const pending = subs.data.find(
      (s) => s.status === 'incomplete' || s.status === 'past_due',
    );
    if (pending) {
      try {
        const full = await stripe.subscriptions.retrieve(pending.id, {
          expand: ['latest_invoice'],
        });
        const inv = (full as unknown as { latest_invoice?: unknown })
          .latest_invoice;
        const invObj =
          inv && typeof inv === 'object'
            ? (inv as { status?: string; paid?: boolean })
            : null;
        const invoicePaid =
          !!invObj && (invObj.status === 'paid' || invObj.paid === true);
        const plan = planOfSub(full);
        if (invoicePaid && plan) best = { sub: full, plan };
      } catch {
        /* sem resgate agora */
      }
    }
  }

  if (best) {
    await svc
      .from('profiles')
      .update({
        stripe_customer_id: customerId,
        stripe_subscription_id: best.sub.id,
        subscription_status: best.sub.status,
        subscription_plan: best.plan,
        tier: best.plan,
        current_period_end: stripeSubPeriodEndISO(best.sub),
      })
      .eq('id', userId);
    return {
      applied: true,
      tier: best.plan,
      reason: `assinatura ${best.sub.status} (${best.plan})`,
      source: 'subscription',
    };
  }

  // ── 2) Pagamento único recente e VIGENTE? (anual parcelável) ───────────
  const sessions = await stripe.checkout.sessions.list({
    customer: customerId,
    limit: 10,
  });
  const paid = sessions.data
    .filter((s) => s.mode === 'payment' && s.payment_status === 'paid')
    .sort((a, b) => (b.created ?? 0) - (a.created ?? 0))[0];
  if (paid) {
    const metaPlan = (paid.metadata?.plan ?? '') as string;
    const plan = isPaidTier(metaPlan) ? metaPlan : planFromAmount(paid.amount_total);
    const billing: Billing =
      paid.metadata?.billing === 'monthly' ? 'monthly' : 'annual';
    if (plan && isPaidTier(plan)) {
      const start = paid.created ? new Date(paid.created * 1000) : new Date();
      const end = periodEndFrom(billing, start);
      if (end.getTime() > Date.now()) {
        await svc
          .from('profiles')
          .update({
            stripe_customer_id: customerId,
            stripe_subscription_id: null,
            subscription_status: 'paid',
            subscription_plan: plan,
            tier: plan,
            current_period_end: end.toISOString(),
          })
          .eq('id', userId);
        return {
          applied: true,
          tier: plan,
          reason: `pagamento único vigente (${plan}, ${billing})`,
          source: 'one_time',
        };
      }
    }
  }

  return {
    applied: false,
    tier: currentTier,
    reason: 'nenhuma assinatura/pagamento vigente no Stripe',
    source: 'none',
  };
}
