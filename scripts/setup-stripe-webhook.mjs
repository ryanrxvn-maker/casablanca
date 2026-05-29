/**
 * Cria o webhook endpoint do AutoEdit no Stripe apontando pra produção e
 * imprime o signing secret (whsec_). Idempotente: se já existir um endpoint
 * pra essa URL, deleta e recria pra garantir um secret fresco.
 *
 * Uso: node scripts/setup-stripe-webhook.mjs https://SEU-DOMINIO
 */
import Stripe from 'stripe';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ENV_PATH = resolve(process.cwd(), '.env.local');
const envTxt = readFileSync(ENV_PATH, 'utf8');
const key = envTxt.match(/^STRIPE_SECRET_KEY=(.*)$/m)?.[1];
if (!key || !key.startsWith('sk_')) {
  console.error('STRIPE_SECRET_KEY ausente no .env.local');
  process.exit(1);
}

const base = (process.argv[2] || 'https://casablanca-ashen.vercel.app').replace(/\/$/, '');
const url = `${base}/api/billing/webhook`;
// Pagamento único: confirmação síncrona (cartão/PIX) + assíncrona (boleto/PIX pendente).
const EVENTS = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
];

const stripe = new Stripe(key);

const existing = await stripe.webhookEndpoints.list({ limit: 100 });
const match = existing.data.find((ep) => ep.url === url);

if (match) {
  // Atualiza só os eventos — MANTÉM o mesmo signing secret (não precisa
  // re-colar na Vercel).
  await stripe.webhookEndpoints.update(match.id, { enabled_events: EVENTS });
  console.log(`\n✓ Webhook atualizado (secret inalterado): ${match.id}`);
  console.log(`  URL: ${url}`);
  console.log(`  Eventos: ${EVENTS.join(', ')}`);
  console.log('\nNada pra mudar na Vercel — o STRIPE_WEBHOOK_SECRET continua o mesmo.');
} else {
  const ep = await stripe.webhookEndpoints.create({
    url,
    enabled_events: EVENTS,
    description: 'AutoEdit billing (acesso por pagamento unico)',
  });
  console.log(`\n✓ Webhook criado: ${ep.id}`);
  console.log(`  URL: ${url}`);
  console.log(`  Eventos: ${EVENTS.join(', ')}`);

  let updated = envTxt;
  const re = /^STRIPE_WEBHOOK_SECRET=.*$/m;
  if (re.test(updated)) updated = updated.replace(re, `STRIPE_WEBHOOK_SECRET=${ep.secret}`);
  else updated += `\nSTRIPE_WEBHOOK_SECRET=${ep.secret}`;
  writeFileSync(ENV_PATH, updated, 'utf8');

  console.log(`\n=== COLE ISSO NA VERCEL (Environment Variables, Production) ===`);
  console.log(`STRIPE_WEBHOOK_SECRET=${ep.secret}`);
}
