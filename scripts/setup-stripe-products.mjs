/**
 * Cria (idempotente) os produtos e preços do AutoEdit no Stripe e grava os
 * 4 Price IDs no .env.local. Reaproveita produtos/preços já existentes via
 * metadata.autoedit_tier + price.lookup_key — rodar de novo não duplica.
 *
 * Uso: node scripts/setup-stripe-products.mjs
 */
import Stripe from 'stripe';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ENV_PATH = resolve(process.cwd(), '.env.local');

function loadEnv() {
  const txt = readFileSync(ENV_PATH, 'utf8');
  const out = {};
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return { txt, out };
}

const { txt: envTxt, out: env } = loadEnv();
const key = env.STRIPE_SECRET_KEY;
if (!key || !key.startsWith('sk_')) {
  console.error('STRIPE_SECRET_KEY ausente/inválida no .env.local');
  process.exit(1);
}
const stripe = new Stripe(key);

const PLANS = [
  { tier: 'basic', name: 'AutoEdit Basic', monthly: 5700, annual: 54000 },
  { tier: 'pro', name: 'AutoEdit Pro', monthly: 11600, annual: 110400 },
];

async function ensureProduct(tier, name) {
  const list = await stripe.products.list({ limit: 100, active: true });
  const found = list.data.find((p) => p.metadata?.autoedit_tier === tier);
  if (found) {
    console.log(`• Produto ${tier} já existe: ${found.id}`);
    return found.id;
  }
  const prod = await stripe.products.create({
    name,
    metadata: { autoedit_tier: tier },
  });
  console.log(`✓ Produto ${tier} criado: ${prod.id}`);
  return prod.id;
}

async function ensurePrice(productId, lookupKey, amount, interval) {
  const existing = await stripe.prices.list({ lookup_keys: [lookupKey], limit: 1 });
  if (existing.data[0]) {
    console.log(`• Preço ${lookupKey} já existe: ${existing.data[0].id}`);
    return existing.data[0].id;
  }
  const price = await stripe.prices.create({
    product: productId,
    currency: 'brl',
    unit_amount: amount,
    recurring: { interval },
    lookup_key: lookupKey,
    metadata: { autoedit_lookup: lookupKey },
  });
  console.log(`✓ Preço ${lookupKey} criado: ${price.id} (R$ ${(amount / 100).toFixed(2)}/${interval})`);
  return price.id;
}

const result = {};
for (const plan of PLANS) {
  const productId = await ensureProduct(plan.tier, plan.name);
  result[`STRIPE_PRICE_${plan.tier.toUpperCase()}_MONTHLY`] = await ensurePrice(
    productId,
    `autoedit_${plan.tier}_monthly`,
    plan.monthly,
    'month',
  );
  result[`STRIPE_PRICE_${plan.tier.toUpperCase()}_ANNUAL`] = await ensurePrice(
    productId,
    `autoedit_${plan.tier}_annual`,
    plan.annual,
    'year',
  );
}

// Grava os Price IDs no .env.local (substitui as linhas vazias).
let updated = envTxt;
for (const [k, v] of Object.entries(result)) {
  const re = new RegExp(`^${k}=.*$`, 'm');
  if (re.test(updated)) updated = updated.replace(re, `${k}=${v}`);
  else updated += `\n${k}=${v}`;
}
writeFileSync(ENV_PATH, updated, 'utf8');

console.log('\n=== Price IDs gravados no .env.local ===');
for (const [k, v] of Object.entries(result)) console.log(`${k}=${v}`);
