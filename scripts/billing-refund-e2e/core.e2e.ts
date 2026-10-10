// Cenários da política de cancelamento (lib + painel admin) contra o Stripe
// em MODO DE TESTE. Rodar: node scripts/billing-refund-e2e/run.mjs
import assert from 'node:assert/strict';
import { getStripe } from '@/lib/stripe';
import {
  checkRefund,
  refundAndCancelNow,
  scheduleCancelAtPeriodEnd,
  REFUND_WINDOW_MS,
} from '@/lib/billing-refund';
import { GET as cancellationsGET } from '@/app/api/admin/cancellations/route';

const g = globalThis as unknown as {
  __ops: Array<{ table: string; kind: string; payload?: Record<string, unknown>; filters: unknown[] }>;
  __profiles: Record<string, Record<string, unknown>>;
};

const key = process.env.STRIPE_SECRET_KEY ?? '';
if (!key.startsWith('sk_test_')) throw new Error('ABORTADO: só roda com chave de TESTE');

const stripe = getStripe();
const stamp = Date.now();
const email = `refund-test-${stamp}@example.com`;
const userId = `0000${String(stamp).slice(-4)}-0000-4000-8000-000000000001`;

async function newPaidSubscription(customerId: string, productId: string) {
  const sub = await stripe.subscriptions.create({
    customer: customerId,
    items: [{ price_data: { currency: 'brl', unit_amount: 5700, recurring: { interval: 'month' }, product: productId } }],
    metadata: { userId, plan: 'basic', billing: 'monthly' },
    payment_behavior: 'error_if_incomplete',
  });
  assert.equal(sub.status, 'active', 'assinatura de teste deveria nascer ativa e paga');
  return sub;
}

let pass = 0;
const ok = (msg: string) => {
  pass++;
  console.log('  ✓', msg);
};

