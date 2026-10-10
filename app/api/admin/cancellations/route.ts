import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { jsonError, requireAdmin, serviceClient } from '../_helpers';
import { getStripe } from '@/lib/stripe';

/**
 * GET /api/admin/cancellations — QUEM CANCELOU (fonte: o Stripe, ao vivo).
 *
 * O banco só guarda o status atual (e o cancelamento AGENDADO nem aparece
 * nele: a assinatura segue 'active' até o fim do período). Por isso a lista
 * vem do Stripe, que tem tudo: quando pediu, até quando tem acesso, se o
 * dinheiro voltou e o comentário do cancelamento.
 *
 *   kind: 'scheduled' → pediu pra cancelar, acesso até `access_until` (sem reembolso)
 *         'refunded'  → encerrada com o valor devolvido
 *         'ended'     → encerrada sem reembolso (fim do período / pagamento recusado)
 *         'refund'    → reembolso sem assinatura (pagamento anual / feito no Stripe)
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const LIVE = new Set(['active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused']);

type Row = {
  key: string;
  kind: 'scheduled' | 'refunded' | 'ended' | 'refund';
  user_id: string | null;
  name: string | null;
  email: string | null;
  customer_id: string | null;
  subscription_id: string | null;
  plan: string | null;
  amount: number | null; // valor do plano (centavos)
  started_at: string | null;
  requested_at: string | null; // quando pediu o cancelamento
  access_until: string | null; // agendado: fim do acesso · encerrado: quando acabou
  refunded_amount: number;
  refunded_at: string | null;
  reason: string | null; // cancellation_details.reason do Stripe
  comment: string | null;
};

const iso = (unix: number | null | undefined) => (unix ? new Date(unix * 1000).toISOString() : null);
const idOf = (ref: unknown): string | null =>
  !ref ? null : typeof ref === 'string' ? ref : ((ref as { id?: string }).id ?? null);

export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  try {
    const stripe = getStripe();
    const since = Math.floor(Date.now() / 1000) - 400 * 86_400;

    // Assinaturas (todas) — o volume é pequeno; teto de segurança de 1000.
    const subs: Stripe.Subscription[] = [];
    for await (const s of stripe.subscriptions.list({
      status: 'all',
      limit: 100,
      expand: ['data.customer'],
    })) {
      subs.push(s);
      if (subs.length >= 1000) break;
    }

    // Reembolsos do último ano, agrupados por customer.
    type R = { amount: number; at: number; pi: string | null };
    const refundsByCustomer = new Map<string, R[]>();
    const refundCustomers = new Map<string, { email: string | null }>();
    for await (const rf of stripe.refunds.list({
      limit: 100,
      created: { gte: since },
      expand: ['data.charge'],
    })) {
      if (rf.status === 'failed' || rf.status === 'canceled') continue;
      const ch = rf.charge && typeof rf.charge !== 'string' ? (rf.charge as Stripe.Charge) : null;
      const cid = idOf(ch?.customer);
      if (!cid) continue;
      const list = refundsByCustomer.get(cid) ?? [];
      list.push({ amount: rf.amount, at: rf.created, pi: idOf(rf.payment_intent) });
      refundsByCustomer.set(cid, list);
      if (!refundCustomers.has(cid)) {
        refundCustomers.set(cid, { email: ch?.billing_details?.email ?? ch?.receipt_email ?? null });
      }
    }

    // Cada reembolso pertence à assinatura MAIS RECENTE do cliente que já
    // existia quando ele foi feito (um cliente pode ter assinado, sido
    // reembolsado e assinado de novo — somar por cliente contava 2×).
    const subsByCustomer = new Map<string, Stripe.Subscription[]>();
    for (const s of subs) {
      const cid = idOf(s.customer);
      if (!cid) continue;
      const list = subsByCustomer.get(cid) ?? [];
      list.push(s);
      subsByCustomer.set(cid, list);
    }
    const refundsBySub = new Map<string, R[]>();
    const orphanRefunds = new Map<string, R[]>(); // sem assinatura (anual)
    for (const [cid, list] of Array.from(refundsByCustomer.entries())) {
      const owned = (subsByCustomer.get(cid) ?? []).slice().sort((a, b) => (b.start_date ?? 0) - (a.start_date ?? 0));
      for (const r of list) {
        const owner = owned.find((s) => (s.start_date ?? 0) <= r.at);
        if (owner) {
          const arr = refundsBySub.get(owner.id) ?? [];
          arr.push(r);
          refundsBySub.set(owner.id, arr);
        } else {
          const arr = orphanRefunds.get(cid) ?? [];
          arr.push(r);
          orphanRefunds.set(cid, arr);
        }
      }
    }

    const rows: Row[] = [];
    const listedSubs = new Set<string>();

    for (const s of subs) {
      const scheduled = LIVE.has(s.status) && (s.cancel_at_period_end || !!s.cancel_at);
      const ended = s.status === 'canceled' || s.status === 'incomplete_expired';
      if (!scheduled && !ended) continue;
      if (s.status === 'incomplete_expired') continue; // checkout abandonado: nunca pagou

      const cust = s.customer && typeof s.customer !== 'string' ? s.customer : null;
      const customerId = idOf(s.customer);
      const email = cust && !(cust as Stripe.DeletedCustomer).deleted ? (cust as Stripe.Customer).email ?? null : null;
      const item = s.items?.data?.[0] as (Stripe.SubscriptionItem & { current_period_end?: number }) | undefined;
      const periodEnd = s.cancel_at ?? item?.current_period_end ?? null;

      const endAt = s.ended_at ?? s.canceled_at ?? null;
      const mine = refundsBySub.get(s.id) ?? [];
      const refundedAmount = mine.reduce((sum, r) => sum + r.amount, 0);
      const refundedAt = mine.length ? Math.max(...mine.map((r) => r.at)) : null;
      listedSubs.add(s.id);

      rows.push({
        key: s.id,
        kind: scheduled ? 'scheduled' : refundedAmount > 0 ? 'refunded' : 'ended',
        user_id: null,
        name: null,
        email,
        customer_id: customerId,
        subscription_id: s.id,
        plan: s.metadata?.plan ?? null,
        amount: item?.price?.unit_amount ?? null,
        started_at: iso(s.start_date),
        requested_at: iso(s.canceled_at ?? s.ended_at),
        access_until: scheduled ? iso(periodEnd) : iso(endAt),
        refunded_amount: refundedAmount,
        refunded_at: iso(refundedAt),
        reason: s.cancellation_details?.reason ?? null,
        comment: s.cancellation_details?.comment ?? null,
      });
    }

    // Reembolso fora das linhas acima: pagamento anual (sem assinatura) ou
    // devolvido direto no Stripe com a assinatura ainda ativa.
    const leftovers = new Map<string, R[]>(orphanRefunds);
    for (const s of subs) {
      if (listedSubs.has(s.id)) continue;
      const mine = refundsBySub.get(s.id);
      const cid = idOf(s.customer);
      if (!mine?.length || !cid) continue;
      leftovers.set(cid, [...(leftovers.get(cid) ?? []), ...mine]);
    }
    for (const [cid, list] of Array.from(leftovers.entries())) {
      const total = list.reduce((sum, r) => sum + r.amount, 0);
      const at = Math.max(...list.map((r) => r.at));
      rows.push({
        key: `refund:${cid}`,
        kind: 'refund',
        user_id: null,
        name: null,
        email: refundCustomers.get(cid)?.email ?? null,
        customer_id: cid,
        subscription_id: null,
        plan: null,
        amount: null,
        started_at: null,
        requested_at: iso(at),
        access_until: null,
        refunded_amount: total,
        refunded_at: iso(at),
        reason: null,
        comment: null,
      });
    }

    // Dono no banco: pelo customer, depois pelo email.
    const svc = serviceClient();
    const cids = Array.from(new Set(rows.map((r) => r.customer_id).filter(Boolean))) as string[];
    const byCustomer = new Map<string, { id: string; name: string | null; email: string | null }>();
    for (let i = 0; i < cids.length; i += 150) {
      const { data } = await svc
        .from('profiles')
        .select('id, name, email, stripe_customer_id')
        .in('stripe_customer_id', cids.slice(i, i + 150));
      for (const p of (data ?? []) as Array<{ id: string; name: string | null; email: string | null; stripe_customer_id: string }>) {
        byCustomer.set(p.stripe_customer_id, p);
      }
    }
    const missingEmails = Array.from(
      new Set(
        rows
          .filter((r) => !(r.customer_id && byCustomer.has(r.customer_id)) && r.email)
          .map((r) => r.email!.toLowerCase()),
      ),
    );
    const byEmail = new Map<string, { id: string; name: string | null; email: string | null }>();
    if (missingEmails.length) {
      const { data } = await svc.from('profiles').select('id, name, email').in('email', missingEmails);
      for (const p of (data ?? []) as Array<{ id: string; name: string | null; email: string | null }>) {
        if (p.email) byEmail.set(p.email.toLowerCase(), p);
      }
    }
    for (const r of rows) {
      const owner =
        (r.customer_id ? byCustomer.get(r.customer_id) : undefined) ??
        (r.email ? byEmail.get(r.email.toLowerCase()) : undefined);
      if (owner) {
        r.user_id = owner.id;
        r.name = owner.name;
        r.email = r.email ?? owner.email;
      }
    }

    rows.sort((a, b) => (b.requested_at ?? '').localeCompare(a.requested_at ?? ''));

    return NextResponse.json({
      rows,
      totals: {
        scheduled: rows.filter((r) => r.kind === 'scheduled').length,
        refunded: rows.filter((r) => r.kind === 'refunded' || r.kind === 'refund').length,
        ended: rows.filter((r) => r.kind === 'ended').length,
        refundedAmount: rows.reduce((s, r) => s + r.refunded_amount, 0),
      },
    });
  } catch (e) {
    console.error('[admin cancellations]', e);
    return jsonError('Falha ao ler os cancelamentos no Stripe.', 500, e instanceof Error ? e.message : String(e));
  }
}
