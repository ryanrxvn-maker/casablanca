import type Stripe from 'stripe';
import { getStripe } from '@/lib/stripe';
import { serviceClient } from '@/app/api/admin/_helpers';
import { notifyOwner, brlFromCents } from '@/lib/notify';

/**
 * CANCELAMENTO COM REEMBOLSO AUTOMÁTICO (política 09.10).
 *
 *   • Cancelou até 7 dias (168 h) depois da ÚLTIMA cobrança → o valor dessa
 *     cobrança volta inteiro pro cartão, a assinatura é encerrada no Stripe
 *     na hora e o Premium acaba na hora.
 *   • Passou dos 7 dias → sem reembolso: a renovação é desligada
 *     (cancel_at_period_end) e o acesso continua até a próxima cobrança, que
 *     não acontece.
 *
 * Exemplo do dono: debitou no dia 7 → cancelando até o dia 14 (mesmo
 * horário) devolve; depois disso, fica Premium até a próxima data de cobrança.
 *
 * Trava anti-abuso: o reembolso AUTOMÁTICO vale uma vez por pessoa (mesmo
 * customer ou mesmo email). Assinar → usar 6 dias → cancelar → assinar de
 * novo virava uso grátis infinito. Quem já foi reembolsado antes cai no
 * cancelamento normal (fim do período) e o dono é avisado; o admin ainda pode
 * reembolsar na mão pelo painel (`refundAndCancelNow` com by='admin').
 *
 * Idempotência: o reembolso usa idempotency key por pagamento e, antes de
 * reembolsar, olha se a cobrança JÁ foi devolvida. Reembolsou e o cancelamento
 * falhou? Repetir a operação só termina o cancelamento — nunca devolve 2×.
 */

export const REFUND_WINDOW_DAYS = 7;
export const REFUND_WINDOW_MS = REFUND_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/** A cobrança que o reembolso devolveria: a última PAGA (assinatura ou anual). */
export type LastCharge = {
  kind: 'subscription' | 'one_time';
  invoiceId: string | null; // assinatura: a fatura paga
  sessionId: string | null; // anual: a checkout session
  paymentIntentId: string | null;
  chargeId: string | null;
  amount: number; // centavos cobrados
  amountRefunded: number;
  disputed: boolean;
  paidAt: number; // ms
  refundDeadline: number; // ms — depois disto, sem reembolso automático
};

export type RefundBlock =
  | 'no_charge' // nenhuma cobrança paga achada
  | 'free_charge' // cobrança de R$ 0 (cupom/cortesia) — nada a devolver
  | 'already_refunded' // essa cobrança já foi devolvida
  | 'disputed' // tem contestação aberta: o banco já está devolvendo
  | 'window_passed' // passou dos 7 dias
  | 'used_before'; // a pessoa já teve um reembolso antes

export type RefundCheck =
  | { eligible: true; charge: LastCharge }
  | { eligible: false; reason: RefundBlock; charge: LastCharge | null };

const isFullyRefunded = (c: Pick<LastCharge, 'amount' | 'amountRefunded'>) =>
  c.amount > 0 && c.amountRefunded >= c.amount;

const idOf = (ref: string | { id: string } | null | undefined): string | null =>
  !ref ? null : typeof ref === 'string' ? ref : ref.id;

/** Pagamento (PaymentIntent ou Charge) de uma fatura. Na API 'dahlia' a fatura
 *  não traz mais `payment_intent` no topo: vem pela lista de InvoicePayments. */
async function paymentOfInvoice(
  stripe: Stripe,
  inv: Stripe.Invoice,
): Promise<{ paymentIntentId: string | null; chargeId: string | null }> {
  try {
    const list = await stripe.invoicePayments.list({ invoice: inv.id!, status: 'paid', limit: 5 });
    for (const ip of list.data) {
      const pi = idOf(ip.payment?.payment_intent as string | { id: string } | null | undefined);
      const ch = idOf(ip.payment?.charge as string | { id: string } | null | undefined);
      if (pi || ch) return { paymentIntentId: pi, chargeId: ch };
    }
  } catch {
    /* cai no shape antigo abaixo */
  }
  const legacy = inv as unknown as {
    payment_intent?: string | { id: string } | null;
    charge?: string | { id: string } | null;
  };
  return { paymentIntentId: idOf(legacy.payment_intent), chargeId: idOf(legacy.charge) };
}

