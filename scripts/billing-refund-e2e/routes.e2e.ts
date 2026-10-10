// Rotas do cliente (POST /api/billing/cancel, GET /api/billing/subscription)
// contra o Stripe em MODO DE TESTE. Rodar: node scripts/billing-refund-e2e/run.mjs routes
import assert from 'node:assert/strict';
import { getStripe } from '@/lib/stripe';
import { POST as cancelPOST } from '@/app/api/billing/cancel/route';
import { GET as subGET } from '@/app/api/billing/subscription/route';

const g = globalThis as unknown as {
  __user: { id: string; email: string } | null;
  __profiles: Record<string, Record<string, unknown>>;
};
if (!(process.env.STRIPE_SECRET_KEY ?? '').startsWith('sk_test_')) throw new Error('ABORTADO: só chave de TESTE');
const stripe = getStripe();
let n = 0;
const ok = (m: string) => console.log('  ✓', (++n, m));

async function person(tag: string) {
  const stamp = Date.now();
  const email = `route-${tag}-${stamp}@example.com`;
  const id = `0000${String(stamp).slice(-4)}-0000-4000-8000-00000000000${tag.length}`;
  const product = await stripe.products.create({ name: `AutoEdit teste rota ${tag}` });
  const customer = await stripe.customers.create({ email, metadata: { userId: id } });
  const pm = await stripe.paymentMethods.attach('pm_card_visa', { customer: customer.id });
  await stripe.customers.update(customer.id, { invoice_settings: { default_payment_method: pm.id } });
  const sub = await stripe.subscriptions.create({
    customer: customer.id,
    items: [{ price_data: { currency: 'brl', unit_amount: 5700, recurring: { interval: 'month' }, product: product.id } }],
    metadata: { userId: id, plan: 'basic', billing: 'monthly' },
    payment_behavior: 'error_if_incomplete',
  });
  g.__profiles[id] = {
    id,
    email,
    tier: 'basic',
    subscription_status: 'active',
    stripe_customer_id: customer.id,
    stripe_subscription_id: sub.id,
  };
  g.__user = { id, email };
  return { id, email, customer, sub, product };
}

const call = async (body: unknown) => {
  const res = await cancelPOST(new Request('http://x/api/billing/cancel', { method: 'POST', body: JSON.stringify(body) }));
  return { status: res.status, j: (await res.json()) as Record<string, unknown> };
};

