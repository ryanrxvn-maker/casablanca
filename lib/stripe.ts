import Stripe from 'stripe';

/**
 * Client Stripe server-side. NUNCA importar no client — STRIPE_SECRET_KEY
 * é segredo. Usado só em route handlers /api/billing/*.
 *
 * apiVersion omitido de propósito → usa a versão fixada na conta Stripe,
 * evitando quebra quando a lib atualiza o default.
 */

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error(
      'STRIPE_SECRET_KEY não configurada. Adicione no .env.local (dev) e na Vercel (prod).',
    );
  }
  if (!_stripe) {
    _stripe = new Stripe(key, { appInfo: { name: 'AutoEdit' } });
  }
  return _stripe;
}