/** Estado de devolução de um pagamento (lido do Charge real). */
async function chargeState(
  stripe: Stripe,
  paymentIntentId: string | null,
  chargeId: string | null,
): Promise<{ charge: Stripe.Charge | null; chargeId: string | null }> {
  if (paymentIntentId) {
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ['latest_charge'] });
    const ch = pi.latest_charge && typeof pi.latest_charge !== 'string' ? pi.latest_charge : null;
    if (ch) return { charge: ch, chargeId: ch.id };
    const lid = idOf(pi.latest_charge as string | null);
    if (lid) return { charge: await stripe.charges.retrieve(lid), chargeId: lid };
  }
  if (chargeId) return { charge: await stripe.charges.retrieve(chargeId), chargeId };
  return { charge: null, chargeId: null };
}

/** Última cobrança PAGA de uma assinatura. R$ 0 só volta se não houver nenhuma paga de verdade. */
export async function lastSubscriptionCharge(
  stripe: Stripe,
  subId: string,
): Promise<LastCharge | null> {
  const invs = await stripe.invoices.list({ subscription: subId, status: 'paid', limit: 6 });
  const sorted = [...invs.data].sort((a, b) => (b.created ?? 0) - (a.created ?? 0));
  const inv = sorted.find((i) => (i.amount_paid ?? 0) > 0) ?? sorted[0];
  if (!inv) return null;

  const paidAtSec = inv.status_transitions?.paid_at ?? inv.created;
  if ((inv.amount_paid ?? 0) <= 0) {
    const paidAt = paidAtSec * 1000;
    return {
      kind: 'subscription',
      invoiceId: inv.id ?? null,
      sessionId: null,
      paymentIntentId: null,
      chargeId: null,
      amount: 0,
      amountRefunded: 0,
      disputed: false,
      paidAt,
      refundDeadline: paidAt + REFUND_WINDOW_MS,
    };
  }

  const pay = await paymentOfInvoice(stripe, inv);
  const { charge, chargeId } = await chargeState(stripe, pay.paymentIntentId, pay.chargeId);
  const paidAt = (paidAtSec ?? charge?.created ?? inv.created) * 1000;
  return {
    kind: 'subscription',
    invoiceId: inv.id ?? null,
    sessionId: null,
    paymentIntentId: pay.paymentIntentId,
    chargeId,
    amount: charge?.amount ?? inv.amount_paid ?? 0,
    amountRefunded: charge?.amount_refunded ?? 0,
    disputed: !!charge?.disputed,
    paidAt,
    refundDeadline: paidAt + REFUND_WINDOW_MS,
  };
}

/** Último pagamento ÚNICO pago (plano anual, checkout mode=payment). */
export async function lastOneTimeCharge(
  stripe: Stripe,
  customerId: string,
): Promise<LastCharge | null> {
  const sessions = await stripe.checkout.sessions.list({ customer: customerId, limit: 10 });
  const paid = sessions.data
    .filter((s) => s.mode === 'payment' && s.payment_status === 'paid')
    .sort((a, b) => (b.created ?? 0) - (a.created ?? 0))[0];
  if (!paid) return null;
  const piId = idOf(paid.payment_intent as string | { id: string } | null);
  const { charge, chargeId } = await chargeState(stripe, piId, null);
  const paidAt = (charge?.created ?? paid.created) * 1000;
  return {
    kind: 'one_time',
    invoiceId: null,
    sessionId: paid.id,
    paymentIntentId: piId,
    chargeId,
    amount: charge?.amount ?? paid.amount_total ?? 0,
    amountRefunded: charge?.amount_refunded ?? 0,
    disputed: !!charge?.disputed,
    paidAt,
    refundDeadline: paidAt + REFUND_WINDOW_MS,
  };
}

