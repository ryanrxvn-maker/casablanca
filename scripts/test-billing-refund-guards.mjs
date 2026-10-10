// Guardas do cancelamento com reembolso (09.10). A regra mexe em dinheiro:
// qualquer regressão aqui vira cliente cobrado sem querer ou reembolso em
// dobro. A prova de ponta a ponta (Stripe em modo de teste) fica em
// scripts/billing-refund-e2e — rodar antes de mexer nestes arquivos.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

const lib = readFileSync('lib/billing-refund.ts', 'utf8');
const cancel = readFileSync('app/api/billing/cancel/route.ts', 'utf8');
const sub = readFileSync('app/api/billing/subscription/route.ts', 'utf8');
const hook = readFileSync('app/api/billing/webhook/route.ts', 'utf8');
const admin = readFileSync('app/admin/page.tsx', 'utf8');
const page = readFileSync('app/configuracoes/assinatura/page.tsx', 'utf8');

test('janela de reembolso = 7 dias contados da cobrança, limite exclusivo', () => {
  assert.match(lib, /export const REFUND_WINDOW_DAYS = 7;/);
  assert.match(lib, /REFUND_WINDOW_DAYS \* 24 \* 60 \* 60 \* 1000/);
  // debitou dia 7 → dia 14 no MESMO horário já não devolve
  assert.match(lib, /now >= charge\.refundDeadline\) return \{ eligible: false, reason: 'window_passed'/);
});

test('reembolso nunca sai 2×: idempotency key por pagamento + checa o que já voltou', () => {
  assert.match(lib, /idempotencyKey: `autoedit-refund-\$\{charge\.paymentIntentId \?\? charge\.chargeId\}`/);
  assert.match(lib, /const remaining = charge\.amount - charge\.amountRefunded;\s*if \(remaining > 0\)/);
  assert.match(lib, /isFullyRefunded\(charge\)\) return \{ eligible: false, reason: 'already_refunded'/);
});

test('reembolso primeiro, encerramento depois, perfil Free na hora', () => {
  const i = lib.indexOf('stripe.refunds.create(');
  const j = lib.indexOf('cancelSubscriptionNow(stripe, opts.subId');
  const k = lib.indexOf("subscription_status: 'refunded'");
  assert.ok(i > 0 && j > i && k > j, 'ordem: refund → cancel → profile');
});

test('PaymentIntent da fatura vem de InvoicePayments (API dahlia tirou do topo)', () => {
  assert.match(lib, /stripe\.invoicePayments\.list\(\{ invoice: inv\.id!/);
  assert.match(hook, /invoicePayments\.list\(\{ invoice: invoice\.id/);
});

test('cancel: dentro dos 7 dias devolve; fora agenda pro fim do período; pendente encerra', () => {
  assert.match(cancel, /check\.eligible && !keepAccess[\s\S]*?refundAndCancelNow/);
  assert.match(cancel, /scheduleCancelAtPeriodEnd\(/);
  assert.match(cancel, /sub\.status === 'past_due' \|\| sub\.status === 'unpaid'/);
  assert.match(sub, /checkRefund\(/, 'a tela precisa saber ANTES do clique se devolve');
  assert.match(page, /noRefundText\(refund\)/);
});

test('webhook não devolve o Premium com evento atrasado e preserva o "refunded"', () => {
  assert.match(hook, /case 'customer\.subscription\.updated': \{[\s\S]*?stripe\.subscriptions\.retrieve\(evSub\.id\)/);
  assert.match(hook, /isRefundedProfile\(svc, userId\)\) patch\.subscription_status = 'refunded'/);
});

test('painel admin lista os cancelamentos e oferece reembolsar', () => {
  assert.match(admin, /fetch\('\/api\/admin\/cancellations'/);
  assert.match(admin, /fetch\(`\/api\/admin\/refund-cancel\?userId=/);
  assert.match(admin, /key: 'canceled', label: 'Cancelaram'/);
});
