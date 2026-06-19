import Stripe from 'stripe';

/**
 * Client Stripe server-side. NUNCA importar no client — STRIPE_SECRET_KEY
 * é segredo. Usado só em route handlers /api/billing/*.
 *
 * apiVersion PINADA de propósito. ATENÇÃO: omitir apiVersion NÃO usa a versão
 * da conta — o SDK envia a SUA versão default (DEFAULT_API_VERSION) no header
 * Stripe-Version. Como a Vercel reinstala deps a cada deploy, um bump do SDK
 * mudava a versão da API silenciosamente e quebrava o shape dos objetos (ex.:
 * na 'dahlia' o invoice.subscription e o subscription.current_period_end
 * mudaram de lugar → webhook de renovação parava de achar a assinatura). Pinar
 * congela o comportamento. Mantemos = à versão do SDK instalado pra os types
 * baterem com o runtime; o webhook ainda lê os campos de forma defensiva
 * (ambos os shapes) pra sobreviver a qualquer drift futuro.
 */

const STRIPE_API_VERSION = '2026-05-27.dahlia';

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error(
      'STRIPE_SECRET_KEY não configurada. Adicione no .env.local (dev) e na Vercel (prod).',
    );
  }
  if (!_stripe) {
    _stripe = new Stripe(key, {
      apiVersion: STRIPE_API_VERSION,
      appInfo: { name: 'AutoEdit' },
    });
  }
  return _stripe;
}