/**
 * A pessoa já recebeu um reembolso TOTAL antes (fora a cobrança atual)?
 * Olha o Stripe (todos os customers com o mesmo email) e o espelho `payments`.
 */
async function refundedBefore(
  stripe: Stripe,
  opts: { userId: string; email: string | null; customerId: string | null; except: LastCharge },
): Promise<boolean> {
  const customers = new Set<string>();
  if (opts.customerId) customers.add(opts.customerId);
  if (opts.email) {
    try {
      const found = await stripe.customers.list({ email: opts.email.trim(), limit: 5 });
      for (const c of found.data) customers.add(c.id);
    } catch {
      /* best-effort */
    }
  }
  for (const cid of Array.from(customers)) {
    try {
      const charges = await stripe.charges.list({ customer: cid, limit: 100 });
      const hit = charges.data.some(
        (c) =>
          c.refunded &&
          c.id !== opts.except.chargeId &&
          idOf(c.payment_intent as string | { id: string } | null) !== opts.except.paymentIntentId,
      );
      if (hit) return true;
    } catch {
      /* customer apagado / outro modo — segue */
    }
  }

  try {
    const svc = serviceClient();
    const ors = [`user_id.eq.${opts.userId}`];
    if (opts.email) ors.push(`email.ilike.${opts.email.trim().replace(/[,()]/g, '')}`);
    const { data } = await svc
      .from('payments')
      .select('stripe_checkout_session, stripe_payment_intent')
      .eq('status', 'refunded')
      .or(ors.join(','))
      .limit(10);
    const rows = (data ?? []) as Array<{ stripe_checkout_session: string | null; stripe_payment_intent: string | null }>;
    return rows.some(
      (r) =>
        r.stripe_checkout_session !== (opts.except.invoiceId ?? opts.except.sessionId) &&
        (!r.stripe_payment_intent || r.stripe_payment_intent !== opts.except.paymentIntentId),
    );
  } catch {
    return false;
  }
}

/** Decide se o cancelamento AGORA devolve a última cobrança. Não mexe em nada. */
export async function checkRefund(opts: {
  userId: string;
  email: string | null;
  customerId: string | null;
  subId: string | null;
  now?: number;
}): Promise<RefundCheck> {
  const stripe = getStripe();
  const now = opts.now ?? Date.now();
  const charge = opts.subId
    ? await lastSubscriptionCharge(stripe, opts.subId)
    : opts.customerId
      ? await lastOneTimeCharge(stripe, opts.customerId)
      : null;

  if (!charge) return { eligible: false, reason: 'no_charge', charge: null };
  if (charge.amount <= 0) return { eligible: false, reason: 'free_charge', charge };
  if (isFullyRefunded(charge)) return { eligible: false, reason: 'already_refunded', charge };
  if (charge.disputed) return { eligible: false, reason: 'disputed', charge };
  if (!charge.paymentIntentId && !charge.chargeId) return { eligible: false, reason: 'no_charge', charge };
  // Estritamente menos de 168 h: debitou dia 7 às 10h → até dia 14 às 9h59 devolve.
  if (now >= charge.refundDeadline) return { eligible: false, reason: 'window_passed', charge };
  if (
    await refundedBefore(stripe, {
      userId: opts.userId,
      email: opts.email,
      customerId: opts.customerId,
      except: charge,
    })
  ) {
    return { eligible: false, reason: 'used_before', charge };
  }
  return { eligible: true, charge };
}

const LIVE_STATUSES = new Set(['active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused']);

/** Encerra a assinatura no Stripe AGORA (idempotente: já encerrada = ok). */
export async function cancelSubscriptionNow(stripe: Stripe, subId: string, comment: string) {
  const sub = await stripe.subscriptions.retrieve(subId);
  if (!LIVE_STATUSES.has(sub.status)) return sub;
  try {
    return await stripe.subscriptions.cancel(subId, {
      cancellation_details: { comment: comment.slice(0, 500) },
    });
  } catch (e) {
    // Corrida (duplo clique / webhook): se já está encerrada, é sucesso.
    const again = await stripe.subscriptions.retrieve(subId).catch(() => null);
    if (again && !LIVE_STATUSES.has(again.status)) return again;
    throw e;
  }
}

