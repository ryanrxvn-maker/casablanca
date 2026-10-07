import { isPaidExpired } from '@/lib/plan-prices';

/**
 * Classificação de acesso de um profile pro painel admin. Usada pela lista
 * (list-users) e pelo perfil completo (user-profile): as duas telas PRECISAM
 * concordar, então a regra mora num lugar só.
 *
 *   plan:   'premium' | 'free' — plano EFETIVO (considera expiração; tier
 *           legado pro/beta conta como premium)
 *   access: paid    → pagou de verdade (Stripe: active/trialing/paid, não vencido)
 *           granted → admin liberou na mão (admin_grant, não expira)
 *           pending → renovação não paga, acesso suspenso até pagar
 *           anomaly → tier pago sem pagamento e sem concessão (investigar)
 *           free
 */
export type AccessClass = {
  plan: 'premium' | 'free';
  access: 'paid' | 'granted' | 'pending' | 'anomaly' | 'free';
};

export function classifyAccess(p: {
  tier?: unknown;
  subscription_status?: string | null;
  current_period_end?: string | null;
}): AccessClass {
  const tier = (p.tier ?? '').toString();
  const isPaidTier = tier === 'basic' || tier === 'pro' || tier === 'beta';
  const expired = isPaidExpired(p.subscription_status, p.current_period_end);
  if (!isPaidTier || expired) return { plan: 'free', access: 'free' };
  const s = p.subscription_status ?? '';
  if (s === 'active' || s === 'trialing' || s === 'paid') return { plan: 'premium', access: 'paid' };
  if (s === 'admin_grant') return { plan: 'premium', access: 'granted' };
  // Renovação tentada e NÃO paga → acesso SUSPENSO pelos gates (política
  // 13.08). Assinatura segue viva no Stripe; o cliente resolve na tela de
  // assinatura (retry/troca de cartão). Plano EFETIVO agora é free.
  if (s === 'past_due' || s === 'unpaid') return { plan: 'free', access: 'pending' };
  return { plan: 'premium', access: 'anomaly' };
}

/** Telefone que a pessoa deixou: o verificado por SMS, o do cadastro
 *  (whatsapp) ou o que ficou só nos metadados do login. */
export function bestPhone(p: { phone?: unknown; whatsapp?: unknown }, metaPhone?: unknown): string | null {
  for (const v of [p.phone, p.whatsapp, metaPhone]) {
    if (typeof v === 'string' && v.replace(/\D/g, '').length >= 8) return v.trim();
  }
  return null;
}
