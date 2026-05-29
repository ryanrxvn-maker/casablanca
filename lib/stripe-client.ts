import { loadStripe, type Stripe } from '@stripe/stripe-js';

/**
 * Stripe.js no client (Elements). Usa a chave PUBLICÁVEL (pk_), que pode
 * ir pro browser. Singleton pra não recarregar o script.
 */
let _promise: Promise<Stripe | null> | null = null;

export function getStripePromise(): Promise<Stripe | null> {
  if (!_promise) {
    const pk = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';
    _promise = loadStripe(pk);
  }
  return _promise;
}