export type RefundCancelResult = {
  refunded: number; // centavos devolvidos AGORA (0 = já estava devolvido)
  refundId: string | null;
  charge: LastCharge;
};

/**
 * Devolve a cobrança INTEIRA e encerra o acesso na hora.
 * Ordem: 1) reembolso (idempotente) → 2) encerra a assinatura → 3) profile
 * free → 4) comprovante marcado → 5) aviso ao dono. Se o passo 2+ falhar, o
 * dinheiro já voltou e repetir a chamada só completa o resto.
 */
export async function refundAndCancelNow(opts: {
  userId: string;
  email: string | null;
  customerId: string | null;
  subId: string | null;
  charge: LastCharge;
  by: 'customer' | 'admin';
  adminId?: string | null;
}): Promise<RefundCancelResult> {
  const stripe = getStripe();
  const { charge } = opts;
  const svc = serviceClient();

  // 1) Reembolso — só o que ainda não voltou; a chave impede devolver 2×.
  let refundId: string | null = null;
  let refunded = 0;
  const remaining = charge.amount - charge.amountRefunded;
  if (remaining > 0) {
    const refund = await stripe.refunds.create(
      {
        ...(charge.paymentIntentId ? { payment_intent: charge.paymentIntentId } : { charge: charge.chargeId! }),
        reason: 'requested_by_customer',
        metadata: {
          userId: opts.userId,
          source: opts.by === 'admin' ? 'admin_panel' : 'cancel_7_days',
          invoice: charge.invoiceId ?? '',
          session: charge.sessionId ?? '',
        },
      },
      { idempotencyKey: `autoedit-refund-${charge.paymentIntentId ?? charge.chargeId}` },
    );
    refundId = refund.id;
    refunded = refund.amount ?? remaining;
  }

  // 2) Encerra a assinatura (anual não tem).
  const comment =
    opts.by === 'admin'
      ? 'Cancelada e reembolsada pelo admin (painel Auto Edit)'
      : `Cancelada pelo cliente em até ${REFUND_WINDOW_DAYS} dias da cobrança — reembolso automático`;
  if (opts.subId) await cancelSubscriptionNow(stripe, opts.subId, comment);

  // 3) Acesso acaba AGORA — não espera o webhook.
  const { data, error } = await svc
    .from('profiles')
    .update({
      tier: 'free',
      subscription_status: 'refunded',
      subscription_plan: null,
      current_period_end: new Date().toISOString(),
    })
    .eq('id', opts.userId)
    .select('id');
  if (error || !data?.length) {
    await notifyOwner(
      '🚨 Reembolso feito, mas o perfil NÃO caiu pra Free',
      `<p>${opts.email ?? opts.userId}: o dinheiro voltou (${brlFromCents(refunded || charge.amount)}) ` +
        `mas o update do profile falhou (${error?.message ?? '0 linhas'}). O webhook ` +
        `customer.subscription.deleted deve rebaixar; confira no painel.</p>`,
    ).catch(() => {});
    throw new Error(`profile downgrade after refund failed: ${error?.message ?? '0 rows'}`);
  }

  // 4) Comprovante marcado como reembolsado (por fatura/sessão e por pagamento).
  try {
    const key = charge.invoiceId ?? charge.sessionId;
    if (key) await svc.from('payments').update({ status: 'refunded' }).eq('stripe_checkout_session', key);
    if (charge.paymentIntentId) {
      await svc.from('payments').update({ status: 'refunded' }).eq('stripe_payment_intent', charge.paymentIntentId);
    }
  } catch {
    /* o webhook charge.refunded também marca */
  }

  // Trilha no "Histórico de plano" do painel.
  try {
    await svc.from('tier_changes').insert({
      admin_id: opts.by === 'admin' ? opts.adminId ?? null : null,
      user_id: opts.userId,
      from_tier: 'basic',
      to_tier: 'free',
      reason:
        opts.by === 'admin'
          ? `Cancelado e reembolsado pelo admin (${brlFromCents(charge.amount)})`
          : `Cancelou em até ${REFUND_WINDOW_DAYS} dias — reembolso automático de ${brlFromCents(charge.amount)}`,
    });
  } catch {
    /* auditoria é best-effort */
  }

  await notifyOwner(
    `↩️ Cancelamento com reembolso · ${brlFromCents(refunded || charge.amount)}`,
    `<p><b>Cliente:</b> ${opts.email ?? opts.userId}<br>` +
      `<b>Quem fez:</b> ${opts.by === 'admin' ? 'admin (painel)' : 'o próprio cliente (7 dias)'}<br>` +
      `<b>Cobrança:</b> ${brlFromCents(charge.amount)} em ${new Date(charge.paidAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}<br>` +
      `<b>Devolvido agora:</b> ${brlFromCents(refunded)}${refunded === 0 ? ' (já estava devolvido)' : ''}<br>` +
      `<b>Assinatura:</b> ${opts.subId ?? '— (pagamento único)'} encerrada; acesso Premium encerrado.</p>`,
  ).catch(() => {});

  return { refunded, refundId, charge };
}

