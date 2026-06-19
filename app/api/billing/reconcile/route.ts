import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { reconcileUserBilling } from '@/lib/billing-reconcile';

/**
 * POST /api/billing/reconcile  (self-service)
 *
 * Reconcilia o acesso pago do PRÓPRIO usuário logado com o Stripe. Chamado
 * automaticamente quando o cliente volta do checkout (success_url
 * `/tools?upgraded=1`) — rede de segurança caso o webhook não tenha chegado.
 * Só concede acesso; nunca rebaixa. Idempotente.
 */

export const runtime = 'nodejs';
export const maxDuration = 15;

export async function POST() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ applied: false, error: 'login' }, { status: 401 });
  }
  try {
    const result = await reconcileUserBilling(user.id);
    return NextResponse.json(result);
  } catch (e) {
    // Não quebra a UX do cliente — só não conseguiu reconciliar agora.
    return NextResponse.json(
      {
        applied: false,
        error: e instanceof Error ? e.message.slice(0, 200) : String(e),
      },
      { status: 200 },
    );
  }
}
