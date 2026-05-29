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

/** Fim do acesso a partir de `from` (default agora) pro período escolhido. */
export function periodEndFrom(billing: Billing, from: Date = new Date()): Date {
  const d = new Date(from);
  if (billing === 'annual') d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1);
  return d;
}

/** True se um acesso pago (status='paid') já venceu. Tiers manuais/admin
 *  (status != 'paid') nunca expiram por aqui. */
export function isPaidExpired(
  status: string | null | undefined,
  periodEnd: string | null | undefined,
): boolean {
  if (status !== 'paid') return false;
  if (!periodEnd) return false;
  return new Date(periodEnd).getTime() < Date.now();
}

export function isPaidTier(v: string): v is PaidTier {
  return v === 'basic' || v === 'pro';
}

export function isBilling(v: string): v is Billing {
  return v === 'monthly' || v === 'annual';
}