/**
 * Desliga a renovação: acesso continua até o fim do período pago e não há
 * nova cobrança. Devolve o fim do acesso (ISO) lido do Stripe.
 */
export async function scheduleCancelAtPeriodEnd(opts: {
  subId: string;
  email: string | null;
  userId: string;
  why: string;
  by: 'customer' | 'admin';
}): Promise<{ accessUntil: string | null }> {
  const stripe = getStripe();
  const sub = await stripe.subscriptions.update(opts.subId, {
    cancel_at_period_end: true,
    cancellation_details: {
      comment: (opts.by === 'admin' ? 'Agendado pelo admin — ' : 'Cancelado pelo cliente — ') + opts.why,
    },
  });
  const s = sub as unknown as {
    current_period_end?: number;
    cancel_at?: number | null;
    items?: { data?: Array<{ current_period_end?: number }> };
  };
  const end = s.cancel_at ?? s.items?.data?.[0]?.current_period_end ?? s.current_period_end ?? null;
  const accessUntil = end ? new Date(end * 1000).toISOString() : null;
  await notifyOwner(
    '📅 Cancelamento agendado (sem reembolso)',
    `<p><b>Cliente:</b> ${opts.email ?? opts.userId}<br>` +
      `<b>Quem fez:</b> ${opts.by === 'admin' ? 'admin (painel)' : 'o próprio cliente'}<br>` +
      `<b>Motivo de não reembolsar:</b> ${opts.why}<br>` +
      `<b>Acesso até:</b> ${accessUntil ? new Date(accessUntil).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—'} ` +
      `(sem nova cobrança).</p>`,
  ).catch(() => {});
  return { accessUntil };
}

/** Frase curta do porquê não há reembolso automático (cliente e admin). */
export function refundBlockText(reason: RefundBlock, charge: LastCharge | null): string {
  const fmt = (ms: number) =>
    new Date(ms).toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  switch (reason) {
    case 'window_passed':
      return charge
        ? `a garantia de ${REFUND_WINDOW_DAYS} dias da cobrança de ${fmt(charge.paidAt)} terminou em ${fmt(charge.refundDeadline)}`
        : `passou o prazo de ${REFUND_WINDOW_DAYS} dias`;
    case 'used_before':
      return 'o reembolso automático de 7 dias já foi usado antes nesta conta';
    case 'free_charge':
      return 'a última cobrança foi de R$ 0,00';
    case 'already_refunded':
      return 'a última cobrança já foi reembolsada';
    case 'disputed':
      return 'a cobrança está em contestação no banco';
    default:
      return 'não achamos uma cobrança paga pra devolver';
  }
}
