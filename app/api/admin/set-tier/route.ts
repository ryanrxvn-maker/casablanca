import { NextResponse } from 'next/server';
import { jsonError, requireAdmin, serviceClient } from '../_helpers';
import { findLiveStripeSubscription } from '@/lib/billing-reconcile';

/**
 * POST /api/admin/set-tier
 *   Body: { userId: string, tier: 'free' | 'basic' | 'pro' }
 *
 * Apenas admin pode mudar o tier de qualquer conta. Tier 'admin' não é
 * setável via este endpoint (precisa setar is_admin=true direto).
 */

export const runtime = 'nodejs';
export const maxDuration = 10;

const VALID = new Set(['free', 'basic', 'pro']);

export async function POST(req: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  try {
    const { userId, tier, reason } = (await req.json()) as {
      userId?: string;
      tier?: string;
      reason?: string;
    };
    if (!userId || !tier || !VALID.has(tier)) {
      return jsonError('Payload inválido.', 400);
    }

    const svc = serviceClient();

    // Tier atual (pra auditoria from->to) + vínculo Stripe (guard abaixo).
    const { data: before } = await svc
      .from('profiles')
      .select('tier, email, stripe_customer_id')
      .eq('id', userId)
      .maybeSingle();
    const beforeP = before as {
      tier?: string | null;
      email?: string | null;
      stripe_customer_id?: string | null;
    } | null;
    const fromTier = beforeP?.tier ?? null;

    // ─── GUARD: cortesia JAMAIS por cima de assinatura VIVA no Stripe ───
    // Caso Fernando: pagou (webhook falhou), admin liberou na mão → a conta
    // virou "cortesia", a tela de assinatura parou de mostrar a assinatura
    // real e o cartão CONTINUOU sendo cobrado sem o cliente conseguir
    // cancelar. Se existe assinatura viva, esse cliente é PAGANTE — o caminho
    // certo é "Sincronizar c/ Stripe" (reconcile), nunca admin_grant.
    if (tier !== 'free') {
      try {
        const found = await findLiveStripeSubscription(
          beforeP?.stripe_customer_id,
          beforeP?.email,
        );
        if (found) {
          return jsonError(
            `Esse cliente tem assinatura ${found.sub.status.toUpperCase()} no Stripe — ele é PAGANTE, não cortesia. Use "Sincronizar c/ Stripe" pra aplicar o plano pago (cortesia por cima esconderia a cobrança do cartão dele). Se quiser cortesia de verdade, cancele a assinatura no Stripe primeiro.`,
            409,
          );
        }
      } catch {
        /* Stripe fora do ar não pode travar liberação manual — segue */
      }
    }

    // Concessão MANUAL: marca admin_grant (distingue de pago e NÃO expira).
    // Pra free, limpa os campos de assinatura.
    const patch: Record<string, unknown> =
      tier === 'free'
        ? {
            tier,
            subscription_status: null,
            subscription_plan: null,
            current_period_end: null,
          }
        : {
            tier,
            subscription_status: 'admin_grant',
            subscription_plan: tier,
            current_period_end: null,
          };

    const { data, error } = await svc
      .from('profiles')
      .update(patch)
      .eq('id', userId)
      .select('id, tier');

    if (error) {
      // Coluna tier não existe? Mensagem explícita.
      const msg = (error.message || '').toLowerCase();
      if (msg.includes('column') && msg.includes('tier')) {
        return jsonError(
          'Coluna tier não existe ainda. Rode a migration 016_tier_expand.sql no Supabase SQL Editor.',
          500,
          error.message,
        );
      }
      return jsonError('Falha ao atualizar tier.', 500, error.message);
    }

    if (!data || data.length === 0) {
      return jsonError('Usuário não encontrado.', 404);
    }

    // Auditoria: quem mudou, de quê pra quê, e por quê (best-effort).
    try {
      await svc.from('tier_changes').insert({
        admin_id: guard.userId,
        user_id: userId,
        from_tier: fromTier,
        to_tier: tier,
        reason: typeof reason === 'string' ? reason.slice(0, 300) : null,
      });
    } catch {
      /* tabela 024 ainda não migrada — não bloqueia a mudança */
    }

    return NextResponse.json({ ok: true, tier: data[0].tier });
  } catch (e) {
    return jsonError(
      'Erro inesperado.',
      500,
      e instanceof Error ? e.message : String(e),
    );
  }
}
