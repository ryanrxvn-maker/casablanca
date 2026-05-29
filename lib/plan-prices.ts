/**
 * Mapa entre planos pagos do AutoEdit e os Price IDs do Stripe.
 *
 * Os Price IDs vêm de variáveis de ambiente (criados uma vez no painel Stripe).
 * Assim trocar de preço/conta é só mexer no .env — sem deploy de código.
 *
 * Preços (referência da vitrine /planos):
 *   Basic  → R$ 57/mês  · R$ 540/ano
 *   Pro    → R$ 116/mês · R$ 1.104/ano
 */

export type PaidTier = 'basic' | 'pro';
export type Billing = 'monthly' | 'annual';

const PRICE_ENV: Record<PaidTier, Record<Billing, string | undefined>> = {
  basic: {
    monthly: process.env.STRIPE_PRICE_BASIC_MONTHLY,
    annual: process.env.STRIPE_PRICE_BASIC_ANNUAL,
  },
  pro: {
    monthly: process.env.STRIPE_PRICE_PRO_MONTHLY,
    annual: process.env.STRIPE_PRICE_PRO_ANNUAL,
  },
};

/** Price ID do Stripe pra um plano+ciclo. undefined se env não setada. */
export function priceIdFor(tier: PaidTier, billing: Billing): string | undefined {
  return PRICE_ENV[tier]?.[billing];
}

/** Dado um Price ID do Stripe (vindo do webhook), qual tier ele concede. */
export function tierForPriceId(priceId: string): PaidTier | null {
  for (const tier of ['basic', 'pro'] as PaidTier[]) {
    for (const billing of ['monthly', 'annual'] as Billing[]) {
      if (PRICE_ENV[tier][billing] === priceId) return tier;
    }
  }
  return null;
}

export function isPaidTier(v: string): v is PaidTier {
  return v === 'basic' || v === 'pro';
}

export function isBilling(v: string): v is Billing {
  return v === 'monthly' || v === 'annual';
}