async function main() {
  console.log('Stripe modo TESTE · cliente', email);
  const product = await stripe.products.create({ name: `AutoEdit Premium (teste reembolso ${stamp})` });
  const customer = await stripe.customers.create({ email, metadata: { userId } });
  const pm = await stripe.paymentMethods.attach('pm_card_visa', { customer: customer.id });
  await stripe.customers.update(customer.id, { invoice_settings: { default_payment_method: pm.id } });
  g.__profiles[userId] = { id: userId, tier: 'basic', subscription_status: 'active' };

  // ── 1) dentro dos 7 dias: elegível ──
  const sub1 = await newPaidSubscription(customer.id, product.id);
  const c1 = await checkRefund({ userId, email, customerId: customer.id, subId: sub1.id });
  assert.equal(c1.eligible, true, `deveria ser elegível: ${JSON.stringify(c1)}`);
  assert.equal(c1.charge!.amount, 5700);
  assert.ok(c1.charge!.paymentIntentId, 'achou o PaymentIntent da fatura (API dahlia)');
  assert.ok(Math.abs(c1.charge!.paidAt - Date.now()) < 5 * 60_000, 'paidAt ~ agora');
  ok('cobrança de R$ 57 recém-paga → elegível, PaymentIntent achado pela fatura');

  // ── 2) limite exato: 7 dias depois NÃO devolve; 1 min antes devolve ──
  const at = c1.charge!.paidAt;
  const late = await checkRefund({ userId, email, customerId: customer.id, subId: sub1.id, now: at + REFUND_WINDOW_MS });
  assert.equal(late.eligible, false);
  assert.equal(!late.eligible && late.reason, 'window_passed');
  const almost = await checkRefund({ userId, email, customerId: customer.id, subId: sub1.id, now: at + REFUND_WINDOW_MS - 60_000 });
  assert.equal(almost.eligible, true);
  ok('exatamente 7 dias depois → sem reembolso; 1 min antes → com reembolso');

  // ── 3) reembolsa + encerra; duplo clique simultâneo não devolve 2× ──
  g.__ops.length = 0;
  const [r1, r2] = await Promise.all([
    refundAndCancelNow({ userId, email, customerId: customer.id, subId: sub1.id, charge: c1.charge!, by: 'customer' }),
    refundAndCancelNow({ userId, email, customerId: customer.id, subId: sub1.id, charge: c1.charge!, by: 'customer' }),
  ]);
  assert.equal(r1.refundId, r2.refundId, 'idempotency key → o MESMO reembolso nas duas chamadas');
  const pi1 = await stripe.paymentIntents.retrieve(c1.charge!.paymentIntentId!, { expand: ['latest_charge'] });
  const ch1 = pi1.latest_charge as { amount_refunded: number; refunded: boolean; id: string };
  assert.equal(ch1.amount_refunded, 5700, 'devolveu R$ 57,00 — nem mais, nem menos');
  assert.equal(ch1.refunded, true);
  const refunds1 = await stripe.refunds.list({ charge: ch1.id });
  assert.equal(refunds1.data.length, 1, 'um único reembolso no Stripe');
  const s1 = await stripe.subscriptions.retrieve(sub1.id);
  assert.equal(s1.status, 'canceled', 'assinatura encerrada no Stripe');
  assert.match(s1.cancellation_details?.comment ?? '', /7 dias/);
  const prof = g.__profiles[userId];
  assert.equal(prof.tier, 'free');
  assert.equal(prof.subscription_status, 'refunded');
  assert.ok(g.__ops.some((o) => o.table === 'payments' && o.kind === 'update'), 'comprovante marcado como reembolsado');
  assert.ok(g.__ops.some((o) => o.table === 'tier_changes' && o.kind === 'insert'), 'trilha no histórico de plano');
  ok('reembolso total + assinatura encerrada + perfil Free/refunded; duplo clique = 1 reembolso só');

  // ── 4) repetir depois (retry) → already_refunded, completa sem devolver de novo ──
  const c1b = await checkRefund({ userId, email, customerId: customer.id, subId: sub1.id });
  assert.equal(!c1b.eligible && c1b.reason, 'already_refunded');
  const r3 = await refundAndCancelNow({ userId, email, customerId: customer.id, subId: sub1.id, charge: c1b.charge!, by: 'customer' });
  assert.equal(r3.refunded, 0);
  assert.equal((await stripe.refunds.list({ charge: ch1.id })).data.length, 1);
  ok('repetir a operação depois só confirma — continua 1 reembolso');

  // ── 5) assinou de novo → reembolso automático já foi usado ──
  const sub2 = await newPaidSubscription(customer.id, product.id);
  const c2 = await checkRefund({ userId, email, customerId: customer.id, subId: sub2.id });
  assert.equal(!c2.eligible && c2.reason, 'used_before');
  ok('reassinou depois de reembolsado → sem 2º reembolso automático (cai no fim do período)');

  // ── 6) fora da regra → agenda pro fim do período, acesso até a próxima cobrança ──
  const sched = await scheduleCancelAtPeriodEnd({ subId: sub2.id, email, userId, why: 'teste', by: 'customer' });
  const s2 = await stripe.subscriptions.retrieve(sub2.id);
  assert.equal(s2.status, 'active', 'continua ativa até o fim do período');
  assert.ok(s2.cancel_at_period_end || s2.cancel_at, 'cancelamento agendado');
  const days = (new Date(sched.accessUntil!).getTime() - Date.now()) / 86_400_000;
  assert.ok(days > 27 && days < 32, `acesso até ~1 mês (${days.toFixed(1)} dias)`);
  const inv2 = await stripe.invoices.list({ subscription: sub2.id });
  assert.equal(inv2.data.filter((i) => (i.amount_paid ?? 0) > 0).length, 1, 'só a cobrança original — nada a mais');
  ok(`agendado: acesso até ${new Date(sched.accessUntil!).toLocaleDateString('pt-BR')} (+${days.toFixed(0)} dias), sem nova cobrança`);

  // ── 7) admin: devolve FORA da regra (decisão humana) mesmo com used_before ──
  const c2b = await checkRefund({ userId, email, customerId: customer.id, subId: sub2.id });
  const r4 = await refundAndCancelNow({ userId, email, customerId: customer.id, subId: sub2.id, charge: c2b.charge!, by: 'admin', adminId: 'admin' });
  assert.equal(r4.refunded, 5700);
  assert.equal((await stripe.subscriptions.retrieve(sub2.id)).status, 'canceled');
  ok('admin consegue reembolsar e encerrar uma assinatura agendada (caso Cecilia)');

  // ── 8) lista de cancelamentos do admin enxerga os dois ──
  const sub3 = await newPaidSubscription(customer.id, product.id);
  await stripe.subscriptions.update(sub3.id, { cancel_at_period_end: true });
  const res = await cancellationsGET();
  const j = (await res.json()) as { rows: Array<{ subscription_id: string | null; kind: string; refunded_amount: number; access_until: string | null }> };
  const row = (id: string) => j.rows.find((r) => r.subscription_id === id);
  assert.equal(row(sub1.id)?.kind, 'refunded');
  assert.equal(row(sub1.id)?.refunded_amount, 5700);
  assert.equal(row(sub2.id)?.kind, 'refunded');
  assert.equal(row(sub3.id)?.kind, 'scheduled');
  assert.ok(row(sub3.id)?.access_until, 'agendado mostra até quando tem acesso');
  ok('painel lista: 2 reembolsados (R$ 57 cada) + 1 agendado com data de fim');

  // limpeza
  await stripe.subscriptions.cancel(sub3.id).catch(() => {});
  console.log(`\nOK — ${pass} verificações passaram.`);
}

main().catch((e) => {
  console.error('\nFALHOU:', e);
  process.exit(1);
});
