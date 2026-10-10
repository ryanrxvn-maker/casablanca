import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { jsonError, requireAdmin, serviceClient } from '../_helpers';
import { getStripe } from '@/lib/stripe';

/**
 * GET /api/admin/stripe-history?userId=<uuid> — o que aconteceu de verdade
 * com a assinatura de um cliente, lido dos EVENTOS do Stripe (30 dias).
 *
 * Responde o "eu cancelei" sem achismo: pediu cancelamento? reativou depois?
 * a cobrança falhou? houve reembolso? E de ONDE veio cada ação:
 *   site       → pedido do nosso servidor (o SDK marca todo POST com a
 *                Idempotency-Key "stripe-node-retry-…"; o reembolso usa
 *                "autoedit-refund-…")
 *   automatico → o próprio Stripe (renovação, fim do período, dunning)
 *   stripe     → feito no painel do Stripe (ou outra integração)
 * Só leitura.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPES = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
  'charge.refunded',
  'charge.dispute.created',
];

type Item = {
  id: string;
  at: string;
  type: string;
  label: string;
  detail: string | null;
  source: 'site' | 'automatico' | 'stripe';
  tone: 'lime' | 'amber' | 'danger' | 'cyan' | 'neutral';
};

const brl = (c: number | null | undefined) =>
  ((c ?? 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const day = (unix: number | null | undefined) =>
  unix
    ? new Date(unix * 1000).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    : '—';

function sourceOf(ev: Stripe.Event): Item['source'] {
  if (!ev.request?.id) return 'automatico';
  const key = ev.request.idempotency_key ?? '';
  if (key.startsWith('stripe-node-retry-') || key.startsWith('autoedit-')) return 'site';
  return 'stripe';
}

function describe(ev: Stripe.Event): Omit<Item, 'id' | 'at' | 'type' | 'source'> | null {
  const obj = ev.data.object as unknown as Record<string, unknown>;
  const prev = (ev.data.previous_attributes ?? {}) as Record<string, unknown>;
  switch (ev.type) {
    case 'checkout.session.completed':
      return { label: 'Finalizou o checkout', detail: brl(obj.amount_total as number), tone: 'lime' };
    case 'customer.subscription.created':
      return { label: 'Assinatura criada', detail: `status ${obj.status as string}`, tone: 'lime' };
    case 'customer.subscription.deleted':
      return {
        label: 'Assinatura encerrada',
        detail: (obj.cancellation_details as { comment?: string | null } | null)?.comment ?? null,
        tone: 'danger',
      };
    case 'customer.subscription.updated': {
      if ('cancel_at_period_end' in prev || 'cancel_at' in prev) {
        const scheduled = !!obj.cancel_at_period_end || !!obj.cancel_at;
        return scheduled
          ? { label: 'Pediu o cancelamento', detail: `acesso até ${day((obj.cancel_at as number) ?? null)}`, tone: 'amber' }
          : { label: 'Desfez o cancelamento (reativou)', detail: null, tone: 'cyan' };
      }
      if ('status' in prev) {
        return { label: `Status: ${String(prev.status)} → ${String(obj.status)}`, detail: null, tone: 'neutral' };
      }
      return null; // renovação de período, troca de cartão etc. — ruído aqui
    }
    case 'invoice.paid':
      if (!obj.amount_paid) return null;
      return { label: 'Cobrança paga', detail: brl(obj.amount_paid as number), tone: 'lime' };
    case 'invoice.payment_failed':
      return { label: 'Cobrança recusada', detail: brl(obj.amount_due as number), tone: 'danger' };
    case 'charge.refunded':
      return { label: 'Reembolso', detail: brl(obj.amount_refunded as number), tone: 'danger' };
    case 'charge.dispute.created':
      return { label: 'Contestação aberta no banco', detail: brl(obj.amount as number), tone: 'danger' };
    default:
      return null;
  }
}

export async function GET(req: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  try {
    const userId = new URL(req.url).searchParams.get('userId') ?? '';
    if (!UUID.test(userId)) return jsonError('userId inválido.', 400);

    const { data } = await serviceClient()
      .from('profiles')
      .select('email, stripe_customer_id')
      .eq('id', userId)
      .maybeSingle();
    const p = data as { email: string | null; stripe_customer_id: string | null } | null;
    if (!p) return jsonError('Usuário não encontrado.', 404);

    const stripe = getStripe();
    const customers = new Set<string>();
    if (p.stripe_customer_id) customers.add(p.stripe_customer_id);
    if (p.email) {
      try {
        const found = await stripe.customers.list({ email: p.email.trim(), limit: 5 });
        for (const c of found.data) customers.add(c.id);
      } catch {
        /* best-effort */
      }
    }
    if (!customers.size) return NextResponse.json({ ok: true, customers: [], items: [], truncated: false });

    const since = Math.floor(Date.now() / 1000) - 30 * 86_400;
    const items: Item[] = [];
    let scanned = 0;
    let truncated = false;
    for await (const ev of stripe.events.list({ created: { gte: since }, types: TYPES, limit: 100 })) {
      if (++scanned > 5000) {
        truncated = true;
        break;
      }
      const obj = ev.data.object as unknown as { customer?: string | { id: string } | null };
      const cid = typeof obj.customer === 'string' ? obj.customer : obj.customer?.id;
      if (!cid || !customers.has(cid)) continue;
      const d = describe(ev);
      if (!d) continue;
      items.push({ id: ev.id, at: new Date(ev.created * 1000).toISOString(), type: ev.type, source: sourceOf(ev), ...d });
    }
    items.sort((a, b) => b.at.localeCompare(a.at));
    return NextResponse.json({ ok: true, customers: Array.from(customers), items, truncated });
  } catch (e) {
    return jsonError('Falha ao ler o histórico no Stripe.', 500, e instanceof Error ? e.message : String(e));
  }
}
