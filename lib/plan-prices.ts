/**
 * Planos pagos do AutoEdit. Modelo: PAGAMENTO ÚNICO por período (não há
 * assinatura recorrente). O cliente paga via cartão/PIX/boleto e libera
 * acesso por 1 mês ou 1 ano; depois precisa pagar de novo (sem auto-renovar).
 *
 * Preços (em centavos de BRL):
 *   Basic  → R$ 57/mês  · R$ 540/ano
 *   Pro    → R$ 116/mês · R$ 1.104/ano
 */

export type PaidTier = 'basic' | 'pro';
export type Billing = 'monthly' | 'annual';

/** Valor em centavos (BRL) por plano + período. Usado no Checkout (price_data). */
export const PRICE_AMOUNT: Record<PaidTier, Record<Billing, number>> = {
  basic: { monthly: 5700, annual: 54000 },
  pro: { monthly: 11600, annual: 110400 },
};

export const PLAN_LABEL: Record<PaidTier, string> = {
  basic: 'AutoEdit Basic',
  pro: 'AutoEdit Pro',
};

/** Intervalo de cobrança recorrente do Stripe pro período escolhido. */
export function stripeInterval(billing: Billing): 'month' | 'year' {
  return billing === 'annual' ? 'year' : 'month';
}

/** Fim do acesso a partir de `from` (default agora) pro período escolhido.
 *  (legado do modelo de pagamento único — mantido pra compatibilidade). */
export function periodEndFrom(billing: Billing, from: Date = new Date()): Date {
  const d = new Date(from);
  if (billing === 'annual') d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1);
  return d;
}

/** True se o acesso pago já venceu — rede de segurança além do webhook.
 *  • 'paid' (modelo único legado): expira exatamente no fim do período.
 *  • recorrente (active/trialing/past_due/paused/incomplete): expira se o fim
 *    do período já passou + 3 dias de tolerância. O webhook PRESERVA o tier em
 *    status transitório (não derruba quem pagou por um soluço de cobrança ou
 *    evento fora de ordem); então é AQUI que o acesso de um transitório que não
 *    renovou acaba caindo — no fim do período pago + grace. Renovou → o webhook
 *    empurra current_period_end pra frente e isto nunca dispara.
 *  • 'canceled'/'unpaid'/'incomplete_expired': o webhook já setou tier=free.
 *  Tiers manuais/admin (status null/'admin_grant') nunca expiram. */
const RECURRING_STATUSES = new Set([
  'active',
  'trialing',
  'past_due',
  'paused',
  'incomplete',
]);
export function isPaidExpired(
  status: string | null | undefined,
  periodEnd: string | null | undefined,
): boolean {
  if (!periodEnd) return false;
  const end = new Date(periodEnd).getTime();
  if (status === 'paid') return end < Date.now();
  if (RECURRING_STATUSES.has(status ?? '')) {
    const GRACE_MS = 3 * 24 * 60 * 60 * 1000;
    return end + GRACE_MS < Date.now();
  }
  return false;
}

export function isPaidTier(v: string): v is PaidTier {
  return v === 'basic' || v === 'pro';
}

export function isBilling(v: string): v is Billing {
  return v === 'monthly' || v === 'annual';
}