async function main() {
  // A) cliente novo cancela no 1º dia → reembolso automático
  const a = await person('a');
  const pv = (await (await subGET()).json()) as { refund: { eligible: boolean; amount: number; deadline: number } };
  assert.equal(pv.refund.eligible, true);
  assert.equal(pv.refund.amount, 5700);
  ok('tela "Minha assinatura" já avisa: dentro dos 7 dias, devolve R$ 57,00');
  const r = await call({ action: 'cancel' });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.equal(r.j.mode, 'refunded');
  assert.equal(r.j.refunded, 5700);
  assert.equal((await stripe.subscriptions.retrieve(a.sub.id)).status, 'canceled');
  assert.equal(g.__profiles[a.id].tier, 'free');
  ok('POST cancel (1º dia) → reembolsou R$ 57,00, encerrou no Stripe, perfil Free');
  const after = (await (await subGET()).json()) as { subscription: { status: string }; refund: { refunded_amount: number } };
  assert.equal(after.subscription.status, 'canceled');
  assert.equal(after.refund.refunded_amount, 5700);
  ok('depois: tela mostra "encerrada, reembolso de R$ 57,00" (sem botão de cancelar)');
  const again = await call({ action: 'cancel' });
  assert.equal(again.j.mode, 'ended');
  assert.equal((await stripe.refunds.list({ payment_intent: undefined, limit: 100 })).data.filter((x) => x.metadata?.userId === a.id).length, 1);
  ok('clicar de novo depois de encerrada → nada acontece (continua 1 reembolso)');

  // B) caso Cecilia: escolheu manter acesso (agendou), depois pede o reembolso nos 7 dias
  const b = await person('bb');
  const keep = await call({ action: 'cancel', keepAccess: true });
  assert.equal(keep.j.mode, 'scheduled');
  assert.equal(keep.j.no_refund_reason, 'kept_access');
  const sb = await stripe.subscriptions.retrieve(b.sub.id);
  assert.equal(sb.status, 'active');
  assert.ok(sb.cancel_at_period_end || sb.cancel_at);
  ok('"só desligar a renovação" → agendado, continua ativo, sem reembolso');
  const pvb = (await (await subGET()).json()) as { subscription: { cancel_at_period_end: boolean; current_period_end: number }; refund: { eligible: boolean } };
  assert.equal(pvb.subscription.cancel_at_period_end, true);
  assert.equal(pvb.refund.eligible, true);
  assert.ok(pvb.subscription.current_period_end * 1000 > Date.now() + 27 * 86_400_000, 'data "acesso até" preenchida');
  ok('agendado e ainda nos 7 dias → tela oferece "Cancelar agora e receber R$ 57,00"');
  const rb = await call({ action: 'cancel' });
  assert.equal(rb.j.mode, 'refunded');
  assert.equal((await stripe.subscriptions.retrieve(b.sub.id)).status, 'canceled');
  ok('cancelar de novo nos 7 dias → reembolsou e encerrou (o que a Cecilia precisa)');

  // C) fora dos 7 dias (simulado: reembolso já usado) → agenda; reativar funciona
  const c = await person('ccc');
  // marca a 1ª cobrança como reembolsada antes → a próxima assinatura cai em used_before
  const inv = await stripe.invoices.list({ subscription: c.sub.id, status: 'paid', limit: 1 });
  const ip = await stripe.invoicePayments.list({ invoice: inv.data[0].id!, status: 'paid', limit: 1 });
  const piRef = ip.data[0].payment!.payment_intent!;
  await stripe.refunds.create({ payment_intent: typeof piRef === 'string' ? piRef : piRef.id });
  await stripe.subscriptions.cancel(c.sub.id);
  const sub2 = await stripe.subscriptions.create({
    customer: c.customer.id,
    items: [{ price_data: { currency: 'brl', unit_amount: 5700, recurring: { interval: 'month' }, product: c.product.id } }],
    metadata: { userId: c.id, plan: 'basic', billing: 'monthly' },
    payment_behavior: 'error_if_incomplete',
  });
  g.__profiles[c.id].stripe_subscription_id = sub2.id;
  const rc = await call({ action: 'cancel' });
  assert.equal(rc.j.mode, 'scheduled', JSON.stringify(rc.j));
  assert.equal(rc.j.no_refund_reason, 'used_before');
  assert.ok(rc.j.access_until);
  const charges = await stripe.charges.list({ customer: c.customer.id });
  assert.equal(charges.data.filter((x) => x.amount_refunded > 0).length, 1, 'a 2ª cobrança NÃO foi devolvida');
  ok(`sem direito a reembolso → só agenda: acesso até ${new Date(String(rc.j.access_until)).toLocaleDateString('pt-BR')}, nada devolvido`);
  const re = await call({ action: 'reactivate' });
  assert.equal(re.j.mode, 'reactivated');
  const s2 = await stripe.subscriptions.retrieve(sub2.id);
  assert.equal(s2.cancel_at_period_end, false);
  ok('reativar desfaz o agendamento');
  await stripe.subscriptions.cancel(sub2.id);

  // D) sem login
  g.__user = null;
  assert.equal((await call({ action: 'cancel' })).status, 401);
  ok('sem login → 401');
  console.log(`\nOK — ${n} verificações das rotas passaram.`);
}

main().catch((e) => {
  console.error('\nFALHOU:', e);
  process.exit(1);
});
